import { and, desc, eq, inArray, or } from 'drizzle-orm';
import {
  QuizQuestionSchema,
  type CreateQuizInput,
  type PostAuthor,
  type QuizAudience,
  type QuizPublic,
  type QuizQuestion,
  type QuizResultPublic,
  type UpdateQuizInput,
} from '@rodinna/shared-types';
import { z } from 'zod';
import { db } from '../../core/db/client';
import { feedCards, quizAnswers, quizzes, roomMembers, users, type QuizRow } from '../../core/db/schema';
import { APP_TOPIC, getOnlineUserIds } from '../../core/realtime';
import { publishCrossProcess } from '../../core/events';
import { enqueueJob } from '../../core/jobs/queue';
import { chatCompletion } from '../../core/llm';
import { llmEnabled } from '../../config/env';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

/**
 * Kvízy (§M8): téma od užívateľa → LLM otázky vo worker jobe → DRAFT →
 * review autora (human-in-the-loop, malý model halucinuje) → publish →
 * hranie. Publikum: private (len autor) / room (K2 karta v chate) /
 * family (K1 karta vo Feede). Jeden pokus na hráča, skóre počíta server,
 * výsledky ostatných vidíš po vlastnom dohraní (icebreaker mechanika M6).
 */

async function fetchAuthors(userIds: string[]): Promise<Map<string, PostAuthor>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

async function getQuizRow(quizId: string): Promise<QuizRow> {
  const rows = await db.select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
  if (!rows[0]) throw new NotFoundError('Kvíz nenájdený');
  return rows[0];
}

async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}

/**
 * Prístup: autor vždy (aj draft/generating/failed). Ostatní len published,
 * a to family komukoľvek, room len členom. Private nikdy nie cudzím —
 * existenciu nepriznávame (404, nie 403).
 */
async function requireAccess(quiz: QuizRow, userId: string): Promise<void> {
  if (quiz.createdBy === userId) return;
  if (quiz.status !== 'published') throw new NotFoundError('Kvíz nenájdený');
  if (quiz.audience === 'family') return;
  if (quiz.audience === 'room' && quiz.roomId && (await isRoomMember(quiz.roomId, userId))) return;
  throw new NotFoundError('Kvíz nenájdený');
}

// ── Hydratácia ───────────────────────────────────────────────────────────────

export async function getQuiz(quizId: string, viewerId: string): Promise<QuizPublic> {
  const quiz = await getQuizRow(quizId);
  await requireAccess(quiz, viewerId);
  return toPublic(quiz, viewerId);
}

async function toPublic(quiz: QuizRow, viewerId: string): Promise<QuizPublic> {
  const isAuthor = quiz.createdBy === viewerId;
  const questions = quiz.questionsJson as QuizQuestion[];

  const answerRows = await db
    .select()
    .from(quizAnswers)
    .where(eq(quizAnswers.quizId, quiz.id))
    .orderBy(desc(quizAnswers.score), quizAnswers.createdAt);
  const mine = answerRows.find((a) => a.userId === viewerId) ?? null;
  const authors = await fetchAuthors([quiz.createdBy, ...answerRows.map((a) => a.userId)]);

  // Plné otázky (s correct): autor vždy, hráč po odoslaní. Pred odpoveďou
  // hráč dostane playQuestions bez correct — správne odpovede neprezrádzame.
  const revealFull = isAuthor || mine !== null;
  const results: QuizResultPublic[] | null =
    isAuthor || mine !== null
      ? answerRows.map((a) => ({
          author: authors.get(a.userId)!,
          score: a.score,
          total: questions.length,
          createdAt: a.createdAt.toISOString(),
        }))
      : null;

  return {
    id: quiz.id,
    topic: quiz.topic,
    title: quiz.title || quiz.topic,
    status: quiz.status,
    audience: quiz.audience as QuizAudience,
    roomId: quiz.roomId,
    createdBy: authors.get(quiz.createdBy)!,
    createdAt: quiz.createdAt.toISOString(),
    publishedAt: quiz.publishedAt?.toISOString() ?? null,
    questionCount: questions.length || quiz.questionCount,
    questions: revealFull ? questions : null,
    playQuestions:
      !revealFull && quiz.status === 'published'
        ? questions.map(({ q, options }) => ({ q, options }))
        : null,
    myAnswers: mine ? (mine.answersJson as number[]) : null,
    myScore: mine?.score ?? null,
    results,
  };
}

/** Kvízy pre modul: moje (všetky stavy) + published rodinné + published z mojich miestností. */
export async function listQuizzes(viewerId: string): Promise<QuizPublic[]> {
  const myRooms = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(eq(roomMembers.userId, viewerId));
  const roomIds = myRooms.map((r) => r.roomId);

  const rows = await db
    .select()
    .from(quizzes)
    .where(
      or(
        eq(quizzes.createdBy, viewerId),
        and(eq(quizzes.status, 'published'), eq(quizzes.audience, 'family')),
        roomIds.length > 0
          ? and(eq(quizzes.status, 'published'), eq(quizzes.audience, 'room'), inArray(quizzes.roomId, roomIds))
          : undefined,
      ),
    )
    .orderBy(desc(quizzes.createdAt))
    .limit(50);
  return Promise.all(rows.map((r) => toPublic(r, viewerId)));
}

