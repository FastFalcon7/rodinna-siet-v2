import { Hono } from 'hono';
import { HealthResponseSchema, type HealthResponse } from '@rodinna/shared-types';
import type { AppModule } from '../../core/module';
import type { AppEnv } from '../../core/types';
import { version } from '../../version';

const router = new Hono<AppEnv>();

/**
 * GET /api/health — liveness check.
 * Akceptačné kritérium T1: vracia 200 OK s platným telom.
 * Výstup validujeme zdieľanou Zod schémou, aby kontrakt API↔web nikdy nezišiel.
 */
router.get('/', (c) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'rodinna-api',
    version,
    timestamp: new Date().toISOString(),
  };
  return c.json(HealthResponseSchema.parse(body));
});

export const healthModule: AppModule = {
  name: 'health',
  basePath: '/health',
  router,
};
