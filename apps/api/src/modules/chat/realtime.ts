import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';
import { eq } from 'drizzle-orm';
import { ClientWsEventSchema, type ServerWsEvent } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { users } from '../../core/db/schema';
import { validateSessionToken } from '../auth/session';
import { SESSION_COOKIE } from '../auth/cookies';
import { advanceRead, getUserRoomIds } from './state';

/**
 * Real-time vrstva chatu — natívne Bun WebSockets s pub/sub (ARCHITECTURE_V2.md §4).
 * Topics:
 *   room:{id}   — eventy konkrétnej miestnosti (správy, typing, read receipts)
 *   user:{id}   — cielené eventy pre užívateľa (pridanie do novej miestnosti)
 *   presence    — globálny online/offline stav (10 členov rodiny)
 *
 * Beží v jednom procese spolu s HTTP serverom, takže `server.publish` z REST
 * vrstvy a zo socketov zdieľa rovnaký pub/sub. (Phase 2 multi-proces → LISTEN/NOTIFY.)
 */

export interface WsData {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  roomIds: string[];
}

let server: Server<WsData> | null = null;

/** Registru živých socketov per užívateľ (na presence + dosubscribovanie nových miestností). */
const userSockets = new Map<string, Set<ServerWebSocket<WsData>>>();

/** Zavolá index.ts po Bun.serve(), nech máme referenciu na server pre publish. */
export function setServer(s: Server<WsData>): void {
  server = s;
}

function publish(topic: string, event: ServerWsEvent): void {
  server?.publish(topic, JSON.stringify(event));
}

/** Pošle event všetkým členom miestnosti (REST vrstva volá pri novej správe atď.). */
export function broadcastToRoom(roomId: string, event: ServerWsEvent): void {
  publish(`room:${roomId}`, event);
}

/** Pošle event na všetky zariadenia jedného užívateľa (napr. „pridaný do miestnosti"). */
export function broadcastToUser(userId: string, event: ServerWsEvent): void {
  publish(`user:${userId}`, event);
}

/** Zoznam práve online užívateľov (z registra socketov). */
export function getOnlineUserIds(): string[] {
  return [...userSockets.keys()];
}

/**
 * Dosubscribuje živé sockety užívateľa na novú miestnosť (po jej založení /
 * pridaní člena), nech okamžite dostávajú jej eventy bez reconnectu.
 */
export function joinRoomTopic(userId: string, roomId: string): void {
  const set = userSockets.get(userId);
  if (!set) return;
  for (const ws of set) {
    ws.subscribe(`room:${roomId}`);
    if (!ws.data.roomIds.includes(roomId)) ws.data.roomIds.push(roomId);
  }
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Upgrade /ws na WebSocket. Autentifikácia cez session cookie (rovnaká ako REST).
 * Vracia true ak prebehol upgrade (handler ďalej beží), false → 401.
 */
export async function handleChatUpgrade(req: Request, s: Server<WsData>): Promise<boolean> {
  const token = parseCookie(req.headers.get('cookie'), SESSION_COOKIE);
  if (!token) return false;

  const result = await validateSessionToken(token);
  if (!result) return false;

  const roomIds = await getUserRoomIds(result.user.id);
  const data: WsData = {
    userId: result.user.id,
    displayName: result.user.displayName,
    avatarUrl: result.user.avatarUrl,
    roomIds,
  };
  return s.upgrade(req, { data });
}

export const chatWebSocket: WebSocketHandler<WsData> = {
  // Bun posiela auto-ping; idle 5 min je rezerva pre mobilné prepínanie sietí.
  idleTimeout: 300,
  maxPayloadLength: 64 * 1024,

  open(ws) {
    const { userId, roomIds } = ws.data;
    ws.subscribe('presence');
    ws.subscribe(`user:${userId}`);
    for (const rid of roomIds) ws.subscribe(`room:${rid}`);

    const set = userSockets.get(userId) ?? new Set<ServerWebSocket<WsData>>();
    const wasOffline = set.size === 0;
    set.add(ws);
    userSockets.set(userId, set);

    // Snapshot aktuálne online užívateľov pre tento socket.
    ws.send(JSON.stringify({ t: 'ready', onlineUserIds: getOnlineUserIds() } satisfies ServerWsEvent));

    // Ostatným oznám príchod (ws.publish vylúči odosielateľa).
    if (wasOffline) {
      ws.publish(
        'presence',
        JSON.stringify({ t: 'presence', userId, online: true, lastSeenAt: null } satisfies ServerWsEvent),
      );
    }
  },

  async message(ws, raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    const evt = ClientWsEventSchema.safeParse(parsed);
    if (!evt.success) return;
    const { userId, displayName, roomIds } = ws.data;

    switch (evt.data.t) {
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong' } satisfies ServerWsEvent));
        return;

      case 'typing': {
        // Iba pre miestnosti, ktorých je členom (zabráni spoofu cudzej miestnosti).
        if (!roomIds.includes(evt.data.roomId)) return;
        ws.publish(
          `room:${evt.data.roomId}`,
          JSON.stringify({
            t: 'typing',
            roomId: evt.data.roomId,
            userId,
            displayName,
            state: evt.data.state,
          } satisfies ServerWsEvent),
        );
        return;
      }

      case 'read': {
        if (!roomIds.includes(evt.data.roomId)) return;
        const adv = await advanceRead(userId, evt.data.roomId, evt.data.messageId);
        if (!adv) return;
        // Read receipt vidia všetci v miestnosti vrátane ostatných zariadení odosielateľa.
        publish(`room:${evt.data.roomId}`, {
          t: 'read',
          roomId: evt.data.roomId,
          userId,
          lastReadAt: adv.lastReadAt,
          lastReadMessageId: adv.lastReadMessageId,
        });
        return;
      }
    }
  },

  close(ws) {
    const { userId } = ws.data;
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size > 0) return;

    // Posledný socket užívateľa → offline.
    userSockets.delete(userId);
    const lastSeenAt = new Date();
    void db.update(users).set({ lastSeenAt }).where(eq(users.id, userId)).catch(() => {});
    publish('presence', {
      t: 'presence',
      userId,
      online: false,
      lastSeenAt: lastSeenAt.toISOString(),
    });
  },
};
