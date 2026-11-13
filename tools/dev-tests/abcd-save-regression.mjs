// 真實 save.ts 的隔離測試；共享記憶體儲存與可控 Web Locks，絕不讀寫玩家瀏覽器存檔。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pureSource } from './pure-module-loader.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = resolve(process.env.GP_ABCD_BASELINE_DIR ?? resolve(project, '../taipei-gp-abcd-before-3bdf97336c02'));
const KEY = 'taipei-gp-v2', SNAPSHOT = KEY + '-last-good', ORIGINAL = KEY + '-recovery-original', BEFORE_RESTORE = KEY + '-before-restore';
const url = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
async function source(base, name, deps = {}) {
  const code = stripTypeScriptTypes(await readFile(resolve(base, 'src', name), 'utf8'), { mode: 'transform' });
  return code.replace(/from (['"])([^'"]+)\1/g, (all, q, spec) => deps[spec] ? `from ${q}${deps[spec]}${q}` : all);
}
async function saveSource(base) {
  return pureSource(base, 'save.ts');
}
const sources = { before: await saveSource(baseline), after: await saveSource(project) };
class MemoryStorage {
  constructor(raw = null) { this.data = new Map(raw === null ? [] : [[KEY, raw]]); this.writes = []; this.failRead = null; this.failWrite = null; this.afterWrite = null; }
  getItem(key) { if (this.failRead?.(key)) throw new DOMException('儲存權限被拒絕', 'SecurityError'); return this.data.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrite?.(key)) throw new DOMException('容量不足', 'QuotaExceededError');
    this.data.set(key, String(value)); this.writes.push(key); this.afterWrite?.(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
}
class Page {
  listeners = new Map();
  addEventListener(type, listener, options) { const list = this.listeners.get(type) ?? []; list.push({ listener, once: options?.once }); this.listeners.set(type, list); }
  invoke(type, entry, event) {
    if (entry.once) this.listeners.set(type, this.listeners.get(type).filter((item) => item !== entry));
    entry.listener(event);
  }
  dispatch(type, event = {}) { for (const entry of [...this.listeners.get(type) ?? []]) this.invoke(type, entry, event); }
  // 原生頁面事件在不同 listener 回呼之間可有 microtask checkpoint；不能只用同步 dispatch 的模型推論離頁順序。
  async dispatchNative(type, event = {}) {
    const errors = [];
    for (const entry of [...this.listeners.get(type) ?? []]) {
      try { this.invoke(type, entry, event); } catch (error) { errors.push(error); }
      await Promise.resolve();
    }
    return errors;
  }
}
class Locks {
  held = new Map(); requests = [];
  request(name, options, callback) {
    this.requests.push({ name, options }); assert.equal(options.ifAvailable, true);
    const lock = this.held.has(name) ? null : { name };
    if (lock) this.held.set(name, lock);
    return Promise.resolve(callback(lock)).finally(() => { if (lock && this.held.get(name) === lock) this.held.delete(name); });
  }
}
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let serial = 0;
async function load(which, storage, { locks, initialize = true } = {}) {
  globalThis.localStorage = storage; globalThis.location = { search: '' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: locks ? { locks } : {} });
  const page = new Page(); globalThis.window = page;
  const m = await import(url(sources[which] + `\n// isolated-${++serial}`));
  if (initialize) await m.initializeSaveWriter?.();
  return { m, page };
}
const good = (money = 1000, trips = 0) => ({ best: null, sectors: [null, null, null], ghost: null, opts: {}, taxi: { money, trips } });
const stored = (storage) => JSON.parse(storage.getItem(KEY));
const report = { baseline, project, usesRealSaveSource: true, browserUsed: false, playerStorageTouched: false, fallbackLimit: '無 Web Locks 時可擋已發生的舊頁覆寫；原文比對並非跨程序原子鎖，不能宣稱消除完全同時寫入。', cases: [] };
async function test(name, fn) {
  try { const detail = await fn(); report.cases.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[隔離模組]').slice(0, 4500) }); }
}

await test('before對照：正常A舊頁可覆寫B收入與最新有效快照', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m: a } = await load('before', storage), { m: b } = await load('before', storage);
  b.save.taxi = { money: 1600, trips: 1 }; assert.equal(b.writeSave(), true); assert.equal(stored(storage).taxi.money, 1600);
  assert.equal(a.writeSave(), true); assert.deepEqual(stored(storage).taxi, { money: 1000, trips: 0 });
  assert.deepEqual(JSON.parse(JSON.parse(storage.getItem(SNAPSHOT)).raw).taxi, { money: 1000, trips: 0 });
});
await test('before對照：正常舊頁可覆寫其他頁剛匯入的9000進度', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m: a } = await load('before', storage), { m: b } = await load('before', storage);
  assert.equal(b.writeImported(good(9000, 9)), true); assert.equal(stored(storage).taxi.money, 9000);
  assert.equal(a.writeSave(), true); assert.equal(stored(storage).taxi.money, 1000);
});
await test('after：模組import完全不寫主檔、快照或救援原文；初始化前同步寫入均拒絕', async () => {
  for (const raw of [JSON.stringify(good()), 'broken-original']) {
    const storage = new MemoryStorage(raw), { m } = await load('after', storage, { initialize: false });
    assert.deepEqual(storage.writes, []); assert.equal(m.getSaveWriterState().phase, 'initializing');
    assert.equal(m.writeSave(), false); assert.equal(m.writeImported(good(9000)), false); assert.equal(m.createNewSave().ok, false);
    assert.deepEqual(storage.writes, []); await m.initializeSaveWriter();
    assert.equal(m.getSaveWriterState().phase, 'ready'); assert.ok(storage.writes.includes(raw === 'broken-original' ? ORIGINAL : SNAPSHOT));
  }
});
await test('after：fallback兩正常分頁阻擋A覆寫B收入，主檔／快照完整不動且可匯出A記憶體', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m: a } = await load('after', storage), { m: b } = await load('after', storage);
  b.save.taxi = { money: 1600, trips: 1 }; assert.equal(b.writeSave(), true);
  const primary = storage.getItem(KEY), snapshot = storage.getItem(SNAPSHOT), writes = [...storage.writes];
  a.save.taxi.money = 1200; assert.equal(a.writeSave(), false); assert.equal(a.getSaveWriterState().reason, 'changed');
  assert.equal(storage.getItem(KEY), primary); assert.equal(storage.getItem(SNAPSHOT), snapshot); assert.deepEqual(storage.writes, writes);
  assert.equal(JSON.parse(a.exportSave()).save.taxi.money, 1200); assert.equal(a.getSaveWriterState().protection, 'raw-check');
  assert.equal((await a.initializeSaveWriter()).phase, 'blocked'); assert.equal(a.getSaveWriterState().phase, 'blocked'); assert.equal(a.writeSave(), false);
});
await test('after：storage事件即時通知封鎖，unsubscribe生效，無關快照事件不誤封鎖', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m, page } = await load('after', storage), events = [];
  const stop = m.subscribeSaveWriter((s) => events.push(s)); page.dispatch('storage', { key: SNAPSHOT }); assert.equal(events.length, 0);
  storage.data.set(KEY, JSON.stringify(good(2000))); page.dispatch('storage', { key: KEY });
  assert.equal(events.length, 1); assert.equal(events[0].phase, 'blocked'); assert.equal(events[0].reason, 'changed');
  stop(); page.dispatch('storage', { key: KEY }); assert.equal(events.length, 1); assert.equal(m.writeSave(), false);
});
await test('after：storage.clear同樣封鎖舊頁，不依賴事件newValue防止舊事件誤封鎖', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m, page } = await load('after', storage);
  page.dispatch('storage', { key: KEY, newValue: 'outdated-event' }); assert.equal(m.getSaveWriterState().phase, 'ready');
  storage.data.clear(); page.dispatch('storage', { key: null }); assert.equal(m.getSaveWriterState().reason, 'changed'); assert.equal(m.writeSave(), false);
});
await test('after：首次兩頁皆無KEY，B建立進度後A不能當新玩家覆蓋', async () => {
  const storage = new MemoryStorage(), { m: a } = await load('after', storage), { m: b } = await load('after', storage);
  b.save.taxi = { money: 1600, trips: 1 }; assert.equal(b.writeSave(), true); const snapshot = storage.getItem(SNAPSHOT);
  assert.equal(a.writeSave(), false); assert.equal(a.writeImported(good()), false); assert.equal(stored(storage).taxi.money, 1600); assert.equal(storage.getItem(SNAPSHOT), snapshot);
});
await test('after：匯入9000後舊頁不得覆寫主檔、快照與還原前備份', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m: a } = await load('after', storage), { m: b } = await load('after', storage);
  assert.equal(b.writeImported(good(9000, 9)), true); const image = [...storage.data];
  assert.equal(a.writeSave(), false); assert.equal(a.writeImported(good(1200)), false); assert.deepEqual([...storage.data], image);
  assert.equal(stored(storage).taxi.money, 9000); assert.equal(JSON.parse(JSON.parse(storage.getItem(SNAPSHOT)).raw).taxi.money, 9000);
  assert.equal(JSON.parse(storage.getItem(BEFORE_RESTORE)).taxi.money, 1000); assert.equal(b.writeSave(), false);
});
await test('after：匯入前副本成功後外頁變更主檔，第二道檢查阻止主檔與快照覆寫', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m } = await load('after', storage), snapshot = storage.getItem(SNAPSHOT), foreign = JSON.stringify(good(7777));
  storage.afterWrite = (key) => { if (key === BEFORE_RESTORE) storage.data.set(KEY, foreign); };
  assert.equal(m.writeImported(good(9000)), false); assert.equal(storage.getItem(KEY), foreign); assert.equal(storage.getItem(SNAPSHOT), snapshot);
  assert.equal(m.getSaveWriterState().reason, 'changed');
});
await test('after：import與initialize之間外頁改檔，不得將舊raw寫回快照', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m } = await load('after', storage, { initialize: false }), foreign = JSON.stringify(good(8888));
  storage.data.set(KEY, foreign); storage.data.set(SNAPSHOT, 'foreign-snapshot'); await m.initializeSaveWriter();
  assert.equal(m.getSaveWriterState().reason, 'changed'); assert.deepEqual(storage.writes, []); assert.equal(storage.getItem(SNAPSHOT), 'foreign-snapshot');
});
await test('after：舊救援頁的新增／快照還原／匯入均不得覆蓋其他頁已修復的進度', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m: seeded } = await load('after', storage); assert.equal(seeded.writeSave(), true);
  storage.data.set(KEY, 'broken-original'); const { m } = await load('after', storage);
  storage.data.set(KEY, JSON.stringify(good(8888))); const image = [...storage.data];
  assert.equal(m.createNewSave({ originalExported: true }).ok, false); assert.equal(m.restoreLastGoodSave({ originalExported: true }).ok, false);
  assert.equal(m.writeImported(good(), { originalExported: true }), false); assert.deepEqual([...storage.data], image);
  assert.equal(m.getSaveWriterState().reason, 'changed');
});
await test('after：主檔寫入失敗不刷新expected，解除故障可重試；其後外頁變更仍能偵測', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m } = await load('after', storage), original = storage.getItem(KEY);
  m.save.taxi.money = 1500; storage.failWrite = (key) => key === KEY; assert.equal(m.writeSave(), false); assert.equal(storage.getItem(KEY), original);
  storage.failWrite = null; assert.equal(m.writeSave(), true); assert.equal(stored(storage).taxi.money, 1500);
  m.save.taxi.money = 1700; assert.equal(m.writeSave(), true); assert.equal(stored(storage).taxi.money, 1700);
  storage.data.set(KEY, JSON.stringify(good(2000))); assert.equal(m.writeSave(), false); assert.equal(stored(storage).taxi.money, 2000);
});
await test('after：普通寫前讀取失敗不採空基準，權限恢復後同一基準可正常存檔', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m } = await load('after', storage);
  let failures = 0; m.setOnSaveFail(() => { failures++; });
  storage.failRead = (key) => key === KEY; m.save.taxi.money = 1500; assert.equal(m.writeSave(), false); assert.equal(m.writeSave(), false); assert.equal(failures, 1); assert.equal(m.getSaveWriterState().phase, 'ready');
  storage.failRead = null; assert.equal(m.writeSave(), true); assert.equal(stored(storage).taxi.money, 1500);
});
await test('after：初始unreadable保留救援重試；首次恢復讀取到null也能保護後續外頁新檔', async () => {
  const storage = new MemoryStorage('unreadable-original'); storage.failRead = (key) => key === KEY;
  const { m } = await load('after', storage); assert.equal(m.getSaveRecovery().reason, 'unreadable'); assert.equal(m.createNewSave().ok, false);
  storage.failRead = null; assert.deepEqual(m.exportRecoveryOriginal(), { ok: true, text: 'unreadable-original' }); assert.equal(m.createNewSave().ok, true);
  const emptyStorage = new MemoryStorage(); emptyStorage.failRead = (key) => key === KEY; const { m: n } = await load('after', emptyStorage);
  emptyStorage.failRead = null; assert.equal(n.exportRecoveryOriginal().ok, false); emptyStorage.data.set(KEY, JSON.stringify(good(9999)));
  assert.equal(n.createNewSave({ originalExported: true }).ok, false); assert.equal(stored(emptyStorage).taxi.money, 9999);
});
await test('after：Web Locks只有一頁可寫，第二頁立即blocked而不等待；blocked仍可匯出', async () => {
  const locks = new Locks(), storage = new MemoryStorage(JSON.stringify(good())), { m: a } = await load('after', storage, { locks });
  const writes = [...storage.writes], { m: b } = await load('after', storage, { locks });
  assert.equal(a.getSaveWriterState().protection, 'web-lock'); assert.equal(a.getSaveWriterState().phase, 'ready');
  assert.equal(b.getSaveWriterState().reason, 'other-tab'); assert.equal(b.writeSave(), false); assert.equal(b.writeImported(good(9000)), false);
  assert.deepEqual(storage.writes, writes); assert.equal(JSON.parse(b.exportSave()).save.taxi.money, 1000); assert.equal(locks.requests.length, 2);
  a.save.taxi.money = 1600; assert.equal(a.writeSave(), true); assert.equal(stored(storage).taxi.money, 1600);
});
await test('事件模型對照：listener間microtask會在第二個listener保存前先封鎖', async () => {
  const page = new Page(), order = []; let phase = 'ready';
  page.addEventListener('pagehide', () => { order.push('first-listener'); queueMicrotask(() => { phase = 'blocked'; order.push('release-microtask'); }); });
  page.addEventListener('pagehide', () => { order.push(`second-listener:${phase}`); });
  assert.deepEqual(await page.dispatchNative('pagehide'), []); assert.deepEqual(order, ['first-listener', 'release-microtask', 'second-listener:blocked']);
});
await test('after：單一pagehide先同步flush再釋放，不受listener間microtask影響；舊BFCache頁不可續寫', async () => {
  const locks = new Locks(), storage = new MemoryStorage(JSON.stringify(good())), { m: a, page } = await load('after', storage, { locks });
  const order = [];
  a.subscribeSaveWriter((state) => { if (state.phase === 'blocked') order.push('blocked'); });
  a.setBeforeSaveWriterRelease(() => { order.push('flush-ready:' + a.getSaveWriterState().phase); a.save.taxi.money = 1800; assert.equal(a.writeSave(), true); order.push('saved'); });
  page.addEventListener('pagehide', () => { order.push('later-listener:' + a.getSaveWriterState().phase); });
  assert.deepEqual(await page.dispatchNative('pagehide'), []); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(order, ['flush-ready:ready', 'saved', 'blocked', 'later-listener:blocked']);
  assert.equal(a.getSaveWriterState().reason, 'released'); const { m: b } = await load('after', storage, { locks }); assert.equal(b.getSaveWriterState().phase, 'ready');
  assert.equal(b.save.taxi.money, 1800); b.save.taxi.money = 2000; assert.equal(b.writeSave(), true);
  assert.equal((await a.initializeSaveWriter()).phase, 'blocked'); assert.equal(a.writeSave(), false); assert.equal(stored(storage).taxi.money, 2000);
});
await test('after：raw-check離頁亦先flush再sticky封鎖，回BFCache不得因原文相同而續寫', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), { m, page } = await load('after', storage); let flushes = 0;
  m.setBeforeSaveWriterRelease(() => { flushes++; m.save.taxi.money = 1700; assert.equal(m.writeSave(), true); });
  assert.deepEqual(await page.dispatchNative('pagehide'), []); assert.equal(flushes, 1); assert.equal(stored(storage).taxi.money, 1700);
  assert.equal(m.getSaveWriterState().protection, 'raw-check'); assert.equal(m.getSaveWriterState().reason, 'released');
  assert.equal((await m.initializeSaveWriter()).phase, 'blocked'); const writes = [...storage.writes];
  m.save.taxi.money = 1800; assert.equal(m.writeSave(), false); assert.equal(m.writeImported(good(9000)), false); await page.dispatchNative('pagehide');
  assert.equal(flushes, 1); assert.deepEqual(storage.writes, writes); assert.equal(JSON.parse(m.exportSave()).save.taxi.money, 1800);
});
await test('after：flush拋錯仍finally釋放／封鎖，下一頁可接手且舊頁不可re-init', async () => {
  for (const locks of [undefined, new Locks()]) {
    const storage = new MemoryStorage(JSON.stringify(good())), { m: a, page } = await load('after', storage, { locks });
    a.setBeforeSaveWriterRelease(() => { throw new Error('flush失敗'); }); const errors = await page.dispatchNative('pagehide');
    assert.equal(errors.length, 1); assert.match(errors[0].message, /flush失敗/); assert.equal(a.getSaveWriterState().reason, 'released');
    await Promise.resolve(); await Promise.resolve(); const { m: b } = await load('after', storage, { locks }); assert.equal(b.getSaveWriterState().phase, 'ready');
    b.save.taxi.money = 2200; assert.equal(b.writeSave(), true); assert.equal((await a.initializeSaveWriter()).phase, 'blocked'); assert.equal(a.writeSave(), false); assert.equal(stored(storage).taxi.money, 2200);
  }
});
await test('after：main尚未註冊flush的早期離頁也立即釋放並防止舊記憶體保存', async () => {
  for (const locks of [undefined, new Locks()]) {
    const storage = new MemoryStorage(JSON.stringify(good())), { m, page } = await load('after', storage, { locks });
    assert.deepEqual(await page.dispatchNative('pagehide'), []); assert.equal(m.getSaveWriterState().reason, 'released'); assert.equal(m.writeSave(), false);
    await Promise.resolve(); await Promise.resolve(); const { m: next } = await load('after', storage, { locks }); assert.equal(next.getSaveWriterState().phase, 'ready');
  }
});
await test('after：已衝突頁離頁不執行flush、不洗掉changed原因，但仍釋放持有的鎖', async () => {
  const locks = new Locks(), storage = new MemoryStorage(JSON.stringify(good())), { m, page } = await load('after', storage, { locks }); let flushes = 0;
  m.setBeforeSaveWriterRelease(() => { flushes++; }); storage.data.set(KEY, JSON.stringify(good(8888))); page.dispatch('storage', { key: KEY });
  assert.equal(m.getSaveWriterState().reason, 'changed'); assert.deepEqual(await page.dispatchNative('pagehide'), []); assert.equal(flushes, 0); assert.equal(m.getSaveWriterState().reason, 'changed');
  await Promise.resolve(); await Promise.resolve(); const { m: next } = await load('after', storage, { locks }); assert.equal(next.getSaveWriterState().phase, 'ready'); assert.equal(next.save.taxi.money, 8888);
});
await test('after：Web Locks錯誤不靜默降級，初始化回傳blocked且零儲存寫入', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), locks = { request: async () => { throw new Error('鎖定服務不可用'); } };
  const { m } = await load('after', storage, { locks }); assert.equal(m.getSaveWriterState().reason, 'lock-error'); assert.equal(m.writeSave(), false); assert.deepEqual(storage.writes, []);
  assert.match(m.getSaveWriterState().message, /鎖定服務不可用/);
});
await test('after：Web Locks同步拋錯亦有明確blocked，不會卡在initializing', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), locks = { request: () => { throw new Error('同步鎖定錯誤'); } };
  const { m } = await load('after', storage, { locks }); assert.equal(m.getSaveWriterState().reason, 'lock-error'); assert.equal(m.writeSave(), false); assert.deepEqual(storage.writes, []);
});
await test('after：第二個救援頁未取得鎖不封存raw、不寫快照與主檔', async () => {
  const locks = new Locks(), storage = new MemoryStorage('broken-original'); await load('after', storage, { locks }); const writes = [...storage.writes];
  const { m } = await load('after', storage, { locks }); assert.equal(m.getSaveWriterState().reason, 'other-tab'); assert.equal(m.createNewSave().ok, false);
  assert.equal(m.writeImported(good(), { originalExported: true }), false); assert.deepEqual(storage.writes, writes); assert.equal(storage.getItem(KEY), 'broken-original');
});

if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
delete globalThis.window;
report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
await writeFile(resolve(project, 'tools/dev-tests/shots-abcd-save-regression.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); if (report.summary.failed) process.exitCode = 1;
