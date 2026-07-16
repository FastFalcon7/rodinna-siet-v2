import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type {
  AgendaResponse,
  BirthdayPublic,
  CreateEventInput,
  EventPublic,
  PostAuthor,
  RsvpStatus,
  UpdateEventInput,
} from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { chatRooms, eventMedia, eventRooms, eventRsvps, events, feedCards, media, roomMembers, users, type EventRow } from '../../core/db/schema';
import { APP_TOPIC } from '../../core/realtime';
import { publishCrossProcess } from '../../core/events';
import { enqueueJob } from '../../core/jobs/queue';
import { sha256Hex } from '../auth/crypto';
import { env } from '../../config/env';
import { toMediaPublic } from '../media/service';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

async function fetchAuthors(userIds: string[]): Promise<Map<string, PostAuthor>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, nameColor: users.nameColor })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Množina miestností, ktorých je viewer členom (na 'rooms' viditeľnosť). */
async function viewerRoomIds(viewerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.userId, viewerId));
  return new Set(rows.map((r) => r.roomId));
}

async function eventRoomIdsOf(eventId: string): Promise<string[]> {
  const rows = await db.select({ roomId: eventRooms.roomId }).from(eventRooms).where(eq(eventRooms.eventId, eventId));
  return rows.map((r) => r.roomId);
}

/** Overí, že miestnosti existujú a užívateľ je ich členom. */
async function verifyRoomsMembership(roomIds: string[], userId: string): Promise<void> {
  if (roomIds.length === 0) return;
  const rows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .innerJoin(chatRooms, eq(roomMembers.roomId, chatRooms.id))
    .where(and(inArray(roomMembers.roomId, roomIds), eq(roomMembers.userId, userId)));
  if (new Set(rows.map((r) => r.roomId)).size !== new Set(roomIds).size) {
    throw new BadRequestError('Zdieľať sa dá len so skupinami, ktorých si členom');
  }
}

/**
 * Načíta udalosť a overí viditeľnosť (ladenie 07/2026): 'private' vidí len
 * tvorca, 'rooms' tvorca + členovia priradených miestností, 'family' všetci.
 */
async function getEventRow(eventId: string, viewerId: string): Promise<EventRow> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  const event = rows[0];
  if (!event) throw new NotFoundError('Udalosť nenájdená');
  if (event.createdBy !== viewerId && event.visibility !== 'family') {
    if (event.visibility === 'private') throw new NotFoundError('Udalosť nenájdená');
    const mine = await viewerRoomIds(viewerId);
    const shared = await eventRoomIdsOf(eventId);
    if (!shared.some((r) => mine.has(r))) throw new NotFoundError('Udalosť nenájdená');
  }
  return event;
}

// ── Hydratácia ───────────────────────────────────────────────────────────────

