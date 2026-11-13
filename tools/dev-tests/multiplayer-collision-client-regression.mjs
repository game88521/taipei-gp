// 真 scene.accept 與接觸校正 helper；隔離 WebGL 建構，不替換預測／校正邏輯。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import * as THREE from 'three';
import { Car, buildTrack, multiplayerCarsOverlap, resolveMultiplayerCollisions } from '../../server/physics.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselineFlag = process.argv.indexOf('--baseline');
const baseline = path.resolve(baselineFlag >= 0 ? process.argv[baselineFlag + 1] : path.join(project, '../taipei-gp-collision-before-f586ca9'));
const digest = text => createHash('sha256').update(text).digest('hex');
const source = await readFile(path.join(project, 'src/multiplayer-scene.ts'), 'utf8');
const beforeSource = await readFile(path.join(baseline, 'src/multiplayer-scene.ts'), 'utf8');
const feedbackSource = await readFile(path.join(project, 'src/multiplayer-collision-feedback.ts'), 'utf8');
const stripImports = text => stripTypeScriptTypes(text, { mode: 'transform' }).replace(/^import[\s\S]*?;\r?\n/gm, '');
const trackSource = await readFile(path.join(project, 'src/track.ts'), 'utf8');
const locateContext = vm.createContext({ Math });
vm.runInContext(stripImports(trackSource.slice(trackSource.indexOf('export function locate('))).replace('export function locate', 'function locate') + '\nglobalThis.locate = locate;', locateContext);
const locate = locateContext.locate;
const feedbackContext = vm.createContext({ multiplayerCarsOverlap, Math });
vm.runInContext(stripImports(feedbackSource).replace(/\bexport (?=(?:function|const)\b)/g, '') + '\nglobalThis.feedback = { authoritativeCollisionChanged, nearMultiplayerOpponent, nearMultiplayerOpponents, collisionVisualTarget, MULTIPLAYER_COLLISION_FEEDBACK_MS, MULTIPLAYER_COLLISION_INTERPOLATION_RECOVERY_MS };', feedbackContext);
const feedback = feedbackContext.feedback;
function sceneClass(text) {
  const context = vm.createContext({ THREE, Car, ...feedback, console, Math, locate, multiplayerCarsOverlap, resolveMultiplayerCollisions,
    surfaceY: (t, i, lat) => t.py[i] + Math.max(-7, Math.min(7, lat)) * t.bank[i],
    bankRoll: (t, i, lat) => Math.abs(lat) <= 7 ? Math.atan(-t.bank[i]) : 0,
    heightAt: (t, s) => {
      const f = (((s / t.ds) % t.N) + t.N) % t.N, i = Math.floor(f), j = (i + 1) % t.N;
      return t.py[i] + (t.py[j] - t.py[i]) * (f - i);
    },
  });
  vm.runInContext(stripImports(text).replace('export class MultiplayerScene', 'class MultiplayerScene') + '\nglobalThis.Scene = MultiplayerScene;', context);
  return context.Scene;
}
const Scene = sceneClass(source), BeforeScene = sceneClass(beforeSource);
const track = buildTrack(), heading = Math.atan2(track.tx[0], track.tz[0]);
const descriptor = (await import(pathToFileURL(path.join(project, 'shared/multiplayer-tracks.ts')).href)).getMultiplayerTrack('taipei');
const selection = { trackId: 'taipei', trackStamp: descriptor.trackStamp, trackRevision: 1 };
function carState(along = 0, lateral = 0, speed = 40) {
  const car = new Car(); car.placeAt(track, 0);
  car.x += track.tx[0] * along - track.tz[0] * lateral;
  car.z += track.tz[0] * along + track.tx[0] * lateral;
  car.v = speed; car.pos = { i: 0, s: along, lat: lateral };
  return car.snapshot();
}
function player(id, car, extra = {}) {
  return { id, name: id, color: '#ff3300', ready: true, loaded: true, connected: true,
    car, ackSeq: 2, completedLaps: 0, progress: 0, finishMs: null, dnf: false, rank: 1, ...extra };
}
function room(self, peer, extra = {}) {
  return { ...selection, matchId: 'race-one', phase: 'racing', serverTime: 1050,
    players: [self, ...(peer ? [peer] : [])], ...extra };
}
function scene(previous, Class = Scene, t = track) {
  const instance = Object.create(Class.prototype);
  Object.assign(instance, {
    currentTrack: t, car: new Car(), correction: new THREE.Vector3(.5, 0, -.5),
    authoritativeSelf: { at: 1000, car: previous }, collisionRecoveryUntil: -Infinity, collisionVisualUntil: new Map(),
    predictionAt: 1000, predictedPeers: new Map(), predictionContact: false,
    room: null, selfId: 'self', matchId: 'race-one', inputHistory: [{ at: 1000, steer: 0, brake: false }],
    lastSteer: 0, lastBrake: false, accumulator: 0, cameraReady: true,
    cars: new Map([['self', { samples: [] }], ['peer', { samples: [] }]]),
    matchesMap: () => true, resetCamera: () => {},
  });
  instance.car.restore(previous);
  return instance;
}
function prepareFrames(instance) {
  const visual = () => ({ model: { root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] }, name: new THREE.Object3D(), samples: [] });
  instance.cars = new Map([['self', visual()], ['peer', visual()]]);
  Object.assign(instance, { prepared: true, disposed: false, contextLost: false, closeCamera: false, camH: heading,
    camera: new THREE.PerspectiveCamera(), renderer: { render() {} },
    mapScene: { scene: new THREE.Scene(), world: { setStartLights() {}, sky: new THREE.Object3D(), mountains: new THREE.Object3D() }, circuit: null, weather: null, stream: null },
  });
  instance.correction.set(0, 0, 0);
  return instance;
}
function modelStates(instance) {
  return ['self', 'peer'].map(id => {
    const root = instance.cars.get(id).model.root, state = instance.room.players.find(p => p.id === id).car;
    return { ...state, x: root.position.x, z: root.position.z, h: root.rotation.y, pos: { ...state.pos } };
  });
}
function assertSeparatedModels(instance, label) {
  const [self, peer] = modelStates(instance);
  assert.equal(multiplayerCarsOverlap(track, self, peer), false, label);
  return Math.hypot(self.x - peer.x, self.z - peer.z);
}
const report = {
  createdAt: new Date().toISOString(), productionUsed: false, externalRequests: 0,
  sourceHashes: { scene: digest(source), feedback: digest(feedbackSource), baselineScene: digest(beforeSource) },
  limitations: ['真接觸查詢、Car、scene.accept與非零dt scene.frame，檢查模型姿態；跳過WebGL建構、模型建立與繪圖，不證明瀏覽器視覺或實際網路。', '對照組僅替換回不可變before的scene原始碼，Car維持未修改的單人原物理。'],
  cases: [],
};
async function check(name, exercise) {
  try { const details = await exercise(); report.cases.push({ name, status: 'PASS', details }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).slice(0, 5000) }); }
}
const samePosition = (car, state) => { assert.equal(car.x, state.x); assert.equal(car.z, state.z); };
const correctedImmediately = (instance, state) => {
  samePosition(instance.car, state); assert.equal(instance.car.v, state.v);
  assert.equal(instance.correction.length(), 0);
};

