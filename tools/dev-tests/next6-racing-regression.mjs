// 真 main AST／Season parser 的前後對照；DOM、音效及儲存隔離，不連外、不建立 WebGL。
// node --experimental-vm-modules tools/dev-tests/next6-racing-regression.mjs [immutable-before-root]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import * as THREE from 'three';
import { loadGameModules } from './racing-test-env.mjs';
import { verifyRacingCore } from './racing-core-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const beforeRoot = path.resolve(process.argv[2] ?? path.join(root, '../taipei-gp-next6-before-57b09b2'));
assert.notEqual(root, beforeRoot);
const afterEnv = await loadGameModules(root), beforeEnv = await loadGameModules(beforeRoot);
const boundedRecording = await afterEnv.exports('src/bounded-recording.ts');
const clone = (value) => JSON.parse(JSON.stringify(value));
const report = { beforeRoot, root, checks: [], evidence: {}, hashes: {}, limitations: [
  '受測 main 函式直接取自目前及封存來源；使用真 RaceField snapshot 與 Season parser。',
  'DOM、音效及實際存檔由記憶體隔離；沒有完整瀏覽器、建置、固定三基準或手機實測。',
  '續賽不保存歷史圈表；明確從續賽起重記，當圈已完成分段則保存。',
] };
async function source(base) {
  const raw = await readFile(path.join(base, 'src/main.ts'), 'utf8');
  const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
  const find = (name) => {
    const node = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === name);
    assert.ok(node, `找不到 main.${name}`); return node;
  };
  return {
    fn(name) { const n = find(name); return code.slice(n.start, n.end); },
    reset() {
      const n = ast.body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
        && n.expression.callee.type === 'MemberExpression' && n.expression.callee.property.name === 'addEventListener'
        && n.expression.callee.object.type === 'CallExpression' && n.expression.callee.object.callee.name === '$'
        && n.expression.callee.object.arguments[0]?.value === 'btn-reset');
      assert.ok(n); const callback = n.expression.arguments[1]; return `(${code.slice(callback.start, callback.end)})()`;
    },
    hud() {
      const n = find('updateVisuals').body.body.find((n) => n.type === 'IfStatement' && code.slice(n.start, n.end).includes("$('time').textContent"));
      assert.ok(n); return code.slice(n.start, n.end);
    },
  };
}
const after = await source(root), before = await source(beforeRoot);
for (const file of ['main.ts', 'season.ts', 'racing-laps.ts', 'rivals.ts', 'car.ts', 'track.ts']) {
  report.hashes[file] = {};
  for (const [key, base] of [['before', beforeRoot], ['after', root]]) report.hashes[file][key] = createHash('sha256').update(await readFile(path.join(base, 'src', file))).digest('hex');
}
report.coreProtection = await verifyRacingCore(root, beforeRoot);
async function check(name, run) {
  try { await run(); report.checks.push({ name, status: 'PASS' }); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: error.stack }); }
}
function element() {
  const classes = new Set();
  return { textContent: '', className: '', title: '', style: {}, dataset: {},
    classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n), toggle: (n, on) => on ? classes.add(n) : classes.delete(n) } };
}
async function harness(src = after, env = afterEnv) {
  const { SessionLaps } = await env.exports('src/racing-laps.ts');
  const elements = new Map(), $ = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const events = { writes: 0, finishes: [], ghostReads: 0, toasts: [] };
  const ctx = vm.createContext({
    racingTools: undefined, nexusWorkshop: undefined, stopPolice() {}, updateBrakingAssist() {},
    practiceRun: undefined, practiceUi: undefined, practiceIntent: 0,
    pitCalibration: undefined, observePitCalibration() {}, ...boundedRecording,
    console, performance: { now: () => 10000 }, Date, Math, Number,
    save: { sectors: [20, 20, 20], best: 60, gpBest: 70, ghost: { t: [0, 60], s: [0, 1000], x: [0, 1], z: [0, 1], h: [0, 0] } },
    raceKind: 'tt', state: 'race', mode: 'race', lapValid: true, qualiRun: false, qualifyingAttempts: { limit: 1 },
    lapSectors: [null, null, null], lapTime: 50, sectorStart: 30, sectorIdx: 2, lap: 1, lastLap: null,
    sessionLaps: new SessionLaps(10), renderSessionLaps() { events.renders = (events.renders ?? 0) + 1; },
    fmt: (n) => n == null ? '--' : String(n), fmtDelta: String, $,
    car: { pos: { s: 1, i: 0 }, x: 0, z: 0, h: 0, v: 40, placeAt() {} }, track: { length: 1000 },
    rec: { t: [0], s: [0], x: [0], z: [0], h: [0] }, recAcc: 0, ghostPtr: 0, BOT: false, CIRCUIT: { id: 'test' },
    clearSectorsAt: 0, deltaAcc: 1, deltaHoldUntil: 0, toastUntil: 0, warnText: '',
    updateBrakingAssist() {}, // The restored-session display cache is tested by lobbybrake-assist-main.mjs.
    gearOf: () => ({ n: 1 }), updateGpHud() {}, ghostTimeAt() { events.ghostReads++; return 40; },
    toast: (text) => events.toasts.push(text), writeSave() { events.writes++; },
    finishQualifyingAttempt: (time) => events.finishes.push(time),
  });
  for (const name of ['recordSessionLap', 'startLap', 'sectorDone', 'completeLap']) vm.runInContext(src.fn(name), ctx);
  return { ctx, events, $, src, env };
}