async function hydrateEvents(rows: EventRow[], viewerId: string): Promise<EventPublic[]> {
  if (rows.length === 0) return [];
  const eventIds = rows.map((r) => r.id);
  const rsvpRows = await db
    .select()
    .from(eventRsvps)
    .where(inArray(eventRsvps.eventId, eventIds));
  const mediaRows = await db
    .select({ eventId: eventMedia.eventId, media })
    .from(eventMedia)
    .innerJoin(media, eq(eventMedia.mediaId, media.id))
    .where(inArray(eventMedia.eventId, eventIds))
    .orderBy(asc(eventMedia.eventId), asc(eventMedia.order));
  const mediaMap = new Map<string, ReturnType<typeof toMediaPublic>[]>();
  for (const r of mediaRows) {
    const list = mediaMap.get(r.eventId) ?? [];
    list.push(toMediaPublic(r.media));
    mediaMap.set(r.eventId, list);
  }
  const authors = await fetchAuthors([
    ...rows.map((r) => r.createdBy),
    ...rsvpRows.map((r) => r.userId),
  ]);
  const roomRows = await db
    .select()
    .from(eventRooms)
    .where(inArray(eventRooms.eventId, eventIds));
  const roomsMap = new Map<string, string[]>();
  for (const r of roomRows) {
    const list = roomsMap.get(r.eventId) ?? [];
    list.push(r.roomId);
    roomsMap.set(r.eventId, list);
  }

  return rows.map((row) => {
    const mine = rsvpRows.find((r) => r.eventId === row.id && r.userId === viewerId);
    const by = (status: RsvpStatus) =>
      rsvpRows
        .filter((r) => r.eventId === row.id && r.status === status)
        .map((r) => authors.get(r.userId)!)
        .filter(Boolean);
    return {
      id: row.id,
      title: row.title,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      allDay: row.allDay,
      location: row.location,
      bodyMd: row.bodyMd,
      source: row.source,
      createdBy: authors.get(row.createdBy)!,
      rsvp: row.rsvp,
      rsvps: { yes: by('yes'), no: by('no'), maybe: by('maybe') },
      myRsvp: mine?.status ?? null,
      media: mediaMap.get(row.id) ?? [],
      visibility: row.visibility,
      roomIds: roomsMap.get(row.id) ?? [],
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** Overí existenciu médií — family-wide, ako albumy (fotky iných z feedu). */
async function verifyMediaExist(mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const found = await db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds));
  if (found.length !== new Set(mediaIds).size) {
    throw new BadRequestError('Niektoré fotky neexistujú');
  }
}

/** Pridá fotky do udalosti (z výberu vo feede/chate alebo composera). */
export async function addEventMedia(eventId: string, viewerId: string, mediaIds: string[]): Promise<EventPublic> {
  await getEventRow(eventId, viewerId);
  const unique = [...new Set(mediaIds)];
  await verifyMediaExist(unique);
  const maxOrder = await db
    .select({ max: sql<number>`coalesce(max("order"), 0)::int` })
    .from(eventMedia)
    .where(eq(eventMedia.eventId, eventId));
  await db
    .insert(eventMedia)
    .values(unique.map((mediaId, i) => ({ eventId, mediaId, order: (maxOrder[0]?.max ?? 0) + 1 + i })))
    .onConflictDoNothing();
  await publishCrossProcess(APP_TOPIC, { t: 'event:update', eventId });
  return getEvent(eventId, viewerId);
}

/** Odstráni fotku z udalosti (autor udalosti alebo admin). */
export async function removeEventMedia(
  eventId: string,
  userId: string,
  isAdmin: boolean,
  mediaId: string,
): Promise<EventPublic> {
  const event = await getEventRow(eventId, userId);
  if (event.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Fotku z udalosti odstráni len jej autor alebo admin');
  }
  await db.delete(eventMedia).where(and(eq(eventMedia.eventId, eventId), eq(eventMedia.mediaId, mediaId)));
  await publishCrossProcess(APP_TOPIC, { t: 'event:update', eventId });
  return getEvent(eventId, userId);
}

export async function getEvent(eventId: string, viewerId: string): Promise<EventPublic> {
  const [pub] = await hydrateEvents([await getEventRow(eventId, viewerId)], viewerId);
  return pub!;
}

// ── Agenda (udalosti + virtuálne narodeniny) ────────────────────────────────

/** Výskyty narodenín v intervale — počítané z users.birthday, bez DB riadkov. */
async function birthdaysBetween(from: Date, to: Date): Promise<BirthdayPublic[]> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, birthday: users.birthday })
    .from(users)
    .where(sql`${users.birthday} IS NOT NULL`);

  const out: BirthdayPublic[] = [];
  for (const u of rows) {
    const [by, bm, bd] = u.birthday!.split('-').map(Number);
    for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year++) {
      const occurrence = new Date(Date.UTC(year, bm! - 1, bd));
      if (occurrence >= from && occurrence <= to) {
        out.push({
          user: { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl },
          date: occurrence.toISOString().slice(0, 10),
          // Rok < 1900 berieme ako „nechcem uvádzať vek".
          age: by && by >= 1900 ? year - by : null,
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function listAgenda(from: Date, to: Date, viewerId: string): Promise<AgendaResponse> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        isNull(events.deletedAt),
        // Narodeninové riadky sú len nosič feed karty — agenda ich počíta virtuálne.
        sql`${events.source} <> 'birthday'`,
        gte(events.startsAt, from),
        lte(events.startsAt, to),
      ),
    )
    .orderBy(asc(events.startsAt));
  // Viditeľnosť (ladenie 07/2026): private len tvorca, rooms členovia miestností.
  const mine = await viewerRoomIds(viewerId);
  const shares = await db.select().from(eventRooms);
  const sharedWithMe = new Set(shares.filter((sh) => mine.has(sh.roomId)).map((sh) => sh.eventId));
  const visible = rows.filter(
    (e) =>
      e.visibility === 'family' ||
      e.createdBy === viewerId ||
      (e.visibility === 'rooms' && sharedWithMe.has(e.id)),
  );
  return {
    events: await hydrateEvents(visible, viewerId),
    birthdays: await birthdaysBetween(from, to),
  };
}

// ── Operácie ─────────────────────────────────────────────────────────────────

/** Pripomienky deň a hodinu vopred (worker skontroluje, či sa čas nezmenil). */
async function scheduleReminders(event: EventRow): Promise<void> {
  const startsAtIso = event.startsAt.toISOString();
  for (const [label, offsetMs] of [
    ['deň', 24 * 60 * 60 * 1000],
    ['hodinu', 60 * 60 * 1000],
  ] as const) {
    const runAt = new Date(event.startsAt.getTime() - offsetMs);
    if (runAt > new Date()) {
      await enqueueJob('events.remind', { eventId: event.id, startsAtExpected: startsAtIso, label }, { runAt });
    }
  }
}

export async function createEvent(creatorId: string, input: CreateEventInput): Promise<EventPublic> {
  const startsAt = new Date(input.startsAt);
  if (startsAt < new Date(Date.now() - 60_000)) {
    throw new BadRequestError('Udalosť nemôže začínať v minulosti');
  }
  const roomIds = [...new Set(input.roomIds)];
  if (input.visibility === 'rooms') {
    if (roomIds.length === 0) throw new BadRequestError('Vyber aspoň jednu skupinu');
    await verifyRoomsMembership(roomIds, creatorId);
  }

  const inserted = await db
    .insert(events)
    .values({
      title: input.title,
      startsAt,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      allDay: input.allDay,
      location: input.location,
      bodyMd: input.bodyMd,
      rsvp: input.rsvp,
      visibility: input.visibility,
      createdBy: creatorId,
    })
    .returning();
  const event = inserted[0]!;

  if (input.visibility === 'rooms' && roomIds.length > 0) {
    await db.insert(eventRooms).values(roomIds.map((roomId) => ({ eventId: event.id, roomId })));
  }

  // Pozvánka: autor ide automaticky (usporadúva to on). Bez pozvánky žiadne RSVP.
  if (input.rsvp) {
    await db.insert(eventRsvps).values({ eventId: event.id, userId: creatorId, status: 'yes' });
  }

  const mediaIds = [...new Set(input.mediaIds)];
  if (mediaIds.length > 0) {
    await verifyMediaExist(mediaIds);
    await db.insert(eventMedia).values(mediaIds.map((mediaId, order) => ({ eventId: event.id, mediaId, order })));
  }

  // Feed karta len pri rodinnej udalosti — súkromnú/skupinovú by videli všetci.
  if (input.toFeed && input.visibility === 'family') {
    await db.insert(feedCards).values({ module: 'events', entityId: event.id, authorId: creatorId });
    await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'events', entityId: event.id });
  }
  await scheduleReminders(event);
  await publishCrossProcess(APP_TOPIC, { t: 'event:update', eventId: event.id });
  return getEvent(event.id, creatorId);
}