await check('追撞權威掉速立即採用，不重播穿回前車；遠車快照不變', () => {
  const before = carState(0, 0, 60), after = carState(2.125, 0, 25);
  const self = player('self', after), peer = player('peer', carState(7.327, 0, 25));
  const peerCopy = structuredClone(peer), instance = scene(before);
  instance.accept(room(self, peer), 'self', 1100);
  correctedImmediately(instance, after); assert.deepEqual(peer, peerCopy);
  assert.equal(instance.collisionRecoveryUntil, 1200);
});
await check('側擦推開即時顯示，不以舊畫面偏移抹回重疊', () => {
  const before = carState(), after = carState(2, .4);
  const instance = scene(before);
  instance.accept(room(player('self', after), player('peer', carState(2, 2.302))), 'self', 1100);
  correctedImmediately(instance, after);
});
await check('前車受到追撞加速也立即採權威狀態', () => {
  const before = carState(0, 0, 10), after = carState(.8, 0, 25), instance = scene(before);
  instance.accept(room(player('self', after), player('peer', carState(-4.402, 0, 25))), 'self', 1100);
  correctedImmediately(instance, after);
});
await check('正常近距離跟車保留自車預測，避免額外操作延遲', () => {
  const before = carState(), after = carState(2.016, 0, 40.65), instance = scene(before);
  instance.accept(room(player('self', after), player('peer', carState(7.3, 0, 40.65))), 'self', 1100);
  assert.ok(Math.hypot(instance.car.x - after.x, instance.car.z - after.z) > 1.8);
  assert.equal(instance.collisionRecoveryUntil, -Infinity);
});
await check('正常煞車不誤判為碰撞，近車亦保留預測', () => {
  const before = carState(), after = carState(1.95, 0, 38.1);
  const self = player('self', after), peer = player('peer', carState(7.2, 0, 38.1));
  assert.equal(feedback.authoritativeCollisionChanged(track, { at: 1000, car: before }, 1050, self, [self, peer]), false);
});
await check('無接觸的速度突變、斷線／未載入／DNF／完賽車不觸發近車校正', () => {
  const before = carState(0, 0, 60), self = player('self', carState(2, 0, 20));
  for (const extra of [{ connected: false }, { loaded: false }, { dnf: true }, { finishMs: 1000 }]) {
    const peer = player('peer', carState(7.2, 0, 20), extra);
    assert.equal(feedback.authoritativeCollisionChanged(track, { at: 1000, car: before }, 1050, self, [self, peer]), false);
  }
  assert.equal(feedback.authoritativeCollisionChanged(track, { at: 1000, car: before }, 1050, self, [self, player('peer', carState(30))]), false);
});
await check('高架與下層重疊的車不觸發碰撞畫面校正', () => {
  const elevated = { ...track, py: track.py.slice(), bank: track.bank.slice() };
  elevated.py[20] = 8; elevated.py[21] = 8;
  const before = carState(0, 0, 60), self = player('self', carState(2, 0, 20));
  const peer = player('peer', carState(2, 0, 20)); peer.car.pos = { i: 20, s: elevated.ds * 20, lat: 0 };
  assert.equal(feedback.authoritativeCollisionChanged(elevated, { at: 1000, car: before }, 1050, self, [self, peer]), false);
});
await check('重複／過舊取樣不誤判為接觸突變', () => {
  const before = carState(0, 0, 60), self = player('self', carState(2, 0, 20)), peer = player('peer', carState(7.2, 0, 20));
  for (const at of [1000, 999, 1300]) assert.equal(feedback.authoritativeCollisionChanged(track, { at: 1000, car: before }, at, self, [self, peer]), false);
});
await check('接觸後短暫校正到期恢復預測；換場與換圖清除殘留', () => {
  const before = carState(), after = carState(2, .4), instance = scene(before);
  instance.collisionRecoveryUntil = 1090;
  const self = player('self', after), peer = player('peer', carState(7.3, .4));
  instance.authoritativeSelf = { at: 1000, car: carState(0, .4) };
  instance.accept(room(self, peer), 'self', 1100);
  assert.ok(Math.hypot(instance.car.x - after.x, instance.car.z - after.z) > 1.8);
  instance.collisionRecoveryUntil = 2000;
  instance.accept(room(self, peer, { matchId: 'race-two', serverTime: 1150 }), 'self', 1150);
  assert.equal(instance.collisionRecoveryUntil, -Infinity);
  assert.equal(instance.inputHistory.length, 0);
  instance.resetPrediction();
  assert.equal(instance.authoritativeSelf, null); assert.equal(instance.collisionRecoveryUntil, -Infinity);
  assert.equal(instance.collisionVisualUntil.size, 0);
});
await check('接觸遠車採最新權威姿態，非接觸遠車保留110ms插值', () => {
  const after = carState(4.79, 0, 20), instance = scene(after);
  const visual = (samples) => ({ model: { root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] }, name: new THREE.Object3D(), samples });
  const peer = visual([{ at: 1000, car: carState(6) }, { at: 1100, car: carState(10) }]);
  const far = visual([{ at: 1000, car: carState(50) }, { at: 1100, car: carState(60) }]);
  instance.cars = new Map([['self', visual([])], ['peer', peer], ['far', far]]);
  instance.collisionVisualUntil.set('peer', 1200);
  Object.assign(instance, {
    prepared: true, disposed: false, contextLost: false, closeCamera: false, camH: heading,
    camera: new THREE.PerspectiveCamera(), renderer: { render() {} },
    room: room(player('self', after), player('peer', carState(10))),
    mapScene: { scene: new THREE.Scene(), world: { setStartLights() {}, sky: new THREE.Object3D(), mountains: new THREE.Object3D() }, circuit: null, weather: null, stream: null },
  });
  instance.correction.set(0, 0, 0);
  instance.frame(0, 1100, 0, false, false);
  assert.equal(peer.model.root.position.x, carState(10).x); assert.equal(peer.model.root.position.z, carState(10).z);
  assert.equal(far.model.root.position.x, carState(50).x); assert.equal(far.model.root.position.z, carState(50).z);
  instance.frame(0, 1450, 0, false, false);
  assert.equal(instance.collisionVisualUntil.has('peer'), false);
});
await check('接觸插值漸回正常延遲時，目標時間不會突然倒退', () => {
  let previous = -Infinity;
  for (let now = 1100; now <= 1600; now++) {
    const target = feedback.collisionVisualTarget(now, 1200);
    assert.ok(target >= previous); previous = target;
  }
  assert.equal(feedback.collisionVisualTarget(1150, 1200), 1150);
  assert.equal(feedback.collisionVisualTarget(1500, 1200), 1390);
  assert.equal(feedback.collisionVisualTarget(1500), 1390);
});
await check('原scene對照會重播越過碰撞位置並平滑舊偏移，新scene即刻顯示權威結果', () => {
  const before = carState(0, 0, 60), after = carState(2.125, 0, 25);
  const snapshot = room(player('self', after), player('peer', carState(7.327, 0, 25)));
  const old = scene(before, BeforeScene), current = scene(before);
  old.accept(snapshot, 'self', 1100); current.accept(snapshot, 'self', 1100);
  const oldReplayDistance = Math.hypot(old.car.x - after.x, old.car.z - after.z);
  assert.ok(oldReplayDistance > 1);
  assert.ok(old.correction.length() > 0);
  correctedImmediately(current, after);
  return { oldReplayDistance, newReplayDistance: 0 };
});

