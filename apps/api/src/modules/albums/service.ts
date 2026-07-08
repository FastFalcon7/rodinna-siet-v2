import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type {
  AlbumDetail,
  AlbumSuggestion,
  AlbumSummary,
  CreateAlbumInput,
  MemoryPublic,
  PostAuthor,
  UpdateAlbumInput,
} from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import {
  albumPhotos,
  albums,
  feedCards,
  media,
  memoryMarks,
  users,
  type AlbumRow,
} from '../../core/db/schema';
import { APP_TOPIC } from '../../core/realtime';
import { publishCrossProcess } from '../../core/events';
import { toMediaPublic } from '../media/service';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

const SUGGESTION_MIN_PHOTOS = 5;
const SUGGESTION_MAX_DAYS = 5;

async function fetchAuthors(userIds: string[]): Promise<Map<string, PostAuthor>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Overí existenciu médií. Zámerne bez vlastníckej kontroly — viditeľnosť
 * je family-wide (§7) a Zberač skladá album z fotiek viacerých autorov.
 */
async function verifyMediaExist(mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const found = await db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds));
  if (found.length !== new Set(mediaIds).size) {
    throw new BadRequestError('Niektoré fotky neexistujú');
  }
}

async function getAlbumRow(albumId: string): Promise<AlbumRow> {
  const rows = await db.select().from(albums).where(eq(albums.id, albumId)).limit(1);
  if (!rows[0]) throw new NotFoundError('Album nenájdený');
  return rows[0];
}

// ── Hydratácia ───────────────────────────────────────────────────────────────

async function buildSummaries(rows: AlbumRow[]): Promise<AlbumSummary[]> {
  if (rows.length === 0) return [];
  const albumIds = rows.map((r) => r.id);

  const stats = await db
    .select({
      albumId: albumPhotos.albumId,
      count: sql<number>`count(*)::int`,
      lastAddedAt: max(albumPhotos.createdAt),
    })
    .from(albumPhotos)
    .where(inArray(albumPhotos.albumId, albumIds))
    .groupBy(albumPhotos.albumId);
  const statMap = new Map(stats.map((s) => [s.albumId, s]));

  // Obálka: explicitná, inak najnovšia fotka albumu.
  const explicitCoverIds = rows.map((r) => r.coverMediaId).filter((v): v is string => v !== null);
  const latest = await db
    .selectDistinctOn([albumPhotos.albumId], { albumId: albumPhotos.albumId, mediaId: albumPhotos.mediaId })
    .from(albumPhotos)
    .where(inArray(albumPhotos.albumId, albumIds))
    .orderBy(albumPhotos.albumId, desc(albumPhotos.createdAt), desc(albumPhotos.mediaId));
  const latestMap = new Map(latest.map((l) => [l.albumId, l.mediaId]));

  const coverIds = [
    ...new Set([...explicitCoverIds, ...latest.map((l) => l.mediaId)]),
  ];
  const coverRows = coverIds.length
    ? await db.select().from(media).where(inArray(media.id, coverIds))
    : [];
  const coverMap = new Map(coverRows.map((m) => [m.id, toMediaPublic(m)]));

  const authors = await fetchAuthors([...new Set(rows.map((r) => r.createdBy))]);

  return rows.map((row) => {
    const coverId = row.coverMediaId ?? latestMap.get(row.id) ?? null;
    const stat = statMap.get(row.id);
    return {
      id: row.id,
      title: row.title,
      cover: coverId ? (coverMap.get(coverId) ?? null) : null,
      photoCount: stat?.count ?? 0,
      createdBy: authors.get(row.createdBy)!,
      createdAt: row.createdAt.toISOString(),
      lastAddedAt: stat?.lastAddedAt?.toISOString() ?? null,
    };
  });
}

export async function listAlbums(): Promise<AlbumSummary[]> {
  const rows = await db.select().from(albums);
  const summaries = await buildSummaries(rows);
  // Najživšie hore (posledná pridaná fotka, potom založenie).
  return summaries.sort((a, b) =>
    (b.lastAddedAt ?? b.createdAt).localeCompare(a.lastAddedAt ?? a.createdAt),
  );
}

