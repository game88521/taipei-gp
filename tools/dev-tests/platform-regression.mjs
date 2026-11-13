// 隔離驗證：不建 WebGL、不連線、不讀寫玩家存檔。
// before 使用獨立基準快照，可用參數或 GP_BASELINE_DIR 覆寫。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? resolve(root, '../taipei-gp-priority-before-20261111'));
const THREE_URL = pathToFileURL(resolve(root, 'node_modules/three/build/three.module.js')).href;
const THREE = await import(THREE_URL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const source = (base, name) => readFile(resolve(base, 'src', name), 'utf8');
const asURL = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function moduleURL(base, name, deps = {}) {
  let js = stripTypeScriptTypes(await source(base, name), { mode: 'transform' });
  js = js.replace(/from (['"])([^'"]+)\1/g, (all, quote, spec) => {
    const dep = deps[spec] ?? (spec === 'three' ? THREE_URL : spec.startsWith('three/') ? pathToFileURL(resolve(root, 'node_modules', spec)).href : null);
    return dep ? `from ${quote}${dep}${quote}` : all;
  });
  return asURL(js);
}
const networkURL = await moduleURL(root, 'network.ts');
const network = await import(networkURL);
const results = { before, after: root, webglCreated: false, liveNetworkUsed: false };

globalThis.innerWidth = 800; globalThis.innerHeight = 600;
const renderer = { getPixelRatio: () => 1.3 };
const size = (bloom) => [bloom.renderTargetBright.width, bloom.renderTargetBright.height];
async function bloomCheck(base) {
  const graphics = await import(await moduleURL(base, 'graphics.ts'));
  const parts = graphics.makeComposer(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), 0.5);
  const initial = size(parts.bloom);
  parts.composer.setSize(800, 600);
  const resized = size(parts.bloom);
  if (graphics.setBloomScale) {
    graphics.setBloomScale(parts.bloom, 1);
    assert.deepEqual(size(parts.bloom), [520, 390]);
    parts.composer.setPixelRatio(1);
    assert.deepEqual(size(parts.bloom), [400, 300]);
    graphics.setBloomScale(parts.bloom, 0.5);
    assert.deepEqual(size(parts.bloom), [200, 150]);
    parts.composer.setSize(1000, 500);
    assert.deepEqual(size(parts.bloom), [250, 125]);
  }
  const targets = [parts.composer.renderTarget1, parts.composer.renderTarget2, parts.bloom.renderTargetBright, ...parts.bloom.renderTargetsHorizontal, ...parts.bloom.renderTargetsVertical];
  let disposed = 0;
  for (const target of targets) target.addEventListener('dispose', () => disposed++);
  if (graphics.disposeComposer) {
    graphics.disposeComposer(parts.composer);
    assert.equal(disposed, targets.length);
  } else {
    // 原來的關閉分支只捨棄參照；先記錄，再手動清理測試資源。
    assert.equal(disposed, 0);
    for (const pass of parts.composer.passes) pass.dispose?.();
    parts.composer.dispose();
  }
  return { initial, resized, disposeAPI: !!graphics.disposeComposer };
}
results.bloom = { before: await bloomCheck(before), after: await bloomCheck(root) };
assert.deepEqual(results.bloom.before.initial, [676, 507]);
assert.deepEqual(results.bloom.before.resized, [520, 390]);
assert.deepEqual(results.bloom.after.initial, [260, 195]);
assert.deepEqual(results.bloom.after.resized, [260, 195]);

async function environmentCheck(base) {
  const counts = { targets: 0, geometry: 0, material: 0, pmrem: 0, sky: 0 };
  globalThis.__platformEnvCounts = counts;
  const fakeThree = asURL(`export * from ${JSON.stringify(THREE_URL)};
    import {WebGLRenderTarget} from ${JSON.stringify(THREE_URL)};
    export class PMREMGenerator {
      fromScene(){ const t=new WebGLRenderTarget(8,8); t.addEventListener('dispose',()=>globalThis.__platformEnvCounts.targets++); return t; }
      dispose(){ globalThis.__platformEnvCounts.pmrem++; }
    }`);
  const graphics = await import(await moduleURL(base, 'graphics.ts', { three: fakeThree }));
  const scene = new THREE.Scene();
  const world = { sky: new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial()), sunDir: new THREE.Vector3(1, 1, 1) };
  world.sky.geometry.addEventListener('dispose', () => counts.sky++);
  const oldGeo = THREE.BufferGeometry.prototype.dispose, oldMat = THREE.Material.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function () { counts.geometry++; return oldGeo.call(this); };
  THREE.Material.prototype.dispose = function () { counts.material++; return oldMat.call(this); };
  try {
    graphics.buildEnvMap({}, scene, world); graphics.buildEnvMap({}, scene, world);
    graphics.disposeEnvMap?.(scene);
  } finally {
    THREE.BufferGeometry.prototype.dispose = oldGeo; THREE.Material.prototype.dispose = oldMat;
  }
  return counts;
}
results.environment = { before: await environmentCheck(before), after: await environmentCheck(root) };
assert.equal(results.environment.before.targets, 0);
assert.deepEqual(results.environment.after, { targets: 2, geometry: 4, material: 4, pmrem: 2, sky: 0 });

