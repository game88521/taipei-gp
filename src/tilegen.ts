import { Color, ShapeUtils, Vector2 } from 'three';
import { terrainHeight, type Building, type TileData, type Terrain } from './citydata';

// 一個城市區塊的「計算」部分：外牆、屋頂、店面、招牌、地上影子的頂點，頂樓水塔／鐵皮、路邊機車、行道樹的參數、碰撞的牆線。
// 純計算、不碰畫面：在 Web Worker（tileworker.ts）裡跑，主執行緒只拿結果建網格（city.ts）；不支援 Worker 時主執行緒直接呼叫。
// 亂數的取用順序跟搬出來之前完全一樣，同一份資料長得一模一樣

export const TILE = 300; // 小區塊（店面、招牌、地上影子、機車、樹）
export const BIG = TILE * 2; // 大區塊（外牆、屋頂）
const FLOOR = 3.3;
const TILE_U = 8; // 外牆貼圖橫向每 8 m（兩個開間）重複
const TILE_V = FLOOR * 2; // 縱向每兩層重複
export const sizeOf = (kind: string) => (kind === 'shop' || kind === 'sign' || kind === 'shadow' ? TILE : BIG);

/** Worker 一開始收到的固定資料 */
export interface GenInit {
  roads: number[]; // 主要道路線段 [x1, z1, x2, z2, 半寬, ...]（找店面面向哪條路）
  trackX: number[]; trackZ: number[]; // 賽道取樣點（離賽道遠的樹依畫質抽掉一些）
  terrain: Terrain | null;
  q: { rooftops: boolean; treeKeep: number };
  tower: { x: number; z: number }; // 101（塔身另外做，OSM 那根方柱不畫）
  shadow: { x: number; z: number }; // 每公尺高度的影子位移（world.ts SHADOW_PER_M）
}

export interface GenGeo { kind: string; cx: number; cz: number; size: number; pos: Float32Array; nor: Float32Array; uv: Float32Array; col: Float32Array | null }
export interface GenOut {
  geos: GenGeo[];
  specials: { b: Building; x: number; z: number }[]; // 有專屬造型的地標（主執行緒用 buildSpecial 蓋）
  tanks: Float32Array; // [x, y, z, 大小, ...]
  sheds: Float32Array; // [x, y, z, 寬, 深, 角度, 顏色, ...]
  trees: { cx: number; cz: number; d: Float32Array }[]; // 每個小區塊：[x, z, 大小, 轉向, 高度比例, 地形高度, 葉色, ...]
  edges: Float32Array; // 碰撞的牆線 [x1, z1, x2, z2, ...]
  parked: Float32Array; // 路邊機車 [x, z, 車頭方向, 顏色, ...]（原樣轉交）
  bb: [number, number, number, number]; // 牆線與樹的範圍（卸載時用）
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], n: number[], ua: number[], ub: number[], uc: number[], color?: Color) {
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc);
    if (color) for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b);
  }
  /** 每個頂點各自的顏色（牆腳的接地陰影用） */
  tri3(a: number[], b: number[], c: number[], n: number[], ua: number[], ub: number[], uc: number[], ca: Color, cb: Color, cc: Color) {
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
}

