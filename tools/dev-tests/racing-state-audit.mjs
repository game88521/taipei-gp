// 純 Node 對照：不建置、不開瀏覽器、不讀寫玩家存檔；圖形車模以空模型隔離。
// node --experimental-vm-modules tools/dev-tests/racing-state-audit.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const original = path.resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? path.resolve(project, '../taipei-gp-priority-before-20261111'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const report = { checks: [], before: {}, after: {}, limitations: ['空車模、未跑瀏覽器與正式固定回歸', '安全車未來抽樣沿用原生亂數；快照保存現有物理與進站種子，不保存瀏覽器隱藏的 Math.random 內部狀態'] };
function check(label, run) { run(); report.checks.push(label); }

async function load(root) {
  let seed = 17, randomCalls = 0;
  const math = Object.create(Math);
  math.random = () => { randomCalls++; seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const context = vm.createContext({ console, URLSearchParams, location: { search: '' }, Math: math, performance,
    setTimeout, clearTimeout, AbortController, DOMException, fetch, URL, TextDecoder, Response, Request, Headers });
  const modules = new Map();
  const synthetic = (id, values) => new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context, identifier: id });
  const teams = Array.from({ length: 11 }, (_, i) => ({ team: `team${i}`, livery: { main: '#ff0000' } }));
  async function module(id) {
    if (modules.has(id)) return modules.get(id);
    const loading = (async () => {
    let m;
    if (id === 'three') m = synthetic(id, THREE);
    else if (id.includes('three/')) { const values = await import(id); m = synthetic(id, values); }
    else if (id.endsWith('/f1model.ts')) m = synthetic(id, { TEAMS: teams, makeF1: () => ({ root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] }), setLod() {}, setTyre() {} });
    else if (id.endsWith('/world.ts')) m = synthetic(id, { canvasTex() { throw Error('測試不應建立畫面'); } });
    else if (id.endsWith('.json')) m = synthetic(id, { default: JSON.parse(await readFile(id, 'utf8')) });
    else {
      const source = await readFile(id, 'utf8');
      const js = stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: id });
      m = new vm.SourceTextModule(js, { context, identifier: id });
    }
    return m;
    })();
    modules.set(id, loading);
    return loading;
  }
  const linker = async (specifier, referring) => {
      let next = specifier;
      if (specifier.startsWith('.')) {
        next = path.resolve(path.dirname(referring.identifier), specifier).replaceAll('\\', '/');
        if (!path.extname(next)) next += '.ts';
      }
      return module(next);
  };
  const rootModule = await module(path.join(root, 'src/rivals.ts').replaceAll('\\', '/'));
  await rootModule.link(linker);
  await rootModule.evaluate();
  async function exports(file) { const m = await module(path.join(root, file).replaceAll('\\', '/')); if (m.status === 'unlinked') await m.link(linker); if (m.status !== 'evaluated') await m.evaluate(); return m.namespace; }
  return { rivals: rootModule.namespace, track: await exports('src/track.ts'), car: await exports('src/car.ts'),
    season: await exports('src/season.ts'), exports, randomCalls: () => randomCalls };
}

const before = await load(original), after = await load(project);
const track0 = before.track.buildTrack(), track1 = after.track.buildTrack();
function field(env, track) { const player = new env.car.Car(); const f = new env.rivals.RaceField(new THREE.Scene(), track, player); f.setup(9); return f; }
const old = field(before, track0), current = field(after, track1);
const carKeys = ['x', 'z', 'h', 'v', 'steer', 'power', 'boost', 'drs', 'gripMul', 'r26', 'aeroZone', 'ovt', 'energy', 'speedCap', 'pos', 'touch', 'hitCool'];
function comparable(f) { return clone({ time: f.raceTime, hits: f.aiHits, seed: f.pitSeed, racers: f.racers.map((r) => ({ car: Object.fromEntries(carKeys.map((k) => [k, r.car[k]])), compound: r.compound, wear: r.wear,
  pit: r.pit, laps: r.laps, finish: r.finish, bestLap: r.bestLap, lat: r.lat, stuck: r.stuck, slowT: r.slowT, defT: r.defT })) }); }
