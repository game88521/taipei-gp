// 讀取真實 before/after save.ts，以記憶體 storage 驗證救援；不接觸玩家資料或瀏覽器。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pureSource } from './pure-module-loader.mjs';
import { stripTypeScriptTypes } from 'node:module';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = resolve(process.argv[2] ?? process.env.GP_FOLLOWUP_BASELINE_DIR ?? resolve(project, '../taipei-gp-followup-before-2dee076'));
const KEY = 'taipei-gp-v2', SNAPSHOT = KEY + '-last-good', ORIGINAL = KEY + '-recovery-original';
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
  constructor(raw = null) { this.data = new Map(raw === null ? [] : [[KEY, raw]]); this.writes = []; this.removals = []; this.failRead = null; this.failWrite = null; this.failError = null; this.quota = Infinity; }
  getItem(key) { if (this.failRead?.(key)) throw new DOMException('儲存權限被拒絕', 'SecurityError'); return this.data.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrite?.(key)) throw this.failError ?? new DOMException('容量不足', 'QuotaExceededError');
    const total = [...this.data].reduce((sum, [k, v]) => sum + (k === key ? 0 : v.length), String(value).length);
    if (total > this.quota) throw new DOMException('總儲存容量不足', 'QuotaExceededError');
    this.data.set(key, String(value)); this.writes.push(key);
  }
  removeItem(key) { this.data.delete(key); this.removals.push(key); }
}
let serial = 0;
async function load(which, storage, search = '') {
  globalThis.localStorage = storage; globalThis.location = { search };
  // 每次隔離匯入視為一個獨立頁面；此舊測試明示使用 raw-check，避免 Node 共用真 Web Lock。
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const module = await import(url(sources[which] + `\n// isolated-${++serial}`));
  await module.initializeSaveWriter?.();
  return module;
}
const record = (best) => ({ best, sectors: [20, 20, 20], ghost: null, gpBest: best - 1, v: 'track-current' });
const good = () => ({ best: 80, sectors: [20, 30, 30], ghost: null, opts: { sound: true, fps: true, 'opt-frame-cap': '60', 'opt-rules': 'classic' }, playerId: '11111111-1111-4111-8111-111111111111',
  records: { 'taipei:classic:1': record(70), 'japan:2026:1': record(90) }, taxi: { money: 12345, trips: 7 }, ledger: [{ at: 1794330000000, amount: 100, balance: 12345, reason: '計程車載客' }], freePos: { x: 12, z: 34, y: 8, h: 1 } });
