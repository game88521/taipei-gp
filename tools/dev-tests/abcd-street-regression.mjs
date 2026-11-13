// C/D：真main動畫回呼、統計／成就與HUD／導航函式的before/after隔離回歸。
// 不接CDP、WebGL、玩家storage或正式服務；物理替身只提供可量測位移。
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
const before = resolve(process.argv[2] ?? process.env.GP_ABCD_BASELINE_DIR ?? resolve(root, '../taipei-gp-abcd-before-3bdf97336c02'));
if (root === before) throw new Error('before不可使用受測工作副本');
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = (raw) => stripTypeScriptTypes(raw, { mode: 'transform' });
const hash = (raw) => createHash('sha256').update(raw).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
async function source(base) {
  const raw = await readFile(resolve(base, 'src/main.ts'), 'utf8'), code = compile(raw), ast = parseAst(code);
  const fn = (name) => {
    const node = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
    if (!node) throw new Error(`找不到真main函式${name}`);
    return code.slice(node.start, node.end);
  };
  const loop = ast.body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.callee?.type === 'MemberExpression' && n.expression.callee.object?.name === 'renderer' && n.expression.callee.property?.name === 'setAnimationLoop');
  if (!loop) throw new Error('找不到真main動畫回呼');
  const callback = loop.expression.arguments[0];
  return { hash: hash(raw), fn, loop: code.slice(callback.start, callback.end) };
}
const old = await source(before), current = await source(root);
const frame = await import(dataUrl(compile(await readFile(resolve(root, 'src/frame-pacing.ts'), 'utf8'))));
const achievements = await import(dataUrl(compile(await readFile(resolve(root, 'src/achievements.ts'), 'utf8'))));
const mission = await import(await pureUrl(root, 'mission.ts'));
const report = { before, after: root, beforeMainHash: old.hash, afterMainHash: current.hash, cases: [], evidence: {},
  playTimeDefinition: 'state為free／race的遊玩時間包含看地圖；paused／menu／其餘狀態不累積。地圖中不累積駕駛里程、夜間里程或最高車速。',
  browserUsed: false, playerStorageTouched: false,
  limitations: ['執行真main AST函式與動畫回呼；物理、DOM、音效及保存隔離，不代表完整實機駕駛回歸。', '導航偏離固定或人工指定；Router只記錄呼叫，不驗證真道路可達性。'] };
async function test(name, action) {
  try { await action(); report.cases.push({ name, status: 'PASS' }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).slice(0, 4500) }); }
}

function statsHarness(src, { hz = 60, state = 'free', map = false, speed = 20, night = true, initial = {} } = {}) {
  let now = 0, delta = 1 / hz, steps = 0, wallet = 0;
  const stats = { ...achievements.emptyStats(), ...initial }, save = { stats, ach: [] }, car = { x: 0, z: 0, y: 0, h: 0, v: speed, deck: null };
  const noop = () => {}, physics = (dt) => { steps++; car.x += car.v * dt; };
  const context = vm.createContext({ console, Math, Number, performance: { now: () => now }, clock: { getDelta: () => delta },
    ...frame, framePacer: new frame.RenderPacer(), renderMeter: new frame.RenderMeter(), frameCapPref: '60',
    BOT: false, SIM: 0, state, mode: state === 'race' ? 'race' : 'free', raceKind: 'tt', mapOpen: map,
    ctxLostNow: false, holdRender: false, STEP: 1 / 120, composer: null, scene: {}, camera: { position: { x: 0, z: 0 } },
    renderer: { render: noop }, bigmap: { draw: noop }, sr: null, streetRacing: () => false, taxiOn: () => false, taxi: null, nav: null,
    fcar: car, surface: null, CEIL: 1, CIRCUIT: null, step: physics, freeStep: physics, updateCountdown: noop,
    tickRain: noop, applyWeather: noop, weather: { night, stepPicked: noop, update: noop, sunI: 1, hemiI: 1 },
    replayFrame: noop, updateVisuals: noop, podiumFrame: noop, circuitEnv: null, cityStream: null, radioTick: noop, radio: { update: noop }, garage3d: null,
    menu: { classList: { contains: () => false } }, document: { querySelector: () => null }, pendingPaint: null, preview: { id: 'sedan' }, previewPaintColor: { set: noop }, playerCars: new Map(),
    cullAcc: 0, cityCull: null, Q: { viewDist: 500 }, cityReady: false, $: () => ({ style: {}, textContent: '' }), opts: { fps: false }, level: 'low', LEVEL_NAME: { low: '低' }, updateDrsButton: noop, tickCycle: noop,
    tunDim: 0, tunWas: false, groundHid: false, world: { ground: { position: { y: 0 }, visible: true }, sun: {}, hemi: {} }, watchFps: noop, lastVisualRender: null,
    stats, save, veh: () => car, breakables: { knocked: 0 }, statAcc: 0, statSave: 0, lastKnocked: -1,
    newlyUnlocked: achievements.newlyUnlocked, money: () => wallet, setMoney: (value) => { wallet = value; }, toast: noop, sound: { beep: noop },
    damage: { snapshot: () => ({}) }, saveSeasonCheckpoint: noop, writeSave: noop, updatePinnedTargets: noop,
  });
  for (const name of ['tickStats', 'checkAchievements']) vm.runInContext(src.fn(name), context);
  vm.runInContext(`var runFrame = ${src.loop};`, context);
  return { context, stats, save, car, get steps() { return steps; }, get wallet() { return wallet; },
    simulate(seconds) { for (let i = 0; i < hz * seconds; i++) { now += 1000 / hz; context.runFrame(); } },
    result() { return { stats: clone(stats), positionX: car.x, physicsSteps: steps, achievements: [...save.ach], wallet }; } };
}