// ── Tvorba a draft lifecycle ─────────────────────────────────────────────────

export async function createQuiz(creatorId: string, input: CreateQuizInput): Promise<QuizPublic> {
  if (!llmEnabled) {
    throw new BadRequestError('Kvízy potrebujú LLM server (LLM_BASE_URL) — požiadaj admina');
  }
  if (input.audience === 'room') {
    if (!input.roomId) throw new BadRequestError('Kvíz pre miestnosť potrebuje roomId');
    if (!(await isRoomMember(input.roomId, creatorId))) throw new NotFoundError('Miestnosť nenájdená');
  }

  const inserted = await db
    .insert(quizzes)
    .values({
      topic: input.topic,
      facts: input.facts || null,
      questionCount: input.count,
      audience: input.audience,
      roomId: input.audience === 'room' ? input.roomId : null,
      createdBy: creatorId,
      status: 'generating',
    })
    .returning();
  const quiz = inserted[0]!;
  await enqueueJob('quiz.generate', { quizId: quiz.id });
  return toPublic(quiz, creatorId);
}

export async function updateQuiz(quizId: string, userId: string, input: UpdateQuizInput): Promise<QuizPublic> {
  const quiz = await getQuizRow(quizId);
  if (quiz.createdBy !== userId) throw new ForbiddenError('Kvíz upraví len autor');
  if (quiz.status !== 'draft') throw new BadRequestError('Upraviť sa dá len draft');

  await db
    .update(quizzes)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.questions !== undefined ? { questionsJson: input.questions } : {}),
    })
    .where(eq(quizzes.id, quizId));
  return getQuiz(quizId, userId);
}

/** Nový pokus o vygenerovanie (draft s halucináciami / failed). */
export async function regenerateQuiz(quizId: string, userId: string): Promise<QuizPublic> {
  const quiz = await getQuizRow(quizId);
  if (quiz.createdBy !== userId) throw new ForbiddenError('Kvíz pregeneruje len autor');
  if (quiz.status !== 'draft' && quiz.status !== 'failed') {
    throw new BadRequestError('Pregenerovať sa dá len draft alebo neúspešný kvíz');
  }
  await db.update(quizzes).set({ status: 'generating', questionsJson: [] }).where(eq(quizzes.id, quizId));
  await enqueueJob('quiz.generate', { quizId });
  return getQuiz(quizId, userId);
}

export async function publishQuiz(quizId: string, userId: string): Promise<QuizPublic> {
  const quiz = await getQuizRow(quizId);
  if (quiz.createdBy !== userId) throw new ForbiddenError('Kvíz publikuje len autor');
  if (quiz.status !== 'draft') throw new BadRequestError('Publikovať sa dá len draft');
  const questions = quiz.questionsJson as QuizQuestion[];
  if (questions.length === 0) throw new BadRequestError('Kvíz nemá žiadne otázky');

  await db.update(quizzes).set({ status: 'published', publishedAt: new Date() }).where(eq(quizzes.id, quizId));

  if (quiz.audience === 'family') {
    // K1: karta vo Feede pre celú rodinu.
    await db.insert(feedCards).values({ module: 'quiz', entityId: quizId, authorId: userId });
    await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'quiz', entityId: quizId });
  } else if (quiz.audience === 'room' && quiz.roomId) {
    // K2: živá karta v chate — správa app://quiz/<id> v mene autora.
    const { sendMessage } = await import('../chat/service');
    const authors = await fetchAuthors([userId]);
    await sendMessage(quiz.roomId, authors.get(userId)!, { bodyMd: `app://quiz/${quizId}`, mediaIds: [] });
  }
  await publishCrossProcess(APP_TOPIC, { t: 'quiz:update', quizId });
  return getQuiz(quizId, userId);
}

export async function deleteQuiz(quizId: string, userId: string, isAdmin: boolean): Promise<void> {
  const quiz = await getQuizRow(quizId);
  if (quiz.createdBy !== userId && !isAdmin) throw new ForbiddenError('Kvíz zmaže len autor alebo admin');
  await db.delete(feedCards).where(and(eq(feedCards.module, 'quiz'), eq(feedCards.entityId, quizId)));
  await db.delete(quizzes).where(eq(quizzes.id, quizId));
  await publishCrossProcess(APP_TOPIC, { t: 'quiz:update', quizId });
}

// ── Hranie ───────────────────────────────────────────────────────────────────

