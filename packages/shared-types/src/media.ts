import { z } from 'zod';

/** Druh média (§7). T3 spracúva obrázky; video pribudne s chatom. */
export const MediaKindSchema = z.enum(['image', 'video']);
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
