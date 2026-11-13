// 執行真 main.ts AST 的交易與任務切換；只隔離 DOM、物理更新與玩家存檔。
// node tools/dev-tests/main-economy-integration.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = path.resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? path.resolve(root, '../taipei-gp-priority-before-20261111'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const dataURL = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const economy = await import(dataURL(stripTypeScriptTypes(await readFile(path.join(root, 'src/economy.ts'), 'utf8'), { mode: 'transform' })));
function walk(node, match) {
  if (!node || typeof node !== 'object') return null;
  if (match(node)) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) { const found = walk(child, match); if (found) return found; } }
    else if (value && typeof value === 'object') { const found = walk(value, match); if (found) return found; }
  }
  return null;
}
async function mainSource(base) {
  const raw = await readFile(path.join(base, 'src/main.ts'), 'utf8');
  const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
  const slice = (node) => { if (!node) throw Error('main.ts 缺少測試入口'); return code.slice(node.start, node.end); };
  const fnNode = (name) => ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
  const eventCall = (scope, matchTarget, event) => walk(scope, (n) => n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.property?.name === 'addEventListener' && n.arguments[0]?.value === event && matchTarget(n.callee.object));
  return {
    hash: createHash('sha256').update(raw).digest('hex'),
    fn: (name) => slice(fnNode(name)),
    event(id, event = 'click') { return slice(eventCall(ast, (n) => n.type === 'CallExpression' && n.callee?.name === '$' && n.arguments[0]?.value === id, event)?.arguments[1]); },
    swatch() { return slice(eventCall(fnNode('refreshGarage'), (n) => n.type === 'Identifier' && n.name === 'sw', 'click')?.arguments[1]); },
    taxi() { return slice(fnNode('freeStep').body.body.find((n) => n.type === 'IfStatement' && walk(n.consequent, (x) => x.type === 'VariableDeclarator' && x.id?.name === 'moneyBefore'))); },
    police() { return slice(fnNode('freeStep').body.body.find((n) => n.type === 'IfStatement' && n.test.type === 'Identifier' && n.test.name === 'police')); },
    pursuitKey() { return slice(walk(ast, (n) => n.type === 'CallExpression' && n.callee?.name === 'addEventListener' && n.arguments[0]?.value === 'keydown' && walk(n.arguments[1], (x) => x.type === 'Literal' && x.value === 'KeyG'))?.arguments[1]); },
  };
}
const current = await mainSource(root), old = await mainSource(baseline);
const vehiclesCode = stripTypeScriptTypes(await readFile(path.join(root, 'src/vehicles.ts'), 'utf8'), { mode: 'transform' });
const priceNode = walk(parseAst(vehiclesCode), (n) => n.type === 'VariableDeclarator' && n.id?.name === 'PAINT_PRICE');
const priceSource = vehiclesCode.slice(priceNode.init.start, priceNode.init.end);
const inputCode = stripTypeScriptTypes(await readFile(path.join(root, 'src/input.ts'), 'utf8'), { mode: 'transform' });
const interactiveNode = walk(parseAst(inputCode), (n) => n.type === 'FunctionDeclaration' && n.id?.name === 'isInteractiveTarget');
const interactiveSource = inputCode.slice(interactiveNode.start, interactiveNode.end);
const report = { sourceHash: current.hash, baselineRoot: baseline, baselineHash: old.hash, cases: [], before: {}, after: {}, browserUsed: false, playerStorageTouched: false,
  limitations: ['執行真 main.ts AST 事件、交易函式與 freeStep 交易區塊，收支模組為真實來源。', '車流、警方回傳、載客結算及 DOM 為隔離依賴；未驗證實際駕駛、WebGL或手機。'] };