const realFetch = globalThis.fetch;
try {
  const oldLoading = await import(await moduleURL(before, 'loading.ts'));
  const loading = await import(await moduleURL(root, 'loading.ts', { './network': networkURL }));
  globalThis.fetch = async () => new Promise(() => {});
  const oldStall = oldLoading.fetchJson('/stalled', 1, '測試', 0, 1);
  assert.equal(await Promise.race([oldStall.then(() => 'resolved', () => 'rejected'), sleep(35).then(() => 'pending')]), 'pending');
  await assert.rejects(network.fetchJsonWithRetry('/stalled', { timeoutMs: 20, idleTimeoutMs: 100, retries: 0 }), (e) => e.code === 'timeout');
  let streamCancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"x":')); }, cancel() { streamCancelled = true; } }));
  await assert.rejects(network.fetchJsonWithRetry('/body-stalled', { timeoutMs: 100, idleTimeoutMs: 15, retries: 0 }), (e) => e.code === 'idle');
  assert.equal(streamCancelled, true);
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ ok: true });
  assert.deepEqual(await network.fetchJsonWithRetry('/retry', { retryDelayMs: 0 }), { ok: true });
  assert.equal(calls, 2);
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 404 }); };
  await assert.rejects(network.fetchJsonWithRetry('/missing'), (e) => e.status === 404);
  assert.equal(calls, 1);
  calls = 0;
  globalThis.fetch = async (_url, opts) => { assert.equal(opts.method, 'POST'); assert.equal(opts.body, '{"time":55}'); calls++; return new Response('', { status: 503 }); };
  await assert.rejects(network.fetchJsonWithRetry('/submit', { method: 'POST', body: '{"time":55}', retries: 3 }), (e) => e.status === 503);
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Promise(() => {});
  const controller = new AbortController();
  const task = network.requestJson('/cancel', { signal: controller.signal });
  controller.abort();
  await assert.rejects(task.promise, (e) => e.code === 'cancelled');
  const explicit = network.requestJson('/explicit-cancel');
  explicit.cancel();
  await assert.rejects(explicit.promise, (e) => e.code === 'cancelled');
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{bad json'); };
  await assert.rejects(network.fetchJsonWithRetry('/invalid'), (e) => e.code === 'invalid');
  assert.equal(calls, 1);
  calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ city: true }); };
  loading.prefetch('/prefetch');
  await sleep(2);
  assert.deepEqual(await loading.fetchJson('/prefetch', 1, '地圖', 0, 1), { city: true });
  assert.equal(calls, 1);
  loading.prefetch('/prefetch-already-done');
  await sleep(2);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(loading.fetchJson('/prefetch-already-done', 1, '地圖', 0, 1, { signal: alreadyAborted.signal }), (e) => e.code === 'cancelled');
  loading.cancelPrefetch('/prefetch-already-done');
  globalThis.fetch = async () => new Promise(() => {});
  loading.prefetch('/prefetch-timeout', { timeoutMs: 20, idleTimeoutMs: 100, retries: 0 });
  await assert.rejects(loading.fetchJson('/prefetch-timeout', 1, '地圖', 0, 1), (e) => e.code === 'timeout');
  loading.prefetch('/prefetch-cancel'); loading.cancelPrefetch('/prefetch-cancel');
  await sleep(1);
  globalThis.location = { search: '?circuit=japan' };
  const circuitCatalogURL = await moduleURL(root, '../shared/circuit-catalog.ts');
  const circuits = await import(await moduleURL(root, 'circuits.ts', { './network': networkURL, '../shared/circuit-catalog': circuitCatalogURL }));
  await assert.rejects(circuits.loadCircuitData({ timeoutMs: 20, idleTimeoutMs: 100, retries: 0 }), (e) => e.code === 'timeout');
  results.network = { beforeStalled: 'pending', timeout: 'PASS', bodyIdleCancellation: 'PASS', get503Retry: 2, get404Requests: 1, post503Requests: 1, invalidJSONRequests: 1, externalAbort: 'PASS', explicitCancel: 'PASS', prefetchRequests: 1, prefetchTimeout: 'PASS', abortedPrefetchHandoff: 'PASS', circuitTimeout: 'PASS' };
} finally { globalThis.fetch = realFetch; }

