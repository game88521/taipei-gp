// 執行真main函式/AST分支，驗證街頭新玩法只tick/結算一次及續接保存；DOM/物理隔離。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const compile = (s) => stripTypeScriptTypes(s, { mode: 'transform' });
const url = (s) => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const raw = await readFile(resolve(root, 'src/main.ts'), 'utf8'), code = compile(raw), ast = parseAst(code);
const drift = await import(url(compile(await readFile(resolve(root, 'src/drift.ts'), 'utf8'))));
const identity = url(compile(await readFile(resolve(root, 'src/identity.ts'), 'utf8')));
const series = await import(url(compile(await readFile(resolve(root, 'src/street-series.ts'), 'utf8')).replace("'./identity'", JSON.stringify(identity))));
const fnNode = (name) => { const n = ast.body.find((q) => q.type === 'FunctionDeclaration' && q.id?.name === name); assert.ok(n, `找不到真main.${name}`); return n; };
const fn = (name) => { const n = fnNode(name); return code.slice(n.start, n.end); };
const report = { mainHash: createHash('sha256').update(raw).digest('hex'), checks: [], browserUsed: false,
  limitations: ['執行真main AST函式/分支，DOM、音效與物理用替身；不代表瀏覽器輸入、渲染、實際玩法平衡驗證。'] };
