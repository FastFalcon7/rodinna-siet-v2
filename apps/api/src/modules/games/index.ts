import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  CreateTictactoeInputSchema,
  GameAnswerInputSchema,
  TttMoveInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  answerGame,
  createTictactoe,
  getGame,
  joinTictactoe,
  moveTictactoe,
  rematchTictactoe,
} from './service';

const router = new Hono<AppEnv>();

function mapError(err: unknown): { message: string; status: 400 | 403 | 404 } | null {
  if (err instanceof BadRequestError) return { message: err.message, status: 400 };
  if (err instanceof ForbiddenError) return { message: err.message, status: 403 };
  if (err instanceof NotFoundError) return { message: err.message, status: 404 };
  return null;
}

/** POST /api/games/tictactoe — nová partia v miestnosti (kartu pošle klient). */
router.post('/tictactoe', requireAuth, zValidator('json', CreateTictactoeInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`games:${me.id}`, 10, 60_000)) {
    return c.json({ error: 'Priveľa hier, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await createTictactoe(me.id, c.req.valid('json').roomId), 201);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** GET /api/games/:id — stav hry (živá karta). */
router.get('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await getGame(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/games/:id/join — prijať výzvu (stať sa hráčom O). */
router.post('/:id/join', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await joinTictactoe(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/games/:id/move — ťah na políčko 0–8. */
router.post('/:id/move', requireAuth, zValidator('json', TttMoveInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await moveTictactoe(c.req.param('id'), me.id, c.req.valid('json').cell));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/games/:id/rematch — odveta po skončenej partii. */
router.post('/:id/rematch', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await rematchTictactoe(c.req.param('id'), me.id), 201);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/games/:id/answer — odpoveď na dennú otázku / foto výzvu. */
router.post('/:id/answer', requireAuth, zValidator('json', GameAnswerInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await answerGame(c.req.param('id'), me.id, c.req.valid('json')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

export const gamesModule: AppModule = {
  name: 'games',
  basePath: '/games',
  router,
  events: { emits: ['game:update', 'feed:card'] },
  permissions: ['games.play'],
};
