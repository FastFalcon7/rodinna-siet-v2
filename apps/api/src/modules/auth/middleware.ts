import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../../core/types';
import { validateSessionToken } from './session';
import { readSessionCookie, clearSessionCookie } from './cookies';

/**
 * Naplní c.var.user / c.var.session z cookie (alebo null).
 * Beží na všetkých /api/* requestoch; samotnú autorizáciu rieši requireAuth.
 */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionCookie(c);
  if (!token) {
    c.set('user', null);
    c.set('session', null);
    return next();
  }

  const result = await validateSessionToken(token);
  if (!result) {
    clearSessionCookie(c);
    c.set('user', null);
    c.set('session', null);
    return next();
  }

  c.set('user', result.user);
  c.set('session', result.session);
  return next();
};

/** Vyžaduje prihláseného usera, inak 401. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) {
    return c.json({ error: 'Neautorizované' }, 401);
  }
  return next();
};

/** Vyžaduje rolu admin, inak 403. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Neautorizované' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'Vyžaduje sa admin' }, 403);
  return next();
};
