import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as THREE from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? resolve(root, '../taipei-gp-tenpack-before-c220d98a7f5c'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const report = { source: root, before, browserUsed: false, playerStorageTouched: false, checks: [], hashes: {},
  limitations: ['真Police/FreeCar/TaxiJob/Router模組，隔離車輛外觀與canvas；未驗證WebGL、整合UI或手機。',
    '勤務平衡及觀光路線採合成真路網；不是全城市真人駕駛或實際難度平衡。'] };
async function check(name, action) {
  console.log(`START ${name}`);
  try { await action(); report.checks.push({ name, status: 'PASS' }); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: String(error.stack ?? error) }); }
}
async function load(base) {
  let seed = 11, calls = 0;
  const math = Object.create(Math); math.random = () => { calls++; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const context = vm.createContext({ console, Math: math, crypto: webcrypto, performance, URLSearchParams, location: { search: '' },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }) }) } });
  const cache = new Map();
  async function module(id) {
    if (cache.has(id)) return cache.get(id);
    const values = id === 'three' ? THREE : id.startsWith('three/') ? await import(id)
      : id.endsWith('/vehicles.ts') ? { vehicleById: (id) => ({ id }), buildPlayerVehicle() {
        return { model: { root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] }, setPaint() {} };
      } } : null;
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
  return { exports, randomCalls: () => calls };
}
const env = await load(root), old = await load(before);
const state = await env.exports('src/city-jobs-state.ts'), checkpoint = await env.exports('src/street-taxi-state.ts');
const { Police } = await env.exports('src/police.ts'), { Police: OldPolice } = await old.exports('src/police.ts');
const { TaxiJob, fareOf } = await env.exports('src/taxi.ts'), { TaxiJob: OldTaxi } = await old.exports('src/taxi.ts');
const { FreeCar } = await env.exports('src/freecar.ts'), { FreeCar: OldCar } = await old.exports('src/freecar.ts');
const { Router } = await env.exports('src/router.ts'), { Router: OldRouter } = await old.exports('src/router.ts');
const { RoadNet } = await env.exports('src/citydata.ts'), { RoadNet: OldNet } = await old.exports('src/citydata.ts');
for (const f of ['police.ts', 'taxi.ts', 'street-taxi-state.ts', 'city-jobs-state.ts', 'city-jobs-ui.ts'])
  report.hashes[f] = createHash('sha256').update(await readFile(resolve(root, 'src', f))).digest('hex');
const nodes = [], ways = [];
for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) nodes.push(x * 400, z * 400);
for (let n = 0; n < 9; n++) {
  ways.push({ n: Array.from({ length: 9 }, (_, k) => n * 9 + k), c: 1, w: 12 });
  ways.push({ n: Array.from({ length: 9 }, (_, k) => n + k * 9), c: 1, w: 12 });
}
const city = { net: { nodes, ways, y: Array(81).fill(0) } };
const landmarks = [
  ['起點廣場', 1600, 1600], ['星光公園', 1200, 1600], ['晨曦廣場', 1200, 1200], ['雲海會館', 1600, 1200],
  ['青石展館', 2000, 1200], ['晴空藝廊', 2000, 1600], ['月灣中心', 2000, 2000], ['山影公園', 1600, 2000],
].map(([nm, x, z]) => ({ nm, x, z, r: 20 }));
const router = new Router(city), oldRouter = new OldRouter(city), net = new RoadNet(city), oldNet = new OldNet(city);
const pos = (s, more = {}) => ({ x: s.x, z: s.z, y: s.y ?? -0.25, h: 0, v: 0, ...more });
const createTaxi = () => new TaxiJob(new THREE.Scene(), landmarks, router);
function createPolice(difficulty = 'standard') {
  const police = new Police(new THREE.Scene(), router, net), car = new FreeCar(); car.place(1600, 1600, 0);
  police.setDutyDifficulty(difficulty); return { police, car };
}
function startPolice(fixture) { assert.match(fixture.police.startPursuit(fixture.car), /嫌犯出現/); return fixture; }
function finishPolice(fixture, impact = 0) {
  const { police, car } = fixture; startPolice(fixture);
  police.suspect.car.place(car.x + 8, car.z, 0); police.suspectHp = 0;
  // 明確固定已被攔停的嫌犯，隔離逮捕/評分流程；車輛動態另由120步before對照覆蓋。
  police.suspect.car.update = () => 0;
  let money = 0;
  for (let k = 0; k < 5; k++) money += police.update(0.25, car, null, null, false, k === 4 ? impact : 0).money;
  assert.equal(!!police.suspect, false); return money;
}
function tourStart(count = 3) {
  const taxi = createTaxi(), order = taxi.previewTours(1600, 1600, -0.25, count)[0]; assert.ok(order);
  assert.equal(taxi.acceptTour(order.id, 1600, 1600, -0.25), true);
  assert.match(taxi.update(0.7, pos(order.pickup)), /乘客上車/); return { taxi, order };
}

