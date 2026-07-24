import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  CreateNoteInput,
  NoteDetail,
  NoteRevision,
  NoteSummary,
  PostAuthor,
  UpdateNoteInput,
  UpdateNoteItemInput,
} from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { chatRooms, media, noteItems, noteMedia, noteRevisions, noteRooms, notes, roomMembers, users, type NoteRow } from '../../core/db/schema';
import { APP_TOPIC } from '../../core/realtime';
import { publishCrossProcess } from '../../core/events';
import { toMediaPublic } from '../media/service';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

async function fetchAuthors(userIds: (string | null)[]): Promise<Map<string, PostAuthor>> {
  const ids = [...new Set(userIds.filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, nameColor: users.nameColor })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Overí existenciu médií — zámerne bez vlastníckej kontroly (family-wide,
 * ako albumy): do poznámky sa pridávajú aj fotky iných z feedu/chatu.
 */
async function verifyMediaExist(mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const found = await db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds));
  if (found.length !== new Set(mediaIds).size) {
    throw new BadRequestError('Niektoré fotky neexistujú');
  }
}

async function fetchNoteMedia(noteId: string) {
  const rows = await db
    .select({ media })
    .from(noteMedia)
    .innerJoin(media, eq(noteMedia.mediaId, media.id))
    .where(eq(noteMedia.noteId, noteId))
    .orderBy(asc(noteMedia.order), asc(noteMedia.id));
  return rows.map((r) => toMediaPublic(r.media));
}

/** Množina miestností, ktorých je viewer členom (na 'rooms' viditeľnosť). */
async function viewerRoomIds(viewerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.userId, viewerId));
  return new Set(rows.map((r) => r.roomId));
}

async function noteRoomIds(noteId: string): Promise<string[]> {
  const rows = await db.select({ roomId: noteRooms.roomId }).from(noteRooms).where(eq(noteRooms.noteId, noteId));
  return rows.map((r) => r.roomId);
}

/**
 * Overí, že miestnosti existujú a užívateľ je ich členom — s cudzou
 * miestnosťou sa zdieľať nedá.
 */
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
 * Načíta poznámku a overí viditeľnosť (ladenie 07/2026): 'private' vidí
 * len autor, 'rooms' autor + členovia priradených miestností — pre
 * ostatných (aj admina) sa tvári ako neexistujúca.
 */
async function getNoteRow(noteId: string, viewerId: string): Promise<NoteRow> {
  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .limit(1);
  const note = rows[0];
  if (!note) throw new NotFoundError('Zoznam/poznámka nenájdená');
  if (note.createdBy !== viewerId) {
    if (note.visibility === 'private') throw new NotFoundError('Zoznam/poznámka nenájdená');
    if (note.visibility === 'rooms') {
      const mine = await viewerRoomIds(viewerId);
      const shared = await noteRoomIds(noteId);
      if (!shared.some((r) => mine.has(r))) throw new NotFoundError('Zoznam/poznámka nenájdená');
    }
  }
  return note;
}

/** Každá zmena: updatedBy/updatedAt + WS event pre živé karty a modul. */
async function touch(noteId: string, userId: string): Promise<void> {
  await db.update(notes).set({ updatedBy: userId, updatedAt: new Date() }).where(eq(notes.id, noteId));
  await publishCrossProcess(APP_TOPIC, { t: 'note:update', noteId });
}

// ── Čítanie ──────────────────────────────────────────────────────────────────

async function buildSummaries(rows: NoteRow[]): Promise<NoteSummary[]> {
  if (rows.length === 0) return [];
  const stats = await db
    .select({
      noteId: noteItems.noteId,
      total: sql<number>`count(*)::int`,
      checked: sql<number>`count(*) FILTER (WHERE ${noteItems.checkedAt} IS NOT NULL)::int`,
    })
    .from(noteItems)
    .where(inArray(noteItems.noteId, rows.map((r) => r.id)))
    .groupBy(noteItems.noteId);
  const statMap = new Map(stats.map((s) => [s.noteId, s]));
  const authors = await fetchAuthors(rows.flatMap((r) => [r.createdBy, r.updatedBy]));

  // Zdieľané podskupiny per poznámka (na avatary v zozname).
  const shareRows = await db.select().from(noteRooms).where(inArray(noteRooms.noteId, rows.map((r) => r.id)));
  const roomsByNote = new Map<string, string[]>();
  for (const s of shareRows) {
    const arr = roomsByNote.get(s.noteId) ?? [];
    arr.push(s.roomId);
    roomsByNote.set(s.noteId, arr);
  }

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    visibility: row.visibility,
    title: row.title,
    pinned: row.pinned,
    createdBy: authors.get(row.createdBy)!,
    updatedBy: row.updatedBy ? (authors.get(row.updatedBy) ?? null) : null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    itemsTotal: statMap.get(row.id)?.total ?? 0,
    itemsChecked: statMap.get(row.id)?.checked ?? 0,
    roomIds: roomsByNote.get(row.id) ?? [],
  }));
}

