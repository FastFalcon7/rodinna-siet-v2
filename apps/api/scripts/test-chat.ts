/**
 * E2E test chat modulu (T6) — REST + WebSocket proti živému serveru a Postgresu.
 *
 * Spustenie (potrebuje bežiaci Postgres v DATABASE_URL):
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna bun scripts/test-chat.ts
 *
 * Test si nabootuje vlastný server (rovnaký fetch+websocket ako index.ts), nasype
 * troch užívateľov priamo do DB a preverí: miestnosti (DM idempotencia, skupina,
 * Rodina), správy (CRUD, reply, prílohy-vlastníctvo, hĺbka prázdnej), reakcie,
 * neprečítané + potvrdenia o prečítaní, a real-time eventy (ready, presence,
 * message:new, typing, read) cez WebSocket.
 */
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import type { ServerWsEvent } from '@rodinna/shared-types';

const PORT = 31987;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`);
  }
}

interface Json {
  status: number;
  body: any;
}
async function http(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `rs_session=${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** WS klient zbierajúci eventy s waitFor(predicate). */
function connectWs(token: string) {
  const events: ServerWsEvent[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
    headers: { cookie: `rs_session=${token}` },
  } as any);
  ws.addEventListener('message', (e) => {
    try {
      events.push(JSON.parse(e.data as string));
    } catch {
      /* ignore */
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
  function waitFor(pred: (e: ServerWsEvent) => boolean, ms = 1500): Promise<ServerWsEvent> {
    return new Promise((resolve, reject) => {
      const hit = events.find(pred);
      if (hit) return resolve(hit);
      const started = Date.now();
      const iv = setInterval(() => {
        const found = events.find(pred);
        if (found) {
          clearInterval(iv);
          resolve(found);
        } else if (Date.now() - started > ms) {
          clearInterval(iv);
          reject(new Error('waitFor timeout'));
        }
      }, 20);
    });
  }
  return { ws, events, opened, waitFor, send: (o: unknown) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

async function seedUser(email: string, displayName: string, role: 'admin' | 'member') {
  const ph = await hashPassword('Heslo12345');
  const inserted = await db
    .insert(users)
    .values({ email, displayName, passwordHash: ph, role })
    .returning();
  const u = inserted[0]!;
  const { token } = await createSession(u.id);
  return { id: u.id, displayName, token };
}

async function main() {
  await runMigrations();
  // Čistý štart.
  await db.execute(
    dsql`truncate table reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
  );

  const server = Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(req, srv) {
      if (new URL(req.url).pathname === '/ws') {
        if (await handleChatUpgrade(req, srv)) return undefined;
        return new Response('Unauthorized', { status: 401 });
      }
      return app.fetch(req, srv);
    },
    websocket: chatWebSocket,
  });
  setServer(server);

  const alica = await seedUser('alica@rodina.sk', 'Alica', 'admin');
  const bob = await seedUser('bob@rodina.sk', 'Bob', 'member');
  const cibula = await seedUser('cibula@rodina.sk', 'Cibula', 'member');

  console.log('\n— Miestnosti —');
  let r = await http(alica.token, 'GET', '/api/chat/rooms');
  check('alica vidí Rodina miestnosť', r.status === 200 && r.body.rooms.some((x: any) => x.kind === 'family'), r.body);
  const familyId = r.body.rooms.find((x: any) => x.kind === 'family')?.id;

  r = await http(bob.token, 'GET', '/api/chat/rooms');
  check('bob je tiež v Rodine (auto-membership)', r.body.rooms.some((x: any) => x.id === familyId), r.body);

  r = await http(alica.token, 'POST', '/api/chat/rooms', { kind: 'dm', memberIds: [bob.id] });
  check('alica založí DM s bobom', r.status === 201 && r.body.kind === 'dm' && r.body.members.length === 2, r.body);
  const dmId = r.body.id;

  r = await http(alica.token, 'POST', '/api/chat/rooms', { kind: 'dm', memberIds: [bob.id] });
  check('DM je idempotentné (rovnaké id)', r.body.id === dmId, r.body);

  r = await http(bob.token, 'POST', '/api/chat/rooms', { kind: 'dm', memberIds: [alica.id] });
  check('DM kanonické aj z druhej strany', r.body.id === dmId, r.body);

  r = await http(alica.token, 'POST', '/api/chat/rooms', { kind: 'dm', memberIds: [alica.id] });
  check('DM so sebou → 400', r.status === 400, r.body);

  r = await http(alica.token, 'POST', '/api/chat/rooms', {
    kind: 'group',
    memberIds: [bob.id, cibula.id],
    title: 'Víkend',
  });
  check('alica založí skupinu (3 členovia, owner=alica)', r.status === 201 && r.body.members.length === 3, r.body);
  const groupId = r.body.id;
  check('zakladateľ skupiny je owner', r.body.members.find((m: any) => m.id === alica.id)?.role === 'owner', r.body.members);

  console.log('\n— Správy —');
  r = await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: 'Ahoj Bob!' });
  check('alica pošle správu do DM', r.status === 201 && r.body.author.displayName === 'Alica', r.body);
  const msg1 = r.body.id;

  r = await http(bob.token, 'GET', `/api/chat/rooms/${dmId}/messages`);
  check('bob vidí správu v DM', r.status === 200 && r.body.messages.some((m: any) => m.id === msg1), r.body);

  r = await http(cibula.token, 'GET', `/api/chat/rooms/${dmId}/messages`);
  check('cibula (nečlen) → 404 na históriu DM', r.status === 404, r.body);

  r = await http(cibula.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: 'Votrelec' });
  check('cibula nemôže písať do cudzieho DM → 404', r.status === 404, r.body);

  r = await http(bob.token, 'POST', `/api/chat/rooms/${dmId}/messages`, {
    bodyMd: 'Ahoj Alica',
    replyToId: msg1,
  });
  check('bob odpovie (reply preview)', r.status === 201 && r.body.replyTo?.id === msg1 && r.body.replyTo?.authorName === 'Alica', r.body);

  r = await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: '   ' });
  check('prázdna správa → 400', r.status === 400, r.body);

  r = await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, {
    bodyMd: 'x',
    mediaIds: ['00000000-0000-0000-0000-000000000000'],
  });
  check('cudzia/neexist. príloha → 403', r.status === 403, r.body);

  r = await http(alica.token, 'PATCH', `/api/chat/messages/${msg1}`, { bodyMd: 'Ahoj Bob (uprav.)' });
  check('alica upraví vlastnú správu (editedAt)', r.status === 200 && r.body.editedAt !== null && r.body.bodyMd.includes('uprav'), r.body);

  r = await http(bob.token, 'PATCH', `/api/chat/messages/${msg1}`, { bodyMd: 'hack' });
  check('bob nemôže upraviť cudziu správu → 403', r.status === 403, r.body);

  console.log('\n— Reakcie —');
  r = await http(bob.token, 'PUT', '/api/chat/reactions', { messageId: msg1, emoji: '👍' });
  check('bob reaguje 👍', r.status === 200 && r.body.reactions.find((x: any) => x.emoji === '👍')?.count === 1, r.body);
  r = await http(alica.token, 'PUT', '/api/chat/reactions', { messageId: msg1, emoji: '❤️' });
  check('alica reaguje ❤️ (2 rôzne emoji)', r.body.reactions.length === 2, r.body);
  r = await http(bob.token, 'PUT', '/api/chat/reactions', { messageId: msg1, emoji: '👍' });
  check('bob zruší 👍 (toggle)', !r.body.reactions.find((x: any) => x.emoji === '👍'), r.body);

  console.log('\n— Zmazanie —');
  r = await http(alica.token, 'DELETE', `/api/chat/messages/${msg1}`);
  check('alica zmaže svoju správu → 204', r.status === 204, r.body);
  r = await http(bob.token, 'GET', `/api/chat/rooms/${dmId}/messages`);
  {
    const deleted = r.body.messages.find((m: any) => m.id === msg1);
    check('zmazaná správa má deleted=true a prázdne telo', deleted?.deleted === true && deleted?.bodyMd === '', deleted);
  }

  console.log('\n— Neprečítané + read receipts —');
  // Čistá skupina pre deterministické počítanie.
  await http(alica.token, 'POST', `/api/chat/rooms/${groupId}/messages`, { bodyMd: 'A1' });
  const last = await http(alica.token, 'POST', `/api/chat/rooms/${groupId}/messages`, { bodyMd: 'A2' });
  const lastId = last.body.id;
  r = await http(bob.token, 'GET', '/api/chat/rooms');
  check('bob má 2 neprečítané v skupine', r.body.rooms.find((x: any) => x.id === groupId)?.unreadCount === 2, r.body.rooms.find((x: any) => x.id === groupId));
  r = await http(alica.token, 'GET', '/api/chat/rooms');
  check('alica má 0 neprečítaných (vlastné správy)', r.body.rooms.find((x: any) => x.id === groupId)?.unreadCount === 0, r.body.rooms.find((x: any) => x.id === groupId));
  r = await http(bob.token, 'POST', `/api/chat/rooms/${groupId}/read`, { messageId: lastId });
  check('bob označí prečítané', r.status === 200 && r.body.read?.lastReadMessageId === lastId, r.body);
  r = await http(bob.token, 'GET', '/api/chat/rooms');
  check('po prečítaní 0 neprečítaných', r.body.rooms.find((x: any) => x.id === groupId)?.unreadCount === 0, r.body.rooms.find((x: any) => x.id === groupId));
  r = await http(cibula.token, 'POST', `/api/chat/rooms/${dmId}/read`, { messageId: lastId });
  check('read od nečlena DM → 404', r.status === 404, r.body);

  console.log('\n— Pagination —');
  for (let i = 0; i < 35; i++) {
    await http(cibula.token, 'POST', `/api/chat/rooms/${groupId}/messages`, { bodyMd: `C${i}` });
  }
  r = await http(alica.token, 'GET', `/api/chat/rooms/${groupId}/messages?limit=30`);
  check('prvá stránka = 30 + nextCursor', r.body.messages.length === 30 && r.body.nextCursor, { n: r.body.messages.length, cur: !!r.body.nextCursor });
  {
    const asc = r.body.messages.every(
      (m: any, i: number, a: any[]) => i === 0 || a[i - 1].createdAt <= m.createdAt,
    );
    check('správy vzostupne (najstaršia hore)', asc);
    const firstPageIds = new Set(r.body.messages.map((m: any) => m.id));
    const r2 = await http(alica.token, 'GET', `/api/chat/rooms/${groupId}/messages?limit=30&cursor=${encodeURIComponent(r.body.nextCursor)}`);
    const overlap = r2.body.messages.some((m: any) => firstPageIds.has(m.id));
    check('druhá stránka bez prekryvu', !overlap, { overlap });
  }

  console.log('\n— WebSocket real-time —');
  const wsBob = connectWs(bob.token);
  await wsBob.opened;
  const ready = await wsBob.waitFor((e) => e.t === 'ready');
  check('WS „ready" so zoznamom online', ready.t === 'ready' && (ready as any).onlineUserIds.includes(bob.id), ready);

  const wsAlica = connectWs(alica.token);
  await wsAlica.opened;
  const presence = await wsBob.waitFor((e) => e.t === 'presence' && (e as any).userId === alica.id && (e as any).online === true);
  check('bob dostane presence online(alica)', !!presence);

  // Alica pošle správu cez REST → bob ju má dostať cez WS.
  const sent = await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: 'real-time?' });
  const live = await wsBob.waitFor((e) => e.t === 'message:new' && (e as any).message.id === sent.body.id);
  check('bob dostane message:new cez WS', !!live);

  // Bob typing → alica to vidí.
  wsBob.send({ t: 'typing', roomId: dmId, state: 'start' });
  const typing = await wsAlica.waitFor((e) => e.t === 'typing' && (e as any).userId === bob.id);
  check('alica vidí typing(bob)', !!typing && (typing as any).state === 'start');

  // Bob read cez WS → alica dostane read receipt.
  wsBob.send({ t: 'read', roomId: dmId, messageId: sent.body.id });
  const readEvt = await wsAlica.waitFor((e) => e.t === 'read' && (e as any).userId === bob.id);
  check('alica dostane read receipt(bob)', !!readEvt && (readEvt as any).lastReadMessageId === sent.body.id);

  // Alica sa odpojí → bob dostane presence offline.
  wsAlica.close();
  const offline = await wsBob.waitFor((e) => e.t === 'presence' && (e as any).userId === alica.id && (e as any).online === false, 2000);
  check('bob dostane presence offline(alica)', !!offline);

  wsBob.close();
  server.stop(true);
  await sql.end();

  console.log(`\n${failed === 0 ? '✅' : '❌'} Chat E2E: ${passed} prešlo, ${failed} zlyhalo (spolu ${passed + failed}).`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashol:', err);
  process.exit(1);
});
