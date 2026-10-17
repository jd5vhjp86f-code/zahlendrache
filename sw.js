// Service Worker: macht den Zahlendrachen installierbar und offline nutzbar.
// Bei jeder Änderung an den Dateien VERSION erhöhen.
const VERSION = 'v1';
const CACHE = `zahlendrache-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'lernsync.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon.svg',
  'fonts/baloo-2-latin-600-normal.woff2',
  'fonts/baloo-2-latin-700-normal.woff2',
  'fonts/baloo-2-latin-800-normal.woff2',
  'fonts/nunito-latin-400-normal.woff2',
  'fonts/nunito-latin-600-normal.woff2',
  'fonts/nunito-latin-700-normal.woff2',
  'fonts/nunito-latin-800-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('zahlendrache-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Nur eigene Dateien; der Abgleich mit dem LernSync-Server läuft immer direkt übers Netz.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Seite: erst das Netz (damit Neues sofort ankommt), ohne Netz aus dem Vorrat.
    if (req.mode === 'navigate') {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put('index.html', res.clone());
        return res;
      } catch {
        return (await cache.match('index.html')) ?? Response.error();
      }
    }
    // Übrige Dateien: aus dem Vorrat, im Hintergrund auffrischen.
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) ?? Response.error();
  })());
});