await test('C真動畫回呼：地圖60秒零位移，before虛增1200m，after里程及夜間里程均不增', () => {
  report.evidence.mapPaused = [];
  for (const hz of [60, 120]) {
    const b = statsHarness(old, { hz, map: true }), a = statsHarness(current, { hz, map: true }); b.simulate(60); a.simulate(60);
    close(b.stats.dist, 1200); close(b.stats.nightDist, 1200); close(a.stats.dist, 0); close(a.stats.nightDist, 0);
    for (const h of [b, a]) { close(h.car.x, 0); assert.equal(h.steps, 0); close(h.stats.playTime, 60); }
    assert.equal(a.stats.topSpeed, 0);
    report.evidence.mapPaused.push({ hz, before: b.result(), after: a.result() });
  }
});
await test('C正常駕駛對照：free／race、日夜、正反車速及60／120Hz的位移、統計、成就與before相同', () => {
  let count = 0;
  for (const hz of [60, 120]) for (const state of ['free', 'race']) for (const night of [false, true]) for (const speed of [20, -20]) {
    const b = statsHarness(old, { hz, state, night, speed }), a = statsHarness(current, { hz, state, night, speed }); b.simulate(10); a.simulate(10);
    assert.deepEqual(a.result(), b.result()); close(a.stats.dist, 200); close(a.stats.nightDist, night ? 200 : 0); close(a.car.x, speed * 10); count++;
  }
  report.evidence.normalDrivingCombinations = count;
});
await test('C暫停與選單維持不計時／不計里程；關閉地圖後從實際駕駛重新累積', () => {
  for (const state of ['paused', 'menu']) for (const src of [old, current]) {
    const h = statsHarness(src, { state }); h.simulate(60); close(h.stats.dist, 0); close(h.stats.nightDist, 0); close(h.stats.playTime, 0); assert.equal(h.steps, 0);
  }
  const h = statsHarness(current); h.simulate(10); h.context.mapOpen = true; h.simulate(60); h.context.mapOpen = false; h.simulate(10);
  close(h.car.x, 400); close(h.stats.dist, 400); close(h.stats.nightDist, 400); close(h.stats.playTime, 80);
});
await test('C真成就判定：距離／夜間門檻不能靠地圖殘留速度領取；正常駕駛仍能解鎖', () => {
  const options = { initial: { dist: 99900, nightDist: 9900 } };
  const b = statsHarness(old, { ...options, map: true }), a = statsHarness(current, { ...options, map: true }); b.simulate(60); a.simulate(60);
  assert.ok(b.save.ach.includes('km100')); assert.ok(b.save.ach.includes('night')); assert.equal(b.wallet, 2000);
  assert.deepEqual(a.save.ach, []); assert.equal(a.wallet, 0);
  const driving = statsHarness(current, options); driving.simulate(60);
  assert.ok(driving.save.ach.includes('km100')); assert.ok(driving.save.ach.includes('night')); assert.equal(driving.wallet, 2000);
  report.evidence.achievements = { beforeMap: b.result(), afterMap: a.result(), afterDriving: driving.result() };
});

