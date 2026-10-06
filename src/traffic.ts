import * as THREE from 'three';
import type { CityData, NetWay, Collider } from './citydata';
import { lanesOf } from './decor';
import { sedanGeo, busGeo, scooterGeo } from './models';
import { FreeCar } from './freecar';
import type { Breakables } from './breakables';
import { bakedShadowMaterial, blobTexture } from './world';

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
// 撞車用：質量是玩家車的幾倍（公車很重、機車連人約 1/5）、轉動慣量 ÷ 質量（m²）、碰撞半徑、被撞後停幾秒
const KIND_MASS = [1, 1, 8, 0.2, 0.85];
const KIND_INERTIA = [1.9, 1.9, 10, 0.35, 1.6];
const KIND_R = [1.0, 1.0, 1.3, 0.5, 1.0];
const KIND_STUN = [2.5, 2.5, 1.2, 4.5, 2.5];
const KNOCK_VMAX = [12, 12, 4, 11, 12]; // 被撞出去的速度上限（避免撞一下就飛出畫面）

export interface Agent {
  e: DEdge; s: number; lane: number; v: number; v0: number;
  kind: Kind; color: THREE.Color;
  x: number; z: number; h: number; vh: number; // vh = 畫面上平滑過的車頭方向
  inC: Cluster | null; // 已經進入的路口（同一個路口其他號誌節點不再停）
  stunned: number; // 被撞後停住的秒數
  kx: number; kz: number; kh: number; // 被撞開的位移與車頭偏轉（慢慢回到車道）
  kvx: number; kvz: number; kw: number; // 被撞開的速度與旋轉（在地上滑、摩擦慢慢停下）
  down: number; fall: number; // 機車被撞倒：倒地剩幾秒、目前倒下的程度（0 站著 ~ 1 躺平）
  lo: number; // 目前離道路中線的橫向位置（換車道時慢慢移過去，不會瞬移）
  blockT: number; // 被玩家擋在後面多久（太久會按喇叭）
  honkT: number; // 幾秒後按喇叭（被撞、回按）
  next: DEdge | null; // 快到路口時先決定好的下一段（才能提早打方向燈）
  blink: number; // 方向燈：1 左、-1 右、0 不打
  laneCool: number; // 換車道冷卻
  laneBlink: number; // 換車道的方向燈剩幾秒（方向存在 laneSide）
  laneSide: number;
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
  agents: Agent[] = [];
  private meshes: { paint: THREE.InstancedMesh; fixed: THREE.InstancedMesh }[] = [];
  private heads: { c: Cluster; g: 0 | 1; idx: number }[] = [];
  private lamps!: THREE.InstancedMesh;
  private lampState: string[] = [];
  private t = 0;
  private lampAcc = 1;
  private rand = rng(2026);
  private grid = new Map<number, Agent[]>();
  private extras: { x: number; z: number; v: number }[] = [];
  private signalMeshes: THREE.Object3D[] = [];
  private blob!: THREE.InstancedMesh;
  readonly max: number;

