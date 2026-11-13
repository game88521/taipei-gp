import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { moduleUrl } from './pure-module-loader.mjs';

const base = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workerUrl = pathToFileURL(resolve(base, 'src/tileworker.ts')).href;
const loaded = new Map();
async function sourceUrl(name) {
  const file = resolve(base, 'src', name);
  if (loaded.has(file)) return loaded.get(file);
  const task = (async () => {
    let code = stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'transform' });
    // data: 模組沒有相對 URL 基底；只還原 Worker 位置，受測邏輯不替換。
    code = code.replace("new URL('./tileworker.ts', import.meta.url)", `new URL(${JSON.stringify(workerUrl)})`);
    const specs = [...new Set([...code.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)].map(match => match[2]))];
    const mappings = new Map();
    for (const spec of specs) mappings.set(spec, spec.startsWith('.')
      ? await sourceUrl(resolve(dirname(file), extname(spec) ? spec : `${spec}.ts`))
      : import.meta.resolve(spec));
    return moduleUrl(code.replace(/\bfrom\s+(['"])([^'"]+)\1/g, (_all, quote, spec) => `from ${quote}${mappings.get(spec)}${quote}`));
  })();
  loaded.set(file, task);
  return task;
}
const { TilePool } = await import(await sourceUrl('tilepool.ts'));
const originalWorker = globalThis.Worker, originalFetch = globalThis.fetch;
const init = { roads: [], trackX: [], trackZ: [], terrain: null, q: { rooftops: false, treeKeep: 0 }, tower: { x: 0, z: 0 }, shadow: { x: 0, z: 0 } };
const results = [];
async function check(name, run) { await run(); results.push({ name, pass: true }); }

try {
  let workers = [], fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('不應下載取消的工作'); };
  globalThis.Worker = class {
    constructor() { this.messages = []; this.terminated = false; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  };
  await check('取消待處理 Worker，沒有主執行緒備援與晚到結果', async () => {
    const pool = new TilePool(init, 2);
    const pending = [pool.run('/one', 1), pool.run('/two', 2), pool.run('/three', 3)];
    const outcomes = Promise.allSettled(pending);
    pool.dispose(); pool.dispose();
    const settled = await outcomes;
    assert.ok(settled.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
    assert.ok(workers.every(worker => worker.terminated && worker.onmessage === null && worker.onerror === null));
    await assert.rejects(pool.run('/late', 4), { name: 'AbortError' });
    assert.equal(fetches, 0);
  });
  await check('未取消的 Worker 仍回傳原計算結果', async () => {
    workers = [];
    const pool = new TilePool(init, 1), task = pool.run('/normal', 1);
    const request = workers[0].messages.find(message => message.type === 'tile');
    const expected = { geos: [], token: '原結果' };
    workers[0].onmessage({ data: { id: request.id, out: expected } });
    assert.equal(await task, expected);
    pool.dispose();
  });
  await check('主執行緒備援下載也能取消，不重試或開始幾何計算', async () => {
    globalThis.Worker = class { constructor() { throw new Error('此環境沒有 Worker'); } };
    let requested, signalSeen;
    const begun = new Promise(resolve => { requested = resolve; });
    fetches = 0;
    globalThis.fetch = (_url, options) => {
      fetches++; signalSeen = options.signal; requested();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError')), { once: true }));
    };
    const pool = new TilePool(init, 1), pending = pool.run('/local', 1);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await begun;
    pool.dispose();
    await rejected;
    assert.equal(signalSeen.aborted, true);
    assert.equal(fetches, 1);
  });
  await check('共用 GPU 資源只釋放一次，含貼圖與 InstancedMesh', async () => {
    const THREE = await import('three');
    const { disposeMultiplayerObjects } = await import(await sourceUrl('multiplayer-scene-resources.ts'));
    const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const instanced = new THREE.InstancedMesh(geometry, material, 2);
    root.add(new THREE.Mesh(geometry, material), instanced);
    const counts = { geometry: 0, material: 0, texture: 0, instance: 0 };
    geometry.addEventListener('dispose', () => counts.geometry++);
    material.addEventListener('dispose', () => counts.material++);
    texture.addEventListener('dispose', () => counts.texture++);
    instanced.addEventListener('dispose', () => counts.instance++);
    disposeMultiplayerObjects(root);
    assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1, instance: 1 });
  });
} finally {
  globalThis.Worker = originalWorker; globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({ pass: true, checks: results.length, results }, null, 2));
