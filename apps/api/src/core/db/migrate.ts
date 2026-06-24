import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { env } from '../../config/env';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

/**
 * Aplikuje čakajúce migrácie. Idempotentné — bezpečné spustiť pri každom štarte.
 * Pre 10 užívateľov je migrate-on-boot jednoduchšie než separátny krok.
 */
export async function runMigrations(): Promise<void> {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

// Umožní `bun src/core/db/migrate.ts` ako samostatný príkaz.
if (import.meta.main) {
  await runMigrations();
  console.log('✅ Migrácie aplikované.');
}
