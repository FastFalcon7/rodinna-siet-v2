/**
 * E2E test modulu Feed — posty, komentáre (vrátane príloh, ladenie 07/2026
 * bod 3) a reakcie (1 reakcia/user: replace + unreact).
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   MEDIA_PATH=/tmp/rodinna-test-media bun scripts/test-feed.ts
 */
import sharp from 'sharp';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { media, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { writeMedia } from '../src/modules/media/storage';

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

async function seedUser(email: string, displayName: string, role: 'admin' | 'member') {
  const ph = await hashPassword('Heslo12345');
  const inserted = await db.insert(users).values({ email, displayName, passwordHash: ph, role }).returning();
  const u = inserted[0]!;
  const { token } = await createSession(u.id);
  return { id: u.id, displayName, token };
}

/** Reálny malý PNG na disku + media riadok. */
async function seedImage(ownerId: string): Promise<string> {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 60, g: 120, b: 200 } },
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
  });
  return id;
}

async function main() {
  await runMigrations();
  await db.execute(
    dsql`truncate table comment_media, memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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

  console.log('\n— Posty —');
  let r = await http(alica.token, 'POST', '/api/feed', { bodyMd: '', mediaIds: [] });
  check('prázdny post → 400', r.status === 400, r.status);

  const p1 = await seedImage(alica.id);
  const p2 = await seedImage(alica.id);
  r = await http(alica.token, 'POST', '/api/feed', { bodyMd: 'Ahoj rodina!', mediaIds: [p1, p2] });
  check('post s 2 fotkami → 201', r.status === 201 && r.body.media?.length === 2, r.body.media?.length);
  const postId = r.body.id;

  const cudzia = await seedImage(bob.id);
  r = await http(alica.token, 'POST', '/api/feed', { bodyMd: 'X', mediaIds: [cudzia] });
  check('cudzie médium v poste → 403', r.status === 403, r.status);

  console.log('\n— Komentáre s prílohami (bod 3) —');
  r = await http(bob.token, 'POST', `/api/feed/${postId}/comments`, { bodyMd: '', mediaIds: [] });
  check('prázdny komentár → 400', r.status === 400, r.status);

  const c1 = await seedImage(bob.id);
  r = await http(bob.token, 'POST', `/api/feed/${postId}/comments`, { bodyMd: '', mediaIds: [c1] });
  check('komentár len s fotkou (bez textu) → 201', r.status === 201, r.status);
  check('komentár nesie media', r.body.media?.length === 1 && r.body.media[0].id === c1, r.body.media);
  const commentId = r.body.id;

  r = await http(bob.token, 'POST', `/api/feed/${postId}/comments`, { bodyMd: 'Krása!', mediaIds: [p1] });
  check('cudzie médium v komentári → 403', r.status === 403, r.status);

  const c2 = await seedImage(alica.id);
  r = await http(alica.token, 'POST', `/api/feed/${postId}/comments`, {
    bodyMd: 'Odpoveď s fotkou',
    parentCommentId: commentId,
    mediaIds: [c2],
  });
  check('odpoveď s fotkou → 201 (depth 1)', r.status === 201 && r.body.depth === 1, r.body.depth);

  r = await http(alica.token, 'GET', `/api/feed/${postId}/comments`);
  const withMedia = r.body.comments?.filter((c: any) => c.media?.length === 1);
  check('listComments hydratuje media', r.body.comments?.length === 2 && withMedia?.length === 2, r.body.comments);

  console.log('\n— Reakcie: 1 na osobu (bod 2) —');
  r = await http(bob.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '❤️' });
  check('❤️ → count 1, reactedByMe', r.body.reactions?.[0]?.emoji === '❤️' && r.body.reactions[0].reactedByMe, r.body.reactions);
  r = await http(bob.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '😂' });
  check(
    '😂 nahradí ❤️ (stále 1 reakcia)',
    r.body.reactions?.length === 1 && r.body.reactions[0].emoji === '😂',
    r.body.reactions,
  );
  r = await http(alica.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '😂' });
  check('druhý user rovnaká emoji → count 2', r.body.reactions?.[0]?.count === 2, r.body.reactions);
  r = await http(bob.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '😂' });
  check('rovnaká emoji = unreact → count 1', r.body.reactions?.[0]?.count === 1, r.body.reactions);

  console.log('\n— Mazanie —');
  r = await http(bob.token, 'DELETE', `/api/feed/${postId}`);
  check('post zmaže len autor/admin → 403', r.status === 403, r.status);
  r = await http(alica.token, 'DELETE', `/api/feed/${postId}`);
  check('autor zmazal post → 204', r.status === 204, r.status);
  r = await http(bob.token, 'GET', `/api/feed/${postId}/comments`);
  check('komentáre zmazaného postu → 404', r.status === 404, r.status);

  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
