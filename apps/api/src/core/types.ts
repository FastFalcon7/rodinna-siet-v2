import type { UserRow, SessionRow } from './db/schema';

/**
 * Zdieľaný Hono env pre celú appku. authMiddleware naplní user/session
 * (alebo null), takže každý handler/middleware má typovaný prístup.
 */
export interface AppEnv {
  Variables: {
    user: UserRow | null;
    session: SessionRow | null;
  };
}
