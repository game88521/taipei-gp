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
/**
 * 匯出：整份存檔包成 JSON 文字，給玩家自己存起來（換手機、清瀏覽器資料之前）。
 * 台北與各國賽道各自的紀錄都要在：在國外賽道頁匯出時，save 裡的 best／sectors／ghost 是那條賽道的，台北的在 taipei，所以先換回來
 */
export function exportSave(): string {
  let out: Save = save;
  if (CIRCUIT_ID && taipei) out = { ...save, ...taipei, trackV: taipei.v, circuits: { ...save.circuits, [CIRCUIT_ID]: { best: save.best, sectors: save.sectors, ghost: save.ghost, v: save.trackV } } };
  return JSON.stringify({ app: 'taipei-gp', key: KEY, at: new Date().toISOString(), save: out });
}

const isNum = (v: unknown, lo = -Infinity, hi = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;
const isNumArr = (v: unknown, maxLen: number): v is number[] => Array.isArray(v) && v.length <= maxLen && v.every((x) => isNum(x));
function cleanGhost(g: unknown): Ghost | null {
  if (!g || typeof g !== 'object') return null;
  const o = g as Record<string, unknown>;
  const MAX = 20000; // 一圈 100 秒 × 每秒幾十點，遠低於這個；擋掉灌爆的檔案
  if (!isNumArr(o.t, MAX) || !isNumArr(o.s, MAX) || !isNumArr(o.x, MAX) || !isNumArr(o.z, MAX) || !isNumArr(o.h, MAX)) return null;
  const n = o.t.length;
  if (n < 2 || o.s.length !== n || o.x.length !== n || o.z.length !== n || o.h.length !== n) return null;
  return { t: o.t, s: o.s, x: o.x, z: o.z, h: o.h };
}
function cleanRec(r: unknown): TrackRec | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const rec: TrackRec = {
    best: isNum(o.best, 10, 3600) ? o.best : null,
    sectors: Array.isArray(o.sectors) && o.sectors.length === 3 ? o.sectors.map((s) => (isNum(s, 1, 3600) ? s : null)) : [null, null, null],
    ghost: cleanGhost(o.ghost),
  };
  if (isStr(o.v, 120)) rec.v = o.v;
  return rec;
}
/**
 * 匯入：把玩家貼進來的 JSON 檢查過、挑出已知欄位，回傳乾淨的存檔（不會碰目前的 save）。
 * 不信任檔案內容：只收白名單裡的欄位，型別、範圍、長度都檢查，不對的欄位丟掉（不是整份拒絕，能救多少救多少）。
 * 回傳 { ok:false, why } 表示根本不是這個遊戲的存檔；dropped 是被丟掉的欄位名稱，讓玩家知道少了什麼
 */