function cacheStorage() {
  const values = new Map();
  const keyOf = (req) => new URL(typeof req === 'string' ? req : req.url, 'https://game.test').href;
  const caches = {
    async open(name) {
      if (!values.has(name)) values.set(name, new Map());
      const data = values.get(name);
      return {
        async put(req, response) { const body = await response.arrayBuffer(); data.set(keyOf(req), new Response(body, { status: response.status, headers: response.headers })); },
        async match(req) { return data.get(keyOf(req))?.clone(); },
      };
    },
    async keys() { return [...values.keys()]; },
    async delete(name) { return values.delete(name); },
    async match(req) { for (const name of values.keys()) { const hit = await (await caches.open(name)).match(req); if (hit) return hit; } },
  };
  return caches;
}
async function worker(base, version, storage, fetcher, timerLimit = Infinity) {
  const listeners = new Map();
  let skipped = 0, claimed = 0;
  const context = vm.createContext({ caches: storage, fetch: fetcher, Response, Request, URL, AbortController, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, timerLimit)), clearTimeout, location: { origin: 'https://game.test' }, self: { addEventListener: (name, handler) => listeners.set(name, handler), skipWaiting: async () => skipped++, clients: { claim: async () => claimed++ } } });
  const code = (await source(base, 'sw-template.js')).replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['/', '/assets/main-new.js', '/data/city.json']));
  vm.runInContext(code, context);
  return {
    get skipped() { return skipped; }, get claimed() { return claimed; },
    async event(name, request) {
      const pending = []; let result;
      listeners.get(name)({ request, waitUntil: (promise) => pending.push(promise), respondWith: (promise) => { result = promise; } });
      const response = await result;
      await Promise.all(pending);
      return response;
    },
  };
}
async function seed(storage) {
  const old = await storage.open('taipei-gp-old');
  await old.put('/', new Response('old-index'));
  await old.put('/assets/lazy-old.js', new Response('old-lazy'));
  await old.put('/data/city.json', new Response('old-city'));
}
async function failedUpdate(base) {
  const storage = cacheStorage(); await seed(storage);
  const w = await worker(base, 'failed', storage, async (url) => url === '/assets/main-new.js' ? new Response('', { status: 503 }) : new Response('ok'));
  let installFailed = false;
  try { await w.event('install'); await w.event('activate'); } catch { installFailed = true; }
  return { installFailed, skipWaiting: w.skipped, oldCacheRetained: (await storage.keys()).includes('taipei-gp-old') };
}
results.offline = { before: await failedUpdate(before), after: await failedUpdate(root) };
assert.deepEqual(results.offline.before, { installFailed: false, skipWaiting: 1, oldCacheRetained: false });
assert.deepEqual(results.offline.after, { installFailed: true, skipWaiting: 0, oldCacheRetained: true });
{
  const storage = cacheStorage(); await seed(storage);
  let online = true, navigationText = 'online-newer-index';
  const w = await worker(root, 'complete', storage, async (req) => {
    if (!online) throw new Error('offline');
    if (typeof req === 'string') return new Response(req === '/' ? 'complete-index' : req === '/data/city.json' ? 'current-city' : 'main');
    return new Response(navigationText);
  });
  await w.event('install'); await w.event('activate');
  assert.deepEqual(await storage.keys(), ['taipei-gp-old', 'taipei-gp-complete']);
  const request = (path, mode = 'cors') => ({ url: `https://game.test${path}`, method: 'GET', mode, headers: new Headers() });
  assert.equal(await (await w.event('fetch', request('/', 'navigate'))).text(), navigationText);
  online = false;
  assert.equal(await (await w.event('fetch', request('/', 'navigate'))).text(), 'complete-index');
  assert.equal(await (await w.event('fetch', request('/data/city.json'))).text(), 'current-city');
  assert.equal(await (await w.event('fetch', request('/assets/lazy-old.js'))).text(), 'old-lazy');
  assert.equal(await w.event('fetch', request('/api/leaderboard')), undefined);
  await (await storage.open('taipei-gp-interrupted')).put('/', new Response('incomplete-index'));
  const next = await worker(root, 'next', storage, async () => new Response('next-complete'));
  await next.event('install'); await next.event('activate');
  assert.deepEqual(await storage.keys(), ['taipei-gp-complete', 'taipei-gp-next']);
  results.offline.successfulUpdate = { previousRetained: true, currentMapPreferred: true, oldLazyAssetAvailable: true, onlineNavigationCannotOverwriteCore: true, apiBypassesCache: true };
  results.offline.interruptedSnapshotNeverReplacesPrevious = true;
}
{
  const storage = cacheStorage(); await seed(storage);
  const stalledBody = async (_url, opts) => new Response(new ReadableStream({ start(c) { opts.signal?.addEventListener('abort', () => c.error(new Error('aborted'))); } }));
  const old = await worker(before, 'stalled', storage, stalledBody);
  assert.equal(await Promise.race([old.event('install').then(() => 'installed', () => 'rejected'), sleep(35).then(() => 'pending')]), 'pending');
  const updated = await worker(root, 'bounded', storage, stalledBody, 20);
  await assert.rejects(updated.event('install'), /下載逾時/);
  assert.equal(updated.skipped, 0);
  assert.equal((await storage.keys()).includes('taipei-gp-old'), true);
  results.offline.stalledCoreBody = { before: 'pending', after: 'rejected-with-old-cache-retained' };
}

