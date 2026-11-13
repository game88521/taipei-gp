// 對真 main.ts AST 抽出的函式做控制流程對照；只隔離 DOM／音效／外部保存。
// node --experimental-vm-modules tools/dev-tests/main-racing-integration.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import * as THREE from 'three';
import { loadGameModules } from './racing-test-env.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const original = path.resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? path.resolve(project, '../taipei-gp-priority-before-20261111'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const env = await loadGameModules(project);
// 新功能只從目前checkout載入；before的真物理及main仍由原有env/source替換。
const featureEnv = await loadGameModules(project);
const lapFeatures = await featureEnv.exports('src/racing-laps.ts');
const replayFeatures = await featureEnv.exports('src/racing-replay.ts');
const { DriftChallenge } = await featureEnv.exports('src/drift.ts');
const pitlane = await env.exports('src/pitlane.ts');
const economy = await env.exports('src/economy.ts');
const { DriftScore } = await env.exports('src/drift.ts');
const { FreeCar } = await env.exports('src/freecar.ts');
const report = { sourceHash: '', checks: [], before: {}, after: {}, limitations: ['真main函式與真物理模組，DOM／音效／保存以記憶體隔離', '沒有操作瀏覽器、WebGL、真實localStorage或正式固定回歸'] };
async function check(label, action) { await action(); report.checks.push(label); }
async function source(root) {
  const raw = await readFile(path.join(root, 'src/main.ts'), 'utf8');
  const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
  function fn(name) {
    for (const node of ast.body) {
      if (node.type === 'FunctionDeclaration' && node.id?.name === name) return code.slice(node.start, node.end);
      if (node.type === 'VariableDeclaration') for (const d of node.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === name && d.init) return `var ${name} = ${code.slice(d.init.start, d.init.end)};`;
      }
    }
    throw new Error(`main 尚無 ${name}`);
  }
  function click(id) {
    for (const node of ast.body) {
      const e = node.type === 'ExpressionStatement' ? node.expression : null;
      if (e?.type !== 'CallExpression' || e.callee?.type !== 'MemberExpression' || e.callee.property?.name !== 'addEventListener') continue;
      const o = e.callee.object;
      if (o?.type === 'CallExpression' && o.callee?.name === '$' && o.arguments[0]?.value === id && e.arguments[0]?.value === 'click') return code.slice(e.arguments[1].start, e.arguments[1].end);
    }
    throw new Error(`main 尚無 ${id} click`);
  }
  function settingsLoop() {
    const node = ast.body.find((n) => n.type === 'ForOfStatement' && n.right.type === 'ArrayExpression' && n.right.elements.some((e) => e?.value === 'opt-rules'));
    if (!node) throw Error('main 尚無賽事設定迴圈');
    return code.slice(node.start, node.end);
  }
  function visualHud() {
    const update = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === 'updateVisuals');
    const node = update?.body.body.find((n) => n.type === 'IfStatement' && code.slice(n.start, n.end).includes("$('time').textContent"));
    if (!node) throw Error('main 尚無比賽即時 HUD');
    return code.slice(node.start, node.end);
  }
  return { fn, click, settingsLoop, visualHud, hash: createHash('sha256').update(raw).digest('hex') };
}
const current = await source(project), old = await source(original); report.sourceHash = current.hash;

