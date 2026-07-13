import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  CreateCommentInputSchema,
  CreatePostInputSchema,
  SetReactionInputSchema,
  UpdatePostInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import {
  DepthExceededError,
  ForbiddenError,
  NotFoundError,
  createComment,
  createPost,
  deleteComment,
  deletePost,
  listComments,
  listFeed,
  setReaction,
  updatePost,
} from './service';

const router = new Hono<AppEnv>();

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

/** GET /api/feed — cursor (keyset) pagination, najnovšie prvé. */
router.get('/', requireAuth, zValidator('query', ListQuerySchema), async (c) => {
  const me = c.get('user')!;
  const { cursor, limit } = c.req.valid('query');
  const page = await listFeed(me.id, { cursorRaw: cursor ?? null, limit });
  return c.json(page);
});

/** POST /api/feed — nový príspevok (rate limit 20/min/user). */
router.post('/', requireAuth, zValidator('json', CreatePostInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`post:${me.id}`, 20, 60_000)) {
    return c.json({ error: 'Príliš veľa príspevkov, skús o chvíľu' }, 429);
  }
  const input = c.req.valid('json');
  try {
    const post = await createPost(me.id, input, me.id);
    return c.json(post, 201);
  } catch (err) {
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

/** PATCH /api/feed/:id — úprava vlastného príspevku. */
router.patch('/:id', requireAuth, zValidator('json', UpdatePostInputSchema), async (c) => {
  const me = c.get('user')!;
  const input = c.req.valid('json');
  try {
    const post = await updatePost(c.req.param('id'), me.id, input, me.id);
    return c.json(post);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

/** DELETE /api/feed/:id — zmazanie príspevku (autor alebo admin), soft delete. */
router.delete('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deletePost(c.req.param('id'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

/** GET /api/feed/:id/comments — plochý zoznam, klient si poskladá strom (max hĺbka 3). */
router.get('/:id/comments', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    const list = await listComments(c.req.param('id'), me.id);
    return c.json({ comments: list });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});

/** POST /api/feed/:id/comments — nový komentár (root alebo odpoveď). */
router.post('/:id/comments', requireAuth, zValidator('json', CreateCommentInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`comment:${me.id}`, 30, 60_000)) {
    return c.json({ error: 'Príliš veľa komentárov, skús o chvíľu' }, 429);
  }
  const input = c.req.valid('json');
  try {
    const comment = await createComment(
      c.req.param('id'),
      { id: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl },
      input,
      me.id,
    );
    return c.json(comment, 201);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    if (err instanceof DepthExceededError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

/** DELETE /api/feed/comments/:id — zmazanie komentára (autor alebo admin). */
router.delete('/comments/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteComment(c.req.param('id'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

/** PUT /api/feed/reactions — toggle reakcia na poste/komentári. */
router.put('/reactions', requireAuth, zValidator('json', SetReactionInputSchema), async (c) => {
  const me = c.get('user')!;
  const input = c.req.valid('json');
  try {
    const result = await setReaction(input.targetType, input.targetId, me.id, input.emoji);
    return c.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

export const feedModule: AppModule = {
  name: 'feed',
  basePath: '/feed',
  router,
  permissions: ['feed.read', 'feed.write'],
};
