import { eq, sql } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { roomMembers } from '../../core/db/schema';

/**
 * Stavové pomôcky chatu, ktoré zdieľa REST vrstva (service.ts) aj real-time
 * vrstva (realtime.ts). Žijú tu samostatne, aby service ↔ realtime nemuseli
 * importovať jeden druhého (cyklus) — obe importujú len tento „pure DB" modul.
 */

/** Id všetkých miestností, ktorých je užívateľ členom (na subscribe pri WS connecte). */
export async function getUserRoomIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.userId, userId));
  return rows.map((r) => r.roomId);
}

export interface ReadAdvance {
  lastReadAt: string;
  lastReadMessageId: string;
}

/**
 * Posunie čítací ukazovateľ člena na danú správu (zdroj pravdy pre neprečítané
 * aj potvrdenia o prečítaní). Posúva sa len dopredu — staršie „read" sa ignoruje.
 *
 * `last_read_at` sa nastavuje **priamo z `messages.created_at` v jednom SQL**,
 * nech sa hodnota neprenáša cez JS `Date` (postgres.js by ju orezal na ms a tá
 * istá správa by potom vyšla ako neprečítaná: `created_at > last_read_at`).
 *
 * Vracia nový stav, alebo null ak sa nič nezmenilo (nečlen / neexist. správa /
 * žiaden posun dopredu).
 */
export async function advanceRead(
  userId: string,
  roomId: string,
  messageId: string,
): Promise<ReadAdvance | null> {
  const rows = (await db.execute(sql`
    update room_members rm
    set last_read_at = m.created_at, last_read_message_id = m.id
    from messages m
    where rm.room_id = ${roomId} and rm.user_id = ${userId}
      and m.id = ${messageId} and m.room_id = ${roomId}
      and (rm.last_read_at is null or m.created_at > rm.last_read_at)
    returning m.created_at as last_read_at, m.id as last_read_message_id
  `)) as unknown as Array<{ last_read_at: Date | string; last_read_message_id: string }>;

  const row = rows[0];
  if (!row) return null;
  return {
    lastReadAt: new Date(row.last_read_at).toISOString(),
    lastReadMessageId: row.last_read_message_id,
  };
}