await check('追撞校正後連續非零dt frame不會重新穿入前車，無新snapshot最多外推180ms', () => {
  const before = carState(0, 0, 60), after = carState(2.125, 0, 25), peer = carState(7.327, 0, 25);
  const instance = prepareFrames(scene(before));
  const snapshot = room(player('self', after), player('peer', peer)), original = structuredClone(snapshot);
  instance.accept(snapshot, 'self', 1100);
  let minGap = Infinity;
  for (let i = 1; i <= 90; i++) {
    instance.frame(1 / 60, 1100 + i * 1000 / 60, 0, false, true);
    minGap = Math.min(minGap, assertSeparatedModels(instance, `frame ${i}`));
  }
  assert.ok(instance.predictionAt <= snapshot.serverTime + 180 + 1e-6);
  assert.deepEqual(snapshot, original);
  assert.ok(instance.car.v > 24 && instance.car.v < 27);
  return { nonzeroFrames: 90, durationMs: 1500, minModelGap: minGap, predictedMs: instance.predictionAt - snapshot.serverTime };
});

await check('20Hz權威samples與60Hz frame持續貼車，100ms恢復期後仍不重疊', () => {
  const before = carState(0, 0, 60), after = carState(2.125, 0, 25), peer = carState(7.327, 0, 25);
  const instance = prepareFrames(scene(before));
  const authority = [new Car(), new Car()]; authority[0].restore(after); authority[1].restore(peer);
  let minGap = Infinity, minPostRecoveryGap = Infinity, currentSnapshot;
  for (let i = 0; i < 120; i++) {
    const serverTime = 1050 + i * 1000 / 60, now = serverTime + 50;
    if (i % 3 === 0) {
      currentSnapshot = room(player('self', authority[0].snapshot()), player('peer', authority[1].snapshot()), { serverTime });
      instance.accept(currentSnapshot, 'self', now);
    }
    const immutable = JSON.stringify(currentSnapshot);
    instance.frame(1 / 60, now + 1000 / 60, 0, false, true);
    const gap = assertSeparatedModels(instance, `frame ${i}`);
    minGap = Math.min(minGap, gap); if (i > 21) minPostRecoveryGap = Math.min(minPostRecoveryGap, gap);
    assert.equal(JSON.stringify(currentSnapshot), immutable);
    const bodies = authority.map((car, n) => ({ id: n ? 'peer' : 'self', car, previous: { x: car.x, z: car.z, h: car.h } }));
    for (const car of authority) car.update(1 / 60, track, 0, false);
    resolveMultiplayerCollisions(track, bodies, 1 / 60);
  }
  assert.ok(instance.collisionRecoveryUntil < 1100 + 350);
  return { authorityHz: 20, frameHz: 60, nonzeroFrames: 120, durationMs: 2000, minModelGap: minGap, minPostRecoveryModelGap: minPostRecoveryGap };
});

