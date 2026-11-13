// 真模組與 main AST 控制流程；不操作正式站、玩家存檔或 WebGL。
// node --experimental-vm-modules tools/dev-tests/all-racing-features.mjs [sealed-before]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { parseAst } from 'rolldown/parseAst';
import * as THREE from 'three';
import { loadGameModules } from './racing-test-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const beforeRoot = path.resolve(process.argv[2] ?? process.env.GP_ALL_BASELINE_DIR ?? path.join(root, '../taipei-gp-all-before-811385b20e05'));
const env = await loadGameModules(root), old = await loadGameModules(beforeRoot);
const laps = await env.exports('src/racing-laps.ts'), strategy = await env.exports('src/strategy.ts');
const replay = await env.exports('src/racing-replay.ts'), pit = await env.exports('src/pitlane.ts');
const clone = (v) => JSON.parse(JSON.stringify(v));
const report = { beforeRoot, root, checks: [], limitations: ['真 Car/RaceField/season 與 main AST；車模、DOM、保存及 GPU 隔離。', '進站為依目前資料的模型區間，未驗證其統計涵蓋率。', '未執行建置、固定回歸、瀏覽器操作或手機測試，由主代理統一處理。'] };
report.sourceHashes = {};
for (const name of ['season.ts', 'rivals.ts', 'race-state.ts', 'strategy.ts', 'racing-laps.ts', 'racing-replay.ts', 'pitlane.ts', 'main.ts']) report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root, 'src', name))).digest('hex');
async function check(name, action) {
  try { report.checks.push({ name, status: 'PASS', detail: await action() }); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: error.stack }); }
}
function fieldOf(e = env) { const track = e.track.buildTrack(), car = new e.car.Car(); const field = new e.rivals.RaceField(new THREE.Scene(), track, car); field.setup(9); return { field, track, car }; }
const mainCode = stripTypeScriptTypes(await readFile(path.join(root, 'src/main.ts'), 'utf8'), { mode: 'transform' });
const mainAst = parseAst(mainCode);
function fn(name) { const n = mainAst.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name); if (!n) throw Error(`缺少 main.${name}`); return mainCode.slice(n.start, n.end); }
function element() { const c = new Set(); return { children: [], className: '', textContent: '', value: '', max: '', hidden: false, style: {},
  classList: { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) },
  appendChild(x) { this.children.push(x); }, append(...x) { this.children.push(...x); }, replaceChildren(...x) { this.children = x; }, addEventListener() {} }; }
function context(extra = {}) { const elements = new Map(), $ = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  return vm.createContext({ console, performance, Date, Math, document: { createElement: element }, $, ...extra }); }
function loadFunctions(ctx, names) { for (const name of names) vm.runInContext(fn(name), ctx); }

await check('Y 真22站賽果：200分8勝對174分0勝，最後26分也無法奪冠', () => {
  const { field } = fieldOf(), other = field.racers.map((r) => r.name).filter((n) => n !== '你' && n !== '陳冠宇');
  const rotate = (n) => [...other.slice(n % 20), ...other.slice(0, n % 20)];
  const s = { ...env.season.defaultSeason(), round: 22, results: [] };
  for (let i = 0; i < 22; i++) { let order; if (i < 8) order = ['陳冠宇', '你', ...rotate(i * 3)];
    else { order = rotate((i - 8) * 7); if (i < 10) order.splice(2, 0, '你'); else order.push('你'); order.push('陳冠宇'); }
    s.results.push({ id: env.circuits.CIRCUITS[i].id, order }); }
  const team = (n) => field.racers.find((r) => r.name === n)?.team ?? '', rows = env.season.driverStandings(s, team);
  assert.equal(rows[0].pts, 200); assert.equal(rows[1].pts, 174);
  assert.equal(old.season.titleFight(rows, '你', 1, 22).canWin, true);
  assert.equal(env.season.titleFight(rows, '你', 1, 22).canWin, false);
  assert.equal(env.season.titleFight(rows, '陳冠宇', 1, 22).clinched, true);
  const order = ['你', ...rotate(0)]; order.splice(10, 0, '陳冠宇');
  s.results.push({ id: env.circuits.CIRCUITS[22].id, order, fl: '你' });
  const final = env.season.driverStandings(s, team);
  assert.equal(final[0].name, '陳冠宇'); assert.equal(final[1].pts, 200); assert.equal(final[1].wins, 1);
  // 分差相同但挑戰者本來勝場較多時，不能過早說已封王。
  const tieRows = [{ ...rows[0], pts: 26, wins: 0, positions: [0, 2] }, { ...rows[1], pts: 0, wins: 2, positions: [2] }];
  assert.equal(env.season.titleFight(tieRows, '你', 1).canWin, true);
  assert.equal(env.season.titleFight(tieRows, '陳冠宇', 1).clinched, false);
  return { beforeCanWin: true, afterCanWin: false, leaderClinched: true, final: final.slice(0, 2).map((r) => ({ name: r.name, pts: r.pts, wins: r.wins })) };
});

