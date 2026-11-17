import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as THREE from 'three';
import { Car, buildTrack, multiplayerCarsOverlap, resolveMultiplayerCollisions } from '../../server/physics.mjs';
import { spectatorTarget } from '../../src/multiplayer-spectator.ts';
import { MultiplayerNetworkWindow } from '../../src/multiplayer-network.ts';
export { Car, buildTrack, THREE };
const strip = s => stripTypeScriptTypes(s, { mode: 'transform' }).replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '');
const trackSource = await readFile(new URL('../../src/track.ts', import.meta.url), 'utf8');
const trackContext = vm.createContext({ Math });
vm.runInContext(strip(trackSource.slice(trackSource.indexOf('export function locate('))) + '\nglobalThis.locate=locate;', trackContext);
const feedback = strip(await readFile(new URL('../../src/multiplayer-collision-feedback.ts', import.meta.url), 'utf8'));
const source = strip(await readFile(new URL('../../src/multiplayer-scene.ts', import.meta.url), 'utf8'));
let arrival = 0;
const context = vm.createContext({ THREE, Car, console, Math, performance: { now: () => arrival }, spectatorTarget, MultiplayerNetworkWindow,
  multiplayerCarsOverlap, resolveMultiplayerCollisions, locate: trackContext.locate,
  surfaceY: (t, i, lat) => t.py[i] + Math.max(-7, Math.min(7, lat)) * t.bank[i], bankRoll: () => 0,
  heightAt: (t, s) => t.py[((Math.floor(s / t.ds) % t.N) + t.N) % t.N] });
vm.runInContext(feedback + '\n' + source + '\nglobalThis.Scene=MultiplayerScene;', context);
export const collisionVisualTarget = context.collisionVisualTarget;
export function sceneFixture(room, selfId = room.players[0].id, track = buildTrack()) {
  const scene = Object.create(context.Scene.prototype);
  const visual = () => ({ model: { root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] }, name: new THREE.Object3D(), samples: [] });
  Object.assign(scene, { currentTrack: track, car: new Car(), prepared: true, disposed: false, contextLost: false,
    room: null, selfId, matchId: room.matchId, network: new MultiplayerNetworkWindow(), visualTargets: new Map(),
    authoritativeSelf: null, correction: new THREE.Vector3(), collisionRecoveryUntil: -Infinity, collisionVisualUntil: new Map(),
    predictionAt: room.serverTime, predictedPeers: new Map(), predictionContact: false, inputHistory: [], lastSteer: 0, lastBrake: true, accumulator: 0,
    cars: new Map(room.players.map(p => [p.id, visual()])), matchesMap: () => true, cameraReady: true, resetCamera() {},
    watchingId: null, camH: 0, closeCamera: false, cullAt: 0, qualityLevel: 'economy', camera: new THREE.PerspectiveCamera(), renderer: { render() {} },
    mapScene: { scene: new THREE.Scene(), world: { setStartLights() {}, sky: new THREE.Object3D(), mountains: new THREE.Object3D() }, stream: null, weather: null, circuit: null } });
  scene.car.restore(room.players.find(p => p.id === selfId).car);
  return { scene, at: ms => { arrival = ms; }, frame(now, dt = 1 / 60) { arrival = now; scene.frame(dt, now, 0, false, true, true, dt); } };
}