const toRing = (p: number[]) => {
  const r: [number, number][] = [];
  for (let k = 0; k < p.length; k += 2) r.push([p[k], p[k + 1]]);
  return r;
};
const signedArea = (r: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
  return a / 2;
};
function flatPoly(geo: Geo, r: [number, number][], y: number, up: boolean, color: Color) {
  const tris = ShapeUtils.triangulateShape(r.map(([x, z]) => new Vector2(x, z)), []);
  const n = up ? [0, 1, 0] : [0, -1, 0];
  for (const [a, b, c] of tris) {
    let [pa, pb, pc] = [r[a], r[b], r[c]];
    const cy = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
    if ((cy < 0) === up) [pb, pc] = [pc, pb];
    geo.tri([pa[0], y, pa[1]], [pb[0], y, pb[1]], [pc[0], y, pc[1]], n, [0, 0], [0, 0], [0, 0], color);
  }
}
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 把固定資料整理成查詢用的格子（Worker 收到 init 時做一次） */
export function makeCtx(init: GenInit) {
  const G = 30, grid = new Map<string, number[]>();
  for (let i = 0; i < init.trackX.length; i++) {
    const k = `${Math.floor(init.trackX[i] / G)},${Math.floor(init.trackZ[i] / G)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  }
  const nearestTrack = (x: number, z: number) => {
    let bd = Infinity;
    const cx = Math.floor(x / G), cz = Math.floor(z / G);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of grid.get(`${cx + a},${cz + b}`) || []) bd = Math.min(bd, (x - init.trackX[i]) ** 2 + (z - init.trackZ[i]) ** 2);
    return Math.sqrt(bd);
  };
  const RG = 30, rgrid = new Map<string, number[][]>();
  const R = init.roads;
  for (let k = 0; k < R.length; k += 5) {
    const s = R.slice(k, k + 5);
    for (let gx = Math.floor(Math.min(s[0], s[2]) / RG); gx <= Math.floor(Math.max(s[0], s[2]) / RG); gx++)
      for (let gz = Math.floor(Math.min(s[1], s[3]) / RG); gz <= Math.floor(Math.max(s[1], s[3]) / RG); gz++) {
        const key = `${gx},${gz}`;
        if (!rgrid.has(key)) rgrid.set(key, []);
        rgrid.get(key)!.push(s);
      }
  }
  /** 最近的主要道路：路面邊緣的距離、道路方向、最近點 */
  const nearestRoad = (x: number, z: number) => {
    let best: { edge: number; ux: number; uz: number; px: number; pz: number } | null = null;
    const cx = Math.floor(x / RG), cz = Math.floor(z / RG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const [x1, z1, x2, z2, hw] of rgrid.get(`${cx + a},${cz + b}`) || []) {
        const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (l * l)));
        const px = x1 + dx * t, pz = z1 + dz * t, edge = Math.hypot(x - px, z - pz) - hw;
        if (!best || edge < best.edge) best = { edge, ux: dx / l, uz: dz / l, px, pz };
      }
    }
    return best;
  };
  return { init, nearestTrack, nearestRoad };
}
export type GenCtx = ReturnType<typeof makeCtx>;

const resTint = ['#e8e1d5', '#d9d0c3', '#cfc8bd', '#e3d6c8', '#c9cdd1', '#d8cbbd', '#bfb7aa', '#e6d9cf'].map((c) => new Color(c));
const roofCol = [new Color('#8b8883'), new Color('#7d8288'), new Color('#96918a')];
const white = new Color('#ffffff'), civic = new Color('#ddd7cc');
const LEAVES = 5;

/** 算一個區塊（tag = 區塊編號，決定亂數種子） */
export function genTile(td: TileData, tag: number, ctx: GenCtx): GenOut {
  const { q, tower, shadow, terrain } = ctx.init;
  const r = rng(101 + tag * 7919); // 每個區塊各自的亂數：卸掉再載入長得一樣
  const tiles = new Map<string, Geo>();
  const tileGeo = (kind: string, x: number, z: number) => {
    const S = sizeOf(kind);
    const key = `${kind}|${Math.floor(x / S)},${Math.floor(z / S)}`;
    let g = tiles.get(key);
    if (!g) tiles.set(key, (g = new Geo()));
    return g;
  };
  const tanks: number[] = [], sheds: number[] = [], specials: GenOut['specials'] = [];
  const roofDetails = (ring: [number, number][], y: number) => {
    const A = Math.abs(signedArea(ring));
    if (A < 80) return;
    let cx = 0, cz = 0;
    for (const p of ring) { cx += p[0]; cz += p[1]; }
    cx /= ring.length; cz /= ring.length;
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i], [xj, zj] = ring[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    const span = Math.sqrt(A) * 0.3;
    const n = A > 300 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * span, z = cz + (r() - 0.5) * span;
      if (inside(x, z)) tanks.push(x, y, z, 0.9 + r() * 0.5);
    }
    if (r() < 0.35) {
      // 鐵皮加蓋：大約占屋頂中間的一塊，順著最長的牆
      let bi = 0, bl = 0;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length, l = Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]);
        if (l > bl) { bl = l; bi = i; }
      }
      const j = (bi + 1) % ring.length;
      const ang = Math.atan2(ring[j][0] - ring[bi][0], ring[j][1] - ring[bi][1]);
      const w = Math.min(bl * 0.5, 9), d = Math.min(Math.sqrt(A) * 0.45, 7);
      if (inside(cx, cz)) sheds.push(cx, y, cz, w, d, ang, Math.floor(r() * 4));
    }
  };
  for (const b of td.buildings) {
    // 101 塔身：OSM 只有一根方柱，改用手工的竹節造型（裙樓購物中心照 OSM）
    if (b.h > 100) {
      let cx = 0, cz = 0;
      for (let k = 0; k < b.p.length; k += 2) { cx += b.p[k]; cz += b.p[k + 1]; }
      cx /= b.p.length / 2; cz /= b.p.length / 2;
      if (Math.hypot(cx - tower.x, cz - tower.z) < 40) continue;
    }
    let ring = toRing(b.p);
    if (signedArea(ring) > 0) ring = ring.reverse(); // 讓牆面法線朝外
    const y0 = b.m ?? -0.6, y1 = b.h; // 落地的樓從地面（-0.6）長起
    const tint = b.c ? new Color(b.c) : b.s === 1 ? white : b.s === 3 ? civic : resTint[Math.floor(r() * resTint.length)];
    if (b.c && b.s === 1) tint.lerp(white, 0.5); // 玻璃帷幕不要染太重
    const style = b.s === 2 ? 0 : b.s;
    // 外牆變化：公寓 3 款、玻璃帷幕 2 款，同一區不會整片長一樣
    const variant = style === 0 ? Math.floor(r() * 3) : style === 1 ? Math.floor(r() * 2) : 0;
    const geo = tileGeo(`f${style}${variant}`, ring[0][0], ring[0][1]);
    const roofs = tileGeo('roof', ring[0][0], ring[0][1]);
    const shopsGeo = tileGeo('shop', ring[0][0], ring[0][1]), signsGeo = tileGeo('sign', ring[0][0], ring[0][1]);
    if (q.rooftops && style === 0 && y0 < 0 && y1 < 45 && !b.k) roofDetails(ring, y1);
    const aoTint = tint.clone().multiplyScalar(0.5);
    // 預先算好的地面影子：腳印＋沿太陽反方向推出去的腳印，取凸包（高度最多算 80 m，免得 101 的影子拖到 1.5 km 外）
    if (y0 < 0 && y1 > 3) {
      const L = Math.min(y1, 80), ox = shadow.x * L, oz = shadow.z * L;
      const hull = convexHull([...ring, ...ring.map(([x, z]) => [x + ox, z + oz] as [number, number])]);
      const sg = tileGeo('shadow', ring[0][0], ring[0][1]);
      for (let k = 1; k + 1 < hull.length; k++) {
        const A = hull[0], B = hull[k], C = hull[k + 1];
        const cy = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]); // 讓三角形正面朝上
        const [P, Q] = cy < 0 ? [C, B] : [B, C];
        sg.tri([A[0], 0.03, A[1]], [P[0], 0.03, P[1]], [Q[0], 0.03, Q[1]], [0, 1, 0], [0, 0], [0, 0], [0, 0]);
      }
    }
    // 有專屬造型的地標：影子照外框算（上面），模型由主執行緒蓋
    if (b.k) { specials.push({ b, x: ring[0][0], z: ring[0][1] }); continue; }
    let u = 0;
    const streetLevel = y0 < 0 && (b.s === 0 || b.s === 2) && y1 < 70;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      const n = [-dz / l, 0, dx / l];
      const u0 = u / TILE_U, u1 = (u + l) / TILE_U;
      // 接地陰影：落地的牆最下面 3 m 由暗到亮（像環境光遮蔽），之上照常
      const band = y0 < 0 && y1 - y0 > 4 ? y0 + 3.4 : y0;
      if (band > y0) {
        const v0 = y0 / TILE_V, vb = band / TILE_V;
        geo.tri3([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], band, c[1]], n, [u0, v0], [u1, v0], [u1, vb], aoTint, aoTint, tint);
        geo.tri3([a[0], y0, a[1]], [c[0], band, c[1]], [a[0], band, a[1]], n, [u0, v0], [u1, vb], [u0, vb], aoTint, tint, tint);
      }
      geo.tri([a[0], band, a[1]], [c[0], band, c[1]], [c[0], y1, c[1]], n, [u0, band / TILE_V], [u1, band / TILE_V], [u1, y1 / TILE_V], tint);
      geo.tri([a[0], band, a[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], n, [u0, band / TILE_V], [u1, y1 / TILE_V], [u0, y1 / TILE_V], tint);
      u += l;

      // 面向主要道路的騎樓店面與直式招牌（整個城市的大馬路兩側都有）
      if (!streetLevel || l < 5) continue;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const rd = ctx.nearestRoad(mx, mz);
      if (!rd || rd.edge > 14) continue;
      const toT = [rd.px - mx, rd.pz - mz], tl = Math.hypot(toT[0], toT[1]) || 1;
      if ((n[0] * toT[0] + n[2] * toT[1]) / tl < 0.5) continue;
      const o = 0.06, sh = Math.min(4.4, y1 - 0.5);
      const A = [a[0] + n[0] * o, a[1] + n[2] * o], C = [c[0] + n[0] * o, c[1] + n[2] * o];
      const su0 = (u - l) / 7, su1 = u / 7; // 每 7 m 一間店
      shopsGeo.tri([A[0], -0.25, A[1]], [C[0], -0.25, C[1]], [C[0], sh, C[1]], n, [su0 / 6, 0], [su1 / 6, 0], [su1 / 6, 1]);
      shopsGeo.tri([A[0], -0.25, A[1]], [C[0], sh, C[1]], [A[0], sh, A[1]], n, [su0 / 6, 0], [su1 / 6, 1], [su0 / 6, 1]);
      if (y1 > 10 && l > 7 && r() < 0.55) {
        const f = 0.2 + r() * 0.6, sx = a[0] + dx * f + n[0] * 1.1, sz = a[1] + dz * f + n[2] * 1.1;
        const hgt = Math.min(7, y1 - 5), yc = 5 + hgt / 2 + r() * Math.max(0, y1 - 12 - hgt) * 0.3;
        // 招牌垂直於騎樓、面向道路其中一個方向（雙面材質，兩邊來的車都看得到）
        const flip = r() < 0.5 ? 1 : -1;
        const slot = Math.floor(r() * 8), fx = rd.ux * flip, fz = rd.uz * flip;
        const px = fz * 0.9, pz = -fx * 0.9; // 招牌寬度方向（從迎面看過去由左到右）
        const nn = [fx, 0, fz];
        const p1 = [sx - px, yc - hgt / 2, sz - pz], p2 = [sx + px, yc - hgt / 2, sz + pz], p3 = [sx + px, yc + hgt / 2, sz + pz], p4 = [sx - px, yc + hgt / 2, sz - pz];
        signsGeo.tri(p1, p2, p3, nn, [slot / 8, 0], [(slot + 1) / 8, 0], [(slot + 1) / 8, 1]);
        signsGeo.tri(p1, p3, p4, nn, [slot / 8, 0], [(slot + 1) / 8, 1], [slot / 8, 1]);
      }
    }
    try {
      flatPoly(roofs, ring, y1, true, roofCol[Math.floor(r() * roofCol.length)]);
      if (y0 > 3) flatPoly(roofs, ring, y0, false, roofCol[0]); // 懸空的部件（101 的竹節）要有底面
    } catch { /* 畸形多邊形就不加屋頂 */ }
  }
  const geos: GenGeo[] = [];
  for (const [key, g] of tiles) {
    if (!g.pos.length) continue;
    const kind = key.split('|')[0], [tx, tz] = key.split('|')[1].split(',').map(Number), S = sizeOf(kind);
    geos.push({ kind, cx: (tx + 0.5) * S, cz: (tz + 0.5) * S, size: S, pos: new Float32Array(g.pos), nor: new Float32Array(g.nor), uv: new Float32Array(g.uv), col: g.col.length ? new Float32Array(g.col) : null });
  }

  // 碰撞：落地的建築外牆（懸空的部件不擋車）
  const edges: number[] = [];
  const bb: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of td.buildings) {
    if ((b.m ?? 0) > 2) continue;
    const p = b.p, n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push(p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]);
      bb[0] = Math.min(bb[0], p[i * 2]); bb[1] = Math.min(bb[1], p[i * 2 + 1]); bb[2] = Math.max(bb[2], p[i * 2]); bb[3] = Math.max(bb[3], p[i * 2 + 1]);
    }
  }

  // 行道樹：依小區塊分組；離賽道遠的依畫質抽掉一些
  const tr = td.trees;
  const byTile = new Map<string, number[]>();
  for (let k = 0; k < tr.length; k += 2) {
    const d = ctx.nearestTrack(tr[k], tr[k + 1]);
    if (d >= 90 && r() > q.treeKeep) continue;
    const key = `${Math.floor(tr[k] / TILE)},${Math.floor(tr[k + 1] / TILE)}`;
    let list = byTile.get(key);
    if (!list) byTile.set(key, (list = []));
    list.push(tr[k], tr[k + 1]);
    bb[0] = Math.min(bb[0], tr[k]); bb[1] = Math.min(bb[1], tr[k + 1]); bb[2] = Math.max(bb[2], tr[k]); bb[3] = Math.max(bb[3], tr[k + 1]);
  }
  const trees: GenOut['trees'] = [];
  for (const pts of byTile.values()) {
    const out = new Float32Array((pts.length / 2) * 7);
    for (let n = 0; n < pts.length / 2; n++) {
      const x = pts[n * 2], z = pts[n * 2 + 1];
      const k = 0.75 + r() * 0.6, rot = r() * Math.PI * 2, sy = 0.9 + r() * 0.3;
      out.set([x, z, k, rot, sy, terrainHeight(terrain, x, z), Math.floor(r() * LEAVES)], n * 7);
    }
    trees.push({ cx: (Math.floor(pts[0] / TILE) + 0.5) * TILE, cz: (Math.floor(pts[1] / TILE) + 0.5) * TILE, d: out });
  }
  return { geos, specials, tanks: new Float32Array(tanks), sheds: new Float32Array(sheds), trees, edges: new Float32Array(edges), parked: new Float32Array(td.parked), bb };
}

/** postMessage 時直接轉移（不複製）的陣列 */
export function transferables(o: GenOut): ArrayBuffer[] {
  const t: ArrayBuffer[] = [o.tanks.buffer as ArrayBuffer, o.sheds.buffer as ArrayBuffer, o.edges.buffer as ArrayBuffer, o.parked.buffer as ArrayBuffer];
  for (const g of o.geos) { t.push(g.pos.buffer as ArrayBuffer, g.nor.buffer as ArrayBuffer, g.uv.buffer as ArrayBuffer); if (g.col) t.push(g.col.buffer as ArrayBuffer); }
  for (const tr of o.trees) t.push(tr.d.buffer as ArrayBuffer);
  return t;
}