export async function answerQuiz(quizId: string, userId: string, answers: number[]): Promise<QuizPublic> {
  const quiz = await getQuizRow(quizId);
  await requireAccess(quiz, userId);
  if (quiz.status !== 'published') throw new BadRequestError('Kvíz ešte nie je publikovaný');

  const questions = quiz.questionsJson as QuizQuestion[];
  if (answers.length !== questions.length) {
    throw new BadRequestError(`Kvíz má ${questions.length} otázok, prišlo ${answers.length} odpovedí`);
  }

  // Jeden pokus na hráča — skóre by inak nemalo výpovednú hodnotu.
  const existing = await db
    .select({ userId: quizAnswers.userId })
    .from(quizAnswers)
    .where(and(eq(quizAnswers.quizId, quizId), eq(quizAnswers.userId, userId)))
    .limit(1);
  if (existing[0]) throw new BadRequestError('Kvíz si už hral — druhý pokus sa nepočíta 🙂');

  const score = answers.reduce((acc, a, i) => acc + (questions[i]!.correct === a ? 1 : 0), 0);
  await db.insert(quizAnswers).values({ quizId, userId, answersJson: answers, score });
  await publishCrossProcess(APP_TOPIC, { t: 'quiz:update', quizId });
  return getQuiz(quizId, userId);
}

// ── Generovanie (worker job) ─────────────────────────────────────────────────

const LlmQuestionsSchema = z
  .array(
    z.object({
      q: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).length(4),
      correct: z.number().int().min(0).max(3),
    }),
  )
  .min(1);

function buildPrompt(quiz: QuizRow): { system: string; user: string } {
  const system = [
    'Si tvorca zábavných rodinných kvízov v slovenčine.',
    'Vráť VÝHRADNE platný JSON — pole objektov {"q":"otázka","options":["a","b","c","d"],"correct":0}.',
    '"correct" je index správnej možnosti (0 až 3). Práve 4 možnosti, len jedna správna.',
    'Otázky krátke a jednoznačné, možnosti podobne dlhé, žiadne "všetky uvedené".',
    'Žiadny text pred ani za JSON poľom.',
  ].join(' ');
  const user = [
    `Vytvor ${quiz.questionCount} kvízových otázok na tému: ${quiz.topic}.`,
    quiz.facts
      ? `Čerpaj VÝHRADNE z týchto podkladov (nič si nedomýšľaj):\n${quiz.facts}`
      : 'Drž sa všeobecne známych faktov, pri neistote radšej ľahšia otázka.',
  ].join('\n\n');
  return { system, user };
}

/** Vytiahne prvé JSON pole z odpovede (modely radi pridajú okolo text). */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('Odpoveď neobsahuje JSON pole');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Worker job 'quiz.generate': LLM → otázky → status draft + notifikácia
 * autorovi. Chyby (nevalidný JSON, LLM výpadok) po jednom internom retry
 * skončia ako status 'failed' + notifikácia — job sa NEvyhadzuje do retry
 * fronty, autor má v UI tlačidlo Pregenerovať.
 */
export async function generateQuiz(quizId: string): Promise<void> {
  const quiz = await getQuizRow(quizId);
  if (quiz.status !== 'generating') return; // idempotencia (duplicitný job)

  const { system, user } = buildPrompt(quiz);
  let questions: QuizQuestion[] | null = null;
  let lastError = '';

  for (let attempt = 0; attempt < 2 && !questions; attempt++) {
    try {
      const raw = await chatCompletion(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.8, maxTokens: 2048 },
      );
      const parsed = LlmQuestionsSchema.parse(extractJsonArray(raw));
      questions = parsed.slice(0, quiz.questionCount).map((p) => QuizQuestionSchema.parse({
        q: p.q.slice(0, 500),
        options: p.options.map((o) => o.slice(0, 200)) as [string, string, string, string],
        correct: p.correct,
      }));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const { notifyUsers } = await import('../notifications/service');
  if (!questions) {
    console.error(`quiz.generate ${quizId} zlyhal: ${lastError}`);
    await db.update(quizzes).set({ status: 'failed' }).where(eq(quizzes.id, quizId));
    await notifyUsers([quiz.createdBy], 'quiz.ready', {
      title: 'Kvíz sa nepodaril 😕',
      body: `Téma „${quiz.topic}" — skús Pregenerovať alebo inú tému.`,
      url: '/',
      tag: `quiz-${quizId}`,
    }, { skipPushFor: getOnlineUserIds() });
  } else {
    await db
      .update(quizzes)
      .set({ status: 'draft', questionsJson: questions, title: quiz.topic })
      .where(eq(quizzes.id, quizId));
    await notifyUsers([quiz.createdBy], 'quiz.ready', {
      title: 'Kvíz je pripravený ✅',
      body: `„${quiz.topic}" (${questions.length} otázok) čaká na tvoju kontrolu.`,
      url: '/',
      tag: `quiz-${quizId}`,
    }, { skipPushFor: getOnlineUserIds() });
  }
  // Draft je vec autora — event na jeho user topic (nie broadcast rodine).
  await publishCrossProcess(`user:${quiz.createdBy}`, { t: 'quiz:update', quizId });
}
