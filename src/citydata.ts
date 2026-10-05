// city.json 的型別與共用查詢（路網、最近道路、碰撞）

export interface Building { p: number[]; h: number; m?: number; s: number; c?: string; n?: string; k?: string /* 特殊地標造型（landmarks3d.ts） */ }
export interface NetWay {
  n: number[]; // 節點編號
  w: number; // 路寬 (m)
  c: number; // 等級：0 幹道 1 次要 2 一般 3 巷弄 4 服務道路
  o?: 1 | -1; // 單行：1 = 沿節點順序，-1 = 反向
  l?: number; // 車道數
  nm?: string;
  en?: string;
}
export interface StreetSign { x: number; z: number; b: { nm: string; en: string; a: number }[] }
export interface CityData {
  attribution: string;
  buildings: Building[];
  roads: { p: number[]; w: number }[];
  greens: { p: number[]; k: number }[];
  trees: number[];
  net: { nodes: number[]; ways: NetWay[] };
  signals: number[];
  crossings: number[];
  signs: StreetSign[];
  places: Place[];
  lamps?: number[]; // [x, z, 燈臂方向, ...]
  parked?: number[]; // [x, z, 車頭方向, 顏色, ...]
  terrain?: Terrain | null; // 象山一帶的山
  trails?: { p: number[]; s: number }[]; // 山上的登山步道（s = 1 石階）
  rocks?: number[]; // 六巨石的位置
}
export interface Terrain { x0: number; z0: number; step: number; nx: number; nz: number; h: number[] }

/** 地形高度（雙線性內插）；範圍外是 0 */
export function terrainHeight(t: Terrain | null | undefined, x: number, z: number): number {
  if (!t) return 0;
  const fx = (x - t.x0) / t.step, fz = (z - t.z0) / t.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return 0;
  const a = fx - i, b = fz - j, H = t.h, n = t.nx;
  return (H[j * n + i] * (1 - a) + H[j * n + i + 1] * a) * (1 - b) + (H[(j + 1) * n + i] * (1 - a) + H[(j + 1) * n + i + 1] * a) * b;
}
export interface Place { nm: string; x: number; z: number; r: number; h: number; e: [number, number, number, number] }

/** 格狀空間索引：線段與圓 */
export class Grid<T> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}
  private key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }
  addBox(x0: number, z0: number, x1: number, z1: number, item: T) {
    const s = this.size;
    for (let cx = Math.floor(Math.min(x0, x1) / s); cx <= Math.floor(Math.max(x0, x1) / s); cx++)
      for (let cz = Math.floor(Math.min(z0, z1) / s); cz <= Math.floor(Math.max(z0, z1) / s); cz++) {
        const k = this.key(cx, cz);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(item);
      }
  }
  query(x: number, z: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    const s = this.size;
    for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++)
      for (let cz = Math.floor((z - r) / s); cz <= Math.floor((z + r) / s); cz++) {
        const c = this.cells.get(this.key(cx, cz));
        if (c) for (const it of c) out.push(it);
      }
    return out;
  }
}

export interface Seg { x1: number; z1: number; x2: number; z2: number; way: NetWay }

/** 路網工具：最近道路、節點座標 */
export class RoadNet {
  nodes: number[];
  ways: NetWay[];
  segGrid = new Grid<Seg>(25);
  constructor(d: CityData) {
    this.nodes = d.net.nodes;
    this.ways = d.net.ways;
    for (const w of this.ways) {
      for (let k = 0; k + 1 < w.n.length; k++) {
        const a = w.n[k], b = w.n[k + 1];
        const s: Seg = { x1: this.nodes[a * 2], z1: this.nodes[a * 2 + 1], x2: this.nodes[b * 2], z2: this.nodes[b * 2 + 1], way: w };
        this.segGrid.addBox(s.x1, s.z1, s.x2, s.z2, s);
      }
    }
  }
  private tmp: Seg[] = [];
  /** 最近的「有名字」道路（給 HUD 顯示路名） */
  nearestNamed(x: number, z: number, maxD = 30): NetWay | null {
    let best: NetWay | null = null, bd = maxD;
    for (const s of this.segGrid.query(x, z, maxD, this.tmp)) {
      if (!s.way.nm) continue;
      const d = distSeg(x, z, s.x1, s.z1, s.x2, s.z2) - s.way.w / 2;
      if (d < bd) { bd = d; best = s.way; }
    }
    return best;
  }
}

export function distSeg(x: number, z: number, x1: number, z1: number, x2: number, z2: number) {
  const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2));
  return Math.hypot(x - x1 - dx * t, z - z1 - dz * t);
}

interface Edge { x1: number; z1: number; x2: number; z2: number }
interface Post { x: number; z: number; r: number }