await check('G 真3/6/12/23站賽曆與存檔驗證，舊無calendar完整23站', () => {
  for (const n of [3, 6, 12, 23]) {
    const s = env.season.defaultSeason(3, 'normal', 'classic', 1, n), ids = env.season.seasonCalendar(s);
    assert.equal(ids.length, n); assert.equal(new Set(ids).size, n); assert.ok(env.season.parseSeasonSave(s));
    for (let i = 0; i < n; i++) { assert.equal(env.season.seasonCircuitId(s), ids[i]); s.results.push({ id: ids[i], order: ['你', '陳冠宇'] }); s.round++; assert.ok(env.season.parseSeasonSave(s)); }
    assert.equal(env.season.seasonCircuitId(s), undefined);
    assert.equal(env.season.isFullSeason(s), n === 23);
  }
  const legacy = env.season.defaultSeason(); assert.equal(env.season.seasonLength(legacy), 23); assert.equal(Object.hasOwn(env.season.parseSeasonSave(legacy), 'calendar'), false);
  const s = env.season.defaultSeason(3, 'normal', 'classic', 1, 3);
  s.pending = { id: s.calendar[1], grid: ['你'], at: 0 }; assert.equal(env.season.parseSeasonSave(s), null);
  s.pending.id = s.calendar[0]; assert.ok(env.season.parseSeasonSave(s));
  for (const invalid of [[...s.calendar.slice(0, 2), s.calendar[0]], ['bad', ...s.calendar.slice(1)], s.calendar.slice(1)]) assert.equal(env.season.parseSeasonSave({ ...s, calendar: invalid }), null);
  assert.equal(env.season.parseSeasonSave({ ...s, calendar: undefined, round: 1, results: [{ id: s.calendar[1], order: ['你'] }], pending: undefined }), null);
  const history = { no: 1, rank: 1, pts: 78, wins: 3, champion: '你', team: '虛構隊', teamRank: 1, laps: 3, rounds: 3 };
  assert.equal(env.season.parseSeasonHistory([history])[0].rounds, 3);
  assert.equal(env.season.parseSeasonHistory([{ ...history, wins: 4 }]), null);
  assert.equal(env.season.parseSeasonHistory([{ ...history, rounds: '3' }]), null);
  return { calendars: [3, 6, 12, 23].map((n) => env.season.makeSeasonCalendar(n)) };
});

await check('G 真main短季結算：比例獎金、歷史季長、完整季成就隔離與防重複發獎', () => {
  function settle(n) {
    const s = env.season.defaultSeason(3, 'normal', 'classic', 1, n);
    s.results = s.calendar.map((id) => ({ id, order: ['你', '陳冠宇'], fl: '你' })); s.round = n;
    const stats = { seasonsDone: 0, seasonTitles: 0, teamTitles: 0, seasonWins: 0, perfectSeason: 0 }, awards = [];
    const ctx = context({ ...env.season, save: {}, stats, teamOf: (n) => n === '你' ? 'A' : 'B', earn: (cash) => awards.push(cash), checkAchievements() {}, seasonPrizeText: '' });
    loadFunctions(ctx, ['settleSeason']); ctx.settleSeason(s); ctx.settleSeason(s);
    assert.equal(awards.length, 1); assert.equal(ctx.save.seasonHistory[0].rounds, n);
    return { cash: awards[0], stats };
  }
  const full = settle(23), short = settle(3); assert.equal(full.cash, 60000); assert.equal(short.cash, Math.floor(60000 * 3 / 23));
  assert.deepEqual(short.stats, { seasonsDone: 0, seasonTitles: 0, teamTitles: 0, seasonWins: 0, perfectSeason: 0 });
  assert.equal(full.stats.seasonsDone, 1); assert.equal(full.stats.perfectSeason, 1);
  assert.ok(env.season.seasonPrize(1, 1, 12).cash < full.cash);
  return { full, short };
});

