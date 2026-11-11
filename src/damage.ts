import * as THREE from 'three';
import type { CarModel } from './carModel';

// 車損：撞擊累積 0~1。烤漆變髒變暗、車身歪一點、頭燈破、引擎冒煙（白 → 黑）、撞擊噴火花；嚴重時跑不快

const DIRTY = new THREE.Color('#2b2724');

function softTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Puff { s: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number; grow: number }

export class Damage {
  value = 0;
  private vehicle = 'sedan';
  private values: Record<string, number> = {};
  /** 街頭賽使用獨立暫態 key，避免賽車的撞擊轉移到自由駕駛車款。 */
  useVehicle(id: string) {
    if (id === this.vehicle) return;
    this.values[this.vehicle] = this.value;
    this.vehicle = id;
    this.value = this.values[id] ?? 0;
    this.lastPaint = -1;
  }
  valueFor(id: string) { return id === this.vehicle ? this.value : this.values[id] ?? 0; }
  resetVehicle(id: string) { delete this.values[id]; if (id === this.vehicle) this.repair(); }
  snapshot() {
    const values = { ...this.values, [this.vehicle]: this.value };
    delete values.__street__;
    return values;
  }
  restore(values: Record<string, number>) {
    this.values = {};
    for (const [id, n] of Object.entries(values)) if (id !== '__street__' && Number.isFinite(n)) this.values[id] = Math.max(0, Math.min(1, n));
    this.value = this.values[this.vehicle] ?? 0;
    this.lastPaint = -1;
  }
  private puffs: Puff[] = [];
  private sparks: Puff[] = [];
  /** 甩尾胎煙：後輪冒出來、往後飄、慢慢變大變淡（跟引擎煙分開一池，甩尾時不會把引擎煙擠掉） */
  private tyreSmoke: Puff[] = [];
  private smokeAcc = 0;
  private emitAcc = 0;
  private lastPaint = -1;
  private lastModel: CarModel | null = null;
  private skew = Math.random() < 0.5 ? -1 : 1;
  constructor(scene: THREE.Scene) {
    const tex = softTex();
    for (let k = 0; k < 40; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: '#bbbbbb' }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1 });
    }
    for (let k = 0; k < 30; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(3, 1.8, 0.6) }));
      s.visible = false;
      s.scale.setScalar(0.25);
      scene.add(s);
      this.sparks.push({ s, life: 0, max: 0.4, vx: 0, vy: 0, vz: 0, grow: 0 });
    }
    // 胎煙 36 顆：每顆一個 Sprite（看得到的才畫，甩尾時同時大約 15~25 顆在空中）
    for (let k = 0; k < 36; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: '#d9d9de' }));
      s.visible = false;
      scene.add(s);
      this.tyreSmoke.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1 });
    }
  }

  /**
   * 甩尾胎煙（每格呼叫）：k = 0~1 強度（0 不冒）；(x, y, z) 車子位置、h 車頭方向；vx, vz 車速（煙一開始帶一點車速、很快停下來）。
   * 從兩個後輪的位置冒出來（車子座標：左右 ±0.84 m、往後 1.65 m），只是畫面，不影響物理
   */
  smoke(dt: number, k: number, x: number, y: number, z: number, h: number, vx: number, vz: number) {
    if (k > 0.02) {
      this.smokeAcc += dt * (6 + k * 22);
      const fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        const p = this.tyreSmoke.find((q) => q.life <= 0);
        if (!p) break;
        const side = Math.random() < 0.5 ? -1 : 1;
        p.life = p.max = 0.9 + Math.random() * 0.7 + k * 0.6;
        p.s.position.set(x - fx * 1.65 + lx * side * 0.84 + (Math.random() - 0.5) * 0.3, y + 0.25, z - fz * 1.65 + lz * side * 0.84 + (Math.random() - 0.5) * 0.3);
        p.vx = vx * 0.15 + (Math.random() - 0.5) * 1.2; p.vz = vz * 0.15 + (Math.random() - 0.5) * 1.2; p.vy = 0.5 + Math.random() * 0.7;
        p.grow = 1.4 + Math.random() * 0.8;
        p.s.scale.setScalar(0.9 + k * 0.7);
        (p.s.material as THREE.SpriteMaterial).opacity = 0;
        p.s.visible = true;
      }
    } else this.smokeAcc = 0;
    for (const p of this.tyreSmoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const drag = Math.max(0, 1 - dt * 2.2); // 很快停下來，留在原地慢慢散開
      p.vx *= drag; p.vz *= drag; p.vy *= Math.max(0, 1 - dt * 0.6);
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.scale.multiplyScalar(1 + p.grow * dt);
      const age = 1 - p.life / p.max; // 0 剛冒出來 ~ 1 散掉
      (p.s.material as THREE.SpriteMaterial).opacity = 0.62 * Math.min(1, age * 6) * (1 - age) ** 0.7; // 先淡入一點、再慢慢淡出（0.42 時在柏油上幾乎看不出來）
    }
  }

  /** 撞擊：impact = 接觸點的相對速度（m/s）；(x, y, z) 噴火花的位置 */
  hit(impact: number, x: number, y: number, z: number) {
    if (impact < 3) return;
    this.value = Math.min(1, this.value + (impact - 3) * 0.012);
    if (impact > 6) {
      let n = Math.min(14, Math.round(impact * 0.8));
      for (const p of this.sparks) {
        if (n <= 0) break;
        if (p.life > 0) continue;
        n--;
        p.life = p.max = 0.25 + Math.random() * 0.3;
        p.s.position.set(x, y, z);
        const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * impact * 0.5;
        p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 2 + Math.random() * 4;
        p.s.visible = true;
      }
    }
  }

  repair() { this.value = 0; this.lastPaint = -1; }
  /** 換了烤漆：下一格重新套（髒污疊在新顏色上） */
  refreshPaint() { this.lastPaint = -1; }

  /** 極速倍率：車損 70% 以上開始變慢，全壞剩 70% */
  get speedMul() { return this.value > 0.7 ? 1 - (this.value - 0.7) : 1; }

  /** 每格：外觀（烤漆、歪斜、頭燈）＋煙與火花。base = 這台車原本的烤漆顏色 */
  update(dt: number, m: CarModel, base: string, x: number, y: number, z: number, h: number) {
    const d = this.value;
    if (m !== this.lastModel) { this.lastModel = m; this.lastPaint = -1; }
    const paint = m.root.userData.paint as THREE.MeshStandardMaterial | undefined;
    if (paint && Math.abs(d - this.lastPaint) > 0.01) {
      this.lastPaint = d;
      paint.color.set(base).lerp(DIRTY, d * 0.55);
      paint.roughness = 0.28 + d * 0.5;
    }
    m.body.rotation.x = d * 0.035 * this.skew;
    // 頭燈：40% 以上左邊那顆破掉、光束暗一半
    m.root.traverse((o) => {
      if (o.userData.lens && (o as THREE.Mesh).position.x > 0) o.visible = o.visible && d < 0.4;
      if (o.userData.beam) (o.userData.beam as THREE.MeshBasicMaterial).opacity = (o.userData.beamBase ?? 0) * (d >= 0.4 ? 0.5 : 1);
    });
    // 煙：45% 以上從引擎蓋冒出來，越壞越黑越多
    if (d > 0.45) {
      this.emitAcc += dt * (4 + d * 14);
      const fx = Math.sin(h), fz = Math.cos(h);
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const p = this.puffs.find((q) => q.life <= 0);
        if (!p) break;
        p.life = p.max = 1.2 + Math.random() * 0.8;
        p.s.position.set(x + fx * 1.5 + (Math.random() - 0.5) * 0.5, y + 1.0, z + fz * 1.5 + (Math.random() - 0.5) * 0.5);
        p.vx = (Math.random() - 0.5) * 0.6; p.vz = (Math.random() - 0.5) * 0.6; p.vy = 1.2 + Math.random();
        p.grow = 1.5 + Math.random();
        (p.s.material as THREE.SpriteMaterial).color.set(d > 0.75 ? '#2a2a2a' : '#c8c8c8');
        p.s.scale.setScalar(0.6);
        p.s.visible = true;
      }
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.scale.multiplyScalar(1 + p.grow * dt);
      (p.s.material as THREE.SpriteMaterial).opacity = 0.55 * (p.life / p.max);
    }
    for (const p of this.sparks) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.vy -= 12 * dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      (p.s.material as THREE.SpriteMaterial).opacity = p.life / p.max;
    }
  }
}
