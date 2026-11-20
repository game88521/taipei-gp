import type { CoachTrace, CoachPoint } from './tt-coach';

export const COACH_STORE_KEY = 'taipei-gp-expedition-coach-v1';
type Row = { context: string; length: number; trace: CoachTrace; at: number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export function validCoachTrace(v: unknown, length: number): v is CoachTrace {
  if (!object(v) || Object.keys(v).length !== 2 || !finite(v.time, .001, 86400) || !Array.isArray(v.points) || v.points.length < 3 || v.points.length > 4096) return false;
  let s = -1, t = -1;
  for (const p of v.points) {
    if (!object(p) || Object.keys(p).length !== 4 || !finite(p.s, 0, length + 40) || !finite(p.t, 0, v.time + 1) || !finite(p.v, 0, 1000) || typeof p.brake !== 'boolean' || p.s < s || p.t <= t) return false;
    s = p.s; t = p.t;
  }
  return v.points[0].s <= Math.max(40, length * .02) && s >= length - 40;
}
export class CoachTraceStore {
  private rows: Row[] = []; private raw: string | null = null; private blocked = false;
  error = '';
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
    if(!storage)this.error='瀏覽器無法保存 PB 遙測，本頁仍可比較。';
    try {
      this.raw = storage?.getItem(COACH_STORE_KEY) ?? null;
      if (this.raw === null) return;
      const v: unknown = JSON.parse(this.raw);
      if (this.raw.length > 2_000_000 || !object(v) || Object.keys(v).length !== 2 || v.v !== 1 || !Array.isArray(v.rows) || v.rows.length > 10 || new Set(v.rows.map(r => r?.context)).size !== v.rows.length
        || v.rows.some(r => !object(r) || Object.keys(r).length !== 4 || typeof r.context !== 'string' || !r.context || r.context.length > 200 || /[\x00-\x1f<>]/.test(r.context) || !finite(r.length, 100, 100000) || !finite(r.at, 0, 9e15) || !validCoachTrace(r.trace, r.length))) throw Error('invalid');
      this.rows = v.rows as Row[];
    } catch { this.blocked = true; this.error = '舊 PB 遙測無法讀取，原資料未覆寫；新遙測僅留在本頁。'; }
  }
  load(context: string, length: number, pb: number | null) {
    const row = this.rows.find(r => r.context === context && Math.abs(r.length - length) < .001 && r.trace.time === pb);
    return row ? structuredClone(row.trace) : null;
  }
  save(context: string, length: number, trace: CoachTrace) {
    if (!context || context.length > 200 || /[\x00-\x1f<>]/.test(context) || !finite(length,100,100000) || !validCoachTrace(trace, length)) return false;
    this.rows = [{ context, length, trace: structuredClone(trace), at: Date.now() }, ...this.rows.filter(r => r.context !== context)].slice(0, 10);
    if (!this.storage || this.blocked) return false;
    try {
      if (this.storage.getItem(COACH_STORE_KEY) !== this.raw) { this.blocked = true; this.error = 'PB 遙測已被其他頁面變更，為保留原資料，本頁暫停寫回。'; return false; }
      const next = JSON.stringify({ v: 1, rows: this.rows });
      if (next.length > 2_000_000) throw Error('quota');
      this.storage.setItem(COACH_STORE_KEY, next); this.raw = next; this.error = ''; return true;
    } catch { this.error = 'PB 遙測儲存失敗，原資料保留；本頁仍可比較。'; return false; }
  }
}
export function validCoachStoreRaw(raw:string|null){return raw===null||!new CoachTraceStore({getItem:()=>raw,setItem:()=>{}}).error;}
function at(trace: CoachTrace, s: number): CoachPoint | null {
  if (s < trace.points[0].s || s > trace.points.at(-1)!.s) return null;
  let lo = 0, hi = trace.points.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (trace.points[m].s <= s) lo = m; else hi = m; }
  const a = trace.points[lo], b = trace.points[hi], f = (s - a.s) / Math.max(.00001, b.s - a.s);
  return { s, t: a.t + (b.t - a.t) * f, v: a.v + (b.v - a.v) * f, brake: f < .5 ? a.brake : b.brake };
}
/** Deterministic observations, not inferred steering or a promise that later braking is safe. */
export function coachAdvice(current: CoachTrace | null, reference: CoachTrace | null, length: number): { from: number; to: number; loss: number; text: string }[] {
  if (!current || !reference) return [];
  const rows = [], parts = Math.min(16, Math.max(4, Math.floor(length / 120)));
  for (let i = 0; i < parts; i++) {
    const from = Math.max(current.points[0].s, reference.points[0].s, i * length / parts), to = (i + 1) * length / parts;
    const a = at(current, from), b = at(current, to), c = at(reference, from), d = at(reference, to); if (!a || !b || !c || !d) continue;
    const loss = (b.t - a.t) - (d.t - c.t); if (loss < .015) continue;
    const ownBrake = current.points.find(p => p.s >= from && p.s <= to && p.brake), refBrake = reference.points.find(p => p.s >= from && p.s <= to && p.brake);
    const brake = ownBrake && refBrake && Math.abs(ownBrake.s - refBrake.s) > 3 ? `首次煞車比參考${ownBrake.s < refBrake.s ? '早' : '晚'} ${Math.abs(ownBrake.s - refBrake.s).toFixed(0)}m；` : '';
    const speed = (b.v - d.v) * 3.6;
    rows.push({ from, to, loss, text: `${from.toFixed(0)}～${to.toFixed(0)}m 多用 ${loss.toFixed(3)} 秒；${brake}出段速度${speed < 0 ? '低' : '高'} ${Math.abs(speed).toFixed(1)}km/h。先在練習模式比較這段煞車與出彎。` });
  }
  return rows.sort((a, b) => b.loss - a.loss || a.from - b.from).slice(0, 3);
}
