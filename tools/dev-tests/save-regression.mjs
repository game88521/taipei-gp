// 真實 save.ts 匯出／解析／寫入流程，使用記憶體 storage，絕不接觸玩家資料。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? resolve(root, '../taipei-gp-priority-before-20261111'));
const KEY = 'taipei-gp-v2';
const clone = (value) => JSON.parse(JSON.stringify(value));
const dataURL = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const readSource = (base, name) => readFile(resolve(base, 'src', name), 'utf8');
async function compiled(base, name, dependencies = {}) {
  return stripTypeScriptTypes(await readSource(base, name), { mode: 'transform' }).replace(/from (['"])([^'"]+)\1/g, (all, quote, spec) => dependencies[spec] ? `from ${quote}${dependencies[spec]}${quote}` : all);
}
const networkURL = dataURL(await compiled(root, 'network.ts'));
const circuitsURL = dataURL(await compiled(root, 'circuits.ts', { './network': networkURL }));
const snapshotURL = dataURL(await compiled(root, 'race-state.ts'));
const seasonURL = dataURL(await compiled(root, 'season.ts', { './circuits': circuitsURL, './race-state': snapshotURL }));
const identityURL = dataURL(await compiled(root, 'identity.ts'));
const economyURL = dataURL(await compiled(root, 'economy.ts'));
const saveSource = {
  before: await compiled(before, 'save.ts'),
  after: await compiled(root, 'save.ts', { './season': seasonURL, './identity': identityURL, './economy': economyURL }),
};
let serial = 0;
class MemoryStorage {
  constructor(value) { this.data = new Map(value === undefined ? [] : [[KEY, JSON.stringify(value)]]); this.writes = []; this.fail = null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, text) { if (this.fail?.(key, text)) throw new DOMException('儲存容量不足', 'QuotaExceededError'); this.data.set(key, String(text)); this.writes.push(key); }
  removeItem(key) { this.data.delete(key); }
}
async function load(which, storage, search = '') {
  globalThis.localStorage = storage; globalThis.location = { search };
  return import(dataURL(`${saveSource[which]}\n// isolated-load-${++serial}`));
}
const ghost = (offset = 0) => ({ t: [0, 1, 2], s: [0, 50, 100], x: [offset, offset + 10, offset + 20], z: [0, 1, 2], h: [0, 0.1, 0.2] });
const rec = (best, v, offset = 0) => ({ best, sectors: [best / 3, best / 3, best / 3], ghost: ghost(offset), gpBest: best - 1, v });
const drivers = ['你', ...Array.from({ length: 21 }, (_, i) => `車手${String(i + 1).padStart(2, '0')}`)];
function raceSnapshot() {
  return {
    version: 1, trackLength: 4000, trackN: 1000, raceTime: 140, laps: 6, rules: '2026', difficulty: 'hard', form: { 車手01: 0.5 }, look: 1,
    wet: 0.25, rainAt: 200, sc: { phase: 'off', t: 0, lapAt: 1, used: false, s: 100 }, scChance: 0.2, scAt: 200, pitSeed: 11, recAcc: 0.02, aiHits: 3,
    racers: drivers.map((name, i) => ({
      name, car: { x: i, z: 0, h: 0, v: 40, steer: 0.1, power: 1, boost: 0, drs: false, gripMul: 1, r26: true, aeroZone: true, ovt: false, energy: 0.6, speedCap: null, pos: { i: i * 10, s: i * 40, lat: 0 }, touch: false, hitCool: 0 },
      compound: 1, wear: 0.4, pitReq: false, pit: null, pitTyre: -1, lift: 0, lastStop: 0, pits: 0, drsOk: false, laps: 2, finish: null, lapStart: 110, bestLap: 50, lat: 0, stuck: 0, crashAt: -100, slowT: 0, defT: 0, dnf: false,
    })),
    timing: drivers.map((name, i) => ({ name, progress: 8000 + i * 40, time: 140, splits: [[0, 0], [1, 10], [2, 20]] })),
  };
}
function fixture() {
  return {
    schema: 3, playerId: '11111111-1111-4111-8111-111111111111', best: 60, sectors: [20, 20, 20], ghost: ghost(), gpBest: 59, trackV: 'legacy-taipei',
    opts: { sound: true, assist: false, 'opt-quali': true, 'opt-laps': '6', 'opt-tyre': '2', 'opt-rules': '2026', 'opt-gpwx': 'wet', 'opt-diff': 'hard', 'opt-sc': 'rare' },
    steer: 'drag', touch: 'on', quality: 'medium', time: 'night', car: 'sedan', name: 'Rex', sens: 1.2, curve: 'gentle', tutDone: true,
    tc: { size: 1.25, op: 0.8, pos: 'swap-lift' }, tilt: { inv: true, zero: 5, dead: 3 }, vol: { master: 0.8, engine: 0.7, fx: 0.6, others: 0.4, ambient: 0.3 },
    taxi: { money: 12345, trips: 6 }, stats: { dist: 1234, gpWins: 2, playTime: 456 }, ach: ['trip1'], owned: ['sedan'], paints: { sedan: ['#ff0000'] }, paint: { sedan: '#ff0000' },
    ledger: [{ at: 1794330000000, amount: 10000, balance: 10000, reason: '計程車載客' }, { at: 1794330001000, amount: 2500, balance: 12500, reason: '正賽獎金' }, { at: 1794330002000, amount: -155, balance: 12345, reason: '烤漆' }],
    street: { 'duel:xinyi-loop': 60, 'multi:xinyi-loop': 61, 'xinyi-loop': 62 }, damage: { sedan: 0.25, taxi: 0.1 }, freePos: { x: -4100, z: 85, h: 1.1, y: 8 },
    circuits: { japan: rec(88, 'legacy-japan', 100), china: rec(90, 'legacy-china', 200) },
    records: { 'taipei:classic:1': rec(55, 'taipei-current'), 'taipei:2026:1': rec(54, 'taipei-current'), 'japan:classic:1': rec(84, 'japan-current', 100), 'japan:2026:1': rec(82, 'japan-current', 100) },
    season: { round: 1, results: [{ id: 'australia', order: drivers, grid: [...drivers].reverse(), fl: '你', dnf: ['車手21'], you: { grid: 22, finish: 1, pts: 26 } }], laps: 6, diff: 'hard', rules: '2026', seed: 1234, form: { 車手01: 0.5 }, no: 2, paid: false,
      pending: { id: 'china', grid: drivers, at: 1794330000000, elapsed: 140, checkpoint: { trackV: 'china-current', savedAt: 1794330140000, race: raceSnapshot(), player: { lap: 3, lapTime: 21.8, lastLap: 50, sectorIdx: 1, sectorStart: 18, lapValid: false } } } },
    seasonHistory: [{ no: 1, rank: 2, pts: 200, wins: 3, champion: '陳冠宇', team: '躍馬紅', teamRank: 1, laps: 3 }],
  };
}
const report = { before, after: root, usesRealSaveSource: true, playerStorageTouched: false, browserUsed: false, cases: [] };
async function test(name, action) {
  try { const details = await action(); report.cases.push({ name, status: 'PASS', ...(details ? { details } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[隔離模組]').slice(0, 5000) }); }
}
function parsed(module, value) { const result = module.parseSaveFile(typeof value === 'string' ? value : JSON.stringify(value)); assert.equal(result.ok, true, result.why); return result; }

await test('before：真實匯出→解析→寫入重現資料遺失', async () => {
  const storage = new MemoryStorage(fixture()); const m = await load('before', storage);
  const exported = m.exportSave(), result = parsed(m, exported);
  assert.equal(m.writeImported(result.save), true);
  const written = JSON.parse(storage.getItem(KEY));
  assert.equal(written.season, undefined); assert.equal(written.seasonHistory, undefined); assert.equal(written.freePos, undefined); assert.equal(written.trackV, undefined); assert.equal(written.opts['opt-laps'], undefined);
  assert.equal(written.ledger, undefined);
  return { dropped: result.dropped, seasonLost: true, historyLost: true, freePosLost: true, trackVLost: true, selectSettingsLost: true, newLedgerFieldUnsupported: true };
});

await test('after：完整真實 export→parse→write→reload roundtrip', async () => {
  const original = fixture(), storage = new MemoryStorage(original), originalText = storage.getItem(KEY);
  const m = await load('after', storage, '?circuit=japan&rules=2026');
  assert.equal(m.save.best, 82);
  m.save.best = 81.5; m.save.gpBest = 80.5;
  const exported = JSON.parse(m.exportSave());
  assert.equal(exported.version, 3); assert.equal(exported.save.schema, 3);
  assert.equal(exported.save.best, 60); assert.equal(exported.save.trackV, 'legacy-taipei');
  assert.equal(exported.save.records['japan:2026:1'].best, 81.5);
  const result = parsed(m, JSON.stringify(exported));
  assert.deepEqual(result.dropped, []);
  for (const key of ['opts', 'season', 'seasonHistory', 'freePos', 'trackV', 'playerId', 'damage', 'ledger', 'street', 'tc', 'tilt', 'vol']) assert.deepEqual(result.save[key], exported.save[key], key);
  assert.equal(m.writeImported(result.save), true);
  assert.equal(storage.getItem(KEY + '-before-restore'), originalText);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), exported.save);
  const restored = await load('after', storage, '?circuit=japan&rules=2026');
  assert.equal(restored.save.best, 81.5); assert.equal(restored.save.gpBest, 80.5);
  assert.deepEqual(JSON.parse(restored.exportSave()).save, exported.save);
  return { seasonAndCheckpoint: true, history: true, freePos: true, selectors: true, trackFingerprint: true, rollbackCopy: true, reloadedActiveTrack: 'japan/2026' };
});

await test('after：舊備份 prepareImportedSave 保留現有進度，新資料明確取代', async () => {
  const storage = new MemoryStorage(fixture()), m = await load('after', storage);
  const current = JSON.parse(m.exportSave()).save;
  const old = parsed(m, { best: 70, sectors: [20, 20, 30], ghost: null, opts: { sound: false }, taxi: { money: 500, trips: 1 } });
  const prepared = m.prepareImportedSave(old.save, old.dropped);
  for (const key of ['season', 'seasonHistory', 'freePos', 'records', 'damage', 'ledger', 'playerId']) { assert.deepEqual(prepared.save[key], current[key]); assert.ok(prepared.preserved.includes(key)); }
  assert.equal(prepared.save.taxi.money, 500);
  const explicit = parsed(m, { best: null, opts: {}, seasonHistory: [] });
  assert.deepEqual(m.prepareImportedSave(explicit.save, explicit.dropped).save.seasonHistory, []);
  const invalid = parsed(m, { best: null, opts: {}, season: { round: -1, results: [] } });
  assert.ok(invalid.dropped.includes('season'));
  assert.deepEqual(m.prepareImportedSave(invalid.save, invalid.dropped).save.season, current.season);
  return { preserved: prepared.preserved, invalidSeasonPreserved: true, explicitEmptyHistoryRespected: true };
});

await test('after：明細完整還原，非法欄位保留目前，明確空陣列可清空', async () => {
  const original = fixture(), storage = new MemoryStorage(original), m = await load('after', storage);
  const valid = parsed(m, m.exportSave());
  assert.deepEqual(valid.save.ledger, original.ledger);
  assert.deepEqual(m.prepareImportedSave(valid.save, valid.dropped).save.ledger, original.ledger);
  for (const ledger of [{}, null, [{ ...original.ledger[0], amount: '10000' }], [{ ...original.ledger[0], reason: '<script>' }], Array.from({ length: 101 }, () => original.ledger[0])]) {
    const value = parsed(m, { best: null, opts: {}, ledger });
    assert.equal(value.save.ledger, undefined);
    if (ledger !== null) assert.ok(value.dropped.includes('ledger'));
    assert.deepEqual(m.prepareImportedSave(value.save, value.dropped).save.ledger, original.ledger);
  }
  const empty = parsed(m, { best: null, opts: {}, ledger: [] });
  assert.deepEqual(m.prepareImportedSave(empty.save, empty.dropped).save.ledger, []);
  const fromStorage = await load('after', new MemoryStorage({ best: null, opts: {}, ledger: [{ at: -1, amount: 100, balance: 100, reason: '不合法' }] }));
  assert.equal(fromStorage.save.ledger, undefined);
  return { roundtrip: true, oldAndInvalidBackupPreservesCurrentLedger: true, explicitEmptyLedgerRespected: true, storageUsesSameValidation: true };
});

await test('after：備份容量滿時不覆蓋，正式寫入失敗亦保留原存檔', async () => {
  const storage = new MemoryStorage(fixture()), m = await load('after', storage);
  const original = storage.getItem(KEY); storage.data.set(KEY + '-before-restore', 'previous-rollback');
  storage.fail = (key) => key === KEY + '-before-restore';
  assert.equal(m.writeImported({ best: 80, sectors: [null, null, null], ghost: null, opts: {} }), false);
  assert.equal(storage.getItem(KEY), original); assert.equal(storage.getItem(KEY + '-before-restore'), 'previous-rollback');
  assert.equal(storage.writes.includes(KEY), false);
  storage.fail = (key) => key === KEY;
  assert.equal(m.writeImported({ best: 80, sectors: [null, null, null], ghost: null, opts: {} }), false);
  assert.equal(storage.getItem(KEY), original); assert.equal(storage.getItem(KEY + '-before-restore'), original);
  let warnings = 0; m.setOnSaveFail(() => warnings++); m.writeSave(); m.writeSave(); assert.equal(warnings, 1);
  return { backupFailureWritesCurrent: false, currentWriteFailureKeepsOriginal: true, quotaWarningCount: warnings };
});

await test('after：兩規則／兩賽道 reload 與指紋清除互不污染', async () => {
  const storage = new MemoryStorage(fixture());
  let m = await load('after', storage, '?rules=classic');
  assert.equal(m.save.best, 55); m.save.best = 53; m.writeSave();
  m.selectRecordRules('2026'); assert.equal(m.save.best, 54); m.save.best = 52; m.writeSave();
  m.selectRecordRules('classic'); assert.equal(m.save.best, 53);
  m = await load('after', storage, '?circuit=japan&rules=classic');
  assert.equal(m.save.best, 84); m.save.best = 83; m.writeSave();
  m = await load('after', storage, '?circuit=japan&rules=2026');
  assert.equal(m.save.best, 82); m.save.best = 80; m.writeSave();
  const beforeClear = JSON.parse(storage.getItem(KEY));
  assert.deepEqual(Object.fromEntries(Object.entries(beforeClear.records).map(([k, v]) => [k, v.best])), { 'taipei:classic:1': 53, 'taipei:2026:1': 52, 'japan:classic:1': 83, 'japan:2026:1': 80 });
  assert.equal(m.checkTrackStamp('japan-current'), false);
  assert.equal(m.checkTrackStamp('japan-changed'), true); assert.equal(m.save.best, null); assert.equal(m.save.ghost, null); m.writeSave();
  const afterClear = JSON.parse(storage.getItem(KEY));
  assert.equal(afterClear.records['japan:2026:1'].best, null); assert.equal(afterClear.records['japan:classic:1'].best, 83); assert.equal(afterClear.records['taipei:2026:1'].best, 52);
  assert.equal(afterClear.best, 60); assert.equal(afterClear.circuits.japan.best, 88);
  m = await load('after', storage, '?rules=classic'); assert.equal(m.save.best, 53);
  return { classifiedBest: Object.fromEntries(Object.entries(beforeClear.records).map(([k, v]) => [k, v.best])), changedFingerprintClearsOnlySelectedCategory: true, unknownLegacyIntact: true };
});

await test('after：舊 unknown 紀錄保留且不猜測規則分類', async () => {
  const old = fixture(); delete old.records; delete old.schema;
  const storage = new MemoryStorage(old); let m = await load('after', storage, '?rules=classic');
  assert.equal(m.save.best, null); assert.equal(m.legacyBestLapOf(''), 60); assert.equal(m.legacyBestLapOf('japan'), 88);
  m.writeSave(); m = await load('after', storage, '?rules=2026'); assert.equal(m.save.best, null);
  const out = JSON.parse(m.exportSave()).save;
  assert.equal(out.best, 60); assert.equal(out.circuits.japan.best, 88); assert.equal(out.trackV, 'legacy-taipei');
  return { legacyTaipei: 60, legacyJapan: 88, classic: null, rules2026: null };
});

await test('after：惡意／不合法輸入有限救援與來源 storage 共用 schema', async () => {
  const m = await load('after', new MemoryStorage());
  for (const text of ['{', 'null', '[]', '{"other":"app"}', ' '.repeat(8_000_001)]) assert.equal(m.parseSaveFile(text).ok, false);
  const bad = { best: 'not-a-number', opts: { 'opt-laps': '999', 'opt-rules': 'future', 'opt-diff': 'impossible', sound: 'yes' }, ghost: { ...ghost(), t: [0, 1, 1] }, freePos: { x: 100001, z: 0, h: 0 }, seasonHistory: [{ no: -1 }], records: { 'taipei:classic:999': rec(45, 'bad') }, damage: { sedan: 5 } };
  const result = parsed(m, bad);
  assert.equal(result.save.best, null); assert.equal(result.save.ghost, null); assert.equal(result.save.freePos, undefined); assert.equal(result.save.seasonHistory, undefined);
  assert.deepEqual(result.save.records, {}); assert.deepEqual(result.save.damage, {});
  for (const key of ['opts.opt-laps', 'opts.opt-rules', 'opts.opt-diff', 'freePos', 'seasonHistory']) assert.ok(result.dropped.includes(key), key);
  const loaded = await load('after', new MemoryStorage(bad));
  assert.equal(loaded.save.best, null); assert.deepEqual(loaded.save.opts, {}); assert.equal(loaded.save.freePos, undefined); assert.equal(loaded.save.seasonHistory, undefined);
  assert.equal(JSON.parse(loaded.exportSave()).save.schema, 3);
  return { exportSchema: 3, loadSanitizesSameFieldsAsImport: true, dropped: result.dropped };
});

await test('after：檢查點欄位白名單及不合法快照拒收', async () => {
  const m = await load('after', new MemoryStorage());
  const valid = fixture(); valid.season.pending.checkpoint.race.racers[0].car.extra = 'discard';
  const clean = parsed(m, valid);
  assert.ok(clean.save.season.pending.checkpoint); assert.equal(clean.save.season.pending.checkpoint.race.racers[0].car.extra, undefined);
  assert.equal(clean.save.season.pending.checkpoint.player.lapValid, false);
  const legacyCheckpoint = fixture(); delete legacyCheckpoint.season.pending.checkpoint.player.lapValid;
  assert.equal(parsed(m, legacyCheckpoint).save.season.pending.checkpoint.player.lapValid, true);
  const invalidCheckpoints = [
    (s) => { s.pending.checkpoint.race.racers[0].car.v = 900; },
    (s) => { s.pending.checkpoint.race.racers[1].name = '你'; },
    (s) => { s.pending.checkpoint.race.rules = 'classic'; },
    (s) => { s.pending.checkpoint.player.sectorStart = 100; },
    (s) => { s.pending.checkpoint.player.lapValid = 'invalid'; },
    (s) => { s.pending.checkpoint.race.racers.pop(); },
  ];
  for (const mutate of invalidCheckpoints) { const value = fixture(); mutate(value.season); const rejected = parsed(m, value); assert.ok(rejected.save.season); assert.equal(rejected.save.season.pending.checkpoint, undefined); assert.deepEqual(rejected.save.season.results, value.season.results); }
  const invalidSeasons = [
    (s) => { s.results[0].order[1] = '你'; },
    (s) => { s.pending.id = 'japan'; },
  ];
  for (const mutate of invalidSeasons) { const value = fixture(); mutate(value.season); const rejected = parsed(m, value); assert.equal(rejected.save.season, undefined); assert.ok(rejected.dropped.includes('season')); }
  return { validFullSnapshotAccepted: true, extraCarFieldRemoved: true, rejectedMalformedCheckpoints: invalidCheckpoints.length, completedRoundsPreservedWhenOnlyCheckpointIsBad: true, rejectedMalformedSeasons: invalidSeasons.length };
});

const failed = report.cases.filter((c) => c.status === 'FAIL');
report.summary = { passed: report.cases.length - failed.length, failed: failed.length };
await writeFile(resolve(root, 'tools/dev-tests/shots-save-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
