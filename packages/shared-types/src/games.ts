import { z } from 'zod';
import { MediaPublicSchema } from './media';
import { PostAuthorSchema } from './feed';

/**
 * Hry & Výzvy (plán §M6) — všetko sa hrá v chate a vo Feede, žiadna
 * izolovaná „herňa". Piškvorky = živá karta v konverzácii (ťahy real-time,
 * push „si na ťahu"); denná rodinná otázka a týždenná foto výzva = karty
 * vo Feede (denný worker job).
 */

export const GameKindSchema = z.enum(['tictactoe', 'daily', 'photo']);
export type GameKind = z.infer<typeof GameKindSchema>;

export const GameStatusSchema = z.enum(['open', 'active', 'finished']);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const TttMarkSchema = z.enum(['x', 'o']);
export type TttMark = z.infer<typeof TttMarkSchema>;

export const CreateTictactoeInputSchema = z.object({
  roomId: z.string().uuid(),
});
export type CreateTictactoeInput = z.infer<typeof CreateTictactoeInputSchema>;

export const TttMoveInputSchema = z.object({
  /** Index políčka 0–8 (3×3, po riadkoch). */
  cell: z.number().int().min(0).max(8),
});
export type TttMoveInput = z.infer<typeof TttMoveInputSchema>;

export const GameAnswerInputSchema = z
  .object({
    text: z.string().trim().max(500).default(''),
    mediaId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.text.length > 0 || v.mediaId, { message: 'Prázdna odpoveď', path: ['text'] });
export type GameAnswerInput = z.infer<typeof GameAnswerInputSchema>;

export const GameAnswerPublicSchema = z.object({
  author: PostAuthorSchema,
  text: z.string(),
  media: MediaPublicSchema.nullable(),
  createdAt: z.string(),
});
export type GameAnswerPublic = z.infer<typeof GameAnswerPublicSchema>;

export const GamePublicSchema = z.object({
  id: z.string().uuid(),
  kind: GameKindSchema,
  status: GameStatusSchema,
  roomId: z.string().uuid().nullable(),
  createdBy: PostAuthorSchema,
  createdAt: z.string(),

  // Piškvorky:
  board: z.array(TttMarkSchema.nullable()).length(9).optional(),
  players: z.object({ x: PostAuthorSchema, o: PostAuthorSchema.nullable() }).optional(),
  turn: TttMarkSchema.nullable().optional(),
  winner: z.enum(['x', 'o', 'draw']).nullable().optional(),
  /** Odveta — id novej hry (karta ukáže odkaz). */
  rematchId: z.string().uuid().nullable().optional(),

  // Denná otázka / foto výzva:
  question: z.string().optional(),
  /** Pri dennej otázke sa odpovede ukážu až po vlastnej odpovedi. */
  answers: z.array(GameAnswerPublicSchema).optional(),
  answersCount: z.number().int().optional(),
  myAnswered: z.boolean().optional(),
});
export type GamePublic = z.infer<typeof GamePublicSchema>;