function tick(f, track, dt = 1 / 120) {
  const c = f.me.car, prev = c.pos.s, i = c.pos.i;
  const j = (i + Math.round((8 + c.v * 0.45) / track.ds)) % track.N;
  let err = Math.atan2(track.px[j] - c.x, track.pz[j] - c.z) - c.h; err = Math.atan2(Math.sin(err), Math.cos(err));
  const ahead = (i + Math.round((c.v * 0.5) / track.ds)) % track.N;
  if (f.drsZoneAt(c.pos.s) >= 0) f.playerDrs();
  c.update(dt, track, Math.max(-1, Math.min(1, -err * 2.5)), c.v > track.vTarget[ahead] + 1);
  f.update(dt, true); f.playerLap(prev);
}
for (let i = 0; i < 60 * 120; i++) { tick(old, track0); tick(current, track1); }
check('固定 1/120、60 秒模擬的所有車物理／胎況／進站種子完全相同', () => assert.deepEqual(comparable(current), comparable(old)));
check('固定步進未新增或改序 Math.random 呼叫', () => assert.equal(after.randomCalls(), before.randomCalls()));

const oc = old.me.car, nc = current.me.car;
oc.boost = nc.boost = 0.05; oc.speedCap = nc.speedCap = 40; nc.energy = 0.2;
oc.placeAt(track0, 1); nc.placeAt(track1, 1);
report.before.reset = { boost: oc.boost, speedCap: oc.speedCap };
check('扶正不會清除 GP 電量／限速', () => { assert.equal(nc.speedCap, 40); assert.equal(nc.energy, 0.2); });
nc.resetTransient(true);
report.after.reset = { boost: nc.boost, speedCap: String(nc.speedCap), energy: nc.energy };
check('賽事入口清除尾流／安全車限速並重設電量', () => { assert.equal(nc.boost, 0); assert.equal(nc.speedCap, Infinity); assert.equal(nc.energy, 1); assert.equal(nc.r26, true); });

function cooldown(env, track, dt) {
  const f = field(env, track), r = f.racers[0]; f.solo = true; r.defT = 3; r.car.v = 20;
  let elapsed = 0; while (r.defT > 1e-9) { f.drive(r, false, dt); elapsed += dt; }
  return elapsed;
}
report.before.cooldown90 = cooldown(before, track0, 1 / 180);
report.after.cooldown90 = cooldown(after, track1, 1 / 180);
report.after.cooldown60 = cooldown(after, track1, 1 / 120);
check('90FPS 對應180物理步時，舊3秒冷卻約2秒，新版約3秒', () => { assert.ok(Math.abs(report.before.cooldown90 - 2) < 0.01); assert.ok(Math.abs(report.after.cooldown90 - 3) < 0.01); assert.ok(Math.abs(report.after.cooldown60 - 3) < 0.01); });

const timing = new (await after.exports('src/race-timing.ts')).RaceTiming();
timing.observe('快', 0, 0); timing.observe('慢', 0, 0); timing.observe('快', 100, 5); timing.observe('慢', 50, 5);
check('共同50m計時點：不同速度可得2.5秒實測差，不是距離÷60', () => assert.equal(timing.gap('快', '慢'), 2.5));
check('沒有共同比較點時不捏造秒差', () => assert.equal(timing.gap('快', '未知'), null));

