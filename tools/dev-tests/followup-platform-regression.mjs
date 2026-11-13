// 真 frame-pacing.ts 與 main.ts 動畫回呼 AST；不使用 WebGL、CDP、正式網站或玩家存檔。
// node tools/dev-tests/followup-platform-regression.mjs [immutable-before-root]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? process.env.GP_FOLLOWUP_BASELINE_DIR ?? resolve(root, '../taipei-gp-followup-before-2dee076'));
if (root === before) throw Error('before 不可指向受測工作副本');
const frameSource = await readFile(resolve(root, 'src/frame-pacing.ts'), 'utf8');
const frame = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(frameSource, { mode: 'transform' })).toString('base64')}`);
const hash = (s) => createHash('sha256').update(s).digest('hex');
async function mainSource(base) {
  const raw = await readFile(resolve(base, 'src/main.ts'), 'utf8'), code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
  const node = ast.body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee?.type === 'MemberExpression' && n.expression.callee.object?.name === 'renderer' && n.expression.callee.property?.name === 'setAnimationLoop');
  if (!node) throw Error('找不到真正 renderer.setAnimationLoop');
  const callback = node.expression.arguments[0];
  const fnNode = (name) => ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
  return { hash: hash(raw), code: code.slice(callback.start, callback.end), body: callback.body.body, fullCode: code,
    fn(name) { const f = fnNode(name); if (!f) throw Error(`找不到真main函式 ${name}`); return code.slice(f.start, f.end); },
    policeBlock() {
      const block = fnNode('freeStep').body.body.find((n) => n.type === 'IfStatement' && n.test.type === 'Identifier' && n.test.name === 'police');
      if (!block) throw Error('找不到freeStep直接if(police)區塊'); return code.slice(block.start, block.end);
    },
  };
}
const current = await mainSource(root), old = await mainSource(before);
const report = { before, after: root, beforeMainHash: old.hash, mainSourceHash: current.hash, frameSourceHash: hash(frameSource), cases: [], evidence: {}, browserUsed: false,
  limitations: ['執行真 frame 模組及 main 動畫回呼 AST；物理方法、DOM、繪圖與音效以隔離替身觀察呼叫與時間。', '測的是排程及控制流程，不是實際手機 FPS、省電、發熱或完整賽車物理回歸。'] };
async function test(name, action) {
  try { await action(); report.cases.push({ name, status: 'PASS' }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).slice(0, 4000) }); }
}
function timeline(hz, limit, seconds = 10) {
  const pacer = new frame.RenderPacer(), times = [];
  for (let i = 0; i < hz * seconds; i++) { const now = i * 1000 / hz; if (pacer.due(now, limit)) times.push(now); }
  return times;
}

await test('frameCap：手機預設60、桌面不限，合法30/60/unlimited及非法值回退', () => {
  assert.equal(frame.frameCap(undefined, true), '60'); assert.equal(frame.frameCap(undefined, false), 'unlimited');
  for (const value of ['30', '60', 'unlimited']) assert.equal(frame.frameCap(value), value);
  for (const value of [null, '', 30, '144', {}, Infinity]) { assert.equal(frame.frameCap(value, true), '60'); assert.equal(frame.frameCap(value), 'unlimited'); }
});

await test('真RenderPacer：120Hz只畫30/60；60/90/144Hz十秒上限穩定，無累積漂移', () => {
  const counts = [];
  for (const hz of [60, 90, 120, 144]) for (const limit of [30, 60]) {
    const times = timeline(hz, limit), count = times.length;
    assert.ok(Math.abs(count - limit * 10) <= 1, `${hz}Hz→${limit}: ${count}`);
    for (let n = 0; n < 10; n++) assert.ok(times.filter((t) => t >= n * 1000 && t < (n + 1) * 1000).length <= limit + 1);
    counts.push({ hz, limit, seconds: 10, renders: count });
  }
  report.evidence.pacerCounts = counts;
});

await test('真RenderPacer：改上限／reset即時生效，不限時每回呼可畫', () => {
  const p = new frame.RenderPacer(); assert.equal(p.due(0, 60), true); assert.equal(p.due(5, 60), false);
  assert.equal(p.due(5, 30), true); assert.equal(p.due(5, 30), false);
  assert.equal(p.due(5, 0), true); assert.equal(p.due(6, 0), true);
  assert.equal(p.due(6, 60), true); assert.equal(p.due(6, 60), false);
  p.reset(); assert.equal(p.due(6, 60), true); assert.equal(p.due(6, 60), false);
  assert.equal(timeline(144, 0, 2).length, 288);
});

await test('真RenderPacer：長stall後只畫當前一張，沒有追補連續burst', () => {
  const p = new frame.RenderPacer(); assert.equal(p.due(0, 30), true); assert.equal(p.due(10, 30), false);
  assert.equal(p.due(10000, 30), true);
  for (const now of [10000, 10000, 10001, 10010, 10020]) assert.equal(p.due(now, 30), false);
  assert.equal(p.due(10000 + 1000 / 30, 30), true);
});

await test('真RenderMeter：實際每200ms繪圖量5FPS/200ms，reset與時間倒退重新取樣', () => {
  const m = new frame.RenderMeter(); assert.equal(m.sample(0), null); assert.equal(m.sample(200), null); assert.equal(m.sample(400), null);
  assert.deepEqual(m.sample(600), { fps: 5, ms: 200 });
  m.reset(); assert.equal(m.sample(1000), null); assert.equal(m.sample(1200), null); assert.equal(m.sample(1400), null);
  assert.deepEqual(m.sample(1600), { fps: 5, ms: 200 });
  assert.equal(m.sample(100), null); assert.equal(m.sample(300), null); assert.equal(m.sample(500), null);
  assert.deepEqual(m.sample(700), { fps: 5, ms: 200 });
});

function harness(source = current, options = {}) {
  let now = 0, delta = 1 / (options.hz ?? 120);
  const events = { steps: [], freeSteps: [], renders: [], visuals: [], rain: [], radio: [], stats: [], watches: 0, bigmaps: 0, garageDt: [] };
  const fps = { style: {}, textContent: '' };
  const ctx = vm.createContext({ console, Math, Number, performance: { now: () => now }, clock: { getDelta: () => delta },
    ...frame, framePacer: new frame.RenderPacer(), renderMeter: new frame.RenderMeter(), frameCapPref: options.cap ?? '30',
    BOT: options.bot ?? false, SIM: 0, state: options.state ?? 'race', mode: options.state === 'free' ? 'free' : 'race', raceKind: 'gp', mapOpen: options.map ?? false,
    ctxLostNow: false, holdRender: false, STEP: 1 / 120, composer: null, scene: {}, camera: { position: { x: 0, z: 0 } },
    renderer: { render: () => events.renders.push(now) }, bigmap: { draw() { events.bigmaps++; } },
    sr: null, streetRacing: () => false, taxiOn: () => false, taxi: null, nav: null,
    fcar: { x: 0, z: 0, y: 0, h: 0, deck: null }, surface: null, CEIL: 1, CIRCUIT: null,
    step: (dt) => events.steps.push(dt), freeStep: (dt) => events.freeSteps.push(dt), updateCountdown() {},
    tickRain: (dt) => events.rain.push(dt), applyWeather() {}, weather: { stepPicked() {}, update() {}, sunI: 1, hemiI: 1 },
    replayFrame() {}, updateVisuals: (dt) => events.visuals.push(dt), podiumFrame() {}, circuitEnv: null, cityStream: null,
    radioTick() {}, radio: { update: (dt) => events.radio.push(dt) }, garage3d: null,
    menu: { classList: { contains: () => false } }, document: { querySelector: () => ({}) }, pendingPaint: null,
    preview: { id: 'sedan' }, previewPaintColor: { set() {} }, playerCars: new Map(),
    fpsN2: 0, fpsT2: 0, cullAcc: 0, cityCull: null, Q: { viewDist: 500 }, cityReady: false,
    $: () => fps, opts: { fps: true }, level: 'low', LEVEL_NAME: { low: '低' }, updateDrsButton() {}, tickCycle() {},
    tunDim: 0, tunWas: false, groundHid: false, world: { ground: { position: { y: 0 }, visible: true }, sun: {}, hemi: {} },
    tickStats: (dt) => events.stats.push(dt), watchFps: () => events.watches++, lastVisualRender: null,
  });
  vm.runInContext(`var runFrame = ${source.code};`, ctx);
  return { ctx, events, fps, frame(at, dt = delta) { now = at; delta = dt; ctx.runFrame(); }, simulate(seconds, hz = options.hz ?? 120) { for (let i = 0; i < hz * seconds; i++) this.frame(i * 1000 / hz, 1 / hz); } };
}
const sum = (values) => values.reduce((a, b) => a + b, 0);

await test('真main AST：限render不減物理／雨／無線電／統計回呼，60/90/120/144Hz與before一致', () => {
  const evidence = [];
  for (const hz of [60, 90, 120, 144]) for (const state of ['race', 'free']) {
    const b = harness(old, { hz, state }); b.simulate(2);
    for (const cap of ['30', '60', 'unlimited']) {
      const a = harness(current, { hz, state, cap }); a.simulate(2);
      assert.deepEqual(a.events.steps, b.events.steps); assert.deepEqual(a.events.freeSteps, b.events.freeSteps);
      for (const name of ['rain', 'visuals', 'radio', 'stats']) assert.deepEqual(a.events[name], b.events[name], `${hz}/${state}/${cap}/${name}`);
      const expected = cap === 'unlimited' ? hz * 2 : Number(cap) * 2;
      assert.ok(Math.abs(a.events.renders.length - expected) <= 1); assert.equal(a.events.watches, a.events.renders.length);
      evidence.push({ hz, state, cap, renders: a.events.renders.length, physicsSteps: a.events.steps.length + a.events.freeSteps.length, simulatedSeconds: sum([...a.events.steps, ...a.events.freeSteps]) });
    }
  }
  report.evidence.mainCadence = evidence;
});

await test('真main AST：gate在物理及tickStats後，BOT用舊不限繪圖路徑；暫停/地圖只限畫面', () => {
  const gate = current.body.findIndex((n) => n.type === 'IfStatement' && n.consequent?.type === 'ReturnStatement' && current.fullCode.slice(n.test.start, n.test.end).includes('drawFrame'));
  const physics = current.body.findIndex((n) => n.type === 'IfStatement' && current.fullCode.slice(n.start, n.end).includes('freeStep(sub)'));
  const stats = current.body.findIndex((n) => n.type === 'ExpressionStatement' && n.expression?.callee?.name === 'tickStats');
  assert.ok(gate > physics && gate > stats);
  const b = harness(old, { hz: 144, bot: true }), a = harness(current, { hz: 144, bot: true, cap: '30' }); b.simulate(2); a.simulate(2);
  assert.deepEqual(a.events.steps, b.events.steps); assert.equal(a.events.renders.length, b.events.renders.length); assert.equal(a.events.renders.length, 288);
  const paused = harness(current, { hz: 120, cap: 'unlimited', state: 'paused' }); paused.simulate(2);
  assert.equal(paused.events.steps.length + paused.events.freeSteps.length, 0); assert.equal(paused.events.renders.length, 60);
  const map = harness(current, { hz: 120, cap: 'unlimited', state: 'free', map: true }); map.simulate(2);
  assert.equal(map.events.steps.length + map.events.freeSteps.length, 0); assert.equal(map.events.renders.length, 60); assert.equal(map.events.bigmaps, 60);
});

await test('真main AST：5FPS且物理dt封頂0.1，舊顯示10FPS、新顯示5FPS', () => {
  const b = harness(old, { hz: 5 }), a = harness(current, { hz: 5, cap: 'unlimited' }); b.simulate(3); a.simulate(3);
  assert.match(b.fps.textContent, /^10 FPS/); assert.match(a.fps.textContent, /^5 FPS · 200\.0 ms/);
  assert.deepEqual(a.events.steps, b.events.steps); assert.ok(a.events.steps.every((dt) => dt <= 1 / 120 + 1e-9));
  report.evidence.slowFps = { before: b.fps.textContent, after: a.fps.textContent };
});

await test('真main AST：120Hz限30FPS時車庫轉台保留繪圖間隔，不把動畫與idle縮成四分之一', () => {
  const h = harness(current, { hz: 120, cap: '30', state: 'menu' });
  h.ctx.garage3d = { frame(dt, visible) { if (visible) h.events.garageDt.push(dt); } };
  h.simulate(2); assert.equal(h.events.garageDt.length, 60);
  for (const dt of h.events.garageDt.slice(1)) assert.ok(Math.abs(dt - 1 / 30) < 1e-8);
  assert.ok(sum(h.events.garageDt) > 1.95);
  report.evidence.garageAnimationSeconds = sum(h.events.garageDt);
});

await test('真main警方AST before/after：罰款文案符合實扣，50/200/300/0錢包及獎金的金額/ledger規則不變', async () => {
  async function economySource(base) {
    const source = stripTypeScriptTypes(await readFile(resolve(base, 'src/economy.ts'), 'utf8'), { mode: 'transform' });
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  }
  const oldEconomy = await economySource(before), newEconomy = await economySource(root);
  function scenario(source, economy, initial, delta) {
    const save = { taxi: { money: initial, trips: 0 }, ledger: [] }, taxi = { money: initial, trips: 0 }, toasts = [];
    const stats = { escapes: 0, maxEscaped: 0, busted: 0, arrests: 0, earned: 0 };
    const msg = delta < 0 ? '🚔 被逮捕了！罰款 NT$ 200' : '✅ 逮捕嫌犯！獎金 NT$ 400';
    const context = vm.createContext({ Math, save, taxi, stats, recordTransaction: economy.recordTransaction,
      writeSave() {}, refreshGarage() {}, toast: (text) => toasts.push(text), sound: { beep() {} },
      streetRacing: () => false, chosen: { id: 'sedan' }, FREE_SIM: false, WANTED_TEST: false,
      trafficHit: 0, pedHit: false, dt: 0.02, fcar: {}, collider: null, NO_TRAFFIC: false, traffic: null, policeLog: [],
      police: { stars: 1, update: () => ({ money: delta, msg }) },
    });
    for (const name of ['money', 'setMoney']) vm.runInContext(source.fn(name), context);
    vm.runInContext(source.policeBlock(), context);
    return { money: taxi.money, persistedMoney: save.taxi.money,
      ledger: save.ledger.map(({ amount, balance, reason }) => ({ amount, balance, reason })), toasts, stats };
  }
  const evidence = [];
  for (const [initial, delta, remaining, actual] of [[50, -200, 0, -50], [200, -200, 0, -200], [300, -200, 100, -200], [0, -200, 0, 0], [50, 400, 450, 400]]) {
    const b = scenario(old, oldEconomy, initial, delta), a = scenario(current, newEconomy, initial, delta);
    assert.equal(b.money, remaining); assert.equal(a.money, remaining); assert.equal(b.persistedMoney, remaining); assert.equal(a.persistedMoney, remaining);
    assert.deepEqual(a.ledger, b.ledger); assert.equal(a.ledger.length, actual ? 1 : 0); assert.deepEqual(a.stats, b.stats);
    if (actual) { assert.equal(a.ledger[0].amount, actual); assert.equal(a.ledger[0].balance, remaining); assert.equal(a.ledger[0].reason, delta < 0 ? '通緝罰款' : '巡邏追緝獎金'); }
    if (delta < 0) {
      assert.equal(b.toasts[0], '🚔 被逮捕了！罰款 NT$ 200');
      assert.equal(a.toasts[0], `🚔 被逮捕了！應罰 NT$ 200／本次實扣 NT$ ${-actual}`);
    } else { assert.deepEqual(a.toasts, b.toasts); assert.equal(a.stats.earned, 400); assert.equal(a.stats.arrests, 1); }
    evidence.push({ initial, nominalChange: delta, balance: remaining, actualChange: actual, beforeMessage: b.toasts[0], afterMessage: a.toasts[0], ledger: a.ledger });
  }
  report.evidence.policeSettlement = evidence;
});

const failed = report.cases.filter((x) => x.status === 'FAIL'); report.summary = { passed: report.cases.length - failed.length, failed: failed.length };
await writeFile(resolve(root, 'tools/dev-tests/shots-followup-platform-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2)); if (failed.length) process.exitCode = 1;
