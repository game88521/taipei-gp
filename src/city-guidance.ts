type Point = readonly [number, number];
export type TurnKind = 'left' | 'right' | 'uturn';
interface Turn { at: number; x: number; z: number; kind: TurnKind; angle: number; key: string }
const distanceText = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const names = { left: '左轉', right: '右轉', uturn: '迴轉' };
/** 沿既有路線提供幾何轉向提示；不重新選路、不修改任務或車輛。 */
export class CityGuidance {
  private path: readonly Point[] | null = null;
  private ys: readonly number[] | null = null;
  private owner = '';
  private cum: number[] = [];
  private turns: Turn[] = [];
  private progress = 0;
  private spoken = new Map<string, Pick<Turn, 'kind' | 'x' | 'z'>>();
  clear() { this.path = null; this.ys = null; this.owner = ''; this.cum = []; this.turns = []; this.progress = 0; this.spoken.clear(); }
  private pointAt(s: number): Point {
    const path = this.path!;
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) { const m = (hi + lo) >> 1; if (this.cum[m] < s) lo = m; else hi = m; }
    const t = Math.max(0, Math.min(1, (s - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1)));
    return [path[lo][0] + (path[hi][0] - path[lo][0]) * t, path[lo][1] + (path[hi][1] - path[lo][1]) * t];
  }
  private use(path: readonly Point[], ys: readonly number[] | null, owner: string) {
    if (owner !== this.owner) this.spoken.clear();
    this.owner = owner; this.path = path; this.ys = ys; this.progress = 0; this.cum = [0]; this.turns = [];
    for (let i = 1; i < path.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const end = this.cum.at(-1) ?? 0;
    for (let i = 1; i < path.length - 1; i++) {
      const at = this.cum[i]; if (at < 10 || end - at < 10) continue;
      const a = this.pointAt(Math.max(0, at - 22)), b = path[i], c = this.pointAt(Math.min(end, at + 22));
      const ax = b[0] - a[0], az = b[1] - a[1], bx = c[0] - b[0], bz = c[1] - b[1];
      if (Math.hypot(ax, az) < 2 || Math.hypot(bx, bz) < 2) continue;
      const signed = Math.atan2(ax * bz - az * bx, ax * bx + az * bz), angle = Math.abs(signed) * 180 / Math.PI;
      if (angle < 35) continue;
      const kind: TurnKind = angle >= 140 ? 'uturn' : signed > 0 ? 'right' : 'left';
      const turn = { at, x: b[0], z: b[1], kind, angle, key: `${kind}:${Math.round(b[0] / 30)}:${Math.round(b[1] / 30)}` };
      const previous = this.turns.at(-1);
      if (previous && at - previous.at < 35) { if (angle > previous.angle) this.turns[this.turns.length - 1] = turn; }
      else this.turns.push(turn);
    }
  }
  update(path: readonly Point[] | null, ys: readonly number[] | null, owner: string,
    x: number, z: number, roadY: number, ground: (x: number, z: number) => number) {
    if (!path || path.length < 2) { this.clear(); return null; }
    if (path !== this.path || ys !== this.ys || owner !== this.owner) this.use(path, ys, owner);
    let score = Infinity, progress = 0, nearestY = roadY;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], length = this.cum[i + 1] - this.cum[i];
      if (length < 0.001) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (length * length)));
      const s = this.cum[i] + length * t, y = ys ? (ys[i] ?? roadY) + ((ys[i + 1] ?? roadY) - (ys[i] ?? roadY)) * t : roadY;
      const back = Math.max(0, this.progress - s - 15), jump = Math.max(0, s - this.progress - 100);
      const d = (a[0] + dx * t - x) ** 2 + (a[1] + dz * t - z) ** 2 + ((y - roadY) * 5) ** 2 + back * back + jump * 0.001;
      if (d < score) { score = d; progress = s; nearestY = y; }
    }
    this.progress = progress;
    const remaining = Math.max(0, (this.cum.at(-1) ?? 0) - progress), turn = this.turns.find((t) => t.at > progress + 6);
    const toTurn = turn ? turn.at - progress : remaining, height = nearestY - ground(x, z);
    const layer = height > 3.5 ? '高架路段' : height < -3 ? '地下路段' : '地面道路';
    const cue = turn && toTurn <= 110 && toTurn >= 12 && ![...this.spoken.values()].some((previous) =>
      previous.kind === turn.kind && Math.hypot(previous.x - turn.x, previous.z - turn.z) < 24) ? turn : null;
    if (cue) { this.spoken.set(cue.key, cue); if (this.spoken.size > 64) this.spoken.delete(this.spoken.keys().next().value!); }
    return { remaining, toTurn, kind: turn?.kind ?? null, layer, cue: cue?.kind ?? null,
      instruction: turn ? `${distanceText(toTurn)} 後${names[turn.kind]}` : `沿路前進 ${distanceText(remaining)}，接近目的地`,
      distance: distanceText(remaining) };
  }
}