await check('E 真圈表：無效圈排除、分段差/理論最佳、近10圈有界與清除', () => {
  const table = new laps.SessionLaps(10);
  table.add({ time: 60, sectors: [20, 20, 20], valid: true });
  const row = table.add({ time: 57, sectors: [19, 18, 20], valid: true });
  assert.equal(row.delta, -3); assert.deepEqual(clone(row.sectorDeltas), [-1, -2, 0]);
  table.add({ time: 3, sectors: [1, 1, 1], valid: false });
  let s = table.summary(); assert.equal(s.best, 57); assert.equal(s.theoreticalBest, 57); assert.equal(s.validCount, 2); assert.equal(s.average, 58.5); assert.equal(s.stddev, 1.5);
  row.sectors[0] = 999; assert.equal(table.rows()[1].sectors[0], 19);
  for (let i = 0; i < 100; i++) table.add({ time: 61, sectors: [20, 20, 21], valid: true });
  assert.equal(table.rows().length, 10); assert.equal(table.summary().count, 103); assert.equal(table.summary().best, 57);
  table.clear(); assert.equal(table.rows().length, 0); assert.equal(table.summary().best, null);
});

await check('E 真main記圈與換圈：重啟圈時計不清除整場歷史', () => {
  const table = new laps.SessionLaps(10), ctx = context({ sessionLaps: table, lapSectors: [19, 20, null], sectorStart: 39, lapValid: true,
    fmt: (v) => v == null ? '—' : String(v), fmtDelta: String, car: { pos: { s: 1 }, x: 0, z: 0, h: 0 }, recAcc: 0, ghostPtr: 0 });
  loadFunctions(ctx, ['recordSessionLap', 'renderSessionLaps', 'startLap']);
  ctx.recordSessionLap(60); ctx.startLap(); assert.equal(table.rows().length, 1); assert.equal(ctx.lapTime, 0);
  ctx.lapValid = false; ctx.recordSessionLap(5); assert.equal(table.summary().validCount, 1);
});

await check('F 完整進站區間、本下圈、未知差距與安全車/排隊：不依賴未來資料', () => {
  const input = { laneLength: 300, limit: 80 / 3.6, racingTime: 5, lapTime: 60, wear: 0.6, lapsRemaining: 3,
    rivals: [{ gap: -2 }, { gap: 14 }, { gap: 25 }, { gap: null }] };
  const result = strategy.estimatePitStrategy(input);
  assert.ok(result.currentLap.loss.min > strategy.pitBaselineLoss(300, input.limit, 5));
  assert.ok(result.currentLap.loss.max > result.currentLap.loss.min); assert.ok(result.nextLap);
  assert.ok(result.currentLap.net.min < result.nextLap.net.min);
  assert.ok(result.currentLap.rejoin.worst >= result.currentLap.rejoin.best);
  const queue = strategy.estimatePitStrategy({ ...input, queueSeconds: 4 }); assert.equal(queue.currentLap.loss.min, result.currentLap.loss.min + 4);
  const sc = strategy.estimatePitStrategy({ ...input, safetyCar: true }); assert.ok(sc.currentLap.loss.min < result.currentLap.loss.min);
  assert.equal(strategy.estimatePitStrategy({ ...input, lapsRemaining: 1 }).nextLap, null);
  assert.equal(strategy.estimatePitStrategy({ ...input, lapTime: NaN }), null);
  return clone(result);
});

