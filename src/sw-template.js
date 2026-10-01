/* 台北街道賽 Service Worker — 由 vite.config.ts 在打包時產生，不要直接改 dist/sw.js */
const VERSION = '__VERSION__';
const CACHE = 'taipei-gp-' + VERSION;
const PRECACHE = __PRECACHE__;

// 安裝：一個一個抓，某個檔案失敗不會讓整個安裝失敗
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const u of PRECACHE) {
      try {
        const r = await fetch(u, { cache: 'no-cache' });
        if (r.ok) await c.put(u, r);
      } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

// 啟用：刪掉舊版本的快取
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('taipei-gp-') && k !== CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // 開網頁：先問網路（才拿得到新版），沒網路就用快取的那一份
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok) (await caches.open(CACHE)).put('/', r.clone());
        return r;
      } catch (_) {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // 其他檔案（檔名都帶雜湊，內容不會變）：先用快取，沒有才上網抓並存起來
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
    return r;
  })());
});