export async function updateEvent(
  eventId: string,
  userId: string,
  isAdmin: boolean,
  input: UpdateEventInput,
): Promise<EventPublic> {
  const event = await getEventRow(eventId, userId);
  if (event.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Udalosť môže upraviť len jej autor alebo admin');
  }

  // Zmena viditeľnosti (bod 6 — parita s tvorbou). Pri 'rooms' overíme členstvo
  // a prepíšeme väzby; pri prechode mimo 'family' zmažeme feed kartu, nech sa
  // udalosť neukáže celej rodine.
  if (input.visibility !== undefined) {
    const roomIds = [...new Set(input.roomIds ?? [])];
    if (input.visibility === 'rooms') {
      if (roomIds.length === 0) throw new BadRequestError('Vyber aspoň jednu skupinu');
      await verifyRoomsMembership(roomIds, userId);
      await db.delete(eventRooms).where(eq(eventRooms.eventId, eventId));
      await db.insert(eventRooms).values(roomIds.map((roomId) => ({ eventId, roomId })));
    } else {
      await db.delete(eventRooms).where(eq(eventRooms.eventId, eventId));
    }
    if (input.visibility !== 'family') {
      await db.delete(feedCards).where(and(eq(feedCards.module, 'events'), eq(feedCards.entityId, eventId)));
      await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'events', entityId: eventId });
    }
  }

  const updated = await db
    .update(events)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
      ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.bodyMd !== undefined ? { bodyMd: input.bodyMd } : {}),
      ...(input.rsvp !== undefined ? { rsvp: input.rsvp } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    })
    .where(eq(events.id, eventId))
    .returning();

  // Zapnutie pozvánky → autor ide automaticky (ak ešte nepotvrdil).
  if (input.rsvp === true && !event.rsvp) {
    await db
      .insert(eventRsvps)
      .values({ eventId, userId: event.createdBy, status: 'yes' })
      .onConflictDoNothing();
  }

  // Zmena času → nové pripomienky (staré sa samé zahodia — startsAt už nesedí).
  if (input.startsAt !== undefined && updated[0]!.startsAt.getTime() !== event.startsAt.getTime()) {
    await scheduleReminders(updated[0]!);
  }
  await publishCrossProcess(APP_TOPIC, { t: 'event:update', eventId });
  return getEvent(eventId, userId);
}

