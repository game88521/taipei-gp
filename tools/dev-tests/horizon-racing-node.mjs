import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { parseAst } from 'rolldown/parseAst';
import * as THREE from 'three';
import { pureUrl } from './pure-module-loader.mjs';
import { loadGameModules } from './racing-test-env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(root, '../taipei-gp-horizon-before-b1f70bac2788');
const model = await import(await pureUrl(root, 'horizon-racing.ts'));
const practice = await import(await pureUrl(root, 'tt-practice.ts'));
const baselinePractice = await import(await pureUrl(before, 'tt-practice.ts'));
const env = await loadGameModules(root, { random: () => .5 });
const track = env.track.buildTrack(), cases = [], clone = value => JSON.parse(JSON.stringify(value));
const code = stripTypeScriptTypes(await readFile(path.join(root, 'src/main.ts'), 'utf8'), { mode: 'transform' });
const ast = parseAst(code), fn = name => { const n = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); assert.ok(n, name); return code.slice(n.start, n.end); };
async function test(name, run) { const started = performance.now(), details = await run(); cases.push({ name, status: 'PASS', details, elapsedMs: Math.round(performance.now() - started) }); console.log('PASS', name); }
const config = { trackId: 'taipei', trackV: 'fixture-track', sprintLaps: 1, raceLaps: 3, difficulty: 'normal', rules: 'classic', weather: 'dry', tyre: 1 };
const makeField = () => new env.rivals.RaceField(new THREE.Scene(), track, new env.car.Car());
const names = clone(makeField().racers.map(r => r.name));
const qualifying = names.map((name, i) => ({ name, time: 60 + i }));
const raceResults = (order = names, seconds = 100) => order.map((name, i) => ({ name, finish: seconds + i, dnf: false }));
function bot(car) { const i = car.pos.i, j = (i + Math.round((8 + car.v * .45) / track.ds)) % track.N, ahead = (i + Math.round(car.v * .5 / track.ds)) % track.N; let e = Math.atan2(track.px[j] - car.x, track.pz[j] - car.z) - car.h; e = Math.atan2(Math.sin(e), Math.cos(e)); return { steer: Math.max(-1, Math.min(1, -e * 2.5)), brake: car.v > track.vTarget[ahead] + 1 }; }
await test('before 對照：PracticeRun 原本沒有可駕駛倒帶 snapshot/restore', () => { const p = new baselinePractice.PracticeRun(track.length); assert.equal(typeof p.snapshot, 'undefined'); assert.equal(typeof p.restore, 'undefined'); });
await test('倒帶不足秒數拒絕、100ms取樣、十秒與102筆雙重上限', () => { const ring = new model.PracticeRewind(); const frame = () => ({ car: { v: 1 }, practice: {}, lapTime: 0, lapValid: true }); ring.capture(0, frame); assert.equal(ring.rewind(3), null); for (let i = 0; i < 120 * 30; i++) ring.capture(1 / 120, frame); assert.ok(ring.size <= 102); assert.ok(ring.duration <= 10.000001); assert.ok(ring.canRewind(5)); ring.clear(); assert.equal(ring.size, 0); assert.equal(ring.canRewind(3), false); });
await test('真Car與PracticeRun：回五秒精確還原全車況/時間/距離，再跑同段逐欄一致', () => {
  const car = new env.car.Car(); car.placeAt(track, 40); car.v = 40;
  const p = new practice.PracticeRun(track.length), ring = new model.PracticeRewind(); p.start({ segment: { id: 'lap', label: '圈', start: car.pos.s, length: track.length }, flying: true, targetTime: 100, targetExit: 150 }, car.pos.s, car.v);
  const capture = () => ({ car: car.snapshot(), practice: p.snapshot(), lapTime: p.status.elapsed, lapValid: true }); ring.capture(0, capture);
  const step = () => { const inp = bot(car); car.update(1 / 120, track, inp.steer, inp.brake); p.update(1 / 120, car.pos.s, car.v, true); ring.capture(1 / 120, capture); };
  for (let i = 0; i < 120 * 8; i++) step(); const original = clone(capture()), frame = ring.rewind(5); assert.ok(frame); assert.ok(Math.abs(frame.lapTime - 3) < .0001);
  car.restore(frame.car); p.restore(frame.practice); for (let i = 0; i < 120 * 5; i++) step(); assert.deepEqual(clone(capture()), original);
  const a = ring.rewind(3); assert.ok(a); assert.ok(ring.duration < 8); a.car.v = 999; assert.notEqual(ring.rewind(3)?.car.v, 999);
});
await test('練習無效標記、approach及完成結果隨snapshot還原，不污染原snapshot', () => { const p = new practice.PracticeRun(1000); const cfg = { segment: { id: 's', label: '段', start: 100, length: 100 }, flying: true, targetTime: 30, targetExit: 10 }; p.start(cfg, 0, 10); p.update(5, 50, 10, true); const approach = p.snapshot(); p.update(6, 110, 10, false); const invalid = p.snapshot(); assert.equal(p.snapshot().valid, false); p.restore(approach); assert.equal(p.snapshot().valid, true); assert.equal(p.status.approach, true); p.restore(invalid); p.update(10, 210, 10, false); assert.equal(p.result.valid, false); p.restore(approach); assert.equal(p.result, null); assert.equal(p.running, true); p.config.segment.label = 'modified'; assert.equal(approach.config.segment.label, '段'); });
await test('週末排位有效圈優先、同秒原車手序，無有效圈排後，結果必須全22人', () => { const w = model.newWeekend(config, names, 'w', 1); const times = qualifying.map(x => ({ ...x, time: 60 })); times[0].time = null; assert.equal(model.weekendQualifying(w, times.slice(1)), false); assert.equal(model.weekendQualifying(w, times), true); assert.equal(w.qualifying[0].name, names[1]); assert.equal(w.qualifying.at(-1).name, names[0]); assert.equal(w.stage, 'sprint'); assert.equal(model.weekendQualifying(w, times), false); });
await test('衝刺8..1、GP25..1、DNF零分、兩節獨立且重複提交不加分', () => { const w = model.newWeekend(config, names, 'score', 1); model.weekendQualifying(w, qualifying); const sprint = raceResults(); sprint[0] = { name: names[0], finish: null, dnf: true }; assert.equal(model.weekendFinish(w, 'race', raceResults()), false); assert.equal(model.weekendFinish(w, 'sprint', sprint), true); assert.equal(model.weekendFinish(w, 'sprint', sprint), false); assert.equal(model.weekendStandings(w).find(r => r.name === names[1]).points, 8); assert.equal(model.weekendStandings(w).find(r => r.name === names[0]).points, 0); model.weekendFinish(w, 'race', raceResults()); assert.equal(model.weekendStandings(w).find(r => r.name === names[0]).gp, 25); assert.equal(model.weekendStandings(w).find(r => r.name === names[1]).points, 26); assert.equal(w.stage, 'complete'); });
await test('兩場同完賽秒數依排位，同積分按GP/衝刺/排位，不依顯示名或隨機', () => { const w = model.newWeekend(config, names, 'tie', 1); model.weekendQualifying(w, qualifying); const result = names.slice().reverse().map(name => ({ name, finish: 100, dnf: false })); model.weekendFinish(w, 'sprint', result); model.weekendFinish(w, 'race', result); assert.deepEqual(w.sprint.map(r => r.name), names); assert.deepEqual(w.race.map(r => r.name), names); assert.equal(model.weekendStandings(w)[0].points, 33); });
await test('站間JSON續賽保留排位/積分，歷史idempotent且最多十個週末', () => { const data = { version: 1, history: [], weekend: model.newWeekend(config, names, 'reload', 1) }; model.weekendQualifying(data.weekend, qualifying); model.weekendFinish(data.weekend, 'sprint', raceResults()); const loaded = model.parseHorizonRacing(clone(data)); assert.equal(loaded.weekend.stage, 'race'); assert.equal(model.weekendStandings(loaded.weekend)[0].points, 8); model.weekendFinish(loaded.weekend, 'race', raceResults()); for (let i = 0; i < 15; i++) { loaded.weekend.id = 'history-' + i; model.archiveWeekend(loaded); model.archiveWeekend(loaded); } assert.equal(loaded.history.length, 10); assert.equal(new Set(loaded.history.map(h => h.id)).size, 10); assert.equal(loaded.history[0].rows[0].points, 33); assert.deepEqual(model.parseHorizonRacing(clone(loaded)), loaded); });
await test('匯入嚴格拒絕不完整節次/重複車手/非有限數/偽造checkpoint，parser不throw', async () => {
  const data = { version: 1, history: [], weekend: model.newWeekend(config, names, 'bad', 1) };
  const priorModel = await import(await pureUrl(path.resolve(root, '../taipei-gp-horizon-racing'), 'horizon-racing.ts'));
  const arrayRule = clone(data); arrayRule.weekend.config.rules = ['classic']; assert.ok(priorModel.parseHorizonRacing(arrayRule));
  for (const mutate of [x => x.weekend.stage = 'race', x => x.weekend.stage = ['qualifying'], x => x.weekend.names[0] = x.weekend.names[1], x => x.weekend.config.sprintLaps = '1', x => x.weekend.config.rules = ['classic'], x => x.weekend.config.weather = ['dry'], x => x.weekend.config.difficulty = ['normal'], x => x.weekend.at = Infinity, x => x.weekend.qualifying = [null], x => x.weekend.checkpoint = { stage: 'sprint', race: {} }, x => x.history = [{ id: 'bad' }]]) {
    const copy = clone(data); mutate(copy); assert.doesNotThrow(() => model.parseHorizonRacing(copy)); assert.equal(model.parseHorizonRacing(copy), undefined);
  }
  model.weekendQualifying(data.weekend, qualifying); model.weekendFinish(data.weekend, 'sprint', raceResults()); model.weekendFinish(data.weekend, 'race', raceResults()); model.archiveWeekend(data);
  for (const mutate of [x => x.history[0].sprintLaps = '1', x => x.history[0].raceLaps = '3', x => x.history.push(clone(x.history[0]))]) { const copy = clone(data); mutate(copy); assert.equal(model.parseHorizonRacing(copy), undefined); }
});
await test('真RaceField checkpoint/restore保存安全車/胎況/seed/全22車、顯式恢復safe-v1', () => { const field = makeField(); field.setup(9, 1, 1); field.aiPolicy = 'safe-v1'; for (let i = 0; i < 1200; i++) field.update(1 / 120, true); const w = model.newWeekend(config, names, 'cp', 1); model.weekendQualifying(w, qualifying); w.checkpoint = { stage: 'sprint', race: clone(field.snapshot()), aiPolicy: 'safe-v1', player: { lapTime: 10, sectorIdx: 0, sectorStart: 0, lapValid: false, lastLap: null } }; const parsed = model.parseHorizonRacing({ version: 1, history: [], weekend: w }); assert.ok(parsed); const cp = parsed.weekend.checkpoint; const other = makeField(); other.setup(9, 1, 1); assert.equal(other.restore(cp.race), true); other.aiPolicy = cp.aiPolicy; assert.equal(other.aiPolicy, 'safe-v1'); assert.deepEqual(clone(other.snapshot()), clone(field.snapshot())); assert.equal(cp.player.lapValid, false); });
await test('真main拒絕不相容checkpoint：舊碼重現設定洩漏，修正後還原field並保留資料供重試', async () => {
  const priorCode = stripTypeScriptTypes(await readFile(path.resolve(root, '../taipei-gp-horizon-racing/src/main.ts'), 'utf8'), { mode: 'transform' });
  const priorAst = parseAst(priorCode), priorFn = name => { const n = priorAst.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); assert.ok(n, name); return priorCode.slice(n.start, n.end); };
  for (const [label, sourceFn] of [['before', priorFn], ['after', fn]]) {
    const field = makeField(); field.rules = '2026'; field.aiPolicy = 'legacy'; field.setDifficulty('hard'); field.setup(9, 2, 6, undefined, 'wet'); field.ttMode = true;
    const prior = clone(field.snapshot()), cpField = makeField(); cpField.setup(9, 1, 1);
    const w = model.newWeekend(config, names, 'reject-checkpoint', 1); model.weekendQualifying(w, qualifying);
    const race = clone(cpField.snapshot()); race.racers.reverse();
    w.checkpoint = { stage: 'sprint', race, aiPolicy: 'safe-v1', player: { lapTime: 0, lapValid: true, sectorIdx: 0, sectorStart: 0, lastLap: null } };
    const parsed = model.parseHorizonRacing({ version: 1, history: [], weekend: w }); assert.ok(parsed);
    const cp = clone(parsed.weekend.checkpoint); let writes = 0, shown = 0, message = '';
    const context = vm.createContext({ save: { horizonRacing: parsed }, CIRCUIT: null, cityReady: true, getSaveWriterState: () => ({ phase: 'ready' }), location: { search: '' }, trackStamp: () => config.trackV,
      track, field, car: field.me.car, horizonSession: null, horizonIntent: 0, horizonJob: null, horizonRestoreSettings: null, horizonFieldOwned: false, rainTarget: 0, state: 'menu',
      userStart: async () => {}, saveSeasonCheckpoint() {}, stopGpChallenge() {}, practiceRun: undefined, practiceRewind: { clear() {} }, practiceUi: { hud: { hidden: false } }, finishDrift() {}, abandonTaxi() {}, sr: undefined, stopPolice() {}, gpSettlementJob: undefined, qualiJob: undefined,
      preserveWeekendField: model.preserveWeekendField, mode: 'race', raceKind: 'tt', qualiRun: false, resetRace() { field.me.car.placeAt(track, 1); },
      lapTime: 0, sectorStart: 0, sectorIdx: 0, lapValid: true, lastLap: null, wrongWay: 0,
      horizonUi: { visible: true, hud: { hidden: true }, show() { shown++; }, setBusy() {}, message(text) { message = text; } }, writeSave() { writes++; } });
    vm.runInContext(sourceFn('saveHorizonCheckpoint') + '\n' + sourceFn('stopHorizonSession') + '\n' + sourceFn('launchHorizonWeekend'), context);
    await context.launchHorizonWeekend();
    assert.equal(context.horizonSession, null); assert.deepEqual(clone(parsed.weekend.checkpoint), cp); assert.equal(writes, 0); assert.match(message, /無法還原檢查點/);
    if (label === 'before') { assert.notDeepEqual(clone(field.snapshot()), prior); assert.equal(context.state, 'menu'); assert.equal(shown, 0); }
    else { assert.deepEqual(clone(field.snapshot()), prior); assert.equal(field.aiPolicy, 'legacy'); assert.equal(field.ttMode, true); assert.equal(context.horizonRestoreSettings, null); assert.equal(context.state, 'results'); assert.equal(shown, 1); }
  }
});
await test('真main陌生車手名單：對照移除guard會崩潰，修正後啟動前拒絕且存檔/field不變', async () => {
  const guarded = fn('launchHorizonWeekend'), vulnerable = guarded.replace(/\s*if \(w\.names\.length[\s\S]*?\n\s*\}/, '');
  assert.notEqual(guarded, vulnerable);
  for (const [label, source] of [['before', vulnerable], ['after', guarded]]) {
    const field = makeField(); field.rules = '2026'; field.aiPolicy = 'legacy'; field.setDifficulty('hard'); field.setup(9, 2, 6, undefined, 'wet');
    const prior = clone(field.snapshot()), strangerNames = names.map(name => name + '陌');
    const w = model.newWeekend(config, strangerNames, 'foreign-roster', 1);
    model.weekendQualifying(w, strangerNames.map((name, index) => ({ name, time: 60 + index })));
    const save = model.parseHorizonRacing({ version: 1, history: [], weekend: w }); assert.ok(save);
    const saved = clone(save); let started = 0, stopped = 0, message = '';
    const context = vm.createContext({ save: { horizonRacing: save }, CIRCUIT: null, cityReady: true, getSaveWriterState: () => ({ phase: 'ready' }), location: { search: '' }, trackStamp: () => config.trackV,
      track, field, car: field.me.car, horizonSession: null, horizonIntent: 0, horizonRestoreSettings: null, horizonFieldOwned: false, rainTarget: 0, state: 'menu',
      stopHorizonSession() { stopped++; }, userStart: async () => { started++; }, saveSeasonCheckpoint() {}, stopGpChallenge() {}, practiceRun: undefined, practiceRewind: { clear() {} }, practiceUi: { hud: { hidden: false } }, finishDrift() {}, abandonTaxi() {}, sr: undefined, stopPolice() {}, gpSettlementJob: undefined, qualiJob: undefined,
      preserveWeekendField: model.preserveWeekendField, mode: 'race', raceKind: 'tt', qualiRun: false, resetRace() { field.me.car.placeAt(track, 1); },
      lapTime: 0, sectorStart: 0, sectorIdx: 0, lapValid: true, lastLap: null, wrongWay: 0,
      horizonUi: { visible: true, message(text) { message = text; } } });
    vm.runInContext(source, context);
    if (label === 'before') { await assert.rejects(context.launchHorizonWeekend(), /car|undefined/); assert.equal(started, 1); assert.equal(stopped, 1); }
    else { await context.launchHorizonWeekend(); assert.equal(started, 0); assert.equal(stopped, 0); assert.match(message, /車手名單不同/); assert.deepEqual(clone(field.snapshot()), prior); assert.equal(context.horizonSession, null); }
    assert.deepEqual(clone(save), saved);
  }
});
await test('真main早退：週末與Practice不執行正式PB/影子/錢包/成就/季賽寫入', () => {
  let horizonSteps = 0, snapshots = 0; const car = new env.car.Car(); car.placeAt(track, 10); const field = makeField();
  const base = { summitCityRace: undefined, summitDuty: undefined, nexusCoop: undefined, nexusWorkshop: undefined, BOT: false, input: { read: () => ({ steer: 0, brake: false }) }, car, field, track, drsPress: false, pitPress: false, raceKind: 'tt', mode: 'race', horizonSession: 'qualifying', stepHorizonWeekend() { horizonSteps++; }, practiceRun: undefined, gpChallenge: { active: false }, stats: { dist: 0 }, state: 'race', writeSave() { throw Error('正式寫入'); }, saveHorizonCheckpoint() { snapshots++; } };
  const context = vm.createContext(base); vm.runInContext(fn('step') + '\n' + fn('tickStats') + '\n' + fn('saveSeasonCheckpoint'), context);
  context.step(1 / 120); context.tickStats(1); context.saveSeasonCheckpoint(); assert.equal(horizonSteps, 1); assert.equal(context.stats.dist, 0); assert.equal(snapshots, 1);
  context.horizonSession = null; context.lapTime = 0; context.lapValid = true; context.practiceRun = new practice.PracticeRun(track.length); context.practiceRun.start({ segment: { id: 'lap', label: '圈', start: car.pos.s, length: track.length }, flying: true, targetTime: null, targetExit: null }, car.pos.s, car.v);
  context.practiceRewind = new model.PracticeRewind(); context.updatePracticeRewindUi = () => {}; context.practiceUi = undefined; context.sound = { engine() {} };
  context.step(1 / 120); context.tickStats(1); context.saveSeasonCheckpoint(); assert.equal(context.practiceRun.snapshot().elapsed, 1 / 120); assert.equal(context.practiceRewind.size, 1); assert.equal(context.stats.dist, 0); assert.equal(snapshots, 1); assert.equal(horizonSteps, 1);
});
await test('真main週末step跑完排位/一圈衝刺/三圈正賽，實際圈數與成績產生積分', async () => {
  const field = makeField(), w = model.newWeekend(config, names, 'physical', 1), save = { horizonRacing: { version: 1, history: [], weekend: w } }; let writes = 0, qualified;
  const context = vm.createContext({ save, field, car: field.me.car, track, bounds: [track.length / 3, 2 * track.length / 3], horizonSession: 'qualifying', state: 'race', lapTime: 0, lapValid: true, sectorIdx: 0, sectorStart: 0, lastLap: null,
    sound: { engine() {} }, horizonUi: { progress() {} }, updateBrakingAssist() {}, gpEvent() {}, writeSave() { writes++; }, completeHorizonQualifying(time) { qualified = time; context.state = 'qualifying'; }, completeHorizonRace() { context.state = 'settling'; } });
  vm.runInContext(fn('stepHorizonWeekend') + '\n' + fn('saveHorizonCheckpoint'), context);
  field.ttMode = true; context.car.placeAt(track, 1);
  function drive(max = 120 * 600) { for (let i = 0; i < max && context.state === 'race'; i++) { const c = context.car, previous = c.pos.s, input = bot(c); const zone = field.drsZoneAt(c.pos.s); c.aeroZone = zone >= 0; c.drs = zone >= 0 && !input.brake; c.update(1 / 120, track, input.steer, input.brake); context.stepHorizonWeekend(1 / 120, previous); } }
  drive(120 * 151); assert.ok(qualified > 20 && qualified < 150); const times = await field.qualifyAsync(undefined, undefined, { attempts: 1 }); times.set(field.me, qualified); assert.ok(model.weekendQualifying(w, field.racers.map(r => ({ name: r.name, time: times.get(r) ?? null }))));
  const results = [];
  for (const [stage, laps] of [['sprint', 1], ['race', 3]]) { field.ttMode = false; field.aiPolicy = 'safe-v1'; field.setup(9, 1, laps, w.qualifying.map(q => field.racers.find(r => r.name === q.name))); context.horizonSession = stage; context.state = 'race'; context.lapTime = context.sectorIdx = context.sectorStart = 0; context.lapValid = true; drive(); assert.equal(context.state, 'settling'); assert.equal(field.me.laps, laps + 1); assert.ok(field.me.finish > 20); await field.finishRemainderAsync({ maxSeconds: 240 }); assert.ok(model.weekendFinish(w, stage, field.standings().map(r => ({ name: r.name, finish: r.dnf ? null : r.finish, dnf: r.dnf || r.finish === null })))); results.push({ stage, laps, playerFinish: field.me.finish, aiFinished: field.racers.filter(r => !r.isPlayer && r.finish !== null).length }); }
  assert.equal(w.stage, 'complete'); assert.ok(writes >= 6); assert.ok(model.weekendStandings(w).some(r => r.points > 0)); return { qualifying: qualified, results, checkpointWrites: writes };
});
await test('玩家DNF亦能真實結算AI，不偽造玩家finish或給分', async () => { const field = makeField(); field.setup(9, 1, 1); field.me.dnf = true; await field.finishRemainderAsync({ maxSeconds: 180 }); assert.equal(field.me.finish, null); assert.equal(field.me.dnf, true); assert.ok(field.racers.some(r => !r.isPlayer && r.finish !== null)); });
await test('主存檔完整保留新欄位、舊備份匯入不清週末、損壞與null視為關鍵資料', async () => {
  globalThis.location = { search: '' }; const memory = new Map();
  globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) };
  const s = await import(await pureUrl(root, 'save.ts')), horizon = { version: 1, history: [], weekend: model.newWeekend(config, names, 'save', 1) };
  const parsed = s.parseSaveFile(JSON.stringify({ best: null, sectors: [null, null, null], ghost: null, opts: {}, horizonRacing: horizon }));
  assert.equal(parsed.ok, true); assert.deepEqual(parsed.save.horizonRacing, horizon);
  for (const value of [{ version: 99 }, null]) {
    const bad = s.parseSaveFile(JSON.stringify({ opts: {}, horizonRacing: value }));
    assert.ok(bad.dropped.includes('horizonRacing')); assert.deepEqual(s.criticalSaveDrops(bad.dropped), ['horizonRacing']);
  }
  s.save.horizonRacing = horizon;
  const prepared = s.prepareImportedSave({ best: null, sectors: [null, null, null], ghost: null, opts: {} }); assert.deepEqual(prepared.save.horizonRacing, horizon);
  const nulled = s.parseSaveFile(JSON.stringify({ best: null, sectors: [null, null, null], ghost: null, opts: {}, horizonRacing: null }));
  assert.deepEqual(s.prepareImportedSave(nulled.save, nulled.dropped).save.horizonRacing, horizon);
});
await test('週末退出還原普通GP/TT全field狀態/規則/AI/難度/圈數/form/天氣，無額外亂數', () => { for (const ttMode of [false, true]) { const field = makeField(); field.rules = '2026'; field.aiPolicy = 'legacy'; field.form = { [names[0]]: .4 }; field.setDifficulty('hard'); field.setup(9, 2, 6, undefined, 'wet'); field.ttMode = ttMode; field.scChance = .25; const prior = clone(field.snapshot()), restore = model.preserveWeekendField(field); field.rules = 'classic'; field.aiPolicy = 'safe-v1'; field.form = {}; field.setDifficulty('easy'); field.setup(9, 0, 1, undefined, 'dry'); field.ttMode = !ttMode; assert.equal(restore(), true); assert.equal(field.aiPolicy, 'legacy'); assert.equal(field.ttMode, ttMode); assert.deepEqual(clone(field.snapshot()), prior); } });
await test('legacy真before/after五千步snapshot及亂數呼叫完全相同', async () => { const result = []; for (const project of [before, root]) { let calls = 0; const modules = await loadGameModules(project, { random: () => { calls++; return .5; } }); const field = new modules.rivals.RaceField(new THREE.Scene(), modules.track.buildTrack(), new modules.car.Car()); field.setup(9); for (let i = 0; i < 5000; i++) field.update(1 / 120, true); result.push({ snapshot: clone(field.snapshot()), calls }); } assert.deepEqual(result[0], result[1]); return { steps: 5000, calls: result[0].calls }; });
await test('car/track/pitlane/serverphysics與before原bytes一致', async () => { const hashes = {}; for (const file of ['src/car.ts', 'src/track.ts', 'src/pitlane.ts', 'server/physics.mjs']) { const [a, b] = await Promise.all([readFile(path.join(root, file)), readFile(path.join(before, file))]); assert.ok(a.equals(b), file); hashes[file] = createHash('sha256').update(a).digest('hex'); } return hashes; });
const sourceHashes = {}; for (const file of ['src/main.ts', 'src/save.ts', 'src/rivals.ts', 'src/tt-practice.ts', 'src/horizon-racing.ts', 'src/horizon-racing-ui.ts', 'src/horizon-racing.css', 'index.html']) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
const scriptSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
await writeFile(path.join(root, 'tools/dev-tests/horizon-racing-node-result.json'), JSON.stringify({ status: 'PASS', cases, sourceHashes, before, browserRun: false, localOnly: true, scriptSha256 }, null, 2) + '\n');
