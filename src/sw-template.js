/* 台北街道賽 Service Worker — 由 vite.config.ts 在打包時產生，不要直接改 dist/sw.js */
const VERSION = '__VERSION__';
const PREFIX = 'taipei-gp-';
const CACHE = PREFIX + VERSION;
const PRECACHE = __PRECACHE__;
const READY = '/__taipei-gp-offline-ready__';

// 期限包含 cache.put 讀完 body；只有回應標頭也不算完成下載。
async function downloadInto(cache, url) {
  const controller = new AbortController();
  let timer;
  try {
    await Promise.race([
      (async () => {
        const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error(`離線資料 ${url} HTTP ${response.status}`);
        await cache.put(url, response);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error(`離線資料 ${url} 下載逾時`)); }, 30000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

// 核心資料全部成功才標記可用並接管。失敗讓安裝失敗，現用 worker／快取繼續服務。
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = await cache.match(READY);
    if (!complete) {
      try {
        for (const url of PRECACHE) await downloadInto(cache, url);
        await cache.put(READY, new Response(VERSION));
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const current = await caches.open(CACHE);
    if (!(await current.match(READY))) throw new Error('離線核心資料未完成，拒絕啟用');
    const older = (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE);
    // 保留上一版：舊分頁仍可能按需載入舊檔名；也提供一份可回退的離線內容。
    const complete = [];
    for (const key of older) if (await (await caches.open(key)).match(READY)) complete.push(key);
    // 安裝中斷可能留一份未完成快取，不能把它當作上一個可用版本。
    // 第一次遷移的舊 worker 沒有 READY，先保留；之後有已驗證的上一版才清理。
    const previous = complete[complete.length - 1];
    if (previous) for (const key of older) if (key !== previous) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function navigation(request) {
  const controller = new AbortController();
  let timer;
  try {
    const response = await Promise.race([
      fetch(request, { signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('導覽連線逾時')); }, 8000);
      }),
    ]);
    if (response.ok) return response;
  } catch (_) { /* 斷網、逾時或伺服器錯誤，回到完整版本的入口 */ }
  finally { clearTimeout(timer); }
  // 不能用線上新 index 覆寫目前核心快照，否則離線時可能參照未下載的新 bundle。
  return (await (await caches.open(CACHE)).match('/')) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const request = e.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') { e.respondWith(navigation(request)); return; }
  e.respondWith((async () => {
    const current = await caches.open(CACHE);
    const hit = await current.match(request, { ignoreSearch: true });
    if (hit) return hit;
    // 只有雜湊資產可跨版查找；地圖等固定網址只能讀本版，避免新舊資料混搭。
    if (/^\/assets\/[^/]+-[\w-]+\.(js|css)$/.test(url.pathname)) {
      for (const key of (await caches.keys()).reverse()) {
        if (!key.startsWith(PREFIX) || key === CACHE) continue;
        const previous = await (await caches.open(key)).match(request, { ignoreSearch: true });
        if (previous) return previous;
      }
    }
    const response = await fetch(request);
    if (response.ok) e.waitUntil(current.put(request, response.clone()).catch(() => {}));
    return response;
  })());
});
