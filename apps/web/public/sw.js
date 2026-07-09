/**
 * Service worker — Web Push (M0) + offline app shell (T8, PWA polish).
 *
 * Push (§14.4): payload má tvar NotificationPayload zo shared-types
 * { title, body, url, tag? } → notifikácia na lock screen + klik naviguje.
 *
 * Offline shell (T8): appka sa otvorí aj bez siete (posledný cachnutý shell).
 * Stratégia zámerne konzervatívna, aby deploy nezostal „zaseknutý" na starej
 * verzii:
 *   • navigácie (mode==='navigate') = network-first → offline fallback na '/'
 *     (index.html je vždy čerstvý, keď je sieť → načíta nové hashované assety),
 *   • hashované statické assety (/assets/*, ikony, fonty) = cache-first
 *     (Vite ich verzionuje obsahom, takže nová verzia = nová URL),
 *   • /api/* a /ws sa NIKDY necachujú — dáta idú vždy na sieť (appka si
 *     výpadok rieši sama, offline ukáže prázdny/last stav),
 *   • pri aktivácii sa staré cache verzie zmažú.
 */

const CACHE = 'rodinna-shell-v4';
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

/**
 * Warm cache: pri prvej návšteve SW ešte nekontroluje stránku, takže hashované
 * JS/CSS (index-*.js) sa cez fetch handler nezachytia a offline by React
 * nenaskočil. Preto si pri inštalácii stiahneme index.html a predcachneme
 * assety, na ktoré odkazuje — offline shell funguje už od prvej návštevy.
 */
async function warmShell(cache) {
  try {
    const res = await fetch('/', { cache: 'no-cache' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put('/', res);
    const urls = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|woff2?))"/g)].map((m) => m[1]);
    await Promise.allSettled([...new Set(urls)].map((u) => cache.add(u)));
  } catch {
    /* offline pri inštalácii — nič, shell sa dohrá neskôr */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Shell po jednom — jeden chýbajúci súbor nezhodí celú inštaláciu SW.
      await Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)));
      await warmShell(cache);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url, request) {
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) return true;
  return ['script', 'style', 'font', 'image'].includes(request.destination);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cudzí pôvod — nechaj tak
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return; // dáta = vždy sieť

  // Navigácie: network-first, offline fallback na cachnutý shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('/', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (await caches.match('/')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Hashované statické assety: cache-first + doplnenie na pozadí.
  if (isStaticAsset(url, request)) {
    event.respondWith(
      (async () => {
        // ignoreVary: ES-modulový <script> je CORS request s hlavičkou Origin;
        // server posiela `Vary`, takže bez ignoreVary by cache-match minul
        // (miss) a offline by JS nenaskočil. Kľúčom je hashovaná URL.
        const cached = await caches.match(request, { ignoreVary: true });
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(CACHE);
            cache.put(request, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          return Response.error();
        }
      })(),
    );
  }
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
