import { Grid, groundH, type CityData } from './citydata';

interface RoadEdge { a: number; b: number; forward: boolean; backward: boolean; length: number; factor: number }
interface RoadSnap { edge: RoadEdge; t: number; x: number; z: number; y: number }

// 導航：照真實路網（含單行方向）找最短路線，路口轉角平滑成弧線。
// 高架、隧道也在路網裡（長途比較常走高架）；起點、終點吸附節點時比高度：在橋上就從橋上出發

export class Router {
  private N: number[];
  private Y: number[];
  private adj = new Map<number, [number, number][]>();
  private grid = new Grid<number>(40);
  private tmp: number[] = [];
  private junctionNodes = new Set<number>();
  private edges = new Grid<RoadEdge>(80);

  constructor(d: CityData) {
    this.N = d.net.nodes;
    this.Y = d.net.y ?? [];
    const N = this.N;
    const snap = new Set<number>();
    const neighbors = new Map<number, Set<number>>();
    const candidates: RoadEdge[] = [];
    for (const w of [...d.net.ways, ...(d.net.decks ?? [])]) {
      if (w.c > 3) continue;
      for (let k = 0; k + 1 < w.n.length; k++) {
        const a = w.n[k], b = w.n[k + 1], l = Math.hypot(N[b * 2] - N[a * 2], N[b * 2 + 1] - N[a * 2 + 1]);
        if (!w.e) for (const [u, v] of [[a, b], [b, a]]) {
          let ns = neighbors.get(u); if (!ns) neighbors.set(u, (ns = new Set())); ns.add(v);
        }
        // 巷弄成本加重：導航偏好大馬路；高架、隧道（沒有紅綠燈）再便宜一點
        const cost = l * (w.e ? 0.75 : w.c >= 3 ? 1.6 : 1);
        const add = (u: number, v: number) => { let list = this.adj.get(u); if (!list) this.adj.set(u, (list = [])); list.push([v, cost]); };
        if (w.o !== -1) add(a, b);
        if (w.o !== 1) add(b, a);
        if (w.c <= 2) { snap.add(a); snap.add(b); }
        if (w.c <= 2 && l > 0) candidates.push({ a, b, forward: w.o !== -1, backward: w.o !== 1, length: l, factor: w.e ? 0.75 : 1 });
      }
    }
    for (const [n, ns] of neighbors) if (ns.size >= 3) this.junctionNodes.add(n);
    // 只吸附到「主路網」上：從市中心開得到、也開得回市中心的節點（單行道算進去）。
    // 地圖邊緣被切斷的路段、單向進不去的死巷不收，否則起點或終點落在那裡就找不到路線
    const reach = (start: number, back: boolean) => {
      const rev = new Map<number, number[]>();
      if (back) for (const [u, list] of this.adj) for (const [v] of list) { let r = rev.get(v); if (!r) rev.set(v, (r = [])); r.push(u); }
      const seen = new Set<number>([start]), stack = [start];
      while (stack.length) {
        const u = stack.pop()!;
        const next = back ? rev.get(u) || [] : (this.adj.get(u) || []).map((e) => e[0]);
        for (const v of next) if (!seen.has(v)) { seen.add(v); stack.push(v); }
      }
      return seen;
    };
    let hub = -1, hd = Infinity;
    for (const n of snap) { const d = N[n * 2] ** 2 + N[n * 2 + 1] ** 2; if (d < hd) { hd = d; hub = n; } }
    const fwd = hub >= 0 ? reach(hub, false) : new Set<number>(), bwd = hub >= 0 ? reach(hub, true) : new Set<number>();
    for (const n of snap) if (fwd.has(n) && bwd.has(n)) this.grid.addBox(N[n * 2], N[n * 2 + 1], N[n * 2], N[n * 2 + 1], n);
    for (const e of candidates) if (fwd.has(e.a) && bwd.has(e.a) && fwd.has(e.b) && bwd.has(e.b)) {
      this.edges.addBox(Math.min(N[e.a * 2], N[e.b * 2]), Math.min(N[e.a * 2 + 1], N[e.b * 2 + 1]), Math.max(N[e.a * 2], N[e.b * 2]), Math.max(N[e.a * 2 + 1], N[e.b * 2 + 1]), e);
    }
  }

