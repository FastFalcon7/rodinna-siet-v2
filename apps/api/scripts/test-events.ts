/**
 * E2E test modulu Kalendár & Udalosti (M4) — REST + WS + worker funkcie.
 *
 * Spustenie (ICS_SECRET je povinný — bez neho je feed vypnutý):
 *   DATABASE_URL=postgres://rodinna:rodinna@127.0.0.1:5432/rodinna \
 *   VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… ICS_SECRET=test-ics-secret-1234 \
 *   bun scripts/test-events.ts
 *
 * Pokrýva: tvorbu (validácie, feed karta, auto-RSVP autora, reminder joby),
 * RSVP (zmeny, WS event, zákaz na narodeninách), agendu (rozsah, virtuálne
 * narodeniny s vekom), pripomienky (preplánovanie pri zmene času, skip
 * starej), denný narodeninový beh (karta + push, idempotencia, -3 dni)
 * a ICS feed (token, VEVENT, ročné RRULE narodenín).
 */
import { and, eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { db, sql } from '../src/core/db/client';
import { feedCards, jobs, notifications, users } from '../src/core/db/schema';
import { runMigrations } from '../src/core/db/migrate';
import { hashPassword } from '../src/modules/auth/crypto';
import { createSession } from '../src/modules/auth/session';
import { app } from '../src/core/rpc/app';
import { chatWebSocket, handleChatUpgrade, setServer } from '../src/modules/chat/realtime';
import { startWsBridge } from '../src/core/events';
import { icsToken, processBirthdays, sendReminder } from '../src/modules/events/service';
import type { ServerWsEvent } from '@rodinna/shared-types';

const PORT = 31997;
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
    dsql`truncate table event_rooms, event_rsvps, events, note_revisions, note_items, notes, memory_marks, album_photos, albums, poll_votes, poll_options, polls, feed_cards, jobs, push_subs, notifications, reactions, message_media, messages, room_members, chat_rooms, post_media, comments, posts, media, sessions, users restart identity cascade`,
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

  const tomorrow5pm = new Date(Date.now() + 26 * 60 * 60 * 1000);

  console.log('\n— Tvorba udalosti —');
  let r = await http(alica.token, 'POST', '/api/events', {
    title: 'X',
    startsAt: new Date(Date.now() - 3600_000).toISOString(),
  });
  check('začiatok v minulosti → 400', r.status === 400, r.status);
  r = await http(alica.token, 'POST', '/api/events', {
    title: 'X',
    startsAt: tomorrow5pm.toISOString(),
    endsAt: new Date(tomorrow5pm.getTime() - 3600_000).toISOString(),
  });
  check('koniec pred začiatkom → 400', r.status === 400, r.status);

  r = await http(alica.token, 'POST', '/api/events', {
    title: 'Grilovačka u nás',
    startsAt: tomorrow5pm.toISOString(),
    location: 'záhrada',
    toFeed: true,
    rsvp: true,
  });
  check('vytvorenie → 201', r.status === 201 && r.body.title === 'Grilovačka u nás', r.body);
  const eventId = r.body.id;
  check('pozvánka: autor má automaticky RSVP yes', r.body.rsvp === true && r.body.myRsvp === 'yes' && r.body.rsvps.yes.length === 1, r.body.rsvps);

  r = await http(bob.token, 'GET', '/api/feed');
  check(
    'RSVP karta vo feede (explicitné toFeed=true)',
    r.body.items?.some((it: any) => it.type === 'card' && it.card.module === 'events' && it.card.entityId === eventId),
    r.body.items?.length,
  );

  // Ladenie 07/2026 (bod 4): default je BEZ feed karty — udalosti žijú v Kalendári.
  r = await http(alica.token, 'POST', '/api/events', {
    title: 'Len v kalendári',
    startsAt: tomorrow5pm.toISOString(),
  });
  check('default vytvorenie → 201', r.status === 201, r.status);
  const quietEventId = r.body.id;
  r = await http(bob.token, 'GET', '/api/feed');
  check(
    'default BEZ karty vo feede (bod 4)',
    !r.body.items?.some((it: any) => it.type === 'card' && it.card.entityId === quietEventId),
    r.body.items?.length,
  );
  // Ladenie 07/2026: bez pozvánky žiadne auto-RSVP a RSVP sa odmietne.
  r = await http(alica.token, 'GET', `/api/events/${quietEventId}`);
  check('bez pozvánky: rsvp=false, žiadne auto yes', r.body.rsvp === false && r.body.myRsvp === null && r.body.rsvps.yes.length === 0, r.body);
  r = await http(bob.token, 'PUT', `/api/events/${quietEventId}/rsvp`, { status: 'yes' });
  check('RSVP na oznam bez pozvánky → 400', r.status === 400, r.status);
  // Zapnutie pozvánky pri úprave → autor ide automaticky.
  r = await http(alica.token, 'PATCH', `/api/events/${quietEventId}`, { rsvp: true });
  check('zapnutie pozvánky → autor yes', r.status === 200 && r.body.rsvp === true && r.body.myRsvp === 'yes', r.body);
  r = await http(bob.token, 'PUT', `/api/events/${quietEventId}/rsvp`, { status: 'yes' });
  check('po zapnutí pozvánky RSVP funguje', r.status === 200 && r.body.rsvps.yes.length === 2, r.body.rsvps);
  const remindJobs = (await db.select().from(jobs).where(eq(jobs.kind, 'events.remind'))).filter(
    (j) => (j.payload as any).eventId === eventId,
  );
  check('2 reminder joby (deň + hodina vopred)', remindJobs.length === 2, remindJobs.length);

  console.log('\n— Viditeľnosť: podskupiny (ladenie, 8. kolo) —');
  r = await http(alica.token, 'POST', '/api/chat/rooms', { kind: 'group', title: 'Oslavy', memberIds: [bob.id] });
  const evGroupId = r.body.id;
  const cyril0 = await seedUser('cyril0@rodina.sk', 'Cyril0', 'member');
  r = await http(alica.token, 'POST', '/api/events', {
    title: 'Tajná oslava',
    startsAt: tomorrow5pm.toISOString(),
    visibility: 'rooms',
    roomIds: [evGroupId],
  });
  check('udalosť pre podskupinu → 201', r.status === 201 && r.body.visibility === 'rooms', r.body.visibility);
  const roomEvId = r.body.id;
  r = await http(bob.token, 'GET', `/api/events/${roomEvId}`);
  check('člen skupiny ju vidí', r.status === 200, r.status);
  r = await http(cyril0.token, 'GET', `/api/events/${roomEvId}`);
  check('nečlen ju nevidí → 404', r.status === 404, r.status);
  r = await http(cyril0.token, 'GET', '/api/events');
  check('nečlen ju nemá v agende', !r.body.events.some((e: any) => e.id === roomEvId), r.body.events?.length);
  r = await http(alica.token, 'POST', '/api/events', {
    title: 'Len moja',
    startsAt: tomorrow5pm.toISOString(),
    visibility: 'private',
  });
  const privEvId = r.body.id;
  r = await http(bob.token, 'GET', `/api/events/${privEvId}`);
  check('súkromnú udalosť iný nevidí → 404', r.status === 404, r.status);

  console.log('\n— RSVP —');
  const alicaWs = connectWs(alica.token);
  await alicaWs.opened;
  r = await http(bob.token, 'PUT', `/api/events/${eventId}/rsvp`, { status: 'yes' });
  check('bob príde', r.body.rsvps.yes.length === 2, r.body.rsvps);
  const evt = await alicaWs.waitFor((e) => e.t === 'event:update');
  check('event:update cez WS', (evt as any).eventId === eventId, evt);
  r = await http(bob.token, 'PUT', `/api/events/${eventId}/rsvp`, { status: 'maybe' });
  check('zmena na maybe (upsert)', r.body.rsvps.yes.length === 1 && r.body.rsvps.maybe.length === 1, r.body.rsvps);

  console.log('\n— Agenda + narodeniny —');
  const today = new Date();
  const bdayThisYear = new Date(Date.UTC(1980, today.getUTCMonth(), today.getUTCDate()));
  r = await http(bob.token, 'PATCH', '/api/users/me', { birthday: bdayThisYear.toISOString().slice(0, 10) });
  check('nastavenie narodenín v profile', r.status === 200 && r.body.user.birthday === bdayThisYear.toISOString().slice(0, 10), r.body.user?.birthday);

  r = await http(alica.token, 'GET', '/api/events');
  check('agenda obsahuje udalosť', r.body.events.some((e: any) => e.id === eventId), r.body.events?.length);
  const bday = r.body.birthdays.find((b: any) => b.user.displayName === 'Bob');
  check('virtuálne narodeniny Boba s vekom', bday && bday.age === today.getUTCFullYear() - 1980, bday);

  console.log('\n— Pripomienky —');
  const startsAtIso = tomorrow5pm.toISOString();
  await sendReminder(eventId, startsAtIso, 'deň');
  let notifRows = await db.select().from(notifications).where(eq(notifications.kind, 'events.reminder'));
  // Príjemcovia: alica (autor, yes) + bob (maybe).
  check('pripomienka autorovi + maybe (2 in-app)', notifRows.length === 2, notifRows.length);
  check('titulok „Zajtra: …"', (notifRows[0]?.payload as any)?.title?.startsWith('Zajtra:'), notifRows[0]?.payload);

  // Presun času → stará pripomienka sa musí ticho zahodiť, nové joby vzniknúť.
  const newStart = new Date(tomorrow5pm.getTime() + 2 * 60 * 60 * 1000);
  r = await http(bob.token, 'PATCH', `/api/events/${eventId}`, { startsAt: newStart.toISOString() });
  check('upraviť môže len autor/admin → 403', r.status === 403, r.status);
  r = await http(alica.token, 'PATCH', `/api/events/${eventId}`, { startsAt: newStart.toISOString() });
  check('autor presunul čas', r.status === 200 && r.body.startsAt === newStart.toISOString(), r.body.startsAt);
  r = await http(alica.token, 'PATCH', `/api/events/${eventId}`, { title: 'Grilovačka (upravené)', location: 'terasa' });
  check('autor upravil názov a miesto', r.body.title === 'Grilovačka (upravené)' && r.body.location === 'terasa', r.body.title);
  const remindJobs2 = (await db.select().from(jobs).where(eq(jobs.kind, 'events.remind'))).filter(
    (j) => (j.payload as any).eventId === eventId,
  );
  check('nové reminder joby po presune (4 spolu)', remindJobs2.length === 4, remindJobs2.length);
  await db.execute(dsql`truncate table notifications`);
  await sendReminder(eventId, startsAtIso, 'deň'); // starý čas
  notifRows = await db.select().from(notifications).where(eq(notifications.kind, 'events.reminder'));
  check('pripomienka so starým časom sa zahodí', notifRows.length === 0, notifRows.length);

  console.log('\n— Denný narodeninový beh —');
  await processBirthdays();
  const bdayEvents = await db.select().from(feedCards).where(eq(feedCards.module, 'events'));
  const bdayCard = bdayEvents.find((c) => c.authorId === bob.id);
  check('narodeninová karta vo feede', bdayCard !== undefined, bdayEvents.length);
  const bdayNotifs = await db.select().from(notifications).where(eq(notifications.kind, 'events.birthday'));
  check(
    'push ostatným (nie oslávencovi)',
    bdayNotifs.length === 2 && bdayNotifs.every((n) => n.userId !== bob.id),
    bdayNotifs.length,
  );
  await processBirthdays();
  const bdayEvents2 = await db.select().from(feedCards).where(eq(feedCards.module, 'events'));
  check('idempotencia (žiadna druhá karta)', bdayEvents2.length === bdayEvents.length, bdayEvents2.length);

  if (bdayCard) {
    r = await http(alica.token, 'GET', `/api/events/${bdayCard.entityId}`);
    check('narodeninová udalosť má source=birthday', r.body.source === 'birthday', r.body.source);
    r = await http(alica.token, 'PUT', `/api/events/${bdayCard.entityId}/rsvp`, { status: 'yes' });
    check('RSVP na narodeniny → 400', r.status === 400, r.status);
    r = await http(alica.token, 'GET', '/api/events');
    check('narodeninový riadok nie je v agende (virtuálne áno)', !r.body.events.some((e: any) => e.id === bdayCard.entityId), r.body.events?.length);
  }

  // -3 dni: nastav cyrilovi narodeniny o 3 dni → len notifikácia, žiadna karta.
  const cyril = await seedUser('cyril@rodina.sk', 'Cyril', 'member');
  const in3 = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await http(cyril.token, 'PATCH', '/api/users/me', {
    birthday: `1990-${String(in3.getUTCMonth() + 1).padStart(2, '0')}-${String(in3.getUTCDate()).padStart(2, '0')}`,
  });
  await db.execute(dsql`truncate table notifications`);
  await processBirthdays();
  const soonNotifs = await db.select().from(notifications).where(eq(notifications.kind, 'events.birthday'));
  check('push „o 3 dni" ostatným', soonNotifs.length === 3 && soonNotifs.every((n) => n.userId !== cyril.id), soonNotifs.length);

  console.log('\n— ICS feed —');
  let res = await fetch(`${BASE}/api/events/calendar.ics`);
  check('bez tokenu → 401', res.status === 401, res.status);
  res = await fetch(`${BASE}/api/events/calendar.ics?token=${icsToken()}`);
  const ics = await res.text();
  check('s tokenom → 200 text/calendar', res.status === 200 && res.headers.get('content-type')?.includes('text/calendar') === true, res.status);
  check('obsahuje udalosť', ics.includes('Grilovačka (upravené)'), ics.slice(0, 100));
  check('narodeniny ako ročné RRULE', ics.includes('RRULE:FREQ=YEARLY') && ics.includes('Bob — narodeniny'), ics.includes('RRULE'));
  r = await http(alica.token, 'GET', '/api/events/ics-url');
  check('ics-url endpoint vracia URL s tokenom', r.body.url?.includes(icsToken()), r.body);

  console.log('\n— Zmazanie —');
  r = await http(bob.token, 'DELETE', `/api/events/${eventId}`);
  check('zmaže len autor/admin → 403', r.status === 403, r.status);
  r = await http(alica.token, 'DELETE', `/api/events/${eventId}`);
  check('autor zmazal → 204', r.status === 204, r.status);
  const cardAfter = await db
    .select()
    .from(feedCards)
    .where(and(eq(feedCards.module, 'events'), eq(feedCards.entityId, eventId)));
  check('feed karta odstránená', cardAfter.length === 0, cardAfter.length);

  alicaWs.close();
  console.log(`\n══ Výsledok: ${passed} ✓ / ${failed} ✗ ══`);
  server.stop(true);
  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

await main();
