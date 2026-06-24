import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../../config/env';
import * as schema from './schema';

/**
 * Jeden zdieľaný Postgres pool + Drizzle inštancia pre celú appku.
 * postgres.js beží natívne na Bune.
 */
export const sql = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(sql, { schema });

export type DB = typeof db;
export { schema };
