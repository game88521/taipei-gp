// 真路由/街賽與純提示模型；外觀、DOM及玩家存檔隔離。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { parseAst } from 'rolldown/parseAst';
import vm from 'node:vm';
import * as THREE from 'three';
import { pureUrl } from './pure-module-loader.mjs';
const script = fileURLToPath(import.meta.url), root = resolve(dirname(script), '../..');
const before = resolve(process.argv[2] ?? resolve(root, '../taipei-gp-twelve-before-102e84eea8ea'));
const sha = (value) => createHash('sha256').update(value).digest('hex'), clone = (value) => JSON.parse(JSON.stringify(value));
const files = ['src/main.ts', 'src/city-entry-intent.ts', 'src/city-guidance.ts', 'src/police-warning.ts', 'src/street-performance.ts',
  'src/streetrace.ts', 'src/street-series.ts', 'src/vehicles.ts', 'src/freecar.ts', 'src/police.ts', 'src/router.ts', 'src/mission.ts', 'index.html', 'src/style.css'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async (file) => [file, sha(await readFile(resolve(root, file)))])));
const report = { source: root, before, status: 'RUNNING', cases: [], sourceHashes: await hashes(), scriptSha256: sha(await readFile(script)),
  browserUsed: false, playerStorageTouched: false, limitations: ['執行真TS與真main AST；車輛外觀/DOM隔離，不代表WebGL/手機或完整駕駛平衡。', '導航為既有路徑的幾何轉向提示，無真實路口語意或語音合成。'] };
async function check(name, run) { try { report.cases.push({ name, status: 'PASS', details: await run() }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[真TS模組]').slice(0, 4500) }); } }
const { CityGuidance } = await import(await pureUrl(root, 'city-guidance.ts'));
const { PoliceEscapeWarning } = await import(await pureUrl(root, 'police-warning.ts'));
const performanceRules = await import(await pureUrl(root, 'street-performance.ts'));
const series = await import(await pureUrl(root, 'street-series.ts'));
const raw = await readFile(resolve(root, 'src/main.ts'), 'utf8'), main = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(main);
const fn = (name) => { const n = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name); assert.ok(n, name); return main.slice(n.start, n.end); };

async function loader(base) {
  const ctx = vm.createContext({ nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, evolutionOwned: false, cityChallengeOpenToken: null, console, crypto: webcrypto, performance, URLSearchParams, location: { search: '' } });
  const cache = new Map(), teams = Array.from({ length: 11 }, () => ({ livery: { main: '#ff0000' } }));
  const model = () => ({ root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] });
  const defaultSpec = (await import(await pureUrl(base, 'freecar.ts'))).DEFAULT_SPEC;
  const vehicleCode = stripTypeScriptTypes(await readFile(resolve(base, 'src/vehicles.ts'), 'utf8'), { mode: 'transform' });
  const vehicleAst = parseAst(vehicleCode), declaration = vehicleAst.body.find((n) => n.type === 'ExportNamedDeclaration' && n.declaration?.declarations?.some((d) => d.id.name === 'VEHICLES')).declaration;
  // 評估真VEHICLES陣列，僅不呼叫build；spec不在fixture重抄。
  const vehicles = vm.runInNewContext(`(()=>{${vehicleCode.slice(declaration.start, declaration.end)};return VEHICLES})()`, { DEFAULT_SPEC: defaultSpec });
  const byId = (id) => vehicles.find((v) => v.id === id) ?? vehicles[0];
  async function module(id) {
    if (cache.has(id)) return cache.get(id);
    const values = id === 'three' ? THREE : id.endsWith('/f1model.ts') ? { TEAMS: teams, makeF1: model }
      : id.endsWith('/track.ts') ? { TOWER_101: '終點塔' }
      : id.endsWith('/vehicles.ts') ? { vehicleById: byId, buildPlayerVehicle: () => ({ model: model(), setPaint() {} }) } : null;
    const m = values ? new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context: ctx, identifier: id })
      : new vm.SourceTextModule(stripTypeScriptTypes(await readFile(id, 'utf8'), { mode: 'transform' }), { context: ctx, identifier: id });
    cache.set(id, m); return m;
  }
  async function exports(file) {
    const m = await module(resolve(base, file).replaceAll('\\', '/'));
    if (m.status === 'unlinked') await m.link((id, ref) => { if (!id.startsWith('.')) return module(id); let p = resolve(dirname(ref.identifier), id).replaceAll('\\', '/'); if (!extname(p)) p += '.ts'; return module(p); });
    if (m.status !== 'evaluated') await m.evaluate(); return m.namespace;
  }
  return { exports, vehicles, byId };
}
const env = await loader(root), old = await loader(before);
const { Police } = await env.exports('src/police.ts'), { StreetRace } = await env.exports('src/streetrace.ts');
const { StreetRace: BeforeRace } = await old.exports('src/streetrace.ts'), { DEFAULT_SPEC } = await env.exports('src/freecar.ts');
const ground = () => 0;
const guide = (path, x = 0, z = 0, ys = null, y = 0, owner = 'destination', g = new CityGuidance()) => g.update(path, ys, owner, x, z, y, ground);

