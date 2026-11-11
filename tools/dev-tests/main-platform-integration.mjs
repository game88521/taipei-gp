// 執行真正 main.ts 的事件與函式；DOM、路線繪圖與玩家儲存空間均隔離。
// node tools/dev-tests/main-platform-integration.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const beforeRoot = path.resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? path.resolve(root, '../taipei-gp-priority-before-20261111'));
const KEY = 'taipei-gp-v2';
const clone = (value) => JSON.parse(JSON.stringify(value));
function walk(node, match) {
  if (!node || typeof node !== 'object') return null;
  if (match(node)) return node;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) { for (const child of value) { const found = walk(child, match); if (found) return found; } }
    else if (value && typeof value === 'object') { const found = walk(value, match); if (found) return found; }
  }
  return null;
}
async function mainSource(base) {
  const raw = await readFile(path.join(base, 'src/main.ts'), 'utf8');
  const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
  const slice = (node) => { if (!node) throw Error('main.ts 找不到測試入口'); return code.slice(node.start, node.end); };
  return {
    hash: createHash('sha256').update(raw).digest('hex'),
    fn(name) {
      const node = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
      if (node) return slice(node);
      const decl = walk(ast, (n) => n.type === 'VariableDeclarator' && n.id?.name === name && n.init);
      return `var ${name} = ${slice(decl?.init)};`;
    },
    click(id) {
      const call = walk(ast, (n) => n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.property?.name === 'addEventListener'
        && n.arguments[0]?.value === 'click' && n.callee.object?.type === 'CallExpression' && n.callee.object.callee?.name === '$' && n.callee.object.arguments[0]?.value === id);
      return slice(call?.arguments[1]);
    },
    backup() {
      return slice(ast.body.find((n) => n.type === 'BlockStatement' && walk(n, (d) => d.type === 'VariableDeclarator' && d.id?.name === 'bkText')));
    },
  };
}
const current = await mainSource(root), old = await mainSource(beforeRoot);
const report = { sourceHash: current.hash, baselineRoot: beforeRoot, baselineHash: old.hash, cases: [], before: {}, after: {}, browserUsed: false, playerStorageTouched: false,
  limitations: ['執行真實 main.ts 抽出的事件與函式，DOM／導航繪圖為隔離替身。', '未驗證瀏覽器排版、WebGL、手機 FPS 或人耳音效。'] };
