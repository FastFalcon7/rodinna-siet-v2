import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  AddNoteItemInputSchema,
  CreateNoteInputSchema,
  UpdateNoteInputSchema,
  UpdateNoteItemInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  addItem,
  createNote,
  deleteItem,
  deleteNote,
  duplicateNote,
  getNote,
  listNotes,
  listRevisions,
  restoreRevision,
  updateItem,
  updateNote,
} from './service';

const router = new Hono<AppEnv>();

function mapError(err: unknown): { message: string; status: 400 | 403 | 404 } | null {
  if (err instanceof BadRequestError) return { message: err.message, status: 400 };
  if (err instanceof ForbiddenError) return { message: err.message, status: 403 };
  if (err instanceof NotFoundError) return { message: err.message, status: 404 };
  return null;
}

/** GET /api/notes — zoznamy a poznámky (pripnuté hore, potom podľa aktivity). */
router.get('/', requireAuth, async (c) => {
  return c.json({ notes: await listNotes() });
});

/** POST /api/notes — nový zoznam/poznámka. */
router.post('/', requireAuth, zValidator('json', CreateNoteInputSchema), async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`notes:${me.id}`, 20, 60_000)) {
    return c.json({ error: 'Príliš veľa zoznamov, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await createNote(me.id, c.req.valid('json')), 201);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** GET /api/notes/:id — detail s položkami. */
router.get('/:id', requireAuth, async (c) => {
  try {
    return c.json(await getNote(c.req.param('id')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** PATCH /api/notes/:id — názov / text (verzia sa odloží) / pripnutie. */
router.patch('/:id', requireAuth, zValidator('json', UpdateNoteInputSchema), async (c) => {
  const me = c.get('user')!;
  // Každá zmena textu odkladá revíziu (rast riadkov) — limit ako pri tvorbe.
  if (!rateLimit(`notesedit:${me.id}`, 30, 60_000)) {
    return c.json({ error: 'Príliš veľa úprav, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await updateNote(c.req.param('id'), me.id, c.req.valid('json')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/notes/:id — soft delete (autor/admin). */
router.delete('/:id', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    await deleteNote(c.req.param('id'), me.id, me.role === 'admin');
    return c.body(null, 204);
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/notes/:id/items — nová položka zoznamu. */
router.post('/:id/items', requireAuth, zValidator('json', AddNoteItemInputSchema), async (c) => {
  const me = c.get('user')!;
  // Veľkorysý limit — rýchle diktovanie nákupného zoznamu je legitímne.
  if (!rateLimit(`noteitem:${me.id}`, 60, 60_000)) {
    return c.json({ error: 'Príliš veľa položiek naraz, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await addItem(c.req.param('id'), me.id, c.req.valid('json').label));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** PATCH /api/notes/items/:itemId — odškrtnutie / text / priradenie. */
router.patch('/items/:itemId', requireAuth, zValidator('json', UpdateNoteItemInputSchema), async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await updateItem(c.req.param('itemId'), me.id, c.req.valid('json')));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** DELETE /api/notes/items/:itemId — zmazať položku. */
router.delete('/items/:itemId', requireAuth, async (c) => {
  const me = c.get('user')!;
  try {
    return c.json(await deleteItem(c.req.param('itemId'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/notes/:id/duplicate — kópia ako šablóna (odškrtnutie zmizne). */
router.post(
  '/:id/duplicate',
  requireAuth,
  zValidator('json', z.object({ title: z.string().trim().min(1).max(120).optional() })),
  async (c) => {
    const me = c.get('user')!;
    // Duplikát tvorí celú poznámku s položkami — rovnaký kôš ako POST /notes.
    if (!rateLimit(`notes:${me.id}`, 20, 60_000)) {
      return c.json({ error: 'Príliš veľa zoznamov, skús o chvíľu' }, 429);
    }
    try {
      return c.json(await duplicateNote(c.req.param('id'), me.id, c.req.valid('json').title), 201);
    } catch (err) {
      const m = mapError(err);
      if (m) return c.json({ error: m.message }, m.status);
      throw err;
    }
  },
);

/** GET /api/notes/:id/revisions — história verzií textu. */
router.get('/:id/revisions', requireAuth, async (c) => {
  try {
    return c.json({ revisions: await listRevisions(c.req.param('id')) });
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

/** POST /api/notes/:id/revisions/:revId/restore — obnoviť verziu. */
router.post('/:id/revisions/:revId/restore', requireAuth, async (c) => {
  const me = c.get('user')!;
  // Restore ide cez updateNote (odkladá revíziu) — rovnaký kôš ako PATCH.
  if (!rateLimit(`notesedit:${me.id}`, 30, 60_000)) {
    return c.json({ error: 'Príliš veľa úprav, skús o chvíľu' }, 429);
  }
  try {
    return c.json(await restoreRevision(c.req.param('id'), c.req.param('revId'), me.id));
  } catch (err) {
    const m = mapError(err);
    if (m) return c.json({ error: m.message }, m.status);
    throw err;
  }
});

export const notesModule: AppModule = {
  name: 'notes',
  basePath: '/notes',
  router,
  events: { emits: ['note:update'] },
  permissions: ['notes.read', 'notes.write'],
  // Pripravené pre M5 (@asistent function-calling) — zatiaľ len deklarácia kontraktu.
  llmTools: [
    { name: 'createList', description: 'Vytvorí nový zoznam s položkami' },
    { name: 'addItem', description: 'Pridá položku do existujúceho zoznamu' },
  ],
};
