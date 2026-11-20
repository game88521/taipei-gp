// 真scene.frame＋原物理：對照不同繪圖頻率，略過WebGL建構／實際GPU。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import * as THREE from 'three';
import { MultiplayerNetworkWindow } from '../../src/multiplayer-network.ts';

import { Car, buildTrack, multiplayerCarsOverlap, resolveMultiplayerCollisions } from '../../server/physics.mjs';
import { spectatorTarget } from '../../src/multiplayer-spectator.ts';
import { horizonCollisionEligible } from '../../shared/multiplayer-horizon.ts';
import { arenaDriver, arenaCollision } from '../../shared/multiplayer-arena.ts';
import { summitPredict } from '../../shared/summit-racing.ts';
import { getMultiplayerTrack } from '../../shared/multiplayer-tracks.ts';
import { qualityFor } from '../../src/quality.ts';
import { getVoyagerComfort } from '../../src/voyager-comfort.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(project, '../taipei-gp-next6-before-57b09b2');
const strip = source => stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '');
const visualsContext = vm.createContext({ THREE, surfaceY: (t, i, lat) => t.py[i] + Math.max(-7, Math.min(7, lat)) * t.bank[i] });
vm.runInContext(strip(await readFile(path.join(project, 'src/summit-racing-visuals.ts'), 'utf8')) + '\nglobalThis.Visuals = SummitRacingVisuals;', visualsContext);
const SummitRacingVisuals = visualsContext.Visuals;
const track = buildTrack();
const trackSource = await readFile(path.join(project, 'src/track.ts'), 'utf8');
const trackContext = vm.createContext({ Math });
vm.runInContext(strip(trackSource.slice(trackSource.indexOf('export function locate('))) + '\nglobalThis.locate = locate;', trackContext);
const feedbackContext = vm.createContext({ Math, multiplayerCarsOverlap, horizonCollisionEligible });
vm.runInContext(strip(await readFile(path.join(project, 'src/multiplayer-collision-feedback.ts'), 'utf8'))
  + '\nglobalThis.feedback = { authoritativeCollisionChanged, nearMultiplayerOpponent, nearMultiplayerOpponents, collisionVisualTarget, MULTIPLAYER_COLLISION_FEEDBACK_MS, MULTIPLAYER_COLLISION_INTERPOLATION_RECOVERY_MS };', feedbackContext);
const pacingContext = vm.createContext({ Math });
vm.runInContext(strip(await readFile(path.join(project, 'src/frame-pacing.ts'), 'utf8')) + '\nglobalThis.Pacer = RenderPacer;', pacingContext);
async function sceneClass(root) {
  const context = vm.createContext({ THREE, Car, performance, MultiplayerNetworkWindow, ...feedbackContext.feedback, Math, console, locate: trackContext.locate, multiplayerCarsOverlap, resolveMultiplayerCollisions, spectatorTarget, horizonCollisionEligible, arenaDriver, arenaCollision, summitPredict, SummitRacingVisuals, getMultiplayerTrack, qualityFor, getVoyagerComfort,
    surfaceY: (t, i, lat) => t.py[i] + Math.max(-7, Math.min(7, lat)) * t.bank[i], bankRoll: () => 0,
    heightAt: (t, s) => { const i = Math.floor((((s / t.ds) % t.N) + t.N) % t.N); return t.py[i]; },
  });
  vm.runInContext(strip(await readFile(path.join(root, 'src/multiplayer-scene.ts'), 'utf8')) + '\nglobalThis.Scene = MultiplayerScene;', context); return context.Scene;
}
const Scene = await sceneClass(project), BeforeScene = await sceneClass(before);
const report = { externalRequests: 0, cases: [], limitations: ['真scene.frame／Car／碰撞helper，以renderer計數替代GPU繪圖；不能證明手機FPS或視覺效果。'] };
async function test(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
}
function fixture(Class, phase = 'racing') {
  const instance = Object.create(Class.prototype), car = new Car(); car.placeAt(track, 0); car.v = 30;
  const visual = { model: { root: new THREE.Group(), body: new THREE.Group(), steer: [new THREE.Group()], spin: [new THREE.Group()] }, name: new THREE.Object3D(), samples: [] };
  const totals = { draws: 0, crowd: 0, weather: 0, stream: 0, trains: 0, lod: 0 };
  const room = { phase, matchId: 'race', serverTime: 1000, startAt: 1000, players: [{ id: 'self', connected: true, loaded: true, dnf: false, finishMs: null, car: car.snapshot() }] };
  Object.assign(instance, {
    network: new MultiplayerNetworkWindow(), visualTargets: new Map(), currentTrack: track, car, prepared: true, disposed: false, contextLost: false,
    room, selfId: 'self', matchId: 'race', arenaRevision: 0, accumulator: 0, predictionAt: 1000, predictedPeers: new Map(), predictionContact: false, summitVisuals: new SummitRacingVisuals(), weatherKey: '',
    correction: new THREE.Vector3(.5, 0, -.5), authoritativeSelf: null, collisionRecoveryUntil: -Infinity, collisionVisualUntil: new Map(),
    inputHistory: [], lastSteer: 0, lastBrake: false, cars: new Map([['self', visual]]),
    camH: car.h, cameraReady: true, closeCamera: false, cullAt: 0, camera: new THREE.PerspectiveCamera(),
    renderer: { render() { totals.draws++; } },
    mapScene: { scene: new THREE.Scene(), world: { setStartLights() {}, sky: new THREE.Object3D(), mountains: new THREE.Object3D() },
      circuit: { crowd: { tick(dt) { totals.crowd += dt; } } }, weather: { update(dt) { totals.weather += dt; } },
      stream: { stream: { tick(dt) { totals.stream += dt; }, update() {} }, trains: { update(dt) { totals.trains += dt; } }, cull() { totals.lod++; } },
    },
  });
  return { instance, totals, visual };
}
function run(limit, Class = Scene, phase = 'racing') {
  const { instance, totals, visual } = fixture(Class, phase), pacer = new pacingContext.Pacer();
  let elapsed = 0;
  for (let frame = 1; frame <= 144; frame++) {
    const dt = 1 / 144, now = 1000 + frame * 1000 / 144;
    if (frame % 7 === 0) instance.room.serverTime = now;
    const steer = frame < 75 ? .12 : -.08;
    if (frame % 5 === 0) instance.recordInput(now, steer, false);
    const draw = pacer.due(now, limit); elapsed += dt;
    instance.frame(dt, now, steer, false, true, draw, elapsed);
    if (draw) elapsed = 0;
  }
  instance.frame(0, 2000, 0, false, true, true, elapsed);
  const state = JSON.parse(JSON.stringify({ car: instance.car.snapshot(), correction: instance.correction.toArray(), predictionAt: instance.predictionAt, inputHistory: instance.inputHistory, accumulator: instance.accumulator }));
  return { totals, state, camera: instance.camera.position.toArray(), wheel: visual.model.spin[0].rotation.x };
}