export async function listNotes(viewerId: string): Promise<NoteSummary[]> {
  const all = await db.select().from(notes).where(isNull(notes.deletedAt));
  const mine = await viewerRoomIds(viewerId);
  const shares = await db.select().from(noteRooms);
  const sharedWithMe = new Set(shares.filter((sh) => mine.has(sh.roomId)).map((sh) => sh.noteId));
  // Súkromné vidí len autor; 'rooms' autor + členovia priradených miestností.
  const rows = all.filter(
    (n) =>
      n.visibility === 'family' ||
      n.createdBy === viewerId ||
      (n.visibility === 'rooms' && sharedWithMe.has(n.id)),
  );
  const summaries = await buildSummaries(rows);
  // Pripnuté hore, potom podľa poslednej aktivity.
  return summaries.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function getNote(noteId: string, viewerId: string): Promise<NoteDetail> {
  const row = await getNoteRow(noteId, viewerId);
  const [summary] = await buildSummaries([row]);

  const itemRows = await db
    .select()
    .from(noteItems)
    .where(eq(noteItems.noteId, noteId))
    .orderBy(asc(noteItems.order), asc(noteItems.createdAt));
  const authors = await fetchAuthors(itemRows.flatMap((i) => [i.checkedBy, i.assignedTo]));

  const revCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, noteId));

  return {
    ...summary!,
    bodyMd: row.bodyMd,
    items: itemRows.map((i) => ({
      id: i.id,
      label: i.label,
      checkedBy: i.checkedBy ? (authors.get(i.checkedBy) ?? null) : null,
      checkedAt: i.checkedAt?.toISOString() ?? null,
      assignedTo: i.assignedTo ? (authors.get(i.assignedTo) ?? null) : null,
      order: i.order,
    })),
    media: await fetchNoteMedia(noteId),
    roomIds: row.visibility === 'rooms' ? await noteRoomIds(noteId) : [],
    revisionCount: revCount[0]?.count ?? 0,
  };
}

// ── Zápis ────────────────────────────────────────────────────────────────────

export async function createNote(creatorId: string, input: CreateNoteInput): Promise<NoteDetail> {
  if (input.kind === 'note' && input.items.length > 0) {
    throw new BadRequestError('Poznámka nemá položky — použi zoznam');
  }
  const mediaIds = [...new Set(input.mediaIds)];
  await verifyMediaExist(mediaIds);
  const roomIds = [...new Set(input.roomIds)];
  if (input.visibility === 'rooms') {
    if (roomIds.length === 0) throw new BadRequestError('Vyber aspoň jednu skupinu');
    await verifyRoomsMembership(roomIds, creatorId);
  }

  const inserted = await db
    .insert(notes)
    .values({
      kind: input.kind,
      visibility: input.visibility,
      title: input.title,
      bodyMd: input.bodyMd,
      createdBy: creatorId,
      updatedBy: creatorId,
    })
    .returning();
  const note = inserted[0]!;

  if (input.items.length > 0) {
    await db
      .insert(noteItems)
      .values(input.items.map((label, order) => ({ noteId: note.id, label, order })));
  }
  if (mediaIds.length > 0) {
    await db.insert(noteMedia).values(mediaIds.map((mediaId, order) => ({ noteId: note.id, mediaId, order })));
  }
  if (input.visibility === 'rooms' && roomIds.length > 0) {
    await db.insert(noteRooms).values(roomIds.map((roomId) => ({ noteId: note.id, roomId })));
  }
  await publishCrossProcess(APP_TOPIC, { t: 'note:update', noteId: note.id });

  // Novinka pre tých, čo ju vidia (ladenie 07/2026) — súkromná nikoho neruší.
  if (input.visibility !== 'private') {
    const { notifyUsers, allUserIdsExcept, roomMemberIdsExcept } = await import('../notifications/service');
    const recipients =
      input.visibility === 'family'
        ? await allUserIdsExcept(creatorId)
        : await roomMemberIdsExcept(roomIds, creatorId);
    const who = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, creatorId)).limit(1);
    await notifyUsers(recipients, 'notes.shared', {
      title: input.kind === 'list' ? 'Nový zoznam' : 'Nová poznámka',
      body: `${who[0]?.displayName ?? 'Niekto'}: „${input.title}"`,
      url: '/',
      tag: `note-${note.id}`,
    });
  }

  return getNote(note.id, creatorId);
}