const saved = field(after, track1);
for (let i = 0; i < 10 * 120; i++) tick(saved, track1);
saved.me.pitReq = true; saved.me.pitTyre = 3; saved.me.car.energy = 0.31; saved.me.car.hitCool = 0.17;
saved.wet = 0.65; saved.rainAt = 4; saved.sc = { phase: 'out', t: 2, lapAt: 1, used: true, s: 50 };
saved.racers[0].pit = { ph: 'box', sd: -30, v: 0, entry: 4, exit: 4, t: 0.7, T: 3, slow: -1, next: 3, box: -30, team: 1 };
const snapshot = clone(saved.snapshot()), restored = field(after, track1);
check('JSON往返後完整恢復物理、輪胎／安全車與進站種子', () => { assert.equal(restored.restore(snapshot), true); assert.deepEqual(clone(restored.snapshot()), snapshot); });
for (let i = 0; i < 2 * 120; i++) { tick(saved, track1); tick(restored, track1); }
check('恢復後再跑2秒與未中斷全場完全一致', () => assert.deepEqual(comparable(saved), comparable(restored)));
const stateParser = await after.exports('src/race-state.ts');
check('拒絕NaN、不匹配賽道、損壞車輛／種子且不改現場', () => {
  const unchanged = clone(restored.snapshot());
  const bad = clone(snapshot); bad.racers[0].car.energy = NaN; assert.equal(stateParser.parseRaceSnapshot(bad), null);
  bad.racers[0].car.energy = 0.5; bad.pitSeed = 0; assert.equal(restored.restore(bad), false);
  const wrong = clone(snapshot); wrong.trackLength += 1; assert.equal(restored.restore(wrong), false);
  assert.deepEqual(clone(restored.snapshot()), unchanged);
});
check('快照白名單不接受原型與任意額外欄位', () => {
  const extra = clone(snapshot); extra.racers[0].car = JSON.parse(JSON.stringify(extra.racers[0].car).replace('{', '{"__proto__":{"polluted":true},"unexpected":5,'));
  const clean = stateParser.parseRaceSnapshot(extra); assert.ok(clean); assert.equal(Object.hasOwn(clean.racers[0].car, '__proto__'), false); assert.equal(clean.racers[0].car.unexpected, undefined);
});
report.after.snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));

const s = { round: 0, results: [], laps: 3, diff: 'normal', rules: 'classic', seed: 42, form: {}, no: 1,
  pending: { id: 'australia', grid: snapshot.racers.map((r) => r.name), at: 100, elapsed: 10,
    checkpoint: { trackV: 'test-track', race: snapshot, player: { lap: 1, lapTime: 10, lastLap: null, sectorIdx: 0, sectorStart: 0, lapValid: true }, savedAt: 200 } } };
