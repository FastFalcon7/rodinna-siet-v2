import { z } from 'zod';
import { PostAuthorSchema } from './feed';

/**
 * Kvízy (plán §M8): LLM vygeneruje kvíz na tému zadanú užívateľom
 * (Harry Potter, hlavné mestá, staroveký Rím, rodinné jubileá…), pre seba,
 * vybranú miestnosť alebo celú rodinu. Human-in-the-loop: otázky vždy
 * vzniknú ako DRAFT, autor ich skontroluje/upraví a až potom publikuje
 * (malý CPU model občas halucinuje — rovnaký vzor ako denníkové drafty).
 */

export const QUIZ_STATUSES = ['generating', 'draft', 'published', 'failed'] as const;
export const QuizStatusSchema = z.enum(QUIZ_STATUSES);
export type QuizStatus = z.infer<typeof QuizStatusSchema>;

export const QUIZ_AUDIENCES = ['private', 'room', 'family'] as const;
export const QuizAudienceSchema = z.enum(QUIZ_AUDIENCES);
export type QuizAudience = z.infer<typeof QuizAudienceSchema>;

export const QUIZ_AUDIENCE_LABELS: Record<QuizAudience, string> = {
  private: 'Len pre mňa',
  room: 'Miestnosť',
  family: 'Celá rodina',
};

/** Otázka s výberom zo 4 možností. `correct` = index správnej (0–3). */
export const QuizQuestionSchema = z.object({
  q: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(200)).length(4),
  correct: z.number().int().min(0).max(3),
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

/** Otázka pre hráča pred odpoveďou — bez prezradenej správnej možnosti. */
export const QuizQuestionPlaySchema = QuizQuestionSchema.omit({ correct: true });
export type QuizQuestionPlay = z.infer<typeof QuizQuestionPlaySchema>;

export const CreateQuizInputSchema = z.object({
  topic: z.string().trim().min(2).max(120),
  count: z.number().int().min(3).max(10).default(5),
  audience: QuizAudienceSchema,
  roomId: z.string().uuid().optional(),
  /**
   * Voliteľné podklady (max 2000 znakov) — fakty, z ktorých má LLM čerpať.
   * Kľúč k témam ako „rodinné jubileá": LLM nehalucinuje, len formuluje.
   */
  facts: z.string().trim().max(2000).optional(),
});
export type CreateQuizInput = z.infer<typeof CreateQuizInputSchema>;

/** Úprava draftu autorom (review pred publikovaním). */
export const UpdateQuizInputSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  questions: z.array(QuizQuestionSchema).min(1).max(10).optional(),
});
export type UpdateQuizInput = z.infer<typeof UpdateQuizInputSchema>;

export const AnswerQuizInputSchema = z.object({
  /** Index zvolenej možnosti pre každú otázku v poradí. */
  answers: z.array(z.number().int().min(0).max(3)).min(1).max(10),
});
export type AnswerQuizInput = z.infer<typeof AnswerQuizInputSchema>;

export const QuizResultPublicSchema = z.object({
  author: PostAuthorSchema,
  score: z.number().int(),
  total: z.number().int(),
  createdAt: z.string(),
});
export type QuizResultPublic = z.infer<typeof QuizResultPublicSchema>;

export const QuizPublicSchema = z.object({
  id: z.string().uuid(),
  topic: z.string(),
  title: z.string(),
  status: QuizStatusSchema,
  audience: QuizAudienceSchema,
  roomId: z.string().uuid().nullable(),
  createdBy: PostAuthorSchema,
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  questionCount: z.number().int(),

  /**
   * Plné otázky (s `correct`): autor vždy; hráč až po odoslaní odpovedí
   * (nech vidí, čo mal správne). Pred odpoveďou dostane hráč `playQuestions`.
   */
  questions: z.array(QuizQuestionSchema).nullable(),
  playQuestions: z.array(QuizQuestionPlaySchema).nullable(),

  /** Moje odoslané odpovede (null = ešte som nehral). */
  myAnswers: z.array(z.number().int()).nullable(),
  myScore: z.number().int().nullable(),
  /** Rebríček — autor vidí vždy, hráč po vlastnej odpovedi. */
  results: z.array(QuizResultPublicSchema).nullable(),
});
export type QuizPublic = z.infer<typeof QuizPublicSchema>;
