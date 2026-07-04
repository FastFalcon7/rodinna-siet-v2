/**
 * Service worker (M0) — Web Push na lock screen (ARCHITECTURE_V2.md §14.4).
 * Zámerne minimálny: žiadny offline cache (to príde s PWA polishom v T8),
 * len push + klik. Payload má tvar NotificationPayload zo shared-types:
 * { title, body, url, tag? }.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Rodinná sieť', body: '', url: '/', tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* prázdny/nevalidný payload — zobrazí sa aspoň default */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Preferuj existujúce okno appky (naviguj ho), inak otvor nové.
      for (const win of wins) {
        if ('focus' in win) {
          win.focus();
          if ('navigate' in win) return win.navigate(url);
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