check('完整賽季檢查點可安全往返', () => assert.deepEqual(clone(after.season.parseSeasonSave(clone(s))), s));
check('檢查點保存無效圈；舊檢查點預設有效，錯誤型別只捨棄檢查點', () => {
  const invalid = clone(s); invalid.pending.checkpoint.player.lapValid = false;
  assert.equal(after.season.parseSeasonSave(invalid).pending.checkpoint.player.lapValid, false);
  const legacy = clone(s); delete legacy.pending.checkpoint.player.lapValid;
  assert.equal(after.season.parseSeasonSave(legacy).pending.checkpoint.player.lapValid, true);
  const broken = clone(s); broken.pending.checkpoint.player.lapValid = 'false';
  assert.equal(after.season.parseSeasonSave(broken).pending.checkpoint, undefined);
});
check('賽季站次損壞拒絕，僅checkpoint損壞則保留有效賽季／pending', () => {
  const broken = clone(s); broken.round = 1; assert.equal(after.season.parseSeasonSave(broken), null);
  const rules = clone(s); rules.pending.checkpoint.race.rules = '2026'; const recovered = after.season.parseSeasonSave(rules);
  assert.equal(recovered.round, 0); assert.equal(recovered.pending.elapsed, 10); assert.equal(recovered.pending.checkpoint, undefined);
});
const results = [
  ['甲', '乙', '你', '丙'], ['丙', '乙', '你', '甲'], ['你', '甲', '乙', '丙'],
].map((order, i) => ({ id: ['australia', 'china', 'japan'][i], order }));
// 直接用同分但亞軍次數不同的完整名次統計，驗證車手／車隊完整 countback。
check('同分時第二、第三……名次次數可完整比較', () => {
  assert.ok(after.season.comparePositions([0, 1, 2], [0, 2]) > 0);
  assert.ok(after.season.comparePositions([0, 2, 0, 1], [0, 2, 1]) > 0);
  const rows = [{ name: '甲', team: 'A', pts: 40, wins: 0, podiums: 2, best: 2, fls: 0, positions: [0, 1, 1] },
    { name: '乙', team: 'B', pts: 40, wins: 0, podiums: 2, best: 2, fls: 0, positions: [0, 2] }];
  assert.equal(after.season.teamStandings(rows)[0].team, 'B');
  assert.equal(before.season.teamStandings(rows)[0].team, 'A');
});
check('逐站累計名次次數，DNF不增加勝場或名次次數', () => {
  const table = after.season.driverStandings({ round: 3, results: [...results, { id: 'miami', order: ['乙', '你', '甲', '丙'], dnf: ['乙'] }] }, (n) => n);
  assert.equal(table.find((r) => r.name === '乙').positions[0] ?? 0, 0);
  assert.equal(table.find((r) => r.name === '乙').positions[1], 2);
});
check('車手同分完整流程：舊排序先乙，新版依兩次亞軍排甲在乙之前', () => {
  const filler = Array.from({ length: 8 }, (_, i) => `其他${i}`);
  const makeOrder = (a, b) => { const order = Array(11); order[0] = '你'; order[a - 1] = '甲'; order[b - 1] = '乙'; let n = 0; return order.fill(undefined).map((_, i) => i === 0 ? '你' : i === a - 1 ? '甲' : i === b - 1 ? '乙' : filler[n++]); };
  const tie = { round: 3, results: [[11, 2], [2, 5], [2, 6]].map(([a, b], i) => ({ id: ['australia', 'china', 'japan'][i], order: makeOrder(a, b) })) };
  const oldNames = before.season.driverStandings(tie, (n) => n).map((r) => r.name);
  const newRows = after.season.driverStandings(tie, (n) => n), newNames = newRows.map((r) => r.name);
  assert.ok(oldNames.indexOf('乙') < oldNames.indexOf('甲')); assert.ok(newNames.indexOf('甲') < newNames.indexOf('乙'));
  assert.equal(newRows.find((r) => r.name === '甲').pts, 36); assert.equal(newRows.find((r) => r.name === '乙').pts, 36);
});
check('歷史賽季白名單往返，損壞名次拒絕', () => {
  const history = [{ no: 1, rank: 2, pts: 320, wins: 3, champion: '甲', team: 'team1', teamRank: 1, laps: 3 }];
  assert.deepEqual(clone(after.season.parseSeasonHistory(history)), history);
  history[0].rank = 99; assert.equal(after.season.parseSeasonHistory(history), null);
});

const replay = field(after, track1);
for (let i = 0; i < 12; i++) tick(replay, track1);
replay.wet = 0.9; replay.rainAt = 0; replay.me.compound = 3;
replay.me.pit = { ph: 'box', sd: 0, v: 0, entry: 4, exit: 4, t: 1, T: 3, slow: -1, next: 3, box: 0, team: 0 }; replay.me.lift = 0.22;
for (let i = 0; i < 12; i++) replay.update(1 / 120, true);
check('回放可還原早期乾地舊胎與後期雨胎／停站，且不改現場', () => {
  assert.equal(replay.replayStateAt(0).wet, 0);
  const late = replay.replayStateAt(0.15), player = late.cars.find((r) => r.name === '你');
  assert.ok(late.wet >= 0.9 && late.wet <= 1); assert.equal(player.compound, 3); assert.equal(player.pit.ph, 'box');
  player.pit.t = 99; assert.notEqual(replay.me.pit.t, 99);
});
const pitReplay = field(after, track1);
pitReplay.playerModel = { root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] };
pitReplay.me.compound = 1;
pitReplay.me.pit = { ph: 'box', sd: 0, v: 0, entry: 4, exit: 4, t: 1, T: 3, slow: -1, next: 3, box: 0, team: 0 };
for (let i = 0; i < 12; i++) pitReplay.update(1 / 120, true);
pitReplay.me.pit.t = 3.01;
pitReplay.racers[0].pit = { ph: 'in', sd: -6, v: 0, entry: 4, exit: 4, t: 0, T: 3, slow: -1, next: 1, box: 30, team: 1 };
for (let i = 0; i < 12; i++) pitReplay.update(1 / 120, true);
pitReplay.me.pit = null; pitReplay.me.compound = 2; pitReplay.me.car.x = 1234; pitReplay.me.car.z = 3456;
check('回放維修人員用歷史舊胎／新胎、抬升與rec位置，不讀最終車況', () => {
  const unchanged = clone(pitReplay.snapshot()), stop = pitReplay.replayStopsAt(0).get(0);
  assert.equal(stop.oldColor, after.rivals.TYRES[1].color); assert.equal(stop.newColor, after.rivals.TYRES[3].color);
  assert.equal(stop.phase, 'service'); assert.ok(stop.lift > 0); assert.equal(stop.model, pitReplay.playerModel);
  assert.notEqual(stop.x, 1234); assert.notEqual(stop.z, 3456);
  stop.t = 99; assert.notEqual(pitReplay.replayStopsAt(0).get(0).t, 99);
  assert.deepEqual(clone(pitReplay.snapshot()), unchanged);
});
check('回放放行燈按當時快車道阻擋，無停站或非法時間回傳空Map', () => {
  const held = pitReplay.replayStopsAt(0.15).get(0); assert.equal(held.hold, true); assert.equal(held.go, false); assert.equal(held.phase, 'service');
  assert.equal(replay.replayStopsAt(0).size, 0); assert.equal(pitReplay.replayStopsAt(NaN).size, 0);
});