function fakeElement() {
  const classes = new Set(['hidden']);
  return { hidden: false, value: '', textContent: '', innerHTML: '', className: '', style: {}, dataset: {}, children: [], listeners: new Map(),
    classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n), toggle: (n, on) => on ? classes.add(n) : classes.delete(n) },
    appendChild(x) { this.children.push(x); }, append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; },
    setAttribute() {}, removeAttribute() {}, click() {}, addEventListener(event, fn) { this.listeners.set(event, fn); }, dispatch(event) { return this.listeners.get(event)?.(); } };
}
function harness(sources = current, saved) {
  const elements = new Map(), get = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  for (const [id, value] of Object.entries({ 'opt-diff': 'normal', 'opt-rules': 'classic', 'opt-laps': '3', 'opt-tyre': '1', 'opt-gpwx': 'dry', 'opt-sc': 'normal' })) get(id).value = value;
  const track = env.track.buildTrack(), car = new env.car.Car(), field = new env.rivals.RaceField(new THREE.Scene(), track, car); field.setup(9);
  const stats = saved?.stats ?? { gpWins: 0, earned: 0, seasonsDone: 0, seasonTitles: 0, teamTitles: 0, seasonWins: 0, perfectSeason: 0 };
  const save = saved ?? { best: null, gpBest: null, sectors: [null, null, null], ghost: null, opts: {}, taxi: { money: 1000, trips: 0 },
    season: { round: 0, results: [], laps: 3, diff: 'normal', rules: 'classic', seed: 42, form: {}, no: 1 } };
  save.stats = stats;
  const storage = { writes: [], last: null }, events = { podiums: 0, errors: [], toasts: [], clockResets: 0 };
  const ctx = vm.createContext({ console: { ...console, error: (...a) => events.errors.push(a.map(String).join(' ')) }, performance, Date, Math, URLSearchParams,
    setTimeout, clearTimeout, AbortController, DOMException, location: { search: '' }, document: { title: '', createElement: fakeElement, querySelector: () => null },
    $: get, track, car, field, save, stats, storage, events, CIRCUITS: env.circuits.CIRCUITS, CIRCUIT: env.circuits.CIRCUITS[0], SEASON: true, BOT: false,
    state: 'menu', mode: 'race', raceKind: 'gp', lap: 1, lapTime: 0, lastLap: null, sectorIdx: 0, sectorStart: 0,
    sessionLaps: new lapFeatures.SessionLaps(10), lapSectors: [null, null, null], qualifyingAttempts: new lapFeatures.QualifyingAttempts(1), qualiAttemptTime: 0,
    rec: { t: [], s: [], x: [], z: [], h: [] }, recAcc: 0, ghostPtr: 0, lapValid: true, clearSectorsAt: 0, camSnap: false,
    countdown: 0, litShown: 0, lightsOutAt: 0, drsPress: false, pitPress: false, qualiRun: false, qualiGrid: null, lastGrid: null,
    strategyWet: 0, lastPos: -1, seasonGrid: [], settled: null, gpSettlementJob: null, gpRewarded: false, prizeNote: '', restoringSeason: false,
    pausedFrom: 'race', seasonPrizeText: '', opts: { quali: false, assist: false }, PLAYER_LIVERY: { main: '#ff0000' }, hud: get('hud'),
    world: { setStartLights() {}, race: { visible: true }, sky: new THREE.Object3D(), mountains: new THREE.Object3D() }, clock: { getDelta() { events.clockResets++; return 0; } },
    sound: new Proxy({}, { get: () => () => {} }), radio: { reset() {}, say() {} }, taxi: null, sr: null, police: null,
    trackStamp: () => 'track-v1', checkTrackStamp() {}, selectRecordRules() {}, setRaceRain() {}, scBanner() {}, hideMenu() {}, showMenu() {},
    userStart: async () => {}, finishDrift() {}, refreshGarage() {}, checkAchievements() {},
    abandonTaxi() {}, updateStreetSeriesUi() {}, updateActivityUi() {}, updateTaxiResumeUi() {}, renderProfileTools() {}, updatePinnedTargets() {},
    driftChallenge: new DriftChallenge(new DriftScore()),
    writeSave() { const snapshot = clone(save); storage.writes.push(snapshot); storage.last = snapshot; },
    toast: (text) => events.toasts.push(text), fmt: (n) => n == null ? '--' : String(n), fmtNT: (n) => `NT$ ${n}`, fmtDelta: (n) => String(n),
    weather: { rainLevel: 0 }, rainTarget: 0, RAIN_OMEN: 25, applyWeather() { events.weatherUpdates = (events.weatherUpdates ?? 0) + 1; },
    replayT: 0, replaySpeed: 1, replayPaused: false, replaySeeking: false, replayWheelIndices: new Map(), camCut: 99, camMode: 'chase', replayLoc: new Map(), ...replayFeatures,
    scCar: { model: { root: new THREE.Group() } }, scLights: [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()],
    carModel: { root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: Array.from({ length: 4 }, () => new THREE.Object3D()) },
    ghostModel: { root: new THREE.Group() }, playerCars: new Map(), raceHide: [], traffic: null, peds: null,
    camera: new THREE.PerspectiveCamera(), tvCams: [new THREE.Vector3(0, 10, 0)],
    TYRES: env.rivals.TYRES, mountedAt: pitlane.mountedAt, locate: env.track.locate, surfaceY: env.track.surfaceY, bankRoll: env.track.bankRoll,
    setTyre(model, color) { model.lastTyreColor = color; },
    cityReady: true, selectedRecordRules: () => field.rules, legacyBestLapOf: () => null, validFreePos: () => false,
    updateLastTaxiTrip() {}, updateEconomyUi() {}, updateSeasonUi() {}, menu: get('menu'), ...economy,
    warnText: '', toastUntil: 0, deltaAcc: 0, deltaHoldUntil: 0, ghostTimeAt: () => null, gearOf: () => ({ n: 1 }),
    updateGpHud() { events.gpHud = (events.gpHud ?? 0) + 1; },
    ...env.season, teamOf: (name) => field.racers.find((r) => r.name === name)?.team ?? '', withPersona: (r) => r.name,
    startPodium() { events.podiums++; ctx.settleRace(); ctx.state = 'podium'; },
    botInput: () => ({ steer: 0, brake: false }), input: { read: () => ({ steer: 0, brake: false }) }, SC_AT: null, gpEvent() {},
  });
  const names = ['recordSessionLap', 'renderSessionLaps', 'finishQualifyingAttempt', 'resetRace', 'startLap', 'sectorDone', 'completeLap', 'beginCountdown', 'startTt', 'startGp', 'saveSeasonCheckpoint', 'restoreSeasonCheckpoint',
    'settleAbandoned', 'finishRound', 'recordSeason', 'rewardGpFinish', 'settleRace', 'completeGpResults', 'showResults', 'pause', 'money', 'setMoney', 'earn', 'step',
    'inSeasonRound', 'seasonDone', 'resumeSeasonRound', 'raceRainLevel', 'setRaceRain', 'startReplay', 'endReplay', 'replayFrame'];
  for (const name of names) { try { vm.runInContext(sources.fn(name), ctx); } catch (e) { if (sources !== old && !['recordSessionLap', 'renderSessionLaps', 'finishQualifyingAttempt'].includes(name)) throw e; } }
  if (sources === current) vm.runInContext(`var exitGpSettlement = ${sources.click('gp-settle-exit')};`, ctx);
  return { ctx, get, storage, events, field, car, track };
}
async function until(test) { const limit = Date.now() + 5000; while (!test()) { if (Date.now() > limit) throw Error('等待狀態逾時'); await new Promise((r) => setTimeout(r, 5)); } }
function allFinished(h, meTime = 60) { h.field.raceTime = meTime; h.field.me.finish = meTime; h.field.me.laps = 4; for (const r of h.field.racers) if (!r.isPlayer) { r.finish = meTime; r.laps = 4; } h.field.me.finish = meTime - 1; }

