import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { UpdateProfileSchema } from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { env } from '../../config/env';
import { db } from '../../core/db/client';
import { users } from '../../core/db/schema';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import { createImageMedia } from '../media/service';
import { UnsupportedMediaError } from '../media/processing';
import { toPublicUser } from './service';

const router = new Hono<AppEnv>();

const MAX_IMAGE_BYTES = env.MAX_IMAGE_MB * 1024 * 1024;
const AVATAR_DIM = 512;

/** GET /api/users — zoznam členov rodiny. */
router.get('/', requireAuth, async (c) => {
  const rows = await db.select().from(users).orderBy(asc(users.displayName));
  return c.json({ users: rows.map(toPublicUser) });
});

/** PATCH /api/users/me — úprava vlastného profilu. */
router.patch('/me', requireAuth, zValidator('json', UpdateProfileSchema), async (c) => {
  const me = c.get('user')!;
  const input = c.req.valid('json');
  const updated = await db
    .update(users)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
      ...(input.nameColor !== undefined ? { nameColor: input.nameColor } : {}),
    })
    .where(eq(users.id, me.id))
    .returning();
  return c.json({ user: toPublicUser(updated[0]!) });
});

/** POST /api/users/me/avatar — nahranie a nastavenie avatara (štvorcový crop). */
router.post('/me/avatar', requireAuth, async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`upload:${me.id}`, 10, 60_000)) {
    return c.json({ error: 'Príliš veľa nahrávaní, skús o chvíľu' }, 429);
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'Chýba súbor (pole "file")' }, 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return c.json({ error: `Súbor je príliš veľký (max ${env.MAX_IMAGE_MB} MB)` }, 413);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const row = await createImageMedia(me.id, bytes, { square: true, maxDim: AVATAR_DIM });
    const avatarUrl = `/api/media/${row.id}`;
    const updated = await db
      .update(users)
      .set({ avatarUrl })
      .where(eq(users.id, me.id))
      .returning();
    return c.json({ user: toPublicUser(updated[0]!) });
  } catch (err) {
    if (err instanceof UnsupportedMediaError) {
      return c.json({ error: err.message }, 415);
    }
    console.error('avatar upload zlyhal:', err);
    return c.json({ error: 'Spracovanie obrázka zlyhalo' }, 500);
  }
});

/** GET /api/users/:id — detail člena. (Po /me, aby /me nepadlo na tento route.) */
router.get('/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!rows[0]) return c.json({ error: 'Užívateľ nenájdený' }, 404);
  return c.json({ user: toPublicUser(rows[0]) });
});

export const usersModule: AppModule = {
  name: 'users',
  basePath: '/users',
  router,
  permissions: ['users.read', 'users.update'],
};
