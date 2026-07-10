import { z } from 'zod';

/** Druh média (§7): obrázok, video, alebo iný súbor (dokument, PDF…). */
export const MediaKindSchema = z.enum(['image', 'video', 'file']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/**
 * Verejná reprezentácia média. `url` je relatívna cesta na serve endpoint
 * (`/api/media/:id`) — frontend ju použije priamo s credentials.
 * `blurhash` slúži ako placeholder pred načítaním plného obrázka.
 */
export const MediaPublicSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  kind: MediaKindSchema,
  mime: z.string(),
  bytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  blurhash: z.string().nullable(),
  /** Pôvodný názov súboru — zobrazuje sa pri kind='file' (download karta). */
  fileName: z.string().nullable(),
  /** Poster frame videa (`/api/media/:id/poster`) — null kým transkód nedobehne. */
  posterUrl: z.string().nullable(),
  /** true = video sa ešte normalizuje (H.264 transkód beží na pozadí). */
  processing: z.boolean(),
  createdAt: z.string(),
});
export type MediaPublic = z.infer<typeof MediaPublicSchema>;

/** Povolené vstupné MIME typy pre upload obrázka (§9: magic-byte check). */
export const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

/**
 * Povolené video MIME typy (magic-byte check). Ukladáme originál bez
 * transkódovania (DS925+ nemá GPU — DESIGN_REVIEW_FEED_CHAT.md §4.3);
 * iPhone/Android nahrávajú H.264/HEVC MP4, ktoré prehrá každý klient.
 */
export const ALLOWED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;
