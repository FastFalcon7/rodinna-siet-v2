import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  CreateFragmentInputSchema,
  GenerateDiaryInputSchema,
  UpdateDiaryEntryInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import { env, llmEnabled } from '../../config/env';
import { enqueueJob } from '../../core/jobs/queue';
import {
  BadRequestError,
  NotFoundError,
  confirmEntry,
  createFragment,
  deleteEntry,
  deleteFragment,
  listEntries,
  listFragments,
  searchEntries,
  updateEntry,
} from './service';

const router = new Hono<AppEnv>();

function mapError(err: unknown): { message: string; status: 400 | 404 } | null {
  if (err instanceof BadRequestError) return { message: err.message, status: 400 };
  if (err instanceof NotFoundError) return { message: err.message, status: 404 };
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** GET /api/diary — moje zápisy (najnovší prvý). */
router.get('/', requireAuth, async (c) => {
  const me = c.get('user')!;
  return c.json({ entries: await listEntries(me.id) });
});

/** GET /api/diary/status — je LLM zapnuté? (UI podľa toho ukáže generovanie/hľadanie) */
router.get('/status', requireAuth, (c) => {
  return c.json({ enabled: llmEnabled, model: llmEnabled ? env.LLM_MODEL : null });
});

/** GET /api/diary/fragments?date= — moje fragmenty dňa (default dnes). */
router.get(
  '/fragments',
  requireAuth,
  zValidator('query', z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })),
  async (c) => {
    const me = c.get('user')!;
    return c.json({ fragments: await listFragments(me.id, c.req.valid('query').date ?? today()) });
  },
);

/** POST /api/diary/fragments — quick capture („Ako bolo dnes?"). */
router.post('/fragments', requireAuth, zValidator('json', CreateFragmentInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`diaryfrag:${me.id}`, 30, 60_000)) {
    return c.json({ error: 'Priveľa fragmentov, skús o chvíľu' }, 429);
  }
  return c.json(await createFragment(me.id, c.req.valid('json')), 201);
});

/** DELETE /api/diary/fragments/:id */
router.delete('/fragments/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteFragment(c.req.param('id'), me.id);
    return c.body(null, 204);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/diary/generate — zaradí generovanie draftu (LLM job) na vyžiadanie. */
router.post('/generate', requireAuth, zValidator('json', GenerateDiaryInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!llmEnabled) return c.json({ error: 'LLM nie je na serveri nakonfigurované' }, 503);
  if (!rateLimit(`diarygen:${me.id}`, 3, 60_000)) {
    return c.json({ error: 'Generovanie už beží, chvíľu strpenia' }, 429);
  }
  const date = c.req.valid('json').date ?? today();
  await enqueueJob('diary.generate', { userId: me.id, date });
  return c.json({ queued: true, date }, 202);
});

/** GET /api/diary/search?q= — sémantické hľadanie v potvrdených zápisoch. */
router.get(
  '/search',
  requireAuth,
  zValidator('query', z.object({ q: z.string().trim().min(2).max(200) })),
  async (c) => {
    const me = c.get('user')!;
    if (!llmEnabled) return c.json({ error: 'LLM nie je na serveri nakonfigurované' }, 503);
    if (!rateLimit(`diarysearch:${me.id}`, 10, 60_000)) {
      return c.json({ error: 'Priveľa hľadaní, skús o chvíľu' }, 429);
    }
    return c.json(await searchEntries(me.id, c.req.valid('query').q));
  },
);

/** PATCH /api/diary/entries/:id — úprava textu (potvrdený sa re-embedduje). */
router.patch('/entries/:id', requireAuth, zValidator('json', UpdateDiaryEntryInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await updateEntry(c.req.param('id'), me.id, c.req.valid('json').bodyMd));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/diary/entries/:id/confirm — human-in-the-loop potvrdenie draftu. */
router.post('/entries/:id/confirm', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await confirmEntry(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/diary/entries/:id */
router.delete('/entries/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteEntry(c.req.param('id'), me.id);
    return c.body(null, 204);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

export const diaryModule: AppModule = {
  name: 'diary',
  basePath: '/diary',
  router,
  events: { emits: ['diary:update'] },
  permissions: ['diary.read', 'diary.write'],
};
