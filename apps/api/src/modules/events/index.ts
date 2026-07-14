import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  AddEventMediaInputSchema,
  CreateEventInputSchema,
  SetRsvpInputSchema,
  UpdateEventInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import { timingSafeEqualStr } from '../auth/crypto';
import { env } from '../../config/env';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  addEventMedia,
  buildIcs,
  createEvent,
  deleteEvent,
  getEvent,
  icsToken,
  listAgenda,
  removeEventMedia,
  setRsvp,
  updateEvent,
} from './service';

const router = new Hono<AppEnv>();

function mapError(err: unknown): { message: string; status: 400 | 403 | 404 } | null {
  if (err instanceof BadRequestError) return { message: err.message, status: 400 };
  if (err instanceof ForbiddenError) return { message: err.message, status: 403 };
  if (err instanceof NotFoundError) return { message: err.message, status: 404 };
  return null;
}

const AgendaQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** GET /api/events?from&to — agenda: udalosti + virtuálne narodeniny. */
router.get('/', requireAuth, zValidator('query', AgendaQuerySchema), async (c) => {
  const me = c.get('user')!;
  const q = c.req.valid('query');
  // Default od začiatku dnešného dňa — inak by dnešné narodeniny (polnoc)
  // a už prebiehajúce udalosti vypadli z agendy.
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = q.from ? new Date(q.from) : todayStart;
  const to = q.to ? new Date(q.to) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  return c.json(await listAgenda(from, to, me.id));
});

/**
 * GET /api/events/calendar.ics?token=… — read-only odber pre Apple/Google
 * Calendar. Bez session cookie (kalendárové appky ju nemajú) — chráni ho
 * token odvodený z ICS_SECRET. Bez nastaveného tajomstva je feed vypnutý.
 */
router.get('/calendar.ics', async (c) => {
  const expected = icsToken();
  if (!expected) return c.text('ICS feed nie je nakonfigurovaný', 404);
  if (!timingSafeEqualStr(c.req.query('token') ?? '', expected)) {
    return c.text('Unauthorized', 401);
  }
  return c.body(await buildIcs(), 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'inline; filename=rodinna.ics',
  });
});

/** GET /api/events/ics-url — osobná subscribe URL (zobrazí ju kalendár UI). */
router.get('/ics-url', requireAuth, (c) => {
  const token = icsToken();
  return c.json({
    url: token ? `${env.PUBLIC_WEB_ORIGIN}/api/events/calendar.ics?token=${token}` : null,
  });
});

/** POST /api/events — nová udalosť (default s RSVP kartou vo Feede). */
router.post('/', requireAuth, zValidator('json', CreateEventInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`events:${me.id}`, 10, 60_000)) {
    return c.json({ error: 'Príliš veľa udalostí, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await createEvent(me.id, c.req.valid('json')), 201);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** GET /api/events/:id — detail (živá karta). */
router.get('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await getEvent(c.req.param('id'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** PUT /api/events/:id/rsvp — Prídem / Neprídem / Neviem. */
router.put('/:id/rsvp', requireAuth, zValidator('json', SetRsvpInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await setRsvp(c.req.param('id'), me.id, c.req.valid('json').status));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/events/:id/media — pridať fotky (z composera alebo výberu vo feede). */
router.post('/:id/media', requireAuth, zValidator('json', AddEventMediaInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`eventmedia:${me.id}`, 30, 60_000)) {
    return c.json({ error: 'Príliš veľa úprav, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await addEventMedia(c.req.param('id'), me.id, c.req.valid('json').mediaIds));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/events/:id/media/:mediaId — odstrániť fotku (autor/admin). */
router.delete('/:id/media/:mediaId', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(
      await removeEventMedia(c.req.param('id'), me.id, me.role === 'admin', c.req.param('mediaId')),
    );
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** PATCH /api/events/:id — úprava (autor/admin); zmena času preplánuje pripomienky. */
router.patch('/:id', requireAuth, zValidator('json', UpdateEventInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await updateEvent(c.req.param('id'), me.id, me.role === 'admin', c.req.valid('json')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/events/:id — soft delete (autor/admin). */
router.delete('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteEvent(c.req.param('id'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

export const eventsModule: AppModule = {
  name: 'events',
  basePath: '/events',
  router,
  events: { emits: ['event:update', 'feed:card'] },
  permissions: ['events.read', 'events.write'],
};
