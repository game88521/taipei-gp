// I/J/K/M/T 真核心模組測試；只隔離車模/警車畫布，不啟動瀏覽器、不讀玩家存檔。
// node --experimental-vm-modules tools/dev-tests/all-street-regression.mjs [before]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? process.env.GP_ALL_BASELINE_DIR ?? resolve(root, '../taipei-gp-all-before-811385b20e05'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const report = { source: root, before, checks: [], hashes: {}, browserUsed: false, playerStorageTouched: false,
  limitations: ['真計分/任務/路由/難度模組，車輛外觀與canvas隔離；未測WebGL、完整遊玩UI或手機實機。',
    'T以受控目標抽樣失敗驗證保護分支，不宣稱真城市合法起點已重現。', '難度與獎牌門檻未做真人駕駛平衡實測。'] };
async function check(name, action) {
  try { await action(); report.checks.push({ name, pass: true }); }
  catch (error) { report.checks.push({ name, pass: false, error: String(error.stack ?? error).slice(0, 3500) }); }
}
async function load(base) {
  const context = vm.createContext({ console, crypto: webcrypto, performance, URLSearchParams, location: { search: '' } });
  const cache = new Map(), teams = Array.from({ length: 11 }, () => ({ livery: { main: '#ff0000' } }));
  async function module(id) {
    if (cache.has(id)) return cache.get(id);
    const values = id === 'three' ? THREE : id.startsWith('three/') ? await import(id)
      : id.endsWith('/f1model.ts') ? { TEAMS: teams, makeF1: () => ({ root: new THREE.Group(), steer: [], spin: [] }) }
      : id.endsWith('/track.ts') ? { TOWER_101: '終點塔' }
      : id.endsWith('/vehicles.ts') ? { buildPlayerVehicle() {}, vehicleById() {} } : null;
    const m = values ? new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context, identifier: id })
      : new vm.SourceTextModule(stripTypeScriptTypes(await readFile(id, 'utf8'), { mode: 'transform' }), { context, identifier: id });
    cache.set(id, m); return m;
  }
  async function exports(file) {
    const m = await module(resolve(base, file).replaceAll('\\', '/'));
    if (m.status === 'unlinked') await m.link((id, ref) => {
      if (!id.startsWith('.')) return module(id);
      let p = resolve(dirname(ref.identifier), id).replaceAll('\\', '/'); if (!extname(p)) p += '.ts'; return module(p);
    });
    if (m.status !== 'evaluated') await m.evaluate(); return m.namespace;
  }
  return { exports };
}
const env = await load(root), old = await load(before);
const drift = await env.exports('src/drift.ts'), oldDrift = await old.exports('src/drift.ts');
const taxi = await env.exports('src/taxi.ts'), oldTaxi = await old.exports('src/taxi.ts');
const street = await env.exports('src/streetrace.ts'), oldStreet = await old.exports('src/streetrace.ts');
const series = await env.exports('src/street-series.ts'), police = await env.exports('src/police.ts');
const { Router } = await env.exports('src/router.ts');
const { FreeCar } = await env.exports('src/freecar.ts');
for (const file of ['drift.ts', 'streetrace.ts', 'street-series.ts', 'taxi.ts', 'street-taxi-state.ts', 'police.ts'])
  report.hashes[file] = createHash('sha256').update(await readFile(resolve(root, 'src', file))).digest('hex');

