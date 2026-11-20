import type { CityData } from './citydata';
export type NavigationPreference = 'legacy' | 'shortest' | 'few-turns' | 'avoid-elevated';
export const NAVIGATION_LABELS: Record<NavigationPreference, string> = { legacy: '原版導航', shortest: '最短里程', 'few-turns': '少轉彎', 'avoid-elevated': '優先避高架／隧道' };
export interface PreferredRoute { path: [number, number][]; ys: number[]; length: number; junctions: number; turns: number; elevatedMeters: number; estimatedSeconds: number; preference: NavigationPreference }
export interface NavigationSnap { x: number; z: number; y: number; t: number; edge: { a: number; b: number; length: number; forward: boolean; backward: boolean; elevated?: boolean } }
interface Edge { to: number; length: number; elevated: boolean }
/** Independent opt-in graph. The legacy Router.route implementation and fare callers are unchanged. */
export class PreferredCityRouter {
  private adj = new Map<number, Edge[]>();
  constructor(private d: CityData) {
    const n = d.net.nodes;
    for (const w of [...d.net.ways, ...(d.net.decks ?? [])]) if (w.c <= 3) for (let i = 1; i < w.n.length; i++) {
      const a = w.n[i - 1], b = w.n[i], length = Math.hypot(n[a * 2] - n[b * 2], n[a * 2 + 1] - n[b * 2 + 1]); if (length < .001) continue;
      const add = (from: number, to: number) => { let edges = this.adj.get(from); if (!edges) this.adj.set(from, edges = []); edges.push({ to, length, elevated: !!w.e }); };
      if (w.o !== -1) add(a, b); if (w.o !== 1) add(b, a);
    }
  }
  route(start: NavigationSnap, end: NavigationSnap, preference: Exclude<NavigationPreference, 'legacy'>): PreferredRoute | null {
    const from = -1, to = -2, n = this.d.net.nodes, heights = this.d.net.y ?? [], s = start.edge, e = end.edge;
    const startEdges: Edge[] = [], endEdges = new Map<number, Edge>();
    if (s.backward || start.t < 1e-9) startEdges.push({ to: s.a, length: start.t * s.length, elevated: !!s.elevated });
    if (s.forward || start.t > 1 - 1e-9) startEdges.push({ to: s.b, length: (1 - start.t) * s.length, elevated: !!s.elevated });
    if (e.forward || end.t < 1e-9) endEdges.set(e.a, { to, length: end.t * e.length, elevated: !!e.elevated });
    if (e.backward || end.t > 1 - 1e-9) endEdges.set(e.b, { to, length: (1 - end.t) * e.length, elevated: !!e.elevated });
    if (s.a === e.a && s.b === e.b && ((end.t >= start.t && s.forward) || (end.t <= start.t && s.backward))) startEdges.push({ to, length: Math.abs(end.t - start.t) * s.length, elevated: !!s.elevated });
    const xyz = (id: number): [number, number, number] => id === from ? [start.x, start.z, start.y] : id === to ? [end.x, end.z, end.y] : [n[id * 2], n[id * 2 + 1], heights[id] ?? 0];
    interface State { key: string; node: number; prevNode: number; cost: number; length: number; turns: number; elevated: number; parent: State | null }
    const initial: State = { key: 'start', node: from, prevNode: from, cost: 0, length: 0, turns: 0, elevated: 0, parent: null };
    const best = new Map<string, number>([['start', 0]]), heap: State[] = [initial];
    const push = (state: State) => { heap.push(state); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p].cost <= state.cost) break; heap[i] = heap[p]; i = p; } heap[i] = state; };
    const pop = () => { const first = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++; if (heap[child].cost >= last.cost) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first; };
    let final: State | null = null;
    while (heap.length) {
      const current = pop(); if (current.cost !== best.get(current.key)) continue; if (current.node === to) { final = current; break; }
      const edges = current.node === from ? startEdges : [...(this.adj.get(current.node) ?? []), ...(endEdges.has(current.node) ? [endEdges.get(current.node)!] : [])];
      for (const edge of edges) {
        const a = xyz(current.prevNode), b = xyz(current.node), c = xyz(edge.to), ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
        const angle = Math.abs(Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz)), turn = current.parent && Math.hypot(ux, uz) > .01 && Math.hypot(vx, vz) > .01 && angle > .5 ? 1 : 0;
        const cost = current.cost + edge.length * (preference === 'avoid-elevated' && edge.elevated ? 25 : 1) + (preference === 'few-turns' ? turn * 200 : 0);
        const key = `${current.node}:${edge.to}`; if (cost >= (best.get(key) ?? Infinity)) continue;
        best.set(key, cost); push({ key, node: edge.to, prevNode: current.node, cost, length: current.length + edge.length, turns: current.turns + turn, elevated: current.elevated + (edge.elevated ? edge.length : 0), parent: current });
      }
    }
    if (!final) return null;
    const ids: number[] = []; for (let state: State | null = final; state; state = state.parent) ids.push(state.node); ids.reverse();
    const path: [number, number][] = [], ys: number[] = []; for (const id of ids) { const p = xyz(id), previous = path.at(-1); if (previous && Math.hypot(p[0] - previous[0], p[1] - previous[1]) < .001) continue; path.push([p[0], p[1]]); ys.push(p[2]); }
    // Keep actual road vertices instead of smoothing across street corners or changing road layers.
    return { path, ys, length: final.length, junctions: final.turns, turns: final.turns, elevatedMeters: final.elevated, estimatedSeconds: Math.ceil(final.length / 8.3 + final.turns * 5), preference };
  }
}
