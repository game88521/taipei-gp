// 執行真 UI / main 入口與取消 callback；以可控 Promise 重現城市與連線晚到。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import { pureUrl } from './pure-module-loader.mjs';
import { COOP_QUICK_PHRASES, COOP_QUICK_COOLDOWN_MS } from '../../shared/odyssey-coop.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = process.argv.includes('--before');
const sourcePrefix = before ? 'tools/dev-tests/summit-coop-entry-before' : 'src';
const source = resolve(root, sourcePrefix);
const uiRaw = await readFile(resolve(source, 'nexus-coop-ui.ts'), 'utf8');
const mainRaw = await readFile(resolve(source, 'main.ts'), 'utf8');
const quickRaw = await readFile(resolve(root, 'src/odyssey-coop-quick.ts'), 'utf8');
const quickCode = stripTypeScriptTypes(quickRaw, { mode: 'transform' }).replace(/^import[^\n]*\r?\n/gm, '').replace(/^export /gm, '');
const ui = stripTypeScriptTypes(uiRaw, { mode: 'transform' }), main = stripTypeScriptTypes(mainRaw, { mode: 'transform' });
const uiAst = parseAst(ui), mainAst = parseAst(main);
const { MultiplayerEntryWait, ENTRY_CANCELLED } = await import(await pureUrl(root, 'multiplayer-entry.ts'));
function walk(n, test) { if (!n || typeof n !== 'object') return null; if (test(n)) return n; for (const v of Object.values(n)) for (const child of Array.isArray(v) ? v : [v]) { const hit = walk(child, test); if (hit) return hit; } return null; }
const mount = walk(uiAst, n => n.type === 'FunctionDeclaration' && n.id?.name === 'mountNexusCoop');
const uiFn = name => mount.body.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
const cancelButton = walk(mount, n => n.type === 'CallExpression' && n.callee?.name === 'button' && n.arguments[0]?.value === 'coop-cancel-entry');
const mountMain = walk(mainAst, n => n.type === 'CallExpression' && n.callee?.name === 'mountNexusCoop');
const hostEnter = mountMain.arguments[0].properties.find(n => n.key?.name === 'enter').value;
const hostLeft = mountMain.arguments[0].properties.find(n => n.key?.name === 'left').value;
const switchLoop = mainAst.body.find(n => n.type === 'ForOfStatement' && n.left?.declarations?.[0]?.id?.name === 'id' && walk(n, c => c.type === 'CallExpression' && c.callee?.object?.name === 'nexusCoop' && c.callee?.property?.name === 'leave'));
const switchClick = walk(switchLoop, n => n.type === 'CallExpression' && n.callee?.property?.name === 'addEventListener').arguments[1];
const topReturn = mount.body.body.find(n => n.type === 'ReturnStatement');
const disposeProperty = topReturn.argument.properties.find(n => n.key?.name === 'dispose');
const sha = value => createHash('sha256').update(value).digest('hex');
const scriptPath = fileURLToPath(import.meta.url), scriptRaw = await readFile(scriptPath);
const report = { before, source, sourceHashes: { [`${sourcePrefix}/nexus-coop-ui.ts`]: sha(uiRaw), [`${sourcePrefix}/main.ts`]: sha(mainRaw), 'src/multiplayer-entry.ts': sha(await readFile(resolve(root, 'src/multiplayer-entry.ts'))), 'src/odyssey-coop-quick.ts': sha(quickRaw), 'shared/odyssey-coop.ts': sha(await readFile(resolve(root, 'shared/odyssey-coop.ts'))) }, scriptSha256: sha(scriptRaw), cases: [], browserUsed: false, externalRequests: 0,
  limitations: ['真 UI enter/leave/cancel/render/dispose、真 main enter/left/切模式 callback；DOM、車與 NexusCoopClient 是隔離替身。', 'MultiplayerEntryWait 與快捷通訊 mountCoopQuick/update/dispose 使用真實實作；診斷 dispose 為非本套受測範圍的明示 noop。未代表手機權限視窗或真 WebSocket，後者由既有合作伺服器測試涵蓋。'] };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function element() {
  const classes = new Set(); return { value: '', hidden: false, disabled: false, textContent: '', children: [], style: {}, dataset: {}, setAttribute() {}, focus() {}, remove() {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, querySelectorAll() { return []; }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } };
}
const depot = { id: 'depot', name: '共同倉庫', x: 10, z: 20, y: 0, h: 0 };
const room = () => ({ code: 'ABCDEF', runId: 'a'.repeat(24), phase: 'lobby', reason: null, delivered: 0, points: 0, hostId: 'self', serverTime: 0, players: [{ id: 'self', name: '車手', ready: false, connected: true, delivered: 0, cargo: null }], cargo: [], dispatch: { reservations: [], pings: [], quick: [] } });
function fixture(options = {}) {
  const events = { restores: 0, prepares: 0, connects: 0, joins: 0, resumes: 0, stops: 0, disconnects: 0, closes: 0, disposal: 0 };
  const cities = [], connects = [], joins = [];
  let context;
  const client = { room: null, selfId: 'self', status: 'idle', message: '', resumable: false,
    connect() { events.connects++; if (options.connectPending) { const d = deferred(); connects.push(d); return d.promise; } return Promise.resolve(); },
    enter() { events.joins++; if (options.joinPending) { const d = deferred(); joins.push(d); return d.promise; } client.room = room(); return Promise.resolve(); },
    resume() { events.resumes++; if (options.joinPending) { const d = deferred(); joins.push(d); return d.promise; } client.room = room(); return Promise.resolve(); },
    stopRetry() { events.stops++; }, leave() { this.disconnect(); },
    disconnect() { events.disconnects++; this.room = null; this.status = 'idle'; context.render(); },
    serverNow: () => 0,
  };
  const nodes = Object.fromEntries(['name', 'code', 'taskMode', 'overlay', 'info', 'entry', 'create', 'join', 'cancel', 'resume', 'leave', 'invite', 'copy', 'clock', 'board', 'historyList'].map(key => [key, element()]));
  nodes.name.value = '城市車手'; nodes.code.value = 'ABCDEF';
  const graphics = {}, noop = () => {};
  const o = { canEnter: () => true, vehicle: () => 'street-f1',
    enter(_depot, isCurrent) { events.prepares++; const d = deferred(); cities.push({ ...d, isCurrent }); return d.promise; },
    left() { events.restores++; }, close() { events.closes++; },
    scene: { remove: noop },
  };
  context = vm.createContext({ ...nodes, o, client, ENTRY_CANCELLED, endpoint: 'ws://localhost/coop', COOP_STATIONS: [depot], validCoopCode: value => /^[A-Z0-9]{6}$/.test(value),
    busy: false, entered: false, commandBusy: false, previousActive: false, disposed: false, entryGeneration: 0, message: '', lastKey: '', lastFocus: null, results: [], canWriteHistory: true,prediction:{reset:noop},accumulator:0,
    dispatch: { update: noop, dispose() { events.disposal++; } },
    document: { createElement: () => element() }, performance, COOP_QUICK_PHRASES, COOP_QUICK_COOLDOWN_MS,
    diagnostics: { dispose: noop }, // New diagnostic UI is outside entry cancellation coverage.
    make(_tag, text) { return { ...element(), textContent: text }; }, button: () => element(), coopInvite: (_href, code) => code,
    location: { href: 'http://localhost/' }, localStorage: { setItem: noop }, action: noop, recordResult: noop,
    peers: new Map(), ringGeometry: { dispose: noop }, ringMaterial: { dispose: noop }, graphics, removePeer: noop, hud: element(), launch: element(),
  });
  vm.runInContext(quickCode, context);
  context.quick = context.mountCoopQuick(element(), noop);
  context.waiter = new MultiplayerEntryWait(() => context.render());
  for (const name of ['releaseEntry', 'cancelEntry', 'enter', 'leaveRoom', 'closePanel', 'setMessage', 'render']) {
    const n = uiFn(name); if (n) vm.runInContext(ui.slice(n.start, n.end), context);
  }
  vm.runInContext(`var clickCancel = ${ui.slice(cancelButton.arguments[2].start, cancelButton.arguments[2].end)}; var dispose = ({${ui.slice(disposeProperty.start, disposeProperty.end)}}).dispose;`, context);
  return { context, client, events, cities, connects, joins, nodes,
    async ready(kind = 'create') { const p = context.enter(kind); assert.equal(cities.length, 1); cities[0].resolve(true); await p; return p; },
    cleanup() { context.leaveRoom(); },
  };
}
async function check(name, run) { try { await run(); report.cases.push({ name, status: 'PASS' }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).slice(0, 2500) }); } }