function deterministicQualifying(field, sequence = [0.9]) {
  const source = Object.getPrototypeOf(field).qualifyingSteps.toString(); let i = 0;
  const math = Object.create(Math); math.random = () => sequence[i++ % sequence.length];
  field.qualifyingSteps = vm.runInNewContext(`({${source}}).qualifyingSteps`, { Math: math });
  return () => i;
}
await check('N 真物理：預設1次與封存舊版完全相同，3次取最佳/進度/取消', async () => {
  const a = fieldOf(old).field, b = fieldOf().field, c = fieldOf().field;
  for (const f of [a, b, c]) f.racers = [f.racers[0], f.me];
  const ac = deterministicQualifying(a), bc = deterministicQualifying(b), cc = deterministicQualifying(c, [0.9, 0.1, 0.5]);
  const at = a.qualify().get(a.racers[0]), bt = b.qualify().get(b.racers[0]);
  assert.equal(bt, at); assert.equal(ac(), 1); assert.equal(bc(), 1);
  const progress = [], ct = (await c.qualifyAsync((n, total) => progress.push([n, total]), undefined, { attempts: 3 })).get(c.racers[0]);
  assert.equal(cc(), 3); assert.ok(Math.abs(ct - bt / 1.0024 * 0.9976) < 1e-10); assert.deepEqual(progress.at(-1), [3, 3]);
  const abort = new AbortController();
  await assert.rejects(() => c.qualifyAsync(() => abort.abort(), abort.signal, { attempts: 3 }), (e) => e.name === 'AbortError');
  assert.ok(c.qualify().get(c.racers[0]) > 0);
  return { defaultTime: bt, baselineTime: at, bestOfThree: ct, lastProgress: progress.at(-1) };
});

await check('N 真main多次排位：相同初始車況、無效耗次、最佳有效圈', () => {
  const attempts = new laps.QualifyingAttempts(3), { car } = fieldOf(), finished = [], reset = [];
  const ctx = context({ qualifyingAttempts: attempts, field: { rules: '2026' }, car, resetRace: () => { car.placeAt(env.track.buildTrack(), 1); reset.push(car.v); }, finishQuali: (t) => finished.push(t), toast() {}, fmt: String });
  loadFunctions(ctx, ['finishQualifyingAttempt']); car.v = 90; ctx.finishQualifyingAttempt(60); assert.equal(car.v, 0); assert.equal(car.energy, 1);
  ctx.finishQualifyingAttempt(null); ctx.finishQualifyingAttempt(59); assert.deepEqual(finished, [59]); assert.equal(reset.length, 2);
  assert.equal(attempts.completed, 3); attempts.add(1); assert.equal(attempts.best, 59);
});

await check('H 真安全車歷史/事件與續賽：倒退不讀未來SC，main清事件不會丟timeline', () => {
  const { field } = fieldOf(); for (let i = 0; i < 24; i++) field.update(1 / 120, true);
  const early = field.replayStateAt(0.05); assert.equal(early.sc.phase, 'off');
  field.incident(true); for (let i = 0; i < 24; i++) field.update(1 / 120, true);
  field.events.splice(0); assert.equal(field.replayEvents.length, 1); assert.equal(field.replayEvents[0].type, 'sc-out');
  const later = field.replayStateAt(0.3); assert.equal(later.sc.phase, 'out');
  assert.equal(field.replayEventsAt(0.05).length, 0); assert.equal(field.replayEventsAt(0.4).length, 1);
  field.sc.phase = 'off'; field.sc.s = 999; assert.equal(field.replayStateAt(0.3).sc.phase, 'out'); assert.equal(field.replayStateAt(0.05).sc.phase, 'off');
  later.sc.phase = 'off'; field.replayEvents[0].type = 'changed'; assert.equal(field.replayStateAt(0.3).sc.phase, 'out'); assert.equal(field.replayEvents[0].type, 'sc-out');
  const snapshot = field.snapshot(); assert.equal(field.restore(snapshot), true); assert.equal(field.replayEvents.length, 0); assert.equal(field.replayStateAt(0), null);
  return { earlySc: clone(early.sc), laterSc: clone(field.sc), restoredReplayLength: field.replayLength };
});

