import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AppModule } from '../module';
import type { AppEnv } from '../types';
import { env } from '../../config/env';
import { authMiddleware } from '../../modules/auth/middleware';
import { healthModule } from '../../modules/health';
import { authModule } from '../../modules/auth';
import { usersModule } from '../../modules/users';
import { mediaModule } from '../../modules/media';
import { feedModule } from '../../modules/feed';
import { chatModule } from '../../modules/chat';
import { linkPreviewModule } from '../../modules/linkpreview';

/**
 * Root Hono app — všetko pod /api. Moduly sa registrujú cez register().
 * Pridanie Phase 2 modulu = jeden riadok v `modules` poli nižšie, bez zásahu do core.
 */
const app = new Hono<AppEnv>();

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: [env.PUBLIC_WEB_ORIGIN],
    credentials: true,
  }),
);

const api = new Hono<AppEnv>();

// Naplní user/session z cookie na každom /api requeste (pred modulmi).
api.use('*', authMiddleware);

/** Kernel + Phase 1 moduly. Phase 2 (feed, chat, notes…) sem pribudnú. */
const modules: AppModule[] = [
  healthModule,
  authModule,
  usersModule,
  mediaModule,
  feedModule,
  chatModule,
  linkPreviewModule,
];

function register(target: Hono<AppEnv>, mod: AppModule): void {
  target.route(mod.basePath, mod.router);
}

for (const mod of modules) {
  register(api, mod);
}

app.route('/api', api);

export { app, modules };
