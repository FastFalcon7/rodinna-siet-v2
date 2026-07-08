import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  NotificationPayloadSchema,
  type NotificationKind,
  type NotificationPayload,
  type NotificationPrefs,
  type NotificationPublic,
  type PushSubscribeInput,
} from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { notifications, pushSubs, users, type NotificationRow } from '../../core/db/schema';
import { publishCrossProcess } from '../../core/events';
import { enqueueJob } from '../../core/jobs/queue';
import { pushEnabled } from '../../config/env';

/**
 * Notifications kernel (M0) — jediné miesto, cez ktoré moduly notifikujú
 * užívateľov (integračný kontrakt K3). Rešpektuje per-kind preferencie
 * (users.push_pref_json), voliteľne zapíše in-app notifikáciu (zvonček)
 * a push fan-out deleguje na worker cez pg_jobs (API nikdy nečaká na
 * push provider).
 */

export interface NotifyOptions {
  /** Zapísať aj in-app notifikáciu (default true). Chat správy dávajú false — ich in-app signál je unread badge. */
  inApp?: boolean;
  /** Používatelia, ktorým push netreba (typicky práve online cez WS). */
  skipPushFor?: string[];
}

function toPublic(row: NotificationRow): NotificationPublic {
  const payload = NotificationPayloadSchema.safeParse(row.payload);
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    payload: payload.success ? payload.data : { title: '', body: '', url: '/' },
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Per-kind preferencie: chýbajúci kľúč = zapnuté. */
function kindEnabled(prefs: unknown, kind: NotificationKind): boolean {
  if (!prefs || typeof prefs !== 'object') return true;
  return (prefs as Record<string, unknown>)[kind] !== false;
}

export async function notifyUsers(
  userIds: string[],
  kind: NotificationKind,
  payload: NotificationPayload,
  opts: NotifyOptions = {},
): Promise<void> {
  if (userIds.length === 0) return;
  const inApp = opts.inApp ?? true;
  const skipPush = new Set(opts.skipPushFor ?? []);

  const prefRows = await db
    .select({ id: users.id, pushPref: users.pushPref })
    .from(users)
    .where(inArray(users.id, userIds));
  const enabled = prefRows.filter((r) => kindEnabled(r.pushPref, kind)).map((r) => r.id);
  if (enabled.length === 0) return;

  if (inApp) {
    const inserted = await db
      .insert(notifications)
      .values(enabled.map((userId) => ({ userId, kind, payload })))
      .returning();
    // Cross-process (M1): z workera ide event cez Postgres NOTIFY do API socketov.
    for (const row of inserted) {
      await publishCrossProcess(`user:${row.userId}`, {
        t: 'notification:new',
        notification: toPublic(row),
      });
    }
  }

  const pushTargets = enabled.filter((id) => !skipPush.has(id));
  if (pushEnabled && pushTargets.length > 0) {
    await enqueueJob('push.send', { userIds: pushTargets, notification: payload });
  }
}

// ── In-app zoznam ────────────────────────────────────────────────────────────

export async function listNotifications(
  userId: string,
  limit = 50,
): Promise<{ notifications: NotificationPublic[]; unreadCount: number }> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const unread = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { notifications: rows.map(toPublic), unreadCount: unread[0]?.count ?? 0 };
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
  const where = ids?.length
    ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}

// ── Push subscriptions ───────────────────────────────────────────────────────

/** Upsert podľa endpointu — re-subscribe prehliadača neduplikuje; prevzatie
 *  endpointu iným účtom (zdieľané zariadenie po odhlásení) prepíše vlastníka. */
export async function savePushSubscription(userId: string, input: PushSubscribeInput): Promise<void> {
  await db
    .insert(pushSubs)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      deviceLabel: input.deviceLabel ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubs.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        deviceLabel: input.deviceLabel ?? null,
      },
    });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubs)
    .where(and(eq(pushSubs.userId, userId), eq(pushSubs.endpoint, endpoint)));
}

// ── Preferencie ──────────────────────────────────────────────────────────────

export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  const rows = await db.select({ pushPref: users.pushPref }).from(users).where(eq(users.id, userId)).limit(1);
  const raw = rows[0]?.pushPref;
  return raw && typeof raw === 'object' ? (raw as NotificationPrefs) : {};
}

export async function setPrefs(userId: string, prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const merged = { ...(await getPrefs(userId)), ...prefs };
  await db.update(users).set({ pushPref: merged }).where(eq(users.id, userId));
  return merged;
}
