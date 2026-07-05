import type { Server, ServerWebSocket } from 'bun';
import type { ServerWsEvent } from '@rodinna/shared-types';

/**
 * Kernel vrstva real-time pub/sub (M0): registre živých socketov + publish
 * helpery, ktoré potrebuje viac modulov (chat eventy, notifications badge,
 * neskôr živé karty). WS handler samotný žije v modules/chat/realtime.ts —
 * tu je len zdieľaný stav, nech kernel moduly (notifications) nezávisia
 * na Phase 1 module. Jeden proces = server.publish stačí; multi-proces
 * Phase 2 by sem doplnil Postgres LISTEN/NOTIFY.
 */

export interface WsData {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  roomIds: string[];
}

let server: Server<WsData> | null = null;

/** Register živých socketov per užívateľ (presence, cielené eventy, push filter). */
export const userSockets = new Map<string, Set<ServerWebSocket<WsData>>>();

/** Zavolá index.ts po Bun.serve(), nech máme referenciu na server pre publish. */
export function setServer(s: Server<WsData>): void {
  server = s;
}

export function publish(topic: string, event: ServerWsEvent): void {
  server?.publish(topic, JSON.stringify(event));
}

/** Pošle event všetkým členom miestnosti (REST vrstva volá pri novej správe atď.). */
export function broadcastToRoom(roomId: string, event: ServerWsEvent): void {
  publish(`room:${roomId}`, event);
}

/**
 * App-wide topic — všetky pripojené sockety (poll updaty, nové feed karty…).
 * Subscribe robí chat WS handler pri open().
 */
export const APP_TOPIC = 'app';

export function broadcastApp(event: ServerWsEvent): void {
  publish(APP_TOPIC, event);
}

/** Pošle event na všetky zariadenia jedného užívateľa (napr. „pridaný do miestnosti"). */
export function broadcastToUser(userId: string, event: ServerWsEvent): void {
  publish(`user:${userId}`, event);
}

/** Zoznam práve online užívateľov (z registra socketov). */
export function getOnlineUserIds(): string[] {
  return [...userSockets.keys()];
}

/** Má užívateľ aspoň jeden živý socket? (Push sa posiela len offline zariadeniam.) */
export function isUserOnline(userId: string): boolean {
  return userSockets.has(userId);
}