async function check(name, run) { try { await run(); report.checks.push({ name, pass: true }); } catch (e) { report.checks.push({ name, pass: false, error: String(e.stack ?? e).slice(0, 3000) }); } }
const clone = (x) => JSON.parse(JSON.stringify(x));
function harness(extra = {}) {
  const nodes = new Map(), $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, style: {}, textContent: '', innerHTML: '', children: [],
      classList: { add() {}, remove() {}, toggle() {} }, appendChild(n) { this.children.push(n); }, replaceChildren() { this.children = []; } });
    return nodes.get(id);
  };
  const context = vm.createContext({ console, $, document: { createElement: () => ({ appendChild() {}, textContent: '', className: '' }) },
    save: {}, stats: { earned: 0, trips: 0, streetWins: 0 }, mode: 'free', state: 'free', BOT: false, CIRCUIT: null,
    writeSave() {}, toast() {}, sound: { beep() {} }, ...extra });
  return { context, $, load(...names) { for (const name of names) vm.runInContext(fn(name), context); } };
}
const freeStep = fnNode('freeStep');
const driftBranch = freeStep.body.body.find((n) => n.type === 'BlockStatement' && code.slice(n.start, n.end).includes('driftChallenge.active ? driftChallenge.update'));
const taxiBranch = freeStep.body.body.find((n) => n.type === 'IfStatement' && code.slice(n.start, n.end).includes('const moneyBefore = taxi.money'));
assert.ok(driftBranch); assert.ok(taxiBranch);
await check('真main限時甩尾分支只呼叫共用scorer一次，finished不再重複發入帳', () => {
  const scorer = new drift.DriftScore(), challenge = new drift.DriftChallenge(scorer), records = {};
  let scoreTicks = 0, banked = 0, finishes = 0; const update = scorer.update.bind(scorer);
  scorer.update = (...args) => { scoreTicks++; return update(...args); };
  challenge.start(60, 'sedan', records);
  const h = harness({ drift: scorer, driftChallenge: challenge, driftPractice: false, dt: 0.02,
    fcar: { vx: 20, vz: 0, slip: 0.6 }, impact: 0,
    bankDrift(points) { banked += points; }, showDriftChallengeResult() { finishes++; } });
  const branch = code.slice(driftBranch.start, driftBranch.end);
  for (let i = 0; i < 3000; i++) { h.context.fcar = { vx: i % 400 < 260 ? 20 : 0, vz: 0, slip: i % 400 < 260 ? 0.6 : 0 }; vm.runInContext(branch, h.context); }
  assert.equal(scoreTicks, 3000); assert.equal(finishes, 1); assert.equal(banked, challenge.result.score); assert.ok(banked > 0);
  report.driftTicks = scoreTicks; report.bankedPoints = banked;
});
await check('真finishDrift：切玩法取消未入帳連擊，不將限時挑戰自動結算成額外獎金', () => {
  const scorer = new drift.DriftScore(), challenge = new drift.DriftChallenge(scorer); challenge.start(60, 'sedan', {});
  challenge.update(5, { vx: 20, vz: 0, slip: 0.6 }, 0); let banked = 0;
  const h = harness({ drift: scorer, driftChallenge: challenge, driftPractice: false, bankDrift(points) { banked += points; } }); h.load('finishDrift');
  h.context.finishDrift('bank'); h.context.finishDrift('bank'); assert.equal(banked, 0); assert.equal(challenge.active, false); assert.equal(scorer.total, 0);
});
await check('真main載客結算分支只記一次收入，不把settlement.total再加到錢包', () => {
  let updates = 0, consumed = 0, writes = 0, ledgers = 0, checkpointed = 0;
  const t = { money: 100, trips: 0, setCondition() {}, onHit() {}, update() { updates++; if (updates !== 1) return null; this.money += 200; this.trips++; return '💰 送達'; },
    consumeSettlement() { consumed++; return consumed === 1 ? { id: 'job', status: 'delivered', total: 200 } : null; } };
  const h = harness({ taxi: t, taxiOn: () => true, dt: 0.02, fcar: {}, impact: 0, damage: { speedMul: 1 },
    recordTransaction(_save, from, to) { ledgers++; assert.equal(to - from, 200); return []; }, refreshGarage() {}, updateTaxiResumeUi() {},
    checkpointTaxi() { checkpointed++; }, writeSave() { writes++; } });
  const branch = code.slice(taxiBranch.start, taxiBranch.end); vm.runInContext(branch, h.context); vm.runInContext(branch, h.context);
  assert.equal(t.money, 300); assert.equal(h.context.stats.earned, 200); assert.equal(h.context.stats.trips, 1); assert.equal(ledgers, 1); assert.equal(writes, 1); assert.equal(checkpointed, 1);
});
await check('真checkpointTaxi保留待續接原件；行程/錢包/有界結算ID同一save，abandon移除cp不發錢', () => {
  const original = { id: 'old' }, current = { id: 'current' }; let writes = 0, abandoned = 0;
  const t = { money: 300, trips: 2, settledIds: ['done'], checkpoint: () => current, abandon() { abandoned++; } };
  const h = harness({ taxi: t, taxiCheckpointPending: true, fcar: {}, writeSave() { writes++; }, updateTaxiResumeUi() {} }); h.context.save.taxiJob = original;
  h.load('checkpointTaxi', 'abandonTaxi'); h.context.checkpointTaxi(); assert.equal(h.context.save.taxiJob, original);
  h.context.taxiCheckpointPending = false; h.context.checkpointTaxi(); assert.equal(h.context.save.taxiJob, current);
  assert.deepEqual(clone(h.context.save.taxi), { money: 300, trips: 2 }); assert.deepEqual(clone(h.context.save.taxiSettled), ['done']);
  h.context.abandonTaxi(); assert.equal(h.context.save.taxiJob, undefined); assert.equal(t.money, 300); assert.equal(writes, 1); assert.equal(abandoned, 1);
});
await check('真showStreetResult重複呼叫僅一次獎金/勝場/系列完成，PB分類不覆寫舊紀錄', () => {
  const options = { difficulty: 'standard', carId: 'street-f1', rules: 'traffic' };
  const result = { ...options, id: 'run', routeId: 'route', key: series.streetChallengeKey('route', true, options), duel: true, finished: true, time: 20, place: 1, medal: 'gold' };
  let paid = 0, seriesFinishes = 0;
  const sr = { active: { def: { id: 'route', title: '測試路線' }, checkpoints: [1, 2] }, playerDone: 20, rivalDone: 25, duel: true,
    options, difficulty: 'standard', scopedRecordKey: result.key, validFinish: true, result,
    standings: () => [{ name: '你', isPlayer: true, done: 20 }, { name: '對手', isPlayer: false, done: 25 }], next: 2 };
  const h = harness({ sr, srShown: false, seriesRace: true, streetSeries: { active: true, checkpoint: { next: 1 }, finish() { seriesFinishes++; return true; } },
    STREET_DIFFICULTY: series.STREET_DIFFICULTY, recordStreetResult: series.recordStreetResult, updateStreetSeriesUi() {}, vehicleById: (id) => ({ id, name: id }),
    fmt: (n) => String(n), fmtNT: (n) => String(n), fmtDelta: (n) => String(n), earn(n) { paid += n; } });
  h.context.save.street = { 'duel:route': 5 }; h.load('showStreetResult'); h.context.showStreetResult(); h.context.showStreetResult();
  assert.equal(paid, 600); assert.equal(seriesFinishes, 1); assert.equal(h.context.stats.streetWins, 1);
  assert.equal(h.context.save.street['duel:route'], 5); assert.equal(h.context.save.streetChallenge[result.key].best, 20);
});
await check('真車款helper：預設統一/BOT強制統一；選車系列即使換chosen仍鎖原車', () => {
  const h = harness({ NO_TRAFFIC: false, chosen: { id: 'sedan' }, vehicleById: (id) => ({ id }), streetRecordKey: () => '' });
  h.load('currentStreetOptions', 'streetRacing', 'streetUsesF1', 'streetVehicle');
  h.$('duel-difficulty').value = 'standard'; h.$('duel-car-mode').value = 'unified'; h.context.sr = null;
  assert.equal(h.context.currentStreetOptions().carId, 'street-f1'); h.$('duel-car-mode').value = 'selected'; assert.equal(h.context.currentStreetOptions().carId, 'sedan');
  h.context.BOT = true; assert.equal(h.context.currentStreetOptions().carId, 'street-f1'); h.context.BOT = false;
  h.context.sr = { active: {}, phase: 'race', options: { carId: 'taxi' } }; h.context.chosen = { id: 'super' };
  assert.equal(h.context.streetVehicle().id, 'taxi'); assert.equal(h.context.streetUsesF1(), false);
  h.context.sr.options.carId = 'street-f1'; assert.equal(h.context.streetUsesF1(), true);
});
report.passed = report.checks.filter((c) => c.pass).length; report.failed = report.checks.length - report.passed;
await writeFile(resolve(root, 'tools/dev-tests/all-street-main.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