await check('無效圈：舊版保留S1=15，新版完整圈確認前不提交', async () => {
  const evidence = {};
  for (const [key, src, env] of [['before', before, beforeEnv], ['after', after, afterEnv]]) {
    const h = await harness(src, env); h.ctx.sectorDone(0, 15);
    vm.runInContext(src.reset(), h.ctx); assert.equal(h.ctx.lapValid, false);
    h.ctx.completeLap(); evidence[key] = clone(h.ctx.save.sectors);
    assert.deepEqual(evidence[key], key === 'before' ? [15, 20, 20] : [20, 20, 20]);
    assert.equal(h.ctx.sessionLaps.rows()[0].valid, false);
  }
  report.evidence.invalidLapSectors = evidence;
});

await check('TT完整有效圈：S1/S2先暫存，S3及完圈後一次更新分段與PB', async () => {
  const h = await harness(); h.ctx.sectorDone(0, 15); h.ctx.sectorDone(1, 16);
  assert.deepEqual(clone(h.ctx.save.sectors), [20, 20, 20]);
  h.ctx.sectorStart = 31; h.ctx.completeLap();
  assert.deepEqual(clone(h.ctx.save.sectors), [15, 16, 19]); assert.equal(h.ctx.save.best, 50);
  assert.equal(h.events.writes, 1); assert.deepEqual(clone(h.ctx.sessionLaps.rows()[0].sectors), [15, 16, 19]);
});

for (const valid of [true, false]) await check(`排位${valid ? '有效' : '無效'}圈：不修改TT長期分段、PB與影子`, async () => {
  const h = await harness(); h.ctx.qualiRun = true;
  const oldRecord = clone(h.ctx.save); h.ctx.sectorDone(0, 10); h.ctx.sectorDone(1, 11);
  h.ctx.lapValid = valid; h.ctx.completeLap();
  assert.deepEqual(clone(h.ctx.save), oldRecord); assert.equal(h.events.writes, 0);
  assert.deepEqual(h.events.finishes, valid ? [50] : []);
});

await check('GP有效圈仍更新正賽PB，不修改TT分段／PB／影子', async () => {
  const h = await harness(); h.ctx.raceKind = 'gp'; const oldRecord = clone(h.ctx.save);
  h.ctx.sectorDone(0, 10); h.ctx.sectorDone(1, 11); h.ctx.completeLap();
  assert.equal(h.ctx.save.gpBest, 50); assert.equal(h.ctx.save.best, oldRecord.best);
  assert.deepEqual(clone(h.ctx.save.sectors), oldRecord.sectors); assert.deepEqual(clone(h.ctx.save.ghost), oldRecord.ghost);
});

