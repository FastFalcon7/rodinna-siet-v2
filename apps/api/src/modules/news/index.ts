import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { SetNewsPrefsInputSchema } from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { getPrefs, setPrefs, todaysItems } from './service';

const router = new Hono<AppEnv>();

/** GET /api/news/prefs — moje odoberané kategórie (default žiadne = vypnuté). */
router.get('/prefs', requireAuth, async (c) => {
  const me = c.get('user')!;
  return c.json({ categories: await getPrefs(me.id) });
});

/** PUT /api/news/prefs — nastav kompletnú množinu kategórií ([] = vypnúť). */
router.put('/prefs', requireAuth, zValidator('json', SetNewsPrefsInputSchema), async (c) => {
  const me = c.get('user')!;
  return c.json({ categories: await setPrefs(me.id, c.req.valid('json').categories) });
});

/** GET /api/news/today — dnešné titulky mojich kategórií (náhľad v Denníku). */
router.get('/today', requireAuth, async (c) => {
  const me = c.get('user')!;
  return c.json({ items: await todaysItems(await getPrefs(me.id)) });
});

export const newsModule: AppModule = {
  name: 'news',
  basePath: '/news',
  router,
  permissions: ['news.read'],
};
