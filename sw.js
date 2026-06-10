// TITAN-STAR Service Worker — v2
// Cache strategy: cache-first for app shell, network-first for data.json
const CACHE_NAME = 'titan-star-v2';
const APP_SHELL = [
  './TITAN-STAR.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL).catch(err => console.warn('[SW] shell cache partial fail:', err))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // data.json — network-first (最新資料優先)
  if (url.pathname.endsWith('data.json')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(r => { caches.open(CACHE_NAME).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell / CDN — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      if (r.ok && (url.origin === self.location.origin || url.hostname.includes('jsdelivr') || url.hostname.includes('googleapis'))) {
        caches.open(CACHE_NAME).then(c => c.put(e.request, r.clone()));
      }
      return r;
    }))
  );
});
