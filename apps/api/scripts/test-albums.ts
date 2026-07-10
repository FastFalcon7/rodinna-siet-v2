/**
 * E2E test modulu Albumy + Spomienky (M2) — REST proti živému serveru a Postgresu.
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   MEDIA_PATH=/tmp/rodinna-test-media bun scripts/test-albums.ts
 *
 * Pokrýva: CRUD albumov + feed kartu, pridávanie/odoberanie fotiek s právami,
 * obálku, Zberač (návrh z fotiek jedného dňa v chate + zánik po vytvorení),
 * spomienky (denný výber, yearsAgo, skrytie) a ZIP download (reálne PK entry).
 */
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { feedCards, media, memoryMarks, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { createTodaysMemory } from '../src/modules/albums/service';
import { writeMedia } from '../src/modules/media/storage';

const PORT = 31993;
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

async function seedUser(email: string, displayName: string, role: 'admin' | 'member') {
  const ph = await hashPassword('Heslo12345');
  const inserted = await db.insert(users).values({ email, displayName, passwordHash: ph, role }).returning();
  const u = inserted[0]!;
  const { token } = await createSession(u.id);
  return { id: u.id, displayName, token };
}

/** Reálny malý PNG na disku + media riadok (voliteľne s posunutým created_at). */
async function seedImage(ownerId: string, createdAt?: Date): Promise<string> {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 80, b: 60 } },
  })
    .png()
    .toBuffer();
  const id = crypto.randomUUID();
  const storagePath = `test/${id}.png`;
  await writeMedia(storagePath, buf);
  await db.insert(media).values({
    id,
    ownerId,
    kind: 'image',
    mime: 'image/png',
    bytes: buf.length,
    width: 8,
    height: 8,
    storagePath,
    sha256: 'x',
    ...(createdAt ? { createdAt } : {}),
  });
  return id;
}

