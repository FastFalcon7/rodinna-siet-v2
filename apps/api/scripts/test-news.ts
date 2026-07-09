/**
 * E2E test modulu Svet okolo (M7) — mock RSS server + mock LLM (prompt).
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   LLM_BASE_URL=http://127.0.0.1:31897 \
 *   NEWS_FEEDS_JSON='{"sport":["http://127.0.0.1:31898/rss"]}' bun scripts/test-news.ts
 *
 * Pokrýva: prefs API (opt-in/out), RSS fetch (parse, snippet bez HTML,
 * dedupe cez unique url, prune starých, len odoberané kategórie, mŕtvy feed
 * nezhodí beh), /news/today a integráciu do denníkového promptu
 * (odsek Svet okolo len pri zapnutých kategóriách).
 */
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { newsItems, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { fetchNews, parseRss } from '../src/modules/news/service';
import { generateEntry } from '../src/modules/diary/service';
import type { NewsCategory } from '@rodinna/shared-types';

const PORT = 32003;
const RSS_PORT = 31898;
const LLM_PORT = 31897;
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

// ── Mock RSS + mock LLM ──────────────────────────────────────────────────────

const now = new Date();
const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Mock šport</title>
<item>
  <title><![CDATA[Slovan vyhral derby 3:1]]></title>
  <link>https://sport.example.sk/slovan-derby</link>
  <description><![CDATA[<p>Skvelý zápas &amp; tri góly <b>Šimoviča</b>.</p>]]></description>
  <pubDate>${now.toUTCString()}</pubDate>
</item>
<item>
  <title>Peter Sagan končí kariéru</title>
  <link>https://sport.example.sk/sagan</link>
  <description>Legendárny cyklista oznámil koniec.</description>
  <pubDate>${now.toUTCString()}</pubDate>
</item>
<item>
  <title>Kto nie je s&#160;Naďom, je s&#160;Ficom</title>
  <link>https://sport.example.sk/entity-test</link>
  <description>Text s&#160;nedeliteľnou medzerou a&#xA0;hex entitou.</description>
  <pubDate>${now.toUTCString()}</pubDate>
</item>
<item>
  <title>Starý článok spred mesiaca</title>
  <link>https://sport.example.sk/stary</link>
  <description>Toto je staré.</description>
  <pubDate>${new Date(now.getTime() - 30 * 24 * 3600 * 1000).toUTCString()}</pubDate>
</item>
</channel></rss>`;

const rssServer = Bun.serve({
  port: RSS_PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    if (new URL(req.url).pathname === '/rss') {
      return new Response(RSS_XML, { headers: { 'content-type': 'application/rss+xml' } });
    }
    return new Response('nf', { status: 404 });
  },
});

let lastChatPrompt = '';
const llmServer = Bun.serve({
  port: LLM_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const body = (await req.json()) as any;
    if (new URL(req.url).pathname === '/v1/chat/completions') {
      lastChatPrompt = body.messages?.map((m: any) => m.content).join('\n') ?? '';
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'Zápis.\n\n## Svet okolo\nSlovan vyhral.' } }] });
    }
    return new Response('nf', { status: 404 });
  },
});

const MOCK_FEEDS = {
  sport: [`http://127.0.0.1:${RSS_PORT}/rss`],
  spravy: [`http://127.0.0.1:${RSS_PORT}/mrtvy-feed`], // 404 — nesmie zhodiť beh
} as Record<NewsCategory, string[]>;

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
    dsql`truncate table news_items, user_news_prefs, game_moves, game_sessions, diary_embeddings, diary_entries, diary_fragments, event_rsvps, events, note_revisions, note_items, notes, memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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

  console.log('\n— Parser —');
  const parsed = parseRss(RSS_XML);
  check('RSS: 4 položky', parsed.length === 4, parsed.length);
  check('CDATA titulok', parsed[0]!.title === 'Slovan vyhral derby 3:1', parsed[0]!.title);
  check('snippet bez HTML tagov a entít', parsed[0]!.snippet === 'Skvelý zápas & tri góly Šimoviča.', parsed[0]!.snippet);
  const entityItem = parsed.find((p) => p.url.includes('entity-test'));
  check('numerické HTML entity (&#160; aj &#xA0;) dekódované na medzeru', entityItem?.title === 'Kto nie je s Naďom, je s Ficom', entityItem?.title);
  check('hex entita v snippete dekódovaná', entityItem?.snippet === 'Text s nedeliteľnou medzerou a hex entitou.', entityItem?.snippet);

  console.log('\n— Preferencie —');
  let r = await http(alica.token, 'GET', '/api/news/prefs');
  check('default vypnuté ([])', r.body.categories.length === 0, r.body);
  r = await http(alica.token, 'PUT', '/api/news/prefs', { categories: ['sport', 'sport'] });
  check('nastavenie (dedupe)', r.status === 200 && r.body.categories.length === 1 && r.body.categories[0] === 'sport', r.body);
  r = await http(alica.token, 'PUT', '/api/news/prefs', { categories: ['blbost'] });
  check('neznáma kategória → 400', r.status === 400, r.status);

  console.log('\n— Fetch job —');
  let res = await fetchNews(MOCK_FEEDS);
  check('stiahnuté len odoberané kategórie, starý článok preskočený', res.stored === 3, res);
  res = await fetchNews(MOCK_FEEDS);
  check('dedupe cez unique url (0 nových)', res.stored === 0, res);
  const allItems = await db.select().from(newsItems);
  check('v DB len čerstvé položky', allItems.length === 3, allItems.length);

  r = await http(alica.token, 'GET', '/api/news/today');
  check('today: 3 dnešné titulky', r.body.items.length === 3, r.body.items?.length);
  check('titulok + zdroj', r.body.items.some((i: any) => i.title.includes('Slovan') && i.source === '127.0.0.1'), r.body.items?.[0]);
  r = await http(bob.token, 'GET', '/api/news/today');
  check('bob bez prefs → prázdne', r.body.items.length === 0, r.body.items?.length);

  console.log('\n— Integrácia do denníka —');
  await http(alica.token, 'POST', '/api/diary/fragments', { body: 'Bola som behať' });
  await generateEntry(alica.id, today);
  check('prompt obsahuje titulky (Svet okolo)', lastChatPrompt.includes('Slovan vyhral derby'), false);
  check('prompt obsahuje inštrukciu Svet okolo', lastChatPrompt.includes('Svet okolo'), false);
  check('prompt nesie len snippet, nie celý článok', !lastChatPrompt.includes('<p>'), false);

  lastChatPrompt = '';
  await http(bob.token, 'POST', '/api/diary/fragments', { body: 'Hral som futbal' });
  await generateEntry(bob.id, today);
  check('bez prefs žiadny Svet okolo v prompte', !lastChatPrompt.includes('Svet okolo') && !lastChatPrompt.includes('Slovan'), lastChatPrompt.slice(0, 120));

  r = await http(alica.token, 'PUT', '/api/news/prefs', { categories: [] });
  check('opt-out ([] vypne)', r.body.categories.length === 0, r.body);

  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  rssServer.stop(true);
  llmServer.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