for (const [kind, qualifying, valid] of [['gp', false, true], ['tt', true, true], ['tt', false, false], ['tt', false, true]]) {
  await check(`即時差距基準隔離：${kind}／排位${qualifying}／有效${valid}`, async () => {
    const h = await harness(); Object.assign(h.ctx, { raceKind: kind, qualiRun: qualifying, lapValid: valid, dt: 0.2 });
    vm.runInContext(after.hud(), h.ctx);
    assert.equal(h.events.ghostReads, kind === 'tt' && !qualifying && valid ? 1 : 0);
    if (kind === 'gp') {
      const old = await harness(before, beforeEnv); Object.assign(old.ctx, { raceKind: kind, dt: 0.2 }); vm.runInContext(before.hud(), old.ctx);
      assert.equal(old.events.ghostReads, 1); report.evidence.gpGhostReads = { before: 1, after: 0 };
    }
  });
}

async function checkpointFixture(src = after, env = afterEnv) {
  const h = await harness(src, env), track = env.track.buildTrack(), car = new env.car.Car();
  const field = new env.rivals.RaceField(new THREE.Scene(), track, car); field.setup(9); field.raceTime = 30;
  const s = env.season.defaultSeason(3, 'normal', 'classic', 1, 3);
  s.pending = { id: s.calendar[0], grid: field.racers.map((r) => r.name), at: 1 };
  Object.assign(h.ctx, { field, car, track, CIRCUIT: { id: s.calendar[0] }, save: { ...h.ctx.save, season: s },
    BOT: false, mode: 'race', raceKind: 'gp', inSeasonRound: () => true, trackStamp: () => 'test-track',
    lap: 1, lapTime: 30, lastLap: null, sectorIdx: 2, sectorStart: 25, lapSectors: [12, 13, null],
    restoringSeason: false, userStart: async () => {}, finishDrift() {}, abandonTaxi() {}, sr: null, police: null,
    selectRecordRules() {}, checkTrackStamp() {}, seasonGrid: [], settled: null, gpRewarded: false,
    hud: h.$('hud'), hideMenu() {}, clock: { getDelta() {} }, radio: { reset() {} }, PLAYER_LIVERY: { main: '#ff0000' }, setRaceRain() {},
  });
  for (const name of ['saveSeasonCheckpoint', 'restoreSeasonCheckpoint']) vm.runInContext(src.fn(name), h.ctx);
  h.ctx.saveSeasonCheckpoint(false); return h;
}

await check('檢查點保存與驗證已完成分段：舊版遺失，新版[12,13,null]且無陣列共用', async () => {
  const evidence = {};
  for (const [key, src, env] of [['before', before, beforeEnv], ['after', after, afterEnv]]) {
    const h = await checkpointFixture(src, env), cp = h.ctx.save.season.pending.checkpoint;
    evidence[key] = cp.player.lapSectors ? clone(cp.player.lapSectors) : null;
    const parsed = env.season.parseSeasonSave(clone(h.ctx.save.season)); assert.ok(parsed?.pending?.checkpoint);
    assert.deepEqual(parsed.pending.checkpoint.player.lapSectors ? clone(parsed.pending.checkpoint.player.lapSectors) : null, evidence[key]);
    h.ctx.lapSectors[0] = 99; assert.deepEqual(cp.player.lapSectors ? clone(cp.player.lapSectors) : null, evidence[key]);
  }
  assert.deepEqual(evidence, { before: null, after: [12, 13, null] }); report.evidence.checkpointSectors = evidence;
});

