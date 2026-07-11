import { eq } from 'drizzle-orm';
import type { MediaPublic } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { media, type MediaRow } from '../../core/db/schema';
import { enqueueJob } from '../../core/jobs/queue';
import { sha256HexBytes } from '../auth/crypto';
import { processImage, type ProcessOptions } from './processing';
import { buildStoragePath, writeMedia } from './storage';
import { mediaUrlToken } from './urlToken';

/** DB záznam → verejný tvar (url smeruje na serve endpoint). */
export function toMediaPublic(row: MediaRow): MediaPublic {
  // Token v URL: iOS AVPlayer neposiela cookies pri <video> — viď urlToken.ts.
  const mt = mediaUrlToken(row.id);
  const q = mt ? `?mt=${mt}` : '';
  return {
    id: row.id,
    url: `/api/media/${row.id}${q}`,
    kind: row.kind,
    // Po transkóde sa servíruje normalizovaný H.264 MP4, nie originál.
    mime: row.playbackPath ? 'video/mp4' : row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    fileName: row.fileName,
    posterUrl: row.posterPath ? `/api/media/${row.id}/poster${q}` : null,
    processing: row.transcodeStatus === 'pending',
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Spracuje a uloží obrázok: pipeline (resize/re-encode/EXIF strip/blurhash),
 * zápis na disk, vloženie DB záznamu. Vracia uložený riadok.
 */
export async function createImageMedia(
  ownerId: string,
  input: Buffer | Uint8Array,
  opts: ProcessOptions = {},
): Promise<MediaRow> {
  const processed = await processImage(input, opts);
  const id = crypto.randomUUID();
  const storagePath = buildStoragePath(id, processed.ext);

  await writeMedia(storagePath, processed.data);

  const inserted = await db
    .insert(media)
    .values({
      id,
      ownerId,
      kind: 'image',
      mime: processed.mime,
      bytes: processed.bytes,
      width: processed.width,
      height: processed.height,
      storagePath,
      blurhash: processed.blurhash,
      sha256: sha256HexBytes(processed.data),
    })
    .returning();

  return inserted[0]!;
}

/**
 * Uloží video alebo generický súbor ako originál (bez transkódovania —
 * DS925+ nemá GPU, DESIGN_REVIEW_FEED_CHAT.md §4.3). Pozn.: pri videu sa
 * na rozdiel od obrázkov nestripujú metadáta (vyžadovalo by ffmpeg re-mux).
 */
export async function createRawMedia(
  ownerId: string,
  input: Buffer | Uint8Array,
  info: { kind: 'video' | 'file'; mime: string; ext: string; fileName: string | null },
): Promise<MediaRow> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const id = crypto.randomUUID();
  const storagePath = buildStoragePath(id, info.ext);

  await writeMedia(storagePath, buf);

  const inserted = await db
    .insert(media)
    .values({
      id,
      ownerId,
      kind: info.kind,
      mime: info.mime,
      bytes: buf.length,
      width: null,
      height: null,
      storagePath,
      blurhash: null,
      fileName: info.fileName,
      sha256: sha256HexBytes(buf),
      // Video sa normalizuje na pozadí (H.264 + poster) — viď media/worker.ts.
      transcodeStatus: info.kind === 'video' ? 'pending' : null,
    })
    .returning();

  const row = inserted[0]!;
  if (info.kind === 'video') {
    await enqueueJob('media.transcode', { mediaId: row.id });
  }
  return row;
}

export function getMediaById(id: string): Promise<MediaRow | undefined> {
  return db
    .select()
    .from(media)
    .where(eq(media.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}