async function test(name, action) {
  try { await action(); report.cases.push({ name, status: 'PASS' }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[隔離模組]').slice(0, 5000) }); }
}
function fakeElement() {
  const classes = new Set(['hidden']), listeners = new Map();
  return { hidden: false, open: false, value: '', textContent: '', style: {}, className: '', files: null,
    classList: { add: (x) => classes.add(x), remove: (x) => classes.delete(x), contains: (x) => classes.has(x) },
    addEventListener(event, fn) { listeners.set(event, fn); },
    emit(event, payload) { return listeners.get(event)?.(payload ?? { target: this }); },
    focus() {}, select() {}, click() { return this.emit('click'); } };
}
function dom() {
  const nodes = new Map();
  return { nodes, get(id) { if (!nodes.has(id)) nodes.set(id, fakeElement()); return nodes.get(id); } };
}
const dataURL = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
async function compiled(file, deps = {}) {
  return stripTypeScriptTypes(await readFile(path.join(root, 'src', file), 'utf8'), { mode: 'transform' })
    .replace(/from (['"])([^'"]+)\1/g, (all, q, name) => deps[name] ? `from ${q}${deps[name]}${q}` : all);
}
const networkURL = dataURL(await compiled('network.ts'));
const circuitsURL = dataURL(await compiled('circuits.ts', { './network': networkURL }));
const raceURL = dataURL(await compiled('race-state.ts'));
const seasonURL = dataURL(await compiled('season.ts', { './circuits': circuitsURL, './race-state': raceURL }));
const identityURL = dataURL(await compiled('identity.ts'));
const economyURL = dataURL(await compiled('economy.ts')), economy = await import(economyURL);
const saveCode = await compiled('save.ts', { './season': seasonURL, './identity': identityURL, './economy': economyURL });
let loadNo = 0;
class MemoryStorage {
  data = new Map(); writes = []; fail = null;
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { if (this.fail?.(key)) throw new DOMException('隔離容量不足', 'QuotaExceededError'); this.data.set(key, String(value)); this.writes.push(key); }
}
function fixture(best = 50) { return { schema: 3, best, sectors: [null, null, null], ghost: null, opts: {}, taxi: { money: 1000, trips: 1 } }; }
const backupText = (best) => JSON.stringify({ app: 'taipei-gp', version: 3, save: fixture(best) });
async function backupHarness(source = current) {
  const storage = new MemoryStorage(); storage.data.set(KEY, JSON.stringify(fixture(70)));
  globalThis.localStorage = storage; globalThis.location = { search: '' };
  const saveModule = await import(dataURL(`${saveCode}\n// ui-isolated-${++loadNo}`));
  const d = dom(), events = { toasts: [], reloads: 0, timers: [] };
  const ctx = vm.createContext({ console, ...saveModule, $: d.get, KEY, localStorage: storage, navigator: {},
    toast: (t) => events.toasts.push(t), fmt: (n) => String(n),
    setTimeout: (fn, ms) => events.timers.push({ fn, ms }), location: { reload: () => events.reloads++ } });
  vm.runInContext(source.backup(), ctx);
  return { ...d, ctx, events, storage, async paste(text) { d.get('bk-text').value = text; await d.get('bk-text').emit('input'); } };
}

await test('有效預覽後貼無效內容：舊版誤還原可重現，新版清除待還原資料', async () => {
  const before = await backupHarness(old); await before.paste(backupText(45)); assert.equal(before.get('bk-confirm').hidden, false); await before.paste('{this-is-not-a-valid-backup-json}'); await before.get('bk-apply').click();
  assert.equal(before.storage.writes.filter((k) => k === KEY).length, 1);
  const h = await backupHarness(); await h.paste(backupText(45)); assert.equal(h.get('bk-confirm').hidden, false);
  await h.paste('{this-is-not-a-valid-backup-json}'); await h.get('bk-apply').click();
  assert.equal(h.get('bk-confirm').hidden, true); assert.equal(h.storage.writes.length, 0); assert.equal(h.events.timers.length, 0);
  report.before.invalidPreviewWrites = 1; report.after.invalidPreviewWrites = 0;
});

await test('選檔取消、超大檔及讀取失敗都不能套用上次有效預覽', async () => {
  const h = await backupHarness();
  for (const file of [null, { size: 8_000_001 }, { size: 200, text: async () => { throw Error('隔離檔案不可讀'); } }]) {
    await h.paste(backupText(45)); h.get('bk-file').files = file ? [file] : []; await h.get('bk-file').emit('change');
    assert.equal(h.get('bk-confirm').hidden, true); await h.get('bk-apply').click();
  }
  assert.equal(h.storage.writes.length, 0); assert.equal(h.events.timers.length, 0);
});

await test('取消／更新輸入會失效尚未完成的舊檔案讀取', async () => {
  for (const interrupt of ['cancel', 'invalid-input', 'newer-file']) {
    const h = await backupHarness(); let resolve;
    h.get('bk-file').files = [{ size: 200, text: () => new Promise((done) => { resolve = done; }) }];
    const reading = h.get('bk-file').emit('change');
    if (interrupt === 'cancel') await h.get('bk-cancel').click();
    else if (interrupt === 'invalid-input') await h.paste('{this-is-not-a-valid-backup-json}');
    else { h.get('bk-file').files = [{ size: 200, text: async () => backupText(41) }]; await h.get('bk-file').emit('change'); }
    resolve(backupText(45)); await reading;
    if (interrupt === 'newer-file') { await h.get('bk-apply').click(); assert.equal(JSON.parse(h.storage.getItem(KEY)).best, 41); }
    else { assert.equal(h.get('bk-confirm').hidden, true, interrupt); await h.get('bk-apply').click(); assert.equal(h.storage.writes.length, 0, interrupt); }
  }
});

await test('還原前備份容量不足不重載；回復還原前資料先預覽再寫入', async () => {
  const h = await backupHarness(); await h.paste(backupText(45)); const original = h.storage.getItem(KEY);
  h.storage.fail = (key) => key === KEY + '-before-restore'; await h.get('bk-apply').click();
  assert.equal(h.storage.getItem(KEY), original); assert.equal(h.events.timers.length, 0);
  h.storage.fail = null; h.storage.data.set(KEY + '-before-restore', backupText(90)); await h.get('bk-undo').click();
  assert.equal(h.storage.getItem(KEY), original); assert.equal(h.get('bk-confirm').hidden, false); assert.match(h.get('bk-msg').textContent, /90/);
  await h.get('bk-apply').click(); assert.equal(JSON.parse(h.storage.getItem(KEY)).best, 90); assert.equal(h.events.timers.length, 1);
  await h.get('bk-apply').click();
  assert.equal(h.storage.getItem(KEY + '-before-restore'), original, '重複點還原不能把原存檔備份覆寫為匯入檔');
  assert.equal(h.events.timers.length, 1, '同一份還原只排程一次重新載入');
  h.events.timers[0].fn(); assert.equal(h.events.reloads, 1);
});

function context(extra = {}) {
  const d = dom(), events = [];
  const ctx = vm.createContext({ console, performance, ...economy, $: d.get, events, nav: { nm: '手動目的地' }, mode: 'free', state: 'free',
    fcar: { x: 0, z: 0, y: 10, h: 0, place(...v) { events.push(['place', ...v]); } },
    toast: (...v) => events.push(['toast', ...v]), finishDrift: (action) => events.push(['drift', action]),
    chosen: { id: 'sedan' }, taxi: null, sr: null, police: null, ...extra });
  for (const name of ['taxiOn', 'streetRacing']) vm.runInContext(current.fn(name), ctx);
  return { ...d, ctx, events, load(...names) { for (const n of names) vm.runInContext(current.fn(n), ctx); } };
}
const trip = { from: '市府', to: '車站', distance: 3456, driven: 1200, remaining: 2256, timeLimit: 364, timeLeft: 150, junctions: 8,
  driveSeconds: 317, waitSeconds: 32, fare: 145, tipBeforeDeduction: 20, collisionDeduction: 5, hits: 1, bonus: 10, total: 170, status: 'riding' };
await test('計程車固定節點持續更新，明細展開狀態與上趟實收保留', async () => {
  const h = context({ taxi: { phase: 'ride', target: { nm: '車站' }, remaining: 2256, timeLeft: 150, money: 1000, tripSummary: trip, lastTrip: { ...trip, status: 'delivered' }, reroute: (...v) => h.events.push(['reroute', ...v]) }, rerouteAcc: 5 });
  h.load('taxiTripText', 'updateLastTaxiTrip', 'updateTaxiHud');
  const details = h.get('taxi-details'); details.open = true;
  for (const id of ['taxi-hud', 'taxi-details']) Object.defineProperty(h.get(id), 'innerHTML', { set() { throw Error('不得重建計程車固定互動節點'); } });
  h.ctx.updateTaxiHud(); h.ctx.taxi.timeLeft = 14; h.ctx.taxi.tripSummary = { ...trip, status: 'timeout', total: 0 }; h.ctx.updateTaxiHud();
  assert.equal(h.get('taxi-details'), details); assert.equal(details.open, true); assert.equal(h.get('taxi-time').className, 'bad');
  assert.match(h.get('taxi-trip-text').textContent, /超時，實收 0/); assert.match(h.get('taxi-last-trip').textContent, /實收 NT\$ 170/);
  assert.match(h.get('taxi-trip-text').textContent, /317 s＋8 個路口緩衝 32 s＋15 s/);
  assert.deepEqual(h.events.find((e) => e[0] === 'reroute'), ['reroute', 0, 0, 10]);
  h.ctx.taxi.phase = 'off'; h.ctx.updateTaxiHud(); assert.equal(h.get('taxi-hud').classList.contains('hidden'), true);
});

await test('同時有手動目的地時，街頭與計程車路線依任務優先，取消後回到手動導航', async () => {
  const routes = { street: [[1, 1], [2, 2]], taxi: [[3, 3], [4, 4]], manual: [[0, 0], [100, 0]] }, calls = [];
  const h = context({ sr: { phase: 'race', active: { path: routes.street } }, taxi: { phase: 'ride', target: {}, route: routes.taxi, routeYs: [9.5, 9.5] },
    nav: { x: 100, z: 0, y: 10, nm: '手動目的地', path: routes.manual, ys: [9.5, 9.5], t: 0 }, router: { route() { throw Error('任務路線不應重算手動導航'); } },
    navArrows: { update: (...v) => calls.push(v) }, routeRemaining: () => 100, sameRoadLevel: () => false, ROAD_Y: 0.5 });
  h.load('updateNav'); h.ctx.updateNav(0.1); assert.equal(calls.at(-1)[0], routes.street);
  h.ctx.sr.phase = 'idle'; h.ctx.updateNav(0.1); assert.equal(calls.at(-1)[0], routes.taxi); assert.equal(calls.at(-1)[4], h.ctx.taxi.routeYs);
  assert.equal(h.get('nav-hud').style.display, 'none'); assert.equal(h.ctx.nav.t, 0);
  h.ctx.taxi.phase = 'off'; h.ctx.updateNav(0.1); assert.equal(calls.at(-1)[0], routes.manual); assert.match(h.get('nav-hud').textContent, /100 m/);
});

await test('手動導航同平面才抵達，高架錯層不會清除路線', async () => {
  const h = context({ nav: { x: 0, z: 0, y: 1, nm: '地面目的地', path: [[0, 0], [1, 0]], ys: [0.5, 0.5], t: 0 },
    navArrows: { update() {} }, router: {}, routeRemaining: () => 0, sameRoadLevel: (a, b) => Math.abs(a.y - b.y) <= 2, ROAD_Y: 0.5 });
  h.load('updateNav'); h.ctx.updateNav(0.1); assert.ok(h.ctx.nav); h.ctx.fcar.y = 1; h.ctx.updateNav(0.1); assert.equal(h.ctx.nav, null);
});

await test('追緝入口與按鈕共享守門：計程車／街頭／暫停／錯車型都無法啟動', async () => {
  const police = { active: false, startPursuit: () => { h.events.push(['pursuit']); return '追緝開始'; } };
  const h = context({ police, chosen: { id: 'police' } }); h.load('canStartPursuit', 'startPursuit');
  const scenarios = [{ state: 'paused' }, { mode: 'race' }, { chosen: { id: 'sedan' } }, { taxi: { phase: 'ride' } }, { sr: { phase: 'count', active: {} } }];
  for (const bad of scenarios) { Object.assign(h.ctx, { state: 'free', mode: 'free', chosen: { id: 'police' }, taxi: null, sr: null }, bad); assert.equal(h.ctx.canStartPursuit(), false); h.ctx.startPursuit(); }
  assert.equal(h.events.length, 0); Object.assign(h.ctx, { state: 'free', mode: 'free', chosen: { id: 'police' }, taxi: null, sr: null });
  h.ctx.startPursuit(); assert.equal(h.ctx.nav, null); assert.deepEqual(h.events.slice(0, 2), [['drift', 'bank'], ['pursuit']]);
});

// 不建 Damage 的煙霧／貼圖：抽出真實類別，僅使用原型上的車損狀態方法。
const damageCode = stripTypeScriptTypes(await readFile(path.join(root, 'src/damage.ts'), 'utf8'), { mode: 'transform' });
const damageAst = parseAst(damageCode), damageNode = walk(damageAst, (n) => n.type === 'ClassDeclaration' && n.id?.name === 'Damage');
const damageContext = vm.createContext({}); vm.runInContext(`${damageCode.slice(damageNode.start, damageNode.end)};globalThis.Damage = Damage;`, damageContext);
function isolatedDamage(values = { sedan: 0.8, police: 0.2 }) {
  const d = Object.create(damageContext.Damage.prototype); Object.assign(d, { value: 0, vehicle: 'sedan', values: {}, lastPaint: -1 }); d.restore(values); return d;
}
await test('使用車款立即切換既有車損，街頭賽暫態車損不污染自由車及備份', async () => {
  const damage = isolatedDamage(), h = context({ damage, preview: { id: 'police' }, save: {}, ownedCars: () => new Set(['sedan', 'police']),
    writeSave: () => h.events.push(['save']), refreshGarage: () => {} });
  vm.runInContext(`var useCar = ${current.click('car-use')};`, h.ctx); h.ctx.useCar();
  assert.equal(damage.value, 0.2); assert.equal(h.ctx.chosen.id, 'police'); assert.equal(h.ctx.save.damage.sedan, 0.8); assert.deepEqual(h.events.slice(0, 2), [['drift', 'bank'], ['save']]);
  h.ctx.sr = { begin: () => h.events.push(['street-begin']), cancel() { this.active = null; }, active: {}, phase: 'race' };
  h.ctx.taxi = { stop: () => h.events.push(['taxi-stop']) }; h.ctx.police = { hide: () => h.events.push(['police-hide']) }; h.ctx.updateOffer = () => {};
  h.load('acceptChallenge', 'abandonStreetRace'); h.ctx.bigMsg = () => {}; h.ctx.sound = { beep() {} };
  h.ctx.acceptChallenge({}); assert.equal(h.ctx.nav, null); assert.equal(damage.value, 0); damage.value = 0.9;
  assert.equal(damage.snapshot().__street__, undefined); assert.equal(damage.snapshot().police, 0.2);
  h.ctx.abandonStreetRace(); assert.equal(damage.value, 0.2); assert.equal(damage.valueFor('sedan'), 0.8);
  const stop = h.events.findIndex((e) => e[0] === 'taxi-stop'), begin = h.events.findIndex((e) => e[0] === 'street-begin'); assert.ok(stop >= 0 && begin > stop);
});

await test('購車即換車會結算甩尾、切換車損後才扣款保存；不能重複購車', async () => {
  const damage = isolatedDamage(), h = context({ damage, preview: { id: 'super', name: '星馳', price: 5000 },
    save: { owned: ['sedan'], taxi: { money: 6000, trips: 1 } }, refreshGarage() {}, writeSave: () => h.events.push(['save', clone(h.ctx.save), damage.value]),
    ownedCars: () => new Set(h.ctx.save.owned) });
  h.load('money', 'setMoney'); vm.runInContext(`var buyCar = ${current.click('car-buy')};`, h.ctx); h.ctx.buyCar();
  assert.equal(h.ctx.chosen.id, 'super'); assert.equal(damage.value, 0); assert.equal(h.ctx.save.damage.sedan, 0.8);
  assert.equal(h.ctx.save.taxi.money, 1000); assert.equal(h.ctx.save.owned.filter((id) => id === 'super').length, 1);
  const saved = h.events.find((e) => e[0] === 'save'); assert.equal(h.events[0][0], 'drift'); assert.equal(saved[1].car, 'super'); assert.equal(saved[2], 0);
  const count = h.events.length; h.ctx.buyCar(); assert.equal(h.events.length, count); assert.equal(h.ctx.save.taxi.money, 1000);
});

await test('計程車入口結束街頭／警察任務，以目前車損倍率開始同層行程', async () => {
  const h = context({ damage: isolatedDamage(), userStart: async () => {}, field: { hide() {} }, hideMenu() {},
    sr: { phase: 'race', active: {}, cancel: () => h.events.push(['street-cancel']) }, police: { hide: () => h.events.push(['police-hide']) },
    beginFree: () => h.events.push(['begin-free']), taxi: { phase: 'off', setCondition: (n) => h.events.push(['condition', n]), start: (...v) => h.events.push(['taxi-start', ...v]) } });
  vm.runInContext(`var startTaxi = ${current.click('btn-taxi')};`, h.ctx); await h.ctx.startTaxi();
  assert.equal(h.ctx.nav, null); assert.ok(h.events.some((e) => e[0] === 'street-cancel')); assert.ok(h.events.some((e) => e[0] === 'police-hide'));
  assert.ok(Math.abs(h.events.find((e) => e[0] === 'condition')[1] - 0.9) < 1e-12); assert.deepEqual(h.events.find((e) => e[0] === 'taxi-start'), ['taxi-start', 0, 0, 10]);
  assert.ok(h.events.findIndex((e) => e[0] === 'street-cancel') < h.events.findIndex((e) => e[0] === 'taxi-start'));
});

const failed = report.cases.filter((c) => c.status === 'FAIL'); report.summary = { passed: report.cases.length - failed.length, failed: failed.length };
await writeFile(path.join(root, 'tools/dev-tests/shots-main-platform-integration.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2)); if (failed.length) process.exitCode = 1;