/** Pridá fotky do poznámky (z výberu vo feede/chate alebo composera). */
export async function addNoteMedia(noteId: string, userId: string, mediaIds: string[]): Promise<NoteDetail> {
  await getNoteRow(noteId, userId);
  const unique = [...new Set(mediaIds)];
  await verifyMediaExist(unique);
  const maxOrder = await db
    .select({ max: sql<number>`coalesce(max("order"), 0)::int` })
    .from(noteMedia)
    .where(eq(noteMedia.noteId, noteId));
  await db
    .insert(noteMedia)
    .values(unique.map((mediaId, i) => ({ noteId, mediaId, order: (maxOrder[0]?.max ?? 0) + 1 + i })))
    .onConflictDoNothing();
  await touch(noteId, userId);
  return getNote(noteId, userId);
}

/** Odstráni fotku z poznámky (family-wide, ako editácia textu). */
export async function removeNoteMedia(noteId: string, userId: string, mediaId: string): Promise<NoteDetail> {
  await getNoteRow(noteId, userId);
  await db.delete(noteMedia).where(and(eq(noteMedia.noteId, noteId), eq(noteMedia.mediaId, mediaId)));
  await touch(noteId, userId);
  return getNote(noteId, userId);
}

export async function updateNote(noteId: string, userId: string, input: UpdateNoteInput): Promise<NoteDetail> {
  const note = await getNoteRow(noteId, userId);
  const visibilityChange =
    (input.visibility !== undefined && input.visibility !== note.visibility) || input.roomIds !== undefined;
  if (visibilityChange && note.createdBy !== userId) {
    throw new ForbiddenError('Viditeľnosť poznámky mení len jej autor');
  }
  const nextVisibility = input.visibility ?? note.visibility;
  if (input.roomIds !== undefined || input.visibility !== undefined) {
    const roomIds = [...new Set(input.roomIds ?? (await noteRoomIds(noteId)))];
    if (nextVisibility === 'rooms') {
      if (roomIds.length === 0) throw new BadRequestError('Vyber aspoň jednu skupinu');
      await verifyRoomsMembership(roomIds, userId);
      await db.delete(noteRooms).where(eq(noteRooms.noteId, noteId));
      await db.insert(noteRooms).values(roomIds.map((roomId) => ({ noteId, roomId })));
    } else {
      await db.delete(noteRooms).where(eq(noteRooms.noteId, noteId));
    }
  }

  // Zmena textu: predchádzajúci obsah do revízií (história verzií).
  // Auto-save (ladenie 07/2026) ukladá po každej pauze v písaní — aby z jednej
  // úpravy nevznikli desiatky verzií, revízie sa v 15-min okne toho istého
  // autora zlučujú (najstaršia = stav pred začiatkom písania, čo je to, čo
  // chce užívateľ obnoviť).
  if (input.bodyMd !== undefined && input.bodyMd !== note.bodyMd) {
    if (note.bodyMd.trim().length > 0) {
      const lastAuthor = note.updatedBy ?? note.createdBy;
      const recent = await db
        .select({ id: noteRevisions.id, savedBy: noteRevisions.savedBy, savedAt: noteRevisions.savedAt })
        .from(noteRevisions)
        .where(eq(noteRevisions.noteId, noteId))
        .orderBy(desc(noteRevisions.savedAt))
        .limit(1);
      const last = recent[0];
      const mergeable =
        last !== undefined &&
        last.savedBy === lastAuthor &&
        Date.now() - last.savedAt.getTime() < 15 * 60 * 1000;
      if (!mergeable) {
        await db.insert(noteRevisions).values({ noteId, bodyMd: note.bodyMd, savedBy: lastAuthor });
      }
    }
  }

  await db
    .update(notes)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.bodyMd !== undefined ? { bodyMd: input.bodyMd } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    })
    .where(eq(notes.id, noteId));
  await touch(noteId, userId);
  return getNote(noteId, userId);
}

