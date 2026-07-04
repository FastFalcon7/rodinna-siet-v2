import { z } from 'zod';

/**
 * OG link preview (DESIGN_REVIEW_FEED_CHAT.md §3.3): server stiahne URL raz,
 * metadáta cachuje v DB, og:image uloží zmenšený do media storage.
 * `ok=false` = fetch zlyhal (negatívna cache, po čase sa skúsi znova).
 */
export const LinkPreviewPublicSchema = z.object({
  url: z.string(),
  ok: z.boolean(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
  /** Relatívna URL na /api/media/:id (og:image po resize), alebo null. */
  imageUrl: z.string().nullable(),
});
export type LinkPreviewPublic = z.infer<typeof LinkPreviewPublicSchema>;
