import * as THREE from 'three';
import { Car } from './car';
import { buildTrack, surfaceY, bankRoll } from './track';
import { buildWorld } from './world';
import { buildEnvMap } from './graphics';
import { qualityFor } from './quality';
import { makeF1 } from './f1model';
import { onProgress } from './loading';
import type { CarModel } from './carModel';
import type { CarState, RoomSnapshot } from '../shared/multiplayer-protocol';

type Sample = { at: number; car: CarState };
type VisualCar = { model: CarModel; name: THREE.Sprite; samples: Sample[] };
const lerpAngle = (a: number, b: number, f: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;

/** 獨立場景只預測自車，最終位置、計圈及成績一律由伺服器傳回。 */
export class MultiplayerScene {
  readonly track = buildTrack();
  readonly car = new Car();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .5, 5000);
  readonly renderer: THREE.WebGLRenderer;
  readonly world: ReturnType<typeof buildWorld>;
  private cars = new Map<string, VisualCar>();
  private room: RoomSnapshot | null = null;
  private selfId: string | null = null;
  private matchId: string | null = null;
  private correction = new THREE.Vector3();
  private camH = 0;
  private cameraReady = false;
  private closeCamera = false;
  private stream: Awaited<ReturnType<typeof import('./city').loadCity>> | null = null;
  private cullAt = 0;
  private inputHistory: { at: number; steer: number; brake: boolean }[] = [];
  private lastSteer = 0;
  private lastBrake = true;
  private accumulator = 0;
  private prepared = false;
  contextLost = false;
  onContextLost: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.world = buildWorld(this.scene, this.track);
    this.world.race.visible = true;
    buildEnvMap(this.renderer, this.scene, this.world);
    this.car.placeAt(this.track, 1);
    this.camH = this.car.h;
    this.camera.position.set(this.car.x - Math.sin(this.car.h) * 12, 7, this.car.z - Math.cos(this.car.h) * 12);
    this.camera.lookAt(this.car.x, 1, this.car.z);
    this.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault(); this.contextLost = true; this.onContextLost?.();
    });
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  async prepare(progress: (message: string) => void) {
    onProgress((label, fraction) => progress(`${label}… ${Math.round(fraction * 100)}%`));
    const { loadCity } = await import('./city');
    const quality = qualityFor('low');
    try {
      this.stream = await loadCity(this.scene, this.track, quality, { cx: this.car.x, cz: this.car.z });
      for (const object of this.stream.raceHide) object.visible = false;
      this.stream.stream.onRemove = () => this.renderer.renderLists.dispose();
    } catch (error) {
      // 賽道及碰撞幾何已備妥；城市裝飾下載失敗不影響比賽規則。
      console.warn('多人城市裝飾載入失敗，沿用賽道場景', error);
      progress('城市裝飾暫時無法載入，賽道仍可比賽。');
    }
    await this.renderer.compileAsync(this.scene, this.camera);
    this.prepared = true;
  }

  accept(room: RoomSnapshot, selfId: string, now: number) {
    const newMatch = room.matchId !== this.matchId;
    this.room = room; this.selfId = selfId;
    if (newMatch) { this.matchId = room.matchId; this.inputHistory = []; this.accumulator = 0; this.correction.set(0, 0, 0); }
    const liveIds = new Set(room.players.map(p => p.id));
    for (const [id, visual] of this.cars) if (!liveIds.has(id)) {
      this.scene.remove(visual.model.root, visual.name);
      visual.model.root.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const mats = Array.isArray(o.material) ? o.material : [o.material]; for (const m of mats) m.dispose(); } });
      (visual.name.material as THREE.SpriteMaterial).map?.dispose(); visual.name.material.dispose();
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
        if (room.phase === 'racing' && player.finishMs === null && !player.dnf) {
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
        if (newMatch || !this.cameraReady) { this.camH = this.car.h; this.cameraReady = true; }
      }
    }
  }

  recordInput(at: number, steer: number, brake: boolean) {
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
    if (this.contextLost || !this.prepared) return;
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
    const target = new THREE.Vector3(x - fx * back, up, z - fz * back);
    this.camera.position.lerp(target, Math.min(1, dt * 10)); this.camera.lookAt(x + fx * 6, 1, z + fz * 6);
    this.camera.fov = 62 + Math.min(10, this.car.v / 9); this.camera.updateProjectionMatrix();
    const lights = this.room?.phase === 'countdown' && this.room.startAt ? Math.max(1, 5 - Math.ceil((this.room.startAt - now) / 600)) : 0;
    this.world.setStartLights(lights);
    if (this.stream) {
      this.stream.stream.tick(dt); this.stream.trains.update(dt);
      if (now - this.cullAt > 400) { this.cullAt = now; this.stream.cull(x, z, 500); this.stream.stream.update(x, z, 500); }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
