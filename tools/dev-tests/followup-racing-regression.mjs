// 真 main AST + 各版本自己的 RaceField：無效 GP 圈不可成為最快圈或錯領賽季加分。
// node --experimental-vm-modules tools/dev-tests/followup-racing-regression.mjs [beforeRoot]
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = path.resolve(process.argv[2] ?? process.env.GP_FOLLOWUP_BASELINE_DIR ?? path.join(project, '../taipei-gp-followup-before-2dee076'));
const integration = await readFile(new URL('./main-racing-integration.mjs', import.meta.url), 'utf8');
const boundary = integration.indexOf('\nawait check(');
assert.ok(boundary > 0, 'main-racing integration 的 harness 邊界必須存在');
const basePrefix = integration.slice(0, boundary);
const environmentLine = 'const env = await loadGameModules(project);';
const sourceLine = 'const current = await source(project), old = await source(original); report.sourceHash = current.hash;';
assert.ok(basePrefix.includes(environmentLine) && basePrefix.includes(sourceLine), 'harness 結構改變時請明確更新測試');

const exercise = String.raw`
const invalidBefore = variant === 'before';
const stepTime = 1 / 120, firstCrossTime = 40 + stepTime;
const evidence = {
  variant, sourceRoot: targetRoot,
  hashes: Object.fromEntries(await Promise.all(['main.ts', 'rivals.ts', 'season.ts'].map(async (name) => [name,
    createHash('sha256').update(await readFile(path.join(targetRoot, 'src', name))).digest('hex')]))),
  checks: [], cases: [],
};
async function verify(label, action) {
  try { await action(); } catch (error) { error.message = variant + '：' + label + '\n' + error.message; throw error; }
  evidence.checks.push(label);
}
function fresh() { const h = harness(); h.ctx.raceAudio = () => {}; h.ctx.beginCountdown(); h.ctx.state = 'race'; return h; }
function prepare(h, { last = false, valid = false, best = 60, time = 40 } = {}) {
  h.field.raceTime = time;
  h.field.me.laps = last ? h.field.laps : 1;
  h.field.me.lapStart = 0;
  h.field.me.bestLap = best;
  h.ctx.lapTime = time;
  h.ctx.sectorIdx = 2;
  h.ctx.sectorStart = 25;
  h.ctx.lapValid = valid;
  h.ctx.save.gpBest = best;
  h.field.racers.filter((r) => !r.isPlayer).forEach((r, k) => {
    r.finish = 50 + k; r.laps = h.field.laps + 1; r.bestLap = 50;
  });
  h.car.pos.s = h.track.length - 1;
}
function cross(h) {
  h.car.pos.s = h.track.length - 1;
  h.car.update = () => { h.car.pos.s = 1; return 0; };
  // 原fixture凍結RaceField時鐘，卻讓main增加dt，製造了實際賽事不會有的兩個圈時計。
  // 只隔離AI移動，保留真field.update每步先推進raceTime的契約；兩版使用相同fixture。
  h.field.update = (dt) => { h.field.raceTime += dt; return 0; };
  h.ctx.step(stepTime);
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, String(actual) + ' != ' + String(expected)); }
function record(h) {
  h.field.me.finish = h.field.raceTime; h.field.me.laps = h.field.laps + 1;
  h.ctx.recordSeason(h.field.standings());
  return h.ctx.save.season.results[0];
}
function timing(h) { return h.field.snapshot().timing.find((r) => r.name === h.field.me.name); }
function resultEvidence(label, h) {
  evidence.cases.push({ label, localGpBest: h.ctx.save.gpBest, raceBestLap: h.field.me.bestLap,
    finalState: h.ctx.state, laps: h.field.me.laps, finish: h.field.me.finish,
    fastest: h.ctx.save.season.results[0]?.fl, points: h.ctx.save.season.results[0]?.you?.pts,
    balance: h.ctx.save.taxi.money, gpWins: h.ctx.stats.gpWins });
}

await verify('普通無效圈：本地PB／RaceField最快圈／賽季+1一致', async () => {
  const h = fresh(); prepare(h); cross(h);
  assert.equal(h.ctx.save.gpBest, 60);
  assert.equal(h.field.me.bestLap, invalidBefore ? firstCrossTime : 60);
  assert.equal(h.field.me.laps, 2); assert.equal(h.field.me.lapStart, firstCrossTime); assert.equal(h.field.me.finish, null);
  assert.equal(h.ctx.lapValid, true, '過線後下一圈恢復有效');
  assert.equal(timing(h).progress, h.track.length + 1); assert.equal(timing(h).time, firstCrossTime);
  const round = record(h);
  assert.equal(round.fl === '你', invalidBefore); assert.equal(round.you.pts, invalidBefore ? 26 : 25);
  resultEvidence('普通無效圈', h);
});

await verify('最後無效圈：真step→背景結算→頒獎→賽季，仍正常完賽發獎', async () => {
  const h = fresh(); prepare(h, { last: true }); cross(h);
  assert.equal(h.ctx.BOT, false); assert.equal(h.ctx.state, 'settling');
  await until(() => h.ctx.state === 'podium' && h.ctx.gpSettlementJob === null);
  assert.equal(h.ctx.save.gpBest, 60); assert.equal(h.field.me.bestLap, invalidBefore ? firstCrossTime : 60);
  assert.equal(h.field.me.laps, h.field.laps + 1); assert.equal(h.field.me.finish, firstCrossTime);
  assert.equal(timing(h).progress, h.field.laps * h.track.length + 1);
  assert.equal(h.ctx.save.season.results[0].fl === '你', invalidBefore);
  assert.equal(h.ctx.save.season.results[0].you.pts, invalidBefore ? 26 : 25);
  assert.equal(h.ctx.save.taxi.money, 2500); assert.equal(h.ctx.stats.gpWins, 1);
  h.ctx.settleRace(); h.ctx.settleRace();
  assert.equal(h.ctx.save.season.results.length, 1); assert.equal(h.ctx.save.taxi.money, 2500); assert.equal(h.ctx.stats.gpWins, 1);
  resultEvidence('最後無效圈與發獎去重', h);
});

for (const last of [false, true]) await verify((last ? '最後' : '普通') + '有效圈仍更新最快圈並可得+1', async () => {
  const h = fresh(); prepare(h, { last, valid: true }); cross(h);
  if (last) await until(() => h.ctx.state === 'podium' && h.ctx.gpSettlementJob === null);
  else record(h);
  assert.equal(h.field.me.bestLap, firstCrossTime); assert.equal(h.ctx.save.gpBest, firstCrossTime);
  assert.equal(h.ctx.save.gpBest, h.field.me.bestLap, '合法有效圈的本地PB與賽事最快圈應使用同一次推進後的時計');
  assert.equal(h.ctx.save.season.results[0].fl, '你'); assert.equal(h.ctx.save.season.results[0].you.pts, 26);
  resultEvidence(last ? '最後有效圈' : '普通有效圈', h);
});

await verify('尚無有效最快圈：無效圈必須保留null', async () => {
  const h = fresh(); prepare(h, { best: null }); cross(h); record(h);
  assert.equal(h.ctx.save.gpBest, null); assert.equal(h.field.me.bestLap, invalidBefore ? firstCrossTime : null);
  assert.equal(h.ctx.save.season.results[0].you.pts, invalidBefore ? 26 : 25);
  resultEvidence('沒有有效最快圈', h);
});

await verify('之前有效最快圈仍可加分：不能因最後一圈無效取消既有成績', async () => {
  const h = fresh(); prepare(h, { best: 45, last: true }); cross(h);
  await until(() => h.ctx.state === 'podium' && h.ctx.gpSettlementJob === null);
  assert.equal(h.ctx.save.gpBest, 45); assert.equal(h.field.me.bestLap, invalidBefore ? firstCrossTime : 45);
  assert.equal(h.ctx.save.season.results[0].fl, '你'); assert.equal(h.ctx.save.season.results[0].you.pts, 26);
  resultEvidence('保留先前有效最快圈加分', h);
});

await verify('無效圈後下一個有效圈可正常取代最快圈', async () => {
  const h = fresh(); prepare(h); cross(h);
  h.field.raceTime = h.field.me.lapStart + 45; h.ctx.lapTime = 45; h.ctx.sectorIdx = 2; h.ctx.sectorStart = 30;
  assert.equal(h.ctx.lapValid, true); cross(h);
  assert.equal(h.field.me.laps, 3); near(h.field.me.lapStart, firstCrossTime + 45 + stepTime);
  near(h.field.me.bestLap, invalidBefore ? firstCrossTime : 45 + stepTime); near(h.ctx.save.gpBest, 45 + stepTime);
  if (!invalidBefore) assert.equal(h.ctx.save.gpBest, h.field.me.bestLap, '無效圈後的下一有效圈也必須使用同一時計');
  h.field.racers.filter((r) => !r.isPlayer).forEach((r, k) => { r.finish = 100 + k; });
  record(h); assert.equal(h.ctx.save.season.results[0].you.pts, 26);
  resultEvidence('下一個有效圈', h);
});

for (const last of [false, true]) await verify((last ? '最後' : '普通') + '無效圈經pause／checkpoint／重載後不能取得最快圈加分', async () => {
  const h = fresh(); prepare(h, { last }); h.ctx.pause();
  const saved = clone(h.storage.last);
  assert.equal(saved.season.pending.checkpoint.player.lapValid, false);
  const reload = harness(current, saved); reload.ctx.raceAudio = () => {};
  await reload.ctx.restoreSeasonCheckpoint();
  assert.equal(reload.ctx.state, 'race'); assert.equal(reload.ctx.lapValid, false); assert.equal(reload.field.me.bestLap, 60);
  cross(reload);
  if (last) await until(() => reload.ctx.state === 'podium' && reload.ctx.gpSettlementJob === null);
  else record(reload);
  assert.equal(reload.field.me.bestLap, invalidBefore ? firstCrossTime : 60);
  assert.equal(reload.ctx.save.gpBest, 60); assert.equal(reload.ctx.save.season.results[0].you.pts, invalidBefore ? 26 : 25);
  resultEvidence(last ? '最後無效圈重載' : '普通無效圈重載', reload);
});

await verify('直接playerLap省略有效性參數仍保持舊的有效圈行為', async () => {
  const h = fresh(); h.field.raceTime = 40; h.field.me.laps = 1; h.field.me.lapStart = 0; h.field.me.bestLap = 60;
  h.car.pos.s = 1; h.field.playerLap(h.track.length - 1);
  assert.equal(h.field.me.bestLap, 40); assert.equal(h.field.me.laps, 2); assert.equal(h.field.me.finish, null);
});

await verify('AI真field.update計圈仍更新最快圈，未受玩家有效性參數影響', async () => {
  const h = fresh(), ai = h.field.racers.find((r) => !r.isPlayer);
  h.field.raceTime = 40; ai.laps = 1; ai.lapStart = 0; ai.bestLap = 60;
  ai.car.pos.s = h.track.length - 1; ai.car.update = () => { ai.car.pos.s = 1; return 0; };
  h.field.update(1 / 120, true);
  assert.equal(ai.bestLap, 40 + 1 / 120); assert.equal(ai.laps, 2); assert.equal(ai.lapStart, h.field.raceTime);
});

await verify('無效圈不改計圈／完賽／timing／pit RNG等其他賽事快照', async () => {
  const snapshots = [];
  for (const valid of [true, false]) {
    const h = fresh(); h.field.raceTime = 40; h.field.me.laps = h.field.laps; h.field.me.lapStart = 0; h.field.me.bestLap = 60;
    h.car.pos.s = 1; h.field.playerLap(h.track.length - 1, valid);
    const s = clone(h.field.snapshot()), me = s.racers.find((r) => r.name === '你');
    assert.equal(me.laps, s.laps + 1); assert.equal(me.finish, 40); assert.equal(me.lapStart, 40);
    assert.equal(me.bestLap, valid || invalidBefore ? 40 : 60);
    me.bestLap = null; snapshots.push(s);
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
});

await verify('首次通過起跑線與20秒防重複計圈保持原行為', async () => {
  const h = fresh(); h.car.pos.s = 1; h.field.raceTime = 0;
  h.field.playerLap(h.track.length - 1, false);
  assert.equal(h.field.me.laps, 1); assert.equal(h.field.me.bestLap, null);
  h.field.raceTime = 10; h.field.playerLap(h.track.length - 1, false);
  assert.equal(h.field.me.laps, 1); assert.equal(h.field.me.lapStart, 0); assert.equal(h.field.me.bestLap, null);
});

export default evidence;
`;

