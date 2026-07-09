/**
 * E2E test modulu Denník + LLM kernel (M5) — proti živému serveru, Postgresu
 * s pgvector a MOCK LLM serveru (OpenAI-kompatibilné /v1/chat/completions
 * a /v1/embeddings v tomto procese).
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   LLM_BASE_URL=http://127.0.0.1:31899 bun scripts/test-diary.ts
 *
 * Pokrýva: fragmenty (CRUD, privacy), generovanie draftu (podklady LEN
 * z vlastného obsahu, prázdny deň nič, existujúci zápis sa neprepíše),
 * potvrdenie + embedding (pgvector), sémantické hľadanie, rannú notifikáciu
 * a /api/llm proxy.
 */
import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { diaryEmbeddings, jobs, notifications, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { embedEntry, generateEntry, notifyDraft } from '../src/modules/diary/service';

const PORT = 31999;
const LLM_PORT = 31899;
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

// ── Mock LLM server ──────────────────────────────────────────────────────────

let lastChatPrompt = '';
const DIARY_TEXT = 'Dnes bol krásny deň. Boli sme pri vode a chytil som veľkú rybu.';

/** Deterministické embeddingy: kľúčové slovo → bázový vektor (768 dim). */
function mockEmbedding(text: string): number[] {
  const vec = new Array(768).fill(0);
  const t = text.toLowerCase();
  if (t.includes('vod')) vec[0] = 1;
  else if (t.includes('koláč') || t.includes('kolac')) vec[1] = 1;
  else vec[2] = 1;
  return vec;
}

const llmServer = Bun.serve({
  port: LLM_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    const body = (await req.json()) as any;
    if (url.pathname === '/v1/chat/completions') {
      lastChatPrompt = body.messages?.map((m: any) => m.content).join('\n') ?? '';
      return Response.json({ choices: [{ message: { role: 'assistant', content: DIARY_TEXT } }] });
    }
    if (url.pathname === '/v1/embeddings') {
      return Response.json({ data: [{ embedding: mockEmbedding(String(body.input)) }] });
    }
    return new Response('not found', { status: 404 });
  },
});

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

