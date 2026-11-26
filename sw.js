/* ActoMind – service worker: offline app shell (precache), network-only API, runtime cache for other same-origin GETs. */
/* global ACTOMIND_FILES, ACTOMIND_VERSION */
importScripts('sw-manifest.js');

const CACHE = 'actomind-' + ACTOMIND_VERSION;
const scopeUrl = (p) => new URL(p, self.registration.scope).href;
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache individually so one failure does not break installation
    await Promise.all(ACTOMIND_FILES.map(async (f) => {
      try {
        const res = await fetch(scopeUrl(f), { cache: 'no-cache' });
        if (res.ok) await cache.put(scopeUrl(f), res);
      } catch (e) { /* offline during install – will be cached at runtime */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('actomind-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // backend: always network (TTS, status)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(scopeUrl('index.html')) || await cache.match(scopeUrl('./'));
      if (DEV) { try { return await fetch(req); } catch (e) { if (cached) return cached; throw e; } }
      if (cached) {
        // refresh in background
        event.waitUntil(fetch(req).then((res) => { if (res.ok) cache.put(scopeUrl('index.html'), res.clone()); }).catch(() => {}));
        return cached;
      }
      return fetch(req);
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (DEV) {
      // local development: always the current files, cache only as offline fallback
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (e) {
        return (await cache.match(req, { ignoreSearch: true })) || new Response('Offline', { status: 503 });
      }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
