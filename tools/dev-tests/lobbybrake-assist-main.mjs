// Real main/world AST integration, real Three.js CPU geometry; no browser/WebGL/storage.
// node --experimental-vm-modules tools/dev-tests/lobbybrake-assist-main.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import * as THREE from 'three';
import { pureUrl } from './pure-module-loader.mjs';
import { loadGameModules } from './racing-test-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(root, '../taipei-gp-lobbybrake-before-f8ca4b1d251c');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['src/main.ts', 'src/world.ts', 'src/braking-assist.ts'];
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async (f) => [f, hash(await readFile(path.join(root, f)))])));
const initialHashes = await hashes(), { BrakingAssist } = await import(await pureUrl(root, 'braking-assist.ts'));
const env = await loadGameModules(root), track = env.track.buildTrack();
const perf = { vmax: env.track.VMAX, brake: env.track.BRAKE, engine: env.track.ENGINE, g0: env.track.GRIP0, gk: env.track.GRIPK, gmax: env.track.GRIPMAX };
const currentMain = await source(root, 'src/main.ts'), oldMain = await source(before, 'src/main.ts');
const currentWorld = await source(root, 'src/world.ts'), oldWorld = await source(before, 'src/world.ts');
const report = { status: 'FAIL', localOnly: true, cases: [], sourceHashes: initialHashes,
  beforeHashes: { 'src/main.ts': oldMain.hash, 'src/world.ts': oldWorld.hash }, limitations: [
    'Real source functions and warning branch are extracted by AST; the full main module/DOM/audio is not booted.',
    'Real ribbon and Three.js geometry/color attributes are executed on CPU, without GPU rendering or mobile visual verification.',
    'Grip inputs and vehicle positions are arranged fixtures; this does not measure driving safety, lap times, FPS or phone performance.',
  ] };
