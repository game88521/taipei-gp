import * as THREE from 'three';
import type { CityData, NetWay } from './citydata';
import { lanesOf } from './decor';
import { sedanGeo, busGeo, scooterGeo } from './models';

// 車流與紅綠燈：沿真實路網的車道行駛，路口隨機轉彎，跟車用 IDM（智慧駕駛模型），紅燈停在停止線前

interface DEdge {
  id: number;
  a: number; b: number; // 起訖節點
  ax: number; az: number; ux: number; uz: number; len: number;
  way: NetWay;
  lanes: number; // 這個方向的車道數
  laneW: number;
  base: number; // 第 0 車道離道路中心線的距離（往右為正）
  out: DEdge[];
}

interface Cluster { cx: number; cz: number; nodes: Set<number>; axis: number; offset: number }

type Kind = 0 | 1 | 2 | 3 | 4; // 轎車、計程車、公車、機車、掀背車
const KIND_LEN = [4.6, 4.6, 11, 1.9, 4.3];
const KIND_V = [13, 13.5, 10, 12, 12.5]; // 期望車速 m/s（市區約 45~50 km/h）

interface Agent {
  e: DEdge; s: number; lane: number; v: number; v0: number;
  kind: Kind; color: THREE.Color;
  x: number; z: number; h: number; vh: number; // vh = 畫面上平滑過的車頭方向
  inC: Cluster | null; // 已經進入的路口（同一個路口其他號誌節點不再停）
  stunned: number; // 被撞後停住的秒數
  alive: boolean;
}

// 號誌週期：主幹道方向綠 18 s → 黃 3 s → 全紅 2 s → 橫向綠 14 s → 黃 3 s → 全紅 2 s
const CYCLE = [18, 3, 2, 14, 3, 2];
const CYCLE_LEN = CYCLE.reduce((a, b) => a + b, 0);
function lightOf(c: Cluster, group: 0 | 1, t: number): 'g' | 'y' | 'r' {
  let p = (t + c.offset) % CYCLE_LEN;
  let k = 0;
  while (p >= CYCLE[k]) { p -= CYCLE[k]; k++; }
  if (group === 0) return k === 0 ? 'g' : k === 1 ? 'y' : 'r';
  return k === 3 ? 'g' : k === 4 ? 'y' : 'r';
}
const groupOf = (c: Cluster, ux: number, uz: number): 0 | 1 => (Math.abs(Math.sin(c.axis) * ux + Math.cos(c.axis) * uz) >= 0.707 ? 0 : 1);

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** 交通工具外型（models.ts）：轎車、計程車、公車、機車、掀背車 */
function kindGeometry(kind: Kind) {
  return kind === 2 ? busGeo() : kind === 3 ? scooterGeo() : sedanGeo({ taxi: kind === 1, hatch: kind === 4 });
}

const CAR_COLORS = ['#f2f2f0', '#1c1c1e', '#8a8f96', '#c0c4c8', '#7a1c22', '#1f3a6b', '#e8e2d0', '#3b3f45'];
const SCOOTER_COLORS = ['#e8e8e8', '#2a2a2a', '#c8102e', '#1f5fa8', '#e8c840', '#7fb8d8', '#f0a0b0'];

export class Traffic {
  private edges: DEdge[] = [];
  private spawnable: DEdge[] = [];
  private clusters: Cluster[] = [];
  private nodeCluster = new Map<number, Cluster>();
  private agents: Agent[] = [];
  private meshes: { paint: THREE.InstancedMesh; fixed: THREE.InstancedMesh }[] = [];
  private heads: { c: Cluster; g: 0 | 1; idx: number }[] = [];
  private lamps!: THREE.InstancedMesh;
  private lampState: string[] = [];
  private t = 0;
  private lampAcc = 1;
  private rand = rng(2026);
  private grid = new Map<number, Agent[]>();
  private extras: { x: number; z: number; v: number }[] = [];
  readonly max: number;

