/**
 * E2E test modulu Ankety (M1) — REST + WS proti živému serveru a Postgresu.
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… bun scripts/test-polls.ts
 *
 * Pokrýva: tvorbu (validácie, feed karta, auto-close job), hlasovanie
 * (single replace, multi toggle, unvote, uzavretá anketa), anonymitu,
 * WS event poll:update, uzavretie (autor/cudzí, notifikácie polls.closed),
 * closeByDeadline a feed UNION pagináciu postov a kariet.
 */
import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { jobs, notifications } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { closeByDeadline } from '../src/modules/polls/service';
import { users } from '../src/core/db/schema';
import type { ServerWsEvent } from '@rodinna/shared-types';

const PORT = 31991;
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

async function main() {
  await runMigrations();
  await db.execute(
    dsql`truncate table poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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

  console.log('\n— Tvorba ankety —');
  let r = await http(alica.token, 'POST', '/api/polls', { question: 'X', options: ['iba jedna'] });
  check('1 možnosť → 400', r.status === 400, r.status);
  r = await http(alica.token, 'POST', '/api/polls', {
    question: 'X',
    options: ['a', 'b'],
    closesAt: new Date(Date.now() - 1000).toISOString(),
  });
  check('deadline v minulosti → 400', r.status === 400, r.body);

  r = await http(alica.token, 'POST', '/api/polls', {
    question: 'Kde bude nedeľný obed?',
    options: ['U nás', 'U babky', 'Reštaurácia'],
    toFeed: true,
  });
  check('vytvorenie ankety → 201', r.status === 201 && r.body.options.length === 3, r.body);
  const pollId = r.body.id;
  check('nová anketa je otvorená, 0 hlasov', r.body.closed === false && r.body.totalVoters === 0, r.body);

  r = await http(bob.token, 'GET', '/api/feed');
  const cardItem = r.body.items?.find((it: any) => it.type === 'card');
  check('karta ankety je vo feede (K1)', cardItem?.card.module === 'polls' && cardItem?.card.entityId === pollId, r.body.items);
  check('karta má autora', cardItem?.card.author.displayName === 'Alica', cardItem?.card);

  console.log('\n— Hlasovanie (single) —');
  r = await http(bob.token, 'GET', `/api/polls/${pollId}`);
  const [opt1, opt2] = r.body.options;

  const alicaWs = connectWs(alica.token);
  await alicaWs.opened;

  r = await http(bob.token, 'PUT', `/api/polls/${pollId}/vote`, { optionIds: [opt1.id] });
  check('bob hlasuje za 1. možnosť', r.status === 200 && r.body.options[0].votes === 1 && r.body.options[0].votedByMe, r.body.options);
  check('voters obsahuje Boba (neanonymná)', r.body.options[0].voters[0]?.displayName === 'Bob', r.body.options[0]);

  const evt = await alicaWs.waitFor((e) => e.t === 'poll:update');
  check('alica dostala poll:update cez WS', (evt as any).pollId === pollId, evt);

  r = await http(bob.token, 'PUT', `/api/polls/${pollId}/vote`, { optionIds: [opt1.id, opt2.id] });
  check('2 možnosti v single ankete → 400', r.status === 400, r.status);

  r = await http(bob.token, 'PUT', `/api/polls/${pollId}/vote`, { optionIds: [opt2.id] });
  check('zmena hlasu (replace)', r.body.options[0].votes === 0 && r.body.options[1].votes === 1, r.body.options);

  r = await http(bob.token, 'PUT', `/api/polls/${pollId}/vote`, { optionIds: [] });
  check('stiahnutie hlasu ([])', r.body.totalVoters === 0, r.body.totalVoters);

  r = await http(bob.token, 'PUT', `/api/polls/${pollId}/vote`, { optionIds: ['00000000-0000-0000-0000-000000000000'] });
  check('cudzia možnosť → 400', r.status === 400, r.status);

  console.log('\n— Multi + anonymná —');
  r = await http(alica.token, 'POST', '/api/polls', {
    question: 'Čo baliť na výlet?',
    kind: 'multi',
    anonymous: true,
    options: ['Stan', 'Spacák', 'Gitara'],
  });
  const multiId = r.body.id;
  const mOpts = r.body.options;
  r = await http(bob.token, 'PUT', `/api/polls/${multiId}/vote`, { optionIds: [mOpts[0].id, mOpts[2].id] });
  check('multi: 2 hlasy naraz', r.body.options[0].votes === 1 && r.body.options[2].votes === 1 && r.body.totalVoters === 1, r.body.options);
  check('anonymná: voters prázdne', r.body.options[0].voters.length === 0, r.body.options[0]);

  console.log('\n— Uzavretie —');
  r = await http(bob.token, 'POST', `/api/polls/${pollId}/close`);
  check('uzavrieť môže len autor → 403', r.status === 403, r.status);

  await http(bob.token, 'PUT', `/api/polls/${pollId}/vote`, { optionIds: [opt1.id] });
  r = await http(alica.token, 'POST', `/api/polls/${pollId}/close`);
  check('autor uzavrel anketu', r.status === 200 && r.body.closed === true, r.body);

  r = await http(bob.token, 'PUT', `/api/polls/${pollId}/vote`, { optionIds: [opt2.id] });
  check('hlas po uzavretí → 403', r.status === 403, r.status);

  const notifRows = await db.select().from(notifications).where(eq(notifications.kind, 'polls.closed'));
  check('polls.closed notifikácie vytvorené (autor + hlasujúci)', notifRows.length === 2, notifRows.length);
  const bobNotif = notifRows.find((n) => n.userId === bob.id);
  check('notifikácia nesie víťaza', (bobNotif?.payload as any)?.body?.includes('U nás') === true, bobNotif?.payload);
  const pushJobs = await db.select().from(jobs).where(and(eq(jobs.kind, 'push.send'), eq(jobs.status, 'pending')));
  check('push job pre offline príjemcov', pushJobs.length >= 1, pushJobs.length);

  console.log('\n— Auto-close po deadline —');
  r = await http(alica.token, 'POST', '/api/polls', {
    question: 'Deadline test',
    options: ['a', 'b'],
    closesAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const dlId = r.body.id;
  const closeJobs = await db.select().from(jobs).where(eq(jobs.kind, 'polls.close'));
  check('polls.close job zaradený s runAt=deadline', closeJobs.some((j) => (j.payload as any).pollId === dlId && j.runAt.getTime() > Date.now()), closeJobs.length);
  await closeByDeadline(dlId);
  r = await http(alica.token, 'GET', `/api/polls/${dlId}`);
  check('closeByDeadline anketu uzavrel', r.body.closed === true, r.body);
  await closeByDeadline(dlId); // idempotentné — nesmie spadnúť ani duplikovať notifikácie
  const dlNotifs = await db.select().from(notifications).where(eq(notifications.kind, 'polls.closed'));
  check('closeByDeadline je idempotentné', dlNotifs.filter((n) => (n.payload as any).tag === `poll-${dlId}`).length <= 2, dlNotifs.length);

  console.log('\n— Feed UNION paginácia —');
  await http(alica.token, 'POST', '/api/feed', { bodyMd: 'post 1' });
  await http(alica.token, 'POST', '/api/feed', { bodyMd: 'post 2' });
  r = await http(bob.token, 'GET', '/api/feed?limit=2');
  check('prvá stránka má 2 najnovšie položky', r.body.items.length === 2 && r.body.nextCursor, {
    len: r.body.items?.length,
  });
  const seen = new Set<string>(r.body.items.map((it: any) => (it.type === 'post' ? it.post.id : it.card.id)));
  let cursor = r.body.nextCursor;
  let guard = 0;
  while (cursor && guard++ < 10) {
    r = await http(bob.token, 'GET', `/api/feed?limit=2&cursor=${encodeURIComponent(cursor)}`);
    for (const it of r.body.items) {
      const id = it.type === 'post' ? it.post.id : it.card.id;
      check(`bez duplicít (${id.slice(0, 8)})`, !seen.has(id));
      seen.add(id);
    }
    cursor = r.body.nextCursor;
  }
  // 2 posty + 1 feed karta (toFeed mala len prvá anketa)
  check('paginácia prešla všetky položky (3)', seen.size === 3, seen.size);

  alicaWs.close();
  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
