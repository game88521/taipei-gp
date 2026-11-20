import type { Ghost, RaceRules } from './save';
import type { CoachTrace } from './tt-coach';
export const GHOST_SHARE_LIMIT = 2 * 1024 * 1024;
export interface GhostContext {
  circuit: string; stamp: string; rules: RaceRules; car: 'formula';
  track: { N: number; length: number; ds: number; px: ArrayLike<number>; pz: ArrayLike<number> };
}
export interface SharedGhost { type: 'taipei-gp-tt-ghost'; version: 1; physics: 'tt-v1'; circuit: string; stamp: string; rules: RaceRules; car: 'formula'; time: number; points: number; ghost: Ghost }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const number = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function parseSharedGhost(raw: string, context: GhostContext): SharedGhost {
  if (raw.length > GHOST_SHARE_LIMIT || new TextEncoder().encode(raw).length > GHOST_SHARE_LIMIT) throw Error('影子檔案超過 2 MB 上限');
  let value: unknown; try { value = JSON.parse(raw); } catch { throw Error('影子不是有效的 JSON'); }
  if (!object(value) || value.type !== 'taipei-gp-tt-ghost' || value.version !== 1 || value.physics !== 'tt-v1') throw Error('不是支援的 TT 影子分享版本；完整存檔不能當影子匯入');
  if (value.circuit !== context.circuit || value.stamp !== context.stamp) throw Error('影子賽道或賽道版本不同，請切到同一賽道後再匯入');
  if (value.rules !== context.rules || value.car !== context.car) throw Error('影子規則或車種不同；本場須使用相同規則與方程式賽車');
  if (!number(value.time) || value.time < 10 || value.time > 3600 || !Number.isInteger(value.points) || (value.points as number) < 4 || (value.points as number) > 8192 || !object(value.ghost)) throw Error('影子時間或點數超出範圍（10～3600 秒、4～8192 點）');
  const g = value.ghost, n = value.points as number, keys = ['t', 's', 'x', 'z', 'h'] as const;
  for (const k of keys) if (!Array.isArray(g[k]) || g[k].length !== n || !g[k].every(number)) throw Error('影子五欄必須等長且全部是有限數值');
  const ghost = Object.fromEntries(keys.map(k => [k, [...g[k] as number[]]])) as unknown as Ghost;
  const t = context.track, L = t.length;
  if (ghost.t[0] !== 0 || Math.abs(ghost.t[n - 1] - value.time) > .005 || ghost.s[0] < 0 || ghost.s[0] > 40 || ghost.s[n - 1] < L - 40 || ghost.s[n - 1] > L + 40) throw Error('影子必須包含從起跑線到終點的完整有效圈');
  for (let i = 0; i < n; i++) {
    if (ghost.t[i] < 0 || ghost.t[i] > 3600 || ghost.s[i] < 0 || ghost.s[i] > L + 40 || Math.abs(ghost.h[i]) > 10000 || Math.abs(ghost.x[i]) > 1e7 || Math.abs(ghost.z[i]) > 1e7) throw Error('影子點的數值超出合理範圍');
    if (i) {
      const dt = ghost.t[i] - ghost.t[i - 1], ds = ghost.s[i] - ghost.s[i - 1];
      if (dt <= 0 || ds < 0 || ds > 160 * dt + 3 || Math.hypot(ghost.x[i] - ghost.x[i - 1], ghost.z[i] - ghost.z[i - 1]) > 160 * dt + 3) throw Error('影子時間／距離倒退或含不合理跳躍，不能作分享參考');
    }
    const s = ghost.s[i] % L, a = Math.floor(s / t.ds) % t.N, b = (a + 1) % t.N, f = s / t.ds - Math.floor(s / t.ds);
    if (Math.hypot(ghost.x[i] - (t.px[a] + (t.px[b] - t.px[a]) * f), ghost.z[i] - (t.pz[a] + (t.pz[b] - t.pz[a]) * f)) > 12) throw Error('影子座標與賽道距離不符，或超出賽道範圍');
  }
  return { type: 'taipei-gp-tt-ghost', version: 1, physics: 'tt-v1', circuit: context.circuit, stamp: context.stamp, rules: context.rules, car: 'formula', time: value.time, points: n, ghost };
}
export function exportSharedGhost(context: GhostContext, time: number | null, ghost: Ghost | null): string {
  if (time === null || !ghost) throw Error('目前規則尚無可分享的正式 PB 影子');
  const payload = { type: 'taipei-gp-tt-ghost', version: 1, physics: 'tt-v1', circuit: context.circuit, stamp: context.stamp, rules: context.rules, car: context.car, time, points: ghost.t.length, ghost };
  const raw = JSON.stringify(payload); parseSharedGhost(raw, context); return raw;
}
/** Last intent wins, including same-file reselection, paste, mode changes and cancellation. */
export class GhostImportIntent {
  private serial = 0;
  invalidate() { this.serial++; }
  async read(file: Pick<File, 'size' | 'text'>, signature: string, current: () => string): Promise<string | null> {
    const intent = ++this.serial;
    if (file.size > GHOST_SHARE_LIMIT) throw Error('影子檔案超過 2 MB 上限');
    let raw: string;
    try { raw = await file.text(); } catch (error) { if (this.serial !== intent || signature !== current()) return null; throw error; }
    return this.serial === intent && signature === current() ? raw : null;
  }
}
/** Ghosts contain positions, not brake inputs. Only derive speed and distance for comparison. */
export function ghostSpeedTrace(shared: SharedGhost): CoachTrace {
  const g = shared.ghost;
  return { time: shared.time, points: g.t.map((t, i) => { const a = Math.max(0, i - 1), b = Math.min(g.t.length - 1, i + 1); return { t, s: g.s[i], v: Math.hypot(g.x[b] - g.x[a], g.z[b] - g.z[a]) / Math.max(.001, g.t[b] - g.t[a]), brake: false }; }) };
}