async function test(name, action) {
  try { await action(); report.cases.push({ name, status: 'PASS' }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).slice(0, 5000) }); }
}
function harness(source = current, initialMoney = 1000) {
  const elements = new Map(), get = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', style: {}, classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const events = { writes: [], toasts: [], paints: [], pursuits: 0, cancelled: [], repairs: 0 };
  const save = { best: null, sectors: [null, null, null], ghost: null, opts: {}, taxi: { money: initialMoney, trips: 0 }, owned: ['sedan', 'police'], ledger: [], season: { pending: {} } };
  const pv = { baseColor: '#ffffff', setPaint(color) { events.paints.push(color); } };
  const taxi = { money: initialMoney, trips: 0, settledIds: [], checkpoint: () => null, consumeSettlement: () => null,
    setCondition() {}, onHit() {}, update() { return null; } };
  const ctx = vm.createContext({ console, Date, Math, Set, performance, Element: class {}, $: get, events, save, taxi, ...economy,
    stats: { earned: 0, gpWins: 0, trips: 0, escapes: 0, maxEscaped: 0, busted: 0, arrests: 0 },
    chosen: { id: 'sedan', name: '街道房車', price: 0 }, preview: { id: 'sedan', name: '街道房車', price: 0 }, pendingPaint: null,
    playerCars: new Map([['sedan', pv], ['police', pv]]), c: '#ff0000', free: false, bought: new Set(), pv,
    ownedCars: () => new Set(save.owned), refreshGarage() {}, finishDrift() {},
    damage: { speedMul: 1, refreshPaint() {}, useVehicle() {}, snapshot: () => ({}), repair() { events.repairs++; } },
    writeSave() { events.writes.push(clone(save)); }, toast: (m) => events.toasts.push(m), fmtNT: (n) => `NT$ ${n}`,
    sound: { beep() {}, engine() {}, sirenAt() {} }, raceKind: 'gp', gpRewarded: false, prizeNote: '',
    field: { laps: 3, standings: () => [{ isPlayer: true }, { isPlayer: false }] },
    inSeasonRound: () => true, saveSeasonCheckpoint() { events.writes.push(clone(save)); },
    state: 'free', mode: 'free', pausedFrom: 'free', streetRacing: () => false, taxiOn: () => false,
    saveFreePos() {}, showMenu() {}, hideMenu() {}, userStart: async () => {}, clock: { getDelta() {} },
    police: null, nav: null, fcar: {}, collider: null, traffic: null, trafficHit: 0, pedHit: false,
    dt: 0.02, FREE_SIM: false, WANTED_TEST: false, NO_TRAFFIC: false, policeLog: [], impact: 0,
    taxiCheckpointPending: false, updateTaxiResumeUi() {},
  });
  vm.runInContext(`var PAINT_PRICE = ${priceSource};`, ctx);
  for (const name of ['money', 'setMoney', 'earn']) vm.runInContext(source.fn(name), ctx);
  if (source === current) { vm.runInContext(interactiveSource, ctx); vm.runInContext(current.fn('gameShortcut'), ctx); vm.runInContext(current.fn('checkpointTaxi'), ctx); }
  return { ctx, events, get, save, taxi, source, run(code) { return vm.runInContext(code, ctx); }, callback(name, code) { vm.runInContext(`var ${name} = ${code};`, ctx); return ctx[name]; } };
}
function pursuit(h) {
  h.ctx.chosen = { id: 'police' };
  h.ctx.police = { suspect: {}, active: true, wanted: false, stars: 0,
    endPursuit(reason) { h.events.cancelled.push(reason); this.suspect = null; this.active = false; },
    startPursuit() { h.events.pursuits++; this.suspect = {}; this.active = true; return '追緝啟動'; },
  };
}

await test('烤漆真色票callback：舊版點選扣款，新版僅試色；確認只一筆，重複確認不重扣', () => {
  const before = harness(old), after = harness();
  before.callback('swatch', old.swatch())(); after.callback('swatch', current.swatch())();
  assert.equal(before.ctx.money(), 1000 - before.ctx.PAINT_PRICE);
  assert.equal(after.ctx.money(), 1000); assert.equal(after.save.ledger.length, 0); assert.equal(after.events.paints.length, 0);
  assert.deepEqual(clone(after.ctx.pendingPaint), { id: 'sedan', color: '#ff0000' });
  const confirm = after.callback('confirmPaint', current.event('paint-apply'));
  confirm(); confirm(); confirm();
  assert.equal(after.ctx.money(), 1000 - after.ctx.PAINT_PRICE); assert.equal(after.save.ledger.length, 1);
  assert.equal(after.save.ledger[0].amount, -after.ctx.PAINT_PRICE); assert.equal(after.save.ledger[0].reason, '烤漆購買');
  assert.equal(after.events.paints.length, 1); assert.equal(after.ctx.pendingPaint, null);
  report.before.swatchMoney = before.ctx.money(); report.after.swatchMoney = 1000; report.after.confirmedPaintTransactions = 1;
});

