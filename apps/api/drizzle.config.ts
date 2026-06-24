import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/core/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://rodinna:rodinna@localhost:5432/rodinna',
  },
});