await check('真step最後圈：舊版漏存60，新版存49+dt；平常完整圈仍保存', async () => {
  function lastLap(sources) {
    const h = harness(sources); h.ctx.BOT = true; h.ctx.state = 'race'; h.ctx.lapTime = 49; h.ctx.save.gpBest = 60;
    h.ctx.car.pos.s = h.track.length - 1; h.ctx.car.update = () => { h.ctx.car.pos.s = 1; return 0; };
    h.ctx.field = { me: { pit: null }, racers: [{ isPlayer: true, finish: null }], drsZoneAt: () => -1, playerDrs() {}, update: () => 0, events: [],
      playerLap() { this.racers[0].finish = 150; } };
    h.ctx.showResults = () => { h.ctx.state = 'results'; }; h.ctx.step(1 / 120); return h.ctx.save.gpBest;
  }
  report.before.finalLapBest = lastLap(old); report.after.finalLapBest = lastLap(current);
  assert.equal(report.before.finalLapBest, 60); assert.equal(report.after.finalLapBest, 49 + 1 / 120);
  const regular = harness(); regular.ctx.lapTime = 55; regular.ctx.save.gpBest = 60; regular.ctx.completeLap(); assert.equal(regular.ctx.save.gpBest, 55);
});

await check('真completeLap排位無效圈不finishQuali、不更新或上傳；下一圈有效可完成', async () => {
  const h = harness(); h.ctx.CIRCUIT = null; h.ctx.raceKind = 'tt'; h.ctx.state = 'race'; h.ctx.qualiRun = true;
  h.ctx.save.best = 60; h.ctx.save.sectors = [20, 20, 20]; h.ctx.save.ghost = { t: [0, 60], s: [0, 100], x: [0, 1], z: [0, 1], h: [0, 0] };
  const originalRecord = clone({ best: h.ctx.save.best, sectors: h.ctx.save.sectors, ghost: h.ctx.save.ghost });
  const finishes = [], uploads = []; h.ctx.finishQuali = (t) => finishes.push(t); h.ctx.submitLap = async (t) => uploads.push(t);
  h.ctx.askPersist = async () => { throw Error('無效排位不能要求保存新紀錄'); };
  h.ctx.lapTime = 40; h.ctx.lapValid = false; h.ctx.completeLap();
  assert.equal(finishes.length, 0); assert.equal(uploads.length, 0); assert.equal(h.ctx.qualiRun, true); assert.equal(h.ctx.state, 'race');
  assert.equal(h.ctx.lapValid, true); assert.equal(h.ctx.lapTime, 0); assert.equal(h.storage.writes.length, 0);
  assert.deepEqual(clone({ best: h.ctx.save.best, sectors: h.ctx.save.sectors, ghost: h.ctx.save.ghost }), originalRecord);
  h.ctx.lapTime = 45; h.ctx.completeLap(); assert.deepEqual(finishes, [45]); assert.equal(uploads.length, 0);
});

