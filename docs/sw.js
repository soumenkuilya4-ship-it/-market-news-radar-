// Market Radar service worker: offline app shell, news caching and Web Push alerts.
const VERSION = 'mr-v1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/analyzer.js',
  './js/db.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // TradingView etc. go straight to the network
  if (url.pathname.endsWith('/api/stream')) return; // never intercept SSE

  // News data: network first, fall back to the last copy.
  if (url.pathname.includes('/api/') || url.pathname.endsWith('/news.json')) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && !url.pathname.includes('/api/status')) {
          const cache = await caches.open(VERSION);
          cache.put(url.pathname.endsWith('/news.json') ? new Request(url.origin + url.pathname) : req, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(url.pathname.endsWith('/news.json') ? url.origin + url.pathname : req);
        return cached || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // App shell: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req.mode === 'navigate' ? './' : req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || (req.mode === 'navigate' ? cache.match('./') : Response.error());
  })());
});

// ---------------------------------------------------------------------------
// Push: the server only sends High impact stories.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title: 'Market Radar', body: event.data?.text() }; }
  const title = data.title || '🔴 HIGH IMPACT';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || 'radar',
    renotify: true,
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    data: { url: data.url || './', id: data.id },
    actions: [{ action: 'open', title: 'Open analysis' }],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = './', id } = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if (id) client.postMessage({ type: 'open-article', id });
        return;
      }
    }
    await self.clients.openWindow(new URL(url, self.registration.scope).href);
  })());
});
