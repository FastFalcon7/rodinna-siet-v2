import type { CSSProperties } from 'react';

/**
 * Farba zobrazovaného mena (ladenie 07/2026): inline style, ktorý si každý
 * užívateľ nastaví v profile pre lepšiu vizuálnu orientáciu vo feede a chate.
 * null/undefined → bez override (predvolená farba textu).
 */
export function nameStyle(author?: { nameColor?: string | null } | null): CSSProperties | undefined {
  return author?.nameColor ? { color: author.nameColor } : undefined;
}