function navHarness(src, { hz = 60, off = 0, navTime = 0, street = false, taxi = false } = {}) {
  let now = 0, frame = 0;
  const calls = [], arrows = [], toasts = [], elements = new Map();
  const route = [[off, 0], [10000, 0]], streetRoute = [[5, 5], [50, 50]], taxiRoute = [[8, 8], [80, 80]], taxiYs = [3, 4];
  const element = (id) => { if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', className: '' }); return elements.get(id); };
  const context = vm.createContext({ console, Math, Number, performance: { now: () => now * 1000 }, $: element, ROAD_Y: -0.25,
    fcar: { x: 0, z: 0, y: 0, h: 0, v: 0 }, nav: { x: 10000, z: 0, y: 0, nm: '固定遠方目標', path: route, ys: [0, 0], t: navTime },
    mapOpen: false, roadAcc: 0, roadShown: '', lmAcc: 0, lmLast: '', lmAt: 0, toastUntil: 0, bigUntil: 0,
    roadNet: { nearestNamed: () => null }, landmarks: [], minimap: null, sr: { active: { path: streetRoute } }, police: null,
    taxi: { target: { x: 80, z: 80 }, route: taxiRoute, routeYs: taxiYs },
    navArrows: { update: (...args) => arrows.push(args) }, streetRacing: () => street, taxiOn: () => taxi, onGround: () => true,
    carGear: () => ({ n: 1 }), routeRemaining: () => 10000, routeDeviation: mission.routeDeviation, sameRoadLevel: () => true, shortEn: (value) => value,
    playerProgress: { visited: [], pinned: [], title: 'rookie' }, visitLandmarks: () => [],
    router: { route(x0, z0, x1, z1) { calls.push({ elapsed: now, frame, from: [x0, z0], to: [x1, z1] }); return { path: x0 === x1 && z0 === z1 ? [[x1, z1]] : route, ys: [0, 0], length: 10000 }; } },
    updateWantedHud() {}, updateDamageHud() {}, updateDriftHud() {}, playTrafficHonks() {}, playScreams() {}, updateTaxiHud() {}, updateSrHud() {},
    closeMap() { context.mapOpen = false; }, toast: (text) => toasts.push(text),
  });
  for (const name of ['setNav', 'updateNav', 'updateFreeHud']) vm.runInContext(src.fn(name), context);
  const updateFreeHud = vm.runInContext('updateFreeHud', context);
  return { context, calls, arrows, toasts, streetRoute, taxiRoute, taxiYs,
    simulate(seconds, stopAtCalls = Infinity) { for (let i = 0; i < Math.ceil(hz * seconds) && calls.length < stopAtCalls; i++) { frame++; now = frame / hz; updateFreeHud(1 / hz); } },
    setTarget(x, z) { vm.runInContext(`setNav(${x}, ${z}, '新目標');`, context); },
  };
}
await test('D真HUD節流與導航：before60／120Hz分別96.267／186秒；after首次及後續均約6秒', () => {
  report.evidence.periodicNavigation = [];
  for (const hz of [60, 120]) {
    const b = navHarness(old, { hz }), a = navHarness(current, { hz }); b.simulate(240, 1); a.simulate(30, 3);
    assert.equal(b.calls.length, 1); close(b.calls[0].elapsed, hz === 60 ? 96.26666666666667 : 186);
    assert.equal(a.calls.length, 3);
    const intervals = a.calls.map((call, i) => call.elapsed - (a.calls[i - 1]?.elapsed ?? 0));
    for (const seconds of intervals) assert.ok(seconds >= 6 - 1e-8 && seconds <= 6.3, `${hz}Hz interval=${seconds}`);
    report.evidence.periodicNavigation.push({ hz, beforeFirst: b.calls[0].elapsed, after: a.calls, afterIntervals: intervals });
  }
});
await test('D偏離25m仍在下一次HUD更新重算，不等待6秒', () => {
  for (const hz of [60, 120]) for (const src of [old, current]) {
    const h = navHarness(src, { hz, off: 26 }); h.simulate(1, 1);
    assert.equal(h.calls.length, 1); assert.ok(h.calls[0].elapsed <= 0.3); assert.ok(h.calls[0].elapsed < 6);
  }
});
await test('D新目標保留立即吸附及下一次HUD首次規劃；不沿用舊目標的6秒等待', () => {
  for (const hz of [60, 120]) for (const src of [old, current]) {
    const h = navHarness(src, { hz }); h.setTarget(5000, 5000);
    assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0].from, [5000, 5000]); assert.deepEqual(h.calls[0].to, [5000, 5000]);
    h.simulate(1, 2); assert.equal(h.calls.length, 2); assert.ok(h.calls[1].elapsed <= 0.3);
    assert.deepEqual(h.calls[1].from, [0, 0]); assert.deepEqual(h.calls[1].to, [5000, 5000]); assert.ok(h.context.nav.path);
  }
});
await test('D街賽／載客保留專屬導航與高度，不觸發自選目標重算，也不允許覆蓋任務目的地', () => {
  for (const src of [old, current]) for (const mode of ['street', 'taxi']) {
    const h = navHarness(src, { [mode]: true }), originalNav = h.context.nav; h.simulate(10);
    assert.equal(h.calls.length, 0); assert.equal(h.context.nav.t, 0); assert.ok(h.arrows.length > 0);
    for (const args of h.arrows) { assert.equal(args[0], mode === 'street' ? h.streetRoute : h.taxiRoute); if (mode === 'taxi') assert.equal(args[4], h.taxiYs); }
    h.setTarget(3000, 3000); assert.equal(h.context.nav, originalNav); assert.equal(h.calls.length, 0); assert.match(h.toasts.at(-1), /目前跟隨街賽／載客路線/);
  }
});

report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
await writeFile(resolve(root, 'tools/dev-tests/shots-abcd-street-regression.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.summary.failed) process.exitCode = 1;
