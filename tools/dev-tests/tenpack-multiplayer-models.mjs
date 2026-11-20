import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as THREE from 'three';
import { MultiplayerNetworkWindow } from '../../src/multiplayer-network.ts';

import { MultiplayerAutoQuality, qualityMode } from '../../src/multiplayer-quality.ts';
import { spectatorTargets, spectatorTarget } from '../../src/multiplayer-spectator.ts';
import { horizonCollisionEligible } from '../../shared/multiplayer-horizon.ts';
import { arenaDriver, arenaCollision } from '../../shared/multiplayer-arena.ts';
import { summitPredict } from '../../shared/summit-racing.ts';
import { getMultiplayerTrack } from '../../shared/multiplayer-tracks.ts';
import { qualityFor } from '../../src/quality.ts';
import { getVoyagerComfort } from '../../src/voyager-comfort.ts';
import { validSeries } from '../../shared/multiplayer-series.ts';
import { Car, buildTrack, resolveMultiplayerCollisions, multiplayerCarsOverlap } from '../../server/physics.mjs';
import { multiplayerEvidence } from './tenpack-multiplayer-evidence.mjs';
const report = { localOnly: true, externalRequests: 0, realSceneMethods: true, gpuUsed: false, cases: [], limitations: ['Scene methods use real Three.js/Car with a renderer counter; no browser, GPU, device FPS or touch claim.'] };
const finishEvidence = await multiplayerEvidence(report, import.meta.url);
async function test(name, fn) { try { await fn(); report.cases.push({ name, status: 'PASS' }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); } }
const player = (id, extra = {}) => ({ id, connected: true, loaded: true, dnf: false, finishMs: null, ...extra });
const room = (extra = {}) => ({ phase: 'racing', players: [player('self'), player('a'), player('b')], ...extra });
await test('只能完賽或DNF後觀戰，排除離線/未載入/已完賽對手', () => {
  assert.deepEqual(spectatorTargets(room(), 'self'), []);
  for (const state of [{ finishMs: 1000 }, { dnf: true }]) {
    const snapshot = room({ players: [player('self', state), player('a'), player('b', { connected: false }), player('c', { loaded: false }), player('d', { finishMs: 1200 })] });
    assert.deepEqual(spectatorTargets(snapshot, 'self').map(p => p.id), ['a']);
    assert.equal(spectatorTarget(snapshot, 'self', 'b'), 'a');
    assert.equal(spectatorTarget({ ...snapshot, phase: 'results' }, 'self', 'a'), null);
  }
});
await test('觀戰切換保留有效目標，目標退出/完賽自動後備，無人時回自車', () => {
  const snapshot = room({ players: [player('self', { finishMs: 1000 }), player('a'), player('b')] });
  assert.equal(spectatorTarget(snapshot, 'self', 'b'), 'b'); snapshot.players[2].finishMs = 1200;
  assert.equal(spectatorTarget(snapshot, 'self', 'b'), 'a'); snapshot.players[1].connected = false;
  assert.equal(spectatorTarget(snapshot, 'self', 'b'), null);
});
await test('Auto連續慢幀降級、持續穩定恢復、有遲滯且僅兩檔', () => {
  const quality = new MultiplayerAutoQuality();
  for (let i = 0; i < 130; i++) quality.sample(.05, true); assert.equal(quality.level, 'economy');
  for (let i = 0; i < 10000; i++) quality.sample(.05, true); assert.equal(quality.level, 'economy');
  for (let i = 0; i < 1000; i++) quality.sample(1 / 60, true); assert.equal(quality.level, 'standard');
  for (let i = 0; i < 200; i++) quality.sample(.02, true); assert.equal(quality.level, 'standard');
});
await test('固定畫質不自動變動，隱藏/大廳/無效採樣清累積而不改模式', () => {
  const quality = new MultiplayerAutoQuality(); quality.setMode('standard');
  for (let i = 0; i < 1000; i++) quality.sample(.1, true); assert.equal(quality.level, 'standard');
  quality.setMode('economy'); for (let i = 0; i < 2000; i++) quality.sample(1 / 144, true); assert.equal(quality.level, 'economy');
  quality.setMode('auto'); for (let i = 0; i < 65; i++) quality.sample(.05, true); quality.sample(.05, false);
  for (let i = 0; i < 65; i++) quality.sample(.05, true); assert.equal(quality.level, 'standard');
  for (const value of [0, -1, NaN, Infinity, .5]) quality.sample(value, true);
  assert.equal(qualityMode('invalid'), 'auto');
});
const strip = text => stripTypeScriptTypes(text, { mode: 'transform' }).replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '');
const context = vm.createContext({ THREE, Car, performance, MultiplayerNetworkWindow, console, Math, devicePixelRatio: 2, spectatorTarget, multiplayerCarsOverlap, resolveMultiplayerCollisions, horizonCollisionEligible, arenaDriver, arenaCollision, summitPredict, getMultiplayerTrack, qualityFor, getVoyagerComfort,
  surfaceY: (track, index) => track.py[index], bankRoll: () => 0, heightAt: (track, distance) => track.py[((Math.floor(distance / track.ds) % track.N) + track.N) % track.N] });
