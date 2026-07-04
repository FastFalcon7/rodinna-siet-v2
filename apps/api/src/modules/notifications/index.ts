import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  MarkNotificationsReadInputSchema,
  NotificationPrefsSchema,
  PushSubscribeInputSchema,
  PushUnsubscribeInputSchema,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { env } from '../../config/env';
import {
  getPrefs,
  listNotifications,
  markNotificationsRead,
  removePushSubscription,
  savePushSubscription,
  setPrefs,
} from './service';

const router = new Hono<AppEnv>();

/** GET /api/notifications — posledné in-app notifikácie + počet neprečítaných. */
router.get('/', requireAuth, async (c) => {
  const me = c.get('user')!;
  return c.json(await listNotifications(me.id));
});

/** POST /api/notifications/read — označ prečítané (bez ids = všetky). */
router.post('/read', requireAuth, zValidator('json', MarkNotificationsReadInputSchema), async (c) => {
  const me = c.get('user')!;
  await markNotificationsRead(me.id, c.req.valid('json').ids);
  return c.json(await listNotifications(me.id));
});

/** GET /api/notifications/push/key — VAPID public key (null = push vypnutý na serveri). */
router.get('/push/key', requireAuth, (c) => {
  return c.json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
});

/** POST /api/notifications/push/subscriptions — registrácia zariadenia (upsert). */
router.post(
  '/push/subscriptions',
  requireAuth,
  zValidator('json', PushSubscribeInputSchema),
  async (c) => {
    const me = c.get('user')!;
    await savePushSubscription(me.id, c.req.valid('json'));
    return c.json({ ok: true }, 201);
  },
);

/** POST /api/notifications/push/unsubscribe — odhlásenie zariadenia. */
router.post(
  '/push/unsubscribe',
  requireAuth,
  zValidator('json', PushUnsubscribeInputSchema),
  async (c) => {
    const me = c.get('user')!;
    await removePushSubscription(me.id, c.req.valid('json').endpoint);
    return c.json({ ok: true });
  },
);

/** GET /api/notifications/prefs — per-kind preferencie (chýbajúci kľúč = zapnuté). */
router.get('/prefs', requireAuth, async (c) => {
  const me = c.get('user')!;
  return c.json({ prefs: await getPrefs(me.id) });
});

/** PUT /api/notifications/prefs — merge preferencií. */
router.put('/prefs', requireAuth, zValidator('json', NotificationPrefsSchema), async (c) => {
  const me = c.get('user')!;
  return c.json({ prefs: await setPrefs(me.id, c.req.valid('json')) });
});

export const notificationsModule: AppModule = {
  name: 'notifications',
  basePath: '/notifications',
  router,
  permissions: ['notifications.read', 'notifications.write'],
};
