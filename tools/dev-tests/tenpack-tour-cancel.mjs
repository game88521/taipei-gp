import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import { pureUrl } from './pure-module-loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The inactive real controller leaves the original callback behavior intact.
const {VoyagerPhoto}=await import(await pureUrl(root,'voyager-photo.ts'));
const files = ['src/main.ts', 'src/city-jobs-ui.ts', 'src/city-jobs-state.ts', 'src/city-entry-intent.ts', 'src/voyager-photo.ts'];
const bytes = Object.fromEntries(await Promise.all(files.map(async f => [f, await readFile(path.join(root, f))])));
const hash = b => createHash('sha256').update(b).digest('hex');
const mainRaw = bytes['src/main.ts'].toString('utf8');
const { CityEntryIntent } = await import(await pureUrl(root, 'city-entry-intent.ts'));
const beforeSourceHash = 'ab3917eb2e17596d2ae3de6840de5eafe8d52351cdcb048d9f2dbcb1d608dfe4';
// 從不可變已驗TenPack來源重建歷史before，不能從之後任意版本的全文推測舊版。
const beforeReference = path.resolve(root, '../taipei-gp-twelve-before-102e84eea8ea/src/main.ts');
const beforeReferenceRaw = await readFile(beforeReference, 'utf8');
assert.equal(hash(beforeReferenceRaw), 'fbbd3c5af1d31a02b421f6ea645b943655f15e37496721745bd3a732253e2dc8', '不可變參考來源已變動');
// 仍只還原原3處觀光guard，且嚴格維持原已實際跑過的known-before全文SHA。
const beforeRaw = beforeReferenceRaw.replace('acceptTour: async (id, isCurrent) => {', 'acceptTour: async id => {')
  .replace(/^    const canAccept = \(\) => isCurrent\(\) && !\$\('taxi-order-page'\)\.classList\.contains\('hidden'\);\r?\n/m, '')
  .replace(/^    if \(!canAccept\(\)\) return false;\r?\n/gm, '');