export async function getAlbum(albumId: string): Promise<AlbumDetail> {
  const row = await getAlbumRow(albumId);
  const [summary] = await buildSummaries([row]);

  const photoRows = await db
    .select({ media, addedBy: albumPhotos.addedBy, addedAt: albumPhotos.createdAt })
    .from(albumPhotos)
    .innerJoin(media, eq(albumPhotos.mediaId, media.id))
    .where(eq(albumPhotos.albumId, albumId))
    .orderBy(desc(albumPhotos.createdAt), desc(albumPhotos.mediaId));

  const adders = await fetchAuthors([
    ...new Set(photoRows.map((p) => p.addedBy).filter((v): v is string => v !== null)),
  ]);

  return {
    ...summary!,
    photos: photoRows.map((p) => ({
      media: toMediaPublic(p.media),
      addedBy: p.addedBy ? (adders.get(p.addedBy) ?? null) : null,
      addedAt: p.addedAt.toISOString(),
    })),
  };
}

// ── Operácie ─────────────────────────────────────────────────────────────────

export async function createAlbum(creatorId: string, input: CreateAlbumInput): Promise<AlbumDetail> {
  const mediaIds = [...new Set(input.mediaIds)];
  await verifyMediaExist(mediaIds);

  const inserted = await db.insert(albums).values({ title: input.title, createdBy: creatorId }).returning();
  const album = inserted[0]!;

  if (mediaIds.length > 0) {
    await db
      .insert(albumPhotos)
      .values(mediaIds.map((mediaId, order) => ({ albumId: album.id, mediaId, addedBy: creatorId, order })));
  }

  // Karta do Feedu (K1): „X založil album Y" — živá, ukazuje aktuálnu obálku/počet.
  await db.insert(feedCards).values({ module: 'albums', entityId: album.id, authorId: creatorId });
  await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'albums', entityId: album.id });

  return getAlbum(album.id);
}

export async function addPhotos(albumId: string, userId: string, mediaIds: string[]): Promise<AlbumDetail> {
  await getAlbumRow(albumId);
  const unique = [...new Set(mediaIds)];
  await verifyMediaExist(unique);
  await db
    .insert(albumPhotos)
    .values(unique.map((mediaId, order) => ({ albumId, mediaId, addedBy: userId, order })))
    .onConflictDoNothing();
  await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'albums', entityId: albumId });
  return getAlbum(albumId);
}

export async function removePhoto(
  albumId: string,
  mediaId: string,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  const album = await getAlbumRow(albumId);
  const rows = await db
    .select({ addedBy: albumPhotos.addedBy })
    .from(albumPhotos)
    .where(and(eq(albumPhotos.albumId, albumId), eq(albumPhotos.mediaId, mediaId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Fotka v albume nie je');
  const mayRemove = isAdmin || album.createdBy === userId || rows[0].addedBy === userId;
  if (!mayRemove) throw new ForbiddenError('Fotku môže odstrániť ten, kto ju pridal, autor albumu alebo admin');
  await db
    .delete(albumPhotos)
    .where(and(eq(albumPhotos.albumId, albumId), eq(albumPhotos.mediaId, mediaId)));
}

export async function updateAlbum(
  albumId: string,
  userId: string,
  isAdmin: boolean,
  input: UpdateAlbumInput,
): Promise<AlbumDetail> {
  const album = await getAlbumRow(albumId);
  if (album.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Album môže upraviť len jeho autor alebo admin');
  }
  if (input.coverMediaId) {
    const inAlbum = await db
      .select({ mediaId: albumPhotos.mediaId })
      .from(albumPhotos)
      .where(and(eq(albumPhotos.albumId, albumId), eq(albumPhotos.mediaId, input.coverMediaId)))
      .limit(1);
    if (!inAlbum[0]) throw new BadRequestError('Obálka musí byť fotka z albumu');
  }
  await db
    .update(albums)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.coverMediaId !== undefined ? { coverMediaId: input.coverMediaId } : {}),
    })
    .where(eq(albums.id, albumId));
  return getAlbum(albumId);
}

export async function deleteAlbum(albumId: string, userId: string, isAdmin: boolean): Promise<void> {
  const album = await getAlbumRow(albumId);
  if (album.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Album môže zmazať len jeho autor alebo admin');
  }
  await db.delete(albums).where(eq(albums.id, albumId));
  // Feed karta albumu už nemá čo ukazovať.
  await db.delete(feedCards).where(and(eq(feedCards.module, 'albums'), eq(feedCards.entityId, albumId)));
  await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'albums', entityId: albumId });
}

