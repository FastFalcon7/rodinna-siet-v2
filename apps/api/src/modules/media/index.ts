import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { env } from '../../config/env';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import { detectUpload, UnsupportedMediaError } from './processing';
import { createImageMedia, createRawMedia, getMediaById, toMediaPublic } from './service';
import { readMedia } from './storage';

const router = new Hono<AppEnv>();

/** Limity per kategória (MB → bajty). Kontrola až po detekcii magic bytov. */
const MAX_BYTES = {
  image: env.MAX_IMAGE_MB * 1024 * 1024,
  video: env.MAX_VIDEO_MB * 1024 * 1024,
  file: env.MAX_FILE_MB * 1024 * 1024,
} as const;
const MAX_MB = { image: env.MAX_IMAGE_MB, video: env.MAX_VIDEO_MB, file: env.MAX_FILE_MB } as const;

/** Horný strop pre čítanie multipartu = najväčší z limitov. */
const MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_BYTES));

/** Vytiahne `file` z multipart formu, overí hrubú veľkosť, vráti súbor alebo chybovú odpoveď. */
async function readUpload(c: Context<AppEnv>): Promise<File | Response> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'Chýba súbor (pole "file")' }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `Súbor je príliš veľký (max ${env.MAX_VIDEO_MB} MB)` }, 413);
  }
  return file;
}

/**
 * POST /api/media — nahranie obrázka / videa / súboru (rate limit 10/min/user, §9).
 * Kategória sa určuje z magic bytov: obrázky idú cez sharp pipeline (resize,
 * WebP, EXIF strip), video a iné súbory sa ukladajú ako originál.
 */
router.post('/', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!rateLimit(`upload:${user.id}`, 10, 60_000)) {
    return c.json({ error: 'Príliš veľa nahrávaní, skús o chvíľu' }, 429);
  }

  const file = await readUpload(c);
  if (file instanceof Response) return file;
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const detected = await detectUpload(bytes, file.name);
    if (bytes.length > MAX_BYTES[detected.category]) {
      const label = { image: 'Obrázok', video: 'Video', file: 'Súbor' }[detected.category];
      return c.json({ error: `${label} je príliš veľký (max ${MAX_MB[detected.category]} MB)` }, 413);
    }

    const row =
      detected.category === 'image'
        ? await createImageMedia(user.id, bytes)
        : await createRawMedia(user.id, bytes, {
            kind: detected.category,
            mime: detected.mime,
            ext: detected.ext,
            fileName: file.name ? file.name.slice(0, 255) : null,
          });
    return c.json(toMediaPublic(row), 201);
  } catch (err) {
    if (err instanceof UnsupportedMediaError) {
      return c.json({ error: err.message }, 415);
    }
    console.error('media upload zlyhal:', err);
    return c.json({ error: 'Spracovanie súboru zlyhalo' }, 500);
  }
});

/** `Range: bytes=start-end` → [start, end] (vrátane), alebo null ak nevalidný. */
function parseRange(header: string, size: number): [number, number] | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // suffix range: posledných N bajtov
    const n = Number(m[2]);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return [start, end];
}

/**
 * GET /api/media/:id/poster — poster frame videa (JPEG z transkód jobu).
 * Pred /:id, nech ho parameter route nezhltne.
 */
router.get('/:id/poster', requireAuth, async (c) => {
  const row = await getMediaById(c.req.param('id'));
  if (!row?.posterPath) return c.json({ error: 'Poster nenájdený' }, 404);
  const file = readMedia(row.posterPath);
  if (!(await file.exists())) return c.json({ error: 'Súbor chýba' }, 404);
  c.header('Content-Type', 'image/jpeg');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  c.header('Content-Length', String(file.size));
  return c.body(file.stream());
});

/**
 * GET /api/media/:id — streamuje súbor z disku (auth-gated, privátna sieť).
 * Podporuje Range requesty — iOS Safari bez nich odmietne prehrať <video>.
 * kind='file' sa servíruje ako attachment (žiadne inline HTML/SVG → XSS).
 * Video s hotovým transkódom sa servíruje ako normalizovaný H.264 MP4
 * (playbackPath) — originál ostáva na disku ako archív.
 */
router.get('/:id', requireAuth, async (c) => {
  const row = await getMediaById(c.req.param('id'));
  if (!row) return c.json({ error: 'Médium nenájdené' }, 404);

  const usePlayback = row.playbackPath !== null;
  const file = readMedia(usePlayback ? row.playbackPath! : row.storagePath);
  if (!(await file.exists())) return c.json({ error: 'Súbor chýba' }, 404);
  // Skutočná veľkosť z disku — playback súbor má inú veľkosť než originál v DB.
  const size = file.size;

  c.header('Content-Type', usePlayback ? 'video/mp4' : row.mime);
  c.header('Accept-Ranges', 'bytes');
  c.header('X-Content-Type-Options', 'nosniff');
  // Obsah je nemenný (nikdy neprepisujeme existujúce id) → dlhý cache.
  c.header('Cache-Control', 'private, max-age=31536000, immutable');

  if (row.kind === 'file') {
    const name = (row.fileName ?? `subor.${row.storagePath.split('.').pop()}`).replace(/["\\\r\n]/g, '');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }

  const rangeHeader = c.req.header('range');
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      c.header('Content-Range', `bytes */${size}`);
      return c.body(null, 416);
    }
    const [start, end] = range;
    c.header('Content-Range', `bytes ${start}-${end}/${size}`);
    c.header('Content-Length', String(end - start + 1));
    return c.body(file.slice(start, end + 1).stream(), 206);
  }

  c.header('Content-Length', String(size));
  return c.body(file.stream());
});

export const mediaModule: AppModule = {
  name: 'media',
  basePath: '/media',
  router,
  permissions: ['media.upload', 'media.read'],
};