vm.runInContext(strip(await readFile(new URL('../../src/summit-racing-visuals.ts', import.meta.url), 'utf8')) + '\n' + strip(await readFile(new URL('../../src/multiplayer-collision-feedback.ts', import.meta.url), 'utf8')) + '\n' + strip(await readFile(new URL('../../src/multiplayer-scene.ts', import.meta.url), 'utf8')) + '\nglobalThis.Scene = MultiplayerScene; globalThis.Visuals = SummitRacingVisuals;', context);
await test('真scene畫質只改像素比與呈現檔位；固定模式可還原且不碰Car', () => {
  const scene = Object.create(context.Scene.prototype), ratios = [], car = new Car();
  Object.assign(scene, { car, renderer: { setPixelRatio: value => ratios.push(value) }, cullAt: 100 }); const before = car.snapshot();
  scene.setQuality('economy'); scene.setQuality('standard'); assert.deepEqual(ratios, [.85, 1.5]); assert.deepEqual(car.snapshot(), before); assert.equal(scene.cullAt, 0);
});
await test('真scene.frame觀戰鏡頭跟隨目標，畫質與觀戰均不改自車物理/輸入歷史', () => {
  const track = buildTrack(), own = new Car(), peer = new Car(); own.placeAt(track, 0); peer.placeAt(track, Math.min(200, track.N - 1));
  const visual = car => ({ model: { root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] }, name: new THREE.Object3D(), samples: [{ at: 1000, car: car.snapshot() }] });
  const snapshot = room({ serverTime: 1000, startAt: 0, players: [player('self', { finishMs: 900, car: own.snapshot() }), player('peer', { car: peer.snapshot() })] });
  const scene = Object.create(context.Scene.prototype); let draws = 0;
  Object.assign(scene, { network: new MultiplayerNetworkWindow(), visualTargets: new Map(), currentTrack: track, car: own, prepared: true, disposed: false, contextLost: false, room: snapshot, selfId: 'self', watchingId: 'peer', summitVisuals: new context.Visuals(), weatherKey: '',
    qualityLevel: 'economy', accumulator: 0, correction: new THREE.Vector3(), predictedPeers: new Map(), collisionVisualUntil: new Map(), cars: new Map([['self', visual(own)], ['peer', visual(peer)]]),
    camH: peer.h, closeCamera: false, cullAt: 1000, camera: new THREE.PerspectiveCamera(), renderer: { render() { draws++; } }, inputHistory: [{ at: 100, steer: .2, brake: false }],
    mapScene: { scene: new THREE.Scene(), world: { setStartLights() {}, sky: new THREE.Object3D(), mountains: new THREE.Object3D() } } });
  const before = JSON.stringify({ car: own.snapshot(), inputs: scene.inputHistory });
  scene.frame(1, 1000, 1, false, false, true, 1);
  const distanceToTarget = Math.hypot(scene.camera.position.x - peer.x, scene.camera.position.z - peer.z);
  const distanceToSelf = Math.hypot(scene.camera.position.x - own.x, scene.camera.position.z - own.z);
  assert.ok(distanceToTarget < 11); assert.ok(distanceToTarget < distanceToSelf); assert.equal(draws, 1);
  assert.equal(JSON.stringify({ car: own.snapshot(), inputs: scene.inputHistory }), before);
});
await test('系列嚴格驗證拒絕任意物件/偽造總分/錯誤站次', () => {
  for (const invalid of [{}, { id: 'x', trackIds: ['taipei'] }, [], null]) assert.equal(validSeries(invalid, 'taipei', 'lobby'), false);
});
report.status = report.cases.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL'; report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length }; await finishEvidence();
await writeFile(new URL('tenpack-multiplayer-models-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
