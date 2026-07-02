/**
 * Opaque keyset pagination cursor — (createdAt, id) dvojica zakódovaná base64url,
 * nech klient nemusí (a nemôže) skladať vlastný SQL filter z voľného poľa.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.createdAt === 'string' && typeof parsed?.id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