/** 靜態碰撞：建築外牆（落地的）＋ 樹幹 */
export class Collider {
  private edges = new Grid<Edge>(16);
  private posts = new Grid<Post>(16);
  private te: Edge[] = [];
  private tp: Post[] = [];
  private terrain: Terrain | null;
  constructor(d: CityData) {
    this.terrain = d.terrain ?? null;
    for (const b of d.buildings) {
      if ((b.m ?? 0) > 2) continue; // 懸空的部件不擋車
      const p = b.p, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const e = { x1: p[i * 2], z1: p[i * 2 + 1], x2: p[j * 2], z2: p[j * 2 + 1] };
        this.edges.addBox(e.x1, e.z1, e.x2, e.z2, e);
      }
    }
    // 行道樹、路燈不在這裡：它們會被撞倒（breakables.ts），不是固定的障礙物
  }
  addPost(x: number, z: number, r: number) { this.posts.addBox(x, z, x, z, { x, z, r }); }
  /** 軸對齊的方塊建築（地圖外圍的遠景城市） */
  addRect(cx: number, cz: number, w: number, d: number) {
    const a = cx - w / 2, b = cz - d / 2, c = cx + w / 2, e = cz + d / 2;
    for (const [x1, z1, x2, z2] of [[a, b, c, b], [c, b, c, e], [c, e, a, e], [a, e, a, b]]) this.edges.addBox(x1, z1, x2, z2, { x1, z1, x2, z2 });
  }

  /** 圓碰到的每一個接觸：法向量（從牆指向圓心）與重疊深度；給剛體逐一施加衝量用 */
  contacts(x: number, z: number, r: number, out: { nx: number; nz: number; depth: number }[]) {
    out.length = 0;
    for (const e of this.edges.query(x, z, r, this.te)) {
      const dx = e.x2 - e.x1, dz = e.z2 - e.z1, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - e.x1) * dx + (z - e.z1) * dz) / l2));
      const ox = x - e.x1 - dx * t, oz = z - e.z1 - dz * t, d = Math.hypot(ox, oz);
      if (d < r && d > 1e-4) out.push({ nx: ox / d, nz: oz / d, depth: r - d });
    }
    for (const p of this.posts.query(x, z, r + 0.5, this.tp)) {
      const ox = x - p.x, oz = z - p.z, d = Math.hypot(ox, oz), rr = r + p.r;
      if (d < rr && d > 1e-4) out.push({ nx: ox / d, nz: oz / d, depth: rr - d });
    }
    // 山坡：太陡（離地超過 1.2 m）就當成牆，從往下坡的方向推回來
    if (this.terrain) {
      const h0 = terrainHeight(this.terrain, x, z);
      if (h0 > 1.2) {
        const gx = terrainHeight(this.terrain, x + 2, z) - terrainHeight(this.terrain, x - 2, z);
        const gz = terrainHeight(this.terrain, x, z + 2) - terrainHeight(this.terrain, x, z - 2);
        const gl = Math.hypot(gx, gz) || 1;
        out.push({ nx: -gx / gl, nz: -gz / gl, depth: Math.min(0.5, (h0 - 1.2) * 0.2) });
      }
    }
    // 同一面牆被兩條相鄰的邊各算一次時，只留最深的那個（避免推兩倍）
    if (out.length > 1) {
      out.sort((a, b) => b.depth - a.depth);
      const kept: typeof out = [];
      for (const c of out) if (!kept.some((k) => k.nx * c.nx + k.nz * c.nz > 0.95)) kept.push(c);
      out.length = 0;
      out.push(...kept);
    }
    return out;
  }

  /** 圓與牆面／柱子重疊時，回傳要推開的量（out[0], out[1]）與是否有碰到 */
  push(x: number, z: number, r: number, out: number[]): boolean {
    out[0] = 0; out[1] = 0;
    let hit = false;
    for (const e of this.edges.query(x, z, r, this.te)) {
      const dx = e.x2 - e.x1, dz = e.z2 - e.z1, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - e.x1) * dx + (z - e.z1) * dz) / l2));
      const px = e.x1 + dx * t, pz = e.z1 + dz * t;
      const ox = x - px, oz = z - pz, d = Math.hypot(ox, oz);
      if (d < r && d > 1e-4) { out[0] += (ox / d) * (r - d); out[1] += (oz / d) * (r - d); hit = true; }
    }
    for (const p of this.posts.query(x, z, r + 0.5, this.tp)) {
      const ox = x - p.x, oz = z - p.z, d = Math.hypot(ox, oz), rr = r + p.r;
      if (d < rr && d > 1e-4) { out[0] += (ox / d) * (rr - d); out[1] += (oz / d) * (rr - d); hit = true; }
    }
    return hit;
  }
}