export async function deleteEvent(eventId: string, userId: string, isAdmin: boolean): Promise<void> {
  const event = await getEventRow(eventId, userId);
  if (event.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Udalosť môže zmazať len jej autor alebo admin');
  }
  await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, eventId));
  await db.delete(feedCards).where(and(eq(feedCards.module, 'events'), eq(feedCards.entityId, eventId)));
  await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'events', entityId: eventId });
  await publishCrossProcess(APP_TOPIC, { t: 'event:update', eventId });
}

export async function setRsvp(eventId: string, userId: string, status: RsvpStatus): Promise<EventPublic> {
  const event = await getEventRow(eventId, userId);
  if (event.source === 'birthday') throw new BadRequestError('Na narodeniny sa nechodí cez RSVP 🙂');
  if (!event.rsvp) throw new BadRequestError('Táto udalosť nezbiera účasť');
  await db
    .insert(eventRsvps)
    .values({ eventId, userId, status })
    .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.userId], set: { status } });
  await publishCrossProcess(APP_TOPIC, { t: 'event:update', eventId });
  return getEvent(eventId, userId);
}

// ── ICS feed (read-only subscribe) ──────────────────────────────────────────

/**
 * Bearer token pre read-only ICS feed. Odvodený VÝHRADNE z ICS_SECRET —
 * bez neho je feed vypnutý (null), nikdy sa nepoužije predvídateľná náhrada.
 */
