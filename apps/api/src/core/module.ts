import type { Hono } from 'hono';

/**
 * Plugin kontrakt (backend) — ARCHITECTURE_V2.md §5.
 * Každý modul (kernel aj Phase 2) exportuje objekt tohto tvaru.
 * Phase 2 moduly sa pridávajú cez register(module) v app.ts — bez zásahu do core.
 *
 * Polia migrations/events/permissions/llmTools sú zatiaľ voliteľné; naplnia sa
 * v príslušných fázach (Drizzle migrácie v T2+, EventBus, RBAC, LLM tools v Phase 2).
 */
export interface AppModule {
  /** Unikátny názov modulu, napr. 'health', 'auth', 'feed'. */
  name: string;
  /** Hono sub-app, mountovaná na `basePath`. */
  router: Hono;
  /** Cesta pod /api, kam sa router mountuje, napr. '/health'. */
  basePath: string;
  /** Drizzle migrácie modulu (T2+). */
  migrations?: unknown[];
  /** Interný EventBus kontrakt (Phase 2). */
  events?: { subscribes?: string[]; emits?: string[] };
  /** RBAC permissiony, napr. ['notes.read', 'notes.write']. */
  permissions?: string[];
  /** LLM function-calling tools (Phase 2). */
  llmTools?: unknown[];
}
