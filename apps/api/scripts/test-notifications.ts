/**
 * E2E test notifications kernelu + pg_jobs queue (M0) — REST + WS proti
 * živému serveru a Postgresu.
 *
 * Spustenie (potrebuje bežiaci Postgres a VAPID kľúče v env — bez nich sa
 * push joby neenqueujú a časť testov by bola no-op):
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… bun scripts/test-notifications.ts
 *
 * Pokrýva: in-app notifikácie (zoznam, read, WS event), push subscriptions
 * (upsert/unsubscribe), preferencie, push fan-out pri chat správe (offline
 * vs online vs muted vs vypnutý kind) a mechaniku job queue (claim, complete,
 * fail + backoff, poradie).
 */
import { and, eq, sql as dsqlOp } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { jobs, pushSubs, roomMembers, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { notifyUsers } from '../src/modules/notifications/service';
import { claimNextJob, completeJob, enqueueJob, failJob } from '../src/core/jobs/queue';
import { pushEnabled } from '../src/config/env';
import type { ServerWsEvent } from '@rodinna/shared-types';

const PORT = 31989;
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

async function http(token: string | null, method: string, path: string, body?: unknown) {
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
  return { ws, events, opened, waitFor, close: () => ws.close() };
}

async function seedUser(email: string, displayName: string, role: 'admin' | 'member') {
  const ph = await hashPassword('Heslo12345');
  const inserted = await db.insert(users).values({ email, displayName, passwordHash: ph, role }).returning();
  const u = inserted[0]!;
  const { token } = await createSession(u.id);
  return { id: u.id, displayName, token };
}

async function pendingPushJobs() {
  return db.select().from(jobs).where(and(eq(jobs.kind, 'push.send'), eq(jobs.status, 'pending')));
}

async function clearJobs() {
  await db.execute(dsql`truncate table jobs`);
}

/** Krátka pauza na fire-and-forget notifyNewMessage po POST správy. */
const settle = () => Bun.sleep(150);

async function main() {
  if (!pushEnabled) {
    console.error('⚠ VAPID kľúče nie sú v env — spusti s VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.');
    process.exit(1);
  }

  await runMigrations();
  await db.execute(
    dsql`truncate table jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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
  await startWsBridge();

  const alica = await seedUser('alica@rodina.sk', 'Alica', 'admin');
  const bob = await seedUser('bob@rodina.sk', 'Bob', 'member');

  console.log('\n— Push subscriptions —');
  let r = await http(bob.token, 'GET', '/api/notifications/push/key');
  check('VAPID public key sa vracia', r.status === 200 && typeof r.body.publicKey === 'string' && r.body.publicKey.length > 20, r.body);

  const subInput = {
    endpoint: 'https://push.example.com/sub-bob',
    keys: { p256dh: 'BFakeP256dh', auth: 'FakeAuth' },
    deviceLabel: 'test-device',
  };
  r = await http(bob.token, 'POST', '/api/notifications/push/subscriptions', subInput);
  check('subscribe → 201', r.status === 201, r.body);
  r = await http(bob.token, 'POST', '/api/notifications/push/subscriptions', subInput);
  check('re-subscribe (upsert) → 201, bez duplicity', r.status === 201, r.body);
  let subRows = await db.select().from(pushSubs);
  check('v DB je 1 subscription', subRows.length === 1, subRows.length);

  r = await http(bob.token, 'POST', '/api/notifications/push/subscriptions', { endpoint: 'nie-url', keys: { p256dh: 'x', auth: 'y' } });
  check('nevalidný endpoint → 400', r.status === 400, r.status);

  console.log('\n— Preferencie —');
  r = await http(bob.token, 'GET', '/api/notifications/prefs');
  check('default prefs prázdne (= všetko zapnuté)', r.status === 200 && Object.keys(r.body.prefs).length === 0, r.body);
  r = await http(bob.token, 'PUT', '/api/notifications/prefs', { 'chat.message': false });
  check('vypnutie chat.message', r.status === 200 && r.body.prefs['chat.message'] === false, r.body);

  console.log('\n— Push fan-out pri chat správe —');
  r = await http(alica.token, 'POST', '/api/chat/rooms', { kind: 'dm', memberIds: [bob.id] });
  const dmId = r.body.id;

  await clearJobs();
  await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: 'Vypnutý kind' });
  await settle();
  check('vypnutý kind → žiadny push job', (await pendingPushJobs()).length === 0);

  await http(bob.token, 'PUT', '/api/notifications/prefs', { 'chat.message': true });
  await clearJobs();
  await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: 'Ahoj offline Bob!' });
  await settle();
  let jobRows = await pendingPushJobs();
  check('offline príjemca → 1 push job', jobRows.length === 1, jobRows.length);
  const payload = jobRows[0]?.payload as any;
  check('job má bobove id', payload?.userIds?.length === 1 && payload.userIds[0] === bob.id, payload);
  check('DM titulok = meno odosielateľa', payload?.notification?.title === 'Alica', payload?.notification);
  check('tag = roomId (zoskupovanie)', payload?.notification?.tag === dmId, payload?.notification);
  check('url vedie do miestnosti', payload?.notification?.url === `/?room=${dmId}`, payload?.notification);

  // Bob online cez WS → push sa neposiela.
  const bobWs = connectWs(bob.token);
  await bobWs.opened;
  await bobWs.waitFor((e) => e.t === 'ready');
  await clearJobs();
  await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: 'Bob je online' });
  await settle();
  check('online príjemca → žiadny push job', (await pendingPushJobs()).length === 0);
  bobWs.close();
  await Bun.sleep(100);

  // Stlmená miestnosť → žiadny push.
  await db
    .update(roomMembers)
    .set({ mutedUntil: new Date(Date.now() + 60 * 60 * 1000) })
    .where(and(eq(roomMembers.roomId, dmId), eq(roomMembers.userId, bob.id)));
  await clearJobs();
  await http(alica.token, 'POST', `/api/chat/rooms/${dmId}/messages`, { bodyMd: 'Stlmené' });
  await settle();
  check('stlmená miestnosť → žiadny push job', (await pendingPushJobs()).length === 0);
  await db
    .update(roomMembers)
    .set({ mutedUntil: null })
    .where(and(eq(roomMembers.roomId, dmId), eq(roomMembers.userId, bob.id)));

  // Skupinová/rodinná miestnosť → titulok „Meno · Miestnosť".
  r = await http(alica.token, 'GET', '/api/chat/rooms');
  const familyId = r.body.rooms.find((x: any) => x.kind === 'family')?.id;
  await clearJobs();
  await http(alica.token, 'POST', `/api/chat/rooms/${familyId}/messages`, { bodyMd: 'Rodinná správa' });
  await settle();
  jobRows = await pendingPushJobs();
  check('rodinný titulok „Alica · Rodina"', (jobRows[0]?.payload as any)?.notification?.title === 'Alica · Rodina', jobRows[0]?.payload);

  console.log('\n— In-app notifikácie (notifyUsers) —');
  const bobWs2 = connectWs(bob.token);
  await bobWs2.opened;
  await notifyUsers([bob.id], 'chat.message', { title: 'Test', body: 'In-app', url: '/x' });
  const evt = await bobWs2.waitFor((e) => e.t === 'notification:new');
  check('WS event notification:new dorazil', evt.t === 'notification:new' && (evt as any).notification.payload.title === 'Test', evt);
  bobWs2.close();

  r = await http(bob.token, 'GET', '/api/notifications');
  check('zoznam má 1 notifikáciu, unread 1', r.status === 200 && r.body.notifications.length === 1 && r.body.unreadCount === 1, r.body);
  r = await http(bob.token, 'POST', '/api/notifications/read', {});
  check('read-all → unread 0', r.status === 200 && r.body.unreadCount === 0, r.body);
  r = await http(alica.token, 'GET', '/api/notifications');
  check('alica cudziu notifikáciu nevidí', r.body.notifications.length === 0, r.body);

  console.log('\n— Job queue mechanika —');
  await clearJobs();
  const j1 = await enqueueJob('test.job', { n: 1 });
  await Bun.sleep(5);
  await enqueueJob('test.job', { n: 2 });
  const claimed = await claimNextJob();
  check('claim vráti najstarší job', claimed?.id === j1 && (claimed?.payload as any)?.n === 1, claimed?.payload);
  check('claim nastaví running + attempts=1', claimed?.status === 'running' && claimed?.attempts === 1, claimed);
  await completeJob(claimed!.id);
  const doneRow = await db.select().from(jobs).where(eq(jobs.id, claimed!.id));
  check('complete → done', doneRow[0]?.status === 'done', doneRow[0]?.status);

  const claimed2 = await claimNextJob();
  check('druhý claim vráti druhý job', (claimed2?.payload as any)?.n === 2, claimed2?.payload);
  await failJob(claimed2!, new Error('umelé zlyhanie'));
  let failRow = (await db.select().from(jobs).where(eq(jobs.id, claimed2!.id)))[0]!;
  check('fail s pokusmi < max → pending s backoffom', failRow.status === 'pending' && failRow.runAt.getTime() > Date.now(), failRow.status);
  check('lastError uložený', failRow.lastError?.includes('umelé') === true, failRow.lastError);
  const claimed3 = await claimNextJob();
  check('backoff job sa hneď neclaimne', claimed3 === null, claimed3?.id);

  await db.update(jobs).set({ attempts: 3 }).where(eq(jobs.id, claimed2!.id));
  await failJob({ ...claimed2!, attempts: 3 }, new Error('finálne zlyhanie'));
  failRow = (await db.select().from(jobs).where(eq(jobs.id, claimed2!.id)))[0]!;
  check('fail po vyčerpaní pokusov → failed', failRow.status === 'failed', failRow.status);

  console.log('\n— Odhlásenie zariadenia —');
  r = await http(bob.token, 'POST', '/api/notifications/push/unsubscribe', { endpoint: subInput.endpoint });
  check('unsubscribe → ok', r.status === 200, r.body);
  subRows = await db.select().from(pushSubs);
  check('subscription zmizla z DB', subRows.length === 0, subRows.length);

  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