await check('20Hz正常近距離無碰撞跟車仍保留每幀預測與油門，不凍結或誤減速', () => {
  const before = carState(0, 0, 25), peer = carState(5.8, 0, 25), instance = prepareFrames(scene(before));
  const authority = [new Car(), new Car()]; authority[0].restore(before); authority[1].restore(peer);
  const expected = new Car(); let minAdvance = Infinity, minGap = Infinity;
  for (let i = 0; i < 60; i++) {
    const now = 1000 + i * 1000 / 60;
    if (i % 3 === 0) {
      instance.accept(room(player('self', authority[0].snapshot()), player('peer', authority[1].snapshot()), { serverTime: now }), 'self', now);
      expected.restore(authority[0].snapshot());
    }
    const x = instance.car.x, z = instance.car.z;
    expected.update(1 / 60, track, 0, false);
    instance.frame(1 / 60, now + 1000 / 60, 0, false, true);
    minAdvance = Math.min(minAdvance, Math.hypot(instance.car.x - x, instance.car.z - z));
    assert.ok(Math.abs(instance.car.v - expected.v) < 1e-9, `frame ${i} speed`);
    assert.equal(instance.collisionRecoveryUntil, -Infinity);
    minGap = Math.min(minGap, assertSeparatedModels(instance, `frame ${i}`));
    for (const car of authority) car.update(1 / 60, track, 0, false);
  }
  assert.ok(minAdvance > .4);
  return { authorityHz: 20, frameHz: 60, nonzeroFrames: 60, minFrameAdvance: minAdvance, minModelGap: minGap };
});

await check('高速追向慢車時非零dt暫態碰撞會掉速且不穿車，最終仍由新權威sample覆蓋', () => {
  const initial = carState(0, 0, 60), instance = prepareFrames(scene(initial));
  instance.accept(room(player('self', initial), player('peer', carState(6.5, 0, 10)), { serverTime: 1000 }), 'self', 1000);
  let minGap = Infinity;
  for (let i = 1; i <= 8; i++) {
    instance.frame(1 / 60, 1000 + i * 1000 / 60, 0, false, true);
    minGap = Math.min(minGap, assertSeparatedModels(instance, `frame ${i}`));
  }
  assert.ok(instance.car.v < 45);
  const authority = carState(4, 0, 12);
  instance.accept(room(player('self', authority), player('peer', carState(9.202, 0, 12)), { serverTime: 1150 }), 'self', 1150);
  samePosition(instance.car, authority); assert.equal(instance.car.v, 12);
  return { nonzeroFrames: 8, minModelGap: minGap, adoptedAuthoritySpeed: instance.car.v };
});

report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
await writeFile(path.join(project, 'tools/dev-tests/multiplayer-collision-client-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.summary.failed) process.exitCode = 1;
