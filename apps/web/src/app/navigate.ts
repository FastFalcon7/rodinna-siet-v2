/**
 * Mini navigačná zbernica medzi modulmi (M2): karta vo Feede/chate potrebuje
 * otvoriť svoj modul (napr. album z AlbumFeedCard). Bez routera — Home
 * počúva a prepne tab, modul si pri mounte vyzdvihne pending entitu.
 * (TanStack Router z §4 to v budúcnosti nahradí deep-linkami.)
 */

export interface NavRequest {
  module: string;
  entityId?: string;
}

/** Špeciálny „tab" pre obrazovku Viac (nie je to modul v registry). */
export const MORE_TAB = '__more__';

let pending: NavRequest | null = null;
const listeners = new Set<(r: NavRequest) => void>();

export function appNavigate(req: NavRequest): void {
  pending = req;
  for (const l of listeners) l(req);
}

export function onAppNavigate(l: (r: NavRequest) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Modul si vyzdvihne (a zmaže) svoju čakajúcu požiadavku pri mounte/prepnutí. */
export function consumePendingNav(module: string): NavRequest | null {
  if (pending?.module !== module) return null;
  const req = pending;
  pending = null;
  return req;
}