await check('9職涯parser接受合法舊缺省、拒絕型別/原型鍵/不可能連勝及超界', () => {
  const good = state.newPoliceCareer(); assert.equal(good.difficulty, 'standard');
  assert.deepEqual(clone(state.parsePoliceCareer(good)), clone(good));
  for (const bad of [undefined, null, [], { ...good, difficulty: 'constructor' }, { ...good, difficulty: { toString: null } },
    { ...good, completed: -1 }, { ...good, consecutive: 1 }, { ...good, completed: 1e8 }, { ...good, failed: 0.1 }])
    assert.equal(state.parsePoliceCareer(bad), null);
});
await check('9標準與c220真追緝起點/目標/性能/120步物理/訊息及亂數次序一致', () => {
  const a = createPolice(), b = { police: new OldPolice(new THREE.Scene(), oldRouter, oldNet), car: new OldCar() }; b.car.place(1600, 1600, 0);
  const callsA = env.randomCalls(), callsB = old.randomCalls();
  assert.equal(a.police.startPursuit(a.car), b.police.startPursuit(b.car)); assert.ok(a.police.suspect);
  assert.deepEqual(clone(a.police.suspect.goal), clone(b.police.suspect.goal));
  const snapshot = (p) => ({ hp: p.suspectHp, time: p.pursuitT, car: ['x', 'z', 'h', 'vx', 'vz', 'v'].map((k) => p.suspect?.car[k]) });
  for (let k = 0; k < 120; k++) {
    assert.deepEqual(clone(a.police.update(0.02, a.car, null, null, false)), clone(b.police.update(0.02, b.car, null, null, false)));
    assert.deepEqual(snapshot(a.police), snapshot(b.police));
  }
  assert.equal(env.randomCalls() - callsA, old.randomCalls() - callsB);
});
await check('9三難度時間/耐久/速度正確，勤務中拒絕換難度與覆寫職涯', () => {
  for (const difficulty of ['easy', 'standard', 'hard']) {
    const f = startPolice(createPolice(difficulty)), duty = state.POLICE_DUTIES[difficulty];
    assert.equal(f.police.pursuitT, duty.seconds); assert.equal(f.police.suspectHp, duty.hp);
    assert.equal(f.police.suspect.car.spec.vmax, 31 * duty.speed);
    assert.equal(f.police.setDutyDifficulty('easy'), false); f.police.setDutyCareer(state.newPoliceCareer());
    assert.equal(f.police.dutySummary.difficulty, difficulty);
  }
});
await check('9成功只發一次獎金，末步玩家碰撞先進評價，標準獎金原公式不變', () => {
  const f = createPolice(), money = finishPolice(f, 8), r = f.police.consumeDutyResult();
  assert.equal(money, 400 + Math.round((180 - 1.25) * 2)); assert.equal(r.reward, money);
  assert.equal(r.collisions, 1); assert.equal(r.rating, 'B'); assert.equal(r.consecutive, 1);
  assert.equal(f.police.consumeDutyResult(), null); f.police.endPursuit('arrested'); assert.equal(f.police.dutyCareer.completed, 1);
});
await check('9各難度獎金/乾淨A評價/連續成功及保存恢復', () => {
  for (const difficulty of ['easy', 'hard']) {
    const f = createPolice(difficulty), d = state.POLICE_DUTIES[difficulty], money = finishPolice(f);
    assert.equal(money, d.base + Math.round((d.seconds - 1.25) * d.perSecond)); assert.equal(f.police.lastDutyResult.rating, 'A');
    finishPolice(f); assert.equal(f.police.dutyCareer.consecutive, 2);
    const fresh = createPolice(); fresh.police.setDutyCareer(clone(f.police.dutyCareer)); assert.equal(fresh.police.dutyCareer.bestConsecutive, 2);
  }
});
await check('9碰撞冷卻合併持續接觸、高手B/C門檻不加獎金', () => {
  const f = startPolice(createPolice('hard'));
  for (let k = 0; k < 4; k++) f.police.update(0.1, f.car, null, null, false, 8);
  assert.equal(f.police.dutySummary.collisions, 1);
  f.police.update(0.81, f.car, null, null, false, 8); assert.equal(f.police.dutySummary.collisions, 2);
  assert.equal(state.policeDutyRating(1, 'hard'), 'B'); assert.equal(state.policeDutyRating(2, 'hard'), 'C');
});
await check('9逾時/跟丟中斷連勝，取消零獎金且不灌入失敗，重複結束不重記', () => {
  const f = createPolice(); finishPolice(f); f.police.consumeDutyResult(); startPolice(f);
  f.police.pursuitT = 0.01; const r = f.police.update(0.02, f.car, null, null, false);
  assert.equal(r.money, 0); assert.equal(f.police.dutyCareer.failed, 1); assert.equal(f.police.dutyCareer.consecutive, 0);
  startPolice(f); f.police.suspect.car.place(3000, 3000, 0); f.police.escapeT = 8;
  f.police.update(0.02, f.car, null, null, false); assert.equal(f.police.lastDutyResult.status, 'distance');
  assert.equal(f.police.dutyCareer.failed, 2); startPolice(f); f.police.hide();
  const cancelled = f.police.consumeDutyResult(); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.reward, 0);
  const career = clone(f.police.dutyCareer); f.police.hide(); assert.deepEqual(clone(f.police.dutyCareer), career);
});
await check('9無合法逃跑路線取消不記勤務，跨樓層停車不能逮捕', () => {
  const f = createPolice(); f.police.pickGoal = () => false;
  assert.match(f.police.startPursuit(f.car), /安全逃跑路線/); assert.equal(f.police.consumeDutyResult(), null);
  const other = startPolice(createPolice()); other.police.suspectHp = 0;
  other.police.suspect.car.place(other.car.x + 8, other.car.z, 0); other.police.suspect.car.y = other.car.y + 8;
  other.police.suspect.car.update = () => 0;
  other.police.update(1.2, other.car, null, null, false); assert.ok(other.police.suspect); assert.equal(other.police.arrestProgress, 0);
});
await check('10既有單程預覽/上客/時限/同層/車資結算與before一致，checkpoint不新增tour', () => {
  const a = createTaxi(), b = new OldTaxi(new THREE.Scene(), landmarks, oldRouter);
  const ao = a.previewOrders(1600, 1600, -0.25), bo = b.previewOrders(1600, 1600, -0.25);
  const noId = ({ id, ...r }) => r; assert.deepEqual(clone(ao.map(noId)), clone(bo.map(noId)));
  a.acceptOrder(ao[0].id, 1600, 1600, -0.25); b.acceptOrder(bo[0].id, 1600, 1600, -0.25);
  assert.equal(a.update(0.7, pos(ao[0].pickup)), b.update(0.7, pos(bo[0].pickup)));
  assert.equal('tour' in a.checkpoint(pos(ao[0].pickup)), false);
  assert.equal(a.update(0.7, pos(a.target)), b.update(0.7, pos(b.target))); assert.equal(a.money, b.money); assert.equal(a.trips, b.trips);
});
await check('10手動3/4/5站觀光預覽有界、去重、真道路距離及一次報酬，非法站數拒絕', () => {
  const t = createTaxi();
  for (const count of [3, 4, 5]) {
    const o = t.previewTours(1600, 1600, -0.25, count)[0]; assert.ok(o); assert.equal(o.tourStops.length, count);
    assert.equal(new Set([o.from, ...o.tourStops.map((s) => s.nm)]).size, count + 1); assert.ok(o.distance > 0 && o.distance <= 100000);
    assert.equal(o.estimatedFare, fareOf(o.distance)); assert.equal(o.estimatedTotal, fareOf(o.distance) + count * 80); assert.equal(o.timeLimit, 0);
  }
  for (const count of [0, 2, 6, Infinity, 3.5]) assert.equal(t.previewTours(1600, 1600, -0.25, count).length, 0);
});
await check('10預覽副本不能改內部行程，過期/偽造訂單拒絕；接單不更改原隨機序', () => {
  const t = createTaxi(), beforeCalls = env.randomCalls(), o = t.previewTours(1600, 1600, -0.25, 3)[0], first = o.tourStops[0].nm;
  o.tourStops[0].nm = '偽造地點'; assert.equal(t.acceptTour('forged', 1600, 1600, -0.25), false);
  assert.equal(t.acceptTour(o.id, 1600, 1600, -0.25), true); t.update(0.7, pos(o.pickup));
  assert.equal(t.target.nm, first); assert.equal(env.randomCalls(), beforeCalls);
  const other = createTaxi(), oldOrder = other.previewTours(1600, 1600, -0.25, 3)[0]; other.previewOrders(1600, 1600, -0.25);
  assert.equal(other.acceptTour(oldOrder.id, 1600, 1600, -0.25), false);
});
await check('10同層停穩接客/每站停靠，跳過順序與高速經過不算，途中不發錢', () => {
  const t = createTaxi(), o = t.previewTours(1600, 1600, -0.25, 3)[0]; t.acceptTour(o.id, 1600, 1600, -0.25);
  t.update(0.7, pos(o.pickup, { y: 8 })); assert.equal(t.phase, 'seek');
  t.update(0.7, pos(o.pickup, { v: 3 })); assert.equal(t.phase, 'seek');
  t.update(0.7, pos(o.pickup)); assert.equal(t.phase, 'ride');
  t.update(0.7, pos(o.tourStops[2])); assert.equal(t.tourProgress.completed, 0);
  t.update(0.7, pos(o.tourStops[0], { y: 8 })); assert.equal(t.tourProgress.completed, 0);
  t.update(0.7, pos(o.tourStops[0], { v: 3 })); assert.equal(t.tourProgress.completed, 0);
  assert.match(t.update(0.7, pos(o.tourStops[0])), /已停靠/); assert.equal(t.tourProgress.completed, 1);
  assert.equal(t.money, 0); assert.equal(t.trips, 0); assert.equal(t.consumeSettlement(), null); assert.equal(t.target.nm, o.tourStops[1].nm);
});
await check('10休閒行程不扣時；全程3/4/5站只結算一趟與一筆獎金，繞路不灌車資', () => {
  for (const count of [3, 4, 5]) {
    const { taxi: t, order: o } = tourStart(count); t.update(10000, pos(o.pickup)); assert.equal(t.timeLeft, 0); assert.equal(t.phase, 'ride');
    t.odo = 1e6;
    for (const s of o.tourStops) t.update(0.7, pos(s));
    assert.equal(t.phase, 'off'); assert.equal(t.money, o.estimatedTotal); assert.equal(t.trips, 1);
    assert.equal(t.lastTrip.tour.completed, count); assert.equal(t.lastTrip.tipBeforeDeduction, 0); assert.equal(t.lastTrip.bonus, count * 80);
    const event = t.consumeSettlement(); assert.equal(event.total, o.estimatedTotal); assert.equal(event.status, 'delivered');
    assert.equal(t.consumeSettlement(), null); t.update(0.7, pos(o.destination)); assert.equal(t.trips, 1);
  }
});
await check('10上客前與中途checkpoint往返保留站序/里程，續接不讀金錢、不吃離線時數', () => {
  const t = createTaxi(), o = t.previewTours(1600, 1600, -0.25, 4)[0]; t.acceptTour(o.id, 1600, 1600, -0.25);
  const seek = t.checkpoint(pos(o.pickup)); assert.ok(seek.tour); const fresh = createTaxi();
  assert.equal(fresh.resume(clone(seek), seek.position).ok, true); assert.equal(fresh.phase, 'seek'); fresh.update(0.7, pos(o.pickup));
  fresh.update(0.7, pos(o.tourStops[0])); fresh.update(0.7, pos(o.tourStops[1]));
  const mid = fresh.checkpoint(pos(o.tourStops[1])); const restored = createTaxi();
  assert.equal(restored.resume({ ...clone(mid), money: 1e8, trips: 999 }, mid.position).ok, true);
  assert.equal(restored.money, 0); assert.equal(restored.trips, 0); assert.equal(restored.tourProgress.completed, 2);
  assert.equal(restored.target.nm, o.tourStops[2].nm); assert.equal(restored.odo, mid.odo); assert.equal(restored.timeLeft, 0);
  restored.update(0.7, pos(o.tourStops[2])); restored.update(0.7, pos(o.tourStops[3])); assert.equal(restored.money, o.estimatedTotal);
  const duplicate = createTaxi(); assert.equal(duplicate.resume(mid, mid.position, restored.settledIds).ok, false);
});
await check('10有界schema拒絕重複/少站/超站/亂序/錯目的地/非休閒/偽造獎金資料', () => {
  const { taxi: t, order: o } = tourStart(), cp = clone(t.checkpoint(pos(o.pickup)));
  for (const mutate of [
    (c) => c.tour.stops.pop(), (c) => c.tour.stops.push(...c.tour.stops), (c) => c.tour.stops[1] = c.tour.stops[0],
    (c) => c.tour.next = 3, (c) => c.tour.distance = Infinity, (c) => c.target = c.tour.stops[1],
    (c) => c.destination = c.tour.stops[0], (c) => c.relaxed = false, (c) => c.routeLen++, (c) => c.tour.stops[0].nm = c.from,
  ]) { const bad = clone(cp); mutate(bad); assert.equal(checkpoint.parseTaxiCheckpoint(bad), null); }
  const forged = clone(cp); forged.tour.reward = 1e9; const parsed = checkpoint.parseTaxiCheckpoint(forged); assert.ok(parsed); assert.equal('reward' in parsed.tour, false);
});
await check('10續接重驗每一站與每一段道路；改名/未來不可達/原距離遭改都拒絕', () => {
  const { taxi: t, order: o } = tourStart(), cp = clone(t.checkpoint(pos(o.pickup)));
  const missing = clone(cp); missing.tour.stops[1].nm = '不存在的地標'; assert.equal(createTaxi().resume(missing, cp.position).ok, false);
  const inflated = clone(cp); inflated.tour.distance += 100; inflated.routeLen += 100; assert.equal(createTaxi().resume(inflated, cp.position).ok, false);
  const failed = createTaxi(), realRoute = failed.router.route.bind(failed.router), blocked = cp.tour.stops[1];
  failed.router = { route(...args) { return args[2] === blocked.x && args[3] === blocked.z ? null : realRoute(...args); } };
  assert.equal(failed.resume(cp, cp.position).ok, false); assert.equal(failed.phase, 'off');
});
await check('10途中放棄/下一站路線中斷皆零獎金；普通訂單可再次接取且不殘留觀光欄位', () => {
  const { taxi: t, order: o } = tourStart(); t.update(0.7, pos(o.tourStops[0])); t.abandon();
  assert.equal(t.money, 0); assert.equal(t.checkpoint(pos(o.pickup)), null); assert.equal(t.consumeSettlement(), null);
  assert.equal(t.tourProgress, null); const ordinary = t.previewOrders(1600, 1600, -0.25)[0]; t.acceptOrder(ordinary.id, 1600, 1600, -0.25);
  assert.equal('tour' in t.checkpoint(pos(ordinary.pickup)), false);
  const next = tourStart(); next.taxi.router = { route: () => null };
  assert.match(next.taxi.update(0.7, pos(next.order.tourStops[0])), /取消/); assert.equal(next.taxi.money, 0); assert.equal(next.taxi.phase, 'off');
});

report.passed = report.checks.filter((c) => c.status === 'PASS').length;
report.failed = report.checks.length - report.passed; report.status = report.failed ? 'FAIL' : 'PASS';
await writeFile(resolve(root, 'tools/dev-tests/tenpack-city-regression.json'), JSON.stringify(report, null, 2) + '\n');
for (const c of report.checks) console.log(`${c.status} ${c.name}${c.error ? '\n' + c.error : ''}`);
console.log(`${report.status} ${report.passed}/${report.checks.length}`); if (report.failed) process.exitCode = 1;
