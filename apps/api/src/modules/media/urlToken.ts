import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { appSecrets } from '../../core/db/schema';

/**
 * Tokeny v media URL (ladenie 07/2026): iOS AVPlayer (prehrávanie <video>)
 * neposiela session cookies, takže auth-gated /api/media vracal na iPhone
 * 401 → čierne okno s preškrtnutým play. Riešenie: každá media URL nesie
 * `?mt=<HMAC(mediaId)>` — kapabilitný token viazaný na konkrétne médium.
 * Kľúč sa vygeneruje pri prvom boote a žije v DB (app_secrets), žiadny
 * nový env var. Token neexpiruje — obsah média je nemenný a appka je
 * privátna rodinná sieť.
 */

const SECRET_NAME = 'media_url';

let secret: string | null = null;

/** Idempotentný bootstrap — volá API aj worker po migráciách/schéme. */
export async function initMediaUrlTokens(): Promise<void> {
  const existing = await db.select().from(appSecrets).where(eq(appSecrets.name, SECRET_NAME)).limit(1);
  if (existing[0]) {
    secret = existing[0].value;
    return;
  }
  await db
    .insert(appSecrets)
    .values({ name: SECRET_NAME, value: randomBytes(32).toString('hex') })
    .onConflictDoNothing();
  // Reselect — pri súbežnom boote API/workera vyhráva prvý insert.
  const rows = await db.select().from(appSecrets).where(eq(appSecrets.name, SECRET_NAME)).limit(1);
  secret = rows[0]!.value;
}

/** HMAC token pre médium; null kým init neprebehol (URL potom ostáva bez tokenu). */
export function mediaUrlToken(mediaId: string): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret).update(mediaId).digest('hex').slice(0, 32);
}

export function verifyMediaUrlToken(mediaId: string, token: string | undefined): boolean {
  const expected = mediaUrlToken(mediaId);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
