import { z } from 'zod';
import { MediaPublicSchema } from './media';

/**
 * Osobný denník s LLM (plán §M5, ARCHITECTURE_V2.md §15.2).
 * Quick capture fragmentov cez deň → nočný job poskladá z fragmentov
 * + vlastných postov + vlastných správ súvislý zápis v 1. osobe → vždy
 * DRAFT, užívateľ ráno potvrdí/upraví (human-in-the-loop proti
 * halucináciám). Potvrdený zápis sa embedduje (pgvector) → sémantické
 * hľadanie. Striktne privátne — všetko len pre vlastníka.
 */

export const MAX_FRAGMENT_BODY = 2000;
export const MAX_ENTRY_BODY = 20_000;

export const MOODS = ['😀', '🙂', '😐', '😕', '😢'] as const;
export const MoodSchema = z.enum(MOODS);
export type Mood = z.infer<typeof MoodSchema>;

export const CreateFragmentInputSchema = z
  .object({
    body: z.string().trim().max(MAX_FRAGMENT_BODY).default(''),
    mood: MoodSchema.nullable().optional(),
    mediaId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.body.length > 0 || v.mood || v.mediaId, {
    message: 'Prázdny fragment',
    path: ['body'],
  });
export type CreateFragmentInput = z.infer<typeof CreateFragmentInputSchema>;

export const DiaryFragmentPublicSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  mood: MoodSchema.nullable(),
  media: MediaPublicSchema.nullable(),
  createdAt: z.string(),
});
export type DiaryFragmentPublic = z.infer<typeof DiaryFragmentPublicSchema>;

export const DiaryEntryStatusSchema = z.enum(['draft', 'confirmed']);
export type DiaryEntryStatus = z.infer<typeof DiaryEntryStatusSchema>;

export const DiaryEntryPublicSchema = z.object({
  id: z.string().uuid(),
  /** Deň zápisu (YYYY-MM-DD). Jeden zápis na deň. */
  date: z.string(),
  bodyMd: z.string(),
  status: DiaryEntryStatusSchema,
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DiaryEntryPublic = z.infer<typeof DiaryEntryPublicSchema>;

export const UpdateDiaryEntryInputSchema = z.object({
  bodyMd: z.string().trim().min(1, 'Zápis nemôže byť prázdny').max(MAX_ENTRY_BODY),
});
export type UpdateDiaryEntryInput = z.infer<typeof UpdateDiaryEntryInputSchema>;

export const GenerateDiaryInputSchema = z.object({
  /** Deň (YYYY-MM-DD), default dnešok. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type GenerateDiaryInput = z.infer<typeof GenerateDiaryInputSchema>;

export const DiaryListResponseSchema = z.object({
  entries: z.array(DiaryEntryPublicSchema),
});
export type DiaryListResponse = z.infer<typeof DiaryListResponseSchema>;

export const DiaryFragmentsResponseSchema = z.object({
  fragments: z.array(DiaryFragmentPublicSchema),
});
export type DiaryFragmentsResponse = z.infer<typeof DiaryFragmentsResponseSchema>;

export const DiarySearchResponseSchema = z.object({
  results: z.array(
    DiaryEntryPublicSchema.extend({
      /** Kosínusová podobnosť 0–1 (vyššia = relevantnejšia). */
      similarity: z.number(),
    }),
  ),
});
export type DiarySearchResponse = z.infer<typeof DiarySearchResponseSchema>;

/** Stav LLM na serveri — UI podľa toho zapína generovanie/hľadanie. */
export const LlmStatusResponseSchema = z.object({
  enabled: z.boolean(),
  model: z.string().nullable(),
});
export type LlmStatusResponse = z.infer<typeof LlmStatusResponseSchema>;