  /** 吸附線段而非端點；長道路中段也能接上正確方向和路層。 */
  private project(x: number, z: number, y?: number): RoadSnap | null {
    const yy = y ?? groundH(x, z), N = this.N;
    let best: RoadSnap | null = null, bd = Infinity;
    for (const r of [60, 150, 400]) {
      for (const e of this.edges.query(x, z, r)) {
        const ax = N[e.a * 2], az = N[e.a * 2 + 1], dx = N[e.b * 2] - ax, dz = N[e.b * 2 + 1] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (e.length * e.length)));
        const px = ax + dx * t, pz = az + dz * t, py = (this.Y[e.a] ?? 0) * (1 - t) + (this.Y[e.b] ?? 0) * t;
        const d = (px - x) ** 2 + (pz - z) ** 2 + ((py - yy) * 8) ** 2;
        if (d < bd) { bd = d; best = { edge: e, t, x: px, z: pz, y: py }; }
      }
      if (best && bd < r * r) return best;
    }
    return best;
  }

  /** 最近的主要道路節點；y = 現在的高度（沒給就當在地面）：高度差 1 m 算 8 m 遠，橋上、橋下不會吸錯層 */
  nearest(x: number, z: number, y?: number): number {
    const N = this.N, Y = this.Y, yy = y ?? groundH(x, z);
    for (const r of [60, 150, 400]) {
      let best = -1, bd = Infinity;
      for (const n of this.grid.query(x, z, r, this.tmp)) {
        const d = (N[n * 2] - x) ** 2 + (N[n * 2 + 1] - z) ** 2 + (((Y[n] ?? 0) - yy) * 8) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** 從 (x0, z0) 到 (x1, z1) 的路線（平滑後的點列、每點的路面高度）與長度；找不到回傳 null。y0、y1 = 起訖的高度（沒給 = 地面） */
  route(x0: number, z0: number, x1: number, z1: number, y0?: number, y1?: number): { path: [number, number][]; ys: number[]; length: number; junctions: number } | null {
    const start = this.project(x0, z0, y0), end = this.project(x1, z1, y1);
    if (!start || !end) return null;
    const from = -1, to = -2;
    const startLinks: [number, number][] = [], endLinks = new Map<number, number>();
    const se = start.edge, ee = end.edge;
    if (se.backward || start.t < 1e-9) startLinks.push([se.a, start.t * se.length * se.factor]);
    if (se.forward || start.t > 1 - 1e-9) startLinks.push([se.b, (1 - start.t) * se.length * se.factor]);
    if (ee.forward || end.t < 1e-9) endLinks.set(ee.a, end.t * ee.length * ee.factor);
    if (ee.backward || end.t > 1 - 1e-9) endLinks.set(ee.b, (1 - end.t) * ee.length * ee.factor);
    if (se === ee && ((end.t >= start.t && se.forward) || (end.t <= start.t && se.backward))) startLinks.push([to, Math.abs(end.t - start.t) * se.length * se.factor]);
    // Dijkstra（二元堆積）
    const dist = new Map<number, number>([[from, 0]]), prev = new Map<number, number>();
    const heap: [number, number][] = [[0, from]];
    const push = (e: [number, number]) => {
      heap.push(e);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > (dist.get(u) ?? Infinity)) continue;
      if (u === to) break;
      const links = u === from ? startLinks : [...(this.adj.get(u) || [])];
      if (endLinks.has(u)) links.push([to, endLinks.get(u)!]);
      for (const [v, c] of links) {
        const nd = d + c;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); push([nd, v]); }
      }
    }
    if (!dist.has(to)) return null;
    const ids = [to];
    while (ids[0] !== from) ids.unshift(prev.get(ids[0])!);
    const N = this.N;
    let path: [number, number][] = [[start.x, start.z]], ys = [start.y];
    for (const n of ids.slice(1, -1)) {
      const p: [number, number] = [N[n * 2], N[n * 2 + 1]];
      if (Math.hypot(p[0] - path[path.length - 1][0], p[1] - path[path.length - 1][1]) > 0.001) { path.push(p); ys.push(this.Y[n] ?? 0); }
    }
    if (Math.hypot(end.x - path[path.length - 1][0], end.z - path[path.length - 1][1]) > 0.001) { path.push([end.x, end.z]); ys.push(end.y); }
    for (let it = 0; it < 2 && path.length > 2; it++) {
      const out: [number, number][] = [path[0]], oy = [ys[0]];
      for (let i = 0; i + 1 < path.length; i++) {
        const [a, b] = [path[i], path[i + 1]];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        oy.push(ys[i] * 0.75 + ys[i + 1] * 0.25, ys[i] * 0.25 + ys[i + 1] * 0.75);
      }
      out.push(path[path.length - 1]);
      oy.push(ys[ys.length - 1]);
      path = out;
      ys = oy;
    }
    let length = 0;
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const junctions = ids.slice(1, -1).filter((n) => this.junctionNodes.has(n)).length;
    return { path, ys, length, junctions };
  }
}