await check('4使用真Police.escapeIn，顯示超過450m後剩餘時間，450m內立刻清除', () => {
  const p = Object.create(Police.prototype); p.suspect = {}; p.escapeT = 4.25;
  const warning = new PoliceEscapeWarning(); assert.equal(p.escapeIn, 3.75);
  const a = warning.update(true, 451, p.escapeIn); assert.equal(a.remaining, 3.75); assert.match(a.text, /3\.8 s/); assert.equal(a.urgent, false);
  p.escapeT = 5.1; assert.equal(warning.update(true, 700, p.escapeIn).urgent, true);
  assert.equal(warning.update(true, 450, p.escapeIn), null); p.suspect = null; assert.equal(p.escapeIn, 0);
});
await check('4每秒短音最多一次，返回追蹤距離/勤務結束重設，非法距離不鳴叫', () => {
  const w = new PoliceEscapeWarning(); assert.equal(w.update(true, 500, 7.9).beep, true);
  for (let n = 0; n < 30; n++) assert.equal(w.update(true, 500, 7.8).beep, false);
  assert.equal(w.update(true, 500, 6.9).beep, true); assert.equal(w.update(true, 500, 6.5).beep, false);
  assert.equal(w.update(true, 300, 8), null); assert.equal(w.update(true, 500, 8).beep, true);
  assert.equal(w.update(false, 500, 5), null); assert.equal(w.update(true, Infinity, 5), null);
  assert.equal(w.update(true, 500, 0).beep, false);
});
await check('4真main消費實際倒數/顏色，偏好關閉零短音且多次HUD不重播', () => {
  const nodes = { wanted: {}, 'btn-pursuit': { style: {} } }, played = [];
  const ctx = vm.createContext({ nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, evolutionOwned: false, cityChallengeOpenToken: null, $: (id) => nodes[id], cityJobsUi: null, state: 'free', save: { opts: { 'city-pursuit-sound': false } },
    policeEscapeWarning: new PoliceEscapeWarning(), canStartPursuit: () => false, sound: { beep: (...v) => played.push(v) },
    police: { suspect: {}, suspectDistance: 600, suspectHp: 80, dutySummary: { hp: 100 }, arrestProgress: 0, pursuitT: 140, escapeIn: 2.7 } });
  vm.runInContext(fn('updateWantedHud'), ctx); ctx.updateWantedHud(); assert.match(nodes.wanted.className, /escape-urgent/); assert.match(nodes.wanted.textContent, /2\.7 s/); assert.equal(played.length, 0);
  ctx.save.opts['city-pursuit-sound'] = true; ctx.police.escapeIn = 1.9; ctx.updateWantedHud(); ctx.updateWantedHud(); assert.equal(played.length, 1);
  ctx.police.suspectDistance = 440; ctx.updateWantedHud(); assert.equal(nodes.wanted.className, 'show cop'); assert.doesNotMatch(nodes.wanted.textContent, /跟丟倒數/);
});
await check('11左右轉與迴轉幾何方向正確，沿路距離與轉彎距離不同', () => {
  const right = guide([[0, 0], [100, 0], [100, 100]]), left = guide([[0, 0], [100, 0], [100, -100]]), turn = guide([[0, 0], [100, 0], [0, 0]]);
  assert.equal(right.kind, 'right'); assert.equal(left.kind, 'left'); assert.equal(turn.kind, 'uturn'); assert.equal(right.toTurn, 100); assert.equal(right.remaining, 200);
  assert.match(right.instruction, /100 m 後右轉/); assert.equal(right.layer, '地面道路'); return { right, left, turn };
});
await check('11平滑路徑辨識同一轉彎、不把直線/重複點當彎，末段指向目的地', () => {
  const path = [[0, 0], [50, 0], [75, 0], [90, 5], [98, 12], [100, 25], [100, 50], [100, 100]], g = new CityGuidance();
  const first = guide(path, 0, 0, null, 0, 'a', g); assert.equal(first.kind, 'right');
  const after = guide(path, 100, 50, null, 0, 'a', g); assert.equal(after.kind, null); assert.match(after.instruction, /接近目的地/);
  assert.equal(guide([[0, 0], [0, 0], [100, 0]]).kind, null);
});
await check('11投影納入原routeYs，重疊橋面優先正確路層並顯示高架/地下', () => {
  const path = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0], [100, 0]], ys = [0, 0, 10, 10, 10, 10];
  const high = guide(path, 50, 0, ys, 10), low = guide(path, 50, 0, ys, 0);
  assert.equal(high.layer, '高架路段'); assert.equal(low.layer, '地面道路'); assert.equal(high.remaining, 50); assert.equal(low.remaining, 450);
  assert.equal(guide([[0, 0], [100, 0]], 0, 0, [-8, -8], -8).layer, '地下路段'); return { high, low };
});
await check('11相同平面折返重疊路線依已走進度，不跳回出發腿', () => {
  const path = [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0], [100, 0]], g = new CityGuidance();
  for (const [x, z] of [[0, 0], [90, 0], [100, 45], [20, 50], [0, 5]]) guide(path, x, z, null, 0, 'same', g);
  const r = guide(path, 50, 0, null, 0, 'same', g); assert.equal(r.remaining, 50);
});
await check('11重規劃同一轉彎不重複短音，目的地切換/取消清除後可再提示', () => {
  const path = [[0, 0], [100, 0], [100, 100]], g = new CityGuidance();
  assert.equal(guide(path, 10, 0, null, 0, 'a', g).cue, 'right'); assert.equal(guide(path, 20, 0, null, 0, 'a', g).cue, null);
  assert.equal(guide([[20, 0], [100, 0], [100, 100]], 20, 0, null, 0, 'a', g).cue, null);
  assert.equal(guide(path, 10, 0, null, 0, 'b', g).cue, 'right'); assert.equal(guide(null, 0, 0, null, 0, 'b', g), null);
  assert.equal(guide(path, 10, 0, null, 0, 'b', g).cue, 'right');
});
await check('11相隔45m的兩個右轉各提示一次，同一彎重算則不重播', () => {
  const path = [[0, 0], [100, 0], [100, 45], [0, 45]], g = new CityGuidance();
  assert.equal(guide(path, 10, 0, null, 0, 'nearby', g).cue, 'right');
  assert.equal(guide([[10, 0], [100, 0], [100, 45], [0, 45]], 10, 0, null, 0, 'nearby', g).cue, null);
  const next = guide(path, 100, 15, null, 0, 'nearby', g); assert.equal(next.kind, 'right'); assert.equal(next.cue, 'right');
  assert.equal(guide(path, 100, 17, null, 0, 'nearby', g).cue, null);
});
await check('11真main導航顯示路層/距離，選配短音關閉時不播放，取消清除', () => {
  const nodes = new Map(), played = [], $ = (id) => { if (!nodes.has(id)) nodes.set(id, { style: {} }); return nodes.get(id); };
  const ctx = vm.createContext({ nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, evolutionOwned: false, cityChallengeOpenToken: null, $, cityGuidance: new CityGuidance(), fcar: { x: 10, z: 0, y: 9.75 }, ROAD_Y: -.25, groundH: ground,
    state: 'free', save: { opts: { 'city-nav-sound': false } }, sound: { beep: (...v) => played.push(v) } });
  vm.runInContext(fn('showCityGuidance'), ctx); ctx.showCityGuidance([[0, 0], [100, 0], [100, 100]], [10, 10, 10], 'one', '測試');
  assert.match($('nav-hud').textContent, /右轉.*高架路段/); assert.equal(played.length, 0);
  ctx.save.opts['city-nav-sound'] = true; ctx.showCityGuidance([[0, 0], [100, 0], [100, 100]], [10, 10, 10], 'two', '測試'); assert.equal(played.length, 1);
  ctx.showCityGuidance(null, null, 'two', '測試'); assert.equal($('nav-hud').style.display, 'none');
});
await check('12真車庫各車款性能有界，強車對手更快；無效輸入仍有限數值', () => {
  report.profiles = env.vehicles.map((v) => ({ id: v.id, ...performanceRules.streetPerformance(v.spec) }));
  for (const p of report.profiles) for (const key of ['top', 'corner', 'accel', 'decel']) assert.ok(Number.isFinite(p[key]) && p[key] > 0 && p[key] <= 100);
  const pickup = performanceRules.streetPerformance(env.byId('pickup').spec), f1 = performanceRules.streetPerformance(env.byId('f1').spec);
  assert.ok(f1.top > pickup.top && f1.corner > pickup.corner && f1.accel > pickup.accel && f1.decel > pickup.decel);
  const bad = performanceRules.streetPerformance({ vmax: NaN, engine: Infinity, brake: -2, grip: 0, mass: 0 }); assert.ok(Object.values(bad).filter((v) => typeof v === 'number').every(Number.isFinite));
  return report.profiles;
});
await check('12新class v1規則獨立key/解析/獎牌，不寫入原版或其他車/車流/難度/單挑', () => {
  const options = { difficulty: 'standard', carId: 'pickup', rules: 'traffic-class-v1' }, key = series.streetChallengeKey('route', true, options), records = {};
  const result = { ...options, id: 'r', routeId: 'route', key, duel: true, finished: true, time: 60, place: 1, medal: 'gold' };
  assert.equal(series.recordStreetResult(records, result), true); assert.equal(series.parseStreetChallengeRecords(records)[key].best, 60);
  const keys = [key, series.streetChallengeKey('route', false, options), ...[{ rules: 'traffic' }, { rules: 'clear-class-v1' }, { carId: 'f1' }, { difficulty: 'hard' }].map((q) => series.streetChallengeKey('route', true, { ...options, ...q }))];
  assert.equal(new Set(keys).size, 6); for (const k of keys.slice(1)) assert.equal(records[k], undefined);
  assert.equal(performanceRules.baseStreetRule('clear-class-v1'), 'clear'); assert.equal(performanceRules.isClassStreetRule('traffic-class-v2'), false);
});
await check('12class系列保存恢復鎖規則，原版結果不能混入同級系列', () => {
  const options = { difficulty: 'hard', carId: 'f1', rules: 'clear-class-v1' }, s = new series.StreetSeries(); assert.equal(s.start(['a', 'b', 'c'], options), true);
  const result = { ...options, id: 'one', routeId: 'a', key: series.streetChallengeKey('a', true, options), duel: true, finished: true, time: 70, place: 2, medal: 'silver' };
  assert.equal(s.finish({ ...result, rules: 'clear', key: series.streetChallengeKey('a', true, { ...options, rules: 'clear' }) }), false);
  assert.equal(s.finish(result), true); const resumed = new series.StreetSeries(); assert.equal(resumed.restore(s.checkpoint, ['a', 'b', 'c']), true); assert.equal(resumed.checkpoint.rules, options.rules); assert.equal(resumed.nextRouteId, 'b');
});
const city = { net: { nodes: [0, 0, 800, 0, 1600, 0, 0, 800, 800, 800, 1600, 800, 0, 1600, 800, 1600, 1600, 1600],
  ways: [...[0, 3, 6].map((i) => ({ n: [i, i + 1, i + 2], c: 1, w: 12 })), ...[0, 1, 2].map((i) => ({ n: [i, i + 3, i + 6], c: 1, w: 12 }))], y: Array(9).fill(0) } };
