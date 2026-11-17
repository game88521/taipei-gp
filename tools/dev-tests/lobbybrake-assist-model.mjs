// Pure Node: real GP grip calculation, separate display curve, bounded/cache/wrap tests.
// node --experimental-vm-modules tools/dev-tests/lobbybrake-assist-model.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { pureUrl } from './pure-module-loader.mjs';
import { loadGameModules } from './racing-test-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(root, '../taipei-gp-lobbybrake-before-f8ca4b1d251c');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['src/braking-assist.ts', 'src/main.ts', 'src/world.ts', 'src/car.ts', 'src/track.ts', 'src/rivals.ts', 'src/pitlane.ts', 'server/physics.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async (f) => [f, hash(await readFile(path.join(root, f)))])));
const initialHashes = await hashes(), { BrakingAssist } = await import(await pureUrl(root, 'braking-assist.ts'));
const env = await loadGameModules(root), track = env.track.buildTrack();
const perf = { vmax: env.track.VMAX, brake: env.track.BRAKE, engine: env.track.ENGINE, g0: env.track.GRIP0, gk: env.track.GRIPK, gmax: env.track.GRIPMAX };
const report = { status: 'FAIL', localOnly: true, cases: [], sourceHashes: initialHashes, realGrip: {}, limitations: [
  'Uses the real RaceField tyre/wetness/wear formula and real track data; cars/models are isolated CPU objects.',
  'Display profile is a conservative centre-line estimate, not a measured guarantee of cornering/braking safety or lap-time improvement.',
  'No build, browser, GPU, phone or public-site test is run by this script.',
] };
const fresh = (t = track, p = perf) => new BrakingAssist(t, p);
const equalValues = (a, b) => assert.deepEqual([...a], [...b]); // Real track is loaded in an isolated VM realm.
async function check(name, run) { try { report.cases.push({ name, status: 'PASS', details: await run() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
function bounded(a, base = track.vTarget) { for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]) && a[i] >= 0 && a[i] <= base[i] + 1e-5, `index ${i}: ${a[i]} / ${base[i]}`); }

await check('fresh dry medium/soft keep original target values and never share writable physics storage', () => {
  const h = fresh(); assert.notEqual(h.targets, track.vTarget); equalValues(h.targets, track.vTarget);
  assert.equal(h.update(1, 0, true), false); assert.equal(h.update(1.03, 1, true), false); equalValues(h.targets, track.vTarget);
});
await check('real RaceField supplies the complete grip factor once: dry/wet/worn/rain tyres', () => {
  const car = new env.car.Car(), field = new env.rivals.RaceField(new THREE.Scene(), track, car); field.setup(9, 1, 3, undefined, 'dry');
  for (const [label, compound, wear, wet] of [['dry', 1, 0, 0], ['wet', 1, 0, .8], ['worn', 1, .9, 0], ['wetWorn', 1, .9, .8], ['rainWet', 3, 0, .8], ['rainDry', 3, 0, 0]]) {
    Object.assign(field.me, { compound, wear }); field.wet = wet; field.update(0, true);
    const grip = car.gripMul, h = fresh(); h.update(grip, 1, true); bounded(h.targets);
    report.realGrip[label] = { grip, minimumTarget: Math.min(...h.targets), reducedPoints: [...h.targets].filter((v, i) => v < track.vTarget[i] - .01).length };
  }
  assert.equal(report.realGrip.dry.grip, 1);
  assert.ok(report.realGrip.wet.grip < report.realGrip.dry.grip && report.realGrip.worn.grip < 1);
  assert.ok(report.realGrip.wetWorn.minimumTarget < report.realGrip.wet.minimumTarget);
  assert.ok(report.realGrip.rainWet.minimumTarget > report.realGrip.wet.minimumTarget);
  return report.realGrip;
});
await check('grip decrease cannot increase any display target; physics target array remains byte-identical', () => {
  const saved = new Uint8Array(track.vTarget.buffer).slice(); let previous = new Float32Array(track.vTarget);
  const h = fresh(); for (const [n, grip] of [1, .99, .9, .8, .65, .4].entries()) {
    h.update(grip, n, true); bounded(h.targets); for (let i = 0; i < h.targets.length; i++) assert.ok(h.targets[i] <= previous[i] + 1e-5); previous.set(h.targets);
  }
  assert.deepEqual(new Uint8Array(track.vTarget.buffer), saved);
});
await check('speed units and tyre factor are applied once in the lateral-force equation', () => {
  const t = { N: 20, ds: 5, vTarget: new Float32Array(20).fill(84), curv: new Float32Array(20).fill(.02), bankGrip: new Float32Array(20).fill(1) };
  const h = fresh(t); h.update(.8, 0, true);
  // κv² = .92*.8*(20 + .004*v²), expected ≈29.38 m/s, not km/h or a second .8 multiplier.
  const expected = Math.sqrt((.92 * .8 * 20) / (Math.abs(t.curv[0]) - .92 * .8 * .004));
  assert.ok(Math.abs(h.targets[0] - expected) < 1e-4); return { expectedMps: expected, actualMps: h.targets[0], actualKmh: h.targets[0] * 3.6 };
});
await check('backward braking propagation crosses the start line and honours original longitudinal deceleration', () => {
  const t = { N: 100, ds: 5, vTarget: new Float32Array(100).fill(84), curv: new Float32Array(100), bankGrip: new Float32Array(100).fill(1) }; t.curv[1] = .05;
  const h = fresh(t); h.update(.7, 0, true); assert.ok(h.targets[99] < 84); assert.ok(h.targets[98] < 84);
  const deceleration = 30 * perf.brake / 38;
  for (let i = 0; i < t.N; i++) assert.ok(h.targets[i] ** 2 <= h.targets[(i + 1) % t.N] ** 2 + 2 * deceleration * t.ds + .01);
  return { beforeStart: h.targets[99], afterStartCorner: h.targets[1] };
});
await check('4Hz limit, conservative one-percent bins, stable buffers and immediate non-GP restoration', () => {
  const h = fresh(), storage = h.targets;
  assert.equal(h.update(.8, 0, true), true); const values = new Float32Array(h.targets);
  assert.equal(h.update(.799, .1, true), false); assert.deepEqual(h.targets, values);
  assert.equal(h.update(.799, .25, true), true); const quantised = fresh(); quantised.update(.79, 1, true); assert.deepEqual(h.targets, quantised.targets);
  assert.equal(h.update(.795, .5, true), false); assert.equal(h.update(.7, .51, true), true);
  assert.equal(h.update(.7, .52, false), true); equalValues(h.targets, track.vTarget); assert.equal(h.targets, storage);
});
await check('new session reset/new track cannot inherit old wet targets or throttle timestamp', () => {
  const h = fresh(); h.update(.5, 100, true); h.reset(); equalValues(h.targets, track.vTarget); assert.equal(h.update(.8, 0, true), true);
  const t = { ...track, vTarget: new Float32Array(track.vTarget).fill(25) }, other = fresh(t); assert.deepEqual(other.targets, t.vTarget);
  assert.notDeepEqual(other.targets, h.targets); assert.equal(other.update(.5, 0, false), false);
});
await check('invalid inputs remain finite and fall back without corrupting track data', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -1, 0]) { const h = fresh(); h.update(invalid, 1, true); equalValues(h.targets, track.vTarget); }
  const h = fresh(); h.update(.8, NaN, true); bounded(h.targets); h.update(.4, -10, true); bounded(h.targets);
  const invalidTrack = { ...track, ds: NaN }, fallback = fresh(invalidTrack); fallback.update(.5, 0, true); equalValues(fallback.targets, track.vTarget);
  const badPerf = fresh(track, { ...perf, gk: NaN }); badPerf.update(.5, 0, true); equalValues(badPerf.targets, track.vTarget);
  const corrupt = { ...track, vTarget: new Float32Array([NaN, 20]), N: 2, curv: new Float32Array([NaN, .01]), bankGrip: new Float32Array([1, NaN]) };
  const safe = fresh(corrupt); safe.update(.8, 0, true); assert.ok([...safe.targets].every(Number.isFinite)); assert.ok(Number.isNaN(corrupt.vTarget[0]));
});
await check('car/track/AI/pitlane/physics files exactly match immutable before', async () => {
  for (const name of ['src/car.ts', 'src/track.ts', 'src/rivals.ts', 'src/pitlane.ts', 'server/physics.mjs']) assert.equal(initialHashes[name], hash(await readFile(path.join(before, name))), name);
});
assert.deepEqual(await hashes(), initialHashes); report.sourceUnchanged = true;
report.status = report.cases.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
await writeFile(path.join(root, 'tools/dev-tests/lobbybrake-assist-model-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, cases: report.cases.length })); if (report.status !== 'PASS') process.exitCode = 1;
