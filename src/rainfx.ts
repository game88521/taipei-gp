import * as THREE from 'three';
import { Grid, type CityData } from './citydata';

// 雨天的路面：主要道路上一灘灘會反光的積水（下雨才出現）；車子開過積水噴水花，開得快輪胎後面一直揚起水霧

function softTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

interface Drop { s: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number }

export class RainFx {
  private puddles: THREE.InstancedMesh;
  private grid = new Grid<[number, number, number]>(20);
  private tmp: [number, number, number][] = [];
  private drops: Drop[] = [];
  private sprayAcc = 0;
  private lastPuddle: [number, number, number] | null = null;
  /** 這一格有沒有濺起大水花（給 main 播聲音）：0~1 */
  splash = 0;
  splashes = 0; // 測試統計：開過積水幾次
  constructor(scene: THREE.Scene, d: CityData) {
    // 積水：沿著主要道路隨機撒，偏路邊（排水溝那側），大小不一的扁橢圓
    const N = d.net.nodes, list: THREE.Matrix4[] = [];
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const w of d.net.ways) {
      if (w.c > 2) continue;
      for (let k = 0; k + 1 < w.n.length; k++) {
        const ax = N[w.n[k] * 2], az = N[w.n[k] * 2 + 1], bx = N[w.n[k + 1] * 2], bz = N[w.n[k + 1] * 2 + 1], l = Math.hypot(bx - ax, bz - az);
        for (let t = rnd() * 60; t < l; t += 45 + rnd() * 70) {
          const ux = (bx - ax) / l, uz = (bz - az) / l, off = (rnd() < 0.5 ? -1 : 1) * (w.w / 2 - 1.2 - rnd() * 2);
          const x = ax + ux * t - uz * off, z = az + uz * t + ux * off, r = 1 + rnd() * 1.6;
          q.setFromAxisAngle(up, Math.atan2(ux, uz) + (rnd() - 0.5) * 0.6);
          list.push(new THREE.Matrix4().compose(p.set(x, -0.235, z), q, s.set(r * (0.6 + rnd() * 0.5), 1, r * (1.4 + rnd()))));
          this.grid.addBox(x - r * 2, z - r * 2, x + r * 2, z + r * 2, [x, z, r * 1.6]);
        }
      }
    }
    this.puddles = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.62, envMapIntensity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -30 }),
      Math.max(1, list.length),
    );
    list.forEach((m, i) => this.puddles.setMatrixAt(i, m));
    this.puddles.count = list.length;
    this.puddles.computeBoundingSphere();
    this.puddles.visible = false;
    scene.add(this.puddles);
    const tex = softTex();
    for (let k = 0; k < 90; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#dbe6f2', transparent: true, depthWrite: false }));
      sp.visible = false;
      scene.add(sp);
      this.drops.push({ s: sp, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
    }
  }

  get count() { return this.puddles.count; }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) {
    const d = this.drops.find((q) => q.life <= 0);
    if (!d) return;
    d.life = d.max = life;
    d.vx = vx; d.vy = vy; d.vz = vz;
    d.s.position.set(x, y, z);
    d.s.scale.setScalar(size);
    d.s.visible = true;
  }

  /** raining：現在有沒有下雨；car：玩家的車（位置、速度、車頭方向） */
  update(dt: number, raining: boolean, car: { x: number; z: number; vx: number; vz: number; h: number; v: number }) {
    this.puddles.visible = raining;
    this.splash = 0;
    const sp = Math.abs(car.v), fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -fz, rz = fx;
    if (raining && sp > 5) {
      // 開進積水：兩側噴起一大片水花
      const hit = this.grid.query(car.x, car.z, 0, this.tmp).find(([x, z, r]) => Math.hypot(x - car.x, z - car.z) < r);
      if (hit && hit !== this.lastPuddle) {
        this.lastPuddle = hit;
        this.splash = Math.min(1, sp / 25);
        this.splashes++;
        const n = Math.min(26, 8 + sp);
        for (let k = 0; k < n; k++) {
          const side = k % 2 ? 1 : -1, out = 2 + Math.random() * 4 + sp * 0.15;
          this.emit(car.x + rx * side * 1, 0.1, car.z + rz * side * 1, rx * side * out + car.vx * 0.3, 2.5 + Math.random() * 3 + sp * 0.08, rz * side * out + car.vz * 0.3, 0.5 + Math.random() * 0.4, 0.5 + Math.random() * 0.4);
        }
      } else if (!hit) this.lastPuddle = null;
      // 輪胎揚起的水霧：開得越快越多，從後輪往後噴
      if (sp > 12) {
        this.sprayAcc += dt * (sp - 10) * 1.5;
        while (this.sprayAcc >= 1) {
          this.sprayAcc -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          this.emit(car.x - fx * 1.5 + rx * side * 0.8, 0.25, car.z - fz * 1.5 + rz * side * 0.8, car.vx * 0.55 + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, car.vz * 0.55 + (Math.random() - 0.5) * 2, 0.7 + Math.random() * 0.6, 0.45);
        }
      }
    }
    for (const d of this.drops) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.s.visible = false; continue; }
      d.vy -= 9 * dt;
      d.s.position.x += d.vx * dt; d.s.position.y = Math.max(-0.2, d.s.position.y + d.vy * dt); d.s.position.z += d.vz * dt;
      d.s.scale.multiplyScalar(1 + dt * 1.2);
      (d.s.material as THREE.SpriteMaterial).opacity = 0.65 * (d.life / d.max);
    }
  }
}