async function main() {
  await runMigrations();
  await db.execute(
    dsql`truncate table memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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

  console.log('\n— Album CRUD + feed karta —');
  let r = await http(alica.token, 'POST', '/api/albums', { title: '  ', mediaIds: [] });
  check('prázdny názov → 400', r.status === 400, r.status);

  r = await http(alica.token, 'POST', '/api/albums', { title: 'Leto 2026', mediaIds: [] });
  check('vytvorenie albumu → 201', r.status === 201 && r.body.title === 'Leto 2026', r.body);
  const albumId = r.body.id;

  // Ladenie 07/2026 (bod 7): albumy do Feedu nejdú — prístup len cez časť Albumy.
  r = await http(bob.token, 'GET', '/api/feed');
  check(
    'album BEZ feed karty (bod 7)',
    !r.body.items?.some((it: any) => it.type === 'card' && it.card.module === 'albums' && it.card.entityId === albumId),
    r.body.items?.length,
  );

  const p1 = await seedImage(alica.id);
  const p2 = await seedImage(alica.id);
  const p3 = await seedImage(bob.id);

  r = await http(alica.token, 'POST', `/api/albums/${albumId}/photos`, { mediaIds: [p1, p2] });
  check('alica pridá 2 fotky', r.status === 200 && r.body.photoCount === 2, r.body.photoCount);
  r = await http(bob.token, 'POST', `/api/albums/${albumId}/photos`, { mediaIds: [p2, p3] });
  check('bob pridá (p2 dedupe, p3 nová) → 3', r.body.photoCount === 3, r.body.photoCount);
  check('obálka = najnovšia fotka', r.body.cover?.id === p3, r.body.cover?.id);

  r = await http(bob.token, 'PATCH', `/api/albums/${albumId}`, { coverMediaId: p1 });
  check('obálku mení len autor/admin → 403', r.status === 403, r.status);
  r = await http(alica.token, 'PATCH', `/api/albums/${albumId}`, { coverMediaId: p1 });
  check('explicitná obálka', r.status === 200 && r.body.cover?.id === p1, r.body.cover?.id);
  const foreign = await seedImage(cyril.id);
  r = await http(alica.token, 'PATCH', `/api/albums/${albumId}`, { coverMediaId: foreign });
  check('obálka mimo albumu → 400', r.status === 400, r.status);

  console.log('\n— Práva na fotky —');
  r = await http(cyril.token, 'DELETE', `/api/albums/${albumId}/photos/${p1}`);
  check('cudziu fotku nezmaže tretí člen → 403', r.status === 403, r.status);
  r = await http(bob.token, 'DELETE', `/api/albums/${albumId}/photos/${p3}`);
  check('kto pridal, môže odstrániť → 204', r.status === 204, r.status);
  r = await http(alica.token, 'GET', `/api/albums/${albumId}`);
  check('po odstránení 2 fotky', r.body.photoCount === 2, r.body.photoCount);

  console.log('\n— ZIP download —');
  const zipRes = await fetch(`${BASE}/api/albums/${albumId}/download`, {
    headers: { cookie: `rs_session=${bob.token}` },
  });
  const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
  check('ZIP → 200 + content-type', zipRes.status === 200 && zipRes.headers.get('content-type') === 'application/zip');
  check('ZIP magic PK', zipBuf[0] === 0x50 && zipBuf[1] === 0x4b, zipBuf.slice(0, 4));
  const entries = unzipSync(zipBuf);
  check('ZIP má 2 fotky s obsahom', Object.keys(entries).length === 2 && Object.values(entries).every((e) => e.length > 0), Object.keys(entries));

  console.log('\n— Zberač (suggestions) —');
  // 6 fotiek poslaných do rodinného chatu dnes (cez API → vzniknú message_media).
  r = await http(alica.token, 'GET', '/api/chat/rooms');
  const familyId = r.body.rooms.find((x: any) => x.kind === 'family')?.id;
  const chatPhotos: string[] = [];
  for (let i = 0; i < 6; i++) chatPhotos.push(await seedImage(alica.id));
  r = await http(alica.token, 'POST', `/api/chat/rooms/${familyId}/messages`, { bodyMd: 'fotky', mediaIds: chatPhotos });
  check('správa so 6 fotkami poslaná', r.status === 201, r.status);

  r = await http(bob.token, 'GET', '/api/albums/suggestions');
  const sug = r.body.suggestions?.[0];
  check('Zberač navrhne album (6 fotiek dnes)', sug?.count === 6 && sug?.mediaIds.length === 6, r.body);
  check('návrh má náhľady', sug?.previews.length === 4, sug?.previews?.length);

  r = await http(bob.token, 'POST', '/api/albums', { title: 'Výlet', mediaIds: sug.mediaIds });
  check('album zo Zberača → 201', r.status === 201 && r.body.photoCount === 6, r.body.photoCount);
  r = await http(bob.token, 'GET', '/api/albums/suggestions');
  check('po vytvorení návrh zmizne', r.body.suggestions.length === 0, r.body.suggestions);

  console.log('\n— Spomienky („Na tento deň") —');
  const yearAgo = new Date();
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const memPhoto = await seedImage(alica.id, yearAgo);

  const picked = await createTodaysMemory();
  check('denný job vybral fotku spred roka', picked === memPhoto, picked);
  const memCards = await db
    .select()
    .from(feedCards)
    .where(and(eq(feedCards.module, 'memories'), eq(feedCards.entityId, memPhoto)));
  check('spomienková karta vo feede', memCards.length === 1, memCards.length);
  const again = await createTodaysMemory();
  check('idempotencia (unique karta, žiadny ďalší kandidát)', again === null, again);

  r = await http(bob.token, 'GET', `/api/albums/memories/${memPhoto}`);
  check('GET memory: yearsAgo=1 + vlastník', r.body.yearsAgo === 1 && r.body.owner.displayName === 'Alica', r.body);

  r = await http(bob.token, 'POST', `/api/albums/memories/${memPhoto}/hide`);
  check('skrytie spomienky → ok', r.status === 200, r.status);
  const marks = await db.select().from(memoryMarks).where(eq(memoryMarks.mediaId, memPhoto));
  check('memory_marks zapísané', marks.length === 1 && marks[0]!.hiddenBy === bob.id, marks);
  const afterHide = await db
    .select()
    .from(feedCards)
    .where(and(eq(feedCards.module, 'memories'), eq(feedCards.entityId, memPhoto)));
  check('karta z feedu zmizla', afterHide.length === 0, afterHide.length);
  check('skrytá fotka sa už nevyberie', (await createTodaysMemory()) === null);

  console.log('\n— Zmazanie albumu —');
  r = await http(cyril.token, 'DELETE', `/api/albums/${albumId}`);
  check('zmaže len autor/admin → 403', r.status === 403, r.status);
  r = await http(alica.token, 'DELETE', `/api/albums/${albumId}`);
  check('autor zmaže → 204', r.status === 204, r.status);
  const cardAfter = await db
    .select()
    .from(feedCards)
    .where(and(eq(feedCards.module, 'albums'), eq(feedCards.entityId, albumId)));
  check('feed karta albumu odstránená', cardAfter.length === 0, cardAfter.length);
  const mediaStill = await db.select({ id: media.id }).from(media).where(eq(media.id, p1));
  check('fotky (media) prežili zmazanie albumu', mediaStill.length === 1);

  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