async function main() {
  await runMigrations();
  await db.execute(
    dsql`truncate table diary_embeddings, diary_entries, diary_fragments, event_rsvps, events, note_revisions, note_items, notes, memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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
  const today = new Date().toISOString().slice(0, 10);

  console.log('\n— Status + fragmenty —');
  let r = await http(alica.token, 'GET', '/api/diary/status');
  check('LLM status enabled', r.body.enabled === true, r.body);

  r = await http(alica.token, 'POST', '/api/diary/fragments', { body: '' });
  check('prázdny fragment → 400', r.status === 400, r.status);
  r = await http(alica.token, 'POST', '/api/diary/fragments', { body: 'Ráno sme boli pri vode', mood: '😀' });
  check('fragment s náladou → 201', r.status === 201 && r.body.mood === '😀', r.body);
  const fragId = r.body.id;
  await http(alica.token, 'POST', '/api/diary/fragments', { body: 'Chytil som rybu!' });
  await http(alica.token, 'POST', '/api/diary/fragments', { mood: '🙂' });

  r = await http(alica.token, 'GET', '/api/diary/fragments');
  check('3 dnešné fragmenty', r.body.fragments.length === 3, r.body.fragments?.length);
  r = await http(bob.token, 'GET', '/api/diary/fragments');
  check('privacy: bob nevidí alicine fragmenty', r.body.fragments.length === 0, r.body.fragments?.length);
  r = await http(bob.token, 'DELETE', `/api/diary/fragments/${fragId}`);
  check('privacy: bob nezmaže cudzí fragment → 404', r.status === 404, r.status);

  console.log('\n— Generovanie draftu —');
  // Vlastný post + vlastná správa + CUDZIA správa (nesmie sa dostať do promptu).
  await http(alica.token, 'POST', '/api/feed', { bodyMd: 'Fotky z rybačky večer!' });
  r = await http(alica.token, 'GET', '/api/chat/rooms');
  const familyId = r.body.rooms.find((x: any) => x.kind === 'family')?.id;
  await http(alica.token, 'POST', `/api/chat/rooms/${familyId}/messages`, { bodyMd: 'Vraciame sa o šiestej' });
  await http(bob.token, 'POST', `/api/chat/rooms/${familyId}/messages`, { bodyMd: 'TAJNÁ SPRÁVA BOBA' });

  const entryId = await generateEntry(alica.id, today);
  check('draft vytvorený', entryId !== null, entryId);
  check('prompt obsahuje fragmenty', lastChatPrompt.includes('pri vode') && lastChatPrompt.includes('rybu'), false);
  check('prompt obsahuje vlastný post aj správu', lastChatPrompt.includes('rybačky') && lastChatPrompt.includes('šiestej'), false);
  check('prompt NEOBSAHUJE cudziu správu (privacy §15.2)', !lastChatPrompt.includes('TAJNÁ'), lastChatPrompt.slice(0, 200));

  r = await http(alica.token, 'GET', '/api/diary');
  check('zápis je draft', r.body.entries[0]?.status === 'draft' && r.body.entries[0]?.bodyMd === DIARY_TEXT, r.body.entries?.[0]);
  r = await http(bob.token, 'GET', '/api/diary');
  check('privacy: bob nevidí alicin zápis', r.body.entries.length === 0, r.body.entries?.length);

  check('existujúci zápis sa neprepíše', (await generateEntry(alica.id, today)) === null);
  // Bob dnes písal do chatu (vlastná správa = podklad) — prázdny deň testuje
  // cyril, ktorý nemá žiadnu aktivitu.
  const cyril = await seedUser('cyril@rodina.sk', 'Cyril', 'member');
  check('prázdny deň → žiadny draft (cyril)', (await generateEntry(cyril.id, today)) === null);

  console.log('\n— Notifikácia + potvrdenie + embedding —');
  await notifyDraft(alica.id, today);
  let notifRows = await db.select().from(notifications).where(eq(notifications.kind, 'diary.draft'));
  check('ranná notifikácia o drafte', notifRows.length === 1 && notifRows[0]!.userId === alica.id, notifRows.length);

  r = await http(alica.token, 'PATCH', `/api/diary/entries/${entryId}`, { bodyMd: `${DIARY_TEXT} Bolo pri vode nádherne.` });
  check('úprava draftu', r.status === 200, r.status);
  r = await http(alica.token, 'POST', `/api/diary/entries/${entryId}/confirm`);
  check('potvrdenie → confirmed', r.body.status === 'confirmed' && r.body.confirmedAt, r.body);
  const embedJobs = await db.select().from(jobs).where(and(eq(jobs.kind, 'diary.embed'), eq(jobs.status, 'pending')));
  check('embed job zaradený', embedJobs.length >= 1, embedJobs.length);
  await embedEntry(entryId!, alica.id);
  const embRows = await db.select({ id: diaryEmbeddings.id }).from(diaryEmbeddings);
  check('embedding v pgvector', embRows.length === 1, embRows.length);
  await notifyDraft(alica.id, today);
  notifRows = await db.select().from(notifications).where(eq(notifications.kind, 'diary.draft'));
  check('potvrdený zápis už nenotifikuje', notifRows.length === 1, notifRows.length);

  console.log('\n— Sémantické hľadanie —');
  // Druhý potvrdený zápis s iným kľúčovým slovom (koláč).
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const e2 = await db.execute<{ id: string }>(dsql`
    INSERT INTO diary_entries (user_id, date, body_md, status, confirmed_at)
    VALUES (${alica.id}, ${yesterday}, ${'Piekli sme koláč s babkou.'}, 'confirmed', now())
    RETURNING id
  `);
  await embedEntry(e2[0]!.id, alica.id);

  r = await http(alica.token, 'GET', `/api/diary/search?q=${encodeURIComponent('keď sme boli pri vode')}`);
  check('hľadanie nájde správny zápis prvý', r.body.results?.[0]?.bodyMd?.includes('vode') === true, r.body.results?.[0]?.bodyMd);
  check('podobnosť relevantného ~1', r.body.results?.[0]?.similarity > 0.9, r.body.results?.[0]?.similarity);
  r = await http(bob.token, 'GET', `/api/diary/search?q=${encodeURIComponent('pri vode')}`);
  check('privacy: bob v hľadaní nič nenájde', r.body.results.length === 0, r.body.results?.length);

  console.log('\n— /api/llm proxy —');
  r = await http(alica.token, 'POST', '/api/llm/chat/completions', {
    messages: [{ role: 'user', content: 'ahoj' }],
    stream: false,
  });
  check('proxy vracia odpoveď modelu', r.body.choices?.[0]?.message?.content === DIARY_TEXT, r.body);
  const unauth = await fetch(`${BASE}/api/llm/chat/completions`, { method: 'POST', body: '{}' });
  check('bez auth → 401', unauth.status === 401, unauth.status);

  console.log('\n— Mazanie —');
  r = await http(alica.token, 'DELETE', `/api/diary/entries/${entryId}`);
  check('zmazanie zápisu → 204', r.status === 204, r.status);
  const embAfter = await db.select({ id: diaryEmbeddings.id }).from(diaryEmbeddings);
  check('embedding zmizol kaskádou', embAfter.length === 1, embAfter.length);

  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  llmServer.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
