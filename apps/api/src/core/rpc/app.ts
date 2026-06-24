import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AppModule } from '../module';
import { env } from '../../config/env';
import { healthModule } from '../../modules/health';

/**
 * Root Hono app — všetko pod /api. Moduly sa registrujú cez register().
 * Pridanie Phase 2 modulu = jeden riadok v `modules` poli nižšie, bez zásahu do core.
 */
const app = new Hono();

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: [env.PUBLIC_WEB_ORIGIN],
    credentials: true,
  }),
);

const api = new Hono();

/** Kernel + Phase 1 moduly. Phase 2 (notes, albums, diary, games, llm) sem pribudnú. */
const modules: AppModule[] = [healthModule];

function register(target: Hono, mod: AppModule): void {
  target.route(mod.basePath, mod.router);
}

for (const mod of modules) {
  register(api, mod);
}

app.route('/api', api);

export { app, modules };
