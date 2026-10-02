import { Grid, type CityData } from './citydata';

// 導航：照真實路網（含單行方向）找最短路線，路口轉角平滑成弧線

export class Router {
  private N: number[];
  private adj = new Map<number, [number, number][]>();
  private grid = new Grid<number>(40);
  private tmp: number[] = [];

  constructor(d: CityData) {
    this.N = d.net.nodes;
    const N = this.N;
    const snap = new Set<number>();
    for (const w of d.net.ways) {
      if (w.c > 3) continue;
      for (let k = 0; k + 1 < w.n.length; k++) {
        const a = w.n[k], b = w.n[k + 1], l = Math.hypot(N[b * 2] - N[a * 2], N[b * 2 + 1] - N[a * 2 + 1]);
        // 巷弄成本加重：導航偏好大馬路
        const cost = l * (w.c >= 3 ? 1.6 : 1);
        const add = (u: number, v: number) => { let list = this.adj.get(u); if (!list) this.adj.set(u, (list = [])); list.push([v, cost]); };
        if (w.o !== -1) add(a, b);
        if (w.o !== 1) add(b, a);
        if (w.c <= 2) { snap.add(a); snap.add(b); }
      }
    }
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
  }

  /** 最近的主要道路節點 */
  nearest(x: number, z: number): number {
    const N = this.N;
    for (const r of [60, 150, 400]) {
      let best = -1, bd = Infinity;
      for (const n of this.grid.query(x, z, r, this.tmp)) {
        const d = (N[n * 2] - x) ** 2 + (N[n * 2 + 1] - z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** 從 (x0, z0) 到 (x1, z1) 的路線（平滑後的點列）與長度；找不到回傳 null */
  route(x0: number, z0: number, x1: number, z1: number): { path: [number, number][]; length: number } | null {
    const from = this.nearest(x0, z0), to = this.nearest(x1, z1);
    if (from < 0 || to < 0) return null;
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
      for (const [v, c] of this.adj.get(u) || []) {
        const nd = d + c;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); push([nd, v]); }
      }
    }
    if (!dist.has(to)) return null;
    const ids = [to];
    while (ids[0] !== from) ids.unshift(prev.get(ids[0])!);
    const N = this.N;
    let path: [number, number][] = ids.map((n) => [N[n * 2], N[n * 2 + 1]]);
    for (let it = 0; it < 2 && path.length > 2; it++) {
      const out: [number, number][] = [path[0]];
      for (let i = 0; i + 1 < path.length; i++) {
        const [a, b] = [path[i], path[i + 1]];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(path[path.length - 1]);
      path = out;
    }
    let length = 0;
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    return { path, length };
  }
}
