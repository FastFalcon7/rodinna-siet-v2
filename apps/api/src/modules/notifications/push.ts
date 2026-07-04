import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import type { NotificationPayload } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { pushSubs } from '../../core/db/schema';
import { env, pushEnabled } from '../../config/env';

/**
 * Web Push odosielanie (VAPID) — beží **len vo worker procese** (job
 * 'push.send'), API push provider nikdy nekontaktuje. Mŕtve subscriptions
 * (404/410 = zariadenie odhlásené/preinštalované) sa pri odoslaní mažú.
 */

let configured = false;

function ensureConfigured(): boolean {
  if (!pushEnabled) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

export async function sendPushToUsers(userIds: string[], payload: NotificationPayload): Promise<void> {
  if (userIds.length === 0) return;
  if (!ensureConfigured()) {
    console.warn('push.send preskočený — VAPID kľúče nie sú nakonfigurované');
    return;
  }

  const subs = await db.select().from(pushSubs).where(inArray(pushSubs.userId, userIds));
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  let transientFailures = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        // TTL 1 h: správa doručená s hodinovým oneskorením už nemá cenu ako push
        // (unread badge ju ukáže); urgency high = doručenie aj v power-save režime.
        { TTL: 3600, urgency: 'high' },
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubs).where(eq(pushSubs.id, sub.id)).catch(() => {});
        continue;
      }
      transientFailures++;
      console.error(`push na ${sub.endpoint.slice(0, 60)}… zlyhal (${status ?? 'network'})`);
    }
  }

  // Retry celého jobu má zmysel len keď nezlyhalo nič čiastočne — inak by
  // úspešné zariadenia dostali duplicitný push. Push je best-effort.
  if (transientFailures === subs.length && subs.length > 0) {
    throw new Error(`Všetkých ${subs.length} push odoslaní zlyhalo (transientne)`);
  }
}
