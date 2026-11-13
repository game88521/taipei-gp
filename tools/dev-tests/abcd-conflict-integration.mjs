// 真 main.ts AST：衝突時必須取消背景結算，晚到的成功／失敗不得再結算賽季或播頒獎音。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = await readFile(path.join(project, 'src/main.ts'), 'utf8');
const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
function extract(name) {
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) return code.slice(node.start, node.end);
    if (node.type === 'VariableDeclaration') for (const value of node.declarations) {
      if (value.id.type === 'Identifier' && value.id.name === name && value.init) return `var ${name} = ${code.slice(value.init.start, value.init.end)};`;
    }
  }
  throw Error(`main.ts 缺少 ${name}`);
}
const real = Object.fromEntries(['completeGpResults', 'stopForSaveConflict', 'pause', 'settleRace', 'startPodium'].map((name) => [name, extract(name)]));
const report = { sourceHash: createHash('sha256').update(raw).digest('hex'), usesRealMainAst: true,
  browserUsed: false, playerStorageTouched: false, cases: [],
  limitations: ['真main控制流程；field背景Promise、DOM、音訊及保存用隔離替身。', '不代表WebGL／完整車陣／手機測試。'] };
function element() {
  const classes = new Set(['hidden']);
  return { hidden: false, textContent: '', innerHTML: '', className: '', dataset: {}, style: { setProperty() {} }, children: [],
    classList: { add: (x) => classes.add(x), remove: (x) => classes.delete(x), contains: (x) => classes.has(x) },
    append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); } };
}
function harness() {
  const nodes = new Map(), get = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const events = { abortSignals: 0, rewards: 0, checkpoints: 0, writes: 0, records: 0, beeps: 0, podiums: 0, loopStops: 0, conflictPanels: 0, errors: [] };
  const controls = {};
  const me = { name: '你', isPlayer: true, color: '#f00', team: '測試隊', finish: 60 };
  const field = {
    raceTime: 65, me,
    standings: () => [me], hide() {},
    finishRemainderAsync(options) {
      controls.signal = options.signal;
      options.signal.addEventListener('abort', () => events.abortSignals++, { once: true });
      return new Promise((resolve, reject) => { controls.resolve = resolve; controls.reject = reject; });
    },
  };
  const ctx = vm.createContext({
    AbortController, console: { error: (...args) => events.errors.push(args.map(String).join(' ')) },
    state: 'race', mode: 'race', raceKind: 'gp', gpSettlementJob: null, settled: null, writerPhase: 'ready',
    getSaveWriterState: () => ({ phase: ctx.writerPhase }),
    $: get, document: { createElement: element }, hud: get('hud'), field, track: { length: 3100 }, CIRCUIT: null,
    sound: { engine() {}, sirenAt() {}, beep() { events.beeps++; } }, radio: { hide() {} }, scBanner() {},
    renderer: { setAnimationLoop(value) { assert.equal(value, null); events.loopStops++; } },
    showSaveWriterConflict() { events.conflictPanels++; }, leaveQuali() { throw Error('不應誤走排位取消'); },
    inSeasonRound: () => false, rewardGpFinish() { events.rewards++; }, saveSeasonCheckpoint() { events.checkpoints++; },
    recordSeason() { events.records++; }, writeSave() { events.writes++; },
    saveFreePos() {}, showMenu() {}, pausedFrom: 'race', podium: null, podiumT: 0,
    Podium: class { show() { events.podiums++; } }, scene: {}, TEAMS: [], PLAYER_LIVERY: { helmet: '#fff' },
    setTimeout(callback) { callback(); return 1; },
  });
  for (const source of Object.values(real)) vm.runInContext(source, ctx);
  return { ctx, events, controls, get };
}
async function test(name, action) {
  try { const detail = await action(); report.cases.push({ name, status: 'PASS', detail }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); }
}

await test('ready寫入者不誤取消既有結算或停止renderer', async () => {
  const h = harness(), job = new AbortController(); h.ctx.gpSettlementJob = job; h.ctx.state = 'settling';
  h.ctx.stopForSaveConflict();
  assert.equal(job.signal.aborted, false); assert.equal(h.ctx.gpSettlementJob, job);
  assert.equal(h.events.loopStops, 0); assert.equal(h.events.conflictPanels, 0);
  return { aborted: false, loopStops: 0 };
});

for (const completion of ['resolve', 'reject']) await test(`blocked結算即使稍後${completion}仍不得頒獎／記賽季／beep`, async () => {
  const h = harness(), promise = h.ctx.completeGpResults();
  const job = h.ctx.gpSettlementJob; assert.ok(job); assert.equal(h.ctx.state, 'settling');
  h.ctx.pause(); // 真pause對settling不做事，必須靠conflict handler明確abort。
  assert.equal(job.signal.aborted, false); assert.equal(h.ctx.state, 'settling');
  h.ctx.writerPhase = 'blocked'; h.ctx.stopForSaveConflict();
  assert.equal(job.signal.aborted, true); assert.equal(h.ctx.gpSettlementJob, null);
  assert.equal(h.events.abortSignals, 1); assert.equal(h.events.loopStops, 1); assert.equal(h.events.conflictPanels, 1);
  if (completion === 'resolve') h.controls.resolve([]); else h.controls.reject(new Error('取消後晚到的背景失敗'));
  await promise;
  for (const name of ['checkpoints', 'writes', 'records', 'beeps', 'podiums']) assert.equal(h.events[name], 0, name);
  assert.equal(h.events.errors.length, 0); assert.equal(h.get('gp-settle-retry').hidden, true);
  assert.equal(h.ctx.state, 'settling');
  return { completion, aborted: job.signal.aborted, jobCleared: h.ctx.gpSettlementJob === null, ...h.events };
});

await test('未衝突正常完成作正對照：真startPodium會記賽季與四次beep', async () => {
  const h = harness(), promise = h.ctx.completeGpResults(); h.controls.resolve([]); await promise;
  assert.deepEqual(h.events.errors, []);
  assert.equal(h.ctx.state, 'podium'); assert.equal(h.ctx.gpSettlementJob, null);
  assert.equal(h.events.podiums, 1); assert.equal(h.events.records, 1); assert.equal(h.events.beeps, 4);
  assert.equal(h.events.writes, 1); assert.equal(h.events.checkpoints, 1); assert.equal(h.events.abortSignals, 0);
  assert.equal(h.events.loopStops, 0); return h.events;
});

report.summary = { passed: report.cases.filter((item) => item.status === 'PASS').length, failed: report.cases.filter((item) => item.status === 'FAIL').length };
await writeFile(path.join(project, 'tools/dev-tests/shots-abcd-conflict-integration.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.summary.failed) process.exitCode = 1;