await test('已購或原廠烤漆免費套用；餘額不足及取消試色不產生交易', () => {
  const h = harness(), confirm = h.callback('confirmPaint', current.event('paint-apply'));
  for (const color of ['#ffffff', '#00ff00']) {
    h.save.paints = { sedan: ['#00ff00'] }; h.ctx.pendingPaint = { id: 'sedan', color }; confirm();
  }
  assert.equal(h.save.ledger.length, 0); assert.equal(h.ctx.money(), 1000);
  const poor = harness(current, 100); poor.ctx.pendingPaint = { id: 'sedan', color: '#ff0000' };
  poor.callback('confirmPaint', current.event('paint-apply'))(); assert.equal(poor.ctx.money(), 100); assert.equal(poor.save.ledger.length, 0);
  poor.callback('cancelPaint', current.event('paint-cancel'))(); assert.equal(poor.ctx.pendingPaint, null); assert.equal(poor.save.ledger.length, 0);
});

await test('真rewardGpFinish：重複結算只發一次獎金及明細；持久rewarded重載後不加發', () => {
  const h = harness(); h.run(current.fn('rewardGpFinish'));
  h.ctx.rewardGpFinish(); h.ctx.rewardGpFinish();
  assert.equal(h.ctx.money(), 2500); assert.equal(h.ctx.stats.earned, 1500); assert.equal(h.ctx.stats.gpWins, 1);
  assert.equal(h.save.ledger.length, 1); assert.equal(h.save.ledger[0].amount, 1500); assert.equal(h.save.ledger[0].reason, '正賽第 1 名');
  assert.equal(h.save.season.pending.rewarded, true); assert.equal(h.events.writes.at(-1).ledger.length, 1);
  const reloaded = harness(current, h.ctx.money()); reloaded.save.ledger = clone(h.save.ledger); reloaded.save.season = clone(h.save.season);
  reloaded.ctx.gpRewarded = reloaded.save.season.pending.rewarded; reloaded.run(current.fn('rewardGpFinish')); reloaded.ctx.rewardGpFinish();
  assert.equal(reloaded.ctx.money(), 2500); assert.equal(reloaded.save.ledger.length, 1);
});

await test('真freeStep載客區塊：直接收入只記一次差額，後續無結算tick不重記', () => {
  const h = harness(); h.ctx.taxiOn = () => true;
  let paid = false, settlement = null;
  h.taxi.update = function () { if (paid) return null; paid = true; this.money += 375; this.trips++;
    this.settledIds = ['economy-trip']; settlement = { id: 'economy-trip', status: 'delivered', total: 375 }; return '💰 完成行程'; };
  h.taxi.consumeSettlement = () => { const result = settlement; settlement = null; return result; };
  h.run(current.taxi()); h.run(current.taxi()); h.run(current.taxi());
  assert.equal(h.ctx.money(), 1375); assert.equal(h.save.taxi.money, 1375); assert.equal(h.ctx.stats.earned, 375);
  assert.equal(h.save.ledger.length, 1); assert.equal(h.save.ledger[0].amount, 375); assert.equal(h.save.ledger[0].balance, 1375);
  assert.equal(h.save.ledger[0].reason, '計程車載客'); assert.equal(h.events.writes.length, 1); assert.equal(h.events.writes[0].ledger.length, 1);
  assert.deepEqual(clone(h.events.writes[0].taxiSettled), ['economy-trip']);
});

await test('真維修click：有錢實付100、錢不足免費且不記支出', () => {
  const paid = harness(current, 100), free = harness(current, 99);
  paid.callback('repair', current.event('btn-repair'))(); free.callback('repair', current.event('btn-repair'))();
  assert.equal(paid.ctx.money(), 0); assert.equal(paid.save.ledger.length, 1); assert.equal(paid.save.ledger[0].amount, -100);
  assert.equal(paid.save.ledger[0].reason, '車輛維修'); assert.equal(paid.events.repairs, 1);
  assert.equal(free.ctx.money(), 99); assert.equal(free.save.ledger.length, 0); assert.equal(free.events.repairs, 1);
});