const result = {
  baseline,
  checksPerVersion: 0,
  before: null,
  after: null,
  limitations: [
    '每版使用該版真main AST、RaceField、season、物理模組；DOM／音效／保存以記憶體隔離',
    '人工準備跨線與AI完賽fixture，未驗證完整駕駛、瀏覽器、WebGL或真實localStorage',
    '此腳本不取代正式build、Chrome流程與三項固定回歸；before是已知錯誤行為對照',
    'ABCD輪修正跨線fixture：RaceField與main均推進同一dt，仍驗證原2dee076無效最快圈錯領26分的before對照',
  ],
};
for (const [variant, root] of [['before', baseline], ['after', project]]) {
  const generated = new URL(`./.followup-racing-${randomUUID()}.mjs`, import.meta.url);
  const prefix = basePrefix
    .replace(environmentLine, `const env = await loadGameModules(${JSON.stringify(root)});`)
    .replace(sourceLine, `const current = await source(${JSON.stringify(root)}), old = {}; report.sourceHash = current.hash;`);
  try {
    await writeFile(generated, prefix + `\nconst variant = ${JSON.stringify(variant)}, targetRoot = ${JSON.stringify(root)};\n` + exercise);
    result[variant] = (await import(generated.href)).default;
  } finally { await unlink(generated).catch(() => {}); }
}
assert.equal(result.before.checks.length, result.after.checks.length);
assert.notEqual(result.before.hashes['rivals.ts'], result.after.hashes['rivals.ts'], '前後應為不同版本的RaceField');
result.checksPerVersion = result.after.checks.length;
await writeFile(new URL('./followup-racing-regression-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(`PASS ${result.checksPerVersion}項×before/after兩版；普通／最後／重載無效圈26→25分，有效圈維持26分。`);
