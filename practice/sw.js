/* Offline cache for the rehearsal app: app shell, transcript snapshot and the 17 slide shots. */
const CACHE = 'dateng-practice-v5';
const SHOTS = Array.from({ length: 17 }, (_, i) => `../forum/shots/s${String(i + 1).padStart(2, '0')}.jpg`);
const ASSETS = ['../reload-button.js', './', 'index.html', 'app.js', 'logic.js', 'recorder.js', 'memo.js', 'data.json', 'standup.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', ...SHOTS];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Network first so a fresh deploy is picked up; fall back to the cache when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('index.html'))),
  );
});
