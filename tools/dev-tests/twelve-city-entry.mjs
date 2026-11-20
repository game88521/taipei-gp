// 真main callback＋可控權限Promise；DOM/錢包為隔離替身，不開瀏覽器。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { pureUrl } from './pure-module-loader.mjs';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), old = process.argv[2] === '--before';
// The inactive real controller leaves the original callback behavior intact.
const {VoyagerPhoto}=await import(await pureUrl(root,'voyager-photo.ts'));
const source = old ? resolve(root, '../taipei-gp-twelve-before-102e84eea8ea') : root;
const raw = await readFile(resolve(source, 'src/main.ts'), 'utf8'), code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
const slice = (n) => { assert.ok(n, '找不到真main入口'); return code.slice(n.start, n.end); };
const fn = (name) => ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
function walk(n, test) { if (!n || typeof n !== 'object') return null; if (test(n)) return n; for (const v of Object.values(n)) { for (const c of Array.isArray(v) ? v : [v]) { const hit = walk(c, test); if (hit) return hit; } } return null; }
const isClick = (n) => n.type === 'CallExpression' && n.callee?.property?.name === 'addEventListener' && n.arguments[0]?.value === 'click';
const click = (id) => walk(ast, (n) => isClick(n) && n.callee.object?.arguments?.[0]?.value === id)?.arguments[1];
const entry = old ? null : await import(await pureUrl(root, 'city-entry-intent.ts'));
const script = fileURLToPath(import.meta.url), hash = (v) => createHash('sha256').update(v).digest('hex');
const sourceFiles = old ? ['src/main.ts'] : ['src/main.ts', 'src/city-entry-intent.ts', 'src/voyager-photo.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(resolve(source, file)))])));
const report = { source, status: 'RUNNING', sourceHash: hash(raw), sourceHashes: await sourceHashes(), scriptSha256: hash(await readFile(script)), before: old, cases: [], browserUsed: false, playerStorageTouched: false,
  limitations: ['執行真main的userStart、普通接單/單次街賽callback及返回處理；DOM、合法offer、音效與存檔為隔離替身。', '權限延遲以可控Promise重現，未代表真手機授權對話框。'] };
function eventTarget() { const events = new Map(); return { addEventListener(type, cb) { const list = events.get(type) ?? []; list.push(cb); events.set(type, list); }, removeEventListener() {}, emit(type, event = {}) { for (const cb of events.get(type) ?? []) cb(event); } }; }
function element(hidden = true) {
  const classes = new Set(hidden ? ['hidden'] : []);
  const e = { ...eventTarget(), hidden: false, disabled: false, isConnected: true, value: '', checked: false, style: {}, children: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    closest: () => e, contains: (child) => e.children.includes(child) };
  return e;
}
function fixture(kind, lateSystems = false) {
  const els = new Map(), $ = (id) => { if (!els.has(id)) els.set(id, element()); return els.get(id); };
  const page = kind === 'taxi' ? 'taxi-order-page' : 'duel-pick', list = element(false), b = element(false); list.children.push(b); $(page).classList.remove('hidden');
  const events = { attempts: 0, accepts: 0, starts: 0, writes: 0, userStarts: 0, systemsCalls: 0 }, window = eventTarget();
  const document = { ...eventTarget(), hidden: false, documentElement: {}, fullscreenElement: null, querySelector: () => null };
  let resolveTilt, rejectTilt, offered = true;
  const tilt = new Promise((resolve, reject) => { resolveTilt = resolve; rejectTilt = reject; });
  let resolveSystems, rejectSystems;
  const systems = lateSystems ? new Promise((resolve, reject) => { resolveSystems = resolve; rejectSystems = reject; }) : true;
  const guard = entry ? new entry.CityEntryIntent() : null;
  if (entry) entry.bindCityEntryCancellation(guard, document, window);
  const c = { def: { id: 'route' } }, options = { difficulty: 'standard', carId: 'street-f1', rules: 'traffic' };
  const ctx = vm.createContext({ voyagerPhoto: new VoyagerPhoto({canOpen:()=>false}), nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, horizonUi: null, horizonCity: null, evolutionOwned: false, cityChallengeOpenToken: null, $, b, list, order: { id: 'order' }, c, document, window, cityEntryIntent: guard,
    state: 'paused', mode: 'free', taxiCheckpointPending: false, nav: null, camSnap: false, mapOpen: false,
    fcar: { x: 100, z: 200, y: 0 }, chosen: { id: 'taxi' }, TOUCH: false, steerMode: 'tilt',
    sound: { start() { events.userStarts++; } }, input: { enableTilt: () => tilt },
    taxi: { phase: 'off', acceptOrder() { events.attempts++; if (!offered) return false; offered = false; this.phase = 'seek'; events.accepts++; return true; } },
    sr: { challenges: [c], cancel() {} }, streetSeries: { active: false }, series: false,
    ensureStreetSystems: async () => { events.systemsCalls++; return systems; }, currentStreetOptions: () => options,
    finishDrift() {}, stopPolice() {}, abandonTaxi() {}, field: { hide() {} }, damage: { useVehicle() {} }, clock: { getDelta() {} },
    checkpointTaxi() {}, writeSave() { events.writes++; }, updateTaxiResumeUi() {}, toast() {},
    hideMenu() { $('menu').classList.add('hidden'); }, showMenu() { $('menu').classList.remove('hidden'); },
    beginFree() { ctx.state = 'free'; }, acceptChallenge() { events.starts++; },
    streetResultOpen: () => false, BACK_LAYERS: ['tut', 'lb-page', 'ach-page', 'season-page', 'duel-pick'], closePassport() {},
  });
  vm.runInContext(slice(fn('userStart')), ctx);
  if (fn('beginCityEntry')) vm.runInContext(slice(fn('beginCityEntry')), ctx);
  vm.runInContext(slice(fn('goBack')), ctx);
  const callback = walk(fn(kind === 'taxi' ? 'renderTaxiOrders' : 'renderDuelRoutes'), isClick).arguments[1];
  vm.runInContext(`var run = ${slice(callback)}; var back = ${slice(click(kind === 'taxi' ? 'taxi-order-back' : 'duel-back'))};`, ctx);
  return { ctx, events, guard, document, window, $, b, list, resolveTilt, rejectTilt, resolveSystems, rejectSystems, get count() { return kind === 'taxi' ? events.attempts : events.starts; } };
}
async function check(name, action) { try { await action(); report.cases.push({ name, status: 'PASS' }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: String(e.stack ?? e).slice(0, 4500) }); } }
for (const kind of ['taxi', 'street']) {
  for (const route of ['back', 'escape', 'pagehide', 'switch', 'refresh']) await check(`${kind}:${route} 權限晚到${old ? '重現舊啟動' : '不能重啟已取消意圖'}`, async () => {
    const f = fixture(kind), pending = f.ctx.run(); assert.equal(f.count, 0);
    if (route === 'back') f.ctx.back();
    if (route === 'escape') f.ctx.goBack();
    if (route === 'pagehide') f.window.emit('pagehide');
    if (route === 'switch') { f.document.emit('click', { target: element() }); f.ctx.mode = 'race'; }
    if (route === 'refresh') { f.document.emit('change', { target: element() }); f.list.children = []; }
    f.resolveTilt(true); await pending;
    assert.equal(f.count, old ? 1 : 0); assert.equal(f.events.writes, old && kind === 'taxi' ? 1 : 0);
  });
  await check(`${kind}:連點只接受一次操作`, async () => {
    const f = fixture(kind), a = f.ctx.run(), b = f.ctx.run(); f.resolveTilt(true); await Promise.all([a, b]);
    assert.equal(f.count, old ? 2 : 1); assert.equal(f.events.userStarts, old ? 2 : 1);
  });
  await check(`${kind}:合法操作仍正常開始`, async () => { const f = fixture(kind), p = f.ctx.run(); f.resolveTilt(true); await p; assert.equal(f.count, 1); assert.equal(f.b.disabled, false); });
  if (!old) await check(`${kind}:權限失敗恢復按鈕且不留忙碌狀態`, async () => {
    const f = fixture(kind), p = f.ctx.run(); f.rejectTilt(Error('controlled permission failure')); await p;
    assert.equal(f.count, 0); assert.equal(f.b.disabled, false); assert.equal(f.guard.pending, false);
  });
}
for (const route of ['back', 'escape', 'pagehide', 'switch', 'refresh', 'legal', ...(!old ? ['failure'] : [])]) await check(`street:城市載入晚到:${route}`, async () => {
  const f = fixture('street', true), pending = f.ctx.run(); f.resolveTilt(true);
  for (let i = 0; i < 8 && f.events.systemsCalls === 0; i++) await Promise.resolve();
  assert.equal(f.events.systemsCalls, 1); assert.equal(f.count, 0);
  if (route === 'back') f.ctx.back();
  if (route === 'escape') f.ctx.goBack();
  if (route === 'pagehide') f.window.emit('pagehide');
  if (route === 'switch') { f.document.emit('click', { target: element() }); f.ctx.mode = 'race'; }
  if (route === 'refresh') { f.document.emit('change', { target: element() }); f.list.children = []; }
  if (route === 'failure') f.rejectSystems(Error('controlled city load failure')); else f.resolveSystems(true);
  await pending; assert.equal(f.count, old || route === 'legal' ? 1 : 0); assert.equal(f.b.disabled, false);
  if (!old) assert.equal(f.guard.pending, false);
});
assert.equal(await readFile(resolve(source, 'src/main.ts'), 'utf8'), raw, '測試不得修改main');
assert.deepEqual(await sourceHashes(), report.sourceHashes); assert.equal(hash(await readFile(script)), report.scriptSha256);
report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(resolve(root, `tools/dev-tests/twelve-city-entry${old ? '-before' : ''}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); if (report.summary.failed) process.exitCode = 1;