  constructor(scene: THREE.Scene, d: CityData, max: number) {
    this.max = max; // 依畫質（quality.ts）
    const N = d.net.nodes;
    // ---- 有方向的車道
    const outOf = new Map<number, DEdge[]>();
    for (const w of d.net.ways) {
      if (w.c > 3) continue;
      const total = Math.min(6, lanesOf(w));
      const dirs: (1 | -1)[] = w.o === 1 ? [1] : w.o === -1 ? [-1] : [1, -1];
      for (const dir of dirs) {
        const lanes = w.o ? total : Math.max(1, Math.floor(total / 2));
        const laneW = w.o ? w.w / lanes : Math.min(3.4, w.w / 2 / lanes);
        const base = w.o ? -w.w / 2 + laneW / 2 : laneW / 2;
        const seq = dir === 1 ? w.n : [...w.n].reverse();
        for (let k = 0; k + 1 < seq.length; k++) {
          const a = seq[k], b = seq[k + 1];
          const ax = N[a * 2], az = N[a * 2 + 1], dx = N[b * 2] - ax, dz = N[b * 2 + 1] - az, len = Math.hypot(dx, dz);
          if (len < 0.5) continue;
          const e: DEdge = { id: this.edges.length, a, b, ax, az, ux: dx / len, uz: dz / len, len, way: w, lanes, laneW, base, out: [] };
          this.edges.push(e);
          if (!outOf.has(a)) outOf.set(a, []);
          outOf.get(a)!.push(e);
          // 幹道多生一點車
          const weight = [6, 4, 3, 1][w.c] ?? 1;
          for (let r = 0; r < weight; r++) this.spawnable.push(e);
        }
      }
    }
    for (const e of this.edges) {
      e.out = (outOf.get(e.b) || []).filter((o) => !(o.b === e.a && o.way === e.way) && e.ux * o.ux + e.uz * o.uz > -0.85);
    }

    // ---- 號誌路口：35 m 內的號誌節點算同一個路口
    for (const ni of d.signals) {
      const x = N[ni * 2], z = N[ni * 2 + 1];
      let c = this.clusters.find((k) => Math.hypot(k.cx - x, k.cz - z) < 35);
      if (!c) { c = { cx: x, cz: z, nodes: new Set(), axis: 0, offset: this.rand() * CYCLE_LEN }; this.clusters.push(c); }
      c.nodes.add(ni);
      this.nodeCluster.set(ni, c);
    }
    for (const c of this.clusters) {
      // 路口的「主方向」= 進入路口最寬的那條路
      let bw = -1;
      for (const e of this.edges) if (c.nodes.has(e.b) && e.way.w > bw) { bw = e.way.w; c.axis = Math.atan2(e.ux, e.uz); }
    }
    this.buildSignals(scene, d);

    // ---- 車輛外型
    const mats = [new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial({ vertexColors: true })];
    for (let k = 0 as Kind; k < 5; k = (k + 1) as Kind) {
      const g = kindGeometry(k);
      const cap = this.max;
      const paint = new THREE.InstancedMesh(g.paint, mats[0], cap), fixed = new THREE.InstancedMesh(g.fixed, mats[1], cap);
      paint.count = fixed.count = 0;
      paint.frustumCulled = fixed.frustumCulled = false;
      paint.setColorAt(0, new THREE.Color());
      scene.add(paint, fixed);
      this.meshes.push({ paint, fixed });
    }
  }

