import { z } from 'zod';
import { PostAuthorSchema } from './feed';
import { MediaPublicSchema } from './media';

/**
 * Ankety (plán §M1) — prvý Phase 2 modul a testovací balón integračného
 * kontraktu: karta žije vo Feede (feed_cards) aj v chate (app://polls/<id>),
 * hlasy sa menia real-time cez WS event `poll:update` (klient si refetchne
 * viewer-specific stav cez GET /api/polls/:id).
 */

export const MAX_POLL_QUESTION = 200;
export const MAX_POLL_OPTION = 80;
export const MAX_POLL_OPTIONS = 10;
export const MIN_POLL_OPTIONS = 2;

export const PollKindSchema = z.enum(['single', 'multi']);
export type PollKind = z.infer<typeof PollKindSchema>;

export const CreatePollInputSchema = z.object({
  question: z.string().trim().min(1, 'Otázka nemôže byť prázdna').max(MAX_POLL_QUESTION),
  kind: PollKindSchema.default('single'),
  /** Anonymná anketa neukazuje kto hlasoval (len počty). */
  anonymous: z.boolean().default(false),
  /** ISO deadline; po ňom worker anketu uzavrie a notifikuje. Null = bez konca. */
  closesAt: z.string().datetime().nullable().optional(),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Možnosť nemôže byť prázdna').max(MAX_POLL_OPTION),
        /** Fotka možnosti (ladenie 07/2026) — anketa s obrázkovými voľbami. */
        mediaId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(MIN_POLL_OPTIONS)
    .max(MAX_POLL_OPTIONS),
  /** Vložiť kartu ankety do Feedu (K1). Zdieľanie do chatu rieši klient app:// správou. */
  toFeed: z.boolean().default(false),
});
export type CreatePollInput = z.infer<typeof CreatePollInputSchema>;

export const PollOptionPublicSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  /** Fotka možnosti — null pri čisto textovej voľbe. */
  media: MediaPublicSchema.nullable(),
  votes: z.number().int(),
  votedByMe: z.boolean(),
  /** Kto hlasoval — len pri neanonymnej ankete, inak prázdne. */
  voters: z.array(PostAuthorSchema),
});
export type PollOptionPublic = z.infer<typeof PollOptionPublicSchema>;

export const PollPublicSchema = z.object({
  id: z.string().uuid(),
  author: PostAuthorSchema,
  question: z.string(),
  kind: PollKindSchema,
  anonymous: z.boolean(),
  closesAt: z.string().nullable(),
  closed: z.boolean(),
  options: z.array(PollOptionPublicSchema),
  /** Počet ľudí, ktorí hlasovali (nie počet hlasov — multi má viac hlasov na osobu). */
  totalVoters: z.number().int(),
  createdAt: z.string(),
});
export type PollPublic = z.infer<typeof PollPublicSchema>;

/** Hlasovanie: kompletná množina mojich volieb (prázdne pole = stiahnutie hlasu). */
export const VotePollInputSchema = z.object({
  optionIds: z.array(z.string().uuid()).max(MAX_POLL_OPTIONS),
});
export type VotePollInput = z.infer<typeof VotePollInputSchema>;
