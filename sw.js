const CACHE = 'kinohub-v9';
const IMG_CACHE = 'kinohub-img-v1';
const IMG_MAX = 80;
const LOCAL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL);
    // CDN-ресурси кешуємо по одному (no-cors), збій одного не ламає установку
    await Promise.all(CDN.map(async (url) => {
      try { await cache.add(new Request(url, { mode: 'no-cors' })); } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function trimImages(cache) {
  const keys = await cache.keys();
  if (keys.length > IMG_MAX) {
    await Promise.all(keys.slice(0, keys.length - IMG_MAX).map(k => cache.delete(k)));
  }
}

// Постери з інших сайтів: окремий кеш з обмеженням кількості
async function imageStrategy(req) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  const update = fetch(req).then(async (res) => {
    if (res && (res.status === 200 || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      trimImages(cache);
    }
    return res;
  }).catch(() => null);
  return cached || (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Сторінка: спершу мережа, офлайн — з кешу
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', net.clone());
        return net;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  // Зовнішні картинки (постери)
  if (req.destination === 'image' && url.origin !== self.location.origin) {
    event.respondWith(imageStrategy(req));
    return;
  }

  // Решта: з кешу, паралельно оновлюємо
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const update = fetch(req).then(async (res) => {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    }).catch(() => null);
    return cached || (await update) || Response.error();
  })());
});
