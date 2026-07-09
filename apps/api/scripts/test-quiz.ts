/**
 * E2E test modulu Kvízy (M8) — REST + WS + mock LLM.
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   LLM_BASE_URL=http://127.0.0.1:31896 bun scripts/test-quiz.ts
 *
 * Pokrýva: tvorbu (validácie, rate limit), generovanie (draft + notifikácia,
 * failed pri nevalidnom JSON + regenerate), review draftu (práva, úprava
 * otázok), publish per publikum (private / family feed karta / room chat
 * správa app://quiz), prístup (private len autor, room len členovia),
 * hranie (skryté correct pred odpoveďou, skóre server-side, jeden pokus,
 * výsledky po vlastnom dohraní, WS quiz:update) a mazanie.
 */
import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { feedCards, notifications, quizzes, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { generateQuiz } from '../src/modules/quiz/service';
import type { ServerWsEvent } from '@rodinna/shared-types';

const PORT = 32004;
const LLM_PORT = 31896;
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

// ── Mock LLM: prepínateľný medzi validným kvízom a haluzou ──────────────────

let llmMode: 'good' | 'garbage' = 'good';
const GOOD_QUESTIONS = [
  { q: 'Hlavné mesto Slovenska?', options: ['Bratislava', 'Praha', 'Viedeň', 'Budapešť'], correct: 0 },
  { q: 'Hlavné mesto Francúzska?', options: ['Lyon', 'Paríž', 'Marseille', 'Nice'], correct: 1 },
  { q: 'Hlavné mesto Talianska?', options: ['Miláno', 'Neapol', 'Rím', 'Turín'], correct: 2 },
  { q: 'Hlavné mesto Španielska?', options: ['Barcelona', 'Sevilla', 'Valencia', 'Madrid'], correct: 3 },
  { q: 'Hlavné mesto Nemecka?', options: ['Berlín', 'Mníchov', 'Hamburg', 'Kolín'], correct: 0 },
];
let lastPrompt = '';
const llmServer = Bun.serve({
  port: LLM_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const body = (await req.json()) as any;
    lastPrompt = body.messages?.map((m: any) => m.content).join('\n') ?? '';
    const content =
      llmMode === 'good'
        // Chatnejšie modely (napr. qwen2.5) radi pridajú vetu ZA JSON poľom,
        // ktorá môže obsahovať vlastnú zátvorku — extractJsonArray to musí
        // prežiť (regresia na bug: naivné lastIndexOf(']') si zobralo túto
        // neskoršiu zátvorku namiesto skutočného konca poľa).
        ? `Tu je kvíz:\n${JSON.stringify(GOOD_QUESTIONS)}\nDobrú zábavu! [Bonus otázka nabudúce?]`
        : 'Ako veľký jazykový model ti bohužiaľ neviem pomôcť s JSON.';
    return Response.json({ choices: [{ message: { role: 'assistant', content } }] });
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
    dsql`truncate table quiz_answers, quizzes, news_items, user_news_prefs, game_moves, game_sessions, diary_embeddings, diary_entries, diary_fragments, event_rsvps, events, note_revisions, note_items, notes, memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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

  console.log('\n— Tvorba: validácie —');
  let r = await http(alica.token, 'POST', '/api/quiz', { topic: 'Rím', count: 2, audience: 'private' });
  check('count < 3 → 400', r.status === 400, r.status);
  r = await http(alica.token, 'POST', '/api/quiz', { topic: 'Rím', count: 5, audience: 'room' });
  check('room bez roomId → 400', r.status === 400, r.status);
  r = await http(alica.token, 'POST', '/api/quiz', { topic: 'X', count: 5, audience: 'private' });
  check('téma < 2 znaky → 400', r.status === 400, r.status);

  console.log('\n— Generovanie (private) —');
  r = await http(alica.token, 'POST', '/api/quiz', {
    topic: 'Hlavné mestá Európy', count: 5, audience: 'private', facts: 'Bratislava je hlavné mesto SR.',
  });
  check('create → 201 generating', r.status === 201 && r.body.status === 'generating', r.body);
  const privId = r.body.id;
  await generateQuiz(privId);
  r = await http(alica.token, 'GET', `/api/quiz/${privId}`);
  check('po jobe status draft', r.body.status === 'draft', r.body.status);
  check('5 otázok s correct (autor)', r.body.questions?.length === 5 && r.body.questions[0].correct === 0, r.body.questions?.length);
  check('prompt obsahuje tému aj podklady', lastPrompt.includes('Hlavné mestá Európy') && lastPrompt.includes('Bratislava je hlavné mesto SR'), false);
  const notifs = await db.select().from(notifications).where(and(eq(notifications.userId, alica.id), eq(notifications.kind, 'quiz.ready')));
  check('notifikácia quiz.ready autorovi', notifs.length === 1 && (notifs[0]!.payload as any)?.title?.includes('pripravený'), notifs.length);

  console.log('\n— Draft: review a práva —');
  r = await http(bob.token, 'GET', `/api/quiz/${privId}`);
  check('cudzí draft → 404', r.status === 404, r.status);
  r = await http(bob.token, 'PATCH', `/api/quiz/${privId}`, { title: 'Hack' });
  check('patch cudzieho → 403/404', r.status === 403 || r.status === 404, r.status);
  const edited = GOOD_QUESTIONS.slice(0, 4).map((q, i) => (i === 0 ? { ...q, q: 'Upravená otázka?' } : q));
  r = await http(alica.token, 'PATCH', `/api/quiz/${privId}`, { title: 'Mestá (upravené)', questions: edited });
  check('autor upraví draft (4 otázky)', r.status === 200 && r.body.questions.length === 4 && r.body.questions[0].q === 'Upravená otázka?', r.body.questions?.length);
  r = await http(alica.token, 'POST', `/api/quiz/${privId}/answers`, { answers: [0, 1, 2, 3] });
  check('odpoveď na draft → 400', r.status === 400, r.status);

  console.log('\n— Publish (private) a hranie autora —');
  r = await http(bob.token, 'POST', `/api/quiz/${privId}/publish`);
  check('publish cudzím → 403/404', r.status === 403 || r.status === 404, r.status);
  r = await http(alica.token, 'POST', `/api/quiz/${privId}/publish`);
  check('publish autorom → published', r.status === 200 && r.body.status === 'published', r.body.status);
  r = await http(bob.token, 'GET', `/api/quiz/${privId}`);
  check('private published cudzím → 404', r.status === 404, r.status);
  r = await http(alica.token, 'POST', `/api/quiz/${privId}/answers`, { answers: [0, 1, 2, 3] });
  check('autor hrá vlastný kvíz: 4/4', r.status === 200 && r.body.myScore === 4, r.body.myScore);
  r = await http(alica.token, 'POST', `/api/quiz/${privId}/answers`, { answers: [0, 1, 2, 3] });
  check('druhý pokus → 400', r.status === 400, r.status);

  console.log('\n— Family kvíz: feed karta + hranie —');
  const cyrilWs = connectWs(cyril.token);
  await cyrilWs.opened;
  r = await http(bob.token, 'POST', '/api/quiz', { topic: 'Harry Potter', count: 5, audience: 'family' });
  const famId = r.body.id;
  await generateQuiz(famId);
  r = await http(bob.token, 'POST', `/api/quiz/${famId}/publish`);
  check('family publish → published', r.body.status === 'published', r.body.status);
  const cards = await db.select().from(feedCards).where(and(eq(feedCards.module, 'quiz'), eq(feedCards.entityId, famId)));
  check('feed karta existuje (K1)', cards.length === 1, cards.length);
  r = await http(cyril.token, 'GET', '/api/feed');
  check('karta vo feed union', r.body.items?.some((i: any) => i.type === 'card' && i.card?.module === 'quiz' && i.card?.entityId === famId), false);

  r = await http(cyril.token, 'GET', `/api/quiz/${famId}`);
  check('pred hraním: playQuestions bez correct', r.body.playQuestions?.length === 5 && r.body.playQuestions[0].correct === undefined && r.body.questions === null, r.body.playQuestions?.[0]);
  check('pred hraním: výsledky skryté', r.body.results === null, r.body.results);
  r = await http(cyril.token, 'POST', `/api/quiz/${famId}/answers`, { answers: [0, 1, 2, 0, 0] });
  check('cyril 4/5 (skóre počíta server)', r.body.myScore === 4, r.body.myScore);
  check('po hraní: questions s correct + výsledky', r.body.questions?.[0]?.correct === 0 && r.body.results?.length === 1, r.body.results?.length);
  const wsEvent = await cyrilWs.waitFor((e) => e.t === 'quiz:update' && (e as any).quizId === famId).catch(() => null);
  check('WS quiz:update po odpovedi (app topic)', wsEvent !== null, wsEvent);
  r = await http(bob.token, 'GET', `/api/quiz/${famId}`);
  check('autor vidí výsledky vždy', r.body.results?.length === 1 && r.body.results[0].score === 4, r.body.results);
  check('zlá dĺžka odpovedí → 400', (await http(bob.token, 'POST', `/api/quiz/${famId}/answers`, { answers: [1] })).status === 400, false);

  console.log('\n— Room kvíz: chat karta + prístup —');
  r = await http(alica.token, 'POST', '/api/chat/rooms', { kind: 'dm', memberIds: [bob.id] });
  const roomId = r.body.id;
  r = await http(cyril.token, 'POST', '/api/quiz', { topic: 'Test', count: 3, audience: 'room', roomId });
  check('kvíz do cudzej miestnosti → 404', r.status === 404, r.status);
  r = await http(alica.token, 'POST', '/api/quiz', { topic: 'Staroveký Rím', count: 5, audience: 'room', roomId });
  const roomQuizId = r.body.id;
  await generateQuiz(roomQuizId);
  await http(alica.token, 'POST', `/api/quiz/${roomQuizId}/publish`);
  r = await http(bob.token, 'GET', `/api/chat/rooms/${roomId}/messages`);
  check('app://quiz správa v miestnosti (K2)', r.body.messages?.some((m: any) => m.bodyMd === `app://quiz/${roomQuizId}`), r.body.messages?.map((m: any) => m.bodyMd));
  r = await http(bob.token, 'GET', `/api/quiz/${roomQuizId}`);
  check('člen miestnosti kvíz vidí', r.status === 200, r.status);
  r = await http(cyril.token, 'GET', `/api/quiz/${roomQuizId}`);
  check('nečlen → 404', r.status === 404, r.status);

  console.log('\n— Failed + regenerate —');
  llmMode = 'garbage';
  r = await http(alica.token, 'POST', '/api/quiz', { topic: 'Vesmír', count: 3, audience: 'private' });
  const failId = r.body.id;
  await generateQuiz(failId);
  r = await http(alica.token, 'GET', `/api/quiz/${failId}`);
  check('nevalidný JSON → status failed', r.body.status === 'failed', r.body.status);
  const failNotifs = await db.select().from(notifications).where(and(eq(notifications.userId, alica.id), eq(notifications.kind, 'quiz.ready')));
  check('notifikácia o zlyhaní', failNotifs.some((n) => (n.payload as any).title.includes('nepodaril')), false);
  llmMode = 'good';
  r = await http(bob.token, 'POST', `/api/quiz/${failId}/regenerate`);
  check('regenerate cudzím → 403/404', r.status === 403 || r.status === 404, r.status);
  r = await http(alica.token, 'POST', `/api/quiz/${failId}/regenerate`);
  check('regenerate → generating', r.body.status === 'generating', r.body.status);
  await generateQuiz(failId);
  r = await http(alica.token, 'GET', `/api/quiz/${failId}`);
  check('po regenerate draft s otázkami', r.body.status === 'draft' && r.body.questions.length === 3, r.body.status);

  console.log('\n— Zoznam a mazanie —');
  r = await http(cyril.token, 'GET', '/api/quiz');
  check('cyril vidí len family kvíz (nie private/room)', r.body.quizzes.length === 1 && r.body.quizzes[0].id === famId, r.body.quizzes?.map((q: any) => q.topic));
  r = await http(alica.token, 'GET', '/api/quiz');
  check('alica vidí svoje + family', r.body.quizzes.length === 4, r.body.quizzes?.length);
  r = await http(cyril.token, 'DELETE', `/api/quiz/${famId}`);
  check('zmaže len autor/admin → 403', r.status === 403, r.status);
  r = await http(bob.token, 'DELETE', `/api/quiz/${famId}`);
  check('autor zmazal → 204', r.status === 204, r.status);
  const cardsAfter = await db.select().from(feedCards).where(eq(feedCards.entityId, famId));
  check('feed karta odstránená', cardsAfter.length === 0, cardsAfter.length);
  const rows = await db.select().from(quizzes).where(eq(quizzes.id, famId));
  check('kvíz zmazaný z DB', rows.length === 0, rows.length);

  console.log('\n— Rate limit —');
  const dana = await seedUser('dana@rodina.sk', 'Dana', 'member');
  let saw429 = false;
  for (let i = 0; i < 6 && !saw429; i++) {
    const rr = await http(dana.token, 'POST', '/api/quiz', { topic: `Téma ${i}`, count: 3, audience: 'private' });
    if (rr.status === 429) saw429 = true;
  }
  check('6. kvíz za minútu → 429', saw429, saw429);

  cyrilWs.close();
  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  llmServer.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