async function source(base, name) {
  const raw = await readFile(path.join(base, name), 'utf8'), code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
  const fn = (id) => ast.body.map((n) => n.type === 'ExportNamedDeclaration' ? n.declaration : n).find((n) => n?.type === 'FunctionDeclaration' && n.id?.name === id);
  return { hash: hash(raw), code, ast, fn, text(id) { const n = fn(id); assert.ok(n, `Missing ${id}`); return code.slice(n.start, n.end); } };
}
function lineFixture(worldSource) {
  const ctx = vm.createContext({ THREE, VMAX: perf.vmax, HALF_WIDTH: env.track.HALF_WIDTH, track, t: track });
  vm.runInContext(worldSource.text('ribbon'), ctx);
  if (worldSource.fn('makeAssistLine')) { vm.runInContext(worldSource.text('makeAssistLine'), ctx); return ctx.makeAssistLine(track); }
  const body = worldSource.fn('buildWorld').body.body;
  const declaration = (id) => { const n = body.find((s) => s.type === 'VariableDeclaration' && s.declarations.some((d) => d.id?.name === id)); assert.ok(n); return worldSource.code.slice(n.start, n.end); };
  return vm.runInContext(`(() => {${declaration('red')}\n${declaration('assist')}\nreturn {mesh:assist};})()`, ctx);
}
function warning(source) {
  const body = source.fn('step').body.body;
  const index = body.findIndex((s) => s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' && s.expression.left.name === 'warnText');
  assert.ok(index >= 0 && body[index + 1].type === 'IfStatement');
  return source.code.slice(body[index].start, body[index + 1].end);
}
function fixture() {
  const line = lineFixture(currentWorld), assist = new BrakingAssist(track, perf), calls = [];
  const field = { raceTime: 10, me: { pit: null } }; for (const name of ['rainAt', 'pitRnd', 'wet']) Object.defineProperty(field, name, { get() { throw Error(`Hint must not inspect ${name}`); } });
  const car = { gripMul: .776, v: 40 };
  const context = vm.createContext({ mode: 'race', raceKind: 'gp', qualiRun: false, opts: { assist: true }, state: 'race', field, car, track,
    brakingAssist: assist, world: { updateAssist(targets) { calls.push(targets); line.update(targets); } }, inp: { brake: false }, inPit: false, i: 0, wrongWay: 0, warnText: '' });
  vm.runInContext(currentMain.text('updateBrakingAssist'), context);
  return { context, assist, field, car, line, calls, run() { context.updateBrakingAssist(); vm.runInContext(warning(currentMain), context); return context.warnText; } };
}
async function check(name, run) { try { report.cases.push({ name, status: 'PASS', details: await run() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
const colors = (line) => new Float32Array(line.mesh.geometry.getAttribute('color').array);
const equalValues = (a, b) => assert.deepEqual([...a], [...b]);

await check('before/after dry and non-GP ribbon colors/positions/UVs are exactly identical', () => {
  const old = lineFixture(oldWorld), current = lineFixture(currentWorld);
  for (const name of ['position', 'uv', 'color', 'normal']) equalValues(old.mesh.geometry.getAttribute(name).array, current.mesh.geometry.getAttribute(name).array);
  current.update(track.vTarget); equalValues(colors(current), colors(old));
  return { vertices: current.mesh.geometry.getAttribute('position').count, triangles: current.mesh.geometry.getAttribute('position').count / 3 };
});
await check('real main uses one complete GP grip factor and issues an earlier warning than immutable before', () => {
  const h = fixture(); h.context.updateBrakingAssist();
  const reductions = [...h.assist.targets].map((v, i) => track.vTarget[i] - v), ahead = reductions.indexOf(Math.max(...reductions));
  const speed = (track.vTarget[ahead] + h.assist.targets[ahead]) / 2 + 5;
  h.car.v = speed; h.context.i = (ahead - Math.round(speed * .7 / track.ds) + track.N) % track.N;
  const vehicleBefore = { ...h.car }, targetBefore = new Float32Array(track.vTarget);
  vm.runInContext(warning(oldMain), h.context); const oldWarning = h.context.warnText;
  const newWarning = h.run(); assert.equal(oldWarning, ''); assert.equal(newWarning, '煞車！'); assert.equal(h.calls.at(-1), h.assist.targets);
  const once = new BrakingAssist(track, perf); once.update(h.car.gripMul, 10, true); equalValues(h.assist.targets, once.targets);
  assert.deepEqual(h.car, vehicleBefore); equalValues(track.vTarget, targetBefore);
  return { sample: ahead, speedMps: speed, originalTargetMps: track.vTarget[ahead], adjustedTargetMps: h.assist.targets[ahead], oldWarning, newWarning };
});
await check('wet/worn updates change real world colors in place, preserve geometry attributes and obey 4Hz', () => {
  const h = fixture(), geo = h.line.mesh.geometry, position = geo.getAttribute('position'), uv = geo.getAttribute('uv'), normal = geo.getAttribute('normal'), color = geo.getAttribute('color');
  const originalColors = colors(h.line), originalPosition = new Float32Array(position.array), version = color.version;
  h.run(); assert.notDeepEqual(colors(h.line), originalColors); assert.equal(color.version, version + 1);
  for (let n = 0; n < 1000; n++) { h.field.raceTime = 10 + n * .0001; h.car.gripMul = .77 - n * .00001; h.run(); }
  assert.equal(h.calls.length, 1); assert.equal(color.version, version + 1);
  h.field.raceTime = 10.25; h.car.gripMul = .65; h.run(); assert.equal(h.calls.length, 2); assert.equal(color.version, version + 2);
  assert.equal(h.line.mesh.geometry, geo); assert.equal(geo.getAttribute('position'), position); assert.equal(geo.getAttribute('uv'), uv); assert.equal(geo.getAttribute('normal'), normal); assert.equal(geo.getAttribute('color'), color); equalValues(position.array, originalPosition);
  const c = (i) => [color.getX(i), color.getY(i), color.getZ(i)];
  for (let i = 0; i < track.N; i++) {
    const k = i * 6, next = ((i + 1) % track.N) * 6;
    equalValues(c(k), c(k + 1)); equalValues(c(k), c(k + 3)); equalValues(c(k + 2), c(k + 4)); equalValues(c(k + 2), c(k + 5)); equalValues(c(k + 2), c(next));
  }
  return { updateCallsFor1002Invocations: h.calls.length, geometryUuid: geo.uuid, colorBufferReused: true };
});
await check('GP to TT/qualifying/free/replay and disabling assist restore original colors and thresholds', () => {
  const originalLine = colors(lineFixture(oldWorld));
  for (const change of [{ raceKind: 'tt' }, { qualiRun: true }, { mode: 'free' }, { state: 'replay' }, { opts: { assist: false } }]) {
    const h = fixture(); h.run(); Object.assign(h.context, change); h.field.raceTime += .01; h.run(); equalValues(h.assist.targets, track.vTarget); equalValues(colors(h.line), originalLine);
  }
});
await check('driver braking/pit suppress warning; wrong-way warning retains precedence', () => {
  const h = fixture(); h.car.v = 100; h.context.inp.brake = true; assert.equal(h.run(), '');
  h.context.inp.brake = false; h.context.inPit = false;
  for (const ph of ['in', 'box', 'out']) { h.field.me.pit = { ph }; assert.equal(h.run(), ''); }
  h.field.me.pit = null; h.context.wrongWay = .5; assert.equal(h.run(), '反方向！');
});
await check('new-race and season restore call cache reset; reset recomputes despite old throttling epoch', () => {
  for (const name of ['beginCountdown', 'restoreSeasonCheckpoint']) {
    const text = currentMain.text(name); assert.ok(text.includes('updateBrakingAssist(true)'), `${name} must reset old-session guidance`);
  }
  assert.ok(currentMain.text('startReplay').includes('updateBrakingAssist()'), 'Replay bypasses updateVisuals and needs its own restore call');
  const h = fixture(); h.run(); h.car.gripMul = .5; h.field.raceTime = 0; h.context.updateBrakingAssist(true);
  const fresh = new BrakingAssist(track, perf); fresh.update(.5, 0, true); equalValues(h.assist.targets, fresh.targets); assert.equal(h.calls.length, 2);
});
await check('world invalid/mismatched targets fall back to original valid vertex colors', () => {
  const line = lineFixture(currentWorld), original = colors(line); line.update([NaN]); equalValues(colors(line), original);
  line.update(new Float32Array(track.N).fill(NaN)); equalValues(colors(line), original); assert.ok([...colors(line)].every(Number.isFinite));
});
await check('BOT target source and core update sequence remain the original ones', () => {
  assert.equal(currentMain.text('botInput'), oldMain.text('botInput'));
  assert.ok(currentMain.text('step').includes('let impact = inPit ? 0 : car.update(dt, track, inp.steer, inp.brake)'));
  const step = currentMain.fn('step').body.body, assignment = step.findIndex((s) => s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' && s.expression.left.name === 'warnText');
  assert.ok(currentMain.code.slice(step[assignment - 1].start, step[assignment - 1].end).includes('updateBrakingAssist()'));
  assert.equal(currentMain.fn('buildWorld'), undefined); // World helpers never substitute the physics path.
});

assert.deepEqual(await hashes(), initialHashes); report.sourceUnchanged = true;
report.status = report.cases.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
await writeFile(path.join(root, 'tools/dev-tests/lobbybrake-assist-main-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, cases: report.cases.length })); if (report.status !== 'PASS') process.exitCode = 1;
