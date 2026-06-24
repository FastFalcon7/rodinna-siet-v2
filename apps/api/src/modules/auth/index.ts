import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, sql as dsql } from 'drizzle-orm';
import {
  LoginInputSchema,
  RegisterInputSchema,
  InviteInputSchema,
  type UserPublic,
} from '@rodinna/shared-types';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { db } from '../../core/db/client';
import { users, type UserRow } from '../../core/db/schema';
import { env } from '../../config/env';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from './crypto';
import { createSession, invalidateSession } from './session';
import { setSessionCookie, clearSessionCookie } from './cookies';
import { requireAuth, requireAdmin } from './middleware';
import { createInvite, validateInvite, consumeInvite } from './invite';
import { rateLimit } from './ratelimit';

function toPublicUser(u: UserRow): UserPublic {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'
  );
}

const router = new Hono<AppEnv>();

/** POST /api/auth/register — registrácia cez pozývací token. */
router.post('/register', zValidator('json', RegisterInputSchema), async (c) => {
  const input = c.req.valid('json');
  const email = input.email.toLowerCase();

  const invite = await validateInvite(input.token, email);
  if (!invite) {
    return c.json({ error: 'Neplatná alebo expirovaná pozvánka' }, 400);
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    return c.json({ error: 'Užívateľ s týmto emailom už existuje' }, 409);
  }

  // Prvý registrovaný užívateľ je vždy admin (bootstrap); inak rola z pozvánky.
  const countRows = await db.select({ count: dsql<number>`count(*)::int` }).from(users);
  const userCount = countRows[0]?.count ?? 0;
  const role = userCount === 0 ? 'admin' : invite.role;

  const passwordHash = await hashPassword(input.password);
  const inserted = await db
    .insert(users)
    .values({ email, displayName: input.displayName, passwordHash, role })
    .returning();
  const user = inserted[0]!;

  await consumeInvite(invite.id);

  const { token, expiresAt } = await createSession(user.id, {
    userAgent: c.req.header('user-agent'),
    ip: clientIp(c),
  });
  setSessionCookie(c, token, expiresAt);

  return c.json({ user: toPublicUser(user) }, 201);
});

/** POST /api/auth/login — email + heslo. */
router.post('/login', zValidator('json', LoginInputSchema), async (c) => {
  const ip = clientIp(c);
  if (!rateLimit(`login:${ip}`, 5, 60_000)) {
    return c.json({ error: 'Príliš veľa pokusov, skús o chvíľu' }, 429);
  }

  const input = c.req.valid('json');
  const email = input.email.toLowerCase();

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Anti user-enumeration: pri neexistujúcom userovi verifikuj dummy hash.
  if (!user || !user.passwordHash) {
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    return c.json({ error: 'Nesprávny email alebo heslo' }, 401);
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    return c.json({ error: 'Nesprávny email alebo heslo' }, 401);
  }

  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));

  const { token, expiresAt } = await createSession(user.id, {
    userAgent: c.req.header('user-agent'),
    ip,
  });
  setSessionCookie(c, token, expiresAt);

  return c.json({ user: toPublicUser(user) });
});

/** POST /api/auth/logout — zruší aktuálnu session. */
router.post('/logout', async (c) => {
  const session = c.get('session');
  if (session) await invalidateSession(session.id);
  clearSessionCookie(c);
  return c.json({ user: null });
});

/** GET /api/auth/me — aktuálny užívateľ (alebo null). */
router.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ user: user ? toPublicUser(user) : null });
});

/** POST /api/auth/invite — admin vygeneruje pozvánku. */
router.post('/invite', requireAuth, requireAdmin, zValidator('json', InviteInputSchema), async (c) => {
  const input = c.req.valid('json');
  const admin = c.get('user')!;
  const { token, expiresAt } = await createInvite({
    email: input.email,
    role: input.role,
    createdBy: admin.id,
  });
  const url = `${env.PUBLIC_WEB_ORIGIN}/register?token=${token}&email=${encodeURIComponent(input.email)}`;
  return c.json(
    { email: input.email.toLowerCase(), role: input.role, url, expiresAt: expiresAt.toISOString() },
    201,
  );
});

export const authModule: AppModule = {
  name: 'auth',
  basePath: '/auth',
  router,
  permissions: ['auth.invite'],
};
