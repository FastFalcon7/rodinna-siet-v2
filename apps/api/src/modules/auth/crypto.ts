/** Kryptografické pomôcky pre auth — postavené na Bun natívnych API. */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Náhodný opaque token (24 bajtov → 48 hex znakov). Posiela sa klientovi. */
export function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** SHA-256 hex — token nikdy neukladáme v plaintexte, len jeho hash. */
export function sha256Hex(input: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(input);
  return hasher.digest('hex');
}

/** SHA-256 hex z binárnych dát (napr. obsah súboru) — kontrola integrity. */
export function sha256HexBytes(input: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(input);
  return hasher.digest('hex');
}

/** Hashovanie hesla — argon2id (§8), natívne v Bune (žiadna native závislosť). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/**
 * Dummy hash na vyrovnanie časovania pri neexistujúcom userovi (anti user-enumeration).
 * verify proti nemu trvá podobne ako proti reálnemu hashu.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$3hhr3vWhM5tBfV0F5R7m7iBFY0gqkmU0X5Q2pPaYh0E';