await test('144Hz回呼的draw全開／60／30fps，預測物理、校正、inputHistory完全一致', () => {
  const every = run(0), sixty = run(60), thirty = run(30);
  assert.deepEqual(thirty.state, every.state); assert.deepEqual(sixty.state, every.state);
  assert.equal(every.totals.draws, 145); assert.equal(sixty.totals.draws, 61); assert.equal(thirty.totals.draws, 31);
  return { callbacks: 144, draws: { every: every.totals.draws, sixty: sixty.totals.draws, thirty: thirty.totals.draws }, stateIdentical: true };
});

await test('before忽略繪圖gate仍畫145次，after30fps為31次；物理結果維持一致', () => {
  const old = run(30, BeforeScene), next = run(30);
  assert.equal(old.totals.draws, 145); assert.equal(next.totals.draws, 31); assert.deepEqual(next.state, old.state);
  return { beforeDraws: old.totals.draws, afterDraws: next.totals.draws };
});

await test('30／60fps與大廳／結果10fps：天氣、觀眾、列車保持一秒進度；鏡頭及LOD仍更新', () => {
  const values = [run(30), run(60), run(10, Scene, 'lobby'), run(10, Scene, 'results')];
  for (const value of values) {
    for (const key of ['crowd', 'weather', 'stream', 'trains']) assert.ok(Math.abs(value.totals[key] - 1) < 1e-10, `${key}: ${value.totals[key]}`);
    assert.ok(value.camera.every(Number.isFinite)); assert.ok(Math.hypot(...value.camera) > 1);
    assert.ok(value.totals.lod >= 2 && value.totals.lod <= 3);
  }
  assert.ok(values[0].wheel > 0); assert.ok(values[1].wheel > 0);
  assert.equal(values[2].totals.draws, 11); assert.equal(values[3].totals.draws, 11);
  return values.map(value => ({ draws: value.totals.draws, weatherSeconds: value.totals.weather, lodUpdates: value.totals.lod }));
});

report.summary = { passed: report.cases.filter(item => item.status === 'PASS').length, failed: report.cases.filter(item => item.status === 'FAIL').length };
await writeFile(path.join(project, 'tools/dev-tests/next6-multiplayer-pacing-result.json'), JSON.stringify(report, null, 2) + '\n');
for (const item of report.cases) console.log(`${item.status} ${item.name}${item.error ? '\n' + item.error : ''}`);
console.log(JSON.stringify(report.summary)); if (report.summary.failed) process.exitCode = 1;
