import * as THREE from 'three';
import { Grid, type CityData, type Collider } from './citydata';
import type { Traffic } from './traffic';
import { pedParts } from './models';
import { bakedShadowMaterial, blobTexture } from './world';

// 行人：沿真實道路兩側的人行道來回走；車子靠近會閃開，被碰到會被推開、坐在地上一下再站起來

interface Walk { x1: number; z1: number; x2: number; z2: number; len: number; next: Walk[] }
/** 斑馬線：路口中心、道路方向、兩端（在兩側人行道上） */
interface Crossing { cx: number; cz: number; ux: number; uz: number; w: number; ends: [number, number][] }
interface Ped {
  mode: 'walk' | 'wait' | 'cross';
  cw: Crossing | null; // 正在等或正在過的斑馬線
  from: number; // 從斑馬線的哪一端出發（0/1）
  ct: number; // 過馬路進度 0..1；等待時是已經等了幾秒
  cool: number; // 剛過完馬路，暫時不再過
  w: Walk; s: number; dir: 1 | -1; v: number;
  x: number; z: number; h: number;
  phase: number; // 走路擺腿的相位
  dodge: number; // 閃避時的橫向位移
  sit: number; // 坐在地上的剩餘秒數
  scared: number; // 被衝過來的車嚇到：舉手、跑開的剩餘秒數
  look: number; // 被按喇叭：停下來轉頭看的剩餘秒數
  lookX: number; lookZ: number;
  shirt: THREE.Color; pants: THREE.Color; skin: THREE.Color; hair: THREE.Color; sleeve: THREE.Color; shoe: THREE.Color;
  scale: number; bag: boolean; bagColor: THREE.Color;
  umbColor: THREE.Color; // 下雨時撐的傘
  alive: boolean;
}

