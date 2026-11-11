// 隔離方法測試：直接載入修改前／後 TypeScript；不啟動城市、WebGL 或玩家存檔。
// node --experimental-vm-modules tools/dev-tests/mission-regression.mjs [原專案路徑]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? resolve(root, '../taipei-gp-priority-before-20261111'));
const reports = [];
async function loadModules(dir) {
  const cache = new Map();
  const stubs = { three: THREE, './models': { pedParts: {} }, './f1model': { makeF1() {}, TEAMS: [] },
    './track': { TOWER_101: '101' }, './vehicles': { buildPlayerVehicle() {}, vehicleById() {} } };
  async function get(id) {
    if (cache.has(id)) return cache.get(id);
    if (id in stubs) {
      const values = stubs[id], m = new SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); });
      cache.set(id, m); await m.link(() => {}); await m.evaluate(); return m;
    }
    const filename = resolve(dir, 'src', `${id.replace(/^\.\//, '')}.ts`);
    const source = stripTypeScriptTypes(readFileSync(filename, 'utf8'), { mode: 'transform', sourceUrl: filename });
    const m = new SourceTextModule(source, { identifier: filename });
    cache.set(id, m); await m.link((s) => get(s)); await m.evaluate(); return m;
  }
  const modules = {};
  await get('./citydata'); await get('./surface'); await get('./freecar');
  if (dir === root) modules.mission = (await get('./mission')).namespace;
  for (const id of ['taxi', 'streetrace', 'police', 'drift', 'damage', 'freecar', 'router']) modules[id] = (await get(`./${id}`)).namespace;
  return modules;
}
function car(M, y = -0.25) {
  const c = new M.freecar.FreeCar(); c.x = c.z = c.h = 0; c.y = y; return c;
}
function taxi(M) {
  const t = Object.create(M.taxi.TaxiJob.prototype);
  Object.assign(t, { phase: 'seek', target: { x: 0, z: 0, y: -0.25, nm: 'A' }, wait: 0, remainingT: 0, route: null, routeYs: null, remaining: 0 });
  t.board = function () { this.phase = 'ride'; this.timeLimit = 100; this.target = { x: 200, z: 0, y: -0.25, nm: 'B' }; };
  return t;
}
function street(M) {
  const sr = Object.create(M.streetrace.StreetRace.prototype);
  Object.assign(sr, { phase: 'race', time: 0, next: 0, playerDone: null, playerProg: 0, lastProj: 0, rivals: [],
    active: { def: { id: 'test' }, path: [[0, 0], [100, 0]], checkpoints: [0, 1], cum: [0, 100], length: 100 } });
  sr.driveRival = () => {};
  return sr;
}
function police(M) {
  const p = Object.create(M.police.Police.prototype);
  Object.assign(p, { heat: 5, stars: 5, units: [], blocks: [], lostT: 0, bustT: 0, spawnT: 999, blockT: 999,
    crashCool: 0, heli: { on: true, x: 0, z: 0, vx: 0, vz: 0, h: 0 }, suspect: null, suspectHp: 0, arrestT: 0, escapeT: 0 });
  p.drive = () => 0;
  return p;
}
function runOldNew(M) {
  const t = taxi(M), bridge = car(M, 8);
  t.update(0.7, bridge);
  const sr = street(M); sr.update(0.02, bridge, null);
  const cop = police(M), stopped = car(M);
  for (let i = 0; i < 4; i++) cop.update(1, stopped, null, null, true);
  const barrierCop = police(M); barrierCop.stars = 4; barrierCop.heli.on = false;
  barrierCop.blocks = [{ cops: [], bars: [{ x: 0, z: 0, y: -0.25, hit: false, m: new THREE.Mesh() }], x: 0, z: 0, age: 0 }];
  bridge.vz = 10;
  barrierCop.update(0.02, bridge, null, null, true);
  const pursuit = police(M); pursuit.stars = 0; pursuit.heli.on = false; pursuit.pursuitT = 180; pursuit.suspectHp = 0;
  pursuit.suspect = { car: car(M), pv: { model: { root: { visible: true } } } };
  pursuit.suspect.car.update = () => 0;
  bridge.vz = 0;
  const arrest = pursuit.update(1.1, bridge, null, null, true);
  const crashRace = street(M), player = car(M, 8); player.vx = 10;
  crashRace.rivals = [{ done: null, pos: { x: 1.4, z: 0, y: -0.25, h: 0 }, v: 0, ox: 0, oz: 0, ovx: 0, ovz: 0, ow: 0, stunned: 0 }];
  const crossLevelHit = crashRace.collide(player);
  return { bridgeTaxiPickedUp: t.phase === 'ride', bridgeCheckpointPassed: sr.next > 0,
    helicopterAloneArrested: cop.stars === 0, bridgeHitGroundBarrier: barrierCop.blocks[0].bars[0].hit,
    bridgeArrestedGroundSuspect: arrest.money > 0, bridgeHitGroundStreetRival: crossLevelHit > 0 };
}