export async function deleteNote(noteId: string, userId: string, isAdmin: boolean): Promise<void> {
  const note = await getNoteRow(noteId, userId);
  if (note.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Zmazať môže len autor alebo admin');
  }
  await db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, noteId));
  await publishCrossProcess(APP_TOPIC, { t: 'note:update', noteId });
}

export async function addItem(noteId: string, userId: string, label: string): Promise<NoteDetail> {
  const note = await getNoteRow(noteId, userId);
  if (note.kind !== 'list') throw new BadRequestError('Položky má len zoznam');
  const maxOrder = await db
    .select({ max: sql<number>`coalesce(max("order"), 0)::int` })
    .from(noteItems)
    .where(eq(noteItems.noteId, noteId));
  await db.insert(noteItems).values({ noteId, label, order: (maxOrder[0]?.max ?? 0) + 1 });
  await touch(noteId, userId);
  return getNote(noteId, userId);
}

export async function updateItem(
  itemId: string,
  userId: string,
  input: UpdateNoteItemInput,
): Promise<NoteDetail> {
  const rows = await db.select().from(noteItems).where(eq(noteItems.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new NotFoundError('Položka nenájdená');
  await getNoteRow(item.noteId, userId); // 404 pre zmazaný/súkromný zoznam

  if (input.assignedTo) {
    const u = await db.select({ id: users.id }).from(users).where(eq(users.id, input.assignedTo));
    if (!u[0]) throw new BadRequestError('Taký člen rodiny neexistuje');
  }

  await db
    .update(noteItems)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.checked !== undefined
        ? input.checked
          ? { checkedBy: userId, checkedAt: new Date() }
          : { checkedBy: null, checkedAt: null }
        : {}),
      ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
    })
    .where(eq(noteItems.id, itemId));
  await touch(item.noteId, userId);
  return getNote(item.noteId, userId);
}

export async function deleteItem(itemId: string, userId: string): Promise<NoteDetail> {
  const rows = await db.select().from(noteItems).where(eq(noteItems.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new NotFoundError('Položka nenájdená');
  await getNoteRow(item.noteId, userId); // 404 pre súkromný zoznam iného autora
  await db.delete(noteItems).where(eq(noteItems.id, itemId));
  await touch(item.noteId, userId);
  return getNote(item.noteId, userId);
}

/** „Šablóna": duplikát zoznamu s odškrtnutím zmazaným (týždenný nákup a pod.). */
export async function duplicateNote(noteId: string, userId: string, title?: string): Promise<NoteDetail> {
  const note = await getNoteRow(noteId, userId);
  const items = await db
    .select({ label: noteItems.label })
    .from(noteItems)
    .where(eq(noteItems.noteId, noteId))
    .orderBy(asc(noteItems.order), asc(noteItems.createdAt));
  return createNote(userId, {
    kind: note.kind,
    visibility: note.visibility,
    title: title ?? `${note.title} (kópia)`,
    bodyMd: note.bodyMd,
    items: items.map((i) => i.label),
    mediaIds: [],
    roomIds: note.visibility === 'rooms' ? await noteRoomIds(noteId) : [],
  });
}

// ── Revízie ──────────────────────────────────────────────────────────────────

export async function listRevisions(noteId: string, viewerId: string): Promise<NoteRevision[]> {
  await getNoteRow(noteId, viewerId);
  const rows = await db
    .select()
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, noteId))
    .orderBy(desc(noteRevisions.savedAt))
    .limit(50);
  const authors = await fetchAuthors(rows.map((r) => r.savedBy));
  return rows.map((r) => ({
    id: r.id,
    bodyMd: r.bodyMd,
    savedBy: r.savedBy ? (authors.get(r.savedBy) ?? null) : null,
    savedAt: r.savedAt.toISOString(),
  }));
}

export async function restoreRevision(noteId: string, revisionId: string, userId: string): Promise<NoteDetail> {
  const rows = await db
    .select()
    .from(noteRevisions)
    .where(and(eq(noteRevisions.id, revisionId), eq(noteRevisions.noteId, noteId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Revízia nenájdená');
  return updateNote(noteId, userId, { bodyMd: rows[0].bodyMd });
}