export function parseSaveFile(text: string): { ok: true; save: Save; dropped: string[] } | { ok: false; why: string } {
  if (typeof text !== 'string' || text.length > 8_000_000) return { ok: false, why: '檔案太大或不是文字' };
  let root: unknown;
  try { root = JSON.parse(text); } catch { return { ok: false, why: '不是有效的 JSON（複製的時候可能少了一段）' }; }
  if (!root || typeof root !== 'object') return { ok: false, why: '內容不是存檔' };
  const wrap = root as Record<string, unknown>;
  // 接受兩種：匯出的包裝 { app, save } 或直接是存檔本身
  const src = (wrap.app === 'taipei-gp' && wrap.save && typeof wrap.save === 'object' ? wrap.save : root) as Record<string, unknown>;
  if (!('best' in src || 'opts' in src || 'taxi' in src || 'stats' in src || 'circuits' in src)) return { ok: false, why: '看不出是台北街道賽的存檔' };
  const out: Save = { best: null, sectors: [null, null, null], ghost: null, opts: {} };
  const dropped: string[] = [];
  const take = <K extends keyof Save>(k: K, v: Save[K] | undefined | null) => { if (v === undefined || v === null) { if (k in src && src[k as string] !== null && src[k as string] !== undefined) dropped.push(String(k)); } else out[k] = v; };
  const rec = cleanRec(src);
  if (rec) { out.best = rec.best; out.sectors = rec.sectors; out.ghost = rec.ghost; if (rec.v) out.trackV = rec.v; }
  const opts: Record<string, boolean> = {};
  if (src.opts && typeof src.opts === 'object') for (const [k, v] of Object.entries(src.opts as Record<string, unknown>)) if (typeof v === 'boolean' && k.length <= 40 && Object.keys(opts).length < 80) opts[k] = v;
  out.opts = opts;
  take('steer', src.steer === 'buttons' || src.steer === 'drag' || src.steer === 'tilt' ? src.steer : undefined);
  take('touch', src.touch === 'auto' || src.touch === 'on' || src.touch === 'off' ? src.touch : undefined);
  take('quality', src.quality === 'auto' || src.quality === 'high' || src.quality === 'medium' || src.quality === 'low' ? src.quality : undefined);
  take('time', isStr(src.time, 20) ? src.time : undefined);
  take('car', isStr(src.car, 30) ? src.car : undefined);
  take('name', isStr(src.name, 12) ? src.name.replace(/[<>"'`\\]/g, '') : undefined);
  take('sens', isNum(src.sens, 0.3, 2) ? src.sens : undefined);
  take('tutDone', typeof src.tutDone === 'boolean' ? src.tutDone : undefined);
  const t = src.tilt as Record<string, unknown> | undefined;
  take('tilt', t && typeof t.inv === 'boolean' && isNum(t.zero, -90, 90) && isNum(t.dead, 0, 20) ? { inv: t.inv, zero: t.zero, dead: t.dead } : undefined);
  const v = src.vol as Record<string, unknown> | undefined;
  take('vol', v && isNum(v.master, 0, 1) && isNum(v.engine, 0, 1) && isNum(v.fx, 0, 1) ? { master: v.master, engine: v.engine, fx: v.fx } : undefined);
  const tc = src.tc as Record<string, unknown> | undefined;
  take('tc', tc && isNum(tc.size, 0.3, 3) && isNum(tc.op, 0, 1) && (tc.pos === 'std' || tc.pos === 'swap' || tc.pos === 'lift' || tc.pos === 'swap-lift') ? { size: tc.size, op: tc.op, pos: tc.pos } : undefined);
  const tx = src.taxi as Record<string, unknown> | undefined;
  take('taxi', tx && isNum(tx.money, 0, 1e9) && isNum(tx.trips, 0, 1e7) ? { money: Math.floor(tx.money), trips: Math.floor(tx.trips) } : undefined);
  if (src.stats && typeof src.stats === 'object') {
    const stats: Record<string, number> = {};
    for (const [k, val] of Object.entries(src.stats as Record<string, unknown>)) if (isNum(val, 0, 1e12) && k.length <= 40 && Object.keys(stats).length < 80) stats[k] = val;
    out.stats = stats as Partial<Stats>;
  }
  const strList = (a: unknown, max: number) => (Array.isArray(a) ? a.filter((x): x is string => isStr(x, 40)).slice(0, max) : undefined);
  take('ach', strList(src.ach, 200));
  take('owned', strList(src.owned, 100));
  if (src.paints && typeof src.paints === 'object') {
    const paints: Record<string, string[]> = {};
    for (const [k, val] of Object.entries(src.paints as Record<string, unknown>)) { const l = strList(val, 40); if (l && k.length <= 30 && Object.keys(paints).length < 30) paints[k] = l; }
    out.paints = paints;
  }
  if (src.paint && typeof src.paint === 'object') {
    const paint: Record<string, string> = {};
    for (const [k, val] of Object.entries(src.paint as Record<string, unknown>)) if (isStr(val, 20) && k.length <= 30 && Object.keys(paint).length < 30) paint[k] = val;
    out.paint = paint;
  }
  if (src.street && typeof src.street === 'object') {
    const street: Record<string, number> = {};
    for (const [k, val] of Object.entries(src.street as Record<string, unknown>)) if (isNum(val, 1, 3600) && k.length <= 30 && Object.keys(street).length < 40) street[k] = val;
    out.street = street;
  }
  if (src.circuits && typeof src.circuits === 'object') {
    const circuits: Record<string, TrackRec> = {};
    for (const [k, val] of Object.entries(src.circuits as Record<string, unknown>)) { const r = cleanRec(val); if (r && /^[a-z0-9-]{2,30}$/.test(k) && Object.keys(circuits).length < 60) circuits[k] = r; }
    out.circuits = circuits;
  }
  // 賽季、賽季歷史、記住的位置結構複雜，而且壞掉會讓賽季頁出錯；不匯入（文字提示玩家這幾項不在內）
  for (const k of ['season', 'seasonHistory', 'freePos'] as const) if (src[k] !== undefined && src[k] !== null) dropped.push(k);
  return { ok: true, save: out, dropped };
}
export const save = loadSave();
if (CIRCUIT_ID) {
  taipei = { best: save.best, sectors: save.sectors, ghost: save.ghost, v: save.trackV };
  const c = save.circuits?.[CIRCUIT_ID] ?? { best: null, sectors: [null, null, null], ghost: null };
  Object.assign(save, { best: c.best, sectors: c.sectors, ghost: c.ghost, trackV: c.v });
}
/**
 * 套用匯入的存檔：直接寫進 localStorage 再讓 main 重新載入頁面（所有模組都從頭讀存檔，最不容易漏掉哪個狀態）。
 * 寫不進去（無痕模式、容量滿）回傳 false
 */
export function writeImported(s: Save): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}
/**
 * 請瀏覽器把這個網站的儲存空間標成「持久」：空間不夠時瀏覽器不會自動清掉它（不保證一定會給，Safari 常常不給）。
 * 只在玩家第一次有成績、真的有東西值得保留時才問一次；回傳最後的狀態（不支援就 null）
 */
export async function askPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}
/** 某條賽道的最快圈（id 空字串 = 台北信義街道賽）；選賽道頁用 */
export function bestLapOf(id: string): number | null {
  if (id === (CIRCUIT_ID ?? '')) return save.best;
  if (!id) return taipei?.best ?? null;
  return save.circuits?.[id]?.best ?? null;
}
