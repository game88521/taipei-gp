import * as THREE from 'three';
import type { CityData, Collider } from './citydata';
import { pedParts } from './models';

// 行人：沿真實道路兩側的人行道來回走；車子靠近會閃開，被碰到會被推開、坐在地上一下再站起來

interface Walk { x1: number; z1: number; x2: number; z2: number; len: number; next: Walk[] }
interface Ped {
  w: Walk; s: number; dir: 1 | -1; v: number;
  x: number; z: number; h: number;
  phase: number; // 走路擺腿的相位
  dodge: number; // 閃避時的橫向位移
  sit: number; // 坐在地上的剩餘秒數
  shirt: THREE.Color; pants: THREE.Color; skin: THREE.Color; hair: THREE.Color; sleeve: THREE.Color; shoe: THREE.Color;
  scale: number; bag: boolean;
  alive: boolean;
}

const SHIRTS = ['#e8e8e8', '#2a2f3a', '#c8102e', '#1f5fa8', '#f0c040', '#3f8f5a', '#f2a0b8', '#7a5a3a', '#8a8f96', '#ff7a30'];
const PANTS = ['#2a2f3a', '#1d2e4a', '#4a4a4a', '#c8b89a', '#1a1a1a', '#5a6a7a'];
const SKIN = ['#f1d2b6', '#e3b994', '#c99a74', '#a8795a', '#f6dcc6'];
const HAIR = ['#1a1612', '#2a2018', '#3a2a1c', '#5a3a22', '#8a6a4a', '#b8b0a8'];
const SHOES = ['#f2f2f2', '#1a1a1a', '#5a3a22', '#c8102e', '#3a4a6a'];
const PARTS = ['torso', 'pelvis', 'head', 'hair', 'neck', 'armL', 'armR', 'legL', 'legR', 'shoeL', 'shoeR', 'bag'] as const;
type Part = (typeof PARTS)[number];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class Pedestrians {
  private walks: Walk[] = [];
  private peds: Ped[] = [];
  private rand = rng(88);
  private mesh = {} as Record<Part, THREE.InstancedMesh>;
  readonly max: number;

  constructor(scene: THREE.Scene, d: CityData, col: Collider, max: number) {
    this.max = max; // 依畫質（quality.ts）
    const N = d.net.nodes;
    // 人行道：道路兩側、路緣外 2 m；壓到建築或別的車道的段落不要
    const tmp = [0, 0];
    const roadSegs: number[][] = [];
    for (const w of d.net.ways) if (w.c <= 3) for (let k = 0; k + 1 < w.n.length; k++) {
      roadSegs.push([N[w.n[k] * 2], N[w.n[k] * 2 + 1], N[w.n[k + 1] * 2], N[w.n[k + 1] * 2 + 1], w.w / 2 + 0.6]);
    }
    const onRoad = (x: number, z: number) => roadSegs.some(([x1, z1, x2, z2, r]) => {
      if (Math.min(x1, x2) - r > x || Math.max(x1, x2) + r < x || Math.min(z1, z2) - r > z || Math.max(z1, z2) + r < z) return false;
      const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2));
      return Math.hypot(x - x1 - dx * t, z - z1 - dz * t) < r;
    });
    for (const w of d.net.ways) {
      if (w.c > 3) continue;
      for (const side of [-1, 1]) {
        let prev: Walk | null = null;
        for (let k = 0; k + 1 < w.n.length; k++) {
          const ax = N[w.n[k] * 2], az = N[w.n[k] * 2 + 1], bx = N[w.n[k + 1] * 2], bz = N[w.n[k + 1] * 2 + 1];
          const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
          if (l < 4) { prev = null; continue; }
          const off = side * (w.w / 2 + 2), nx = (-dz / l) * off, nz = (dx / l) * off;
          const wk: Walk = { x1: ax + nx, z1: az + nz, x2: bx + nx, z2: bz + nz, len: l, next: [] };
          const mx = (wk.x1 + wk.x2) / 2, mz = (wk.z1 + wk.z2) / 2;
          if (onRoad(mx, mz) || col.push(mx, mz, 0.8, tmp)) { prev = null; continue; }
          if (prev) { prev.next.push(wk); wk.next.push(prev); }
          this.walks.push(wk);
          prev = wk;
        }
      }
    }

    // 人形：身體、骨盆、脖子、頭、頭髮、雙手雙腿（以關節為軸擺動）、鞋子、背包
    const geo: Record<Part, THREE.BufferGeometry> = {
      torso: pedParts.torso(), pelvis: pedParts.pelvis(), head: pedParts.head(), hair: pedParts.hair(), neck: pedParts.neck(),
      armL: pedParts.arm(), armR: pedParts.arm(), legL: pedParts.leg(), legR: pedParts.leg(), shoeL: pedParts.shoe(), shoeR: pedParts.shoe(), bag: pedParts.bag(),
    };
    const mat = new THREE.MeshLambertMaterial();
    for (const k of PARTS) {
      const m = new THREE.InstancedMesh(geo[k], mat, this.max);
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color());
      scene.add(m);
      this.mesh[k] = m;
    }
  }

  private spawn(px: number, pz: number, minR: number) {
    for (let t = 0; t < 15; t++) {
      const w = this.walks[Math.floor(this.rand() * this.walks.length)];
      const s = this.rand() * w.len;
      const x = w.x1 + ((w.x2 - w.x1) * s) / w.len, z = w.z1 + ((w.z2 - w.z1) * s) / w.len, d = Math.hypot(x - px, z - pz);
      if (d < minR || d > 240) continue;
      const pick = <T,>(a: T[]) => a[Math.floor(this.rand() * a.length)];
      const p: Ped = {
        w, s, dir: this.rand() < 0.5 ? 1 : -1, v: 1.1 + this.rand() * 0.5, x, z, h: 0, phase: this.rand() * 6,
        dodge: 0, sit: 0, shirt: new THREE.Color(pick(SHIRTS)), pants: new THREE.Color(pick(PANTS)), skin: new THREE.Color(pick(SKIN)),
        hair: new THREE.Color(pick(HAIR)), sleeve: new THREE.Color(), shoe: new THREE.Color(pick(SHOES)),
        scale: 0.9 + this.rand() * 0.18, bag: this.rand() < 0.4, alive: true,
      };
      p.sleeve.copy(this.rand() < 0.55 ? p.skin : p.shirt); // 短袖露出手臂，長袖就是衣服的顏色
      const dead = this.peds.findIndex((q) => !q.alive);
      if (dead >= 0) this.peds[dead] = p; else this.peds.push(p);
      return;
    }
  }

  /** 回傳被碰到的行人數（給音效用） */
  update(dt: number, car: { x: number; z: number; h: number; v: number }): number {
    let alive = 0, bumped = 0;
    for (const p of this.peds) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - car.x, p.z - car.z) > 280) p.alive = false; else alive++;
    }
    for (let k = 0; alive < this.max && k < 4 && this.walks.length; k++, alive++) this.spawn(car.x, car.z, this.peds.length < this.max ? 15 : 150);

    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    for (const p of this.peds) {
      if (!p.alive) continue;
      const w = p.w;
      if (p.sit > 0) {
        p.sit -= dt;
      } else {
        p.s += p.dir * p.v * dt;
        p.phase += p.v * dt * 5.2;
        if (p.s > w.len || p.s < 0) {
          // 走到這段盡頭：接到相鄰的人行道，沒有就掉頭
          const endX = p.s > w.len ? w.x2 : w.x1, endZ = p.s > w.len ? w.z2 : w.z1;
          const nxt = w.next.find((q) => Math.hypot(q.x1 - endX, q.z1 - endZ) < 1 || Math.hypot(q.x2 - endX, q.z2 - endZ) < 1);
          if (nxt && this.rand() < 0.85) {
            const atStart = Math.hypot(nxt.x1 - endX, nxt.z1 - endZ) < 1;
            p.w = nxt;
            p.dir = atStart ? 1 : -1;
            p.s = atStart ? 0 : nxt.len;
          } else {
            p.dir = p.dir === 1 ? -1 : 1;
            p.s = Math.max(0, Math.min(w.len, p.s));
          }
        }
      }
      const W = p.w, vx = (W.x2 - W.x1) / W.len, vz = (W.z2 - W.z1) / W.len;
      // 車子靠近：往遠離車子的那一側閃開
      const dx = p.x - car.x, dz = p.z - car.z, dist = Math.hypot(dx, dz);
      const ahead = dx * fx + dz * fz;
      if (dist < 9 && Math.abs(car.v) > 1.5 && ahead > -2) {
        const away = Math.sign(dx * -vz + dz * vx) || 1;
        p.dodge += away * dt * 3;
        p.dodge = Math.max(-2.2, Math.min(2.2, p.dodge));
      } else {
        p.dodge *= 1 - Math.min(1, dt * 0.8);
      }
      p.x = W.x1 + vx * p.s - vz * p.dodge;
      p.z = W.z1 + vz * p.s + vx * p.dodge;
      // 被車子碰到：推開並坐下 2.5 秒
      if (dist < 1.6 && p.sit <= 0 && Math.abs(car.v) > 0.5) {
        p.sit = 2.5;
        p.dodge += (Math.sign(dx * -vz + dz * vx) || 1) * 1.5;
        bumped++;
      }
      p.h = Math.atan2(vx * p.dir, vz * p.dir);
    }
    return bumped;
  }

  render() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const j = new THREE.Matrix4(), t = new THREE.Matrix4(), r = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let n = 0;
    const put = (k: Part, mat: THREE.Matrix4, c: THREE.Color) => { this.mesh[k].setMatrixAt(n, mat); this.mesh[k].setColorAt(n, c); };
    for (const p of this.peds) {
      if (!p.alive) continue;
      q.setFromAxisAngle(up, p.h);
      const sitting = p.sit > 0;
      const bob = sitting ? 0 : Math.abs(Math.sin(p.phase)) * 0.03;
      m.compose(pos.set(p.x, -0.25 + bob - (sitting ? 0.5 : 0), p.z), q, sc.setScalar(p.scale));
      for (const k of ['torso', 'pelvis', 'neck', 'head'] as const) put(k, m, k === 'torso' ? p.shirt : k === 'pelvis' ? p.pants : p.skin);
      put('hair', m, p.hair);
      put('bag', p.bag ? m : zero, p.shirt.clone().multiplyScalar(0.55));
      const swing = sitting ? 0 : Math.sin(p.phase) * 0.5;
      // 腿：髖關節 (±0.09, 0.9)；坐著時往前伸直
      for (const [leg, shoe, side, sgn] of [['legL', 'shoeL', -0.09, 1], ['legR', 'shoeR', 0.09, -1]] as const) {
        j.copy(m).multiply(t.makeTranslation(side, 0.9, 0)).multiply(r.makeRotationX(sitting ? -1.45 : swing * sgn));
        put(leg, j, p.pants);
        put(shoe, j, p.shoe);
      }
      // 手：肩關節 (±0.23, 1.44)，跟同側的腿反向擺
      for (const [arm, side, sgn] of [['armL', -0.23, -1], ['armR', 0.23, 1]] as const) {
        j.copy(m).multiply(t.makeTranslation(side, 1.44, 0)).multiply(r.makeRotationX(sitting ? -0.3 : swing * sgn * 0.8)).multiply(r.makeRotationZ(side * 0.25));
        put(arm, j, p.sleeve);
      }
      n++;
    }
    for (const k of PARTS) {
      const mesh = this.mesh[k];
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  set visible(v: boolean) { for (const k of PARTS) this.mesh[k].visible = v; }
  get count() { return this.peds.filter((p) => p.alive).length; }
  get sidewalks() { return this.walks.length; }
}