await test('真freeStep警方區塊：罰款按可付餘額記錄，零錢包零筆；追緝獎金獨立原因', () => {
  for (const [initial, delta, expected, amount, reason] of [[500, -150, 350, -150, '通緝罰款'], [50, -150, 0, -50, '通緝罰款'], [0, -150, 0, 0, null], [100, 400, 500, 400, '巡邏追緝獎金']]) {
    const h = harness(current, initial);
    h.ctx.police = { stars: 0, update: () => ({ msg: delta > 0 ? '✅ 逮捕嫌犯' : '🚔 被捕', money: delta }) };
    h.run(current.police()); assert.equal(h.ctx.money(), expected); assert.equal(h.save.ledger.length, amount ? 1 : 0);
    if (amount) { assert.equal(h.save.ledger[0].amount, amount); assert.equal(h.save.ledger[0].reason, reason); }
    if (delta > 0) { assert.equal(h.ctx.stats.arrests, 1); assert.equal(h.ctx.stats.earned, 400); }
  }
});

await test('真pause→car-use／car-buy→resume：換離巡邏車取消追緝；同巡邏車保留任務', async () => {
  for (const action of ['car-use', 'car-buy']) {
    const h = harness(); pursuit(h); h.run(current.fn('pause')); h.run(current.fn('canStartPursuit'));
    h.ctx.pause(); assert.equal(h.ctx.state, 'paused'); assert.equal(h.ctx.canStartPursuit(), false);
    if (action === 'car-buy') { h.save.owned = ['police']; h.ctx.preview = { id: 'sedan', name: '街道房車', price: 200 }; }
    h.callback('changeCar', current.event(action))(); await h.callback('resume', current.event('btn-resume'))();
    assert.deepEqual(h.events.cancelled, ['cancelled']); assert.equal(h.ctx.police.suspect, null); assert.equal(h.ctx.chosen.id, 'sedan');
    assert.equal(h.ctx.state, 'free'); assert.equal(h.ctx.canStartPursuit(), false);
    assert.equal(h.save.ledger.length, action === 'car-buy' ? 1 : 0);
    if (action === 'car-buy') assert.equal(h.save.ledger[0].amount, -200);
  }
  const same = harness(); pursuit(same); same.ctx.preview = { id: 'police' }; same.run(current.fn('pause')); same.ctx.pause();
  same.callback('sameCar', current.event('car-use'))(); await same.callback('resume', current.event('btn-resume'))();
  assert.ok(same.ctx.police.suspect); assert.equal(same.events.cancelled.length, 0); assert.equal(same.ctx.state, 'free');
});

await test('真追緝快捷鍵與按鈕：載客／街賽／暫停／非巡邏車均不啟動，允許時同一入口', () => {
  for (const block of ['taxi', 'street', 'paused', 'sedan', 'none']) {
    const h = harness(); pursuit(h); h.ctx.police.suspect = null; h.ctx.police.active = false;
    h.run(current.fn('canStartPursuit')); h.run(current.fn('startPursuit'));
    h.ctx.taxiOn = () => block === 'taxi'; h.ctx.streetRacing = () => block === 'street';
    if (block === 'paused') h.ctx.state = 'paused'; if (block === 'sedan') h.ctx.chosen = { id: 'sedan' };
    const key = h.callback('pursuitKey', current.pursuitKey()), button = h.callback('pursuitButton', current.event('btn-pursuit', 'pointerdown'));
    key({ code: 'KeyG', repeat: false }); button({ preventDefault() {} });
    assert.equal(h.events.pursuits, block === 'none' ? 1 : 0); assert.equal(h.save.ledger.length, 0);
  }
});

const failed = report.cases.filter((c) => c.status === 'FAIL'); report.summary = { passed: report.cases.length - failed.length, failed: failed.length };
await writeFile(path.join(root, 'tools/dev-tests/shots-main-economy-integration.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