await check('I舊自由甩尾分數/倍率/撞擊與before完全一致', () => {
  const a = new drift.DriftScore(), b = new oldDrift.DriftScore();
  for (let i = 0; i < 1800; i++) {
    const car = { vx: i % 300 < 220 ? 20 : 0, vz: 0, slip: i % 300 < 220 ? 0.6 : 0 };
    assert.deepEqual(clone(a.update(0.02, car, i === 500 ? 8 : 0)), clone(b.update(0.02, car, i === 500 ? 8 : 0)));
    assert.equal(a.total, b.total); assert.equal(a.mult, b.mult);
  }
});
await check('I60秒只累計正常入帳一次，PB依車款/60或90秒隔離；到時未入帳取消', () => {
  const records = {}, scorer = new drift.DriftScore(), challenge = new drift.DriftChallenge(scorer);
  challenge.start(60, 'sedan', records); let sum = 0, finishes = 0;
  for (let i = 0; i < 3001; i++) {
    const event = challenge.update(0.02, { vx: i % 400 < 260 ? 20 : 0, vz: 0, slip: i % 400 < 260 ? 0.6 : 0 }, 0);
    sum += event.banked ?? 0; if (event.finished) finishes++;
  }
  assert.equal(finishes, 1); assert.equal(challenge.active, false); assert.equal(challenge.remaining, 0);
  assert.equal(challenge.score, sum); assert.ok(sum > 0); assert.equal(scorer.active, false);
  assert.equal(records[drift.driftChallengeKey('sedan', 60)].score, sum);
  assert.equal(records[drift.driftChallengeKey('sedan', 90)], undefined);
  assert.equal(records[drift.driftChallengeKey('taxi', 60)], undefined);
  challenge.start(90, 'sedan', records); challenge.update(120, { vx: 20, vz: 0, slip: 0.6 }, 0);
  assert.equal(challenge.score, 0); assert.equal(challenge.result.duration, 90); assert.equal(scorer.total, 0);
  challenge.start(60, 'taxi', records); challenge.update(1, { vx: 20, vz: 0, slip: 0.6 }, 0); challenge.cancel();
  assert.equal(records[drift.driftChallengeKey('taxi', 60)], undefined); assert.equal(challenge.result, null);
  report.drift = { banked: sum, medal: records[drift.driftChallengeKey('sedan', 60)].medal };
});
await check('I獎牌門檻隨時間比例、parser拒絕非法分數並重算獎牌', () => {
  assert.equal(drift.driftMedal(18000, 60), 'gold'); assert.equal(drift.driftMedal(18000, 90), 'silver');
  assert.deepEqual(clone(drift.parseDriftChallengeRecords({ 'drift-v1:sedan:60': { score: 3000, medal: 'gold' }, broken: { score: 1 }, 'drift-v1:taxi:90': { score: -1 } })),
    { 'drift-v1:sedan:60': { score: 3000, medal: 'bronze' } });
});

function cityGrid() {
  const nodes = [], ways = [];
  for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) nodes.push(x * 800, z * 800);
  for (let k = 0; k < 3; k++) { ways.push({ n: [k * 3, k * 3 + 1, k * 3 + 2], c: 1, w: 12 }); ways.push({ n: [k, k + 3, k + 6], c: 1, w: 12 }); }
  return { net: { nodes, ways, y: Array(9).fill(0) }, places: [] };
}
const city = cityGrid(), landmarks = [{ nm: '臺北市政府', x: 0, z: 0, r: 20 }, { nm: '終點塔', x: 1600, z: 0, r: 20 },
  { nm: '起點廣場', x: 0, z: 1600, r: 20 }, { nm: '中央廣場', x: 800, z: 800, r: 20 }, { nm: '北側廣場', x: 1600, z: 1600, r: 20 }];
const race = new street.StreetRace(new THREE.Scene(), city, landmarks), beforeRace = new oldStreet.StreetRace(new THREE.Scene(), city, landmarks);
const defaultOptions = { difficulty: 'standard', carId: 'sedan', rules: 'traffic' };
await check('J預設對手能力/舊recordKey/起跑位置與before相同；難度僅倍率調整', () => {
  let a, b; const c = race.challenges[0], d = beforeRace.challenges[0]; assert.ok(c);
  race.begin(c, (...args) => { a = args; }, true); beforeRace.begin(d, (...args) => { b = args; }, true);
  assert.deepEqual(clone(a), clone(b)); assert.equal(race.recordKey, beforeRace.recordKey);
  const abilities = (r) => clone(r.rivals.map((q) => [q.name, q.top, q.corner, q.s, q.lat]));
  assert.deepEqual(abilities(race), abilities(beforeRace));
  race.begin(c, () => {}, true, { ...defaultOptions, difficulty: 'easy' });
  assert.equal(race.rivals[0].top, 37 * 0.82);
  race.begin(c, () => {}, true, { ...defaultOptions, difficulty: 'hard' }); assert.equal(race.rivals[0].top, 37 * 1.12);
  assert.equal(race.recordKey, beforeRace.recordKey);
});
await check('J真檢查點完賽→獎牌/分榜；不同車/規則/難度/單挑不得混榜', () => {
  race.begin(race.challenges[0], () => {}, true, defaultOptions); race.update(4, { x: 0, z: 0, h: 0, v: 0 }, null);
  for (const cp of race.active.checkpoints) { const [x, z] = race.active.path[cp]; race.update(0.02, { x, z, y: -0.25, h: 0, v: 0 }, null); }
  race.update(0.7, { x: 1600, z: 0, h: 0, v: 0 }, null);
  const result = race.result; assert.equal(result.finished, true); assert.equal(result.medal, 'gold'); assert.equal(result.place, 1);
  const keys = new Set([result.key, series.streetChallengeKey(result.routeId, false, defaultOptions),
    ...[{ carId: 'taxi' }, { rules: 'quiet' }, { difficulty: 'hard' }].map((q) => series.streetChallengeKey(result.routeId, true, { ...defaultOptions, ...q }))]);
  assert.equal(keys.size, 5);
  const records = {}; assert.equal(series.recordStreetResult(records, result), true); assert.equal(series.recordStreetResult(records, { ...result, time: result.time + 1 }), false);
  assert.equal(records[result.key].best, result.time); race.cancel(); assert.equal(race.result, null);
});
function result(routeId, place = 1, id = `race-${routeId}`, options = defaultOptions) {
  return { ...options, id, routeId, duel: true, key: series.streetChallengeKey(routeId, true, options), time: 60, place, finished: true, medal: series.streetMedal(place, true, true) };
}
await check('J三站續賽/固定車規則難度/同結果去重/積分與獎牌', () => {
  const s = new series.StreetSeries(); assert.equal(s.start(['a', 'b', 'c'], defaultOptions), true);
  assert.equal(s.finish(result('wrong')), false); assert.equal(s.finish(result('a', 1, 'run', { ...defaultOptions, carId: 'taxi' })), false);
  assert.equal(s.finish(result('a')), true); assert.equal(s.points, 10); const cp = clone(s.checkpoint);
  const resumed = new series.StreetSeries(); assert.equal(resumed.restore(cp, ['a', 'b', 'c']), true); assert.equal(resumed.nextRouteId, 'b');
  assert.equal(resumed.finish(result('b', 1, cp.results[0].id)), false); assert.equal(resumed.finish(result('b')), true); assert.equal(resumed.finish(result('c')), true);
  assert.equal(resumed.points, 30); assert.equal(resumed.complete, true); assert.equal(resumed.medal, 'gold'); assert.equal(resumed.finish(result('c')), false);
  cp.next = 2; assert.equal(series.parseStreetSeriesCheckpoint(cp), null); resumed.abandon(); assert.equal(resumed.checkpoint, null);
});

