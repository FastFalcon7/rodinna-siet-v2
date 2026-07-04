import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { MessagePublic } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { chatRooms, roomMembers } from '../../core/db/schema';
import { getOnlineUserIds } from '../../core/realtime';
import { notifyUsers } from '../notifications/service';

/**
 * Push notifikácia o novej správe (T7 / plán M0-2). Fire-and-forget zo
 * sendMessage — REST odpoveď na ňu nečaká. Push dostanú len členovia bez
 * živého WS pripojenia (online užívateľ správu vidí okamžite v appke) a bez
 * aktívneho stlmenia miestnosti. In-app notifikácia sa nezapisuje — signálom
 * v appke je unread badge.
 */

const PUSH_BODY_MAX = 140;

function bodyPreview(msg: MessagePublic): string {
  if (msg.bodyMd) {
    return msg.bodyMd.length > PUSH_BODY_MAX ? `${msg.bodyMd.slice(0, PUSH_BODY_MAX)}…` : msg.bodyMd;
  }
  const kind = msg.media[0]?.kind;
  if (kind === 'image') return msg.media.length > 1 ? `📷 ${msg.media.length} fotiek` : '📷 Fotka';
  if (kind === 'video') return '🎬 Video';
  return '📎 Príloha';
}

export async function notifyNewMessage(msg: MessagePublic): Promise<void> {
  const roomRows = await db
    .select({ kind: chatRooms.kind, title: chatRooms.title })
    .from(chatRooms)
    .where(eq(chatRooms.id, msg.roomId))
    .limit(1);
  const room = roomRows[0];
  if (!room) return;

  // Členovia okrem autora, ktorí miestnosť nemajú stlmenú.
  const memberRows = await db
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, msg.roomId),
        or(isNull(roomMembers.mutedUntil), sql`${roomMembers.mutedUntil} < now()`),
      ),
    );
  const recipients = memberRows.map((m) => m.userId).filter((id) => id !== msg.author.id);
  if (recipients.length === 0) return;

  // DM: titulok = meno odosielateľa (WhatsApp vzor). Skupina: „Meno · Skupina".
  const title =
    room.kind === 'dm'
      ? msg.author.displayName
      : `${msg.author.displayName} · ${room.title ?? 'Rodina'}`;

  await notifyUsers(
    recipients,
    'chat.message',
    {
      title,
      body: bodyPreview(msg),
      url: `/?room=${msg.roomId}`,
      // Tag = roomId: novšia správa z tej istej miestnosti nahradí staršiu
      // notifikáciu namiesto zaplavenia lock screenu.
      tag: msg.roomId,
    },
    { inApp: false, skipPushFor: getOnlineUserIds() },
  );
}