await check('取消城市準備後晚到的成功不能開始連線，暱稱房碼保留', async () => {
  const f = fixture(), pending = f.context.enter('create');
  f.context.clickCancel(); const busyAfterCancel = f.context.busy, restoresAfterCancel = f.events.restores;
  f.cities[0].resolve(true); await pending;
  assert.equal(busyAfterCancel, false); assert.equal(restoresAfterCancel, 1);
  assert.equal(f.events.connects, 0); assert.equal(f.events.joins, 0); assert.equal(f.context.entered, false);
  assert.equal(f.nodes.name.value, '城市車手'); assert.equal(f.nodes.code.value, 'ABCDEF'); f.cleanup();
});
await check('取消城市準備後晚到的失敗不能覆寫取消訊息', async () => {
  const f = fixture(), pending = f.context.enter('create'); f.context.clickCancel();
  f.cities[0].reject(Error('舊城市載入失敗')); await pending;
  assert.equal(f.context.message, ENTRY_CANCELLED); assert.equal(f.events.restores, 1); assert.equal(f.events.stops, 0); f.cleanup();
});
for (const outcome of ['resolve', 'reject']) await check(`取消後立即重試：舊準備${outcome}不能清除新 busy／還原責任`, async () => {
  const f = fixture(), first = f.context.enter('create'); f.context.clickCancel(); const second = f.context.enter('join');
  assert.equal(f.cities.length, 2); assert.equal(f.context.busy, true);
  f.cities[0][outcome](outcome === 'resolve' ? true : Error('舊準備失敗')); await first;
  assert.equal(f.context.busy, true); assert.equal(f.context.entered, true); assert.equal(f.events.restores, 1); assert.equal(f.events.connects, 0);
  f.cities[1].resolve(true); await second; assert.equal(f.context.busy, false); assert.equal(f.events.joins, 1); f.cleanup();
});
await check('真 waiter 連線途中取消後立刻可重試，舊 finally 不改新 busy', async () => {
  const f = fixture({ connectPending: true }), first = f.context.enter('create'); f.cities[0].resolve(true); await tick();
  assert.equal(f.context.waiter.active, true); f.context.clickCancel(); const second = f.context.enter('create'); await first;
  assert.equal(f.context.busy, true); assert.equal(f.cities.length, 2); f.connects[0].resolve(); await tick();
  assert.equal(f.events.joins, 0); f.context.clickCancel(); f.cities[1].resolve(true); await second; f.cleanup();
});
for (const outcome of ['resolve', 'reject']) await check(`進房回覆${outcome}晚到不能改新 entry`, async () => {
  const f = fixture({ joinPending: true }), first = f.context.enter('create'); f.cities[0].resolve(true); await tick();
  assert.equal(f.joins.length, 1); f.context.clickCancel(); f.nodes.code.value = 'ZXCVBN'; const second = f.context.enter('join');
  f.joins[0][outcome](outcome === 'resolve' ? undefined : Error('舊進房失敗')); await first;
  assert.equal(f.context.busy, true); assert.equal(f.nodes.code.value, 'ZXCVBN'); assert.equal(f.events.restores, 1);
  f.context.clickCancel(); f.cities[1].resolve(true); await second; f.cleanup();
});
await check('leave 取消城市準備且關面板後，舊 Promise 不重啟', async () => {
  const f = fixture(), pending = f.context.enter('create'); f.context.leaveRoom(); f.context.closePanel();
  assert.equal(f.context.busy, false); assert.equal(f.events.closes, 1); assert.equal(f.nodes.overlay.classList.contains('hidden'), true);
  f.cities[0].resolve(true); await pending; assert.equal(f.events.connects, 0); assert.equal(f.events.restores, 1); f.cleanup();
});
await check('dispose 使待完成準備失效，舊成功不能重新連線', async () => {
  const f = fixture(), pending = f.context.enter('create'); f.context.dispose(); f.cities[0].resolve(true); await pending;
  assert.equal(f.context.disposed, true); assert.equal(f.context.busy, false); assert.equal(f.events.connects, 0); assert.equal(f.events.disposal, 1); assert.equal(f.events.restores, 1);
  await f.context.enter('create'); assert.equal(f.events.prepares, 1);
});
await check('合法建立合作房仍成功，離房只還原一次', async () => {
  const f = fixture(); await f.ready(); assert.equal(f.events.joins, 1); assert.equal(f.context.busy, false); assert.equal(f.context.entered, true);
  f.context.leaveRoom(); assert.equal(f.events.restores, 1); assert.equal(f.context.entered, false); f.cleanup();
});
await check('城市準備失敗可直接重試', async () => {
  const f = fixture(), first = f.context.enter('create'); f.cities[0].resolve(false); await first;
  assert.equal(f.context.busy, false); assert.equal(f.events.restores, 1); assert.equal(f.events.connects, 0);
  const second = f.context.enter('create'); f.cities[1].resolve(true); await second; assert.equal(f.events.joins, 1); f.cleanup();
});
await check('續接既有房不重複準備／移車，失敗時保留還原責任', async () => {
  const f = fixture({ joinPending: true }); f.context.entered = true; f.client.room = room(); f.context.previousActive = true;
  const pending = f.context.enter('resume'); await tick(); assert.equal(f.events.prepares, 0); assert.equal(f.events.resumes, 1);
  f.joins[0].reject(Error('續接未完成')); await pending;
  assert.equal(f.context.entered, true); assert.equal(f.events.restores, 0); f.cleanup(); assert.equal(f.events.restores, 1);
});