export function icsToken(): string | null {
  if (!env.ICS_SECRET) return null;
  return sha256Hex(`rodinna-ics:${env.ICS_SECRET}`).slice(0, 40);
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** VCALENDAR: manuálne udalosti (od -30 d) + narodeniny ako ročné RRULE. */
export async function buildIcs(): Promise<string> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        isNull(events.deletedAt),
        sql`${events.source} <> 'birthday'`,
        eq(events.visibility, 'family'),
        gte(events.startsAt, since),
      ),
    )
    .orderBy(asc(events.startsAt));
  const people = await db
    .select({ id: users.id, displayName: users.displayName, birthday: users.birthday })
    .from(users)
    .where(sql`${users.birthday} IS NOT NULL`);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rodinna siet//SK',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Rodinná sieť',
    // Hint pre Apple/Google Calendar, ako často obnovovať odber (ladenie, bod 5).
    // Bez toho iOS cachuje feed veľmi dlho → nové udalosti sa objavia neskoro.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of rows) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@rodinna`,
      `DTSTAMP:${icsDateTime(e.createdAt)}`,
      e.allDay
        ? `DTSTART;VALUE=DATE:${e.startsAt.toISOString().slice(0, 10).replace(/-/g, '')}`
        : `DTSTART:${icsDateTime(e.startsAt)}`,
      ...(e.endsAt && !e.allDay ? [`DTEND:${icsDateTime(e.endsAt)}`] : []),
      `SUMMARY:${icsEscape(e.title)}`,
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      'END:VEVENT',
    );
  }
  for (const p of people) {
    const [, m, d] = p.birthday!.split('-');
    lines.push(
      'BEGIN:VEVENT',
      `UID:bday-${p.id}@rodinna`,
      `DTSTAMP:${icsDateTime(new Date())}`,
      // Najbližší výskyt + ročné opakovanie.
      `DTSTART;VALUE=DATE:${new Date().getUTCFullYear()}${m}${d}`,
      'RRULE:FREQ=YEARLY',
      `SUMMARY:🎂 ${icsEscape(p.displayName)} — narodeniny`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ── Worker joby ──────────────────────────────────────────────────────────────

/** Pripomienka: len ak udalosť stále existuje a čas sa nezmenil. */
export async function sendReminder(eventId: string, startsAtExpected: string, label: string): Promise<void> {
  const event = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  const e = event[0];
  if (!e || e.startsAt.toISOString() !== startsAtExpected) return;

  // Príjemcovia: autor + prihlásení (yes/maybe) — „nie" nechceme otravovať.
  const rsvpRows = await db
    .select({ userId: eventRsvps.userId, status: eventRsvps.status })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, eventId));
  const recipients = [
    ...new Set([e.createdBy, ...rsvpRows.filter((r) => r.status !== 'no').map((r) => r.userId)]),
  ];

  const time = e.allDay
    ? ''
    : ` o ${e.startsAt.toISOString().slice(11, 16)} UTC`;
  const { notifyUsers } = await import('../notifications/service');
  await notifyUsers(recipients, 'events.reminder', {
    title: label === 'deň' ? `Zajtra: ${e.title}` : `O hodinu: ${e.title}`,
    body: `${e.title}${time}${e.location ? ` · ${e.location}` : ''}`,
    url: '/',
    tag: `event-${eventId}`,
  });
}

/**
 * Denný beh: dnešní oslávenci dostanú kartu vo Feede (materializovaný
 * riadok source='birthday' ako nosič entity) a rodina push; o 3 dni vopred
 * ide len push pripomienka.
 */
export async function processBirthdays(now = new Date()): Promise<void> {
  const people = await db
    .select()
    .from(users)
    .where(sql`${users.birthday} IS NOT NULL`);
  const { notifyUsers } = await import('../notifications/service');
  const allIds = (await db.select({ id: users.id }).from(users)).map((u) => u.id);

  const md = (d: Date) => [d.getUTCMonth() + 1, d.getUTCDate()] as const;
  const [tm, td] = md(now);
  const in3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const [t3m, t3d] = md(in3);

  for (const p of people) {
    const [, bm, bd] = p.birthday!.split('-').map(Number);

    if (bm === tm && bd === td) {
      // Dedupe: jeden materializovaný riadok na oslávenca a rok.
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), tm - 1, td));
      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.source, 'birthday'),
            eq(events.subjectUserId, p.id),
            eq(events.startsAt, dayStart),
          ),
        )
        .limit(1);
      if (existing[0]) continue;

      const inserted = await db
        .insert(events)
        .values({
          title: `🎂 ${p.displayName} má dnes narodeniny!`,
          startsAt: dayStart,
          allDay: true,
          source: 'birthday',
          subjectUserId: p.id,
          createdBy: p.id,
        })
        .returning();
      const ev = inserted[0]!;
      await db.insert(feedCards).values({ module: 'events', entityId: ev.id, authorId: p.id });
      await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'events', entityId: ev.id });
      await notifyUsers(
        allIds.filter((id) => id !== p.id),
        'events.birthday',
        {
          title: `🎂 ${p.displayName} má dnes narodeniny!`,
          body: 'Nezabudni zagratulovať.',
          url: '/',
          tag: `bday-${p.id}`,
        },
      );
    } else if (bm === t3m && bd === t3d) {
      await notifyUsers(
        allIds.filter((id) => id !== p.id),
        'events.birthday',
        {
          title: `O 3 dni má ${p.displayName} narodeniny 🎂`,
          body: 'Čas vymyslieť darček.',
          url: '/',
          tag: `bday-soon-${p.id}`,
        },
      );
    }
  }
}
