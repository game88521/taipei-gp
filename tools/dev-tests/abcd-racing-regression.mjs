// 真 main/Car/RaceField 的 before/after：完整GP圈與同一圈時計；不建置、不操作瀏覽器。
// node --experimental-vm-modules tools/dev-tests/abcd-racing-regression.mjs [immutable-before-root]
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = path.resolve(process.argv[2] ?? process.env.GP_ABCD_BASELINE_DIR ?? path.join(project, '../taipei-gp-abcd-before-3bdf97336c02'));
assert.notEqual(project, baseline);
const integration = await readFile(new URL('./main-racing-integration.mjs', import.meta.url), 'utf8');
const end = integration.indexOf('\nawait check(');
assert.ok(end > 0);
const base = integration.slice(0, end);
const envLine = 'const env = await loadGameModules(project);';
const sourceLine = 'const current = await source(project), old = await source(original); report.sourceHash = current.hash;';
assert.ok(base.includes(envLine) && base.includes(sourceLine));
const exercise = String.raw`
const before = variant === 'before', dt = 1 / 120;
const evidence = { root: targetRoot, hashes: {}, checks: [], cases: [] };
for (const file of ['main.ts', 'rivals.ts', 'race-state.ts', 'season.ts', 'car.ts']) evidence.hashes[file] = createHash('sha256').update(await readFile(path.join(targetRoot, 'src', file))).digest('hex');
async function verify(label, action) {
  try { await action(); } catch (error) { error.message = variant + '：' + label + '\n' + error.message; throw error; }
  evidence.checks.push(label);
}
function fresh() {
  const h = harness(); h.ctx.raceAudio = () => {}; h.ctx.beginCountdown(); h.ctx.state = 'race';
  h.ctx.PIT = pitlane.PIT;
  h.ctx.bounds = [h.track.length / 3, 2 * h.track.length / 3]; h.ctx.wrongWay = 0; h.ctx.lastHitSound = 0; h.ctx.botHits = 0;
  return h;
}
function fixture({ sectors = 2, valid = true, last = false, time = 40, best = 60 } = {}) {
  const h = fresh(); h.field.raceTime = time; h.field.me.laps = last ? h.field.laps : 1; h.field.me.lapStart = 0;
  h.field.me.bestLap = best; h.ctx.save.gpBest = best; h.ctx.lapTime = time; h.ctx.sectorIdx = sectors; h.ctx.sectorStart = 0; h.ctx.lapValid = valid;
  h.field.racers.filter((r) => !r.isPlayer).forEach((r, k) => { r.finish = time + 10 + k; r.laps = h.field.laps + 1; r.bestLap = 50; });
  return h;
}
function cross(h) {
  h.car.pos.s = h.track.length - 1; h.car.update = () => { h.car.pos.s = 1; return 0; };
  h.field.update = (timeStep) => { h.field.raceTime += timeStep; return 0; };
  h.ctx.step(dt);
}
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-8, String(a) + ' != ' + String(b)); }
function brief(h) { return { laps: h.field.me.laps, finish: h.field.me.finish, raceBest: h.field.me.bestLap, localBest: h.ctx.save.gpBest, lapTime: h.ctx.lapTime, lapValid: h.ctx.lapValid, sectors: h.ctx.sectorIdx }; }

await verify('真物理起跑線小圈：before309m假完賽，after不計完整圈也不更新PB', async () => {
  const h = fresh(); h.ctx.save.gpBest = 60; h.car.placeAt(h.track, h.track.N - 1);
  h.ctx.input.read = () => ({ steer: 1, brake: h.car.v > 5 });
  h.field.update = (timeStep) => { h.field.raceTime += timeStep; return 0; };
  h.ctx.completeGpResults = () => { h.ctx.state = 'finished-isolated'; };
  const realUpdate = h.car.update;
  let distance = 0, maxWrongWay = 0, maxSectors = 0, invalid = false;
  for (let n = 0; n < 120 * 90 && h.ctx.state === 'race'; n++) {
    const x = h.car.x, z = h.car.z; h.ctx.step(dt);
    distance += Math.hypot(h.car.x - x, h.car.z - z); maxWrongWay = Math.max(maxWrongWay, h.ctx.wrongWay);
    maxSectors = Math.max(maxSectors, h.ctx.sectorIdx); invalid ||= !h.ctx.lapValid;
  }
  assert.equal(h.car.update, realUpdate); assert.equal(maxSectors, 0); assert.equal(invalid, false); assert.ok(maxWrongWay < 2.5); assert.equal(h.ctx.botHits, 0);
  assert.ok(distance < h.track.length / 3);
  if (before) { assert.ok(h.field.me.finish > 63 && h.field.me.finish < 64); assert.equal(h.field.me.laps, 4); assert.ok(h.ctx.save.gpBest < 5); }
  else { assert.equal(h.field.me.finish, null); assert.equal(h.field.me.laps, 1); assert.equal(h.field.me.bestLap, null); assert.equal(h.ctx.save.gpBest, 60); assert.ok(h.ctx.lapTime > 89); }
  evidence.cases.push({ name: '真物理小圈', distance, trackLength: h.track.length, elapsed: h.field.raceTime, maxWrongWay, maxSectors, ...brief(h) });
});

await verify('真Car與真botInput跑完整賽道：有效完整圈仍計圈與同時更新兩個PB', async () => {
  const h = fresh(); vm.runInContext(current.fn('botInput'), h.ctx); h.ctx.input.read = () => h.ctx.botInput();
  h.field.update = (timeStep) => { h.field.raceTime += timeStep; return 0; };
  let distance = 0;
  for (let n = 0; n < 120 * 140 && h.field.me.laps < 2; n++) {
    const x = h.car.x, z = h.car.z; h.ctx.step(dt); distance += Math.hypot(h.car.x - x, h.car.z - z);
  }
  assert.equal(h.field.me.laps, 2); assert.equal(h.field.me.finish, null); assert.ok(distance > h.track.length); assert.ok(h.ctx.save.gpBest > 20);
  close(h.ctx.save.gpBest, h.field.me.bestLap);
  evidence.cases.push({ name: '真物理完整圈', distance, elapsed: h.field.raceTime, ...brief(h) });
});

for (const sectors of [0, 1]) await verify('缺少完整分段(' + sectors + ')不能計圈／更新最快圈', async () => {
  const h = fixture({ sectors }); cross(h);
  assert.equal(h.field.me.laps, before ? 2 : 1); assert.equal(h.field.me.finish, null);
  assert.equal(h.field.me.bestLap, before ? 40 + dt : 60); assert.equal(h.ctx.save.gpBest, 60);
  assert.equal(h.ctx.sectorIdx, 0); close(h.ctx.lapTime, before ? 0 : 40 + dt);
});

for (const last of [false, true]) await verify((last ? '最後' : '普通') + '完整有效圈與正常賽季最快圈加分保留', async () => {
  const h = fixture({ last }); cross(h);
  if (last) {
    await until(() => h.ctx.state === 'podium' && h.ctx.gpSettlementJob === null);
    assert.equal(h.ctx.save.season.results[0].you.pts, 26); assert.equal(h.ctx.save.taxi.money, 2500); assert.equal(h.ctx.stats.gpWins, 1);
  }
  assert.equal(h.field.me.laps, last ? 4 : 2); close(h.ctx.save.gpBest, h.field.me.bestLap); close(h.ctx.save.gpBest, 40 + dt);
});

for (const last of [false, true]) await verify((last ? '最後' : '普通') + '完整重置／扶正圈仍計圈但不更新兩個最快圈', async () => {
  const h = fixture({ last, valid: false }); cross(h);
  if (last) { await until(() => h.ctx.state === 'podium' && h.ctx.gpSettlementJob === null); assert.equal(h.ctx.save.season.results[0].you.pts, 25); }
  assert.equal(h.field.me.laps, last ? 4 : 2); assert.equal(h.field.me.bestLap, 60); assert.equal(h.ctx.save.gpBest, 60);
});

await verify('首次過起跑線開始第1圈，不要求尚未跑過的分段且不誤記PB', async () => {
  const h = fixture({ sectors: 0, time: 1 }); h.field.me.laps = 0; h.field.me.bestLap = null; cross(h);
  assert.equal(h.field.me.laps, 1); assert.equal(h.field.me.bestLap, null); assert.equal(h.ctx.save.gpBest, 60); assert.equal(h.ctx.lapTime, 0);
  close(h.field.me.lapStart, 1 + dt);
});

await verify('20秒防重複計圈拒絕時，main亦不可另行更新5秒PB', async () => {
  const h = fixture({ time: 5 }); cross(h);
  assert.equal(h.field.me.laps, 1); assert.equal(h.field.me.bestLap, 60);
  assert.equal(h.ctx.save.gpBest, before ? 5 + dt : 60);
});

await verify('未完整過線後再跑完整圈：圈數與兩個最快圈用同一次完整圈的總時間', async () => {
  const h = fixture({ sectors: 0, best: null }); cross(h);
  h.field.raceTime += 55; h.ctx.lapTime += 55; h.ctx.sectorIdx = 2; cross(h);
  if (before) { assert.equal(h.field.me.laps, 3); assert.ok(h.field.me.bestLap < 41); assert.ok(h.ctx.save.gpBest < 56); }
  else { assert.equal(h.field.me.laps, 2); close(h.field.me.bestLap, 95 + 2 * dt); close(h.ctx.save.gpBest, h.field.me.bestLap); }
  evidence.cases.push({ name: '失敗過線後完整圈時計', ...brief(h) });
});

await verify('無效圈標記不會被未完整過線洗掉，之後跑完整圈仍不給PB', async () => {
  const h = fixture({ sectors: 0, valid: false }); cross(h); assert.equal(h.ctx.lapValid, before);
  h.field.raceTime += 30; h.ctx.lapTime += 30; h.ctx.sectorIdx = 2; cross(h);
  assert.equal(h.field.me.laps, before ? 3 : 2); assert.equal(h.ctx.save.gpBest, before ? 30 + dt : 60);
  assert.equal(h.field.me.bestLap, before ? 30 + dt : 60);
});

for (const sectors of [0, 2]) await verify('既有格式checkpoint重載後依原分段' + sectors + '驗證完整圈', async () => {
  const h = fixture({ sectors }); h.ctx.pause();
  const saved = clone(h.storage.last), parsed = env.season.parseSeasonSave(saved.season);
  assert.ok(parsed?.pending?.checkpoint); saved.season = parsed;
  const reload = harness(current, saved); reload.ctx.raceAudio = () => {}; reload.ctx.bounds = [reload.track.length / 3, 2 * reload.track.length / 3];
  await reload.ctx.restoreSeasonCheckpoint(); assert.equal(reload.ctx.sectorIdx, sectors); cross(reload);
  assert.equal(reload.field.me.laps, sectors === 2 || before ? 2 : 1);
  assert.equal(reload.ctx.save.gpBest, sectors === 2 ? 40 + dt : 60);
});

await verify('合法出站跨起跑線：真pitStep／placePit仍計入完整圈', async () => {
  const h = fixture();
  h.field.me.pit = { ph: 'out', sd: -0.1, v: 22.2, entry: 0, exit: 4.5, t: 2.5, T: 2.5, slow: -1, next: 1, box: -20, team: 0 };
  h.field.placePit(h.field.me); assert.ok(h.car.pos.s > h.track.length - 1);
  h.ctx.step(dt); assert.equal(h.field.me.laps, 2); assert.ok(h.car.pos.s < 1);
  close(h.field.me.bestLap, 40 + dt); close(h.ctx.save.gpBest, h.field.me.bestLap);
  evidence.cases.push({ name: '合法維修區過線', ...brief(h) });
});

await verify('計時／排位的未完整圈處理維持原行為', async () => {
  for (const quali of [false, true]) {
    const h = fixture({ sectors: 0 }); h.ctx.raceKind = 'tt'; h.ctx.qualiRun = quali; h.ctx.save.best = 60;
    cross(h); assert.equal(h.ctx.lapTime, 0); assert.equal(h.ctx.save.best, 60); assert.equal(h.ctx.state, 'race');
  }
});
export default evidence;
`;
const result = { baseline, before: null, after: null, checksPerVersion: 0,
  limitations: ['每版使用該版真main AST、Car、RaceField、checkpoint parser；DOM／音效／保存隔離',
    '真物理小圈與完整圈僅隔離其他車（field.update只推比賽時間），未驗證AI車陣、人手操作或瀏覽器',
    '其他邊界案例人工準備分段／車位／車手成績；進站案例使用真field.update/pitStep',
    '不取代正式建置或54.425／162.0／175.7固定回歸'] };
for (const [variant, root] of [['before', baseline], ['after', project]]) {
  const generated = new URL(`./.abcd-racing-${randomUUID()}.mjs`, import.meta.url);
  const prefix = base.replace(envLine, `const env = await loadGameModules(${JSON.stringify(root)});`)
    .replace(sourceLine, `const current = await source(${JSON.stringify(root)}), old = {}; report.sourceHash = current.hash;`);
  try { await writeFile(generated, prefix + `\nconst variant = ${JSON.stringify(variant)}, targetRoot = ${JSON.stringify(root)};\n` + exercise); result[variant] = (await import(generated.href)).default; }
  finally { await unlink(generated).catch(() => {}); }
}
assert.equal(result.before.checks.length, result.after.checks.length); result.checksPerVersion = result.after.checks.length;
await writeFile(new URL('./abcd-racing-regression-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(`PASS ${result.checksPerVersion}項×before/after：GP完整圈、真物理小圈、進站、重置與既有checkpoint。`);
