import { Hono } from 'hono';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import { getOrFetchPreview, isUrlAllowed } from './service';

const router = new Hono<AppEnv>();

/**
 * GET /api/link-preview?url=… — OG metadáta pre URL (cache v DB).
 * Klient si preview vyžiada lazy pri renderi postu/správy s linkom —
 * odoslanie správy na fetch nikdy nečaká (DESIGN_REVIEW_FEED_CHAT.md §3.3).
 */
router.get('/', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!rateLimit(`linkpreview:${user.id}`, 30, 60_000)) {
    return c.json({ error: 'Príliš veľa dopytov, skús o chvíľu' }, 429);
  }

  const raw = c.req.query('url');
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    return c.json({ error: 'Neplatná URL' }, 400);
  }
  if (!isUrlAllowed(url)) {
    return c.json({ error: 'URL nie je povolená' }, 400);
  }

  return c.json(await getOrFetchPreview(url, user.id));
});

export const linkPreviewModule: AppModule = {
  name: 'linkpreview',
  basePath: '/link-preview',
  router,
  permissions: ['linkpreview.read'],
};
