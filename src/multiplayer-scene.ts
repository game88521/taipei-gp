import * as THREE from 'three';
import { Car } from './car';
import { buildTrack, surfaceY, bankRoll, heightAt, type Track } from './track';
import { buildWorld, type World } from './world';
import { buildCircuitEnv } from './circuitenv';
import { buildEnvMap } from './graphics';
import { Weather } from './weather';
import { qualityFor } from './quality';
import { makeF1 } from './f1model';
import { onProgress } from './loading';
import { loadMultiplayerTrack } from './multiplayer-track-loader';
import { disposeMultiplayerObjects, disposeMultiplayerScene } from './multiplayer-scene-resources';
import { DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack } from '../shared/multiplayer-tracks';
import type { CarModel } from './carModel';
import type { CarState, RoomSnapshot } from '../shared/multiplayer-protocol';

type Sample = { at: number; car: CarState };
type VisualCar = { model: CarModel; name: THREE.Sprite; samples: Sample[] };
export type MultiplayerMapSelection = { trackId: string; trackStamp: string; trackRevision: number };
type MapScene = {
  scene: THREE.Scene; world: World; track: Track; weather: Weather | null;
  stream: Awaited<ReturnType<typeof import('./city').loadCity>> | null;
  circuit: ReturnType<typeof buildCircuitEnv> | null;
};
const mapKey = (selection: MultiplayerMapSelection) => `${selection.trackId}:${selection.trackRevision}:${selection.trackStamp}`;
const lerpAngle = (a: number, b: number, f: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;

/** 獨立場景只預測自車，最終位置、計圈及成績一律由伺服器傳回。 */
export class MultiplayerScene {
  private currentTrack = buildTrack();
  get track() { return this.currentTrack; }
  readonly car = new Car();
  private emptyScene = new THREE.Scene();
  private mapScene: MapScene | null = null;
  get scene() { return this.mapScene?.scene ?? this.emptyScene; }
  readonly camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .5, 5000);
  readonly renderer: THREE.WebGLRenderer;
  get world() { return this.mapScene?.world ?? null; }
  private cars = new Map<string, VisualCar>();
  private room: RoomSnapshot | null = null;
  private selfId: string | null = null;
  private matchId: string | null = null;
  private correction = new THREE.Vector3();
  private camH = 0;
  private cameraReady = false;
  private closeCamera = false;
  private cullAt = 0;
  private inputHistory: { at: number; steer: number; brake: boolean }[] = [];
  private lastSteer = 0;
  private lastBrake = true;
  private accumulator = 0;
  private prepared = false;
  private disposed = false;
  private generation = 0;
  private selection: MultiplayerMapSelection | null = null;
  private loadingKey: string | null = null;
  private loadingPromise: Promise<boolean> | null = null;
  private loadingTail: Promise<void> = Promise.resolve();
  private controller: AbortController | null = null;
  get ready() { return this.prepared && !this.disposed && !this.contextLost; }
  get activeMapKey() { return this.selection && this.ready ? mapKey(this.selection) : null; }
  contextLost = false;
  onContextLost: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.car.placeAt(this.track, 1);
    this.resetCamera();
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    addEventListener('resize', this.resize);
  }

  private resize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  };
  private handleContextLost = (event: Event) => {
    event.preventDefault(); this.contextLost = true; this.prepared = false;
    this.generation++; this.controller?.abort(); this.onContextLost?.();
  };

  matchesMap(selection: MultiplayerMapSelection) {
    return this.ready && this.selection !== null && mapKey(this.selection) === mapKey(selection);
  }

  prepare(progress: (message: string) => void) {
    const descriptor = getMultiplayerTrack(DEFAULT_MULTIPLAYER_TRACK_ID)!;
    return this.prepareMap({ trackId: descriptor.id, trackStamp: descriptor.trackStamp, trackRevision: 0 }, progress);
  }

  /** 地圖工作依序完成／清理；舊城市的晚到區塊不會碰到新場景。 */
  prepareMap(selection: MultiplayerMapSelection, progress: (message: string) => void): Promise<boolean> {
    const descriptor = getMultiplayerTrack(selection.trackId);
    if (!descriptor || descriptor.trackStamp !== selection.trackStamp || !Number.isSafeInteger(selection.trackRevision) || selection.trackRevision < 0) return Promise.reject(new Error('多人賽道版本不一致，請更新遊戲後重試。'));
    if (this.disposed || this.contextLost) return Promise.resolve(false);
    if (this.matchesMap(selection)) return Promise.resolve(true);
    if (this.ready && this.selection?.trackId === selection.trackId && this.selection.trackStamp === selection.trackStamp) {
      // 同一張圖的新房間／版本只重設賽事狀態，不重下載整座台北。
      this.selection = { ...selection };
      for (const visual of this.cars.values()) this.removeVisual(visual);
      this.cars.clear();
      this.car.resetTransient(false); this.car.placeAt(this.track, Math.min(1, this.track.N - 1));
      this.resetPrediction(); this.resetCamera();
      return Promise.resolve(true);
    }
    const key = mapKey(selection);
    if (this.loadingKey === key && this.loadingPromise) return this.loadingPromise;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    this.prepared = false;
    this.resetPrediction();
    const job = this.loadingTail.then(() => this.loadMap({ ...selection }, progress, generation, controller.signal));
    this.loadingKey = key; this.loadingPromise = job;
    this.loadingTail = job.then(() => {}, () => {});
    const clear = () => { if (this.loadingPromise === job) { this.loadingPromise = null; this.loadingKey = null; } };
    void job.then(clear, clear);
    return job;
  }

  private async loadMap(selection: MultiplayerMapSelection, progress: (message: string) => void, generation: number, signal: AbortSignal) {
    const current = () => !this.disposed && !this.contextLost && !signal.aborted && generation === this.generation;
    const report = (message: string) => { if (current()) progress(message); };
    if (!current()) return false;
    this.releaseMap();
    let draft: MapScene | null = null;
    try {
      report('正在載入賽道資料…');
      const { track, descriptor } = await loadMultiplayerTrack(selection.trackId, { signal });
      if (!current()) return false;
      const scene = new THREE.Scene();
      const world = buildWorld(scene, track, descriptor.circuit?.banner, descriptor.circuit ? `${descriptor.circuit.banner[1]}  ${descriptor.circuit.banner[0]}` : undefined);
      draft = { scene, world, track, weather: null, stream: null, circuit: null };
      world.race.visible = true;
      const quality = qualityFor('low');
      const spawn = Math.min(1, track.N - 1), heading = Math.atan2(track.tx[spawn], track.tz[spawn]);
      this.camera.position.set(track.px[spawn] - Math.sin(heading) * 9, track.py[spawn] + 3.6, track.pz[spawn] - Math.cos(heading) * 9);
      this.camera.lookAt(track.px[spawn], track.py[spawn] + 1, track.pz[spawn]);
      if (descriptor.circuit) {
        report('正在建立賽道場景…');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (!current()) return false;
        draft.circuit = buildCircuitEnv(scene, track, descriptor.circuit, world);
        draft.circuit.setDetail('low');
      } else {
        onProgress((label, fraction) => report(`${label}… ${Math.round(fraction * 100)}%`));
        try {
          const { loadCity } = await import('./city');
          if (!current()) return false;
          draft.stream = await loadCity(scene, track, quality, { cx: track.px[spawn], cz: track.pz[spawn], signal });
          if (!current()) return false;
          for (const object of draft.stream.raceHide) { object.visible = false; object.userData.off = true; }
          draft.stream.stream.onRemove = () => this.renderer.renderLists.dispose();
        } catch (error) {
          if (!current()) return false;
          // 城市裝飾失敗不改變台北賽道及其權威物理。
          console.warn('多人城市裝飾載入失敗，沿用賽道場景', error);
          report('城市裝飾暫時無法載入，賽道仍可比賽。');
        } finally { onProgress(() => {}); }
      }
      if (!current()) return false;
      draft.weather = new Weather(scene, world, 0);
      draft.weather.collect();
      const time = descriptor.circuit?.time ?? 'dusk';
      draft.weather.pick(time, true);
      draft.weather.apply(time, quality.fogFar, null, null);
      buildEnvMap(this.renderer, scene, world, draft.weather.envSun);
      report('正在準備畫面…');
      const hidden: THREE.Object3D[] = [];
      scene.traverse(object => { if (!object.visible) { hidden.push(object); object.visible = true; } });
      try { await this.renderer.compileAsync(scene, this.camera); }
      finally { for (const object of hidden) object.visible = false; }
      if (!current()) return false;
      this.mapScene = draft; draft = null;
      this.currentTrack = track;
      this.selection = selection;
      this.car.resetTransient(false); this.car.placeAt(track, spawn);
      this.resetPrediction(); this.resetCamera();
      this.prepared = true;
      report('賽道已就緒。');
      return true;
    } catch (error) {
      if (!current()) return false;
      throw error;
    } finally {
      if (draft) { draft.stream?.stream.dispose(); disposeMultiplayerScene(draft.scene); this.renderer.renderLists.dispose(); }
    }
  }

  private resetPrediction() {
    this.room = null; this.selfId = null; this.matchId = null;
    this.inputHistory = []; this.lastSteer = 0; this.lastBrake = true;
    this.accumulator = 0; this.correction.set(0, 0, 0); this.cameraReady = false; this.cullAt = 0;
    for (const visual of this.cars.values()) visual.samples = [];
  }

  private resetCamera() {
    this.camH = this.car.h;
    const base = surfaceY(this.track, this.car.pos.i, this.car.pos.lat);
    const back = this.closeCamera ? 4.8 : 9, up = this.closeCamera ? 2.2 : 3.6;
    this.camera.position.set(this.car.x - Math.sin(this.camH) * back, base + up, this.car.z - Math.cos(this.camH) * back);
    this.camera.lookAt(this.car.x + Math.sin(this.camH) * 6, heightAt(this.track, this.car.pos.s + 6) + 1, this.car.z + Math.cos(this.camH) * 6);
    this.camera.fov = 62; this.camera.updateProjectionMatrix();
  }

  private releaseMap() {
    if (this.mapScene) { this.mapScene.stream?.stream.dispose(); disposeMultiplayerScene(this.mapScene.scene); }
    this.mapScene = null; this.cars.clear(); this.selection = null;
    this.renderer.renderLists.dispose();
  }

  private removeVisual(visual: VisualCar) {
    this.scene.remove(visual.model.root, visual.name);
    disposeMultiplayerObjects(visual.model.root, false);
    (visual.name.material as THREE.SpriteMaterial).map?.dispose(); visual.name.material.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.prepared = false; this.generation++; this.controller?.abort();
    this.renderer.setAnimationLoop(null);
    removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.releaseMap(); this.resetPrediction(); this.renderer.domElement.remove();
    void this.loadingTail.then(() => this.renderer.dispose());
  }

  accept(room: RoomSnapshot, selfId: string, now: number) {
    if (!this.matchesMap(room) || room.players.some(player => !Number.isInteger(player.car.pos.i) || player.car.pos.i < 0 || player.car.pos.i >= this.track.N)) return;
    const newMatch = room.matchId !== this.matchId;
    this.room = room; this.selfId = selfId;
    if (newMatch) { this.matchId = room.matchId; this.inputHistory = []; this.accumulator = 0; this.correction.set(0, 0, 0); }
    const liveIds = new Set(room.players.map(p => p.id));
    for (const [id, visual] of this.cars) if (!liveIds.has(id)) {
      this.removeVisual(visual);
      this.cars.delete(id);
    }
    for (const player of room.players) {
      let visual = this.cars.get(player.id);
      if (!visual) {
        const model = makeF1({ main: player.color, accent: '#e9f3ff', accent2: '#192f43', helmet: player.color, number: room.players.indexOf(player) + 1 });
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80;
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0b1728dc'; ctx.fillRect(0, 0, 512, 80);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = 'bold 32px sans-serif'; ctx.fillText(player.name, 256, 52, 480);
        const texture = new THREE.CanvasTexture(canvas);
        const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })); name.scale.set(6.4, 1, 1);
        this.scene.add(model.root, name); visual = { model, name, samples: [] }; this.cars.set(player.id, visual);
      }
      if (newMatch || room.phase === 'lobby') visual.samples = [];
      visual.samples.push({ at: room.serverTime, car: player.car });
      visual.samples = visual.samples.filter(s => s.at >= room.serverTime - 1000).slice(-24);
      if (player.id === selfId) {
        const oldX = this.car.x + this.correction.x, oldZ = this.car.z + this.correction.z;
        this.car.restore(player.car);
        if (room.phase === 'racing' && player.loaded && player.finishMs === null && !player.dnf) {
          const from = Math.max(room.serverTime, now - 180);
          const history = this.inputHistory.filter(s => s.at <= now);
          let at = from;
          let control = [...history].reverse().find(s => s.at <= from) ?? { steer: this.lastSteer, brake: this.lastBrake };
          for (const command of history.filter(s => s.at > from)) {
            this.predict((command.at - at) / 1000, control.steer, control.brake); at = command.at; control = command;
          }
          this.predict(Math.max(0, now - at) / 1000, control.steer, control.brake);
        }
        this.inputHistory = this.inputHistory.filter(s => s.at >= now - 500);
        const distance = Math.hypot(oldX - this.car.x, oldZ - this.car.z);
        this.correction.set(newMatch || distance > 20 ? 0 : oldX - this.car.x, 0, newMatch || distance > 20 ? 0 : oldZ - this.car.z);
        if (newMatch || !this.cameraReady) { this.resetCamera(); this.cameraReady = true; }
      }
    }
  }

  recordInput(at: number, steer: number, brake: boolean) {
    if (!this.ready) return;
    this.lastSteer = steer; this.lastBrake = brake;
    this.inputHistory.push({ at, steer, brake });
    this.inputHistory = this.inputHistory.filter(s => s.at >= at - 500);
  }
  private predict(dt: number, steer: number, brake: boolean) {
    let remaining = Math.min(.18, Math.max(0, dt));
    while (remaining > .000001) { const d = Math.min(1 / 60, remaining); this.car.update(d, this.track, steer, brake); remaining -= d; }
  }
  toggleCamera() { this.closeCamera = !this.closeCamera; }

  frame(dt: number, now: number, steer: number, brake: boolean, canDrive: boolean) {
    // 城市分批建置期間先不畫，避免每批第一次出現都同步編譯著色器。
    const map = this.mapScene;
    if (!this.ready || !map) return;
    const me = this.room?.players.find(p => p.id === this.selfId);
    if (this.room?.phase === 'racing' && me && me.finishMs === null && !me.dnf && canDrive) {
      this.accumulator += Math.min(dt, .1);
      while (this.accumulator >= 1 / 60) { this.car.update(1 / 60, this.track, steer, brake); this.accumulator -= 1 / 60; }
    } else this.accumulator = 0;
    this.correction.multiplyScalar(Math.exp(-dt * 12));
    for (const [id, visual] of this.cars) {
      let car: CarState = this.car.snapshot();
      let ox = this.correction.x, oz = this.correction.z;
      if (id !== this.selfId) {
        const samples = visual.samples, target = now - 110;
        let a = samples[0], b = a;
        for (const sample of samples) { if (sample.at <= target) a = sample; if (sample.at >= target) { b = sample; break; } b = sample; }
        if (!a || !b) continue;
        const f = Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at || 1)));
        car = { ...a.car, x: a.car.x + (b.car.x - a.car.x) * f, z: a.car.z + (b.car.z - a.car.z) * f, h: lerpAngle(a.car.h, b.car.h, f), v: a.car.v + (b.car.v - a.car.v) * f };
        ox = 0; oz = 0;
      }
      const y = surfaceY(this.track, car.pos.i, car.pos.lat);
      visual.model.root.position.set(car.x + ox, y, car.z + oz);
      visual.model.root.rotation.set(-Math.atan(this.track.grade[car.pos.i]), car.h, bankRoll(this.track, car.pos.i, car.pos.lat), 'YXZ');
      visual.model.body.rotation.z = car.steer * Math.min(1, car.v / 40) * .04;
      for (const wheel of visual.model.steer) wheel.rotation.y = -car.steer * .45;
      for (const wheel of visual.model.spin) wheel.rotation.x += car.v / .35 * dt;
      visual.name.position.set(car.x + ox, y + 3, car.z + oz); visual.name.visible = id !== this.selfId;
    }
    this.camH = lerpAngle(this.camH, this.car.h, Math.min(1, dt * 7));
    const back = this.closeCamera ? 4.8 : 9, up = this.closeCamera ? 2.2 : 3.6;
    const fx = Math.sin(this.camH), fz = Math.cos(this.camH), x = this.car.x + this.correction.x, z = this.car.z + this.correction.z;
    const base = surfaceY(this.track, this.car.pos.i, this.car.pos.lat);
    const target = new THREE.Vector3(x - fx * back, base + up, z - fz * back);
    this.camera.position.lerp(target, Math.min(1, dt * 10)); this.camera.lookAt(x + fx * 6, heightAt(this.track, this.car.pos.s + 6) + 1, z + fz * 6);
    this.camera.fov = 62 + Math.min(10, this.car.v / 9); this.camera.updateProjectionMatrix();
    const lights = this.room?.phase === 'countdown' && this.room.startAt ? Math.max(1, 5 - Math.ceil((this.room.startAt - now) / 600)) : 0;
    map.world.setStartLights(lights);
    map.world.sky.position.copy(this.camera.position);
    map.world.mountains.position.y = -this.camera.position.y;
    map.circuit?.crowd.tick(dt, this.camera.position.x, this.camera.position.z);
    map.weather?.update(dt, this.camera.position);
    if (map.stream) {
      map.stream.stream.tick(dt); map.stream.trains.update(dt);
      if (now - this.cullAt > 400) { this.cullAt = now; map.stream.cull(x, z, 500); map.stream.stream.update(x, z, 500); }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
