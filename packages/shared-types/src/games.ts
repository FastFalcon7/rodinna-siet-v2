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

/** Piškvorky (slovenský variant, nie 3×3 tic-tac-toe): 10×10, vyhráva 5 v rade. */
export const TTT_BOARD_SIZE = 10;
export const TTT_CELLS = TTT_BOARD_SIZE * TTT_BOARD_SIZE;
export const TTT_WIN_COUNT = 5;

export const TttOpponentSchema = z.enum(['human', 'bot']);
export type TttOpponent = z.infer<typeof TttOpponentSchema>;

export const TttDifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type TttDifficulty = z.infer<typeof TttDifficultySchema>;

/** Nulové UUID ako sentinel pre bota — nikdy nekoliduje so skutočným `users.id`. */
export const BOT_USER_ID = '00000000-0000-0000-0000-000000000000';

export const CreateTictactoeInputSchema = z.object({
  roomId: z.string().uuid(),
  opponent: TttOpponentSchema.default('human'),
  /** Relevantné len pri opponent='bot'. */
  difficulty: TttDifficultySchema.default('medium'),
});
export type CreateTictactoeInput = z.infer<typeof CreateTictactoeInputSchema>;

export const TttMoveInputSchema = z.object({
  /** Index políčka 0–99 (10×10, po riadkoch). */
  cell: z.number().int().min(0).max(TTT_CELLS - 1),
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
  board: z.array(TttMarkSchema.nullable()).length(TTT_CELLS).optional(),
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
