import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  AddAlbumPhotosInputSchema,
  CreateAlbumInputSchema,
  UpdateAlbumInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  addPhotos,
  createAlbum,
  deleteAlbum,
  getAlbum,
  getMemory,
  hideMemory,
  listAlbums,
  listSuggestions,
  removePhoto,
  updateAlbum,
} from './service';
import { albumZipStream } from './zip';

const router = new Hono<AppEnv>();

function mapError(err: unknown): { message: string; status: 400 | 403 | 404 } | null {
  if (err instanceof BadRequestError) return { message: err.message, status: 400 };
  if (err instanceof ForbiddenError) return { message: err.message, status: 403 };
  if (err instanceof NotFoundError) return { message: err.message, status: 404 };
  return null;
}

/** GET /api/albums — všetky albumy (family-wide viditeľnosť ako feed). */
router.get('/', requireAuth, async (c) => {
  return c.json({ albums: await listAlbums() });
});

/** GET /api/albums/suggestions — Zberač: návrhy albumov z fotiek jedného dňa. */
router.get('/suggestions', requireAuth, async (c) => {
  return c.json({ suggestions: await listSuggestions() });
});

/** GET /api/albums/memories/:mediaId — obsah spomienkovej karty. */
router.get('/memories/:mediaId', requireAuth, async (c) => {
  try {
    return c.json(await getMemory(c.req.param('mediaId')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/albums/memories/:mediaId/hide — skryť spomienku (globálne). */
router.post('/memories/:mediaId/hide', requireAuth, async (c) => {
  const me = c.get('user')!;
  await hideMemory(c.req.param('mediaId'), me.id);
  return c.json({ ok: true });
});

/** POST /api/albums — nový album (voliteľne rovno s fotkami, napr. zo Zberača). */
router.post('/', requireAuth, zValidator('json', CreateAlbumInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`albums:${me.id}`, 10, 60_000)) {
    return c.json({ error: 'Príliš veľa albumov, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await createAlbum(me.id, c.req.valid('json')), 201);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** GET /api/albums/:id — detail s fotkami. */
router.get('/:id', requireAuth, async (c) => {
  try {
    return c.json(await getAlbum(c.req.param('id')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** GET /api/albums/:id/download — ZIP celého albumu (stream). */
router.get('/:id/download', requireAuth, async (c) => {
  try {
    const album = await getAlbum(c.req.param('id'));
    const stream = await albumZipStream(album.id);
    const filename = encodeURIComponent(`${album.title}.zip`.replace(/"/g, ''));
    return new Response(stream, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/albums/:id/photos — pridať fotky (dedupe). */
router.post('/:id/photos', requireAuth, zValidator('json', AddAlbumPhotosInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await addPhotos(c.req.param('id'), me.id, c.req.valid('json').mediaIds));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/albums/:id/photos/:mediaId — odstrániť fotku z albumu. */
router.delete('/:id/photos/:mediaId', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await removePhoto(c.req.param('id'), c.req.param('mediaId'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** PATCH /api/albums/:id — názov / obálka (autor alebo admin). */
router.patch('/:id', requireAuth, zValidator('json', UpdateAlbumInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await updateAlbum(c.req.param('id'), me.id, me.role === 'admin', c.req.valid('json')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/albums/:id — zmazať album (fotky/media ostávajú). */
router.delete('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteAlbum(c.req.param('id'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

export const albumsModule: AppModule = {
  name: 'albums',
  basePath: '/albums',
  router,
  events: { emits: ['feed:card'] },
  permissions: ['albums.read', 'albums.write'],
};
