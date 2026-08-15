// TITAN-STAR Service Worker - v20260724-2
// Runtime files must stay fresh. Older cache-first behavior could keep mobile
// browsers on stale app.js/data.json after a deployment.
const CACHE_NAME = 'titan-star-v20260724-2';
const APP_SHELL = [
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(err => console.warn('[SW] shell cache partial fail:', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url).catch(() => null))))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isRuntimeFile =
    url.origin === self.location.origin &&
    (url.pathname.endsWith('/') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.json'));

  if (isRuntimeFile) {
    event.respondWith(
      // 'no-cache' 會帶 If-None-Match 做條件式請求：內容沒變時伺服器回 304、
      // 不重傳 body（data.json 目前 2.6MB，用 'no-store' 等於每次全量下載）。
      // 仍然是網路優先，離線時才退回 cache。
      fetch(event.request, { cache: 'no-cache' })
        .then(response => {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok && (url.hostname.includes('jsdelivr') || url.hostname.includes('googleapis'))) {
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      }
      return response;
    }))
  );
});
