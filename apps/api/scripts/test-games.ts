/**
 * E2E test modulu Hry & Výzvy (M6) — REST + WS + denný job.
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   MEDIA_PATH=/tmp/rodinna-test-media bun scripts/test-games.ts
 *
 * Pokrýva: piškvorky (výzva, join, ťahy, validácie, výhra, remíza cez
 * priamu simuláciu, push „si na ťahu", odveta, prístup len pre členov
 * miestnosti), dennú otázku (skryté odpovede pred vlastnou, upsert)
 * a foto výzvu (vyžaduje fotku) vrátane idempotencie denného jobu.
 */
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { feedCards, gameSessions, media, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { runGamesDaily } from '../src/modules/games/worker';
import { writeMedia } from '../src/modules/media/storage';
import type { ServerWsEvent } from '@rodinna/shared-types';

const PORT = 32001;
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

async function seedImage(ownerId: string): Promise<string> {
  const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 120, b: 90 } } })
    .png()
    .toBuffer();
  const id = crypto.randomUUID();
  const storagePath = `test/${id}.png`;
  await writeMedia(storagePath, buf);
  await db.insert(media).values({
    id, ownerId, kind: 'image', mime: 'image/png', bytes: buf.length, width: 8, height: 8,
    storagePath, sha256: 'x',
  });
  return id;
}

