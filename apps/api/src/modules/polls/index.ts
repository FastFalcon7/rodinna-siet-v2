import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreatePollInputSchema, VotePollInputSchema } from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  closePoll,
  createPoll,
  getPoll,
  vote,
} from './service';

const router = new Hono<AppEnv>();

function mapError(err: unknown): { message: string; status: 400 | 403 | 404 } | null {
  if (err instanceof BadRequestError) return { message: err.message, status: 400 };
  if (err instanceof ForbiddenError) return { message: err.message, status: 403 };
  if (err instanceof NotFoundError) return { message: err.message, status: 404 };
  return null;
}

/** POST /api/polls — nová anketa (voliteľne rovno ako karta do Feedu). */
router.post('/', requireAuth, zValidator('json', CreatePollInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`polls:${me.id}`, 10, 60_000)) {
    return c.json({ error: 'Príliš veľa ankiet, skús o chvíľu' }, 429);
  }
  try {
    const poll = await createPoll(
      { id: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl },
      c.req.valid('json'),
    );
    return c.json(poll, 201);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** GET /api/polls/:id — aktuálny stav ankety (viewer-specific: votedByMe). */
router.get('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await getPoll(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** PUT /api/polls/:id/vote — kompletná množina mojich volieb ([] = stiahnutie hlasu). */
router.put('/:id/vote', requireAuth, zValidator('json', VotePollInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`pollvote:${me.id}`, 30, 60_000)) {
    return c.json({ error: 'Príliš veľa hlasov, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await vote(c.req.param('id'), me.id, c.req.valid('json').optionIds));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/polls/:id/close — predčasné uzavretie autorom. */
router.post('/:id/close', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await closePoll(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

export const pollsModule: AppModule = {
  name: 'polls',
  basePath: '/polls',
  router,
  events: { emits: ['poll:update', 'feed:card'] },
  permissions: ['polls.read', 'polls.write'],
};