const completion = field(after, track1); completion.me.finish = 1; completion.me.laps = 4;
for (const r of completion.racers) if (!r.isPlayer) { r.finish = 2; r.laps = 4; }
completion.racers[0].finish = null;
const playerBefore = clone(completion.me.car.snapshot());
completion.finishRemainder(0);
check('背景結算超時只標未完賽DNF，不改有效完賽與玩家結果', () => {
  assert.equal(completion.racers[0].dnf, true); assert.equal(completion.racers[1].dnf, false);
  assert.equal(completion.racers[1].finish, 2); assert.deepEqual(clone(completion.me.car.snapshot()), playerBefore);
});
const cancelled = field(after, track1); cancelled.me.finish = 1;
const controller = new AbortController(); controller.abort();
await assert.rejects(cancelled.finishRemainderAsync({ signal: controller.signal }), { name: 'AbortError' });
check('取消背景結算不誤標DNF', () => assert.equal(cancelled.racers.some((r) => r.dnf), false));

const finishing = field(after, track1); finishing.raceTime = 60; finishing.me.finish = 55; finishing.me.laps = 4;
for (const r of finishing.racers) if (!r.isPlayer) { r.finish = 56; r.laps = 4; }
const trailing = finishing.racers[0]; trailing.finish = null; trailing.laps = 3; trailing.lapStart = 0;
trailing.car.placeAt(track1, track1.N - 2); trailing.car.v = 50;
report.before.trailingFinish = trailing.finish;
const frozenPlayer = clone(finishing.me.car.snapshot());
await finishing.finishRemainderAsync({ maxSeconds: 5 });
report.after.trailingFinish = trailing.finish;
check('背景逐步完成後方有效圈並保留玩家完賽物理', () => {
  assert.ok(trailing.finish > 60 && trailing.finish < 65); assert.equal(trailing.dnf, false);
  assert.equal(finishing.me.finish, 55); assert.deepEqual(clone(finishing.me.car.snapshot()), frozenPlayer);
});
const active = field(after, track1); active.me.finish = 1;
const midAbort = new AbortController(); let observedProgress = false;
await assert.rejects(active.finishRemainderAsync({ signal: midAbort.signal, maxSeconds: 30,
  onProgress(p) { observedProgress = p.elapsed > 0; midAbort.abort(); } }), { name: 'AbortError' });
check('分批結算確實讓出事件迴圈，運算中取消不誤標DNF', () => {
  assert.equal(observedProgress, true); assert.equal(active.racers.some((r) => r.dnf), false); assert.equal(active.completing, false);
});

report.ok = true;
await writeFile(path.join(project, 'tools/dev-tests/racing-state-audit-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
