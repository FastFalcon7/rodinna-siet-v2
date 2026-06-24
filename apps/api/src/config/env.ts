import { z } from 'zod';

/**
 * Validácia prostredia pri štarte — ak chýba povinná premenná,
 * proces spadne hneď s jasnou chybou (nie až za behu).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DOMAIN: z.string().default('localhost'),
  PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  // DATABASE_URL zatiaľ nie je povinná (T1 nemá DB pripojenie), pridá sa v T2.
  DATABASE_URL: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

export const isDev = env.NODE_ENV === 'development';