const router = new Router(city), createTaxi = () => new taxi.TaxiJob(new THREE.Scene(), landmarks, router);
function position(stop) { return { x: stop.x, z: stop.z, y: stop.y, h: 0, v: 0 }; }
function pickup(t, relaxed = false) {
  const orders = t.previewOrders(0, 0, -0.25); assert.equal(orders.length, 3); const order = orders[0];
  assert.equal(t.acceptOrder(order.id, 0, 0, -0.25, relaxed), true);
  assert.match(t.update(0.7, position(order.pickup)), /乘客上車/); assert.equal(t.phase, 'ride'); assert.equal(t.target.nm, order.to);
  return order;
}
await check('K真Router訂單提供距離/收益/時限，選定後目的地不再抽換；過期/偽造ID拒絕', () => {
  const t = createTaxi(), orders = t.previewOrders(0, 0, -0.25); assert.equal(orders.length, 3);
  assert.equal(new Set(orders.map((o) => o.id)).size, 3);
  for (const o of orders) { assert.ok(o.distance > 0); assert.ok(o.timeLimit > 0); assert.equal(o.estimatedFare, taxi.fareOf(o.distance)); assert.notEqual(o.from, o.to); }
  const o = orders[1]; assert.equal(t.acceptOrder('forged', 0, 0, -0.25), false);
  // UI收到的是copy，不能改寫內部訂單的目的地。
  const originalTo = o.to; o.destination.nm = 'forged';
  assert.equal(t.acceptOrder(o.id, 0, 0, -0.25), true); assert.equal(t.acceptOrder(orders[0].id, 0, 0, -0.25), false);
  t.update(0.7, position(o.pickup)); assert.equal(t.target.nm, originalTo);
  report.orders = orders.map(({ id, pickup, destination, ...o }) => o);
});
await check('K休閒不限時保存有限數值/不超時/不給小費連單；仍只結算一次', () => {
  const t = createTaxi(), order = pickup(t, true);
  t.update(10000, position(order.pickup)); assert.equal(t.phase, 'ride'); assert.equal(t.timeLeft, 0); assert.equal(t.tripSummary.tipBeforeDeduction, 0);
  assert.ok(t.checkpoint(position(order.pickup))); t.update(0.7, position(order.destination));
  assert.equal(t.trips, 1); assert.equal(t.money, taxi.fareOf(Math.max(t.lastTrip.driven, t.lastTrip.distance))); assert.equal(t.lastTrip.bonus, 0);
  assert.equal(t.consumeSettlement().total, t.money); assert.equal(t.consumeSettlement(), null);
});
await check('M載客checkpoint離線暫停/真路網重算/不匯入金錢，存檔ID阻重複結算', () => {
  const t = createTaxi(), o = pickup(t); t.money = 100;
  t.update(2, { x: o.pickup.x + 30, z: o.pickup.z, y: o.pickup.y, h: 0, v: 5 });
  const cp = clone(t.checkpoint({ x: o.pickup.x + 30, z: o.pickup.z, y: o.pickup.y, h: 0 })); assert.ok(cp);
  cp.money = 99999999; cp.trips = 99999; cp.savedAt = Date.now() - 86400000;
  const resumed = createTaxi(); resumed.money = 100; assert.equal(resumed.resume(cp, cp.position, []).ok, true);
  assert.equal(resumed.timeLeft, cp.timeLeft); assert.equal(resumed.odo, cp.odo); assert.equal(resumed.money, 100); assert.equal(resumed.trips, 0);
  resumed.update(0.7, position(o.destination)); const settled = resumed.consumeSettlement(); assert.ok(settled.total > 0); assert.equal(resumed.trips, 1);
  assert.equal(resumed.money, 100 + settled.total); assert.equal(resumed.settledIds.includes(cp.id), true);
  assert.equal(createTaxi().resume(cp, cp.position, resumed.settledIds).ok, false);
  assert.equal(resumed.resume(cp, { ...cp.position, x: cp.position.x + 101 }, []).ok, false);
  assert.equal(resumed.settledIds.length <= 64, true);
  report.resume = { timeLeft: cp.timeLeft, settlement: clone(settled), originalJobId: cp.id };
});
await check('M非法checkpoint/失效站點/失效路線不續接，手動取消無收入；扶正不增加跳表里程', () => {
  const t = createTaxi(), o = pickup(t), cp = clone(t.checkpoint(position(o.pickup)));
  for (const q of [null, { ...cp, timeLeft: -1 }, { ...cp, hits: -1 }, { ...cp, id: '' }, { ...cp, timeLeft: Infinity }]) assert.equal(taxi.parseTaxiCheckpoint(q), null);
  assert.equal(createTaxi().resume({ ...cp, target: { ...cp.target, nm: 'missing' } }, cp.position).ok, false);
  const blocked = createTaxi(); blocked.router = { route: () => null }; assert.equal(blocked.resume(cp, cp.position).ok, false);
  const before = t.odo; const shifted = { ...position(o.pickup), x: o.pickup.x + 40 }; t.rebasePosition(shifted); t.update(0.02, shifted); assert.equal(t.odo, before);
  const income = t.money; t.abandon(); assert.equal(t.checkpoint(cp.position), null); assert.equal(t.money, income);
  t.setSettledIds(Array.from({ length: 100 }, (_, i) => `settled-${i}`)); assert.equal(t.settledIds.length, 64);
});
await check('K/M舊跳表/車況時限純函式與before一致', () => {
  for (const n of [0, 100, 1250, 1251, 1450, 3000]) assert.equal(taxi.fareOf(n), oldTaxi.fareOf(n));
  for (const c of [0.7, 0.9, 1]) assert.deepEqual(clone(taxi.taxiTimeBudget(1800, 5, c)), clone(oldTaxi.taxiTimeBudget(1800, 5, c)));
});

