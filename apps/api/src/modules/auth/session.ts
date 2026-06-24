import { eq } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { sessions, users, type SessionRow, type UserRow } from '../../core/db/schema';
import { env } from '../../config/env';
import { generateToken, sha256Hex } from './crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = () => env.SESSION_TTL_DAYS * DAY_MS;

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Vytvorí session: vygeneruje token (vráti sa klientovi do cookie),
 * uloží len jeho hash ako id. Lucia v3 pattern.
 */
export async function createSession(userId: string, meta: SessionMeta = {}): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = generateToken();
  const id = sha256Hex(token);
  const expiresAt = new Date(Date.now() + TTL_MS());
  await db.insert(sessions).values({
    id,
    userId,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface ValidatedSession {
  session: SessionRow;
  user: UserRow;
}

/**
 * Overí token z cookie. Vracia null ak neexistuje/expiroval.
 * Sliding expiration: ak je session za polovicou životnosti, predĺži ju.
 */
export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  const id = sha256Hex(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  if (now >= row.session.expiresAt.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  // Sliding renewal — za polovicou TTL predĺž.
  if (now >= row.session.expiresAt.getTime() - TTL_MS() / 2) {
    const expiresAt = new Date(now + TTL_MS());
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    row.session.expiresAt = expiresAt;
  }

  return { session: row.session, user: row.user };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