const report = { baseline, project, usesRealSaveSource: true, playerStorageTouched: false, browserUsed: false, cases: [] };
async function test(name, fn) {
  try { const detail = await fn(); report.cases.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[隔離模組]').slice(0, 4500) }); }
}

await test('before對照：壞JSON載入後一次自存就覆蓋原始內容', async () => {
  const raw = '{"taxi":{"money":12345},', storage = new MemoryStorage(raw), m = await load('before', storage);
  m.writeSave(); assert.notEqual(storage.getItem(KEY), raw); assert.equal(JSON.parse(storage.getItem(KEY)).taxi, undefined);
  return { originalOverwritten: true };
});
await test('after：壞JSON及空字串均保留原raw，重複自存與產生下載內容皆不解除鎖定', async () => {
  for (const raw of ['{"taxi":{"money":12345},', '']) {
    const storage = new MemoryStorage(raw), m = await load('after', storage);
    assert.equal(m.getSaveRecovery().blocked, true); assert.equal(m.getSaveRecovery().reason, 'invalid');
    assert.equal(storage.getItem(ORIGINAL), raw); assert.deepEqual(m.exportRecoveryOriginal(), { ok: true, text: raw });
    m.save.taxi = { money: 0, trips: 0 }; assert.equal(m.writeSave(), false); assert.equal(m.writeSave(), false);
    assert.equal(storage.getItem(KEY), raw); assert.equal(storage.writes.includes(KEY), false);
  }
});
await test('after：首次沒有KEY可正常保存；不存在的檔案不誤判為壞JSON', async () => {
  const storage = new MemoryStorage(), m = await load('after', storage);
  assert.equal(m.getSaveRecovery().blocked, false); assert.equal(m.writeSave(), true);
  assert.equal(m.parseSaveFile(storage.getItem(KEY)).ok, true); assert.ok(storage.getItem(SNAPSHOT));
});
await test('after：主KEY遺失但仍有有效快照時先救援，不能當新玩家覆蓋快照', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())); await load('after', storage); const snapshot = storage.getItem(SNAPSHOT);
  storage.removeItem(KEY); const m = await load('after', storage); assert.equal(m.getSaveRecovery().blocked, true); assert.equal(m.writeSave(), false);
  assert.equal(storage.getItem(SNAPSHOT), snapshot); assert.deepEqual(m.restoreLastGoodSave(), { ok: true }); assert.equal(JSON.parse(storage.getItem(KEY)).taxi.money, 12345);
});
await test('after：初始KEY明確不存在時，其他頁面新增有效KEY後三種救援入口均不得覆蓋', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())); await load('after', storage); storage.removeItem(KEY);
  const m = await load('after', storage); assert.equal(m.getSaveRecovery().blocked, true);
  const foreign = JSON.stringify({ ...good(), taxi: { money: 88888, trips: 80 } }); storage.data.set(KEY, foreign);
  assert.equal(m.exportRecoveryOriginal().ok, false); // 下載入口也不能把新分頁資料重新認作原始基準。
  for (const result of [m.createNewSave({ originalExported: true }), m.restoreLastGoodSave({ originalExported: true })]) { assert.equal(result.ok, false); assert.match(result.error, /其他頁面變更/); }
  assert.equal(m.writeImported(good(), { originalExported: true }), false); assert.equal(storage.getItem(KEY), foreign); assert.equal(m.writeSave(), false);
});
await test('after：原先讀取失敗，權限恢復後觀察到KEY不存在也須保護後續其他頁面新增的存檔', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())); await load('after', storage); storage.removeItem(KEY); storage.failRead = (key) => key === KEY;
  const m = await load('after', storage); assert.equal(m.getSaveRecovery().reason, 'unreadable'); storage.failRead = null;
  assert.equal(m.exportRecoveryOriginal().ok, false);
  const foreign = JSON.stringify({ ...good(), taxi: { money: 88888, trips: 80 } }); storage.data.set(KEY, foreign);
  const result = m.restoreLastGoodSave(); assert.equal(result.ok, false); assert.match(result.error, /其他頁面變更/);
  assert.equal(m.writeImported(good(), { originalExported: true }), false); assert.equal(storage.getItem(KEY), foreign);
});
await test('after：最近有效快照還原完整分類紀錄/錢包/位置，成功後禁自存且防重點直到reload', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())); let m = await load('after', storage);
  assert.equal(m.save.best, 70); m.save.best = 68; assert.equal(m.writeSave(), true);
  const saved = JSON.parse(storage.getItem(KEY)), broken = '{"broken":'; storage.data.set(KEY, broken);
  m = await load('after', storage, '?circuit=japan&rules=2026');
  assert.equal(m.getSaveRecovery().hasSnapshot, true); assert.ok(m.getSaveRecovery().snapshotAt > 0);
  assert.equal(m.writeSave(), false); assert.deepEqual(m.restoreLastGoodSave(), { ok: true });
  assert.equal(storage.getItem(ORIGINAL), broken); assert.deepEqual(JSON.parse(storage.getItem(KEY)), saved);
  assert.equal(m.restoreLastGoodSave().ok, false); assert.equal(m.createNewSave().ok, false); assert.equal(m.writeSave(), false);
  m = await load('after', storage, '?circuit=japan&rules=2026'); assert.equal(m.save.best, 90);
  assert.equal(m.save.records['taipei:classic:1'].best, 68); assert.equal(m.save.taxi.money, 12345); assert.equal(m.save.freePos.y, 8); assert.equal(m.save.ledger.length, 1);
  assert.equal(m.getSaveRecovery().blocked, false);
});
await test('after：無快照/壞快照不能假還原，明確建立新檔保留原檔並鎖住舊記憶體', async () => {
  for (const snapshot of [null, '{bad', JSON.stringify({ at: 1, raw: '{bad' })]) {
    const storage = new MemoryStorage('invalid-original'); if (snapshot !== null) storage.data.set(SNAPSHOT, snapshot);
    const m = await load('after', storage); assert.equal(m.getSaveRecovery().hasSnapshot, false);
    assert.equal(m.restoreLastGoodSave().ok, false); assert.equal(storage.getItem(KEY), 'invalid-original');
    assert.deepEqual(m.createNewSave(), { ok: true }); assert.equal(storage.getItem(ORIGINAL), 'invalid-original');
    assert.equal(m.parseSaveFile(storage.getItem(KEY)).ok, true); assert.equal(m.writeSave(), false);
  }
});
await test('after：讀取被拒先鎖住；權限恢復後可匯出原raw並明確建立新檔', async () => {
  const storage = new MemoryStorage('unreadable-original'); storage.failRead = () => true;
  const m = await load('after', storage); assert.equal(m.getSaveRecovery().reason, 'unreadable'); assert.equal(m.writeSave(), false);
  assert.equal(m.exportRecoveryOriginal().ok, false); const failure = m.createNewSave(); assert.equal(failure.ok, false); assert.match(failure.error, /無法讀取/);
  assert.deepEqual(storage.writes, []); storage.failRead = null;
  assert.deepEqual(m.exportRecoveryOriginal(), { ok: true, text: 'unreadable-original' });
  assert.deepEqual(m.createNewSave(), { ok: true }); assert.equal(storage.getItem(ORIGINAL), 'unreadable-original');
});
await test('after：副本容量不足不覆寫；明確確認已匯出才能建立新檔', async () => {
  const storage = new MemoryStorage('quota-original'); storage.failWrite = (key) => key === ORIGINAL;
  const m = await load('after', storage); assert.equal(m.getSaveRecovery().originalArchived, false); assert.match(m.getSaveRecovery().archiveError, /容量/);
  assert.equal(m.createNewSave().ok, false); assert.equal(storage.getItem(KEY), 'quota-original');
  assert.deepEqual(m.exportRecoveryOriginal(), { ok: true, text: 'quota-original' }); assert.equal(m.createNewSave().ok, false);
  assert.deepEqual(m.createNewSave({ originalExported: true }), { ok: true }); assert.equal(m.writeSave(), false);
});
await test('after：正式KEY寫入仍失敗不假成功且保留壞raw/有效快照，可解除故障後重試', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())); await load('after', storage);
  storage.data.set(KEY, 'write-failed-original'); const m = await load('after', storage); storage.failWrite = (key) => key === KEY;
  const result = m.restoreLastGoodSave(); assert.equal(result.ok, false); assert.match(result.error, /寫入失敗/);
  assert.equal(storage.getItem(KEY), 'write-failed-original'); assert.equal(m.getSaveRecovery().blocked, true); assert.equal(m.writeSave(), false);
  storage.failWrite = null; assert.deepEqual(m.restoreLastGoodSave(), { ok: true });
});
await test('after：救援期間其他頁面變更KEY，拒絕覆蓋新內容', async () => {
  const storage = new MemoryStorage('original'), m = await load('after', storage); const foreign = JSON.stringify(good()); storage.data.set(KEY, foreign);
  const result = m.createNewSave({ originalExported: true }); assert.equal(result.ok, false); assert.match(result.error, /其他頁面變更/); assert.equal(storage.getItem(KEY), foreign);
});
await test('after：既有匯入保留回復副本，成功後舊自存/重點擊不得覆蓋匯入結果', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), m = await load('after', storage), before = storage.getItem(KEY);
  const imported = { ...good(), taxi: { money: 999, trips: 1 } }; assert.equal(m.writeImported(imported), true);
  assert.equal(storage.getItem(KEY + '-before-restore'), before); const after = storage.getItem(KEY);
  assert.equal(m.writeSave(), false); assert.equal(m.writeImported(good()), false); assert.equal(storage.getItem(KEY), after);
});
await test('after：壞檔時明確匯入備份也須先保留原raw，正常reload取得匯入紀錄', async () => {
  const storage = new MemoryStorage('corrupt-before-import'), m = await load('after', storage);
  assert.equal(m.writeImported(good()), true); assert.equal(storage.getItem(ORIGINAL), 'corrupt-before-import');
  assert.equal(storage.getItem(KEY + '-before-restore'), 'corrupt-before-import'); assert.equal(m.writeSave(), false);
  const reloaded = await load('after', storage); assert.equal(reloaded.save.best, 70); assert.equal(reloaded.save.taxi.money, 12345);
});
await test('after：原raw副本容量不足時，匯入備份須下載並明確確認才能繼續', async () => {
  const storage = new MemoryStorage('quota-before-import'); storage.failWrite = (key) => key === ORIGINAL || key === KEY + '-before-restore';
  const m = await load('after', storage); assert.equal(m.writeImported(good()), false); assert.equal(storage.getItem(KEY), 'quota-before-import');
  assert.deepEqual(m.exportRecoveryOriginal(), { ok: true, text: 'quota-before-import' }); assert.equal(m.writeImported(good()), false);
  assert.equal(m.writeImported(good(), { originalExported: true }), true); assert.equal(storage.getItem(KEY + '-before-restore'), null);
  assert.equal(m.writeSave(), false); const reloaded = await load('after', storage); assert.equal(reloaded.save.best, 70); assert.equal(reloaded.save.taxi.money, 12345);
});
await test('after：幀率選單白名單可roundtrip，既有顯示FPS checkbox維持boolean', async () => {
  const m = await load('after', new MemoryStorage());
  for (const cap of ['30', '60', 'unlimited']) {
    const result = m.parseSaveFile(JSON.stringify({ best: null, opts: { fps: true, 'opt-frame-cap': cap } }));
    assert.equal(result.ok, true); assert.equal(result.save.opts.fps, true); assert.equal(result.save.opts['opt-frame-cap'], cap);
  }
  const result = m.parseSaveFile(JSON.stringify({ best: null, opts: { 'opt-frame-cap': '120' } })); assert.equal(result.ok, true); assert.equal(result.save.opts['opt-frame-cap'], undefined); assert.ok(result.dropped.includes('opts.opt-frame-cap'));
});
const largerGhost = (n) => ({ t: Array.from({ length: n }, (_, i) => i), s: Array.from({ length: n }, (_, i) => i * 10), x: Array.from({ length: n }, (_, i) => i), z: Array(n).fill(0), h: Array(n).fill(0) });
await test('after：總量quota下主檔成長可釋放可重建快照後成功，記憶體快照仍保留', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), m = await load('after', storage), oldTotal = [...storage.data.values()].reduce((s, v) => s + v.length, 0);
  m.save.ghost = largerGhost(300); const expected = JSON.stringify(JSON.parse(m.exportSave()).save);
  storage.quota = Math.max(oldTotal, expected.length); assert.equal(m.writeSave(), true);
  assert.equal(storage.getItem(KEY), expected); assert.deepEqual(storage.removals, [SNAPSHOT]); assert.equal(m.getSaveRecovery().hasSnapshot, true);
  return { quota: storage.quota, oldTotal, grownPrimary: expected.length, removedOnlyRebuildableSnapshot: true };
});
await test('after：移除快照仍不夠時不假成功，原主檔保留且原快照完整恢復', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), m = await load('after', storage), original = storage.getItem(KEY), snapshot = storage.getItem(SNAPSHOT);
  storage.quota = [...storage.data.values()].reduce((s, v) => s + v.length, 0); m.save.ghost = largerGhost(500);
  assert.ok(JSON.stringify(JSON.parse(m.exportSave()).save).length > storage.quota); assert.equal(m.writeSave(), false);
  assert.equal(storage.getItem(KEY), original); assert.equal(storage.getItem(SNAPSHOT), snapshot); assert.deepEqual(storage.removals, [SNAPSHOT]); assert.equal(m.getSaveRecovery().hasSnapshot, true);
});
await test('after：非quota寫入失敗不刪快照、不重試覆寫主檔', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), m = await load('after', storage), original = storage.getItem(KEY), snapshot = storage.getItem(SNAPSHOT);
  storage.failWrite = (key) => key === KEY; storage.failError = new DOMException('權限被拒絕', 'SecurityError');
  assert.equal(m.writeSave(), false); assert.equal(storage.getItem(KEY), original); assert.equal(storage.getItem(SNAPSHOT), snapshot); assert.deepEqual(storage.removals, []);
});
await test('after：匯入成長主檔可釋放last-good，但不移除還原前副本', async () => {
  const storage = new MemoryStorage(JSON.stringify(good())), m = await load('after', storage), original = storage.getItem(KEY), snapshot = storage.getItem(SNAPSHOT);
  const imported = { ...good(), name: 'QuotaTest' }; storage.quota = original.length * 2 + snapshot.length;
  assert.equal(m.writeImported(imported), true); assert.deepEqual(JSON.parse(storage.getItem(KEY)), imported); assert.equal(storage.getItem(KEY + '-before-restore'), original); assert.deepEqual(storage.removals, [SNAPSHOT]);
});
// 用有效Save及合法boolean選項填到指定長度，驗證總額度而非只對特定key製造失敗。
function sizedSave(length) {
  const value = { best: null, sectors: [null, null, null], ghost: null, opts: {} };
  let index = 0;
  while (JSON.stringify(value).length < length) {
    const remaining = length - JSON.stringify(value).length, overhead = index === 0 ? 7 : 8;
    let keyLength = Math.min(40, remaining - overhead);
    const left = remaining - overhead - keyLength;
    if (left > 0 && left < 9) keyLength -= 9 - left;
    assert.ok(keyLength >= String(index).length && keyLength <= 40);
    value.opts[String(index++).padEnd(keyLength, 'x')] = true;
  }
  assert.equal(JSON.stringify(value).length, length);
  return value;
}
const smallSnapshot = () => JSON.stringify({ at: 1794330000000, raw: JSON.stringify({ best: null, opts: {} }) }).padEnd(400, ' ');
await test('after：主檔400加快照400、quota1000時，先釋放快照即可保留還原前副本並匯入500', async () => {
  const original = JSON.stringify(sizedSave(400)), snapshot = smallSnapshot(), archived = 'previous-corrupt-original';
  const storage = new MemoryStorage(original), m = await load('after', storage);
  storage.data.set(SNAPSHOT, snapshot); storage.data.set(ORIGINAL, archived); storage.quota = 1000;
  assert.equal(original.length, 400); assert.equal(snapshot.length, 400);
  const imported = sizedSave(500); assert.equal(m.parseSaveFile(JSON.stringify(imported)).ok, true);
  assert.equal(m.writeImported(imported), true);
  assert.equal(storage.getItem(KEY), JSON.stringify(imported)); assert.equal(storage.getItem(KEY + '-before-restore'), original);
  assert.equal(storage.getItem(ORIGINAL), archived); assert.equal(storage.getItem(SNAPSHOT), null); assert.deepEqual(storage.removals, [SNAPSHOT]);
  return { original: 400, snapshot: 400, quota: 1000, imported: 500, protectedOriginalAndBeforeRestore: true };
});
await test('after：還原前副本移除快照後仍超額時拒絕匯入，完整恢復相同快照且原主檔不動', async () => {
  const original = JSON.stringify(sizedSave(600)), snapshot = smallSnapshot();
  const storage = new MemoryStorage(original), m = await load('after', storage);
  storage.data.set(SNAPSHOT, snapshot); storage.quota = 1000;
  assert.equal(m.writeImported(sizedSave(500)), false);
  assert.equal(storage.getItem(KEY), original); assert.equal(storage.getItem(SNAPSHOT), snapshot);
  assert.equal(storage.getItem(KEY + '-before-restore'), null); assert.deepEqual(storage.removals, [SNAPSHOT]);
});
await test('after：還原前副本成功但匯入主檔真的超額時仍回報false，保留原主檔與兩份受保護副本', async () => {
  const original = JSON.stringify(sizedSave(400)), archived = 'previous-corrupt-original';
  const storage = new MemoryStorage(original), m = await load('after', storage);
  storage.data.set(SNAPSHOT, smallSnapshot()); storage.data.set(ORIGINAL, archived); storage.quota = 1000;
  assert.equal(m.writeImported(sizedSave(1100)), false);
  assert.equal(storage.getItem(KEY), original); assert.equal(storage.getItem(KEY + '-before-restore'), original);
  assert.equal(storage.getItem(ORIGINAL), archived); assert.deepEqual(storage.removals, [SNAPSHOT]); assert.equal(m.getSaveRecovery().hasSnapshot, true);
});

report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
await writeFile(resolve(project, 'tools/dev-tests/shots-followup-save-regression.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); if (report.summary.failed) process.exitCode = 1;
