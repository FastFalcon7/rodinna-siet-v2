/**
 * E2E test modulu Zoznamy & Poznámky (M3) — REST + WS proti živému serveru.
 *
 * Spustenie:
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna bun scripts/test-notes.ts
 *
 * Pokrýva: CRUD zoznamov/poznámok, položky (check s autorom, priradenie,
 * mazanie), real-time note:update, revízie textu + restore, duplikát
 * (šablóna), pripnutie, práva na mazanie a validácie.
 */
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import type { ServerWsEvent } from '@rodinna/shared-types';

const PORT = 31995;
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
    dsql`truncate table note_revisions, note_items, notes, memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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

  console.log('\n— Zoznam: CRUD + položky —');
  let r = await http(bob.token, 'POST', '/api/notes', { kind: 'list', title: '  ', items: [] });
  check('prázdny názov → 400', r.status === 400, r.status);
  r = await http(bob.token, 'POST', '/api/notes', { kind: 'note', title: 'X', items: ['a'] });
  check('poznámka s položkami → 400', r.status === 400, r.status);

  r = await http(bob.token, 'POST', '/api/notes', {
    kind: 'list',
    title: 'Nákup',
    items: ['Mlieko', 'Chlieb', 'Vajcia'],
  });
  check('zoznam s 3 položkami → 201', r.status === 201 && r.body.items.length === 3, r.body.items?.length);
  const listId = r.body.id;
  const [i1, i2] = r.body.items;

  const aliceWs = connectWs(alica.token);
  await aliceWs.opened;

  r = await http(alica.token, 'PATCH', `/api/notes/items/${i1.id}`, { checked: true });
  check('alica odškrtne Mlieko (checkedBy)', r.body.items[0].checkedBy?.displayName === 'Alica', r.body.items[0]);
  check('progress 1/3', r.body.itemsChecked === 1 && r.body.itemsTotal === 3, r.body);

  r = await http(bob.token, 'PATCH', `/api/notes/items/${i2.id}`, { assignedTo: cyril.id });
  check('priradenie Cyrilovi', r.body.items[1].assignedTo?.displayName === 'Cyril', r.body.items[1]);
  r = await http(bob.token, 'PATCH', `/api/notes/items/${i2.id}`, { assignedTo: null });
  check('zrušenie priradenia', r.body.items[1].assignedTo === null, r.body.items[1]);
  r = await http(bob.token, 'PATCH', `/api/notes/items/${i2.id}`, {
    assignedTo: '00000000-0000-0000-0000-000000000000',
  });
  check('priradenie neexistujúcemu → 400', r.status === 400, r.status);

  const evt = await aliceWs.waitFor((e) => e.t === 'note:update');
  check('note:update cez WS', (evt as any).noteId === listId, evt);

  r = await http(cyril.token, 'POST', `/api/notes/${listId}/items`, { label: 'Maslo' });
  check('cyril pridá položku', r.body.itemsTotal === 4, r.body.itemsTotal);
  const butter = r.body.items.find((i: any) => i.label === 'Maslo');
  r = await http(cyril.token, 'DELETE', `/api/notes/items/${butter.id}`);
  check('a zmaže ju', r.body.itemsTotal === 3, r.body.itemsTotal);

  r = await http(alica.token, 'PATCH', `/api/notes/items/${i1.id}`, { checked: false });
  check('odznačenie (checkedBy zmizne)', r.body.items[0].checkedBy === null, r.body.items[0]);

  console.log('\n— Poznámka: revízie —');
  r = await http(alica.token, 'POST', '/api/notes', { kind: 'note', title: 'Recept', bodyMd: 'verzia 1' });
  const noteId = r.body.id;
  r = await http(bob.token, 'PATCH', `/api/notes/${noteId}`, { bodyMd: 'verzia 2' });
  check('úprava textu (updatedBy=Bob)', r.body.updatedBy?.displayName === 'Bob' && r.body.bodyMd === 'verzia 2', r.body.updatedBy);
  check('revisionCount 1', r.body.revisionCount === 1, r.body.revisionCount);
  r = await http(cyril.token, 'PATCH', `/api/notes/${noteId}`, { bodyMd: 'verzia 3' });
  r = await http(alica.token, 'GET', `/api/notes/${noteId}/revisions`);
  check('2 revízie, najnovšia prvá', r.body.revisions.length === 2 && r.body.revisions[0].bodyMd === 'verzia 2', r.body.revisions);
  check('revízia nesie autora', r.body.revisions[0].savedBy?.displayName === 'Bob', r.body.revisions[0]);
  const revId = r.body.revisions[1].id; // 'verzia 1'
  r = await http(alica.token, 'POST', `/api/notes/${noteId}/revisions/${revId}/restore`);
  check('restore verzie 1', r.body.bodyMd === 'verzia 1' && r.body.revisionCount === 3, r.body);

  console.log('\n— Duplikát (šablóna) + pripnutie —');
  await http(alica.token, 'PATCH', `/api/notes/items/${i1.id}`, { checked: true });
  r = await http(bob.token, 'POST', `/api/notes/${listId}/duplicate`, { title: 'Nákup — nový týždeň' });
  check('duplikát → 201, položky bez odškrtnutia', r.status === 201 && r.body.itemsTotal === 3 && r.body.itemsChecked === 0, r.body);

  r = await http(alica.token, 'PATCH', `/api/notes/${listId}`, { pinned: true });
  check('pripnutie', r.body.pinned === true);
  r = await http(bob.token, 'GET', '/api/notes');
  check('pripnutý zoznam je prvý', r.body.notes[0].id === listId, r.body.notes.map((n: any) => n.title));

  console.log('\n— Práva —');
  r = await http(cyril.token, 'DELETE', `/api/notes/${listId}`);
  check('zmaže len autor/admin → 403', r.status === 403, r.status);
  r = await http(alica.token, 'DELETE', `/api/notes/${listId}`);
  check('admin zmaže → 204', r.status === 204, r.status);
  r = await http(bob.token, 'GET', `/api/notes/${listId}`);
  check('zmazaný zoznam → 404', r.status === 404, r.status);
  r = await http(bob.token, 'PATCH', `/api/notes/items/${i1.id}`, { checked: true });
  check('položka zmazaného zoznamu → 404', r.status === 404, r.status);

  aliceWs.close();
  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
