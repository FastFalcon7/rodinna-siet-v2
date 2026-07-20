import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  CreateRoomInputSchema,
  EditMessageInputSchema,
  MarkReadInputSchema,
  SendMessageInputSchema,
  SetMessageReactionInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  createRoom,
  deleteMessage,
  editMessage,
  getRoom,
  listMessages,
  listRooms,
  markRead,
  sendMessage,
  setMessageReaction,
} from './service';

const router = new Hono<AppEnv>();

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

/** GET /api/chat/rooms — moje miestnosti (s poslednou správou + neprečítanými). */
router.get('/rooms', requireAuth, async (c) => {
  const me = c.get('user')!;
  const rooms = await listRooms(me.id);
  return c.json({ rooms });
});

/** POST /api/chat/rooms — založ DM (idempotentne) alebo skupinu. */
router.post('/rooms', requireAuth, zValidator('json', CreateRoomInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`room:${me.id}`, 20, 60_000)) {
    return c.json({ error: 'Príliš veľa miestností, skús o chvíľu' }, 429);
  }
  try {
    const room = await createRoom(me.id, c.req.valid('json'));
    return c.json(room, 201);
  } catch (err) {
    if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

/** GET /api/chat/rooms/:id — detail miestnosti. */
router.get('/rooms/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await getRoom(c.req.param('id'), me.id));
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});

/** GET /api/chat/rooms/:id/messages — história, cursor pagination do minulosti. */
router.get('/rooms/:id/messages', requireAuth, zValidator('query', ListQuerySchema), async (c) => {
  const me = c.get('user')!;
  const { cursor, limit } = c.req.valid('query');
  try {
    const page = await listMessages(c.req.param('id'), me.id, { cursorRaw: cursor ?? null, limit });
    return c.json(page);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});

/** POST /api/chat/rooms/:id/messages — odošli správu (text + prílohy + reply). */
router.post(
  '/rooms/:id/messages',
  requireAuth,
  zValidator('json', SendMessageInputSchema),
  async (c) => {
    const me = c.get('user')!;
    if (!rateLimit(`msg:${me.id}`, 60, 60_000)) {
      return c.json({ error: 'Príliš veľa správ, skús o chvíľu' }, 429);
    }
    try {
      const message = await sendMessage(
        c.req.param('id'),
        { id: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl },
        c.req.valid('json'),
      );
      return c.json(message, 201);
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
      throw err;
    }
  },
);

/** POST /api/chat/rooms/:id/read — posun potvrdenia o prečítaní po danú správu. */
router.post('/rooms/:id/read', requireAuth, zValidator('json', MarkReadInputSchema), async (c) => {
  const me = c.get('user')!;
  const input = c.req.valid('json');
  try {
    const adv = await markRead(me.id, c.req.param('id'), input.messageId);
    return c.json({ read: adv });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});

/** PATCH /api/chat/messages/:id — úprava vlastnej správy. */
router.patch('/messages/:id', requireAuth, zValidator('json', EditMessageInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    const input = c.req.valid('json');
    const message = await editMessage(c.req.param('id'), me.id, input.bodyMd, input.mediaIds);
    return c.json(message);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

/** DELETE /api/chat/messages/:id — zmazanie správy (autor alebo admin), soft delete. */
router.delete('/messages/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteMessage(c.req.param('id'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

/** PUT /api/chat/reactions — toggle reakcia na správe. */
router.put('/reactions', requireAuth, zValidator('json', SetMessageReactionInputSchema), async (c) => {
  const me = c.get('user')!;
  const input = c.req.valid('json');
  try {
    const res = await setMessageReaction(input.messageId, me.id, input.emoji);
    return c.json({ reactions: res.reactions });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    throw err;
  }
});

export const chatModule: AppModule = {
  name: 'chat',
  basePath: '/chat',
  router,
  permissions: ['chat.read', 'chat.write'],
};
