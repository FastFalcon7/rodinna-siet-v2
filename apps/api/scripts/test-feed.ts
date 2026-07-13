/**
 * E2E test modulu Feed — posty, komentáre (vrátane príloh, ladenie 07/2026
 * bod 3), reakcie (1 reakcia/user, žiadny self-react, agregát vlákna) a
 * video pipeline (upload → ffmpeg transkód na H.264 + poster → serve).
 *
 * Spustenie (vyžaduje ffmpeg/ffprobe v PATH):
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
import { transcodeVideo } from '../src/modules/media/worker';
import { initMediaUrlTokens } from '../src/modules/media/urlToken';

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
  await initMediaUrlTokens();
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
  const cyril = await seedUser('cyril@rodina.sk', 'Cyril', 'member');

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

  console.log('\n— Reakcie: 1 na osobu, žiadny self-react, agregát vlákna (bod 2) —');
  r = await http(alica.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '❤️' });
  check('autor na vlastný post → 403', r.status === 403, r.status);
  r = await http(bob.token, 'PUT', '/api/feed/reactions', { targetType: 'comment', targetId: commentId, emoji: '👍' });
  check('autor na vlastný komentár → 403', r.status === 403, r.status);

  r = await http(bob.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '❤️' });
  check('❤️ → count 1, reactedByMe', r.body.reactions?.[0]?.emoji === '❤️' && r.body.reactions[0].reactedByMe, r.body.reactions);
  r = await http(bob.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '😂' });
  check(
    '😂 nahradí ❤️ (stále 1 reakcia)',
    r.body.reactions?.length === 1 && r.body.reactions[0].emoji === '😂',
    r.body.reactions,
  );
  r = await http(cyril.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '😂' });
  check('druhý user rovnaká emoji → count 2', r.body.reactions?.[0]?.count === 2, r.body.reactions);
  r = await http(bob.token, 'PUT', '/api/feed/reactions', { targetType: 'post', targetId: postId, emoji: '😂' });
  check('rovnaká emoji = unreact → count 1', r.body.reactions?.[0]?.count === 1, r.body.reactions);

  // Agregát vlákna: reakcia na komentár sa počíta do počítadla pod postom.
  r = await http(alica.token, 'PUT', '/api/feed/reactions', { targetType: 'comment', targetId: commentId, emoji: '❤️' });
  check('reakcia na komentár → 200', r.status === 200, r.status);
  check('response nesie reakcie komentára', r.body.reactions?.[0]?.emoji === '❤️', r.body.reactions);
  const agg = r.body.postReactions as { emoji: string; count: number }[];
  check(
    'postReactions = agregát vlákna (😂 z postu + ❤️ z komentára)',
    agg?.some((x) => x.emoji === '😂' && x.count === 1) && agg?.some((x) => x.emoji === '❤️' && x.count === 1),
    agg,
  );
  r = await http(cyril.token, 'GET', '/api/feed');
  const fed = r.body.items?.find((it: any) => it.type === 'post' && it.post.id === postId)?.post;
  check(
    'GET /feed: reactions postu agregujú aj komentáre',
    fed?.reactions?.some((x: any) => x.emoji === '❤️' && x.count === 1),
    fed?.reactions,
  );

  console.log('\n— Video pipeline (upload → transkód → serve) —');
  // Vygeneruj malé "iPhone-like" video v ne-h264 kodeku (mpeg4 = transkód vetva).
  const srcVideo = '/tmp/rodinna-test-media/testsrc.mp4';
  const gen = Bun.spawn(
    ['ffmpeg', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-c:v', 'mpeg4', srcVideo],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  if ((await gen.exited) !== 0) throw new Error('ffmpeg generovanie test videa zlyhalo');

  const form = new FormData();
  form.set('file', new File([await Bun.file(srcVideo).arrayBuffer()], 'video.mp4', { type: 'video/mp4' }));
  const upRes = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: { cookie: `rs_session=${alica.token}` },
    body: form,
  });
  const uploaded = (await upRes.json()) as any;
  check('upload videa → 201 kind=video', upRes.status === 201 && uploaded.kind === 'video', uploaded);
  check('po uploade processing=true (čaká na transkód)', uploaded.processing === true, uploaded.processing);

  await transcodeVideo(uploaded.id);
  const vidRows = await db.select().from(media).where(dsql`${media.id} = ${uploaded.id}` as any);
  const vid = (vidRows as any[])[0];
  check('transkód done + playback/poster path', vid.transcodeStatus === 'done' && !!vid.playbackPath && !!vid.posterPath, vid.transcodeStatus);

  let mr = await fetch(`${BASE}/api/media/${uploaded.id}`, { headers: { cookie: `rs_session=${bob.token}` } });
  check('serve videa → 200 video/mp4 (normalizované)', mr.status === 200 && mr.headers.get('content-type') === 'video/mp4', mr.headers.get('content-type'));
  const full = (await mr.arrayBuffer()).byteLength;
  mr = await fetch(`${BASE}/api/media/${uploaded.id}`, {
    headers: { cookie: `rs_session=${bob.token}`, range: 'bytes=0-1' },
  });
  check(
    'range request (iOS) → 206, správna dĺžka',
    mr.status === 206 && mr.headers.get('content-range') === `bytes 0-1/${full}`,
    `${mr.status} ${mr.headers.get('content-range')}`,
  );
  mr = await fetch(`${BASE}/api/media/${uploaded.id}/poster`, { headers: { cookie: `rs_session=${bob.token}` } });
  check('poster → 200 image/jpeg', mr.status === 200 && mr.headers.get('content-type') === 'image/jpeg', mr.status);

  // iOS AVPlayer neposiela cookies → media URL nesie ?mt= token (urlToken.ts).
  check('media url nesie ?mt= token', /\?mt=[0-9a-f]{32}$/.test(uploaded.url), uploaded.url);
  mr = await fetch(`${BASE}${uploaded.url}`);
  check('video bez cookie s tokenom → 200 (iOS)', mr.status === 200, mr.status);
  mr = await fetch(`${BASE}/api/media/${uploaded.id}`);
  check('bez cookie a bez tokenu → 401', mr.status === 401, mr.status);
  mr = await fetch(`${BASE}/api/media/${uploaded.id}?mt=${'0'.repeat(32)}`);
  check('nesprávny token → 401', mr.status === 401, mr.status);

  console.log('\n— Fotky v poznámkach a udalostiach (ladenie, 5. kolo) —');
  const n1 = await seedImage(alica.id);
  const n2 = await seedImage(bob.id); // cudzia fotka — family-wide je OK
  r = await http(alica.token, 'POST', '/api/notes', {
    kind: 'note',
    title: 'Recept',
    bodyMd: 'Babkin koláč',
    items: [],
    mediaIds: [n1],
  });
  check('poznámka s fotkou → 201', r.status === 201 && r.body.media?.length === 1, r.body.media);
  const noteId = r.body.id;
  r = await http(bob.token, 'POST', `/api/notes/${noteId}/media`, { mediaIds: [n2] });
  check('pridanie cudzej fotky do poznámky → 200 (family-wide)', r.status === 200 && r.body.media?.length === 2, r.body.media?.length);
  r = await http(bob.token, 'DELETE', `/api/notes/${noteId}/media/${n1}`);
  check('odstránenie fotky z poznámky → 200', r.status === 200 && r.body.media?.length === 1, r.body.media?.length);

  r = await http(alica.token, 'POST', '/api/events', {
    title: 'Oslava',
    startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
    allDay: true,
    mediaIds: [n1],
  });
  check('udalosť s fotkou → 201', r.status === 201 && r.body.media?.length === 1, r.body.media);
  const evId = r.body.id;
  r = await http(bob.token, 'POST', `/api/events/${evId}/media`, { mediaIds: [n2] });
  check('pridanie fotky do udalosti → 200', r.status === 200 && r.body.media?.length === 2, r.body.media?.length);
  r = await http(bob.token, 'DELETE', `/api/events/${evId}/media/${n2}`);
  check('fotku z udalosti odstráni len autor/admin → 403', r.status === 403, r.status);
  r = await http(alica.token, 'DELETE', `/api/events/${evId}/media/${n2}`);
  check('autor odstránil fotku udalosti → 200', r.status === 200 && r.body.media?.length === 1, r.body.media?.length);

  console.log('\n— Anketa s fotkami možností (ladenie, 6. kolo) —');
  const p1img = await seedImage(alica.id);
  r = await http(alica.token, 'POST', '/api/polls', {
    question: 'Ktorá fotka na obálku?',
    options: [{ label: 'Táto', mediaId: p1img }, { label: 'Bez fotky' }],
  });
  check(
    'anketa s fotkou možnosti → 201 + option.media',
    r.status === 201 && r.body.options?.[0]?.media?.id === p1img && r.body.options?.[1]?.media === null,
    r.body.options,
  );
  r = await http(alica.token, 'POST', '/api/polls', {
    question: 'X',
    options: [{ label: 'a', mediaId: crypto.randomUUID() }, { label: 'b' }],
  });
  check('neexistujúca fotka možnosti → 400', r.status === 400, r.status);

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
