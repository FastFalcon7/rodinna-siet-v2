import { mkdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { env } from '../../config/env';

/**
 * Úložisko na lokálnom FS (§6). Súbory ležia pod MEDIA_PATH, v DB držíme len
 * relatívnu `storagePath`. Rozdelené do podadresárov rok/mesiac, aby sa jeden
 * adresár nezahltil.
 */

/** Relatívna cesta v tvare `2026/06/<id>.<ext>`. */
export function buildStoragePath(id: string, ext: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${id}.${ext}`;
}

/** Absolútna cesta na disku; chráni pred path-traversal. */
export function resolveStoragePath(storagePath: string): string {
  const root = normalize(env.MEDIA_PATH);
  const full = normalize(join(root, storagePath));
  if (!full.startsWith(normalize(root))) {
    throw new Error('Neplatná cesta k médiu');
  }
  return full;
}

export async function writeMedia(storagePath: string, data: Buffer): Promise<void> {
  const full = resolveStoragePath(storagePath);
  await mkdir(dirname(full), { recursive: true });
  await Bun.write(full, data);
}

/** Bun.file handle pre serve endpoint (lazy stream, žiadne načítanie do RAM). */
export function readMedia(storagePath: string): ReturnType<typeof Bun.file> {
  return Bun.file(resolveStoragePath(storagePath));
}