await check('真completeLap計時無效圈：舊版會存40並上傳，新版保留60且不上傳', async () => {
  function invalidLap(sources) {
    const h = harness(sources); h.ctx.CIRCUIT = null; h.ctx.raceKind = 'tt'; h.ctx.state = 'race'; h.ctx.qualiRun = false;
    h.ctx.save.best = 60; h.ctx.save.sectors = [20, 20, 20]; h.ctx.save.ghost = { t: [0, 60], s: [0, 100], x: [0, 1], z: [0, 1], h: [0, 0] };
    const record = clone({ sectors: h.ctx.save.sectors, ghost: h.ctx.save.ghost }), uploads = [];
    h.ctx.submitLap = async (t) => uploads.push(t); h.ctx.askPersist = async () => {};
    h.ctx.startLap(); h.ctx.lapTime = 40; h.ctx.sectorStart = 35; h.ctx.lapValid = false; h.ctx.completeLap();
    return { h, uploads, record };
  }
  const before = invalidLap(old), after = invalidLap(current);
  assert.equal(before.h.ctx.save.best, 40); assert.deepEqual(before.uploads, [40]);
  assert.equal(after.h.ctx.save.best, 60); assert.equal(after.uploads.length, 0); assert.equal(after.h.storage.writes.length, 0);
  assert.deepEqual(clone({ sectors: after.h.ctx.save.sectors, ghost: after.h.ctx.save.ghost }), after.record);
  assert.equal(after.h.ctx.lapValid, true); assert.equal(after.h.ctx.lapTime, 0);
  report.before.invalidTtBest = 40; report.after.invalidTtBest = 60;
});

await check('真sectorDone無效圈不寫三分段；有效計時圈仍保存最佳並上傳', async () => {
  const h = harness(); h.ctx.CIRCUIT = null; h.ctx.raceKind = 'tt'; h.ctx.save.sectors = [20, 20, 20]; h.ctx.lapValid = false;
  for (let k = 0; k < 3; k++) h.ctx.sectorDone(k, 5); assert.deepEqual(clone(h.ctx.save.sectors), [20, 20, 20]);
  h.ctx.lapValid = true; h.ctx.sectorDone(0, 18); assert.equal(h.ctx.save.sectors[0], 18);
  const uploads = []; let persist = 0; h.ctx.submitLap = async (t) => uploads.push(t); h.ctx.askPersist = async () => persist++;
  h.ctx.startLap(); h.ctx.lapTime = 50; h.ctx.sectorStart = 35; h.ctx.completeLap();
  assert.equal(h.ctx.save.best, 50); assert.deepEqual(uploads, [50]); assert.equal(persist, 1); assert.equal(h.ctx.save.sectors[2], 15);
});

await check('真GP無效圈不更新本地PB：普通圈舊40覆蓋60，新版保留60；最後圈同樣保護', async () => {
  const oldGp = harness(old); oldGp.ctx.lapTime = 40; oldGp.ctx.lapValid = false; oldGp.ctx.save.gpBest = 60; oldGp.ctx.completeLap();
  assert.equal(oldGp.ctx.save.gpBest, 40);
  const h = harness(); h.ctx.lapTime = 40; h.ctx.lapValid = false; h.ctx.save.gpBest = 60; h.ctx.completeLap();
  assert.equal(h.ctx.save.gpBest, 60); assert.equal(h.ctx.lapValid, true);
  const final = harness(); final.ctx.BOT = true; final.ctx.state = 'race'; final.ctx.lapTime = 39; final.ctx.lapValid = false; final.ctx.save.gpBest = 60;
  final.ctx.car.pos.s = final.track.length - 1; final.ctx.car.update = () => { final.ctx.car.pos.s = 1; return 0; };
  final.ctx.field = { me: { pit: null }, racers: [{ isPlayer: true, finish: null }], drsZoneAt: () => -1, playerDrs() {}, update: () => 0, events: [],
    playerLap() { this.racers[0].finish = 150; } };
  let finishes = 0; final.ctx.showResults = () => { finishes++; final.ctx.state = 'results'; }; final.ctx.step(1 / 120);
  assert.equal(final.ctx.save.gpBest, 60); assert.equal(finishes, 1, '無效圈只影響本地PB，不影響完賽');
});