function hostFixture() {
  const permission = deferred(), systems = deferred();
  const events = { systems: 0, begins: 0, teleports: 0, saves: 0, restores: 0 };
  let current = true;
  const noop = () => {}, node = () => ({ style: {}, className: '' });
  const ctx = vm.createContext({ state: 'paused', mode: 'free', coopReturnPosition: null, camSnap: false, nav: null,
    userStart: () => permission.promise, ensureStreetSystems: () => { events.systems++; return systems.promise; },
    summitCityRace: undefined, summitDuty: undefined, taxiOn: () => false, streetRacing: () => false, police: null, evolutionCity: null, driftChallenge: { active: false },
    saveSeasonCheckpoint() { events.saves++; }, finishDrift: noop, stopPolice: noop, sr: null, updateOffer: noop, field: { hide: noop }, hideMenu: noop,
    beginFree() { events.begins++; ctx.state = 'free'; }, clock: { getDelta: noop }, $: node, sound: { engine: noop },
    fcar: { x: 100, z: 200, h: 1, y: 0, place(x, z, h, y) { events.teleports++; Object.assign(this, { x, z, h, y }); } },
  });
  vm.runInContext(`var enterHost = ${main.slice(hostEnter.start, hostEnter.end)}; var leftHost = ${main.slice(hostLeft.start, hostLeft.end)};`, ctx);
  return { ctx, events, permission, systems, current: () => current, cancel() { current = false; ctx.leftHost(); } };
}
for (const point of ['permission', 'systems']) for (const sameMode of [true, false]) await check(`真 main：${point} 晚到，取消後${sameMode ? '同模式' : '換模式'}都不能開始／移車`, async () => {
  const f = hostFixture(), pending = f.ctx.enterHost(depot, f.current);
  if (point === 'systems') { f.permission.resolve(true); await tick(); assert.equal(f.events.systems, 1); }
  f.cancel(); if (!sameMode) f.ctx.state = 'menu';
  f.permission.resolve(true); f.systems.resolve(true); await pending;
  assert.equal(f.events.begins, 0); assert.equal(f.events.teleports, 0); assert.equal(f.events.saves, 0);
  if (point === 'permission') assert.equal(f.events.systems, 0);
});
await check('真 main 合法準備仍開始，離開回到原車位', async () => {
  const f = hostFixture(), pending = f.ctx.enterHost(depot, f.current); f.permission.resolve(true); f.systems.resolve(true); assert.equal(await pending, true);
  assert.equal(f.events.begins, 1); assert.equal(f.ctx.fcar.x, depot.x); f.ctx.leftHost(); assert.equal(f.ctx.fcar.x, 100); assert.equal(f.ctx.coopReturnPosition, null);
});
for (const status of ['lazyBusy', 'busy', 'opened', 'active']) await check(`真切模式 capture：${status} 必須先離開並關面板`, async () => {
  const order = [], nexusCoop = { active: status === 'active', busy: status === 'busy' || status === 'lazyBusy', opened: status === 'opened', leave() { order.push('leave'); this.busy = false; this.active = false; }, close() { order.push('close'); this.opened = false; } };
  const ctx = vm.createContext({ nexusCoop, toast() { order.push('toast'); } });
  vm.runInContext(`var switchMode = ${main.slice(switchClick.start, switchClick.end)};`, ctx); ctx.switchMode();
  assert.deepEqual(order.slice(0, 2), ['leave', 'close']); assert.equal(nexusCoop.busy, false); assert.equal(nexusCoop.opened, false);
});

assert.equal(await readFile(resolve(source, 'nexus-coop-ui.ts'), 'utf8'), uiRaw, '測試不能修改受測 UI');
assert.equal(await readFile(resolve(source, 'main.ts'), 'utf8'), mainRaw, '測試不能修改受測 main');
const finalSourceHashes = Object.fromEntries(await Promise.all(Object.keys(report.sourceHashes).map(async file => [file, sha(await readFile(resolve(root, file)))])));
report.sourceUnchangedDuringTests = JSON.stringify(finalSourceHashes) === JSON.stringify(report.sourceHashes);
report.scriptUnchangedDuringTests = sha(await readFile(scriptPath)) === report.scriptSha256;
assert.equal(report.sourceUnchangedDuringTests, true, '測試期間受測來源不能改動');
assert.equal(report.scriptUnchangedDuringTests, true, '測試期間腳本不能改動');
report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length };
report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(resolve(root, `tools/dev-tests/summit-coop-entry${before ? '-before' : ''}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (report.summary.failed) process.exitCode = 1;
