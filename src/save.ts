// 由 main.ts 拆出來（行為不變）：存檔（localStorage）
import type { Level } from './quality';
import type { Stats } from './achievements';

// ---------------------------------------------------------------- 存檔
export interface Ghost { t: number[]; s: number[]; x: number[]; z: number[]; h: number[] }
export type SteerMode = 'buttons' | 'drag' | 'tilt';
export interface Save { best: number | null; sectors: (number | null)[]; ghost: Ghost | null; opts: Record<string, boolean>; steer?: SteerMode; car?: string; touch?: 'auto' | 'on' | 'off'; time?: string; sens?: number; vol?: { master: number; engine: number; fx: number }; tutDone?: boolean; name?: string; stats?: Partial<Stats>; ach?: string[]; owned?: string[]; paints?: Record<string, string[]>; paint?: Record<string, string>; street?: Record<string, number>; quality?: Level | 'auto'; taxi?: { money: number; trips: number } }
export const KEY = 'taipei-gp-v2'; // v2 = 真實街道賽道（舊賽道的紀錄與影子車不適用）
function loadSave(): Save {
  const empty: Save = { best: null, sectors: [null, null, null], ghost: null, opts: {} };
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return empty; }
}
export function writeSave() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* 無痕模式存不了就算了 */ }
}
export const save = loadSave();
