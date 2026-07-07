import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AnswerQuizInputSchema, CreateQuizInputSchema, UpdateQuizInputSchema } from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  answerQuiz,
  createQuiz,
  deleteQuiz,
  getQuiz,
  listQuizzes,
  publishQuiz,
  regenerateQuiz,
  updateQuiz,
} from './service';

const router = new Hono<AppEnv>();

function mapError(err: unknown): { message: string; status: 400 | 403 | 404 } | null {
  if (err instanceof BadRequestError) return { message: err.message, status: 400 };
  if (err instanceof ForbiddenError) return { message: err.message, status: 403 };
  if (err instanceof NotFoundError) return { message: err.message, status: 404 };
  return null;
}

/** GET /api/quiz — moje kvízy + published dostupné (rodina, moje miestnosti). */
router.get('/', requireAuth, async (c) => {
  const me = c.get('user')!;
  return c.json({ quizzes: await listQuizzes(me.id) });
});

/** POST /api/quiz — nový kvíz (LLM job); prísny limit, každý kvíz = inferencia. */
router.post('/', requireAuth, zValidator('json', CreateQuizInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`quiz:${me.id}`, 5, 60_000)) {
    return c.json({ error: 'Príliš veľa kvízov naraz, worker ich generuje po jednom' }, 429);
  }
  try {
    return c.json(await createQuiz(me.id, c.req.valid('json')), 201);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** GET /api/quiz/:id — detail (živá karta; prístup rieši service). */
router.get('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await getQuiz(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** PATCH /api/quiz/:id — review draftu autorom (otázky/titulok). */
router.patch('/:id', requireAuth, zValidator('json', UpdateQuizInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await updateQuiz(c.req.param('id'), me.id, c.req.valid('json')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/quiz/:id/regenerate — nový LLM pokus (draft/failed); limit ako create. */
router.post('/:id/regenerate', requireAuth, async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`quiz:${me.id}`, 5, 60_000)) {
    return c.json({ error: 'Príliš veľa kvízov naraz, worker ich generuje po jednom' }, 429);
  }
  try {
    return c.json(await regenerateQuiz(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/quiz/:id/publish — draft → published (+ karta podľa publika). */
router.post('/:id/publish', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await publishQuiz(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/quiz/:id/answers — jeden pokus, skóre počíta server. */
router.post('/:id/answers', requireAuth, zValidator('json', AnswerQuizInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await answerQuiz(c.req.param('id'), me.id, c.req.valid('json').answers));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/quiz/:id — autor/admin (odstráni aj feed kartu). */
router.delete('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteQuiz(c.req.param('id'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

export const quizModule: AppModule = {
  name: 'quiz',
  basePath: '/quiz',
  router,
  events: { emits: ['quiz:update', 'feed:card'] },
  permissions: ['quiz.read', 'quiz.write'],
};
