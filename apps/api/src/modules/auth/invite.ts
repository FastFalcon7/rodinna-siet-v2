import { and, eq } from 'drizzle-orm';
import type { Role } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { inviteTokens } from '../../core/db/schema';
import { generateToken, sha256Hex } from './crypto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dní (§8)

/** Vytvorí pozvánku viazanú na email. Vráti raw token (do linku). */
export async function createInvite(params: {
  email: string;
  role: Role;
  createdBy?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const id = sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(inviteTokens).values({
    id,
    email: params.email.toLowerCase(),
    role: params.role,
    createdBy: params.createdBy ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface ValidInvite {
  id: string;
  email: string;
  role: Role;
}

/** Overí token + email. Vráti null ak neplatný/expirovaný/použitý. */
export async function validateInvite(token: string, email: string): Promise<ValidInvite | null> {
  const id = sha256Hex(token);
  const rows = await db
    .select()
    .from(inviteTokens)
    .where(and(eq(inviteTokens.id, id), eq(inviteTokens.email, email.toLowerCase())))
    .limit(1);

  const invite = rows[0];
  if (!invite) return null;
  if (invite.usedAt) return null;
  if (Date.now() >= invite.expiresAt.getTime()) return null;

  return { id: invite.id, email: invite.email, role: invite.role };
}

/** Označí pozvánku ako použitú (po úspešnej registrácii). */
export async function consumeInvite(id: string): Promise<void> {
  await db.update(inviteTokens).set({ usedAt: new Date() }).where(eq(inviteTokens.id, id));
}