await check('真updateVisuals即時HUD顯示無效圈、有效圈可清除；倒數／TT／GP均不改物理或圈時', async () => {
  const h = harness(), hud = current.visualHud();
  h.ctx.lapTime = 37.25; h.ctx.lap = 2; h.ctx.lapValid = false; h.car.energy = 0.43;
  h.field.me.wear = 0.34; h.field.raceTime = 71.5;
  for (const state of ['race', 'countdown']) for (const raceKind of ['tt', 'gp']) {
    h.ctx.state = state; h.ctx.raceKind = raceKind;
    const physical = clone({ race: h.field.snapshot(), car: h.car.snapshot(), lap: h.ctx.lap, lapTime: h.ctx.lapTime, lapValid: h.ctx.lapValid });
    vm.runInContext(`{ const dt = 1 / 60; ${hud} }`, h.ctx);
    assert.equal(h.get('time').textContent, '37.25 · 無效圈');
    assert.equal(h.get('time').title, '本圈使用重置／扶正，不更新個人紀錄');
    assert.equal(h.get('time').classList.contains('invalid-lap'), true);
    assert.deepEqual(clone({ race: h.field.snapshot(), car: h.car.snapshot(), lap: h.ctx.lap, lapTime: h.ctx.lapTime, lapValid: h.ctx.lapValid }), physical);
  }
  assert.equal(h.events.gpHud, 2); assert.equal(h.storage.writes.length, 0);
  h.ctx.lapValid = true;
  const physical = clone(h.field.snapshot()); vm.runInContext(`{ const dt = 1 / 60; ${hud} }`, h.ctx);
  assert.equal(h.get('time').textContent, '37.25'); assert.equal(h.get('time').classList.contains('invalid-lap'), false);
  assert.equal(h.get('time').title, '本圈可更新個人紀錄'); assert.deepEqual(clone(h.field.snapshot()), physical);
});

await check('真beginCountdown建立完整初始checkpoint；倒數重載不誤算DNF', async () => {
  const h = harness(); h.ctx.beginCountdown(); const cp = h.storage.last.season.pending.checkpoint;
  assert.ok(cp); assert.equal(cp.race.raceTime, 0); assert.equal(cp.race.scChance, 0.6); assert.equal(h.storage.last.season.pending.elapsed, 0);
  const reload = harness(current, clone(h.storage.last)); reload.ctx.settleAbandoned(); assert.equal(reload.ctx.save.season.round, 0); assert.ok(reload.ctx.save.season.pending.checkpoint);
  await reload.ctx.restoreSeasonCheckpoint(); assert.equal(reload.ctx.state, 'race'); assert.equal(reload.field.raceTime, 0);
});

await check('真pause保存全場，重載復原胎況／電量／圈時計時且不提前記成績', async () => {
  const h = harness(); h.ctx.beginCountdown(); h.ctx.state = 'race'; h.field.raceTime = 32.5; h.field.me.laps = 2;
  h.car.energy = 0.37; h.field.me.wear = 0.44; h.ctx.lap = 2; h.ctx.lapTime = 11; h.ctx.sectorIdx = 1; h.ctx.sectorStart = 9;
  h.ctx.pause(); assert.equal(h.ctx.state, 'paused'); assert.equal(h.storage.last.season.pending.elapsed, 32.5);
  const reload = harness(current, clone(h.storage.last)); await reload.ctx.restoreSeasonCheckpoint();
  assert.equal(reload.ctx.state, 'race'); assert.equal(reload.field.raceTime, 32.5); assert.equal(reload.car.energy, 0.37); assert.equal(reload.field.me.wear, 0.44);
  assert.equal(reload.ctx.lapTime, 11); assert.equal(reload.ctx.sectorStart, 9); assert.equal(reload.ctx.save.season.results.length, 0);
});