// ── Zberač (návrhy albumov) ─────────────────────────────────────────────────

/**
 * Fotky poslané do feedu/chatu, zoskupené po dňoch, ktoré ešte nie sú
 * v žiadnom albume — dni s ≥ SUGGESTION_MIN_PHOTOS fotkami sú kandidáti.
 * Deterministická heuristika bez LLM (plán §M2 „Zberač").
 */
export async function listSuggestions(): Promise<AlbumSuggestion[]> {
  const days = await db.execute<{ day: string; count: number }>(sql`
    SELECT to_char(m.created_at, 'YYYY-MM-DD') AS day, count(*)::int AS count
    FROM media m
    WHERE m.kind = 'image'
      AND (EXISTS (SELECT 1 FROM message_media mm WHERE mm.media_id = m.id)
        OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id))
      AND NOT EXISTS (SELECT 1 FROM album_photos ap WHERE ap.media_id = m.id)
    GROUP BY 1
    HAVING count(*) >= ${SUGGESTION_MIN_PHOTOS}
    ORDER BY 1 DESC
    LIMIT ${SUGGESTION_MAX_DAYS}
  `);

  const suggestions: AlbumSuggestion[] = [];
  for (const d of days) {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT m.id FROM media m
      WHERE m.kind = 'image'
        AND to_char(m.created_at, 'YYYY-MM-DD') = ${d.day}
        AND (EXISTS (SELECT 1 FROM message_media mm WHERE mm.media_id = m.id)
          OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id))
        AND NOT EXISTS (SELECT 1 FROM album_photos ap WHERE ap.media_id = m.id)
      ORDER BY m.created_at
    `);
    const mediaIds = rows.map((r) => r.id);
    const previewRows = await db.select().from(media).where(inArray(media.id, mediaIds.slice(0, 4)));
    suggestions.push({
      date: d.day,
      count: d.count,
      mediaIds,
      previews: previewRows.map(toMediaPublic),
    });
  }
  return suggestions;
}

// ── Spomienky („Na tento deň") ──────────────────────────────────────────────

export async function getMemory(mediaId: string): Promise<MemoryPublic> {
  const rows = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  const m = rows[0];
  if (!m) throw new NotFoundError('Spomienka nenájdená');
  const authors = await fetchAuthors([m.ownerId]);
  return {
    media: toMediaPublic(m),
    owner: authors.get(m.ownerId)!,
    yearsAgo: Math.max(1, new Date().getUTCFullYear() - m.createdAt.getUTCFullYear()),
    takenAt: m.createdAt.toISOString(),
  };
}

/** Skryť spomienku (globálne) + odstrániť jej kartu z feedu. */
export async function hideMemory(mediaId: string, userId: string): Promise<void> {
  await db.insert(memoryMarks).values({ mediaId, hiddenBy: userId }).onConflictDoNothing();
  await db.delete(feedCards).where(and(eq(feedCards.module, 'memories'), eq(feedCards.entityId, mediaId)));
  await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'memories', entityId: mediaId });
}

/**
 * Denný job: vyber jednu fotku „na tento deň" spred roka+ (nie skrytú,
 * poslanú do feedu/chatu alebo albumu) a vlož spomienkovú kartu do Feedu.
 * Unique (module, entityId) drží idempotenciu pri opakovanom behu.
 */
export async function createTodaysMemory(now = new Date()): Promise<string | null> {
  const rows = await db.execute<{ id: string; owner_id: string }>(sql`
    SELECT m.id, m.owner_id FROM media m
    WHERE m.kind = 'image'
      AND extract(month FROM m.created_at) = ${now.getUTCMonth() + 1}
      AND extract(day FROM m.created_at) = ${now.getUTCDate()}
      AND m.created_at < ${new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()}
      AND NOT EXISTS (SELECT 1 FROM memory_marks mk WHERE mk.media_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM feed_cards fc WHERE fc.module = 'memories' AND fc.entity_id = m.id)
    ORDER BY random()
    LIMIT 1
  `);
  const pick = rows[0];
  if (!pick) return null;

  await db
    .insert(feedCards)
    .values({ module: 'memories', entityId: pick.id, authorId: pick.owner_id })
    .onConflictDoNothing();
  await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'memories', entityId: pick.id });
  return pick.id;
}