await check('H 輪子與真PitLane.seek：前進/倒退/重複seek結果一致，無維修音效', () => {
  const record = Array.from({ length: 101 }, () => [0, 0, 0, 0, 20]).flat(), index = replay.makeReplayWheelIndex(record);
  const angle = replay.replayWheelAngle(index, 2); replay.replayWheelAngle(index, 4); assert.equal(replay.replayWheelAngle(index, 2), angle); assert.ok(Math.abs(angle - 20 * 2 / 0.36) < 1e-10);
  const lane = Object.create(pit.PitLane.prototype), n = 11, crew = n * 15;
  const mesh = { setColorAt() {}, instanceColor: {} };
  Object.assign(lane, { active: new Set(), linger: new Float32Array(n), released: new Uint8Array(n), lastT: new Float64Array(n), pose: new Float32Array(crew * 3), yaw: new Float32Array(crew), spd: new Float32Array(crew), gait: new Float32Array(crew),
    gunEng: new Float32Array(n * 4), axle: new Uint8Array(n * 4), toolOn: new Uint8Array(n), toolLift: new Float32Array(n), tyres: new Float32Array(n * 8 * 3),
    frames: Array.from({ length: n }, () => ({ h: 0 })), sounds: [], meshes: [], sign: mesh, band: mesh, body: mesh, place() {} });
  const stop = (t) => new Map([[0, { phase: 'service', t, T: 3, slow: -1, newColor: '#ff0000', oldColor: '#ffff00', hold: false, go: false, lift: 0.22, x: 0, z: 0, model: null }]]);
  lane.seek(stop(0.6)); const early = [...lane.pose], tyres = [...lane.tyres]; lane.seek(stop(2.7)); lane.seek(stop(0.6)); assert.deepEqual([...lane.pose], early); assert.deepEqual([...lane.tyres], tyres); assert.equal(lane.sounds.length, 0);
  lane.seek(new Map()); assert.equal(lane.active.size, 0); assert.ok([...lane.toolOn].every((v) => v === 0));
});

await check('H 真main回放：seek歷史SC、輪胎絕對角度、車手跟拍與尾端保留暫停', () => {
  const { field, track } = fieldOf(); for (let i = 0; i < 24; i++) field.update(1 / 120, true); field.incident(true); for (let i = 0; i < 48; i++) field.update(1 / 120, true); field.sc.phase = 'off';
  const carModel = { root: new THREE.Group(), steer: [], spin: [new THREE.Object3D()] }, scCar = { model: { root: new THREE.Group() } };
  const ctx = context({ ...replay, field, track, replayT: 0, replaySpeed: 1, replayPaused: true, replaySeeking: true, replayLoc: new Map(), camCut: 0, camMode: 'tv',
    replayWheelIndices: new Map(field.racers.map((r) => [r, replay.makeReplayWheelIndex(r.rec)])), world: { race: { visible: false }, sky: new THREE.Object3D(), mountains: new THREE.Object3D() }, traffic: null, peds: null, playerCars: new Map(), raceHide: [],
    carModel, scCar, scLights: [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()], weather: { rainLevel: 0 }, rainTarget: 0, raceRainLevel: () => 0, applyWeather() {},
    TYRES: env.rivals.TYRES, mountedAt: pit.mountedAt, setTyre() {}, locate: env.track.locate, surfaceY: env.track.surfaceY, bankRoll: env.track.bankRoll,
    camera: new THREE.PerspectiveCamera(), tvCams: [new THREE.Vector3(0, 10, 0)], fmt: String, state: 'replay' });
  ctx.$('replay-camera').value = 'chase'; ctx.$('replay-driver').value = field.me.name;
  loadFunctions(ctx, ['replayFrame', 'seekReplay']); ctx.seekReplay(0.3); assert.equal(scCar.model.root.visible, true); const angle = carModel.spin[0].rotation.x;
  ctx.seekReplay(0.05); assert.equal(scCar.model.root.visible, false); ctx.seekReplay(0.3); assert.equal(carModel.spin[0].rotation.x, angle);
  ctx.$('replay-driver').value = field.racers[0].name; ctx.replayFrame(0); assert.ok(ctx.$('replay-time').textContent.includes(field.racers[0].name));
  ctx.replayPaused = false; ctx.replayFrame(10); assert.equal(ctx.state, 'replay'); assert.equal(ctx.replayPaused, true);
});

report.summary = { passed: report.checks.filter((r) => r.status === 'PASS').length, failed: report.checks.filter((r) => r.status === 'FAIL').length };
await writeFile(path.join(root, 'tools/dev-tests/shots-all-racing-features.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.summary.failed) process.exitCode = 1;