  /** 晚上、下雨開車燈（weather.ts 設定） */
  lightsOn = false;
  private carLights!: THREE.InstancedMesh;
  /** 有設定的話，被撞飛的車會停在牆邊，不會滑進建築裡 */
  collider: Collider | null = null;
  private pushOut = [0, 0];
  constructor(scene: THREE.Scene, d: CityData, max: number, private breakables: Breakables | null = null) {
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

    // ---- 號誌路口：35 m 內的號誌節點算同一個路口（格子索引找附近的路口）
    const cgrid = new Map<number, Cluster[]>();
    for (const ni of d.signals) {
      const x = N[ni * 2], z = N[ni * 2 + 1];
      const gk = (Math.floor(x / 35) + 1000) * 4000 + Math.floor(z / 35) + 1000;
      let c: Cluster | undefined;
      for (let i = -1; i <= 1 && !c; i++) for (let j = -1; j <= 1 && !c; j++) c = cgrid.get(gk + i * 4000 + j)?.find((k) => Math.hypot(k.cx - x, k.cz - z) < 35);
      if (!c) {
        c = { cx: x, cz: z, nodes: new Set(), axis: 0, offset: this.rand() * CYCLE_LEN };
        this.clusters.push(c);
        if (!cgrid.has(gk)) cgrid.set(gk, []);
        cgrid.get(gk)!.push(c);
      }
      c.nodes.add(ni);
      this.nodeCluster.set(ni, c);
    }
    // 路口的「主方向」= 進入路口最寬的那條路（車道只掃一次；以前每個路口掃全部車道，大地圖要一秒多）
    const bw = new Map<Cluster, number>();
    for (const e of this.edges) {
      const c = this.nodeCluster.get(e.b);
      if (c && e.way.w > (bw.get(c) ?? -1)) { bw.set(c, e.way.w); c.axis = Math.atan2(e.ux, e.uz); }
    }
    this.buildSignals(scene, d);

    // ---- 車底影子（一個 InstancedMesh 給所有車）
    this.blob = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), bakedShadowMaterial(blobTexture()), this.max);
    this.blob.count = 0;
    this.blob.frustumCulled = false;
    scene.add(this.blob);
    // ---- 車燈：小方塊、不受光照（開了光暈會暈開）
    this.carLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.14, 0.05), new THREE.MeshBasicMaterial({ toneMapped: false }), this.max * 6);
    this.carLights.count = 0;
    this.carLights.frustumCulled = false;
    this.carLights.setColorAt(0, new THREE.Color());
    scene.add(this.carLights);
    // ---- 車輛外型
    const mats = [new THREE.MeshStandardMaterial({ metalness: 0.4, roughness: 0.32 }), new THREE.MeshLambertMaterial({ vertexColors: true })]; // 車身烤漆會反光
    for (let k = 0 as Kind; k < 5; k = (k + 1) as Kind) {
      const g = kindGeometry(k);
      const cap = this.max;
      const paint = new THREE.InstancedMesh(g.paint, mats[0], cap), fixed = new THREE.InstancedMesh(g.fixed, mats[1], cap);
      paint.count = fixed.count = 0;
      paint.userData.dynamic = fixed.userData.dynamic = true; // 投射即時陰影
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
      const key = `${c.cx},${c.cz}:${e.way.nm || e.way.w}:${Math.round(Math.atan2(e.ux, e.uz) * 2)}`;
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
    this.signalMeshes = [pole, arm, housing, this.lamps];
    // 號誌桿也撞得倒：桿、橫桿、燈箱、三顆燈一起倒（以桿子底部為支點）
    if (this.breakables) {
      const p = new THREE.Vector3();
      poles.forEach((m, i) => {
        p.setFromMatrixPosition(m);
        const housingM = new THREE.Matrix4();
        housing.getMatrixAt(i, housingM);
        this.breakables!.addParts(p.x, p.z, 0.2, 0.88, [
          { mesh: pole, idx: i, base: m },
          { mesh: arm, idx: i, base: arms[i] },
          { mesh: housing, idx: i, base: housingM },
          ...[0, 1, 2].map((k) => ({ mesh: this.lamps, idx: i * 3 + k, base: lampM[i * 3 + k] })),
        ]);
      });
    }
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
        kind, color, x, z, h: Math.atan2(e.ux, e.uz), vh: Math.atan2(e.ux, e.uz), inC: null, stunned: 0, kx: 0, kz: 0, kh: 0, kvx: 0, kvz: 0, kw: 0, down: 0, fall: 0, lo: NaN, blockT: 0, honkT: 0, next: null, blink: 0, laneCool: 3, laneBlink: 0, laneSide: 0, alive: true,
      };
      const dead = this.agents.findIndex((q) => !q.alive);
      if (dead >= 0) this.agents[dead] = a; else this.agents.push(a);
      this.place(a);
      a.vh = a.h;
      return true;
    }
    return false;
  }

  /** 路口要往哪走：比較常沿同一條路直走 */
  private choose(a: Agent): DEdge | null {
    const outs = a.e.out;
    if (!outs.length) return null;
    if (outs.length === 1) return outs[0];
    const straight = outs.filter((o) => o.way.nm && o.way.nm === a.e.way.nm);
    return straight.length && this.rand() < 0.65 ? straight[0] : outs[Math.floor(this.rand() * outs.length)];
  }
  /** 目標車道前後 12 m 有沒有車（同一段路上） */
  private laneFree(a: Agent, lane: number) {
    const cx = Math.floor(a.x / 20), cz = Math.floor(a.z / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const b of this.grid.get((cx + i + 1000) * 4000 + cz + j + 1000) || []) {
        if (b !== a && b.alive && b.e === a.e && b.lane === lane && Math.abs(b.s - a.s) < 12) return false;
      }
    }
    return true;
  }

  private laneOff(a: Agent) {
    const e = a.e;
    return e.base + (a.lane + 0.5) * e.laneW - e.laneW / 2 + (a.kind === 3 ? e.laneW * 0.3 : 0);
  }
  private place(a: Agent) {
    const e = a.e;
    if (Number.isNaN(a.lo)) a.lo = this.laneOff(a);
    const off = a.lo;
    a.x = e.ax + e.ux * a.s - e.uz * off;
    a.z = e.az + e.uz * a.s + e.ux * off;
    a.h = Math.atan2(e.ux, e.uz);
  }

  laneChanges = 0; // 測試統計：超車換車道次數
  /** 喇叭聲（給 main 播）：位置與要不要生氣一點（被撞） */
  honks: { x: number; z: number; angry: boolean }[] = [];

  /** 玩家按喇叭：前方 40 m 內同方向的車，多車道的換到旁邊車道讓路，單線道讓不了的回按喇叭；回傳讓路的台數 */
  honk(px: number, pz: number, ph: number): number {
    const fx = Math.sin(ph), fz = Math.cos(ph);
    let yielded = 0;
    for (const a of this.agents) {
      if (!a.alive || a.stunned > 0) continue;
      const dx = a.x - px, dz = a.z - pz, ahead = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
      if (ahead < 2 || ahead > 40 || lat > 4 || Math.cos(a.h - ph) < 0.6) continue;
      if (a.e.lanes > 1 && a.kind !== 2) {
        a.lane = a.lane < a.e.lanes - 1 ? a.lane + 1 : a.lane - 1; // 往外側（或內側）讓
        yielded++;
      } else if (a.honkT <= 0) a.honkT = 0.35 + this.rand() * 0.4;
    }
    return yielded;
  }

  private key(x: number, z: number) { return (Math.floor(x / 20) + 1000) * 4000 + Math.floor(z / 20) + 1000; }

  /** 前方最近的障礙物距離（同方向、橫向 1.8 m 內）與它的速度 */
  private leader(a: Agent, player: { x: number; z: number; v: number }) {
    const fx = Math.sin(a.h), fz = Math.cos(a.h);
    let gap = 80, lv = 0, isPlayer = false;
    const consider = (x: number, z: number, len: number, v: number, w: number, p = false) => {
      const dx = x - a.x, dz = z - a.z, ahead = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
      if (ahead <= 0 || lat > w) return;
      const g = ahead - (KIND_LEN[a.kind] + len) / 2;
      if (g < gap) { gap = g; lv = v; isPlayer = p; }
    };
    const cx = Math.floor(a.x / 20), cz = Math.floor(a.z / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const b of this.grid.get((cx + i + 1000) * 4000 + cz + j + 1000) || []) {
        if (b === a || !b.alive) continue;
        if (Math.cos(b.h - a.h) < 0.3) continue; // 對向或橫向的車不算
        consider(b.x + b.kx, b.z + b.kz, KIND_LEN[b.kind], b.v, a.kind === 3 || b.kind === 3 ? 1.1 : 1.8); // 被撞開的車看它實際在哪
      }
    }
    consider(player.x, player.z, 4.6, Math.max(0, player.v), 2.2, true);
    for (const o of this.extras) consider(o.x, o.z, 4.6, Math.max(0, o.v), 2.0);
    return { gap, lv, isPlayer };
  }

  /**
   * 行人號誌：(x, z) 附近 30 m 內有號誌路口時，沿 (ux, uz) 方向這條路的車是紅燈 → 行人可以過（true）；
   * 沒有號誌路口回傳 null（行人自己看車）
   */
  pedGreen(x: number, z: number, ux: number, uz: number): boolean | null {
    let best: Cluster | null = null, bd = 30;
    for (const c of this.clusters) { const d = Math.hypot(c.cx - x, c.cz - z); if (d < bd) { bd = d; best = c; } }
    if (!best) return null;
    return lightOf(best, groupOf(best, ux, uz), this.t) === 'r';
  }

  /** 闖紅燈判斷用：(x, z) 在號誌路口中心 14 m 內時，回傳這個路口與「沿 (ux, uz) 方向走的這條路」是不是紅燈；不在路口回傳 null */
  signalAt(x: number, z: number, ux: number, uz: number): { id: object; red: boolean } | null {
    let best: Cluster | null = null, bd = 14;
    for (const c of this.clusters) {
      if (Math.abs(c.cx - x) > bd || Math.abs(c.cz - z) > bd) continue;
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    return { id: best, red: lightOf(best, groupOf(best, ux, uz), this.t) === 'r' };
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
      // 被撞出去：照速度在地上滑，輪胎（機車倒地是車身）摩擦讓它停下；撞到牆就停在牆邊
      if (a.kvx || a.kvz || a.kw) {
        a.kx += a.kvx * dt; a.kz += a.kvz * dt; a.kh += a.kw * dt;
        const sp = Math.hypot(a.kvx, a.kvz), dec = a.kind === 3 ? 7 : a.kind === 2 ? 6 : 8.5;
        const k = sp > 1e-3 ? Math.max(0, sp - dec * dt) / sp : 0;
        a.kvx *= k; a.kvz *= k;
        a.kw *= Math.exp(-dt * 2.2);
        if (sp < 0.05 && Math.abs(a.kw) < 0.05) a.kvx = a.kvz = a.kw = 0;
        if (this.collider && this.collider.push(a.x + a.kx, a.z + a.kz, KIND_R[a.kind], this.pushOut)) {
          const [ox, oz] = this.pushOut, ol = Math.hypot(ox, oz) || 1, nx = ox / ol, nz = oz / ol;
          a.kx += ox; a.kz += oz;
          const vn = a.kvx * nx + a.kvz * nz;
          if (vn < 0) { a.kvx -= 1.3 * vn * nx; a.kvz -= 1.3 * vn * nz; a.kw *= 0.5; }
        }
      }
      // 被撞飛的車撞到別台車：照質量交換動量，被撞的那台也跟著滑出去、停下來（連環車禍）
      if (Math.hypot(a.kvx, a.kvz) > 1.5) this.knockOthers(a);
      if (a.honkT > 0) { a.honkT -= dt; if (a.honkT <= 0) this.honks.length < 16 && this.honks.push({ x: a.x + a.kx, z: a.z + a.kz, angry: true }); }
      // 機車倒地：躺著，時間到再扶起來
      if (a.down > 0) a.down -= dt;
      const fallTo = a.down > 0 ? 1 : 0;
      a.fall += (fallTo - a.fall) * Math.min(1, dt * (fallTo ? 9 : 2.5));
      // 停住、滑完之後才慢慢開回車道
      if (a.stunned <= 0 && !a.kvx && !a.kvz && (a.kx || a.kz || a.kh)) {
        const k = Math.exp(-dt * 0.9);
        a.kx *= k; a.kz *= k;
        // 車頭偏轉取最短的轉法回正（被撞到轉好幾圈也不會倒著轉回去）
        a.kh = Math.atan2(Math.sin(a.kh), Math.cos(a.kh)) * k;
        if (Math.abs(a.kx) + Math.abs(a.kz) + Math.abs(a.kh) < 0.01) a.kx = a.kz = a.kh = 0;
      }
      if (a.stunned > 0) { a.stunned -= dt; a.v = 0; continue; }
      let { gap, lv, isPlayer } = this.leader(a, player);
      // 被玩家擋住太久：按喇叭（之後冷卻一下）
      if (isPlayer && a.v < 0.6 && gap < 9) a.blockT += dt; else a.blockT = Math.max(0, a.blockT - dt);
      if (a.blockT > 2.5) { this.honks.length < 16 && this.honks.push({ x: a.x, z: a.z, angry: false }); a.blockT = -5; }
      // 超車：前車太慢、多車道、旁邊車道空著 → 打方向燈換過去（公車不超車）
      a.laneCool -= dt;
      a.laneBlink = Math.max(0, a.laneBlink - dt);
      if (a.laneCool <= 0 && a.kind !== 2 && a.e.lanes > 1 && gap < 25 && lv < a.v0 * 0.55 && a.e.len - a.s > 25) {
        for (const tl of [a.lane - 1, a.lane + 1]) {
          if (tl < 0 || tl >= a.e.lanes || !this.laneFree(a, tl)) continue;
          a.laneSide = tl > a.lane ? -1 : 1; // 車道編號越大越靠右
          a.lane = tl;
          a.laneBlink = 1.6;
          this.laneChanges++;
          a.laneCool = 6 + this.rand() * 4;
          break;
        }
        if (a.laneCool <= 0) a.laneCool = 1.5;
      }
      // 快到路口：先決定往哪走，轉彎就打方向燈
      if (!a.next && a.e.len - a.s < 30) {
        a.next = this.choose(a);
        if (a.next) { const cr = a.e.ux * a.next.uz - a.e.uz * a.next.ux; a.blink = cr < -0.35 ? 1 : cr > 0.35 ? -1 : 0; }
      }
      // 換車道：橫向位置慢慢移到新車道
      const tgt = this.laneOff(a);
      if (!Number.isNaN(a.lo) && Math.abs(tgt - a.lo) > 0.01) a.lo += (tgt - a.lo) * Math.min(1, dt * 1.8);
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
        const next = a.next && a.e.out.includes(a.next) ? a.next : this.choose(a);
        a.next = null;
        a.blink = 0;
        if (!next) { a.alive = false; break; }
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

  /**
   * 玩家的車撞到車流：兩台車照質量交換動量（剛體衝量），被撞的車會被撞出去、旋轉、在地上滑行，
   * 停幾秒再開回車道；機車又輕又不穩，撞得夠大力會倒地。回傳撞擊力道
   */
  collidePlayer(p: FreeCar): number {
    let impact = 0;
    const pr = FreeCar.RADIUS;
    for (const a of this.agents) {
      if (!a.alive || Math.abs(a.x - p.x) > 9 || Math.abs(a.z - p.z) > 9) continue;
      const half = KIND_LEN[a.kind] / 2 - 0.9, ar = KIND_R[a.kind];
      const inv = p.spec.mass / KIND_MASS[a.kind]; // 對方質量倒數 ÷ 玩家的（玩家開越重的車，撞得越遠）
      for (const [px, pz] of p.circles()) for (const ao of [-half, 0, half]) {
        const ax = Math.sin(a.h + a.kh), az = Math.cos(a.h + a.kh);
        const cx = a.x + a.kx, cz = a.z + a.kz;
        const qx = cx + ax * ao, qz = cz + az * ao;
        const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz), r = pr + ar;
        if (d >= r || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d;
        // 第一次被撞：原本沿車道開的速度轉成「被撞出去」的速度，之後就照物理滑
        if (a.v > 0) {
          a.kvx += Math.sin(a.h) * a.v; a.kvz += Math.cos(a.h) * a.v;
          a.v = 0;
        }
        // 接觸點與對方質心的距離，對方接觸點的速度 = 質心速度 + ω × r
        const ptx = qx + nx * ar, ptz = qz + nz * ar, rx = ptx - cx, rz = ptz - cz;
        const ovx = a.kvx + a.kw * rz, ovz = a.kvz - a.kw * rx;
        // 重疊照質量分攤：輕的那個被推比較多
        const share = inv / (1 + inv);
        const hit = p.contact(nx, nz, (r - d) * (1 - share), ptx, ptz, ovx, ovz, 0.3, 0.5, inv);
        impact = Math.max(impact, hit);
        a.kx -= nx * (r - d) * share;
        a.kz -= nz * (r - d) * share;
        // 反作用：玩家吃到 (jx, jz)，對方吃反向 × 質量比，並產生旋轉
        const dvx = -p.jx * inv, dvz = -p.jz * inv;
        a.kvx += dvx; a.kvz += dvz;
        a.kw += (rz * dvx - rx * dvz) / KIND_INERTIA[a.kind];
        const sp = Math.hypot(a.kvx, a.kvz), cap = KNOCK_VMAX[a.kind];
        if (sp > cap) { a.kvx *= cap / sp; a.kvz *= cap / sp; }
        a.kw = Math.max(-3, Math.min(3, a.kw));
        a.stunned = Math.max(a.stunned, KIND_STUN[a.kind]);
        if (a.kind === 3 && Math.hypot(dvx, dvz) > 3) a.down = 4; // 機車被撞倒
        if (Math.hypot(dvx, dvz) > 3 && a.honkT <= 0 && a.kind !== 3) a.honkT = 0.5 + this.rand() * 0.4; // 被撞的駕駛不爽按喇叭
      }
    }
    return impact;
  }

  /** a 正被撞飛：撞到旁邊的車就交換動量（a、b 都當成圓，半徑約半個車寬＋一點） */
  private knockOthers(a: Agent) {
    const ax = a.x + a.kx, az = a.z + a.kz;
    const cx = Math.floor(ax / 20), cz = Math.floor(az / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const b of this.grid.get((cx + i + 1000) * 4000 + cz + j + 1000) || []) {
        if (b === a || !b.alive) continue;
        const bx = b.x + b.kx, bz = b.z + b.kz, dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
        const r = KIND_R[a.kind] + KIND_R[b.kind] + 0.9;
        if (d >= r || d < 1e-3) continue;
        const nx = dx / d, nz = dz / d;
        if (b.v > 0) { b.kvx += Math.sin(b.h) * b.v; b.kvz += Math.cos(b.h) * b.v; b.v = 0; }
        const vn = (a.kvx - b.kvx) * nx + (a.kvz - b.kvz) * nz;
        if (vn >= 0) continue;
        const ma = KIND_MASS[a.kind], mb = KIND_MASS[b.kind], J = (-(1 + 0.25) * vn) / (1 / ma + 1 / mb);
        a.kvx += (J / ma) * nx; a.kvz += (J / ma) * nz;
        b.kvx -= (J / mb) * nx; b.kvz -= (J / mb) * nz;
        const push = (r - d) / 2;
        a.kx += nx * push; a.kz += nz * push; b.kx -= nx * push; b.kz -= nz * push;
        b.stunned = Math.max(b.stunned, KIND_STUN[b.kind]);
        if (b.kind === 3 && J / mb > 3) b.down = 4;
        if (b.honkT <= 0 && b.kind !== 3) b.honkT = 0.4 + this.rand() * 0.5;
      }
    }
  }

  render(dt: number) {
    const counts = [0, 0, 0, 0, 0];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    const fwd = new THREE.Vector3(0, 0, 1), roll = new THREE.Quaternion();
    for (const a of this.agents) {
      if (!a.alive) continue;
      let d = a.h - a.vh;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.vh += d * Math.min(1, dt * 8);
      const i = counts[a.kind]++;
      q.setFromAxisAngle(up, a.vh + a.kh);
      if (a.fall > 0.01) q.multiply(roll.setFromAxisAngle(fwd, a.fall * 1.4)); // 機車倒地：沿車身方向側躺
      m.compose(pos.set(a.x + a.kx, -0.25, a.z + a.kz), q, one);
      const mm = this.meshes[a.kind];
      mm.paint.setMatrixAt(i, m);
      mm.fixed.setMatrixAt(i, m);
      mm.paint.setColorAt(i, a.color);
    }
    let nb = 0;
    const bs = new THREE.Vector3();
    for (const a of this.agents) {
      if (!a.alive) continue;
      const wide = a.kind === 3 ? 0.9 : a.kind === 2 ? 3.2 : 2.4;
      q.setFromAxisAngle(up, a.vh + a.kh);
      m.compose(pos.set(a.x + a.kx, -0.21, a.z + a.kz), q, bs.set(wide, 1, KIND_LEN[a.kind] + 1));
      this.blob.setMatrixAt(nb++, m);
    }
    this.blob.count = nb;
    this.blob.instanceMatrix.needsUpdate = true;
    // 車燈
    let nl = 0;
    {
      const head = new THREE.Color(3, 2.8, 2.3), tail = new THREE.Color(2.4, 0.15, 0.1), amber = new THREE.Color(3, 1.5, 0.1), lm = new THREE.Matrix4(), off = new THREE.Matrix4();
      const blinkOn = (this.t * 2.2) % 1 < 0.5;
      const cap = this.carLights.instanceMatrix.count;
      for (const a of this.agents) {
        if (!a.alive) continue;
        const side = a.laneBlink > 0 ? a.laneSide : a.blink; // 本地 +x = 車子左邊
        if (!this.lightsOn && !(side && blinkOn)) continue;
        if (nl + 6 > cap) break;
        q.setFromAxisAngle(up, a.vh + a.kh);
        m.compose(pos.set(a.x + a.kx, -0.25, a.z + a.kz), q, one);
        const L = KIND_LEN[a.kind] / 2 + 0.03, sides = a.kind === 3 ? [0] : a.kind === 2 ? [-0.9, 0.9] : [-0.6, 0.6], y = a.kind === 2 ? 0.85 : a.kind === 3 ? 0.95 : 0.75;
        if (this.lightsOn) for (const s of sides) {
          lm.multiplyMatrices(m, off.makeTranslation(s, y, L)); this.carLights.setMatrixAt(nl, lm); this.carLights.setColorAt(nl++, head);
          lm.multiplyMatrices(m, off.makeTranslation(s, y + 0.05, -L)); this.carLights.setMatrixAt(nl, lm); this.carLights.setColorAt(nl++, tail);
        }
        if (side && blinkOn) {
          const sx = side * (a.kind === 2 ? 1.2 : a.kind === 3 ? 0.25 : 0.82);
          lm.multiplyMatrices(m, off.makeTranslation(sx, y, L - 0.05)); this.carLights.setMatrixAt(nl, lm); this.carLights.setColorAt(nl++, amber);
          lm.multiplyMatrices(m, off.makeTranslation(sx, y + 0.05, -L + 0.05)); this.carLights.setMatrixAt(nl, lm); this.carLights.setColorAt(nl++, amber);
        }
      }
    }
    this.carLights.count = nl;
    this.carLights.visible = nl > 0;
    if (nl) { this.carLights.instanceMatrix.needsUpdate = true; if (this.carLights.instanceColor) this.carLights.instanceColor.needsUpdate = true; }
    this.meshes.forEach((mm, k) => {
      mm.paint.count = mm.fixed.count = counts[k];
      mm.paint.instanceMatrix.needsUpdate = mm.fixed.instanceMatrix.needsUpdate = true;
      if (mm.paint.instanceColor) mm.paint.instanceColor.needsUpdate = true;
    });
  }

  get count() { return this.agents.filter((a) => a.alive).length; }
  /** 測試用（?phys）：拿一台車改成指定車種、停在原地不動，回傳它 */
  testAgent(kind: Kind): Agent | null {
    const a = this.agents.find((b) => b.alive && b.kind !== 2 && b.stunned <= 0) ?? this.agents.find((b) => b.alive);
    if (!a) return null;
    Object.assign(a, { kind, v: 0, stunned: 6, kx: 0, kz: 0, kh: 0, kvx: 0, kvz: 0, kw: 0, down: 0, fall: 0 });
    return a;
  }
  /** 測試用統計：車數、平均速度、停著的車數、各車種數 */
  stats() {
    const al = this.agents.filter((a) => a.alive);
    const avg = al.reduce((s, a) => s + a.v, 0) / (al.length || 1);
    const kinds = [0, 0, 0, 0, 0];
    al.forEach((a) => kinds[a.kind]++);
    return `${al.length}台 超車${this.laneChanges} 打方向燈${al.filter((a) => a.blink || a.laneBlink > 0).length} 平均${(avg * 3.6).toFixed(0)}km/h 停著${al.filter((a) => a.v < 0.5).length} 種類${kinds.join('/')} 號誌路口${this.clusters.length} 燈${this.heads.length / 3}`;
  }

  /** 街道賽封路：車流不顯示 */
  set visible(v: boolean) { for (const m of this.meshes) m.paint.visible = m.fixed.visible = v; this.blob.visible = v; }
  /** 紅綠燈（街道賽封路時隱藏，橫桿會擋到賽車的視線） */
  set signalsVisible(v: boolean) { for (const m of this.signalMeshes) m.visible = v; }
}