const before = await loadModules(baseline), after = await loadModules(root);
const old = runOldNew(before), fixed = runOldNew(after);
for (const key of Object.keys(old)) { assert.equal(old[key], true, `修改前未重現：${key}`); assert.equal(fixed[key], false, `修改後仍失敗：${key}`); reports.push({ case: key, before: old[key], after: fixed[key], pass: true }); }

// 同層操作不可被分層修正破壞。
const t = taxi(after); t.update(0.7, car(after)); assert.equal(t.phase, 'ride');
const sr = street(after); sr.update(0.02, car(after), null); assert.equal(sr.next, 1);
const cp = police(after); cp.stars = 1; cp.heli.on = false;
const u = { car: car(after), pv: { model: { root: { visible: true } } } }; u.car.x = 2; cp.units = [u];
for (let i = 0; i < 4; i++) cp.update(1, car(after), null, null, true);
assert.equal(cp.stars, 0); reports.push({ case: 'same-level pickup/checkpoint/ground arrest', pass: true });

// 在高架正下方的警車必須繼續路網尋路，不可切為平面直接追。
const routeCop = police(after); routeCop.stars = 1; routeCop.heli.on = false; routeCop.units = [{ car: car(after), pv: { model: { root: {} } } }];
let direct; routeCop.drive = (...args) => { direct = args[6]; return 0; };
routeCop.update(0.02, car(after, 8), null, null, true); assert.equal(direct, false); assert.equal(routeCop.bustT, 0);
reports.push({ case: 'cross-level police retains route and cannot arrest', pass: true });

const { routeRemaining, streetRecordKey } = after.mission;
assert.equal(routeRemaining([[0, 0], [100, 0], [100, 100]], 50, 0), 150);
const layeredRoute = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0], [100, 0]];
assert.equal(routeRemaining(layeredRoute, 50, 0, [0, 0, 0, 0, 10, 10], 9.75), 50);
assert.equal(routeRemaining(layeredRoute, 50, 0, [0, 0, 0, 0, 10, 10], -0.25), 450);
assert.notEqual(streetRecordKey('test', false), streetRecordKey('test', true));
const budget = after.taxi.taxiTimeBudget(1100, 3, 1), damaged = after.taxi.taxiTimeBudget(1100, 3, 0.7);
assert.equal(budget.waitSeconds, 12); assert.ok(damaged.total > budget.total);
reports.push({ case: 'road distance and junction/vehicle-condition trip budget', pass: true, budget, damaged });

// 實際 Router 在三岔節點計一次路口，並維持路線與節點高度。
const road = { net: { nodes: [0, 0, 100, 0, 200, 0, 100, 100], y: [0, 0, 0, 0], ways: [{ n: [0, 1, 2], c: 1, w: 10 }, { n: [1, 3], c: 1, w: 10 }] } };
const route = new after.router.Router(road).route(0, 0, 200, 0);
assert.equal(route.junctions, 1); assert.ok(route.length > 0); assert.equal(route.path.length, route.ys.length);
reports.push({ case: 'Router counts source-topology junction', pass: true, junctions: route.junctions });

const d = new after.drift.DriftScore(), drifting = { vx: 20, vz: 10, slip: 0.5 };
d.update(1, drifting, 0); assert.ok(d.bankIn > 0); assert.ok(d.multProgress > 0);
const bank = d.finish('bank'); assert.ok(bank.banked > 0); assert.equal(d.active, false); assert.deepEqual(d.finish('bank'), {});
d.update(1, drifting, 0); d.reset(); assert.equal(d.total, 0); assert.equal(d.bankIn, 0);
reports.push({ case: 'drift reset cancels and finish banks exactly once', pass: true });

const damage = Object.create(after.damage.Damage.prototype);
Object.assign(damage, { vehicle: 'sedan', value: 0.8, values: {}, lastPaint: 0 });
damage.useVehicle('__street__'); assert.equal(damage.value, 0); damage.value = 1;
damage.useVehicle('sedan'); assert.equal(damage.value, 0.8);
damage.useVehicle('taxi'); assert.equal(damage.value, 0); const saved = damage.snapshot(); assert.equal(saved.sedan, 0.8); assert.ok(!('__street__' in saved));
damage.restore(saved); damage.useVehicle('sedan'); assert.equal(damage.value, 0.8);
reports.push({ case: 'vehicle damage isolated and street damage excluded from persistence', pass: true });

const resultRace = street(after); resultRace.phase = 'done'; resultRace.time = 10; resultRace.playerDone = 9.4;
resultRace.rivals = [{ name: 'rival', done: null, s: 80, v: 10, color: '#fff' }];
const estimated = resultRace.standings().find((r) => !r.isPlayer); assert.equal(estimated.status, 'estimated'); assert.equal(estimated.estimatedTime, 12); assert.equal(estimated.done, null);
resultRace.playerDone = Infinity; assert.equal(resultRace.standings().find((r) => r.isPlayer).status, 'dnf');
reports.push({ case: 'unfinished rivals explicitly estimated, actual player DNF retained', pass: true });

const result = { baseline, source: root, passed: reports.length, cases: reports, limitations: '隔離方法測試；模型與繪圖建構未啟動，不代表完整道路、瀏覽器或手機驗證。' };
writeFileSync(resolve(root, 'tools/dev-tests/shots-mission-regression.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