const SHIRTS = ['#e8e8e8', '#2a2f3a', '#c8102e', '#1f5fa8', '#f0c040', '#3f8f5a', '#f2a0b8', '#7a5a3a', '#8a8f96', '#ff7a30'];
const PANTS = ['#2a2f3a', '#1d2e4a', '#4a4a4a', '#c8b89a', '#1a1a1a', '#5a6a7a'];
const SKIN = ['#f1d2b6', '#e3b994', '#c99a74', '#a8795a', '#f6dcc6'];
const HAIR = ['#1a1612', '#2a2018', '#3a2a1c', '#5a3a22', '#8a6a4a', '#b8b0a8'];
const SHOES = ['#f2f2f2', '#1a1a1a', '#5a3a22', '#c8102e', '#3a4a6a'];
const PARTS = ['torso', 'pelvis', 'head', 'hair', 'neck', 'armL', 'armR', 'legL', 'legR', 'shoeL', 'shoeR', 'bag', 'blob', 'umb', 'umbPole'] as const;
const UMBRELLAS = ['#e03b3b', '#2f6fd8', '#f2c230', '#3fae5a', '#e05fa0', '#1c1c22', '#ffffff', '#7a5ad8', '#ff7a30', '#22a8b8'];
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
  private crossings: Crossing[] = [];
  private endGrid = new Grid<Crossing>(15);
  private walkGrid = new Grid<Walk>(15);
  private tmpC: Crossing[] = [];
  private tmpW: Walk[] = [];
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
    // 用格子索引查「在不在車道上」：地圖大了以後，逐條比對所有道路會讓載入卡好幾秒
    const segGrid = new Grid<number[]>(30);
    for (const sg of roadSegs) segGrid.addBox(Math.min(sg[0], sg[2]) - sg[4], Math.min(sg[1], sg[3]) - sg[4], Math.max(sg[0], sg[2]) + sg[4], Math.max(sg[1], sg[3]) + sg[4], sg);
    const segTmp: number[][] = [];
    const onRoad = (x: number, z: number) => segGrid.query(x, z, 0, segTmp).some(([x1, z1, x2, z2, r]) => {
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

    // 斑馬線：路網上的穿越道節點，兩端各在路緣外 2 m（落到別的車道上的不要）
    const wayAt = new Map<number, { w: CityData['net']['ways'][number]; k: number }>();
    for (const w of d.net.ways) if (w.c <= 3) w.n.forEach((ni, k) => { if (!wayAt.has(ni)) wayAt.set(ni, { w, k }); });
    for (const ni of d.crossings) {
      const at = wayAt.get(ni);
      if (!at) continue;
      const { w, k } = at;
      const a = w.n[Math.max(0, k - 1)], b = w.n[Math.min(w.n.length - 1, k + 1)];
      let ux = N[b * 2] - N[a * 2], uz = N[b * 2 + 1] - N[a * 2 + 1];
      const l = Math.hypot(ux, uz) || 1;
      ux /= l; uz /= l;
      const cx = N[ni * 2], cz = N[ni * 2 + 1], off = w.w / 2 + 2;
      const ends: [number, number][] = [[cx - uz * off, cz + ux * off], [cx + uz * off, cz - ux * off]];
      if (ends.some(([x, z]) => onRoad(x, z) || col.push(x, z, 0.5, tmp))) continue;
      const c: Crossing = { cx, cz, ux, uz, w: w.w, ends };
      this.crossings.push(c);
      for (const [x, z] of ends) this.endGrid.addBox(x, z, x, z, c);
    }
    for (const wk of this.walks) this.walkGrid.addBox(wk.x1, wk.z1, wk.x2, wk.z2, wk);

    // 人形：身體、骨盆、脖子、頭、頭髮、雙手雙腿（以關節為軸擺動）、鞋子、背包
    const geo: Record<Part, THREE.BufferGeometry> = {
      torso: pedParts.torso(), pelvis: pedParts.pelvis(), head: pedParts.head(), hair: pedParts.hair(), neck: pedParts.neck(),
      armL: pedParts.arm(), armR: pedParts.arm(), legL: pedParts.leg(), legR: pedParts.leg(), shoeL: pedParts.shoe(), shoeR: pedParts.shoe(), bag: pedParts.bag(),
      blob: new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2).translate(0, 0.27, 0), // 腳下的影子（比腳底高一點點，蓋在路面上）
      // 雨傘：右手舉著，傘面在頭頂偏右前方
      umb: new THREE.ConeGeometry(0.62, 0.26, 12, 1, true).translate(0.12, 2.12, 0.08),
      umbPole: new THREE.CylinderGeometry(0.015, 0.015, 0.9, 5).translate(0.12, 1.62, 0.08),
    };
    const mat = new THREE.MeshLambertMaterial(), umbMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    for (const k of PARTS) {
      const m = new THREE.InstancedMesh(geo[k], k === 'blob' ? bakedShadowMaterial(blobTexture()) : k === 'umb' ? umbMat : mat, this.max);
      m.count = 0;
      m.frustumCulled = false;
      if (k !== 'blob') m.userData.dynamic = true; // 投射即時陰影
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
        mode: 'walk', cw: null, from: 0, ct: 0, cool: this.rand() * 10,
        w, s, dir: this.rand() < 0.5 ? 1 : -1, v: 1.1 + this.rand() * 0.5, x, z, h: 0, phase: this.rand() * 6,
        dodge: 0, sit: 0, scared: 0, look: 0, lookX: 0, lookZ: 0, shirt: new THREE.Color(pick(SHIRTS)), pants: new THREE.Color(pick(PANTS)), skin: new THREE.Color(pick(SKIN)),
        hair: new THREE.Color(pick(HAIR)), sleeve: new THREE.Color(), shoe: new THREE.Color(pick(SHOES)),
        scale: 0.9 + this.rand() * 0.18, bag: this.rand() < 0.4, bagColor: new THREE.Color(), umbColor: new THREE.Color(UMBRELLAS[Math.floor(this.rand() * UMBRELLAS.length)]), alive: true,
      };
      p.sleeve.copy(this.rand() < 0.55 ? p.skin : p.shirt); // 短袖露出手臂，長袖就是衣服的顏色
      p.bagColor.copy(p.shirt).multiplyScalar(0.55);
      const dead = this.peds.findIndex((q) => !q.alive);
      if (dead >= 0) this.peds[dead] = p; else this.peds.push(p);
      return;
    }
  }

  /** 回傳被碰到的行人數（給音效用） */
  /** 下雨（main 每格設）：撐傘、走快一點 */
  raining = false;
  /** 尖叫（給 main 播）：位置 */
  screams: { x: number; z: number }[] = [];
  screamCount = 0; // 測試用
  private scream(p: Ped) { this.screamCount++; if (this.screams.length < 6) this.screams.push({ x: p.x, z: p.z }); }

  /** 玩家按喇叭：28 m 內的人停下來轉頭看 */
  honked(px: number, pz: number) {
    for (const p of this.peds) {
      if (!p.alive || p.sit > 0 || p.scared > 0 || Math.hypot(p.x - px, p.z - pz) > 28) continue;
      p.look = 1.2 + this.rand() * 1.3;
      p.lookX = px; p.lookZ = pz;
    }
  }

  /** 車子是不是正朝這個人衝過來（夠快、在車頭前面、橫向偏差小） */
  private danger(p: Ped, car: { x: number; z: number; v: number }, fx: number, fz: number) {
    const dx = p.x - car.x, dz = p.z - car.z, dist = Math.hypot(dx, dz);
    if (dist > 16 || Math.abs(car.v) < 8) return false;
    const ahead = (dx * fx + dz * fz) * Math.sign(car.v), lat = Math.abs(-dx * fz + dz * fx);
    return ahead > 0 && lat < 3.5;
  }

  update(dt: number, car: { x: number; z: number; h: number; v: number }, traffic: Traffic | null = null): number {
    let alive = 0, bumped = 0;
    for (const p of this.peds) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - car.x, p.z - car.z) > 280) p.alive = false; else alive++;
    }
    for (let k = 0; alive < this.max && k < 4 && this.walks.length; k++, alive++) this.spawn(car.x, car.z, this.peds.length < this.max ? 15 : 150);

    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    for (const p of this.peds) {
      if (!p.alive) continue;
      p.cool -= dt;
      p.scared = Math.max(0, p.scared - dt);
      p.look = Math.max(0, p.look - dt);
      if (p.sit <= 0 && p.scared <= 0 && this.danger(p, car, fx, fz)) { p.scared = 1.6; p.look = 0; this.scream(p); }
      // ---- 等紅燈／過馬路
      if (p.mode !== 'walk' && p.cw) {
        const c = p.cw, [ax, az] = c.ends[p.from], [bx, bz] = c.ends[1 - p.from];
        if (p.sit > 0) { p.sit -= dt; continue; }
        if (p.mode === 'wait') {
          p.ct += dt;
          p.x = ax; p.z = az;
          p.h = Math.atan2(bx - ax, bz - az);
          if (this.mayCross(c, traffic)) { p.mode = 'cross'; p.ct = 0; }
          else if (p.ct > 45) { p.mode = 'walk'; p.cool = 30; } // 等太久就不過了
          continue;
        }
        // 過馬路：走到對面，再接上那一側的人行道
        const len = Math.hypot(bx - ax, bz - az) || 1;
        p.ct += (p.v * (p.scared > 0 ? 3 : 1.15) * dt) / len; // 嚇到就衝過去
        p.phase += p.v * dt * 5.6;
        p.x = ax + (bx - ax) * p.ct;
        p.z = az + (bz - az) * p.ct;
        p.h = Math.atan2(bx - ax, bz - az);
        const cdx = p.x - car.x, cdz = p.z - car.z;
        if (Math.hypot(cdx, cdz) < 1.6 && Math.abs(car.v) > 0.5 && p.sit <= 0) { p.sit = 2.5; bumped++; this.scream(p); }
        if (p.ct >= 1) this.landOn(p, bx, bz);
        continue;
      }
      const w = p.w;
      // 走到斑馬線那一端：一半的人會過馬路
      if (p.cool <= 0 && p.sit <= 0) {
        for (const c of this.endGrid.query(p.x, p.z, 3, this.tmpC)) {
          const e = c.ends.findIndex(([x, z]) => Math.hypot(x - p.x, z - p.z) < 1.6);
          if (e < 0) continue;
          p.cool = 25;
          if (this.rand() < 0.55) { p.mode = 'wait'; p.cw = c; p.from = e; p.ct = 0; }
          break;
        }
        if (p.mode !== 'walk') continue;
      }
      if (p.sit > 0) {
        p.sit -= dt;
      } else if (p.look > 0 && p.scared <= 0) {
        // 被按喇叭：站著看
      } else {
        const run = p.scared > 0 ? 2.4 : this.raining ? 1.3 : 1; // 嚇到就跑；下雨走快一點
        p.s += p.dir * p.v * run * dt;
        p.phase += p.v * run * dt * 5.2;
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
      if ((dist < 9 && Math.abs(car.v) > 1.5 && ahead > -2) || p.scared > 0) {
        const away = Math.sign(dx * -vz + dz * vx) || 1;
        const lim = p.scared > 0 ? 3.5 : 2.2;
        p.dodge += away * dt * (p.scared > 0 ? 9 : 3); // 嚇到就往旁邊跳開
        p.dodge = Math.max(-lim, Math.min(lim, p.dodge));
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
        this.scream(p);
      }
      p.h = p.look > 0 && p.scared <= 0 ? Math.atan2(p.lookX - p.x, p.lookZ - p.z) : Math.atan2(vx * p.dir, vz * p.dir);
    }
    return bumped;
  }

  /** 可以過馬路嗎：有號誌的路口看這條路的車是不是紅燈；沒號誌就看附近有沒有車開過來 */
  private mayCross(c: Crossing, traffic: Traffic | null): boolean {
    if (!traffic) return true;
    const sig = traffic.pedGreen(c.cx, c.cz, c.ux, c.uz);
    if (sig !== null) return sig;
    for (const a of traffic.near(c.cx, c.cz, 30)) {
      if (a.v < 1) continue;
      const dx = c.cx - a.x, dz = c.cz - a.z, hx = Math.sin(a.h), hz = Math.cos(a.h);
      const ahead = dx * hx + dz * hz;
      if (ahead > -3 && ahead < 26 && Math.abs(-dx * hz + dz * hx) < c.w / 2 + 3) return false;
    }
    return true;
  }

  /** 過完馬路：接到對面最近的人行道；找不到就讓這個人消失（之後會在別處重新出現） */
  private landOn(p: Ped, x: number, z: number) {
    let best: Walk | null = null, bs = 0, bd = 4;
    for (const w of this.walkGrid.query(x, z, 4, this.tmpW)) {
      const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
      const t = Math.max(0, Math.min(w.len, ((x - w.x1) * dx + (z - w.z1) * dz) / w.len));
      const d = Math.hypot(w.x1 + (dx * t) / w.len - x, w.z1 + (dz * t) / w.len - z);
      if (d < bd) { bd = d; best = w; bs = t; }
    }
    p.mode = 'walk';
    p.cw = null;
    p.cool = 20;
    if (!best) { p.alive = false; return; }
    p.w = best;
    p.s = bs;
    p.dir = this.rand() < 0.5 ? 1 : -1;
    p.dodge = 0;
  }

  /** 正在過馬路的人：給車流當障礙物（車子會停下來讓） */
  crossers(): { x: number; z: number; v: number }[] {
    return this.peds.filter((p) => p.alive && p.mode === 'cross').map((p) => ({ x: p.x, z: p.z, v: 0 }));
  }
  get crossingCount() { return this.crossings.length; }
  get crossingNow() { return this.peds.filter((p) => p.alive && p.mode === 'cross').length; }
  get waitingNow() { return this.peds.filter((p) => p.alive && p.mode === 'wait').length; }

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
      put('blob', m, p.hair);
      put('bag', p.bag ? m : zero, p.bagColor);
      const umb = this.raining && !sitting; // 被撞倒坐在地上時傘掉了
      put('umb', umb ? m : zero, p.umbColor);
      put('umbPole', umb ? m : zero, p.shoe);
      const swing = sitting || p.mode === 'wait' || (p.look > 0 && p.scared <= 0) ? 0 : Math.sin(p.phase) * (p.scared > 0 ? 0.8 : 0.5); // 等紅燈、轉頭看時站好；跑的時候擺比較大
      // 腿：髖關節 (±0.09, 0.9)；坐著時往前伸直
      for (const [leg, shoe, side, sgn] of [['legL', 'shoeL', -0.09, 1], ['legR', 'shoeR', 0.09, -1]] as const) {
        j.copy(m).multiply(t.makeTranslation(side, 0.9, 0)).multiply(r.makeRotationX(sitting ? -1.45 : swing * sgn));
        put(leg, j, p.pants);
        put(shoe, j, p.shoe);
      }
      // 手：肩關節 (±0.23, 1.44)，跟同側的腿反向擺
      for (const [arm, side, sgn] of [['armL', -0.23, -1], ['armR', 0.23, 1]] as const) {
        // 嚇到：雙手舉高；下雨撐傘：右手往前上方舉著傘柄
        const raise = p.scared > 0 && !sitting ? Math.PI - 0.35 : this.raining && !sitting && side > 0 ? 1.15 : 0;
        j.copy(m).multiply(t.makeTranslation(side, 1.44, 0)).multiply(r.makeRotationX(sitting ? -0.3 : raise ? raise : swing * sgn * 0.8)).multiply(r.makeRotationZ(side * (raise ? 0.6 : 0.25)));
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
  /** 測試截圖用：第 i 個走在人行道上的人的位置與面向 */
  pos(i: number) { const p = this.peds.filter((q) => q.alive && q.mode === 'walk')[i]; return p ? { x: p.x, z: p.z, h: p.h } : null; }
  get sidewalks() { return this.walks.length; }
}