class ElementStub {
  constructor(interactive = false) { this.interactive = interactive; this.style = {}; this.classList = { add() {}, remove() {} }; }
  addEventListener() {} closest(selector) { return this.interactive === 'summary' ? (selector.split(',').includes('summary') ? this : null) : this.interactive ? this : null; }
  setPointerCapture() {} getBoundingClientRect() { return { width: 100, left: 0 }; }
}
const oldGlobals = { Element: globalThis.Element, addEventListener: globalThis.addEventListener, document: globalThis.document, screen: globalThis.screen };
async function keyboardCheck(base) {
  const handlers = new Map();
  globalThis.Element = ElementStub;
  globalThis.addEventListener = (name, fn) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); };
  globalThis.document = { addEventListener() {} }; globalThis.screen = { orientation: { addEventListener() {} } };
  const { Input } = await import(await moduleURL(base, 'input.ts'));
  const input = new Input(...Array.from({ length: 7 }, () => new ElementStub()));
  const press = (code, interactive = false) => {
    const event = { code, target: new ElementStub(interactive), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of handlers.get('keydown')) fn(event);
    return event.defaultPrevented;
  };
  const sliderArrowPrevented = press('ArrowRight', true);
  for (const fn of handlers.get('keyup')) fn({ code: 'ArrowRight' });
  input.isDriving = () => false;
  const menuArrowPrevented = press('ArrowLeft');
  for (const fn of handlers.get('keyup')) fn({ code: 'ArrowLeft' });
  input.isDriving = () => true;
  const drivingArrowPrevented = press('ArrowRight');
  assert.equal(input.read().steer, 1);
  for (const fn of handlers.get('keyup')) fn({ code: 'ArrowRight' });
  const buttonSpacePrevented = press('Space', true);
  const summarySpacePrevented = press('Space', 'summary');
  press('KeyW', true);
  return { sliderArrowPrevented, menuArrowPrevented, drivingArrowPrevented, buttonSpacePrevented, summarySpacePrevented, formInputThrottle: input.read().throttle };
}
try {
  results.keyboard = { before: await keyboardCheck(before), after: await keyboardCheck(root) };
  assert.equal(results.keyboard.before.sliderArrowPrevented, true);
  assert.deepEqual(results.keyboard.after, { sliderArrowPrevented: false, menuArrowPrevented: false, drivingArrowPrevented: true, buttonSpacePrevented: false, summarySpacePrevented: false, formInputThrottle: false });
} finally { Object.assign(globalThis, oldGlobals); }
const touch = await import(await moduleURL(root, 'touch-layout.ts'));
assert.equal(touch.touchScaleLabel(1.25, 800, 375), '125%（此畫面適配 100%）');
assert.equal(touch.touchScaleLabel(1.25, 375, 800), '125%（此畫面適配 90%）');
assert.equal(touch.touchScaleLabel(0.85, 375, 800), '85%');
results.touchScale = 'PASS';
await writeFile(resolve(root, 'tools/dev-tests/shots-platform-regression.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
console.log('平台隔離回歸 PASS（不代表完整遊戲／WebGL／手機驗證）');
