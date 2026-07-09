import { z } from 'zod';

/**
 * Svet okolo (plán §M7, ARCHITECTURE_V2.md §15.3) — jediné miesto
 * architektúry s výstupným internetom: jednosmerné čítanie verejných RSS
 * feedov (len titulok + krátky snippet + link, nikdy celý článok). Rodinné
 * dáta nikam neodchádzajú. Default vypnuté, opt-in s výberom kategórií;
 * denník potom dostane záverečný odsek „Svet okolo".
 */

export const NEWS_CATEGORIES = ['spravy', 'sport', 'technologie', 'kultura', 'veda'] as const;
export const NewsCategorySchema = z.enum(NEWS_CATEGORIES);
export type NewsCategory = z.infer<typeof NewsCategorySchema>;

export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  spravy: 'Správy',
  sport: 'Šport',
  technologie: 'Technológie',
  kultura: 'Kultúra',
  veda: 'Veda',
};

export const NewsItemPublicSchema = z.object({
  id: z.string().uuid(),
  category: NewsCategorySchema,
  title: z.string(),
  snippet: z.string(),
  source: z.string(),
  url: z.string(),
  publishedAt: z.string(),
});
export type NewsItemPublic = z.infer<typeof NewsItemPublicSchema>;

export const NewsPrefsResponseSchema = z.object({
  categories: z.array(NewsCategorySchema),
});
export type NewsPrefsResponse = z.infer<typeof NewsPrefsResponseSchema>;

export const SetNewsPrefsInputSchema = z.object({
  categories: z.array(NewsCategorySchema).max(NEWS_CATEGORIES.length),
});
export type SetNewsPrefsInput = z.infer<typeof SetNewsPrefsInputSchema>;

export const NewsTodayResponseSchema = z.object({
  items: z.array(NewsItemPublicSchema),
});
export type NewsTodayResponse = z.infer<typeof NewsTodayResponseSchema>;
