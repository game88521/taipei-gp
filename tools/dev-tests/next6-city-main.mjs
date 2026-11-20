// 執行真 main AST 函式/事件/分支；DOM、聲音、城市系統使用替身。
// node tools/dev-tests/next6-city-main.mjs [--actual] [before]
// 只讀取實檔，不套補丁、不寫 main.ts。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import { pureUrl } from './pure-module-loader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// The inactive real controller leaves the original callback behavior intact.
const {VoyagerPhoto}=await import(await pureUrl(root,'voyager-photo.ts'));
const before = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? resolve(root, '../taipei-gp-next6-before-57b09b2'));
const compile = (s) => stripTypeScriptTypes(s, { mode: 'transform' });
const raw = await readFile(resolve(root, 'src/main.ts'), 'utf8');
const source = raw, memoryChanges = 0;
function main(text) {
  const code = compile(text), ast = parseAst(code), textOf = (n) => code.slice(n.start, n.end);
  const fnNode = (name) => ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
  return { code, ast, textOf, fn(name) { const n = fnNode(name); assert.ok(n, `main.${name}`); return textOf(n); }, fnNode,
    event(id, type = 'click') {
      const n = ast.body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
        && n.expression.callee.type === 'MemberExpression' && n.expression.callee.property.name === 'addEventListener'
        && n.expression.callee.object.type === 'CallExpression' && n.expression.callee.object.callee.name === '$'
        && n.expression.callee.object.arguments[0].value === id && n.expression.arguments[0].value === type);
      assert.ok(n, `事件 ${id}`); return textOf(n.expression.arguments[1]);
    } };
}
const current = main(source), old = main(await readFile(resolve(before, 'src/main.ts'), 'utf8'));
const driftUrl = `data:text/javascript;base64,${Buffer.from(compile(await readFile(resolve(root, 'src/drift.ts'), 'utf8'))).toString('base64')}`;
const { DriftScore } = await import(driftUrl);
const performanceRules = await import(await pureUrl(root, 'street-performance.ts'));
const { CityEntryIntent } = await import(await pureUrl(root, 'city-entry-intent.ts'));
const report = { before, mainHash: createHash('sha256').update(source).digest('hex'), memoryChanges, actualMain: true,
  checks: [], browserUsed: false, playerStorageTouched: false,
  limitations: ['執行真main函式/事件/分支；DOM、聲音與城市系統用替身，未驗WebGL、手機、實際音質。'] };