function policeHarness() {
  const p = Object.create(police.Police.prototype);
  Object.assign(p, { stars: 0, heat: 0, suspect: null, crashCool: 0, units: [], blocks: [], heli: { on: false },
    suspectHp: 100, arrestT: 0, escapeT: 0, lastPursuitReason: null, pursuitT: 180, suspectPaint: ['#000000'],
    suspectPv: { setPaint() {}, model: { root: { visible: true } } } }); return p;
}
await check('T受控初始10次目標失敗取消，不產生undefined目標/獎懲', () => {
  const p = policeHarness(), car = new FreeCar(); car.place(0, 0, 0); let calls = 0;
  p.roadPointNear = () => ++calls === 1 ? [0, 90, 0] : null;
  assert.match(p.startPursuit(car), /找不到/); assert.equal(p.suspect, null); assert.equal(calls, 11); assert.equal(p.lastPursuitReason, 'cancelled');
});
await check('T受控進行中重選目標失敗安全結束，成功抽樣仍保留原行為', () => {
  const p = policeHarness(), car = new FreeCar(); car.place(0, 0, 0);
  p.roadPointNear = (x, z) => [x, z, 0]; assert.match(p.startPursuit(car), /嫌犯出現/); assert.ok(p.suspect.goal);
  p.suspect.goal = undefined; p.roadPointNear = () => null; p.drive = () => { throw new Error('無目標不應開車'); };
  const event = p.update(0.02, car, null, null, false); assert.equal(event.money, 0); assert.match(event.msg, /路線中斷/); assert.equal(p.suspect, null);
});

report.passed = report.checks.filter((x) => x.pass).length; report.failed = report.checks.length - report.passed;
await writeFile(resolve(root, 'tools/dev-tests/all-street-regression.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); if (report.failed) process.exitCode = 1;