  /** 每個號誌路口的每個進入方向：路邊一支桿子＋伸到路上的橫桿＋三個燈（紅黃綠） */
  private buildSignals(scene: THREE.Scene, d: CityData) {
    const poles: THREE.Matrix4[] = [], arms: THREE.Matrix4[] = [], lampM: THREE.Matrix4[] = [];
    const seen = new Set<string>();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const e of this.edges) {
      const c = this.nodeCluster.get(e.b);
      if (!c || c.nodes.has(e.a) || e.way.c > 2) continue;
      const key = `${this.clusters.indexOf(c)}:${e.way.nm || e.way.w}:${Math.round(Math.atan2(e.ux, e.uz) * 2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rx = -e.uz, rz = e.ux; // 右手邊
      const bx = d.net.nodes[e.b * 2], bz = d.net.nodes[e.b * 2 + 1];
      const side = e.base + e.laneW * e.lanes + 1.2; // 最右車道外側
      const px = bx + rx * side - e.ux * 2, pz = bz + rz * side - e.uz * 2;
      const ang = Math.atan2(e.ux, e.uz);
      q.setFromAxisAngle(up, ang);
      poles.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), q, one));
      const armLen = Math.min(7, e.laneW * e.lanes);
      arms.push(new THREE.Matrix4().compose(new THREE.Vector3(px - rx * armLen / 2, 5.6, pz - rz * armLen / 2), q, new THREE.Vector3(armLen, 1, 1)));
      const hx = px - rx * armLen, hz = pz - rz * armLen;
      const g = groupOf(c, e.ux, e.uz);
      for (let k = 0; k < 3; k++) {
        // 面向來車：燈在橫桿下、左到右 紅 黃 綠
        const lx = hx + rx * (k - 1) * 0.42 - e.ux * 0.2, lz = hz + rz * (k - 1) * 0.42 - e.uz * 0.2;
        lampM.push(new THREE.Matrix4().compose(new THREE.Vector3(lx, 5.25, lz), q, one));
        this.heads.push({ c, g, idx: lampM.length - 1 });
      }
    }
    const metal = new THREE.MeshLambertMaterial({ color: '#6f757c' });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 5.8, 6).translate(0, 2.9, 0), metal, poles.length);
    poles.forEach((m, i) => pole.setMatrixAt(i, m));
    // 橫桿：長邊在本地 x，轉成道路方向後剛好橫跨車道；compose 的縮放把它拉到所需長度
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 0.14), metal, arms.length);
    arms.forEach((m, i) => arm.setMatrixAt(i, m));
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.5, 0.3), new THREE.MeshLambertMaterial({ color: '#2a2c30' }), lampM.length / 3);
    for (let i = 0; i < lampM.length; i += 3) {
      const m = lampM[i + 1].clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.2));
      housing.setMatrixAt(i / 3, m);
    }
    this.lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.17, 12).rotateY(Math.PI), new THREE.MeshBasicMaterial({ toneMapped: false }), lampM.length);
    lampM.forEach((m, i) => { this.lamps.setMatrixAt(i, m); this.lamps.setColorAt(i, new THREE.Color('#222')); });
    this.lampState = new Array(lampM.length).fill('');
    scene.add(pole, arm, housing, this.lamps);
  }

  private updateLamps() {
    const ON = { r: new THREE.Color('#ff2020'), y: new THREE.Color('#ffb000'), g: new THREE.Color('#20ff70') };
    const OFF = [new THREE.Color('#3a1010'), new THREE.Color('#3a2a08'), new THREE.Color('#0c3018')];
    let dirty = false;
    for (let i = 0; i < this.heads.length; i++) {
      const h = this.heads[i], k = i % 3, l = lightOf(h.c, h.g, this.t);
      const want = (k === 0 && l === 'r') || (k === 1 && l === 'y') || (k === 2 && l === 'g') ? 'on' : 'off';
      if (this.lampState[i] === want) continue;
      this.lampState[i] = want;
      this.lamps.setColorAt(i, want === 'on' ? ON[(['r', 'y', 'g'] as const)[k]] : OFF[k]);
      dirty = true;
    }
    if (dirty && this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  private spawn(px: number, pz: number, minR: number, maxR: number): boolean {
    for (let tries = 0; tries < 20; tries++) {
      const e = this.spawnable[Math.floor(this.rand() * this.spawnable.length)];
      const s = this.rand() * e.len;
      const x = e.ax + e.ux * s, z = e.az + e.uz * s, d = Math.hypot(x - px, z - pz);
      if (d < minR || d > maxR) continue;
      const lane = Math.floor(this.rand() * e.lanes);
      if (this.agents.some((a) => a.alive && a.e === e && a.lane === lane && Math.abs(a.s - s) < 12)) continue;
      const r = this.rand();
      const kind: Kind = e.way.c <= 1 && r < 0.06 ? 2 : r < 0.36 ? 3 : r < 0.52 ? 1 : r < 0.66 ? 4 : 0;
      const color = new THREE.Color(kind === 1 ? '#f5c518' : kind === 2 ? (this.rand() < 0.5 ? '#2a7fd4' : '#e8e8e8') : kind === 3 ? SCOOTER_COLORS[Math.floor(this.rand() * SCOOTER_COLORS.length)] : CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)]);
      const a: Agent = {
        e, s, lane: kind === 3 ? e.lanes - 1 : lane, v: KIND_V[kind] * 0.6, v0: KIND_V[kind] * (0.85 + this.rand() * 0.3),
        kind, color, x, z, h: Math.atan2(e.ux, e.uz), vh: Math.atan2(e.ux, e.uz), inC: null, stunned: 0, alive: true,
      };
      const dead = this.agents.findIndex((q) => !q.alive);
      if (dead >= 0) this.agents[dead] = a; else this.agents.push(a);
      this.place(a);
      a.vh = a.h;
      return true;
    }
    return false;
  }

  private place(a: Agent) {
    const e = a.e, off = e.base + (a.lane + 0.5) * e.laneW - e.laneW / 2 + (a.kind === 3 ? e.laneW * 0.3 : 0);
    a.x = e.ax + e.ux * a.s - e.uz * off;
    a.z = e.az + e.uz * a.s + e.ux * off;
    a.h = Math.atan2(e.ux, e.uz);
  }

  private key(x: number, z: number) { return (Math.floor(x / 20) + 1000) * 4000 + Math.floor(z / 20) + 1000; }

  /** 前方最近的障礙物距離（同方向、橫向 1.8 m 內）與它的速度 */
  private leader(a: Agent, player: { x: number; z: number; v: number }) {
    const fx = Math.sin(a.h), fz = Math.cos(a.h);
    let gap = 80, lv = 0;
    const consider = (x: number, z: number, len: number, v: number, w: number) => {
      const dx = x - a.x, dz = z - a.z, ahead = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
      if (ahead <= 0 || lat > w) return;
      const g = ahead - (KIND_LEN[a.kind] + len) / 2;
      if (g < gap) { gap = g; lv = v; }
    };
    const cx = Math.floor(a.x / 20), cz = Math.floor(a.z / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const b of this.grid.get((cx + i + 1000) * 4000 + cz + j + 1000) || []) {
        if (b === a || !b.alive) continue;
        if (Math.cos(b.h - a.h) < 0.3) continue; // 對向或橫向的車不算
        consider(b.x, b.z, KIND_LEN[b.kind], b.v, a.kind === 3 || b.kind === 3 ? 1.1 : 1.8);
      }
    }
    consider(player.x, player.z, 4.6, Math.max(0, player.v), 2.2);
    for (const o of this.extras) consider(o.x, o.z, 4.6, Math.max(0, o.v), 2.0);
    return { gap, lv };
  }

  /** 附近的車（給街頭飆車的對手閃車用） */
  near(x: number, z: number, r: number) {
    return this.agents.filter((a) => a.alive && Math.abs(a.x - x) < r && Math.abs(a.z - z) < r);
  }

  update(dt: number, player: { x: number; z: number; h: number; v: number }, extras: { x: number; z: number; v: number }[] = []) {
    this.extras = extras;
    this.t += dt;
    // 生成／回收：保持在玩家周圍
    let alive = 0;
    for (const a of this.agents) {
      if (!a.alive) continue;
      if (Math.hypot(a.x - player.x, a.z - player.z) > 430) a.alive = false; else alive++;
    }
    for (let k = 0; alive < this.max && k < 6; k++) if (this.spawn(player.x, player.z, this.agents.length < this.max ? 25 : 200, 380)) alive++;

    this.grid.clear();
    for (const a of this.agents) {
      if (!a.alive) continue;
      const k = this.key(a.x, a.z);
      let c = this.grid.get(k);
      if (!c) this.grid.set(k, (c = []));
      c.push(a);
    }

    for (const a of this.agents) {
      if (!a.alive) continue;
      if (a.stunned > 0) { a.stunned -= dt; a.v = 0; continue; }
      let { gap, lv } = this.leader(a, player);
      // 紅綠燈：這段路的終點是號誌路口，而且還沒進那個路口
      const c = this.nodeCluster.get(a.e.b);
      if (c && a.inC !== c) {
        const toStop = a.e.len - a.s - 3;
        const l = lightOf(c, groupOf(c, a.e.ux, a.e.uz), this.t);
        const canStop = toStop > (a.v * a.v) / (2 * 4) - 1;
        if ((l === 'r' || (l === 'y' && canStop)) && toStop > -1 && toStop < gap) { gap = Math.max(0.1, toStop); lv = 0; }
      }
      // IDM：期望車距 s* = s0 + vT + v·Δv / (2√(ab))
      const s0 = a.kind === 3 ? 1.2 : 2.2, T = 1.1, am = a.kind === 2 ? 1.2 : 2.2, b = 3;
      const sStar = s0 + a.v * T + (a.v * (a.v - lv)) / (2 * Math.sqrt(am * b));
      const acc = am * (1 - (a.v / a.v0) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2);
      a.v = Math.max(0, a.v + Math.max(-9, acc) * dt);
      a.s += a.v * dt;
      // 走完這段就接下一段（路口隨機轉彎，比較常沿同一條路直走）
      while (a.s >= a.e.len) {
        a.s -= a.e.len;
        const outs = a.e.out;
        if (!outs.length) { a.alive = false; break; }
        let next = outs[0];
        if (outs.length > 1) {
          const straight = outs.filter((o) => o.way.nm && o.way.nm === a.e.way.nm);
          next = straight.length && this.rand() < 0.65 ? straight[0] : outs[Math.floor(this.rand() * outs.length)];
        }
        const cl = this.nodeCluster.get(a.e.b);
        if (cl) a.inC = cl;
        else if (a.inC && !a.inC.nodes.has(next.a)) a.inC = null;
        a.lane = Math.min(a.lane, next.lanes - 1);
        a.e = next;
      }
      if (a.alive) this.place(a);
    }

    this.lampAcc += dt;
    if (this.lampAcc > 0.25) { this.lampAcc = 0; this.updateLamps(); }
  }

  /** 玩家的車撞到車流：把玩家推開，被撞的車停一下；回傳撞擊力道 */
  collidePlayer(p: { x: number; z: number; h: number; v: number }): number {
    let impact = 0;
    const fx = Math.sin(p.h), fz = Math.cos(p.h);
    for (const a of this.agents) {
      if (!a.alive || Math.abs(a.x - p.x) > 8 || Math.abs(a.z - p.z) > 8) continue;
      const ax = Math.sin(a.h), az = Math.cos(a.h), half = KIND_LEN[a.kind] / 2 - 0.9, ar = a.kind === 3 ? 0.5 : a.kind === 2 ? 1.3 : 1.0;
      for (const po of [1.3, -1.3]) for (const ao of [-half, 0, half]) {
        const px = p.x + fx * po, pz = p.z + fz * po, qx = a.x + ax * ao, qz = a.z + az * ao;
        const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz), r = 1.05 + ar;
        if (d >= r || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d;
        p.x += nx * (r - d);
        p.z += nz * (r - d);
        const vn = (fx * nx + fz * nz) * p.v;
        if (vn < 0) { impact = Math.max(impact, -vn); p.v *= 0.55; }
        a.stunned = Math.max(a.stunned, 1.5);
      }
    }
    return impact;
  }

  render(dt: number) {
    const counts = [0, 0, 0, 0, 0];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    for (const a of this.agents) {
      if (!a.alive) continue;
      let d = a.h - a.vh;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.vh += d * Math.min(1, dt * 8);
      const i = counts[a.kind]++;
      q.setFromAxisAngle(up, a.vh);
      m.compose(pos.set(a.x, -0.25, a.z), q, one);
      const mm = this.meshes[a.kind];
      mm.paint.setMatrixAt(i, m);
      mm.fixed.setMatrixAt(i, m);
      mm.paint.setColorAt(i, a.color);
    }
    this.meshes.forEach((mm, k) => {
      mm.paint.count = mm.fixed.count = counts[k];
      mm.paint.instanceMatrix.needsUpdate = mm.fixed.instanceMatrix.needsUpdate = true;
      if (mm.paint.instanceColor) mm.paint.instanceColor.needsUpdate = true;
    });
  }

  get count() { return this.agents.filter((a) => a.alive).length; }
  /** 測試用統計：車數、平均速度、停著的車數、各車種數 */
  stats() {
    const al = this.agents.filter((a) => a.alive);
    const avg = al.reduce((s, a) => s + a.v, 0) / (al.length || 1);
    const kinds = [0, 0, 0, 0, 0];
    al.forEach((a) => kinds[a.kind]++);
    return `${al.length}台 平均${(avg * 3.6).toFixed(0)}km/h 停著${al.filter((a) => a.v < 0.5).length} 種類${kinds.join('/')} 號誌路口${this.clusters.length} 燈${this.heads.length / 3}`;
  }

  /** 街道賽封路：車流不顯示 */
  set visible(v: boolean) { for (const m of this.meshes) m.paint.visible = m.fixed.visible = v; }
}