const landmarks = [{ nm: '臺北市政府', x: 0, z: 0, r: 20 }, { nm: '終點塔', x: 1600, z: 0, r: 20 }];
await check('12原版單挑/對決三難度逐步狀態與不可變before一致，未改固定加減速', () => {
  for (const duel of [false, true]) for (const difficulty of ['easy', 'standard', 'hard']) {
    const a = new StreetRace(new THREE.Scene(), city, landmarks), b = new BeforeRace(new THREE.Scene(), city, landmarks), options = { carId: 'street-f1', rules: 'traffic', difficulty };
    a.begin(a.challenges[0], () => {}, duel, options); b.begin(b.challenges[0], () => {}, duel, options);
    const view = (r) => clone({ phase: r.phase, time: r.time, rivals: r.rivals.map(({ name, top, corner, s, v, lat, done, pos }) => ({ name, top, corner, s, v, lat, done, pos })) });
    const player = { x: -100, z: -100, y: -.25, h: 0, v: 0 };
    for (let n = 0; n < 1800; n++) { assert.equal(a.update(.02, player, null), b.update(.02, player, null)); assert.deepEqual(view(a), view(b)); }
    assert.ok(a.rivals.every((r) => r.accel === undefined && r.decel === undefined));
  }
});
await check('12真StreetRace套用所選車性能與難度，統一街賽使用DEFAULT_SPEC，v1結果隔離', () => {
  const race = new StreetRace(new THREE.Scene(), city, landmarks), c = race.challenges[0];
  for (const carId of ['street-f1', ...env.vehicles.map((v) => v.id)]) {
    const options = { carId, rules: 'traffic-class-v1', difficulty: 'hard' }; race.begin(c, () => {}, true, options);
    race.rivals.forEach((r, k) => { const p = performanceRules.streetPerformance(carId === 'street-f1' ? DEFAULT_SPEC : env.byId(carId).spec, k, true);
      assert.equal(r.top, p.top * 1.12); assert.equal(r.corner, p.corner * 1.06); assert.equal(r.accel, p.accel); assert.equal(r.decel, p.decel); });
    race.update(4, { x: -100, z: -100, h: 0, v: 0 }, null); race.update(.02, { x: -100, z: -100, h: 0, v: 0 }, null); assert.ok(race.rivals[0].v > 0);
    assert.equal(race.scopedRecordKey, series.streetChallengeKey(c.def.id, true, options));
  }
});
await check('12真main選項固定BOT原規則，車款/有無車流與class分開，系列續接接受class基底', () => {
  const nodes = { 'duel-difficulty': { value: 'hard' }, 'duel-car-mode': { value: 'selected' }, 'duel-opponents': { value: 'class' } };
  const ctx = vm.createContext({ nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, evolutionOwned: false, cityChallengeOpenToken: null, $: (id) => nodes[id], BOT: false, NO_TRAFFIC: false, chosen: { id: 'pickup' } }); vm.runInContext(fn('currentStreetOptions'), ctx);
  assert.deepEqual(clone(ctx.currentStreetOptions()), { carId: 'pickup', difficulty: 'hard', rules: 'traffic-class-v1' });
  ctx.NO_TRAFFIC = true; assert.equal(ctx.currentStreetOptions().rules, 'clear-class-v1'); ctx.BOT = true; assert.equal(ctx.currentStreetOptions().rules, 'clear'); assert.equal(ctx.currentStreetOptions().carId, 'street-f1');
});
await check('12真main續接class系列鎖原車/難度/規則，車流基底不符拒絕且釋放pending', async () => {
  for (const noTraffic of [true, false]) {
    const options = { id: 'series', carId: 'pickup', difficulty: 'hard', rules: 'clear-class-v1' }, route = { def: { id: 'next' } }, starts = [];
    const ctx = vm.createContext({ nexusCoop: undefined, nexusWorkshop: undefined, evolutionCity: undefined, evolutionOwned: false, cityChallengeOpenToken: null, ...performanceRules, state: 'paused', mode: 'free', streetSeriesStartToken: null,
      streetResultOpen: () => false, streetSeries: { checkpoint: options, nextRouteId: 'next' }, sr: { active: null, challenges: [route] },
      userStart: async () => {}, ensureStreetSystems: async () => true, NO_TRAFFIC: noTraffic, chosen: { id: 'f1' },
      $: () => ({ classList: { add() {} } }), toast() {}, field: { hide() {} }, hideMenu() {}, clock: { getDelta() {} },
      beginFree() { ctx.state = 'free'; }, acceptChallenge(...args) { starts.push(args); } });
    vm.runInContext(fn('startStreetSeriesNext'), ctx); await ctx.startStreetSeriesNext();
    assert.equal(starts.length, noTraffic ? 1 : 0); assert.equal(ctx.streetSeriesStartToken, null);
    if (noTraffic) { assert.equal(starts[0][0], route); assert.equal(starts[0][2], options); assert.equal(starts[0][3], true); }
  }
});
await check('來源與腳本測試期間未變', async () => { assert.deepEqual(await hashes(), report.sourceHashes); assert.equal(sha(await readFile(script)), report.scriptSha256); });
report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(resolve(root, 'tools/dev-tests/twelve-city-models.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2)); if (report.summary.failed) process.exitCode = 1;
