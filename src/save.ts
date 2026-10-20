// 由 main.ts 拆出來（行為不變）：存檔（localStorage）
import type { Level } from './quality';
import type { Stats } from './achievements';
import type { SeasonSave, SeasonRecord } from './season';

// ---------------------------------------------------------------- 存檔
export interface Ghost { t: number[]; s: number[]; x: number[]; z: number[]; h: number[] }
export type SteerMode = 'buttons' | 'drag' | 'tilt';
export interface TrackRec { best: number | null; sectors: (number | null)[]; ghost: Ghost | null }
export interface Save { freePos?: { x: number; z: number; h: number; y?: number }; season?: SeasonSave; seasonHistory?: SeasonRecord[]; circuits?: Record<string, TrackRec>; best: number | null; sectors: (number | null)[]; ghost: Ghost | null; opts: Record<string, boolean>; steer?: SteerMode; car?: string; touch?: 'auto' | 'on' | 'off'; time?: string; sens?: number; tc?: { size: number; op: number; pos: 'std' | 'swap' | 'lift' | 'swap-lift' }; vol?: { master: number; engine: number; fx: number }; tutDone?: boolean; name?: string; stats?: Partial<Stats>; ach?: string[]; owned?: string[]; paints?: Record<string, string[]>; paint?: Record<string, string>; street?: Record<string, number>; quality?: Level | 'auto'; taxi?: { money: number; trips: number } }
export const KEY = 'taipei-gp-v2'; // v2 = 真實街道賽道（舊賽道的紀錄與影子車不適用）
function loadSave(): Save {
  const empty: Save = { best: null, sectors: [null, null, null], ghost: null, opts: {} };
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return empty; }
}
// 各國賽道（網址 ?circuit=…）：最快圈、分段、影子車各賽道分開記（save.circuits），錢、車庫、成就照樣共用。
// 做法：載入時把 best／sectors／ghost 換成這條賽道的，存檔時再換回台北的（其他程式照舊直接用 save.best）
const CIRCUIT_ID = new URLSearchParams(location.search).get('circuit');
let taipei: TrackRec | null = null;
export function writeSave() {
  let out: Save = save;
  if (CIRCUIT_ID && taipei) out = { ...save, ...taipei, circuits: { ...save.circuits, [CIRCUIT_ID]: { best: save.best, sectors: save.sectors, ghost: save.ghost } } };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* 無痕模式存不了就算了 */ }
}
export const save = loadSave();
if (CIRCUIT_ID) {
  taipei = { best: save.best, sectors: save.sectors, ghost: save.ghost };
  Object.assign(save, save.circuits?.[CIRCUIT_ID] ?? { best: null, sectors: [null, null, null], ghost: null });
}
/** 某條賽道的最快圈（id 空字串 = 台北信義街道賽）；選賽道頁用 */
export function bestLapOf(id: string): number | null {
  if (id === (CIRCUIT_ID ?? '')) return save.best;
  if (!id) return taipei?.best ?? null;
  return save.circuits?.[id]?.best ?? null;
}
