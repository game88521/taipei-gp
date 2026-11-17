/** 教練資料僅留在本分頁；不把舊影子車推測成煞車操作。 */
export interface CoachSample { time: number; s: number; speed: number; brake: boolean; valid: boolean }
export interface CoachPoint { t: number; s: number; v: number; brake: boolean }
export interface CoachTrace { time: number; points: CoachPoint[] }
export type CoachReference = 'pb' | 'last';
const cloneTrace = (t: CoachTrace | null) => t ? { time: t.time, points: t.points.map(p => ({ ...p })) } : null;
export function interpolateCoach(trace: CoachTrace | null, s: number): CoachPoint | null {
  if (!trace || trace.points.length < 2 || !Number.isFinite(s)) return null;
  const p = trace.points;
  if (s < p[0].s || s > p[p.length - 1].s) return null;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].s <= s) lo = m; else hi = m; }
  const f = (s - p[lo].s) / Math.max(1e-9, p[hi].s - p[lo].s);
  return { s, t: p[lo].t + (p[hi].t - p[lo].t) * f, v: p[lo].v + (p[hi].v - p[lo].v) * f, brake: f < .5 ? p[lo].brake : p[hi].brake };
}
export class TtCoach {
  private points: CoachPoint[] = [];
  private invalid = false;
  private interval = .05;
  private context = '';
  private last: CoachTrace | null = null;
  private best: CoachTrace | null = null;
  private personalBest: number | null = null;
  constructor(readonly length: number, readonly capacity = 4096) {}
  startSession(context: string, personalBest: number | null) {
    if (context !== this.context) { this.last = null; this.best = null; }
    if (this.best && this.best.time !== personalBest) this.best = null;
    this.context = context; this.personalBest = personalBest; this.resetLap();
  }
  resetLap() { this.points = []; this.invalid = false; this.interval = .05; }
  sample(value: CoachSample) {
    if (!value.valid) this.invalid = true;
    if (![value.time, value.s, value.speed].every(Number.isFinite) || value.time < 0 || value.time > 86400 || value.speed < 0 || value.speed > 1000 || value.s < 0 || value.s > this.length + 40) { this.invalid = true; return; }
    const previous = this.points.at(-1);
    let s = value.s;
    if (previous && previous.s > this.length * .9 && s < this.length * .1) s += this.length;
    if (previous && (value.time < previous.t || s < previous.s - 2 || s - previous.s > Math.max(50, value.speed * Math.max(.1, value.time - previous.t) * 2))) this.invalid = true;
    if (previous && value.time - previous.t < this.interval && s < this.length) return;
    if (!previous && s > Math.max(40, this.length * .02)) this.invalid = true;
    this.points.push({ t: value.time, s: Math.max(previous?.s ?? 0, s), v: value.speed, brake: value.brake === true });
    if (this.points.length > Math.max(32, this.capacity)) { this.points = this.points.filter((_, i) => i % 2 === 0); this.interval *= 2; }
  }
  finish(time: number, valid: boolean, newBest: boolean) {
    const last = this.points.at(-1);
    if (!valid || this.invalid || !Number.isFinite(time) || time <= 0 || !last || this.points.length < 3 || last.s < this.length - 40) return false;
    const trace = { time, points: this.points.map(p => ({ ...p })) };
    this.last = trace;
    if (newBest) { this.best = cloneTrace(trace); this.personalBest = time; }
    return true;
  }
  reference(which: CoachReference): CoachTrace | null { return cloneTrace(which === 'pb' ? this.best : this.last); }
  current(): CoachTrace | null { return this.points.length ? { time: this.points.at(-1)!.t, points: this.points.map(p => ({ ...p })) } : null; }
  get historicalPb() { return this.personalBest; }
  get lapValid() { return !this.invalid; }
  compare(which: CoachReference, s = this.points.at(-1)?.s ?? 0) {
    const current = interpolateCoach(this.current(), s), reference = interpolateCoach(which === 'pb' ? this.best : this.last, s);
    return current && reference ? { s, delta: current.t - reference.t, speedDifference: (current.v - reference.v) * 3.6,
      currentSpeed: current.v * 3.6, referenceSpeed: reference.v * 3.6, currentBrake: current.brake, referenceBrake: reference.brake } : null;
  }
}