await check('真GP檢查點／重載保留invalid，無效圈不能藉續賽變有效；舊檢查點預設true', async () => {
  const h = harness(); h.ctx.beginCountdown(); h.ctx.state = 'race'; h.field.raceTime = 32; h.ctx.lapTime = 12; h.ctx.lapValid = false;
  h.ctx.pause(); assert.equal(h.storage.last.season.pending.checkpoint.player.lapValid, false);
  const reload = harness(current, clone(h.storage.last)); await reload.ctx.restoreSeasonCheckpoint();
  assert.equal(reload.ctx.lapValid, false); reload.ctx.save.gpBest = 60; reload.ctx.lapTime = 40; reload.ctx.completeLap(); assert.equal(reload.ctx.save.gpBest, 60);
  const legacySave = clone(h.storage.last); delete legacySave.season.pending.checkpoint.player.lapValid;
  const legacy = harness(current, legacySave); legacy.ctx.lapValid = false; await legacy.ctx.restoreSeasonCheckpoint(); assert.equal(legacy.ctx.lapValid, true);
});

await check('真startTt：先保留GP檢查點，再清尾流／安全車限速', async () => {
  const h = harness(); h.ctx.beginCountdown(); h.ctx.state = 'race'; h.field.raceTime = 25; h.car.boost = 0.05; h.car.speedCap = 40; h.car.energy = 0.2;
  await h.ctx.startTt(); assert.equal(h.ctx.raceKind, 'tt'); assert.equal(h.car.boost, 0); assert.equal(h.car.speedCap, Infinity); assert.equal(h.car.energy, 1);
  assert.equal(h.ctx.save.season.pending.checkpoint.race.racers.find((r) => r.name === '你').car.speedCap, 40);
  await h.ctx.restoreSeasonCheckpoint(); assert.equal(h.ctx.raceKind, 'gp'); assert.equal(h.car.speedCap, 40); assert.equal(h.car.energy, 0.2);
});

await check('真棄賽寬限按elapsed；單純牆鐘等待不扣站', async () => {
  const h = harness(); h.ctx.save.season.pending = { id: 'australia', grid: h.field.racers.map((r) => r.name), at: 0, elapsed: 0 };
  h.ctx.settleAbandoned(); assert.equal(h.ctx.save.season.round, 0);
  h.ctx.save.season.pending = { id: 'australia', grid: h.field.racers.map((r) => r.name), at: Date.now(), elapsed: 21 };
  h.ctx.settleAbandoned(); assert.equal(h.ctx.save.season.round, 1); assert.equal(h.ctx.save.season.results[0].dnf[0], '你');
});

await check('真rewardGpFinish即保存錢／勝場／rewarded，重複呼叫不加發', async () => {
  const h = harness(); h.ctx.beginCountdown(); allFinished(h); h.ctx.rewardGpFinish(); h.ctx.rewardGpFinish();
  assert.equal(h.ctx.save.taxi.money, 2500); assert.equal(h.ctx.stats.gpWins, 1); assert.equal(h.storage.last.taxi.money, 2500);
  assert.equal(h.storage.last.stats.gpWins, 1); assert.equal(h.storage.last.season.pending.rewarded, true);
  report.after.finishReward = h.storage.last.taxi.money;
});

await check('真玩家已完賽重載：續算後只記一站、不重發獎；反覆成績頁亦不重發', async () => {
  const h = harness(); h.ctx.beginCountdown(); allFinished(h); h.ctx.rewardGpFinish();
  const reload = harness(current, clone(h.storage.last)); await reload.ctx.restoreSeasonCheckpoint();
  await until(() => reload.ctx.state === 'podium' && reload.ctx.gpSettlementJob === null);
  assert.equal(reload.ctx.save.taxi.money, 2500); assert.equal(reload.ctx.stats.gpWins, 1); assert.equal(reload.ctx.save.season.results.length, 1);
  reload.ctx.settleRace(); reload.ctx.showResults(); reload.ctx.showResults();
  assert.equal(reload.ctx.save.taxi.money, 2500); assert.equal(reload.ctx.save.season.results.length, 1); assert.equal(reload.ctx.stats.gpWins, 1);
});

