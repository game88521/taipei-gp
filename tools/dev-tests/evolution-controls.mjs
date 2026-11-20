import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(root, '../taipei-gp-evolution-before-d251460c360c');
const source = await readFile(path.join(root, 'src/input.ts'), 'utf8');
const code = stripTypeScriptTypes(source, { mode: 'transform' });
const m = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const report = { status: 'RUNNING', cases: [], inputSha256: createHash('sha256').update(source).digest('hex'), originalTouched: false, browserUsed: false, realGamepadUsed: false,
  limitations: ['真實輸入模組搭配隔離DOM事件與Gamepad資料，非實體手把或手機配對驗證。', 'before只證明原版無重綁與手把入口；新行為另驗真Input.read事件流程。'] };
const clone = value => JSON.parse(JSON.stringify(value));
const test = async (name, run) => { try { await run(); report.cases.push({ name, status: 'PASS' }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack).replace(/data:text[^\s]+/g, '[input-module]').slice(0, 3000) }); } };
const pad = (values = {}) => ({ index: 0, mapping: 'standard', connected: true, axes: [0], buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })), ...values });
const withButton = (button, value = 1) => { const p = pad(); p.buttons[button] = { pressed: value > 0.5, value }; return p; };
function storage(raw = null) { return { raw, writes: 0, getItem() { return this.raw; }, setItem(key, value) { this.raw = value; this.writes++; } }; }
function harness(text = code, initial = null) {
  const callbacks = new Map(), docEvents = new Map(), orientationEvents = new Map();
  const add = (map, type, callback) => map.set(type, [...(map.get(type) ?? []), callback]);
  const emit = (type, event = {}) => { for (const callback of callbacks.get(type) ?? []) callback(event); };
  class Element { style = {}; classList = { add() {}, remove() {} }; listeners = new Map(); closest() { return null; } setPointerCapture() {} getBoundingClientRect() { return { left: 0, width: 200 }; } addEventListener(type, fn) { add(this.listeners, type, fn); } }
  const elements = Array.from({ length: 7 }, () => new Element()), store = storage(initial);
  let controller = null;
  const document = { hidden: false, addEventListener: (type, fn) => add(docEvents, type, fn) };
  const context = vm.createContext({ console, Element, document, localStorage: store, navigator: { getGamepads: () => [controller] },
    addEventListener: (type, fn) => add(callbacks, type, fn), screen: { orientation: { angle: 0, addEventListener: (type, fn) => add(orientationEvents, type, fn) } },
    performance: { now: () => 0 }, Event: class { constructor(type) { this.type = type; } } });
  context.window = context;
  context.dispatchEvent = event => emit(event.type, event);
  vm.runInContext(text.replaceAll('export ', '') + '\nglobalThis.TestInput = Input;', context);
  const input = new context.TestInput(...elements);
  return { input, store, elements, document, context, emit, setPad: value => { controller = value; },
    key(code, kind = 'keydown', extra = {}) { const event = { code, target: elements[0], preventDefault() { this.defaultPrevented = true; }, ...extra }; emit(kind, event); return event; },
    hidden(value) { document.hidden = value; for (const callback of docEvents.get('visibilitychange') ?? []) callback({}); } };
}
await test('預設相容舊WASD／方向鍵／空白／Shift，parser不共用可變陣列', () => {
  const config = m.defaultControls(), parsed = m.parseControls(config); assert.deepEqual(parsed, config);
  parsed.keys.left[0] = 'KeyZ'; assert.equal(config.keys.left[0], 'ArrowLeft');
  assert.deepEqual(config.keys.brake, ['ArrowDown', 'KeyS', 'Space']);
});
await test('拒絕保留快捷鍵、跨動作重複、同動作重複、空綁定及超長名單', () => {
  for (const mutation of [c => { c.keys.left = ['KeyB']; }, c => { c.keys.left = ['KeyD']; }, c => { c.keys.left = ['KeyA', 'KeyA']; }, c => { c.keys.left = []; }, c => { c.keys.left = ['KeyQ', 'KeyZ', 'KeyX', 'KeyU']; }]) {
    const config = m.defaultControls(); mutation(config); assert.equal(m.parseControls(config), null);
  }
  for (const code of ['Escape', 'Enter', 'Tab', 'ControlLeft', 'MetaLeft', 'KeyM', 'KeyE', '<script>', 'KeyÅ']) assert.equal(m.bindableCode(code), false);
});
await test('拒絕非有限死區／越界設定／錯誤型別，不部分吞掉錯資料', () => {
  for (const value of [NaN, Infinity, 0, 0.049, 0.401, '0.12']) { const c = m.defaultControls(); c.gamepad.deadzone = value; assert.equal(m.parseControls(c), null); }
  for (const value of [null, [], {}, { v: 2 }]) assert.equal(m.parseControls(value), null);
});
await test('重綁僅更改一動作，拒絕衝突而不改原設定', () => {
  const config = m.defaultControls(), prior = JSON.stringify(config), next = m.rebindControl(config, 'left', 'KeyQ');
  assert.equal(next.ok, true); assert.deepEqual(next.config.keys.left, ['KeyQ']); assert.deepEqual(next.config.keys.brake, config.keys.brake); assert.equal(JSON.stringify(config), prior);
  assert.equal(m.rebindControl(config, 'left', 'KeyD').ok, false); assert.equal(m.rebindControl(config, 'left', 'KeyP').ok, false);
});
await test('死區連續、保留滿舵、NaN／越界輸入回正', () => {
  assert.equal(m.padSteering(0.12, 0.12), 0); assert.equal(m.padSteering(-0.12, 0.12), 0); assert.ok(Math.abs(m.padSteering(0.56, 0.12) - 0.5) < 1e-12);
  assert.equal(m.padSteering(1, 0.12), 1); assert.equal(m.padSteering(-1, 0.12), -1);
  for (const axis of [NaN, Infinity, 1.1, -1.1, '1', undefined]) assert.equal(m.padSteering(axis, 0.12), 0);
});
await test('連接時按住油門不啟動，回中放開後才接受真手把輸入', () => {
  const reader = new m.StandardPadInput(), options = m.defaultControls().gamepad;
  assert.equal(reader.read(withButton(7), options, true).throttle, false); assert.equal(reader.status, 'neutral');
  reader.read(pad(), options, true); assert.equal(reader.status, 'ready');
  assert.equal(reader.read(withButton(7), options, true).throttle, true);
  assert.equal(reader.read(withButton(6), options, true).brake, true); assert.equal(reader.read(withButton(2), options, true).handbrake, true);
});
await test('斷線／換手把／離開駕駛後需重新回中，不沿用舊按壓', () => {
  const reader = new m.StandardPadInput(), options = m.defaultControls().gamepad;
  reader.read(pad(), options, true); assert.equal(reader.read(withButton(0), options, true).throttle, true);
  reader.read(null, options, true); assert.equal(reader.read(withButton(0), options, true).throttle, false);
  reader.read(pad(), options, true); assert.equal(reader.read({ ...withButton(0), index: 1 }, options, true).throttle, false);
  reader.read(pad(), options, false); assert.equal(reader.read(withButton(0), options, true).throttle, false);
});
await test('停用／非標準mapping／未連線手把回正，反轉可用且無效button不觸發', () => {
  const reader = new m.StandardPadInput(), options = m.defaultControls().gamepad;
  for (const p of [pad({ mapping: '' }), pad({ connected: false })]) assert.equal(reader.read(p, options, true).steer, 0);
  reader.read(pad(), options, true); assert.equal(reader.read(pad({ axes: [1] }), { ...options, inverted: true }, true).steer, -1);
  assert.equal(reader.read(withButton(7), { ...options, enabled: false }, true).throttle, false);
  reader.read(pad(), options, true); assert.equal(reader.read(withButton(7, NaN), options, true).throttle, false);
});
await test('損壞／過大設定只回退不覆寫，quota失敗如實回報', () => {
  const previous = globalThis.localStorage;
  try {
    for (const raw of ['{broken', '{}', 'x'.repeat(4097)]) { const s = storage(raw); globalThis.localStorage = s; assert.deepEqual(m.readControlPreferences().config, m.defaultControls()); assert.equal(s.writes, 0); assert.equal(s.raw, raw); }
    globalThis.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
    assert.ok(m.readControlPreferences().warning); assert.equal(m.storeControlPreferences(m.defaultControls()), false);
  } finally { globalThis.localStorage = previous; }
});
await test('before對照：Q不能左轉、原模組無操控重綁入口', async () => {
  const old = stripTypeScriptTypes(await readFile(path.join(before, 'src/input.ts'), 'utf8'), { mode: 'transform' }), h = harness(old);
  h.key('KeyQ'); assert.equal(h.input.read().steer, 0); assert.equal(h.input.setControls, undefined);
});
await test('真Input事件：Q重綁後可左轉，舊A解除；輸入欄與組字不攔截', () => {
  const h = harness(), config = m.rebindControl(m.defaultControls(), 'left', 'KeyQ').config;
  assert.equal(h.input.setControls(config), true); h.key('KeyQ'); assert.equal(h.input.read().steer, -1); h.key('KeyQ', 'keyup'); h.key('KeyA'); assert.equal(h.input.read().steer, 0);
  h.key('KeyQ', 'keydown', { isComposing: true }); assert.equal(h.input.read().steer, 0);
  const field = new h.context.Element(); field.closest = () => ({}); h.key('KeyQ', 'keydown', { target: field }); assert.equal(h.input.read().steer, 0);
});
await test('真Input事件：手把／鍵盤可接替，觸控優先，斷線不清鍵盤', () => {
  const h = harness(); h.setPad(pad()); h.input.read(); h.setPad(pad({ axes: [1] })); assert.equal(h.input.read().steer, 1);
  h.key('KeyA'); assert.equal(h.input.read().steer, -1); h.setPad(null); assert.equal(h.input.read().steer, -1); h.key('KeyA', 'keyup');
  h.setPad(pad()); h.input.read(); h.setPad(pad({ axes: [1] }));
  for (const callback of h.elements[4].listeners.get('pointerdown')) callback({ pointerId: 1, preventDefault() {} });
  assert.equal(h.input.read().steer, -1);
});
await test('真Input失焦／隱藏／選單停止所有輸入，返回時需手把回中', () => {
  const h = harness(); h.setPad(pad()); h.input.read(); h.setPad(withButton(0)); assert.equal(h.input.read().throttle, true);
  h.emit('blur'); assert.equal(h.input.read().throttle, false); h.emit('focus'); assert.equal(h.input.read().throttle, false);
  h.setPad(pad()); h.input.read(); h.setPad(withButton(0)); assert.equal(h.input.read().throttle, true);
  h.hidden(true); assert.equal(h.input.read().throttle, false); h.hidden(false); assert.equal(h.input.read().throttle, false);
  h.input.isDriving = () => false; h.key('KeyW'); assert.equal(h.input.read().throttle, false);
});
await test('真Input跨頁設定事件：重綁立即生效並清除舊按壓', () => {
  const h = harness(); h.key('KeyA'); assert.equal(h.input.read().steer, -1);
  h.store.raw = JSON.stringify(m.rebindControl(m.defaultControls(), 'left', 'KeyQ').config); h.emit('storage', { key: m.CONTROL_KEY });
  assert.equal(h.input.read().steer, 0); h.key('KeyQ'); assert.equal(h.input.read().steer, -1);
});
await test('背景暫停沒有read時，回前景仍需放開手把回中', () => {
  const h = harness(); h.setPad(pad()); h.input.read(); h.setPad(withButton(0));
  assert.equal(h.input.read().throttle, true);
  h.hidden(true); h.hidden(false);
  assert.equal(h.input.read().throttle, false);
  h.setPad(pad()); h.input.read(); h.setPad(withButton(0));
  assert.equal(h.input.read().throttle, true);
});
await test('模式轉換顯式release：模擬未呼叫read仍清按住並要求手把回中', () => {
  const h = harness(); h.setPad(pad()); h.input.read(); h.setPad(withButton(0)); h.key('KeyA');
  assert.equal(h.input.read().throttle, true); h.input.release();
  assert.equal(h.input.read().throttle, false); assert.equal(h.input.read().steer, 0);
  h.setPad(pad()); h.input.read(); h.setPad(withButton(0)); assert.equal(h.input.read().throttle, true);
});
await test('真多人控制器：不執行輸入read的結果／大廳／倒數轉換仍釋放按住', async () => {
  const { environment, room } = await import('./multiplayer-map-ui-lifecycle.mjs');
  const h = await environment(), input = h.mp.input, reads = input.reads;
  for (const phase of ['results', 'lobby', 'countdown']) {
    const previous = input.releases, value = room('japan'); value.phase = phase;
    h.client.update(value, 'connected', 1);
    assert.ok(input.releases > previous, phase); assert.equal(input.reads, reads);
  }
});
report.status = report.cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
await writeFile(path.join(root, 'tools/dev-tests/evolution-controls-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, passed: report.cases.filter(item => item.status === 'PASS').length, failed: report.cases.filter(item => item.status === 'FAIL') }));
process.exitCode = report.status === 'PASS' ? 0 : 1;
