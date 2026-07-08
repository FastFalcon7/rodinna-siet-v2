import { z } from 'zod';
import { MediaPublicSchema } from './media';
import { PostAuthorSchema } from './feed';

/**
 * Albumy + Spomienky (plán §M2) — organizujú fotky, ktoré už v systéme sú
 * (feed/chat prílohy cez media kernel) alebo pribudnú priamym uploadom.
 * „Zberač" navrhuje album z fotiek jedného dňa, „Na tento deň" vkladá
 * ráno do Feedu spomienkovú kartu (K1, modul 'memories').
 */

export const MAX_ALBUM_TITLE = 120;
export const MAX_ALBUM_ADD = 500;

export const CreateAlbumInputSchema = z.object({
  title: z.string().trim().min(1, 'Album potrebuje názov').max(MAX_ALBUM_TITLE),
  mediaIds: z.array(z.string().uuid()).max(MAX_ALBUM_ADD).default([]),
});
export type CreateAlbumInput = z.infer<typeof CreateAlbumInputSchema>;

export const UpdateAlbumInputSchema = z.object({
  title: z.string().trim().min(1).max(MAX_ALBUM_TITLE).optional(),
  coverMediaId: z.string().uuid().nullable().optional(),
});
export type UpdateAlbumInput = z.infer<typeof UpdateAlbumInputSchema>;

export const AddAlbumPhotosInputSchema = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(MAX_ALBUM_ADD),
});
export type AddAlbumPhotosInput = z.infer<typeof AddAlbumPhotosInputSchema>;

export const AlbumSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  cover: MediaPublicSchema.nullable(),
  photoCount: z.number().int(),
  createdBy: PostAuthorSchema,
  createdAt: z.string(),
  /** Posledné pridanie fotky — radenie „najživšie hore". */
  lastAddedAt: z.string().nullable(),
});
export type AlbumSummary = z.infer<typeof AlbumSummarySchema>;

export const AlbumPhotoSchema = z.object({
  media: MediaPublicSchema,
  addedBy: PostAuthorSchema.nullable(),
  addedAt: z.string(),
});
export type AlbumPhoto = z.infer<typeof AlbumPhotoSchema>;

export const AlbumDetailSchema = AlbumSummarySchema.extend({
  photos: z.array(AlbumPhotoSchema),
});
export type AlbumDetail = z.infer<typeof AlbumDetailSchema>;

export const AlbumsListResponseSchema = z.object({
  albums: z.array(AlbumSummarySchema),
});
export type AlbumsListResponse = z.infer<typeof AlbumsListResponseSchema>;

/** Zberač: fotky z feedu/chatu jedného dňa, ktoré ešte nie sú v žiadnom albume. */
export const AlbumSuggestionSchema = z.object({
  /** Deň v tvare YYYY-MM-DD. */
  date: z.string(),
  count: z.number().int(),
  mediaIds: z.array(z.string().uuid()),
  /** Prvé 4 fotky na náhľad banneru. */
  previews: z.array(MediaPublicSchema),
});
export type AlbumSuggestion = z.infer<typeof AlbumSuggestionSchema>;

export const AlbumSuggestionsResponseSchema = z.object({
  suggestions: z.array(AlbumSuggestionSchema),
});
export type AlbumSuggestionsResponse = z.infer<typeof AlbumSuggestionsResponseSchema>;

/** „Na tento deň" — obsah spomienkovej karty (modul 'memories', entityId = mediaId). */
export const MemoryPublicSchema = z.object({
  media: MediaPublicSchema,
  owner: PostAuthorSchema,
  yearsAgo: z.number().int(),
  takenAt: z.string(),
});
export type MemoryPublic = z.infer<typeof MemoryPublicSchema>;