await check('真背景結算中退出／重試／重複呼叫：沒有幽靈工作或重複發獎／記站', async () => {
  const h = harness(); h.ctx.beginCountdown(); h.ctx.state = 'race'; h.field.raceTime = 60; h.field.me.finish = 59; h.field.me.laps = 4;
  const real = h.field.finishRemainderAsync.bind(h.field); let calls = 0, exited = false;
  h.field.finishRemainderAsync = (options) => { calls++; return real({ ...options, onProgress(p) { options.onProgress?.(p); if (!exited) { exited = true; h.ctx.exitGpSettlement(); } } }); };
  await Promise.all([h.ctx.completeGpResults(), h.ctx.completeGpResults()]);
  assert.equal(calls, 1); assert.equal(exited, true); assert.equal(h.ctx.state, 'menu'); assert.equal(h.ctx.gpSettlementJob, null); assert.equal(h.field.completing, false);
  assert.equal(h.field.racers.some((r) => r.dnf), false); const money = h.ctx.save.taxi.money;
  allFinished(h, h.field.raceTime); h.field.finishRemainderAsync = real; await h.ctx.completeGpResults();
  assert.equal(h.ctx.gpSettlementJob, null); assert.equal(h.ctx.save.season.results.length, 1); assert.equal(h.ctx.save.taxi.money, money); assert.equal(h.ctx.stats.gpWins, 1);
});

await check('真背景結算失敗可重試，已發獎與季進度保持一致', async () => {
  const h = harness(); h.ctx.beginCountdown(); allFinished(h);
  const real = h.field.finishRemainderAsync.bind(h.field); h.field.finishRemainderAsync = async () => { throw Error('隔離注入：結算失敗'); };
  await h.ctx.completeGpResults(); assert.equal(h.get('gp-settle-retry').hidden, false); assert.equal(h.ctx.gpSettlementJob, null);
  assert.equal(h.ctx.save.taxi.money, 2500); assert.equal(h.ctx.save.season.results.length, 0);
  h.field.finishRemainderAsync = real; await h.ctx.completeGpResults(); assert.equal(h.ctx.save.taxi.money, 2500); assert.equal(h.ctx.save.season.results.length, 1);
});

await check('真復原驗證失敗保留有效賽季與現場，解除restoring鎖', async () => {
  const h = harness(); h.ctx.beginCountdown(); h.ctx.save.season.pending.checkpoint.trackV = 'other-track'; h.ctx.state = 'menu';
  const unchanged = clone(h.field.snapshot()); await h.ctx.restoreSeasonCheckpoint();
  assert.deepEqual(clone(h.field.snapshot()), unchanged); assert.equal(h.ctx.state, 'menu'); assert.equal(h.ctx.restoringSeason, false); assert.equal(h.ctx.save.season.round, 0);
});

await check('真規則設定callback與showMenu：賽事暫停禁止改規則，選單可切換', async () => {
  const h = harness(); h.ctx.beginCountdown(); vm.runInContext(current.settingsLoop(), h.ctx);
  vm.runInContext(current.fn('showMenu'), h.ctx);
  const rules = h.get('opt-rules'); h.ctx.state = 'paused'; h.ctx.mode = 'race'; h.ctx.showMenu(true);
  assert.equal(rules.disabled, true); const oldSaved = h.ctx.save.opts['opt-rules'];
  rules.value = '2026'; rules.dispatch('change'); assert.equal(rules.value, 'classic'); assert.equal(h.ctx.save.opts['opt-rules'], oldSaved);
  h.ctx.state = 'menu'; h.ctx.showMenu(false); assert.equal(rules.disabled, false);
  rules.value = '2026'; rules.dispatch('change'); assert.equal(h.ctx.save.opts['opt-rules'], '2026');
});

await check('真回放早期乾地／晚期雨胎、抬升與crew來自歷史，未覆寫最終物理', async () => {
  const h = harness(); h.ctx.beginCountdown(); h.field.playerModel = h.ctx.carModel;
  for (let i = 0; i < 12; i++) h.field.update(1 / 120, true);
  h.field.wet = 0.8; h.field.rainAt = 0; h.field.me.compound = 1;
  h.field.me.pit = { ph: 'box', sd: 0, v: 0, entry: 4, exit: 4, t: 1, T: 3, slow: -1, next: 3, box: 0, team: 0 };
  for (let i = 0; i < 12; i++) h.field.update(1 / 120, true);
  h.field.me.pit.t = 2.6;
  for (let i = 0; i < 12; i++) h.field.update(1 / 120, true);
  h.field.me.compound = 2; h.field.me.pit = null; h.field.wet = 1;
  h.field.pitlane = { update(dt, stops) { h.events.crew = { dt, stops }; }, seek(stops) { this.update(0, stops); } };
  const final = clone(h.field.snapshot()); h.ctx.weather.rainLevel = 1;
  h.ctx.startReplay(); h.ctx.replayT = 0; h.ctx.replayFrame(0); assert.equal(h.ctx.weather.rainLevel, 0);
  h.ctx.replayT = 0.15; h.ctx.replayFrame(0);
  assert.ok(h.ctx.weather.rainLevel > 0.8 && h.ctx.weather.rainLevel < 0.95);
  assert.equal(h.ctx.carModel.lastTyreColor, env.rivals.TYRES[1].color); assert.ok(h.ctx.carModel.root.position.y > 0);
  assert.equal(h.events.crew.stops.get(0).phase, 'service');
  h.ctx.replayT = 0.2; h.ctx.replayFrame(0);
  assert.equal(h.ctx.carModel.lastTyreColor, env.rivals.TYRES[3].color, '新輪裝回後、放行前即顯示新胎');
  assert.deepEqual(clone(h.field.snapshot()), final);
});

