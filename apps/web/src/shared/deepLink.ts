/**
 * Deep link z push notifikácie: service worker naviguje na /?room=<id>.
 * Shell (Home) si param pozrie kvôli voľbe tabu, Chat ho skonzumuje
 * (vyčistí URL, nech reload appky neotvára starú konverzáciu).
 */

export function peekRoomParam(): string | null {
  return new URLSearchParams(window.location.search).get('room');
}

export function consumeRoomParam(): string | null {
  const value = peekRoomParam();
  if (value !== null) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return value;
}
