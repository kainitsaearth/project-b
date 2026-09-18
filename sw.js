// sw.js — service worker: the app works offline, and the cooled reminder can notify.
//
// VERSION must match the ?v= used everywhere else. The deploy loop's find-and-replace of
// ?v=N covers this file too. A new VERSION = a new cache; old caches are deleted on activate.
//
// Strategy
//   page (navigation)  network first (3 s), else the cached index.html — so a deploy shows up
//                      when online, and airplane mode still opens the app
//   everything else    cache first — asset URLs carry ?v=, so a cached copy is never stale

const VERSION = '?v=24';
const CACHE = `project-b${VERSION}`;

const MODULES = [
  'app.js', 'assessScreen.js', 'assessment.js', 'brew.js', 'brewScreens.js', 'coach.js',
  'advice.js', 'adviceCard.js',
  'coachScreen.js', 'compute.js', 'dataScreen.js', 'dom.js', 'exportData.js', 'model.js',
  'recipe.js', 'store.js', 'timeline.js', 'ui.js',
];
const ASSETS = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  `./styles.css${VERSION}`,
  ...MODULES.map(m => `./${m}${VERSION}`),
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' skips the HTTP cache, so a fresh deploy is what gets stored.
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('project-b') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([fetch(req), timeout(3000)]);
        if (res.ok) await cache.put('./index.html', res.clone());
        return res;
      } catch {
        return (await cache.match('./index.html')) ?? (await cache.match('./')) ?? Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  })());
});

// Tapping the cooled-reminder notification opens that brew's scoring screen.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const hash = event.notification.data?.hash ?? '#/recipes';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      await c.focus();
      c.navigate?.(new URL(`./${hash}`, self.registration.scope).href);
      return;
    }
    await self.clients.openWindow(new URL(`./${hash}`, self.registration.scope).href);
  })());
});