await check('真endReplay中途退出：清除拆輪縮放／crew狀態，復原最終胎色與雨勢', async () => {
  const h = harness(); h.ctx.beginCountdown(); h.field.wet = 0.7; h.field.rainAt = 0; h.field.me.compound = 2;
  h.field.racers[0].model.spin = [new THREE.Object3D()];
  for (const w of [...h.ctx.carModel.spin, ...h.field.racers[0].model.spin]) w.scale.setScalar(1e-4);
  h.ctx.carModel.lastTyreColor = env.rivals.TYRES[3].color; h.ctx.weather.rainLevel = 0;
  h.field.pitlane = { update(dt, stops) { h.events.crew = { dt, stops }; }, seek(stops) { this.update(0, stops); } };
  const final = clone(h.field.snapshot()); h.ctx.state = 'replay'; h.ctx.endReplay();
  assert.equal(h.ctx.state, 'results'); assert.equal(h.ctx.carModel.lastTyreColor, env.rivals.TYRES[2].color);
  for (const w of [...h.ctx.carModel.spin, ...h.field.racers[0].model.spin]) assert.equal(w.scale.x, 1);
  assert.equal(h.events.crew.stops.size, 0); assert.equal(h.ctx.weather.rainLevel, 0.3 + 0.7 * 0.7);
  assert.deepEqual(clone(h.field.snapshot()), final);
});

await check('真甩尾練習提示不改側滑／計分，關閉提示可繼續；換模式入帳一次並清提示', () => {
  const h = harness(), drift = new DriftScore(), control = new DriftScore(), fcar = new FreeCar();
  fcar.vx = 8; fcar.vz = 15; h.ctx.fcar = fcar; h.ctx.drift = drift; h.ctx.mode = 'free';
  h.ctx.driftPractice = true; h.ctx.driftPracticeNote = ''; h.ctx.stats.bestDrift = 0; h.ctx.stats.totalDrift = 0;
  for (const name of ['updateDriftHud', 'bankDrift', 'finishDrift']) vm.runInContext(current.fn(name), h.ctx);
  vm.runInContext(`var exitCoach = ${current.click('coach-exit')};`, h.ctx);
  const physical = clone(fcar);
  for (let i = 0; i < 360; i++) {
    control.update(1 / 120, fcar, 0); drift.update(1 / 120, fcar, 0); h.ctx.updateDriftHud();
  }
  assert.deepEqual(clone(drift), clone(control)); assert.deepEqual(clone(fcar), physical);
  assert.match(h.get('coach-status').textContent, /✓ 速度/); assert.match(h.get('coach-status').textContent, /✓ 側滑角/);
  assert.equal(h.get('drift-coach').classList.contains('hidden'), false); assert.equal(h.storage.writes.length, 0);
  const scoreBefore = drift.total; h.ctx.exitCoach(); assert.equal(h.ctx.driftPractice, false);
  assert.equal(drift.total, scoreBefore); assert.equal(drift.active, true); assert.equal(h.get('drift-coach').classList.contains('hidden'), true);
  h.ctx.driftPractice = true; const cash = Math.floor(scoreBefore / 100);
  h.ctx.finishDrift('bank'); h.ctx.finishDrift('bank');
  assert.equal(h.ctx.save.taxi.money, 1000 + cash); assert.equal(h.ctx.stats.totalDrift, scoreBefore);
  assert.equal(h.ctx.stats.bestDrift, scoreBefore); assert.equal(h.ctx.save.ledger.length, 1); assert.equal(h.ctx.save.ledger[0].reason, '甩尾入帳');
  assert.equal(h.ctx.driftPractice, false); assert.equal(drift.active, false); assert.equal(drift.total, 0);
  assert.equal(h.get('drift-coach').classList.contains('hidden'), true); assert.deepEqual(clone(fcar), physical);
});

report.ok = true;
await writeFile(path.join(project, 'tools/dev-tests/main-racing-integration-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