await check('真正續賽函式：清除舊場圈表／秒差，恢復當圈分段後可完成完整圈表', async () => {
  const h = await checkpointFixture(), cp = h.ctx.save.season.pending.checkpoint;
  const parsed = afterEnv.season.parseSeasonSave(clone(h.ctx.save.season)); h.ctx.save.season = parsed;
  h.ctx.sessionLaps.add({ time: 3, sectors: [1, 1, 1], valid: true }); h.ctx.lapSectors = [99, 99, 99];
  h.$('delta').textContent = '-999'; h.ctx.deltaAcc = h.ctx.deltaHoldUntil = h.ctx.clearSectorsAt = 999;
  await h.ctx.restoreSeasonCheckpoint();
  assert.equal(h.ctx.state, 'race'); assert.equal(h.ctx.raceKind, 'gp'); assert.equal(h.ctx.sessionLaps.summary().count, 0);
  assert.deepEqual(clone(h.ctx.lapSectors), [12, 13, null]); assert.equal(h.$('delta').textContent, '');
  assert.equal(h.ctx.deltaHoldUntil, 0); assert.ok(h.events.toasts.some((s) => s.includes('本場圈表')));
  h.ctx.recordSessionLap(40); assert.deepEqual(clone(h.ctx.sessionLaps.rows()[0].sectors), [12, 13, 15]);
  assert.equal(h.ctx.sessionLaps.summary().theoreticalBest, 40);
  h.ctx.lapSectors[0] = 99; assert.deepEqual(clone(cp.player.lapSectors), [12, 13, null]);
  assert.deepEqual(clone(parsed.pending.checkpoint.player.lapSectors), [12, 13, null]);
});

await check('舊檢查點缺分段：不拒絕續賽、不帶入舊記憶體、不捏造理論最佳', async () => {
  const h = await checkpointFixture(); delete h.ctx.save.season.pending.checkpoint.player.lapSectors;
  const parsed = afterEnv.season.parseSeasonSave(clone(h.ctx.save.season)); assert.ok(parsed?.pending?.checkpoint);
  assert.deepEqual(clone(parsed.pending.checkpoint.player.lapSectors), [null, null, null]); h.ctx.save.season = parsed;
  h.ctx.lapSectors = [1, 1, 1]; h.ctx.sessionLaps.add({ time: 3, sectors: [1, 1, 1], valid: true });
  await h.ctx.restoreSeasonCheckpoint(); h.ctx.recordSessionLap(40);
  assert.deepEqual(clone(h.ctx.sessionLaps.rows()[0].sectors), [null, null, 15]); assert.equal(h.ctx.sessionLaps.summary().theoreticalBest, null);
  assert.equal(h.ctx.sessionLaps.summary().count, 1);
});

for (const [name, sectors] of [
  ['長度', [12, 13]], ['負值', [-12, 13, null]], ['零', [0, 13, null]], ['非數字', ['12', 13, null]],
  ['NaN', [NaN, 13, null]], ['Infinity', [Infinity, 13, null]], ['未來分段', [12, 13, 1]], ['總和超時', [14, 14, null]],
]) await check(`損毀檢查點分段／${name}：捨棄復原點但保留賽季與pending`, async () => {
  const h = await checkpointFixture(); h.ctx.save.season.pending.checkpoint.player.lapSectors = sectors;
  const parsed = afterEnv.season.parseSeasonSave(h.ctx.save.season);
  assert.ok(parsed?.pending); assert.equal(parsed.pending.checkpoint, undefined); assert.equal(parsed.round, 0);
});

await check('分段0／1及舊資料未知前段均可保存；未來分段拒絕', async () => {
  const h = await checkpointFixture(); const cp = h.ctx.save.season.pending.checkpoint;
  for (const [idx, start, sectors] of [[0, 0, [null, null, null]], [0, 5, [null, null, null]], [1, 12, [12, null, null]], [2, 25, [null, 13, null]], [2, 30, [12, 13, null]]]) {
    Object.assign(cp.player, { sectorIdx: idx, sectorStart: start, lapSectors: sectors });
    assert.ok(afterEnv.season.parseSeasonSave(h.ctx.save.season)?.pending?.checkpoint);
  }
  Object.assign(cp.player, { sectorIdx: 1, sectorStart: 25, lapSectors: [12, 13, null] });
  assert.equal(afterEnv.season.parseSeasonSave(h.ctx.save.season).pending.checkpoint, undefined);
});

report.summary = { PASS: report.checks.filter((c) => c.status === 'PASS').length, FAIL: report.checks.filter((c) => c.status === 'FAIL').length };
await writeFile(new URL('./next6-racing-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.summary.FAIL) process.exitCode = 1;
