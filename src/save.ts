// 由 main.ts 拆出來（行為不變）：存檔（localStorage）
import type { Level } from './quality';
import type { Stats } from './achievements';
import type { SeasonSave, SeasonRecord } from './season';

// ---------------------------------------------------------------- 存檔
export interface Ghost { t: number[]; s: number[]; x: number[]; z: number[]; h: number[] }
export type SteerMode = 'buttons' | 'drag' | 'tilt';
/** 一條賽道的紀錄；v = 跑出這些紀錄時的賽道指紋（trackStamp）：賽道形狀改過之後，舊的影子車會穿牆、舊的最快圈不能比 */
export interface TrackRec { best: number | null; sectors: (number | null)[]; ghost: Ghost | null; v?: string }
export interface Save { trackV?: string; freePos?: { x: number; z: number; h: number; y?: number }; season?: SeasonSave; seasonHistory?: SeasonRecord[]; circuits?: Record<string, TrackRec>; best: number | null; sectors: (number | null)[]; ghost: Ghost | null; opts: Record<string, boolean>; steer?: SteerMode; car?: string; touch?: 'auto' | 'on' | 'off'; time?: string; sens?: number; tc?: { size: number; op: number; pos: 'std' | 'swap' | 'lift' | 'swap-lift' }; tilt?: { inv: boolean; zero: number; dead: number }; vol?: { master: number; engine: number; fx: number }; tutDone?: boolean; name?: string; stats?: Partial<Stats>; ach?: string[]; owned?: string[]; paints?: Record<string, string[]>; paint?: Record<string, string>; street?: Record<string, number>; quality?: Level | 'auto'; taxi?: { money: number; trips: number } }
export const KEY = 'taipei-gp-v2'; // v2 = 真實街道賽道（舊賽道的紀錄與影子車不適用）
function loadSave(): Save {
  const empty: Save = { best: null, sectors: [null, null, null], ghost: null, opts: {} };
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return empty; }
}
// 各國賽道（網址 ?circuit=…）：最快圈、分段、影子車各賽道分開記（save.circuits），錢、車庫、成就照樣共用。
// 做法：載入時把 best／sectors／ghost 換成這條賽道的，存檔時再換回台北的（其他程式照舊直接用 save.best）
const CIRCUIT_ID = new URLSearchParams(location.search).get('circuit');
let taipei: TrackRec | null = null;
let warnedFull = false;
/** 存檔寫不進去時（容量滿、被瀏覽器擋）通知 main 一次（以前完全靜默，玩家不知道紀錄沒存到） */
export let onSaveFail: (() => void) | null = null;
export function setOnSaveFail(f: () => void) { onSaveFail = f; }
export function writeSave() {
  let out: Save = save;
  if (CIRCUIT_ID && taipei) out = { ...save, ...taipei, trackV: taipei.v, circuits: { ...save.circuits, [CIRCUIT_ID]: { best: save.best, sectors: save.sectors, ghost: save.ghost, v: save.trackV } } };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch {
    // 無痕模式（每次都會失敗）就算了；其他情況（容量滿）提醒一次
    if (!warnedFull) { warnedFull = true; onSaveFail?.(); }
  }
}
/**
 * 賽道指紋：點數、長度、起點、中間一點、終點（四捨五入到公分）。賽道形狀一改這個就變；
 * 紀錄的指紋跟現在的不一樣（或是舊存檔沒有指紋但賽道已經改過）→ 影子車、最快圈、分段清掉
 */
export function trackStamp(t: { N: number; length: number; px: ArrayLike<number>; pz: ArrayLike<number> }): string {
  const r = (v: number) => Math.round(v * 100);
  const m = t.N >> 1;
  return [t.N, r(t.length), r(t.px[0]), r(t.pz[0]), r(t.px[m]), r(t.pz[m]), r(t.px[t.N - 1]), r(t.pz[t.N - 1])].join(':');
}
/** 這條賽道的紀錄是不是照現在的賽道跑的；不是就清掉，回傳有沒有清（main 提示玩家一次） */
export function checkTrackStamp(stamp: string): boolean {
  const old = save.trackV;
  save.trackV = stamp;
  if (old === stamp) return false;
  if (old == null) return false; // 舊存檔第一次遇到指紋：當作是現在的賽道（不知道是不是同一條，不要誤刪紀錄），只補上指紋
  const had = save.best != null || save.ghost != null;
  save.best = null; save.sectors = [null, null, null]; save.ghost = null;
  return had;
}
export const save = loadSave();
if (CIRCUIT_ID) {
  taipei = { best: save.best, sectors: save.sectors, ghost: save.ghost, v: save.trackV };
  const c = save.circuits?.[CIRCUIT_ID] ?? { best: null, sectors: [null, null, null], ghost: null };
  Object.assign(save, { best: c.best, sectors: c.sectors, ghost: c.ghost, trackV: c.v });
}
/** 某條賽道的最快圈（id 空字串 = 台北信義街道賽）；選賽道頁用 */
export function bestLapOf(id: string): number | null {
  if (id === (CIRCUIT_ID ?? '')) return save.best;
  if (!id) return taipei?.best ?? null;
  return save.circuits?.[id]?.best ?? null;
}