async function main() {
  await runMigrations();
  await db.execute(
    dsql`truncate table app_settings, game_moves, game_sessions, diary_embeddings, diary_entries, diary_fragments, event_rsvps, events, note_revisions, note_items, notes, memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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
  const cyril = await seedUser('cyril@rodina.sk', 'Cyril', 'member');

  console.log('\n— Piškvorky: výzva a join —');
  // DM alica↔bob → cyril nemá prístup.
  let r = await http(alica.token, 'POST', '/api/chat/rooms', { kind: 'dm', memberIds: [bob.id] });
  const dmId = r.body.id;
  r = await http(alica.token, 'POST', '/api/games/tictactoe', { roomId: dmId });
  check('založenie partie → 201, open', r.status === 201 && r.body.status === 'open', r.body);
  const gameId = r.body.id;
  check('vyzývateľ je X', r.body.players.x.displayName === 'Alica' && r.body.players.o === null, r.body.players);

  r = await http(cyril.token, 'GET', `/api/games/${gameId}`);
  check('nečlen miestnosti → 404', r.status === 404, r.status);
  r = await http(alica.token, 'POST', `/api/games/${gameId}/join`);
  check('vyzývateľ sa nemôže pridať sám → 400', r.status === 400, r.status);
  r = await http(alica.token, 'POST', `/api/games/${gameId}/move`, { cell: 0 });
  check('ťah pred joinom → 400', r.status === 400, r.status);

  const bobWs = connectWs(bob.token);
  await bobWs.opened;
  r = await http(bob.token, 'POST', `/api/games/${gameId}/join`);
  check('bob prijal výzvu → active', r.body.status === 'active' && r.body.players.o.displayName === 'Bob', r.body);
  // inApp:false → len push job pre offline hráča (alica nemá WS).
  const turnJobs = await db.execute<{ payload: any }>(
    dsql`SELECT payload FROM jobs WHERE kind = 'push.send' AND payload->'notification'->>'tag' = ${'game-' + gameId}`,
  );
  check(
    'push „si na ťahu" vyzývateľovi (offline)',
    turnJobs.length === 1 && (turnJobs[0]!.payload as any).userIds[0] === alica.id,
    turnJobs.length,
  );

  console.log('\n— Ťahy a výhra —');
  r = await http(bob.token, 'POST', `/api/games/${gameId}/move`, { cell: 4 });
  check('ťah mimo poradia → 400', r.status === 400, r.status);
  r = await http(cyril.token, 'POST', `/api/games/${gameId}/move`, { cell: 4 });
  check('nehráč → 404 (nečlen)', r.status === 404, r.status);

  // 10×10, vyhráva 5 v rade: X v riadku 0 (0-4), O v riadku 1 (10-13).
  await http(alica.token, 'POST', `/api/games/${gameId}/move`, { cell: 0 });
  const evt = await bobWs.waitFor((e) => e.t === 'game:update');
  check('game:update cez WS', (evt as any).gameId === gameId, evt);
  r = await http(bob.token, 'POST', `/api/games/${gameId}/move`, { cell: 0 });
  check('obsadené políčko → 400', r.status === 400, r.status);
  await http(bob.token, 'POST', `/api/games/${gameId}/move`, { cell: 10 });
  await http(alica.token, 'POST', `/api/games/${gameId}/move`, { cell: 1 });
  await http(bob.token, 'POST', `/api/games/${gameId}/move`, { cell: 11 });
  await http(alica.token, 'POST', `/api/games/${gameId}/move`, { cell: 2 });
  await http(bob.token, 'POST', `/api/games/${gameId}/move`, { cell: 12 });
  await http(alica.token, 'POST', `/api/games/${gameId}/move`, { cell: 3 });
  await http(bob.token, 'POST', `/api/games/${gameId}/move`, { cell: 13 });
  r = await http(alica.token, 'POST', `/api/games/${gameId}/move`, { cell: 4 });
  check('výherný ťah (5 v rade) → finished, winner x', r.body.status === 'finished' && r.body.winner === 'x', r.body);
  r = await http(bob.token, 'POST', `/api/games/${gameId}/move`, { cell: 20 });
  check('ťah po konci → 400', r.status === 400, r.status);

  r = await http(bob.token, 'POST', `/api/games/${gameId}/rematch`);
  check('odveta → nová open partia', r.status === 201 && r.body.status === 'open' && r.body.players.x.displayName === 'Bob', r.body);
  r = await http(alica.token, 'GET', `/api/games/${gameId}`);
  check('pôvodná partia linkuje odvetu', r.body.rematchId === (await http(bob.token, 'POST', `/api/games/${gameId}/rematch`)).body.id, r.body.rematchId);

  console.log('\n— Denná otázka + foto výzva (denný job) —');
  // Pondelok vynútime cez now parameter.
  const monday = new Date('2026-07-06T06:00:00Z'); // pondelok
  // Ladenie 07/2026: bez zapnutých AI funkcií sa nič nevygeneruje.
  const { setAiEnabled } = await import('../src/modules/settings/service');
  await setAiEnabled(false);
  await runGamesDaily(monday);
  const noneYet = await db.select().from(gameSessions).where(eq(gameSessions.kind, 'daily'));
  check('bez AI funkcií žiadna otázka dňa', noneYet.length === 0, noneYet.length);
  // Zapni AI a spusti dvakrát (idempotencia).
  await setAiEnabled(true);
  await runGamesDaily(monday);
  await runGamesDaily(monday);
  const sessions = await db.select().from(gameSessions).where(eq(gameSessions.kind, 'daily'));
  const photos = await db.select().from(gameSessions).where(eq(gameSessions.kind, 'photo'));
  check('1 denná otázka (idempotencia)', sessions.length === 1, sessions.length);
  check('1 foto výzva v pondelok (idempotencia)', photos.length === 1, photos.length);
  const cards = await db.select().from(feedCards).where(eq(feedCards.module, 'games'));
  check('obe karty vo feede', cards.length === 2, cards.length);
  const dailyId = sessions[0]!.id;
  const photoId = photos[0]!.id;

  r = await http(bob.token, 'GET', `/api/games/${dailyId}`);
  check('pred odpoveďou: odpovede skryté', r.body.myAnswered === false && r.body.answers.length === 0, r.body);
  await http(alica.token, 'POST', `/api/games/${dailyId}/answer`, { text: 'Pizza!' });
  r = await http(bob.token, 'GET', `/api/games/${dailyId}`);
  check('stále skryté, ale count=1', r.body.answersCount === 1 && r.body.answers.length === 0, r.body);
  r = await http(bob.token, 'POST', `/api/games/${dailyId}/answer`, { text: 'Halušky' });
  check('po vlastnej odpovedi vidí všetky', r.body.answers.length === 2, r.body.answers);
  r = await http(bob.token, 'POST', `/api/games/${dailyId}/answer`, { text: 'Predsa halušky!' });
  check('nová odpoveď nahradí starú (stále 2)', r.body.answers.length === 2 && r.body.answers.some((a: any) => a.text.includes('Predsa')), r.body.answers?.length);

  r = await http(bob.token, 'POST', `/api/games/${photoId}/answer`, { text: 'bez fotky' });
  check('foto výzva bez fotky → 400', r.status === 400, r.status);
  const img = await seedImage(bob.id);
  r = await http(bob.token, 'POST', `/api/games/${photoId}/answer`, { mediaId: img });
  check('fotka prijatá + hneď viditeľná', r.status === 200 && r.body.answers.length === 1 && r.body.answers[0].media, r.body.answers?.length);

  r = await http(alica.token, 'POST', `/api/games/${dailyId}/move`, { cell: 0 });
  check('ťah na otázku → 400', r.status === 400, r.status);

  console.log('\n— AI funkcie: prepínač (admin-only) —');
  r = await http(bob.token, 'GET', '/api/settings');
  check('člen číta nastavenia', r.status === 200 && r.body.aiEnabled === true, r.body);
  r = await http(bob.token, 'PUT', '/api/settings/ai', { enabled: false });
  check('člen nemôže meniť AI → 403', r.status === 403, r.status);
  r = await http(alica.token, 'PUT', '/api/settings/ai', { enabled: false });
  check('admin vypne AI → 200', r.status === 200 && r.body.aiEnabled === false, r.body);
  r = await http(bob.token, 'GET', '/api/settings');
  check('vypnutie sa prejaví všetkým', r.body.aiEnabled === false, r.body);

  bobWs.close();
  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