assert.equal(hash(beforeRaw), beforeSourceHash, '修前全文SHA不同，不得把其他版本當before；須先核對main變更。');
function extract(raw) {
  const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code), slice = n => code.slice(n.start, n.end);
  const mount = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' && n.expression.left.name === 'cityJobsUi');
  const accept = mount.expression.right.arguments[0].properties.find(p => p.key.name === 'acceptTour').value;
  const fn = name => slice(ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name));
  const back = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' &&
    n.expression.callee.type === 'MemberExpression' && n.expression.callee.property.name === 'addEventListener' &&
    n.expression.callee.object.type === 'CallExpression' && n.expression.callee.object.arguments[0]?.value === 'taxi-order-back');
  return { accept: slice(accept), userStart: fn('userStart'), goBack: fn('goBack'), back: slice(back.expression.arguments[1]) };
}
const after = extract(mainRaw), before = extract(beforeRaw);
const uiCode = stripTypeScriptTypes(bytes['src/city-jobs-ui.ts'].toString('utf8'), { mode: 'transform' });
const uiAst = parseAst(uiCode), mount = uiAst.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.id?.name === 'mountCityJobsUi').declaration;
const mountSource = uiCode.slice(mount.start, mount.end);
const stateCode = stripTypeScriptTypes(bytes['src/city-jobs-state.ts'].toString('utf8'), { mode: 'transform' }).replace(/^export /gm, '');
const report = { usesRealMainAstAndCityUi: true, browserUsed: false, externalRequests: 0, playerStorageTouched: false,
  beforeSourceHash, beforeReference, beforeReferenceHash: hash(beforeReferenceRaw), beforeReconstructedBytesMatchKnownSource: true, sourceHashes: Object.fromEntries(files.map(f => [f, hash(bytes[f])])),
  cases: [], limitations: ['真main callback/userStart/返回與真city UI；DOM、合法offer、保存與音訊為隔離替身。',
    '以可控enableTilt Promise測晚到；非真瀏覽器權限延遲、手機或WebGL測試。'] };
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.handlers = new Map(); this.disabled = false; this.value = ''; this.dataset = {}; this.text = ''; const classes = new Set();
    this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); if (this.tagName === 'select' && !this.value) this.value = n.value; } }
  replaceChildren(...nodes) { for (const n of this.children) n.parent = null; this.children = []; this.text = ''; this.append(...nodes); }
  set textContent(t) { this.replaceChildren(); this.text = t; }
  get textContent() { return this.text + this.children.map(n => n.textContent).join(''); }
  setAttribute() {}
  addEventListener(name, fn) { const list = this.handlers.get(name) ?? []; list.push(fn); this.handlers.set(name, list); }
  emit(name = 'click', force = false) { return this.disabled && !force ? Promise.resolve() : Promise.all((this.handlers.get(name) ?? []).map(fn => fn({}))); }
  getClientRects() { for (let el = this; el; el = el.parent) if (el.hidden || el.classList.contains('hidden')) return []; return [{}]; }
}
function fixture(real = after, options = {}) {
  const els = new Map(), $ = id => { if (!els.has(id)) { const el = new Element(); el.id = id; el.classList.add('hidden'); els.set(id, el); } return els.get(id); };
  $('taxi-order-page').classList.remove('hidden'); $('taxi-tour-panel').classList.remove('hidden'); $('taxi-order-page').append($('taxi-tour-panel'));
  const events = { accepts: [], writes: 0, checkpoints: 0, starts: 0 }; let resolveTilt, rejectTilt, tilt;
  const nextTilt = () => { tilt = new Promise((resolve, reject) => { resolveTilt = resolve; rejectTilt = reject; }); }; nextTilt();
  let previews = 0;
  const taxi = { phase: 'off', previewTours() { return [{ id: `offer-${++previews}`, from: '起點', pickupDistance: 10, tourStops: [{ nm: '甲' }, { nm: '乙' }, { nm: '丙' }], distance: 1200, estimatedFare: 100, tourBonus: 240, estimatedTotal: 340 }]; },
    acceptTour(id) { events.accepts.push(id); if (options.throwAccept) throw Error('controlled failure'); if (options.rejectAccept) return false; this.phase = 'seek'; return true; } };
  const ctx = vm.createContext({ voyagerPhoto: new VoyagerPhoto({canOpen:()=>false}), nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, horizonUi: null, horizonCity: null, evolutionOwned: false, cityChallengeOpenToken: null, $, cityEntryIntent: new CityEntryIntent(), state: 'paused', mode: 'free', taxiCheckpointPending: false, nav: null, camSnap: false,
    fcar: { x: 100, z: 200, y: 0 }, chosen: { id: 'taxi' }, TOUCH: false, steerMode: 'tilt',
    sound: { start() { events.starts++; } }, input: { enableTilt: () => tilt }, document: { documentElement: {}, fullscreenElement: null, createElement: tag => new Element(tag) },
    taxi, finishDrift() {}, stopPolice() {}, sr: null, field: { hide() {} }, damage: { useVehicle() {} }, clock: { getDelta() {} },
    checkpointTaxi() { events.checkpoints++; }, writeSave() { events.writes++; }, updateTaxiResumeUi() {}, toast() {},
    hideMenu() { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); },
    showMenu() { $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); }, streetResultOpen: () => false,
  });
  vm.runInContext(stateCode, ctx); vm.runInContext(mountSource, ctx);
  vm.runInContext(real.userStart, ctx); vm.runInContext(real.goBack, ctx);
  vm.runInContext(`var acceptTour = ${real.accept}; var back = ${real.back};`, ctx);
  const ui = ctx.mountCityJobsUi({ policeHost: new Element(), tourHost: $('taxi-tour-panel'), getPolice: () => null, getTaxi: () => taxi,
    getPosition: () => ctx.fcar, onPoliceCareer() {}, acceptTour: ctx.acceptTour });
  const all = () => { const out = []; function visit(n) { out.push(n); for (const c of n.children) visit(c); } visit($('taxi-tour-panel')); return out; };
  const find = id => all().find(n => n.id === id);
  const preview = async () => { await find('taxi-tour-preview').emit(); return all().find(n => n.dataset.tourId); };
  const reopen = () => { $('taxi-order-page').classList.remove('hidden'); $('menu').classList.add('hidden'); ui.renderTours(); };
  return { ctx, events, $, taxi, ui, find, preview, reopen, nextTilt, resolve: v => resolveTilt(v), reject: e => rejectTilt(e) };
}
async function check(name, run) { try { const detail = await run(); report.cases.push({ name, status: 'PASS', detail }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } }
for (const route of ['back', 'goBack']) {
  await check(`before真來源：${route}關頁後仍接舊單並保存，確定重現`, async () => {
    const f = fixture(before), b = await f.preview(), pending = b.emit(); f.ctx[route]();
    assert.equal(f.$('menu').classList.contains('hidden'), false); f.resolve(true); await pending;
    assert.deepEqual(f.events.accepts, ['offer-1']); assert.equal(f.ctx.state, 'free'); assert.equal(f.events.writes, 1);
  });
  await check(`after真來源：${route}關頁後晚到不接單、不切模式、不保存`, async () => {
    const f = fixture(), b = await f.preview(), pending = b.emit(); f.ctx[route](); f.resolve(true); await pending;
    assert.deepEqual(f.events.accepts, []); assert.equal(f.ctx.state, 'paused'); assert.equal(f.events.writes, 0);
    assert.equal(f.$('menu').classList.contains('hidden'), false); assert.equal(f.find('taxi-tour-preview').disabled, false);
  });
}
await check('after：正常接單與連點只成功一次、存檔一次', async () => {
  const f = fixture(), b = await f.preview(), pending = b.emit(); await b.emit('click', true);
  assert.equal(f.events.starts, 1); assert.deepEqual(f.events.accepts, []); f.resolve(true); await pending;
  assert.deepEqual(f.events.accepts, ['offer-1']); assert.equal(f.ctx.state, 'free'); assert.equal(f.events.writes, 1);
  await b.emit('click', true); assert.equal(f.events.writes, 1);
});
await check('after：關頁再開更新generation，原Promise無法接舊單，新預覽可正常成功', async () => {
  const f = fixture(), b = await f.preview(), pending = b.emit(); f.ctx.back(); f.reopen();
  f.resolve(true); await pending; assert.deepEqual(f.events.accepts, []); assert.equal(f.events.writes, 0);
  f.nextTilt(); const fresh = await f.preview(), next = fresh.emit(); f.resolve(true); await next;
  assert.deepEqual(f.events.accepts, ['offer-2']); assert.equal(f.events.writes, 1);
});
await check('after：待接單時count變更或重新render不讓舊callback與舊提示復活', async () => {
  for (const route of ['count', 'render']) {
    const f = fixture(), b = await f.preview(), pending = b.emit();
    if (route === 'count') { f.find('taxi-tour-count').value = '5'; await f.find('taxi-tour-count').emit('change', true); } else f.ui.renderTours();
    const prompt = f.find('taxi-tour-orders').textContent; f.resolve(true); await pending;
    assert.deepEqual(f.events.accepts, []); assert.equal(f.events.writes, 0); assert.equal(f.find('taxi-tour-orders').textContent, prompt);
  }
});
await check('after：已拆下或關頁的舊按鈕不進userStart', async () => {
  const f = fixture(), old = await f.preview(); await f.preview(); await old.emit('click', true);
  const live = await f.preview(); f.ctx.back(); await live.emit('click', true); assert.equal(f.events.starts, 0); assert.equal(f.events.writes, 0);
});
for (const kind of ['rejectAccept', 'throwAccept', 'rejectStart']) await check(`after：${kind}恢復預覽／站數控制，保留錯誤提示且不寫存檔`, async () => {
  const f = fixture(after, { [kind]: true }), b = await f.preview(), pending = b.emit();
  if (kind === 'rejectStart') f.reject(Error('controlled tilt failure')); else f.resolve(true);
  await pending; assert.equal(f.events.writes, 0); assert.equal(f.ctx.state, 'paused');
  assert.equal(f.find('taxi-tour-preview').disabled, false); assert.equal(f.find('taxi-tour-count').disabled, false);
  assert.match(f.find('taxi-tour-orders').textContent, kind === 'rejectAccept' ? /觀光單已失效/ : /暫時無法/);
  const next = await f.preview(); assert.ok(next); assert.equal(next.disabled, false);
});
for (const f of files) assert.equal(hash(await readFile(path.join(root, f))), report.sourceHashes[f], `${f}在測試期間變更`);
report.sourceUnchangedDuringTests = true; report.scriptHash = hash(await readFile(fileURLToPath(import.meta.url)));
report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length };
report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(new URL('tenpack-tour-cancel-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); if (report.status !== 'PASS') process.exitCode = 1;
