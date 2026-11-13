// 真 save/input/audio/offline-manager/SW 隔離測試；不讀寫玩家瀏覽器、不使用正式站或真實網路。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? process.env.GP_ALL_BASELINE_DIR ?? resolve(root, '../taipei-gp-all-before-811385b20e05'));
if (before === root) throw Error('before 不可指向受測工作副本');
const url = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const hash = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const loaded = new Map();
async function moduleSource(base, name) {
  const key = `${base}/${name}`;
  if (loaded.has(key)) return loaded.get(key);
  let code = stripTypeScriptTypes(await readFile(resolve(base, 'src', name), 'utf8'), { mode: 'transform' });
  const imports = [...code.matchAll(/from (['"])(\.{1,2}\/[^'"]+)\1/g)];
  for (const [, quote, spec] of imports) {
    const dependency = resolve(dirname(resolve(base, 'src', name)), extname(spec) ? spec : `${spec}.ts`);
    code = code.replaceAll(`from ${quote}${spec}${quote}`, `from ${quote}${url(await moduleSource(base, dependency))}${quote}`);
  }
  loaded.set(key, code); return code;
}
const report = { root, before, playerStorageTouched: false, browserUsed: false, networkUsed: false, hashes: {}, cases: [], limitations: ['真實產品模組配合記憶體storage、感測事件、Web Audio替身及Cache替身。', '無法證明手機感測權限、聲音聽感、iOS背景播放或瀏覽器離線實際容量；需另做實機驗證。'] };
for (const file of ['save.ts', 'input.ts', 'audio.ts', 'offline-manager.ts', 'sw-template.js']) report.hashes[file] = hash(await readFile(resolve(root, 'src', file)));
async function test(name, run) {
  try { const detail = await run(); report.cases.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[隔離模組]').slice(0, 4500) }); }
}
class Events {
  callbacks = new Map();
  addEventListener(type, callback) { const list = this.callbacks.get(type) ?? []; list.push(callback); this.callbacks.set(type, list); }
  emit(type, event = {}) { for (const fn of this.callbacks.get(type) ?? []) fn(event); }
}
class Element extends Events {
  style = {}; classList = { add() {}, remove() {} };
  setPointerCapture() {} getBoundingClientRect() { return { left: 0, width: 200 }; } closest() { return null; }
}
class Storage {
  data = new Map(); writes = [];
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { this.data.set(k, String(v)); this.writes.push(k); }
  removeItem(k) { this.data.delete(k); }
}
const KEY = 'taipei-gp-v2', SNAPSHOT = `${KEY}-last-good`, ORIGINAL = `${KEY}-recovery-original`;
const good = () => ({ best: null, sectors: [null, null, null], ghost: null, opts: {}, taxi: { money: 12345, trips: 7 } });
const saveCodes = { before: await moduleSource(before, 'save.ts'), after: await moduleSource(root, 'save.ts') };
let serial = 0;
async function loadSave(storage, which = 'after', initialize = true) {
  globalThis.localStorage = storage; globalThis.location = { search: '' }; globalThis.window = new Events();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const m = await import(url(saveCodes[which] + `\n// reload-${++serial}`));
  if (initialize) await m.initializeSaveWriter(); return m;
}
await test('before對照：taxi欄位損壞會污染完整快照，並被自動保存成缺錢包進度', async () => {
  const storage = new Storage(), raw = JSON.stringify(good()); storage.data.set(KEY, raw); await loadSave(storage, 'before');
  const damaged = JSON.stringify({ ...good(), taxi: { money: '12345', trips: 7 } }); storage.data.set(KEY, damaged);
  const m = await loadSave(storage, 'before'); assert.equal(m.getSaveRecovery().blocked, false);
  assert.equal(JSON.parse(storage.getItem(SNAPSHOT)).raw, damaged); assert.equal(m.writeSave(), true); assert.equal(JSON.parse(storage.getItem(KEY)).taxi, undefined);
});
await test('after：partial阻擋啟動寫入，原文與完整快照不變，還原可取回12345錢包', async () => {
  const storage = new Storage(), raw = JSON.stringify(good()); storage.data.set(KEY, raw); await loadSave(storage);
  const damaged = JSON.stringify({ ...good(), taxi: { money: '12345', trips: 7 } }); storage.data.set(KEY, damaged);
  const writes = storage.writes.length, m = await loadSave(storage, 'after', false);
  assert.equal(storage.writes.length, writes); assert.equal(m.getSaveRecovery().reason, 'partial'); assert.deepEqual(m.getSaveRecovery().dropped, ['taxi']);
  await m.initializeSaveWriter(); assert.equal(storage.getItem(KEY), damaged); assert.equal(storage.getItem(ORIGINAL), damaged);
  assert.equal(JSON.parse(storage.getItem(SNAPSHOT)).raw, raw); assert.equal(m.writeSave(), false);
  assert.equal(m.exportRecoveryOriginal().text, damaged); assert.equal(m.restoreLastGoodSave().ok, true);
  assert.equal(JSON.parse(storage.getItem(KEY)).taxi.money, 12345); assert.equal(m.writeSave(), false);
});
await test('after：合法舊存檔缺新可選欄位與無效非關鍵設定仍可正常保存', async () => {
  for (const opts of [{}, { 'opt-frame-cap': '999' }]) {
    const storage = new Storage(); storage.data.set(KEY, JSON.stringify({ ...good(), opts })); const m = await loadSave(storage);
    assert.equal(m.getSaveRecovery().blocked, false); assert.equal(m.writeSave(), true); assert.equal(JSON.parse(storage.getItem(KEY)).taxi.money, 12345);
  }
});
await test('after：各關鍵欄位局部損壞皆列dropped，不污染主檔／快照', async () => {
  const bad = { taxi: { money: -1, trips: 1 }, ledger: [{ amount: 1 }], stats: { dist: '100' }, owned: ['sedan', 123], paints: { sedan: ['red', 2] },
    street: { invalid: '3' }, best: '80', sectors: [10, '20', 30], ghost: { t: [0, 1] }, records: { 'taipei:classic:1': { best: 'bad' } },
    driftChallenge: { bad: { score: 10, medal: 'gold' } }, streetChallenge: { bad: { best: 10, medal: 'gold' } }, streetSeries: { next: 1 }, taxiJob: { id: 'bad' }, taxiSettled: ['valid', null], progress: { visited: [], pinned: [], title: 'fake' } };
  const details = [];
  for (const [field, value] of Object.entries(bad)) {
    const storage = new Storage(), raw = JSON.stringify(good()); storage.data.set(KEY, raw); await loadSave(storage);
    const damaged = JSON.stringify({ ...good(), [field]: value }); storage.data.set(KEY, damaged); const m = await loadSave(storage);
    assert.equal(m.getSaveRecovery().reason, 'partial', field); assert.ok(m.getSaveRecovery().dropped.some((v) => v === field || v.startsWith(field + '.')), field);
    assert.equal(m.writeSave(), false, field); assert.equal(storage.getItem(KEY), damaged); assert.equal(JSON.parse(storage.getItem(SNAPSHOT)).raw, raw);
    details.push({ field, dropped: m.getSaveRecovery().dropped });
  }
  return details;
});
await test('after：損壞的last-good不列為有效快照', async () => {
  const storage = new Storage(); storage.data.set(KEY, 'broken-json'); storage.data.set(SNAPSHOT, JSON.stringify({ at: Date.now(), raw: JSON.stringify({ ...good(), taxi: { money: 'bad', trips: 7 } }) }));
  const m = await loadSave(storage); assert.equal(m.getSaveRecovery().hasSnapshot, false); assert.equal(m.restoreLastGoodSave().ok, false);
});
const checkpoint = { v: 1, id: 'job-1', phase: 'seek', from: '測試起點', target: { x: 1, z: 2, y: 0, nm: '測試站' }, destination: null, relaxed: false, position: { x: 0, z: 0 }, timeLeft: 100, timeLimit: 100, odo: 0, hits: 0, streak: 0, routeLen: 100, junctions: 1, condition: 1 };
const newFields = { driftChallenge: { 'drift-v1:sedan:60': { score: 9000, medal: 'silver' } }, streetChallenge: { 'street-v1:solo:route:sedan:classic:standard': { best: 80, medal: 'gold' } },
  streetSeries: { v: 1, id: 'series1', routeIds: ['one', 'two', 'three'], next: 0, results: [], difficulty: 'standard', carId: 'sedan', rules: 'classic' }, taxiJob: checkpoint, taxiSettled: ['job-old'], progress: { visited: ['測試:0:0'], pinned: [], title: 'rookie' } };
await test('after：六種新進度完整保存／匯出／解析，舊備份缺欄位保留，明確空內容可覆蓋', async () => {
  const storage = new Storage(); storage.data.set(KEY, JSON.stringify({ ...good(), ...newFields })); const m = await loadSave(storage);
  assert.equal(m.getSaveRecovery().blocked, false); assert.equal(m.writeSave(), true); const parsed = m.parseSaveFile(m.exportSave()); assert.equal(parsed.ok, true); assert.deepEqual(parsed.dropped, []);
  for (const key of Object.keys(newFields)) assert.deepEqual(parsed.save[key], newFields[key], key);
  const legacy = m.parseSaveFile(JSON.stringify(good())); assert.equal(legacy.ok, true);
  const kept = m.prepareImportedSave(legacy.save); for (const key of Object.keys(newFields)) { assert.ok(kept.preserved.includes(key)); assert.deepEqual(kept.save[key], newFields[key]); }
  const clear = { driftChallenge: {}, streetChallenge: {}, streetSeries: null, taxiJob: null, taxiSettled: [], progress: { visited: [], pinned: [], title: 'rookie' } };
  const empty = m.parseSaveFile(JSON.stringify({ ...good(), ...clear })); assert.equal(empty.ok, true); assert.deepEqual(empty.dropped, []);
  const prepared = m.prepareImportedSave(empty.save); for (const key of Object.keys(clear)) { assert.ok(!prepared.preserved.includes(key)); assert.deepEqual(prepared.save[key], clear[key]); }
});
await test('after：新進度損壞包含錯誤獎牌／重複結算ID，直接寫入與匯入API均拒絕', async () => {
  for (const patch of [{ driftChallenge: { 'drift-v1:sedan:60': { score: 9000, medal: 'gold' } } }, { taxiSettled: ['same', 'same'] }]) {
    const storage = new Storage(); storage.data.set(KEY, JSON.stringify(good())); const m = await loadSave(storage), raw = storage.getItem(KEY);
    Object.assign(m.save, patch); assert.equal(m.writeSave(), false); assert.equal(storage.getItem(KEY), raw);
    assert.equal(m.writeImported({ ...good(), ...patch }), false); assert.equal(storage.getItem(KEY), raw);
  }
});
async function inputHarness(base) {
  const events = new Events(), doc = Object.assign(new Events(), { hidden: false }), orientation = Object.assign(new Events(), { angle: 0 }); let now = 0;
  const DOE = class {}, ctx = vm.createContext({ Element, document: doc, screen: { orientation }, DeviceOrientationEvent: DOE, window: { DeviceOrientationEvent: DOE }, performance: { now: () => now }, addEventListener: events.addEventListener.bind(events) });
  vm.runInContext((await moduleSource(base, 'input.ts')).replaceAll('export ', '') + '\nglobalThis.TestInput = Input;', ctx);
  const input = new ctx.TestInput(...Array.from({ length: 7 }, () => new Element())); input.tilt = true; input.tiltZero = 20;
  return { input, events, doc, orientation, ctx, time: (v) => { now = v; }, sample: (gamma, beta = 0) => events.emit('deviceorientation', { gamma, beta }) };
}
await test('before對照：null感測造成滿左，最後樣本超過1.5秒仍保留滿右', async () => {
  const h = await inputHarness(before); h.sample(null, null); assert.equal(h.input.read().steer, -1); h.sample(39); h.time(10000); assert.equal(h.input.read().steer, 1);
});
await test('after：API成功與有效樣本分開；null/NaN/Infinity立即回正，過期1500ms後回正', async () => {
  const h = await inputHarness(root); assert.equal(await h.input.enableTilt(), true); assert.equal(h.input.getTiltState().status, 'waiting'); assert.equal(h.input.calibrateTilt().ok, false);
  h.sample(39); assert.equal(h.input.read().steer, 1); h.time(1500); assert.equal(h.input.read().steer, 1); h.time(1501); assert.equal(h.input.read().steer, 0); assert.equal(h.input.getTiltState().status, 'stale');
  for (const val of [null, NaN, Infinity, -Infinity]) { h.sample(39); h.sample(val); assert.equal(h.input.read().steer, 0); assert.equal(h.input.getTiltState().status, 'invalid'); assert.equal(h.input.calibrateTilt().ok, false); }
});
await test('after：有效資料可校正；橫向與反轉不回歸，blur／轉向／切背景重設資料', async () => {
  const h = await inputHarness(root); h.sample(25.3); assert.equal(h.input.calibrateTilt().ok, true); assert.equal(h.input.tiltZero, 25); assert.equal(h.input.read().steer, 0);
  h.input.tiltZero = 0; h.orientation.angle = 90; h.sample(null, 19); assert.equal(h.input.read().steer, 1); h.input.tiltInvert = true; h.sample(null, 19); assert.equal(h.input.read().steer, -1);
  h.orientation.angle = 270; h.sample(null, 19); assert.equal(h.input.read().steer, 1);
  for (const reset of [() => h.events.emit('blur'), () => h.orientation.emit('change'), () => { h.doc.hidden = true; h.doc.emit('visibilitychange'); }]) {
    h.doc.hidden = false; h.sample(0, 19); reset(); assert.equal(h.input.read().steer, 0); assert.equal(h.input.getTiltState().canCalibrate, false);
  }
});
await test('after：拒絕／拋錯的感測權限有明確狀態且不接受校正', async () => {
  for (const action of [async () => 'denied', async () => { throw Error('denied'); }]) { const h = await inputHarness(root); h.ctx.DeviceOrientationEvent.requestPermission = action; assert.equal(await h.input.enableTilt(), false); assert.equal(h.input.getTiltState().status, 'denied'); assert.equal(h.input.calibrateTilt().ok, false); }
  const h = await inputHarness(root); delete h.ctx.window.DeviceOrientationEvent; assert.equal(await h.input.enableTilt(), false); assert.equal(h.input.getTiltState().status, 'unsupported');
});
const voice = await import(url(await moduleSource(root, 'enginevoice.ts')));
function audioParam() { return { value: 0, cancelScheduledValues() {}, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; } }; }
function audioHarness(code, options = {}) {
  const contexts = [], intervals = new Set();
  class Node {
    gain = audioParam(); frequency = audioParam(); Q = audioParam(); connections = []; starts = []; stops = []; disconnected = false;
    connect(other) { this.connections.push(other); return other; } disconnect() { this.disconnected = true; } start(at) { this.starts.push(at); } stop(at) { this.stops.push(at); }
  }
  class AC {
    state = 'suspended'; sampleRate = 8000; currentTime = 0; destination = new Node(); nodes = []; closed = false; audioWorklet = options.worklet ? { addModule: async () => { if (options.rejectWorklet) throw Error('worklet unavailable'); } } : undefined;
    constructor() { if (options.throwConstructor) throw new DOMException('裝置不可用', 'NotSupportedError'); contexts.push(this); }
    node() { if (options.throwNode) throw Error('節點建立失敗'); const n = new Node(); this.nodes.push(n); return n; }
    createGain() { return this.node(); } createWaveShaper() { return this.node(); } createBiquadFilter() { return this.node(); } createOscillator() { return this.node(); } createConvolver() { return this.node(); } createBufferSource() { return this.node(); } createPanner() { return this.node(); }
    createBuffer(channels, length) { return { getChannelData() { return new Float32Array(length); } }; }
    async resume() { if (options.rejectResume) throw Error('resume denied'); this.state = 'running'; }
    async suspend() { if (options.rejectSuspend) throw Error('suspend denied'); this.state = 'suspended'; }
    async close() { this.state = 'closed'; this.closed = true; }
  }
  const ctx = vm.createContext({ ...voice, window: options.noAPI ? {} : { AudioContext: AC }, navigator: { userAgent: 'test', platform: 'test' }, console, Math, Number, Float32Array, DOMException,
    matchMedia: () => ({ matches: false }), setInterval: (f) => { intervals.add(f); return f; }, clearInterval: (f) => intervals.delete(f), AudioWorkletNode: class { constructor() { throw Error('節點不支援'); } } });
  vm.runInContext(code.replace(/^import .*$/gm, '').replaceAll('export ', '').replaceAll('import.meta.env.BASE_URL', "'/'") + '\nglobalThis.TestSound = Sound;', ctx);
  return { sound: new ctx.TestSound(), contexts, intervals, options, ctx };
}
const audioCodes = { before: await moduleSource(before, 'audio.ts'), after: await moduleSource(root, 'audio.ts') };
await test('before對照：無AudioContext或建構失敗，即使音效關閉也會向主啟動外拋', async () => {
  for (const options of [{ noAPI: true }, { throwConstructor: true }]) { const h = audioHarness(audioCodes.before, options); h.sound.enabled = false; assert.throws(() => h.sound.start()); }
});
await test('after：無API／建構失敗／部分節點失敗不外拋，不留下watchdog，失敗context清理', async () => {
  for (const options of [{ noAPI: true }, { throwConstructor: true }, { throwNode: true }]) {
    const h = audioHarness(audioCodes.after, options); h.sound.enabled = false; assert.equal(h.sound.start(), false); assert.equal(h.sound.started, false); assert.equal(h.intervals.size, 0);
    h.sound.enabled = true; assert.ok(['unavailable', 'error'].includes(h.sound.getStatus().status)); if (h.contexts.length) assert.equal(h.contexts[0].closed, true);
  }
});
await test('after：節點失敗後同一次Sound可重試，watchdog只保留一份；resume/suspend拒絕有處理', async () => {
  const opts = { throwNode: true }, h = audioHarness(audioCodes.after, opts); assert.equal(h.sound.start(), false); opts.throwNode = false; assert.equal(h.sound.retry(), true); await Promise.resolve();
  assert.equal(h.sound.started, true); assert.equal(h.sound.getStatus().status, 'running'); assert.equal(h.intervals.size, 1); h.sound.start(); assert.equal(h.intervals.size, 1);
  const fail = audioHarness(audioCodes.after, { rejectResume: true, rejectSuspend: true }); assert.equal(fail.sound.start(), true); await new Promise((r) => setImmediate(r)); assert.equal(fail.sound.getStatus().status, 'error'); fail.sound.suspend(); await new Promise((r) => setImmediate(r));
});
await test('after：AudioWorklet載入及節點建立失敗均保留振盪器備援且無未處理Promise', async () => {
  for (const rejectWorklet of [true, false]) { const h = audioHarness(audioCodes.after, { worklet: true, rejectWorklet }); assert.equal(h.sound.start(), true); await new Promise((r) => setImmediate(r)); assert.match(h.sound.debug(), /worklet=off/); assert.equal(h.sound.started, true); }
});
await test('after：五類試聽實際連到對應音量bus，關閉音效不播放、不改既有音量', async () => {
  const h = audioHarness(audioCodes.after); assert.equal(h.sound.start(), true); await Promise.resolve(); h.sound.setVolume({ master: 0.6, engine: 0.2, others: 0.3, ambient: 0.4, fx: 0.5 });
  const beforeVol = JSON.stringify(h.sound.vol);
  for (const [kind, bus] of Object.entries({ master: 'master', engine: 'engBus', others: 'otherBus', ambient: 'amb', fx: 'fx' })) {
    const ctx = h.contexts.at(-1), count = ctx.nodes.length; assert.equal(h.sound.preview(kind), true); const [o, g] = ctx.nodes.slice(count); assert.equal(g.connections[0], h.sound[bus]); assert.equal(o.stops[0], 0.6); assert.equal(JSON.stringify(h.sound.vol), beforeVol);
  }
  h.sound.enabled = false; assert.equal(h.sound.preview('engine'), false); assert.equal(h.sound.getStatus().status, 'disabled');
});
await test('after：重複試聽會停止前一短音，closed context重試重建所有持續節點', async () => {
  const h = audioHarness(audioCodes.after); h.sound.start(); await Promise.resolve(); h.sound.preview('fx'); const first = h.sound.previewNodes;
  h.sound.preview('engine'); assert.equal(first.o.disconnected, true); assert.equal(first.g.disconnected, true);
  const old = h.contexts[0]; old.state = 'closed'; h.sound.squealG = { stale: true }; h.sound.limiterAt = 100;
  assert.equal(h.sound.retry(), true); await Promise.resolve(); assert.notEqual(h.contexts.at(-1), old); assert.equal(h.sound.squealG, null); assert.equal(h.sound.limiterAt, 0); assert.equal(h.intervals.size, 1);
});
const offline = await import(url(await moduleSource(root, 'offline-manager.ts')));
class Cache {
  data = new Map(); puts = []; deleted = [];
  key(req) { return new URL(typeof req === 'string' ? req : req.url, 'https://isolated.invalid').pathname; }
  async match(req) { return this.data.get(this.key(req))?.clone(); }
  async put(req, response) { if (this.failPut) throw new DOMException('quota', 'QuotaExceededError'); const key = this.key(req); this.data.set(key, response.clone()); this.puts.push(key); }
  async delete(req) { const key = this.key(req); this.deleted.push(key); return this.data.delete(key); }
}
function offlineFixture(overrides = {}) {
  const cache = new Cache(), bodies = new Map(), files = {}, list = [];
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) { const body = Buffer.from(JSON.stringify({ buildings: [], trees: [x, z], parked: [] })), key = `/data/tiles/${x}_${z}.json`; bodies.set(key, body); files[key] = { bytes: body.length, sha256: hash(body) }; list.push([x, z, body.length]); }
  const regions = offline.offlineRegions({ size: 300, list }, { files }), calls = [];
  const deps = { fetch: async (key, opts) => { calls.push({ key, opts }); return new Response(bodies.get(key)); }, digest: async (bytes) => hash(bytes), isCurrent: () => true, ...overrides };
  return { cache, bodies, regions, deps, calls, manager: new offline.OfflineRegionManager(regions, cache, deps) };
}
await test('Q：真索引切九區，非法／重複／缺hash的manifest拒絕', () => {
  const f = offlineFixture(); assert.equal(f.regions.length, 9); assert.equal(f.regions.flatMap((r) => r.tiles).length, 9);
  for (const index of [{ size: 300, list: [[0, 0, 1]] }, { size: 300, list: [[0, 0, 1], [0, 0, 1]] }, { size: 300, list: [[NaN, 0, 1]] }]) assert.throws(() => offline.offlineRegions(index, { files: {} }));
  assert.throws(() => offline.offlineRegions({ size: 300, list: [[0, 0, 1]] }, null));
});
await test('Q：真城市區塊用實際UTF-8大小與SHA manifest分區，容許舊索引字元數差異', async () => {
  const city = JSON.parse(await readFile(resolve(root, 'public/data/city.json'), 'utf8')), files = {};
  for (const [x, z] of city.tiles.list) { const key = `/data/tiles/${x}_${z}.json`, bytes = await readFile(resolve(root, `public${key}`)); files[key] = { bytes: bytes.length, sha256: hash(bytes) }; }
  const regions = offline.offlineRegions(city.tiles, { files }); assert.equal(regions.flatMap((r) => r.tiles).length, city.tiles.list.length); assert.ok(regions.length > 1);
  assert.equal(regions.flatMap((r) => r.tiles).reduce((n, r) => n + r.bytes, 0), Object.values(files).reduce((n, r) => n + r.bytes, 0));
  return { tiles: city.tiles.list.length, regions: regions.length, bytes: Object.values(files).reduce((n, r) => n + r.bytes, 0) };
});
await test('Q：下載只取所選區，SHA驗證後寫入；重複下載不重取，損壞cache顯示未驗證', async () => {
  const f = offlineFixture(), progress = []; assert.equal((await f.manager.snapshot()).reduce((n, r) => n + r.cached, 0), 0);
  const result = await f.manager.download([f.regions[0].id, f.regions[1].id], (p) => progress.push(p)); assert.deepEqual(result, { downloaded: 2, cancelled: false }); assert.equal(f.calls.length, 2);
  for (const call of f.calls) { assert.equal(call.opts.headers['X-Taipei-GP-Offline-Download'], '1'); assert.ok(call.key.startsWith('/data/tiles/')); }
  assert.equal(progress.at(-1).done, 2); assert.equal((await f.manager.snapshot()).reduce((n, r) => n + r.cached, 0), 2);
  assert.equal((await f.manager.download([f.regions[0].id])).downloaded, 0); assert.equal(f.calls.length, 2);
  await f.cache.put(f.regions[0].tiles[0].url, new Response('corrupt')); assert.equal((await f.manager.snapshot())[0].cached, 0);
});
await test('Q：同長度錯誤SHA／HTTP錯誤／quota均不存入，已完成區塊保留，busy正確釋放', async () => {
  for (const failure of ['hash', 'http', 'quota']) {
    const f = offlineFixture(); await f.manager.download([f.regions[0].id]); const existing = f.regions[0].tiles[0].url;
    if (failure === 'hash') f.deps.fetch = async (key) => new Response(Buffer.alloc(f.bodies.get(key).length, 65));
    if (failure === 'http') f.deps.fetch = async () => new Response('bad', { status: 503 });
    if (failure === 'quota') f.cache.failPut = true;
    await assert.rejects(() => f.manager.download([f.regions[1].id])); assert.equal(f.manager.busy, false); assert.ok(f.cache.data.has(existing)); assert.equal(f.cache.data.size, 1);
  }
});
await test('Q：取消中止等待下載，已完成區塊保留；忙碌時拒絕同時刪除', async () => {
  const f = offlineFixture(); await f.manager.download([f.regions[0].id]); let started;
  const began = new Promise((r) => { started = r; });
  f.deps.fetch = (key, opts) => new Promise((resolve, reject) => { started(); opts.signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError'))); });
  const task = f.manager.download([f.regions[1].id]); await began; assert.equal(f.manager.busy, true); await assert.rejects(() => f.manager.remove([f.regions[0].id])); f.manager.cancel();
  assert.deepEqual(await task, { downloaded: 0, cancelled: true }); assert.equal(f.manager.busy, false); assert.equal(f.cache.data.size, 1);
});
await test('Q：估計容量不足不發下載；controller改版拒絕寫入與刪除', async () => {
  const low = offlineFixture({ estimate: async () => ({ usage: 99, quota: 100 }) }); await assert.rejects(() => low.manager.download([low.regions[0].id]), /空間不足/); assert.equal(low.calls.length, 0);
  let current = true; const f = offlineFixture({ isCurrent: () => current }); f.deps.fetch = async (key) => { current = false; return new Response(f.bodies.get(key)); };
  await assert.rejects(() => f.manager.download([f.regions[0].id]), /版本已更新/); assert.equal(f.cache.puts.length, 0); await assert.rejects(() => f.manager.remove([f.regions[0].id]), /版本已更新/);
});
await test('Q：HTTP body停住也會逾時；忽略AbortSignal的等待可取消，沒有後續寫入', async () => {
  const slow = offlineFixture({ requestTimeoutMs: 5, fetch: async () => ({ ok: true, arrayBuffer: () => new Promise(() => {}) }) });
  await assert.rejects(() => slow.manager.download([slow.regions[0].id]), /逾時/); assert.equal(slow.manager.busy, false); assert.equal(slow.cache.puts.length, 0);
  const f = offlineFixture({ fetch: () => new Promise(() => {}) }); const task = f.manager.download([f.regions[0].id]);
  await new Promise((r) => setImmediate(r)); f.manager.cancel(); assert.equal((await task).cancelled, true); assert.equal(f.cache.puts.length, 0);
});
await test('Q：刪除只動選區tiles，保留核心、READY、上一版與其他區域', async () => {
  const f = offlineFixture(); await f.manager.download(f.regions.map((r) => r.id)); await f.cache.put('/__taipei-gp-offline-ready__', new Response('ready')); await f.cache.put('/', new Response('core'));
  const old = new Cache(); await old.put(f.regions[0].tiles[0].url, new Response('old-version')); assert.equal(await f.manager.remove([f.regions[0].id]), 1);
  assert.equal(f.cache.data.size, 10); assert.ok(f.cache.data.has('/')); assert.ok(f.cache.data.has('/__taipei-gp-offline-ready__')); assert.equal(old.data.size, 1); assert.deepEqual(f.cache.deleted, [f.regions[0].tiles[0].url]);
});
await test('Q：SW回報本controller完整版本；管理下載略過自動快取', async () => {
  const version = '0123456789ab', listeners = new Map(), cache = new Cache(); await cache.put('/__taipei-gp-offline-ready__', new Response(version)); let fetches = 0;
  const source = (await readFile(resolve(root, 'src/sw-template.js'), 'utf8')).replace('__VERSION__', version).replace('__PRECACHE__', '[]');
  vm.runInNewContext(source, { self: { addEventListener: (type, fn) => listeners.set(type, fn) }, caches: { open: async () => cache }, location: { origin: 'https://isolated.invalid' }, Response, Request, URL, AbortController, setTimeout, clearTimeout, fetch: () => { fetches++; throw Error('unexpected network'); } });
  let task, message;
  listeners.get('message')({ data: { type: 'taipei-gp-offline-version' }, ports: [{ postMessage: (msg) => { message = msg; } }], waitUntil: (p) => { task = p; } }); await task;
  assert.equal(message.cache, `taipei-gp-${version}`); assert.equal(message.ready, true);
  let response;
  listeners.get('fetch')({ request: new Request('https://isolated.invalid/data/tiles/0_0.json', { headers: { 'X-Taipei-GP-Offline-Download': '1' } }), respondWith: (p) => { response = p; } });
  assert.equal(response, undefined); assert.equal(fetches, 0);
});
report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
await writeFile(resolve(root, 'tools/dev-tests/all-platform-regression-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); if (report.summary.failed) process.exitCode = 1;
