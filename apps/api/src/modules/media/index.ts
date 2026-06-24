import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { env } from '../../config/env';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import { UnsupportedMediaError } from './processing';
import { createImageMedia, getMediaById, toMediaPublic } from './service';
import { readMedia } from './storage';

const router = new Hono<AppEnv>();

const MAX_IMAGE_BYTES = env.MAX_IMAGE_MB * 1024 * 1024;

/** Vytiahne `file` z multipart formu, overí veľkosť, vráti bajty alebo chybovú odpoveď. */
async function readUpload(c: Context<AppEnv>): Promise<Uint8Array | Response> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'Chýba súbor (pole "file")' }, 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return c.json({ error: `Súbor je príliš veľký (max ${env.MAX_IMAGE_MB} MB)` }, 413);
  }
  return new Uint8Array(await file.arrayBuffer());
}

/** POST /api/media — nahranie obrázka (rate limit 10/min/user, §9). */
router.post('/', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!rateLimit(`upload:${user.id}`, 10, 60_000)) {
    return c.json({ error: 'Príliš veľa nahrávaní, skús o chvíľu' }, 429);
  }

  const bytes = await readUpload(c);
  if (bytes instanceof Response) return bytes;

  try {
    const row = await createImageMedia(user.id, bytes);
    return c.json(toMediaPublic(row), 201);
  } catch (err) {
    if (err instanceof UnsupportedMediaError) {
      return c.json({ error: err.message }, 415);
    }
    console.error('media upload zlyhal:', err);
    return c.json({ error: 'Spracovanie obrázka zlyhalo' }, 500);
  }
});

/** GET /api/media/:id — streamuje súbor z disku (auth-gated, privátna sieť). */
router.get('/:id', requireAuth, async (c) => {
  const row = await getMediaById(c.req.param('id'));
  if (!row) return c.json({ error: 'Médium nenájdené' }, 404);

  const file = readMedia(row.storagePath);
  if (!(await file.exists())) return c.json({ error: 'Súbor chýba' }, 404);

  c.header('Content-Type', row.mime);
  c.header('Content-Length', String(row.bytes));
  // Obsah je nemenný (nikdy neprepisujeme existujúce id) → dlhý cache.
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  return c.body(file.stream());
});

export const mediaModule: AppModule = {
  name: 'media',
  basePath: '/media',
  router,
  permissions: ['media.upload', 'media.read'],
};