async function check(name, run) { try { await run(); report.checks.push({ name, pass: true }); } catch (e) { report.checks.push({ name, pass: false, error: String(e.stack ?? e) }); } }
function harness(module = current, extra = {}) {
  const nodes = new Map(), calls = { paid: 0, writes: 0, saved: 0, clocks: 0, cancelled: 0, menus: 0, starts: 0, hits: [], banks: 0, lost: 0, taxiHits: [], damage: [], engine: [], siren: [], toasts: [] };
  const $ = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set(['hidden']);
      nodes.set(id, { style: {}, hidden: false, children: [], textContent: '', innerHTML: '', className: '',
        classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle() {} },
        appendChild(n) { this.children.push(n); }, replaceChildren() { this.children = []; } });
    }
    return nodes.get(id);
  };
  const route = { def: { id: 'a', title: '路線A', rival: '對手' }, checkpoints: [1, 2] }, options = { difficulty: 'standard', carId: 'street-f1', rules: 'traffic' };
  const sr = { active: route, phase: 'done', playerDone: 20, rivalDone: 25, duel: false, options, difficulty: 'standard', scopedRecordKey: 'key', validFinish: true,
    result: { ...options, key: 'key', time: 20, medal: 'gold' }, standings: () => [{ name: '你', isPlayer: true, done: 20 }, { name: '對手', done: 25 }],
    cancel() { calls.cancelled++; this.active = null; this.phase = 'idle'; }, challenges: [route] };
  const context = vm.createContext({ voyagerPhoto: new VoyagerPhoto({canOpen:()=>false}), summitCityRace: undefined, summitDuty: undefined, nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, horizonUi: null, horizonCity: null, evolutionOwned: false, cityChallengeOpenToken: null, console, $, document: { createElement: () => ({ appendChild() {}, textContent: '', className: '' }), querySelector: () => null },
    sr, srShown: false, seriesRace: false, streetSeriesStartToken: null, streetSeries: { checkpoint: { id: 'series-a', rules: 'traffic' }, nextRouteId: 'a', active: true },
    state: 'free', pausedFrom: 'free', mode: 'free', BOT: false, CIRCUIT: null, NO_TRAFFIC: false, FREE_SIM: false, WANTED_TEST: false,
    ...performanceRules, cityEntryIntent: new CityEntryIntent(), cityJobsUi: undefined, racingTools: undefined, practiceRun: undefined, practiceUi: undefined, practiceIntent: 0,
    save: {}, stats: { earned: 0, trips: 0, streetWins: 0 }, chosen: { id: 'sedan' }, menu: $('menu'), hud: $('hud'),
    clock: { getDelta() { calls.clocks++; return 0.1; } }, input: { release() { calls.inputReleases = (calls.inputReleases ?? 0) + 1; } },
    sound: { engine(...a) { calls.engine.push(a); }, sirenAt(...a) { calls.siren.push(a); }, beep() {}, hit(...a) { calls.hits.push(a); } },
    writeSave() { calls.writes++; }, saveFreePos() { calls.saved++; }, saveSeasonCheckpoint() {},
    earn(n) { calls.paid += n; }, toast(...a) { calls.toasts.push(a); }, finishDrift() { calls.banks++; },
    hideMenu() { $('menu').classList.add('hidden'); }, showMenu() { calls.menus++; $('menu').classList.remove('hidden'); },
    userStart: async () => { calls.starts++; }, ensureStreetSystems: async () => true,
    beginFree() { context.state = 'free'; }, field: { hide() {} }, updateStreetSeriesUi() {},
    recordStreetResult(records, r) { records[r.key] = { best: r.time }; }, STREET_DIFFICULTY: { standard: { label: '標準' } },
    vehicleById: (id) => ({ id, name: id }), fmt: String, fmtNT: String, fmtDelta: String,
    damage: { useVehicle() {}, speedMul: 1, hit(n) { calls.damage.push(n); } }, ...extra });
  // Keep old collision fixtures result-free while executing the new career observer itself.
  if (context.police && !context.police.consumeDutyResult) context.police.consumeDutyResult = () => null;
  if (module.code.includes('function syncPoliceCareer(')) vm.runInContext(module.fn('syncPoliceCareer'), context);
  if (module.code.includes('function streetRulesLabel(')) vm.runInContext(module.fn('streetRulesLabel'), context);
  return { context, $, calls, load(...names) { for (const name of names) vm.runInContext(module.fn(name), context); },
    event(id) { return vm.runInContext(`(${module.event(id)})()`, context); } };
}
function loadResults(h) { h.load('streetResultOpen', 'cancelPendingStreetSeriesStart', 'resumeStreetResult', 'showStreetResult', 'pause', 'goBack', 'startStreetSeriesNext'); }
await check('before重現：街賽結算仍為free，沒有停止持續聲音', () => {
  const h = harness(old); h.load('showStreetResult'); h.context.showStreetResult();
  assert.equal(h.context.state, 'free'); assert.equal(h.calls.engine.length, 0); assert.equal(h.$('sr-result').classList.contains('hidden'), false);
});
await check('結算只發一次獎勵，立即paused、關持續聲音且只顯示成績頁', () => {
  const h = harness(); loadResults(h); h.context.showStreetResult(); h.context.showStreetResult();
  assert.equal(h.context.state, 'paused'); assert.equal(h.context.pausedFrom, 'free'); assert.equal(h.calls.paid, 300); assert.equal(h.context.stats.streetWins, 1);
  assert.equal(h.calls.writes, 1); assert.equal(h.calls.saved, 1); assert.deepEqual(h.calls.engine, [[0, 0, false]]); assert.deepEqual(h.calls.siren, [[0, 0]]);
  assert.equal(h.$('sr-result').classList.contains('hidden'), false); assert.equal(h.$('menu').classList.contains('hidden'), true);
});
await check('結果期間返回/暫停/繼續/顯示選單不穿透；物理不tick、城市視覺dt歸0', async () => {
  const h = harness(); loadResults(h); h.load('showMenu'); h.context.showStreetResult();
  assert.equal(h.context.goBack(), true); h.context.pause(); await h.event('btn-resume'); h.context.showMenu(true);
  assert.equal(h.context.state, 'paused'); assert.equal(h.calls.starts, 0); assert.equal(h.$('menu').classList.contains('hidden'), true);
  const frame = current.ast.body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.type === 'MemberExpression' && n.expression.callee.property.name === 'setAnimationLoop').expression.arguments[0];
  const simulation = frame.body.body.find((n) => n.type === 'IfStatement' && current.textOf(n).includes('freeStep(sub)'));
  const freeze = frame.body.body.find((n) => n.type === 'IfStatement' && current.textOf(n).includes('streetResultOpen()') && current.textOf(n).includes('dt = 0'));
  let ticks = 0; Object.assign(h.context, { dt: 0.1, mapOpen: false, STEP: 1 / 120, freeStep() { ticks++; }, step() { ticks++; } });
  vm.runInContext(current.textOf(simulation), h.context); vm.runInContext(current.textOf(freeze), h.context);
  assert.equal(ticks, 0); assert.equal(h.context.dt, 0);
});
await check('OK回自由駕駛，解除結果、取消舊賽及重設時鐘；重複點擊無額外處理', () => {
  const h = harness(); loadResults(h); h.context.showStreetResult(); h.event('sr-ok'); h.event('sr-ok');
  assert.equal(h.context.state, 'free'); assert.equal(h.$('sr-result').classList.contains('hidden'), true); assert.equal(h.$('menu').classList.contains('hidden'), true);
  assert.equal(h.calls.cancelled, 1); assert.equal(h.calls.clocks, 1); assert.equal(h.calls.paid, 300);
});
await check('再來一場保留原路線與車規則，回free後重新倒數', () => {
  const starts = [], h = harness(current, { acceptChallenge(...a) { starts.push(a); h.context.sr.phase = 'count'; } }); loadResults(h);
  const route = h.context.sr.active; h.context.showStreetResult(); h.event('sr-again');
  assert.equal(h.context.state, 'free'); assert.equal(h.context.sr.phase, 'count'); assert.equal(h.calls.clocks, 1); assert.equal(starts.length, 1);
  assert.equal(starts[0][0], route); assert.equal(starts[0][2].carId, 'street-f1'); assert.equal(h.$('sr-result').classList.contains('hidden'), true);
});
await check('系列下一站準備中仍停在結果，拒絕/規則不符可重試，成功才起跑', async () => {
  let reject = true, release, begins = 0, prepared;
  const ready = new Promise((r) => { prepared = r; });
  const h = harness(current, { userStart: async () => { if (reject) throw new Error('controlled failure'); }, ensureStreetSystems: () => new Promise((r) => { release = r; prepared(); }),
    beginFree() { begins++; h.context.state = 'free'; }, acceptChallenge() { h.context.sr.phase = 'count'; } }); loadResults(h); h.context.showStreetResult();
  await h.context.startStreetSeriesNext(); assert.equal(h.context.state, 'paused'); assert.equal(h.$('sr-result').classList.contains('hidden'), false); assert.equal(begins, 0);
  reject = false; const pending = h.context.startStreetSeriesNext(); await ready;
  assert.equal(h.context.state, 'paused'); assert.equal(h.$('sr-result').classList.contains('hidden'), false); release(false); await pending;
  h.context.ensureStreetSystems = async () => true; h.context.streetSeries.checkpoint.rules = 'clear'; await h.context.startStreetSeriesNext();
  assert.equal(h.context.state, 'paused'); assert.equal(h.$('sr-result').classList.contains('hidden'), false);
  h.context.streetSeries.checkpoint.rules = 'traffic'; await h.context.startStreetSeriesNext();
  assert.equal(begins, 1); assert.equal(h.context.state, 'free'); assert.equal(h.context.sr.phase, 'count'); assert.equal(h.$('sr-result').classList.contains('hidden'), true); assert.equal(h.calls.clocks, 1);
});
await check('系列await→OK→resolve不覆蓋自由駕駛；重複點下一站只送出一個準備', async () => {
  let resolvePreparation, prepared, preparations = 0, starts = 0;
  const ready = new Promise((r) => { prepared = r; });
  const h = harness(current, { ensureStreetSystems: () => { preparations++; return new Promise((r) => { resolvePreparation = r; prepared(); }); },
    acceptChallenge() { starts++; } }); loadResults(h); h.context.showStreetResult();
  const pending = h.context.startStreetSeriesNext(); await ready; await h.context.startStreetSeriesNext();
  assert.equal(preparations, 1); assert.equal(h.calls.starts, 1); h.event('sr-ok');
  assert.equal(h.context.streetSeriesStartToken, null); assert.equal(h.context.state, 'free');
  resolvePreparation(true); await pending;
  assert.equal(starts, 0); assert.equal(h.context.state, 'free'); assert.equal(h.context.sr.active, null); assert.equal(h.calls.clocks, 1);
});
await check('系列await期間再賽/切模式/改系列都使舊操作失效', async () => {
  for (const action of ['again', 'mode', 'series']) {
    let release, prepared, starts = 0;
    const ready = new Promise((r) => { prepared = r; });
    const h = harness(current, { ensureStreetSystems: () => new Promise((r) => { release = r; prepared(); }), acceptChallenge() { starts++; h.context.sr.phase = 'count'; } });
    loadResults(h); h.context.showStreetResult(); const pending = h.context.startStreetSeriesNext(); await ready;
    if (action === 'again') h.event('sr-again');
    else if (action === 'mode') { h.context.state = 'race'; h.context.mode = 'race'; h.$('sr-result').classList.add('hidden'); }
    else h.context.streetSeries.checkpoint = { id: 'new-series', rules: 'traffic' };
    release(true); await pending;
    assert.equal(starts, action === 'again' ? 1 : 0); assert.equal(h.context.streetSeriesStartToken, null);
    if (action === 'mode') { assert.equal(h.context.state, 'race'); assert.equal(h.context.mode, 'race'); }
  }
});
await check('取消後的新啟動鎖不被舊promise的finally清掉', async () => {
  const releases = [], entered = [], starts = [];
  const h = harness(current, { ensureStreetSystems: () => new Promise((r) => { releases.push(r); entered.shift()?.(); }), acceptChallenge() { starts.push('race'); } });
  loadResults(h); h.context.showStreetResult();
  const firstReady = new Promise((r) => entered.push(r)), first = h.context.startStreetSeriesNext(); await firstReady; h.event('sr-ok');
  const secondReady = new Promise((r) => entered.push(r)), second = h.context.startStreetSeriesNext(); await secondReady;
  const secondToken = h.context.streetSeriesStartToken; releases[0](true); await first;
  assert.equal(h.context.streetSeriesStartToken, secondToken); await h.context.startStreetSeriesNext(); assert.equal(releases.length, 2);
  releases[1](true); await second; assert.equal(starts.length, 1); assert.equal(h.context.streetSeriesStartToken, null);
});
await check('真freeStep手動步進不能推進已開啟的結果頁', () => {
  const h = harness(); loadResults(h); h.context.showStreetResult();
  // 真函式第一個guard會先返回，下面的damage等系統不得讀取。
  h.context.damage = new Proxy({}, { get() { throw new Error('結果頁仍進入物理'); } }); h.load('freeStep'); h.context.freeStep(0.1);
});
await check('衝線同一步已產生的牆/軟物/車撞先扣車損並斷甩尾，才暫停；不再推進其他城市系統', () => {
  for (const [wall, soft, rival, expected] of [[8, 0, 0, 8], [0, 8, 0, 2.8], [0, 0, 8, 8]]) {
    const scorer = new DriftScore(), events = [], fcar = { x: 0, z: 0, h: 0, y: -0.25, v: 20, vx: 20, vz: 0, slip: 0.6, touch: false,
      update() { events.push('physics'); this.x += 1; return wall; } };
    scorer.update(1, fcar, 0); assert.ok(scorer.total >= 100);
    const update = scorer.update.bind(scorer); scorer.update = (...a) => { events.push('drift'); return update(...a); };
    const fail = () => { throw new Error('結算後仍推進城市'); };
    const h = harness(current, { fcar, drift: scorer, driftChallenge: { active: false }, driftPractice: false, posSaveAcc: 0, heavyAcc: 0.1,
      streetRacing: () => true, streetVehicle: () => ({ spec: {} }), streetUsesF1: () => true, DEFAULT_SPEC: {}, PURSUIT_TEST: false, HONK_TEST: false,
      input: { read: () => ({ steer: 0, brake: false, throttle: true }) }, collider: null, onGround: () => true,
      breakables: { hit: () => soft }, traffic: { update: fail, collidePlayer: fail }, peds: { update: fail }, police: { update: fail }, pedzones: { at: fail },
      sound: { hit(...a) { h.calls.hits.push(a); }, scrape() {}, squeal() {}, engine() {}, sirenAt() {} },
      lastHitSound: 0, performance: { now: () => 1000 }, bankDrift() { events.push('bank'); },
      damage: { speedMul: 1, useVehicle() {}, hit(n) { events.push('damage'); h.calls.damage.push(n); } },
      saveFreePos() { events.push('save'); assert.equal(scorer.active, false); assert.equal(scorer.total, 0); } });
    loadResults(h); h.load('freeStep', 'finishDrift');
    h.context.sr.phase = 'race'; h.context.sr.update = () => { h.context.sr.phase = 'done'; return null; }; h.context.sr.collide = () => rival;
    h.context.freeStep(0.02);
    assert.equal(h.context.state, 'paused'); assert.deepEqual(h.calls.damage, [expected]); assert.equal(scorer.active, false);
    assert.ok(events.indexOf('damage') < events.indexOf('save')); assert.ok(events.indexOf('drift') < events.indexOf('save')); assert.equal(h.context.heavyAcc, 0.1);
    assert.equal(h.calls.hits.length, 1); h.event('sr-ok'); assert.equal(events.includes('bank'), false, '撞毀的連擊不能按OK入帳');
  }
});
await check('before漏接警車撞擊；新版真管線只向音效/車損/甩尾/計程車各送一次', () => {
  const policeBranch = (m) => {
    const candidates = [];
    function visit(n) { if (!n || typeof n !== 'object') return; if (n.type === 'IfStatement' && m.textOf(n).includes('police.update(')) candidates.push(n); for (const [key, value] of Object.entries(n)) if (key !== 'parent') { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); } }
    visit(m.fnNode('freeStep')); return candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  };
  const extra = { police: { stars: 0, update: () => ({ playerImpact: 8, msg: null, money: 0 }) }, fcar: { vx: 20, vz: 0, slip: 0.6, x: 0, z: 0, h: 0 }, collider: null, traffic: null,
    streetRacing: () => false, impact: 2, carHit: 1, dt: 0.02, hardHit: 2, trafficHit: 0, pedHit: false, knockHit: 0, lastHitSound: 0, performance: { now: () => 1000 } };
  const b = harness(old, extra); vm.runInContext(old.textOf(policeBranch(old)), b.context); assert.equal(b.context.impact, 2); assert.equal(b.context.carHit, 1);
  const h = harness(current, extra), scorer = new DriftScore(); scorer.update(1, extra.fcar, 0);
  Object.assign(h.context, { drift: scorer, driftPractice: false, driftChallenge: { active: false }, bankDrift() {},
    taxiOn: () => true, taxi: { money: 0, trips: 0, phase: 'ride', setCondition() {}, onHit(n) { h.calls.taxiHits.push(n); }, update: () => null, consumeSettlement: () => null } });
  vm.runInContext(current.textOf(policeBranch(current)), h.context); assert.equal(h.context.impact, 8); assert.equal(h.context.carHit, 8);
  const nodes = current.fnNode('freeStep').body.body;
  const selected = nodes.filter((n) => { const s = current.textOf(n); return (n.type === 'IfStatement' && (s.includes('lastHitSound > 120') || s.includes('damage.hit(dmgHit') || s.includes('const moneyBefore = taxi.money')))
    || (n.type === 'VariableDeclaration' && s.includes('const dmgHit')) || (n.type === 'BlockStatement' && s.includes('driftChallenge.active ? driftChallenge.update')); });
  assert.equal(selected.length, 5); for (const n of selected) vm.runInContext(current.textOf(n), h.context);
  assert.deepEqual(h.calls.hits, [[20, 'car']]); assert.deepEqual(h.calls.damage, [8]); assert.deepEqual(h.calls.taxiHits, [8]); assert.equal(scorer.active, false);
  const dmg = nodes.find((n) => n.type === 'VariableDeclaration' && current.textOf(n).includes('const dmgHit'));
  const equal = vm.createContext({ voyagerPhoto: new VoyagerPhoto({canOpen:()=>false}), summitCityRace: undefined, summitDuty: undefined, nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, evolutionOwned: false, cityChallengeOpenToken: null, hardHit: 0, trafficHit: 0, knockHit: 8, impact: 8, carHit: 8 });
  vm.runInContext(current.textOf(dmg), equal); assert.equal(vm.runInContext('dmgHit', equal), 8, '車撞不能因恰與路燈同值而只算35%');
});
report.passed = report.checks.filter((c) => c.pass).length; report.failed = report.checks.length - report.passed;
await writeFile(resolve(root, 'tools/dev-tests/next6-city-main.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
