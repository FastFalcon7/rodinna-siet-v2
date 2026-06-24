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
  // Od T2 povinná — auth/feed/chat potrebujú DB.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL je povinná'),
  // Životnosť session (dni). Sliding expiration sa predĺži pri aktivite.
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export const env = EnvSchema.parse(process.env);

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';

/** Cookie 'Secure' iba v produkcii (dev na NAS beží cez http://IP:port). */
export const cookieSecure = isProd;
