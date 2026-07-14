import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { getAiEnabled, setAiEnabled } from './service';

const router = new Hono<AppEnv>();

/** GET /api/settings — globálne nastavenia (číta ktokoľvek prihlásený). */
router.get('/', requireAuth, async (c) => {
  return c.json({ aiEnabled: await getAiEnabled() });
});

const AiInputSchema = z.object({ enabled: z.boolean() });

/** PUT /api/settings/ai — zapnutie/vypnutie AI funkcií (len admin). */
router.put('/ai', requireAuth, requireAdmin, zValidator('json', AiInputSchema), async (c) => {
  await setAiEnabled(c.req.valid('json').enabled);
  return c.json({ aiEnabled: await getAiEnabled() });
});

export const settingsModule: AppModule = {
  name: 'settings',
  basePath: '/settings',
  router,
};
