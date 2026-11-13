// 由 main.ts 拆出來（行為不變）：存檔（localStorage）
import type { Level } from './quality';
import type { Stats } from './achievements';
import type { SeasonSave, SeasonRecord } from './season';
import { parseSeasonSave, parseSeasonHistory } from './season';
import { randomUuid } from './identity';
import { parseTransactionLedger, type Transaction } from './economy';
import { parseDriftChallengeRecords, type DriftChallengeRecords } from './drift';
import { parseStreetChallengeRecords, parseStreetSeriesCheckpoint, type StreetChallengeRecords, type StreetSeriesCheckpoint } from './street-series';
import { parseTaxiCheckpoint, parseTaxiSettledIds, type TaxiCheckpoint } from './street-taxi-state';
import { parsePlayerProgress, type PlayerProgress } from './player-progress';

// ---------------------------------------------------------------- 存檔
export interface Ghost { t: number[]; s: number[]; x: number[]; z: number[]; h: number[] }
export type SteerMode = 'buttons' | 'drag' | 'tilt';
export type RaceRules = 'classic' | '2026';
export const RECORD_VERSION = 1;
/** 一條賽道的紀錄；v = 跑出這些紀錄時的賽道指紋（trackStamp）：賽道形狀改過之後，舊的影子車會穿牆、舊的最快圈不能比 */
export interface TrackRec { best: number | null; sectors: (number | null)[]; ghost: Ghost | null; v?: string; gpBest?: number | null }
export interface Save { schema?: number; playerId?: string; records?: Record<string, TrackRec>; damage?: Record<string, number>; ledger?: Transaction[]; trackV?: string; gpBest?: number | null; freePos?: { x: number; z: number; h: number; y?: number }; season?: SeasonSave; seasonHistory?: SeasonRecord[]; circuits?: Record<string, TrackRec>; best: number | null; sectors: (number | null)[]; ghost: Ghost | null; opts: Record<string, boolean | string>; steer?: SteerMode; car?: string; touch?: 'auto' | 'on' | 'off'; time?: string; sens?: number; curve?: 'linear' | 'gentle'; tc?: { size: number; op: number; pos: 'std' | 'swap' | 'lift' | 'swap-lift' }; tilt?: { inv: boolean; zero: number; dead: number }; vol?: { master: number; engine: number; fx: number; others?: number; ambient?: number }; tutDone?: boolean; name?: string; stats?: Partial<Stats>; ach?: string[]; owned?: string[]; paints?: Record<string, string[]>; paint?: Record<string, string>; street?: Record<string, number>; quality?: Level | 'auto'; taxi?: { money: number; trips: number } }
export const KEY = 'taipei-gp-v2'; // v2 = 真實街道賽道（舊賽道的紀錄與影子車不適用）
export interface Save {
  driftChallenge?: DriftChallengeRecords;
  streetChallenge?: StreetChallengeRecords;
  streetSeries?: StreetSeriesCheckpoint | null;
  taxiJob?: TaxiCheckpoint | null;
  taxiSettled?: string[];
  progress?: PlayerProgress;
}
const LAST_GOOD_KEY = KEY + '-last-good';
const RECOVERY_ORIGINAL_KEY = KEY + '-recovery-original';
export interface SaveRecoveryState {
  blocked: boolean;
  reason: 'invalid' | 'unreadable' | 'partial' | null;
  dropped: string[];
  message: string;
  originalRaw: string | null;
  originalArchived: boolean;
  archiveError: string | null;
  hasSnapshot: boolean;
  snapshotAt: number | null;
}
export type SaveRecoveryResult = { ok: true } | { ok: false; error: string };
/** 只能在玩家已匯出原始內容並明確確認保留副本後傳入，不能把產生下載連結當成已保留。 */
export interface SaveRecoveryOptions { originalExported?: boolean }
interface GoodSnapshot { at: number; raw: string }
const recovery: SaveRecoveryState = { blocked: false, reason: null, dropped: [], message: '', originalRaw: null, originalArchived: false, archiveError: null, hasSnapshot: false, snapshotAt: null };
/** 設定可回退預設值；金錢、收藏、紀錄及進度的任何已知資料損失都必須先由玩家救援。缺少可選欄位不視為損壞。 */
export function criticalSaveDrops(dropped: readonly string[]): string[] {
  const critical = new Set(['best', 'sectors', 'ghost', 'gpBest', 'trackV', 'playerId', 'taxi', 'ledger', 'stats', 'ach', 'owned', 'paints', 'paint', 'street', 'circuits', 'records', 'damage', 'season', 'seasonHistory', 'freePos', 'driftChallenge', 'streetChallenge', 'streetSeries', 'taxiJob', 'taxiSettled', 'progress']);
  return dropped.filter((field) => critical.has(field.split('.')[0]));
}
let lastGood: GoodSnapshot | null = null, reloadRequired = false, originalObserved = false;
const emptySave = (): Save => ({ best: null, sectors: [null, null, null], ghost: null, opts: {} });
const storageError = (e: unknown) => e instanceof Error ? e.message : String(e);
export interface SaveWriterState {
  phase: 'initializing' | 'ready' | 'blocked';
  protection: 'web-lock' | 'raw-check' | null;
  reason: 'other-tab' | 'changed' | 'lock-error' | 'released' | null;
  message: string;
}
const writer: SaveWriterState = { phase: 'initializing', protection: null, reason: null, message: '正在確認存檔寫入權限。' };
const writerListeners = new Set<(state: SaveWriterState) => void>();
let writerInitialization: Promise<SaveWriterState> | null = null;
let expectedRaw: string | null = null, expectedObserved = false, loadedGoodRaw: string | null = null;
let beforeWriterRelease: (() => void) | null = null;
/** 離頁最後保存必須同步執行；由同一個 pagehide listener 保存後才封鎖／釋放，不能依靠不同 listener 間的 microtask 排程。 */
export function setBeforeSaveWriterRelease(flush: () => void): void { beforeWriterRelease = flush; }
/** blocked 不可重新初始化或偷偷採用外頁進度；必須重新載入，匯出本頁進度仍可使用。 */
export function getSaveWriterState(): SaveWriterState { return { ...writer }; }
/** 訂閱後只通知後續變更；目前狀態請另讀 getSaveWriterState。 */
export function subscribeSaveWriter(listener: (state: SaveWriterState) => void): () => void {
  writerListeners.add(listener); return () => { writerListeners.delete(listener); };
}
function updateWriter(state: Partial<SaveWriterState>) {
  Object.assign(writer, state);
  for (const listener of writerListeners) { try { listener(getSaveWriterState()); } catch { /* 畫面處理失敗不能解除存檔保護 */ } }
}
function blockWriter(reason: NonNullable<SaveWriterState['reason']>, message: string) {
  if (writer.phase !== 'blocked') updateWriter({ phase: 'blocked', reason, message });
}
function checkWriterCurrent(): SaveRecoveryResult {
  if (writer.phase !== 'ready') return { ok: false, error: writer.message };
  try {
    const current = localStorage.getItem(KEY);
    if (expectedObserved && current !== expectedRaw) {
      blockWriter('changed', '存檔已被其他頁面變更，已停止本頁寫入。請先匯出本頁進度，再重新載入。');
      return { ok: false, error: writer.message };
    }
    // 初始讀取被拒絕時不猜原文；權限恢復後第一次成功讀取才建立基準。
    if (!expectedObserved) { expectedRaw = current; expectedObserved = true; }
    return { ok: true };
  } catch (error) { return { ok: false, error: `無法讀取原存檔，尚未覆寫：${storageError(error)}` }; }
}
function assertWriterCurrent() {
  const checked = checkWriterCurrent();
  if (!checked.ok) throw new Error(checked.error);
}
/** main 在救援／建立場景前 await。Web Locks 不等待別頁關閉；無此 API 時僅提供逐次原文比對，無法保證同時寫入的原子性。 */
export function initializeSaveWriter(): Promise<SaveWriterState> {
  if (writerInitialization) return writerInitialization.then(() => getSaveWriterState());
  writerInitialization = new Promise<SaveWriterState>((resolve) => {
    const ready = (protection: NonNullable<SaveWriterState['protection']>, releaseLock: () => void = () => {}) => {
      updateWriter({ phase: 'ready', protection, reason: null, message: protection === 'raw-check' ? '此瀏覽器未提供分頁鎖定；每次存檔會比對原文，請只開啟一個遊戲分頁。' : '' });
      const checked = checkWriterCurrent();
      if (checked.ok) {
        if (loadedGoodRaw !== null) rememberGood(loadedGoodRaw);
        if (recovery.blocked && recovery.originalRaw !== null) archiveOriginal();
      }
      if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
        if (event.key === KEY || event.key === null) checkWriterCurrent();
      });
      if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
        try { if (writer.phase === 'ready') beforeWriterRelease?.(); }
        finally {
          blockWriter('released', '本頁已離開並停止存檔寫入，請重新載入後繼續遊戲。');
          releaseLock();
        }
      }, { once: true });
      resolve(getSaveWriterState());
    };
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks) { ready('raw-check'); return; }
    void Promise.resolve().then(() => locks.request(KEY + '-writer', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        updateWriter({ protection: 'web-lock' });
        blockWriter('other-tab', '另一個遊戲分頁正在使用存檔。請先關閉該分頁，再重新載入本頁。');
        resolve(getSaveWriterState()); return;
      }
      let release!: () => void;
      const held = new Promise<void>((done) => { release = done; });
      ready('web-lock', release);
      await held;
    })).catch((error: unknown) => {
      blockWriter('lock-error', `無法取得存檔分頁鎖定：${storageError(error)}。請重新載入後再試。`);
      resolve(getSaveWriterState());
    });
  });
  return writerInitialization;
}

function readLastGood(): GoodSnapshot | null {
  try {
    const text = localStorage.getItem(LAST_GOOD_KEY);
    if (!text) return null;
    const value = JSON.parse(text) as { at?: unknown; raw?: unknown };
    if (typeof value.raw !== 'string' || typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
    const parsed = parseSaveFile(value.raw);
    return parsed.ok && criticalSaveDrops(parsed.dropped).length === 0 ? { at: value.at, raw: value.raw } : null;
  } catch { return null; }
}
function rememberGood(raw: string) {
  if (!checkWriterCurrent().ok) return;
  lastGood = { at: Date.now(), raw }; // 只保留不可變文字，不能和遊戲中的可變 save 共用物件。
  // 快照是額外保護；空間不足不能讓原本可寫入的正常存檔假裝失敗。
  try { localStorage.setItem(LAST_GOOD_KEY, JSON.stringify({ at: lastGood.at, raw })); } catch { /* 保留既有快照及本次記憶體副本 */ }
}
/** 可重建快照不能排擠主檔或還原前副本；只在確定容量錯誤時釋放它。 */
function writeWithSnapshotSpace(key: string, raw: string) {
  assertWriterCurrent();
  try { localStorage.setItem(key, raw); }
  catch (error) {
    if (!error || typeof error !== 'object' || !('name' in error) || error.name !== 'QuotaExceededError') throw error;
    let previousSnapshot: string | null;
    try {
      assertWriterCurrent();
      previousSnapshot = localStorage.getItem(LAST_GOOD_KEY);
      if (previousSnapshot === null) throw error;
      localStorage.removeItem(LAST_GOOD_KEY);
    } catch { throw error; }
    try { assertWriterCurrent(); localStorage.setItem(key, raw); }
    catch (retryError) {
      try { assertWriterCurrent(); localStorage.setItem(LAST_GOOD_KEY, previousSnapshot); } catch { /* 原主檔仍在，記憶體 lastGood 亦保留 */ }
      throw retryError;
    }
  }
}
function archiveOriginal(): boolean {
  if (recovery.originalRaw === null) return false;
  try {
    assertWriterCurrent();
    if (localStorage.getItem(RECOVERY_ORIGINAL_KEY) !== recovery.originalRaw) localStorage.setItem(RECOVERY_ORIGINAL_KEY, recovery.originalRaw);
    recovery.originalArchived = true; recovery.archiveError = null;
    return true;
  } catch (e) { recovery.originalArchived = false; recovery.archiveError = storageError(e); return false; }
}
function loadSave(): Save {
  lastGood = readLastGood();
  let raw: string | null;
  try { raw = localStorage.getItem(KEY); originalObserved = true; expectedObserved = true; expectedRaw = raw; }
  catch (e) {
    Object.assign(recovery, { blocked: true, reason: 'unreadable', message: `無法讀取原存檔：${storageError(e)}。已停止自動存檔，請先救援。` });
    return emptySave();
  }
  if (raw === null) {
    if (lastGood) Object.assign(recovery, { blocked: true, reason: 'invalid', message: '主存檔已遺失，但仍有有效快照。已停止自動存檔，請先選擇還原或建立新存檔。' });
    return emptySave(); // 沒有原檔也沒有快照才是第一次遊玩。
  }
  const parsed = parseSaveFile(raw);
  if (parsed.ok) {
    const dropped = criticalSaveDrops(parsed.dropped);
    if (dropped.length) {
      Object.assign(recovery, { blocked: true, reason: 'partial', dropped, message: `存檔部分資料異常：${dropped.join('、')}。已停止自動存檔，原始內容及完整快照仍保留。`, originalRaw: raw });
      return parsed.save;
    }
    loadedGoodRaw = raw; lastGood = { at: Date.now(), raw }; return parsed.save;
  }
  Object.assign(recovery, { blocked: true, reason: 'invalid', message: `原存檔無法解析：${parsed.why}。已停止自動存檔，原始內容仍保留。`, originalRaw: raw });
  return emptySave(); // 只讓畫面模組能初始化；writeSave 的守門不允許它覆蓋原檔。
}
/** main 必須在建立遊戲前檢查；救援成功後重新載入，不能沿用這份暫時的空進度。 */
export function getSaveRecovery(): SaveRecoveryState {
  if (recovery.blocked && !reloadRequired) lastGood = readLastGood() ?? lastGood;
  return { ...recovery, dropped: [...recovery.dropped], hasSnapshot: lastGood !== null, snapshotAt: lastGood?.at ?? null };
}
export function exportRecoveryOriginal(): { ok: true; text: string } | { ok: false; error: string } {
  if (recovery.originalRaw !== null) return { ok: true, text: recovery.originalRaw };
  if (!recovery.blocked) return { ok: false, error: '目前沒有待救援的原始存檔。' };
  try {
    const raw = localStorage.getItem(KEY);
    if (originalObserved && raw !== recovery.originalRaw) return { ok: false, error: '原存檔已被其他頁面變更，請重新載入後再救援。' };
    recovery.originalRaw = raw; originalObserved = true; // 讀到「不存在」也是一個必須保護的觀察結果。
    if (raw === null) return { ok: false, error: '目前讀不到原始存檔；請恢復瀏覽器儲存權限後再試。' };
    archiveOriginal();
    return { ok: true, text: raw };
  } catch (e) { return { ok: false, error: `原始存檔仍無法讀取：${storageError(e)}` }; }
}
function preserveRecoveryOriginal(options: SaveRecoveryOptions): SaveRecoveryResult {
  const checked = checkWriterCurrent();
  if (!checked.ok) return checked;
  try {
    const current = localStorage.getItem(KEY);
    if (originalObserved && current !== recovery.originalRaw) return { ok: false, error: '原存檔已被其他頁面變更，請重新載入後再救援。' };
    recovery.originalRaw = current; originalObserved = true;
    if (current !== null && !archiveOriginal() && !options.originalExported) return { ok: false, error: `無法另存原始內容：${recovery.archiveError}。請先下載原始檔並確認已保留副本，或釋放瀏覽器空間後重試。` };
    return { ok: true };
  } catch (e) { return { ok: false, error: `無法讀取原存檔，尚未覆寫：${storageError(e)}` }; }
}
function commitRecovery(value: Save, options: SaveRecoveryOptions): SaveRecoveryResult {
  if (reloadRequired) return { ok: false, error: '救援結果已寫入，請重新載入遊戲。' };
  if (!recovery.blocked) return { ok: false, error: '目前沒有需要處理的存檔讀取錯誤。' };
  const preserved = preserveRecoveryOriginal(options);
  if (!preserved.ok) return preserved;
  try {
    const raw = JSON.stringify(value);
    writeWithSnapshotSpace(KEY, raw);
    expectedRaw = raw;
    rememberGood(raw);
    reloadRequired = true; recovery.message = '救援結果已寫入，請重新載入遊戲。';
    return { ok: true };
  } catch (e) { return { ok: false, error: `救援結果寫入失敗，原存檔未被覆蓋：${storageError(e)}` }; }
}
export function restoreLastGoodSave(options: SaveRecoveryOptions = {}): SaveRecoveryResult {
  const snapshot = readLastGood() ?? lastGood;
  if (!snapshot) return { ok: false, error: '沒有可用的有效快照，請匯入自己的備份或明確建立新存檔。' };
  const parsed = parseSaveFile(snapshot.raw);
  if (!parsed.ok) return { ok: false, error: '快照內容無法還原，請匯入自己的備份。' };
  return commitRecovery(parsed.save, options);
}
export function createNewSave(options: SaveRecoveryOptions = {}): SaveRecoveryResult { return commitRecovery(emptySave(), options); }
// 各國賽道（網址 ?circuit=…）：最快圈、分段、影子車各賽道分開記（save.circuits），錢、車庫、成就照樣共用。
// 做法：載入時把 best／sectors／ghost 換成這條賽道的，存檔時再換回台北的（其他程式照舊直接用 save.best）
const CIRCUIT_ID = new URLSearchParams(location.search).get('circuit');
let warnedFull = false;
/** 存檔寫不進去時（容量滿、被瀏覽器擋）通知 main 一次（以前完全靜默，玩家不知道紀錄沒存到） */
export let onSaveFail: (() => void) | null = null;
export function setOnSaveFail(f: () => void) { onSaveFail = f; }
export function writeSave() {
  if (recovery.blocked || reloadRequired) return false;
  if (!checkWriterCurrent().ok) {
    if (writer.phase === 'ready' && !warnedFull) { warnedFull = true; onSaveFail?.(); }
    return false;
  }
  const out = serializedSave();
  try {
    const raw = JSON.stringify(out), parsed = parseSaveFile(raw);
    if (!parsed.ok || criticalSaveDrops(parsed.dropped).length) throw new Error('存檔含無效進度，尚未寫入');
    writeWithSnapshotSpace(KEY, raw); expectedRaw = raw; rememberGood(raw); return true;
  } catch {
    // 無痕模式（每次都會失敗）就算了；其他情況（容量滿）提醒一次
    if (writer.phase === 'ready' && !warnedFull) { warnedFull = true; onSaveFail?.(); }
    return false;
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
  const had = save.best != null || save.ghost != null || save.gpBest != null;
  save.best = null; save.sectors = [null, null, null]; save.ghost = null; save.gpBest = null; // 賽道形狀改了：正賽最快圈也不能比
  return had;
}
/**
 * 匯出：整份存檔包成 JSON 文字，給玩家自己存起來（換手機、清瀏覽器資料之前）。
 * 台北與各國賽道各自的紀錄都要在：在國外賽道頁匯出時，save 裡的 best／sectors／ghost 是那條賽道的，台北的在 taipei，所以先換回來
 */
export function exportSave(): string {
  return JSON.stringify({ app: 'taipei-gp', key: KEY, version: 3, at: new Date().toISOString(), save: serializedSave() });
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
  if (o.t[0] < 0 || o.t[n - 1] > 3600 || o.t.some((t, i) => i > 0 && t <= (o.t as number[])[i - 1])) return null;
  return { t: o.t, s: o.s, x: o.x, z: o.z, h: o.h };
}
function cleanRec(r: unknown): TrackRec | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const rec: TrackRec = {
    best: isNum(o.best, 10, 3600) ? o.best : null,
    sectors: Array.isArray(o.sectors) && o.sectors.length === 3 ? o.sectors.map((s) => (isNum(s, 1, 3600) ? s : null)) : [null, null, null],
    ghost: cleanGhost(o.ghost),
    gpBest: isNum(o.gpBest, 10, 3600) ? o.gpBest : null,
  };
  if (isStr(o.v ?? o.trackV, 120)) rec.v = (o.v ?? o.trackV) as string;
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
  if (rec) { out.best = rec.best; out.sectors = rec.sectors; out.ghost = rec.ghost; out.gpBest = rec.gpBest ?? null; if (rec.v) out.trackV = rec.v; }
  out.schema = 3;
  take('playerId', typeof src.playerId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(src.playerId) ? src.playerId : undefined);
  const opts: Save['opts'] = {};
  if (src.opts && typeof src.opts === 'object') for (const [k, v] of Object.entries(src.opts as Record<string, unknown>)) if (typeof v === 'boolean' && k.length <= 40 && Object.keys(opts).length < 80) opts[k] = v;
  const selects: Record<string, string[]> = { 'opt-laps': ['3', '6'], 'opt-tyre': ['0', '1', '2', '3'], 'opt-rules': ['classic', '2026'], 'opt-gpwx': ['dry', 'maybe', 'wet'], 'opt-diff': ['easy', 'normal', 'hard'], 'opt-sc': ['normal', 'rare', 'off'], 'opt-frame-cap': ['30', '60', 'unlimited'] };
  for (const [k, allowed] of Object.entries(selects)) { const v = (src.opts as Record<string, unknown> | undefined)?.[k]; if (typeof v === 'string' && allowed.includes(v)) opts[k] = v; else if (v != null) dropped.push(`opts.${k}`); }
  out.opts = opts;
  take('steer', src.steer === 'buttons' || src.steer === 'drag' || src.steer === 'tilt' ? src.steer : undefined);
  take('touch', src.touch === 'auto' || src.touch === 'on' || src.touch === 'off' ? src.touch : undefined);
  take('quality', src.quality === 'auto' || src.quality === 'high' || src.quality === 'medium' || src.quality === 'low' ? src.quality : undefined);
  take('time', isStr(src.time, 20) ? src.time : undefined);
  take('car', isStr(src.car, 30) ? src.car : undefined);
  take('name', isStr(src.name, 12) ? src.name.replace(/[<>"'`\\]/g, '') : undefined);
  take('sens', isNum(src.sens, 0.3, 2) ? src.sens : undefined);
  take('curve', src.curve === 'linear' || src.curve === 'gentle' ? src.curve : undefined);
  take('tutDone', typeof src.tutDone === 'boolean' ? src.tutDone : undefined);
  const t = src.tilt as Record<string, unknown> | undefined;
  take('tilt', t && typeof t.inv === 'boolean' && isNum(t.zero, -90, 90) && isNum(t.dead, 0, 20) ? { inv: t.inv, zero: t.zero, dead: t.dead } : undefined);
  const v = src.vol as Record<string, unknown> | undefined;
  take('vol', v && isNum(v.master, 0, 1) && isNum(v.engine, 0, 1) && isNum(v.fx, 0, 1) ? { master: v.master, engine: v.engine, fx: v.fx, ...(isNum(v.others, 0, 1) ? { others: v.others } : {}), ...(isNum(v.ambient, 0, 1) ? { ambient: v.ambient } : {}) } : undefined);
  const tc = src.tc as Record<string, unknown> | undefined;
  take('tc', tc && isNum(tc.size, 0.3, 3) && isNum(tc.op, 0, 1) && (tc.pos === 'std' || tc.pos === 'swap' || tc.pos === 'lift' || tc.pos === 'swap-lift') ? { size: tc.size, op: tc.op, pos: tc.pos } : undefined);
  const tx = src.taxi as Record<string, unknown> | undefined;
  take('taxi', tx && isNum(tx.money, 0, 1e9) && isNum(tx.trips, 0, 1e7) ? { money: Math.floor(tx.money), trips: Math.floor(tx.trips) } : undefined);
  take('ledger', parseTransactionLedger(src.ledger));
  const completeMap = (raw: unknown, parsed: object, max: number): boolean => !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.keys(raw).length <= max && Object.keys(raw).length === Object.keys(parsed).length;
  if ('driftChallenge' in src) {
    const records = parseDriftChallengeRecords(src.driftChallenge);
    const raw = src.driftChallenge as Record<string, { medal?: unknown }> | null;
    take('driftChallenge', completeMap(raw, records, 500) && Object.entries(records).every(([k, r]) => raw?.[k]?.medal === r.medal) ? records : undefined);
    if (src.driftChallenge === null) dropped.push('driftChallenge');
  }
  if ('streetChallenge' in src) {
    const records = parseStreetChallengeRecords(src.streetChallenge);
    take('streetChallenge', completeMap(src.streetChallenge, records, 2000) ? records : undefined);
    if (src.streetChallenge === null) dropped.push('streetChallenge');
  }
  if (src.taxiJob === null) out.taxiJob = null;
  else take('taxiJob', parseTaxiCheckpoint(src.taxiJob));
  if (src.streetSeries === null) out.streetSeries = null;
  else take('streetSeries', parseStreetSeriesCheckpoint(src.streetSeries));
  if ('taxiSettled' in src) {
    const ids = parseTaxiSettledIds(src.taxiSettled);
    take('taxiSettled', Array.isArray(src.taxiSettled) && src.taxiSettled.length <= 64 && ids.length === src.taxiSettled.length ? ids : undefined);
    if (src.taxiSettled === null) dropped.push('taxiSettled');
  }
  take('progress', parsePlayerProgress(src.progress));
  if (src.progress === null) dropped.push('progress');
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
    for (const [k, val] of Object.entries(src.street as Record<string, unknown>)) if (isNum(val, 1, 3600) && /^[a-z0-9:-]{1,50}$/.test(k) && Object.keys(street).length < 100) street[k] = val;
    out.street = street;
  }
  if (src.circuits && typeof src.circuits === 'object') {
    const circuits: Record<string, TrackRec> = {};
    for (const [k, val] of Object.entries(src.circuits as Record<string, unknown>)) { const r = cleanRec(val); if (r && /^[a-z0-9-]{2,30}$/.test(k) && Object.keys(circuits).length < 60) circuits[k] = r; }
    out.circuits = circuits;
  }
  if (src.records && typeof src.records === 'object') {
    const records: Record<string, TrackRec> = {};
    for (const [k, val] of Object.entries(src.records)) { const r = cleanRec(val); if (r && /^(taipei|[a-z0-9-]{2,30}):(classic|2026):1$/.test(k) && Object.keys(records).length < 150) records[k] = r; else dropped.push(`records.${k}`); }
    out.records = records;
  }
  if (src.damage && typeof src.damage === 'object') { out.damage = {}; for (const [k, v] of Object.entries(src.damage)) if (/^[a-z0-9-]{1,30}$/.test(k) && isNum(v, 0, 1)) out.damage[k] = v; }
  take('season', parseSeasonSave(src.season));
  take('seasonHistory', parseSeasonHistory(src.seasonHistory));
  const rawSeason = src.season as { pending?: { checkpoint?: unknown } } | undefined;
  if (rawSeason?.pending?.checkpoint != null && !out.season?.pending?.checkpoint) dropped.push('season.pending.checkpoint');
  const pos = src.freePos as Record<string, unknown> | undefined;
  take('freePos', pos && isNum(pos.x, -100000, 100000) && isNum(pos.z, -100000, 100000) && isNum(pos.h, -1000, 1000) && (pos.y === undefined || isNum(pos.y, -2000, 10000)) ? { x: pos.x, z: pos.z, h: pos.h, ...(pos.y === undefined ? {} : { y: pos.y as number }) } : undefined);
  // 容錯解析仍可用於玩家主動匯入；主檔載入需知道任何關鍵資料是否被清掉。
  for (const field of ['stats', 'paints', 'paint', 'street', 'circuits', 'records', 'damage'] as const) {
    const value = src[field];
    if (value != null && (!completeMap(value, out[field] ?? {}, Infinity))) dropped.push(field);
  }
  for (const field of ['ach', 'owned'] as const) {
    const value = src[field];
    if (value != null && (!Array.isArray(value) || value.length !== out[field]?.length)) dropped.push(field);
  }
  if (src.paints && typeof src.paints === 'object') for (const [key, raw] of Object.entries(src.paints)) {
    if (!Array.isArray(raw) || raw.length !== out.paints?.[key]?.length) dropped.push(`paints.${key}`);
  }
  const noteRecord = (value: unknown, prefix = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { dropped.push(prefix.replace(/\.$/, '') || 'records'); return; }
    const r = value as Record<string, unknown>;
    for (const key of ['best', 'gpBest'] as const) if (r[key] != null && !isNum(r[key], 10, 3600)) dropped.push(prefix + key);
    if (r.sectors != null && (!Array.isArray(r.sectors) || r.sectors.length !== 3 || r.sectors.some((s) => s !== null && !isNum(s, 1, 3600)))) dropped.push(prefix + 'sectors');
    if (r.ghost != null && !cleanGhost(r.ghost)) dropped.push(prefix + 'ghost');
    if ((r.v ?? r.trackV) != null && !isStr(r.v ?? r.trackV, 120)) dropped.push(prefix + 'trackV');
  };
  noteRecord(src);
  for (const field of ['records', 'circuits'] as const) if (src[field] && typeof src[field] === 'object') {
    for (const [key, raw] of Object.entries(src[field])) noteRecord(raw, `${field}.${key}.`);
  }
  return { ok: true, save: out, dropped: [...new Set(dropped)] };
}
export const save = loadSave();
// 舊版未記錄規則，保留原資料但不猜測放進經典或2026榜。
const legacyTaipei: TrackRec = { best: save.best, sectors: save.sectors, ghost: save.ghost, v: save.trackV, gpBest: save.gpBest ?? null };
const legacyCircuits = save.circuits ?? {};
let activeRules: RaceRules = (new URLSearchParams(location.search).get('rules') ?? save.opts['opt-rules']) === '2026' ? '2026' : 'classic';
const emptyRecord = (): TrackRec => ({ best: null, sectors: [null, null, null], ghost: null, gpBest: null });
export const recordKey = (id: string, rules: RaceRules) => `${id || 'taipei'}:${rules}:${RECORD_VERSION}`;
const applyRecord = (r: TrackRec) => Object.assign(save, { best: r.best, sectors: [...r.sectors], ghost: r.ghost, trackV: r.v, gpBest: r.gpBest ?? null });
function storeActiveRecord() { (save.records ??= {})[recordKey(CIRCUIT_ID ?? '', activeRules)] = { best: save.best, sectors: [...save.sectors], ghost: save.ghost, v: save.trackV, gpBest: save.gpBest ?? null }; }
function serializedSave(): Save { storeActiveRecord(); return { ...save, schema: 3, best: legacyTaipei.best, sectors: legacyTaipei.sectors, ghost: legacyTaipei.ghost, gpBest: legacyTaipei.gpBest, trackV: legacyTaipei.v, circuits: legacyCircuits }; }
applyRecord(save.records?.[recordKey(CIRCUIT_ID ?? '', activeRules)] ?? emptyRecord());
export const selectedRecordRules = () => activeRules;
export function selectRecordRules(rules: RaceRules) { if (rules === activeRules) return; storeActiveRecord(); activeRules = rules; applyRecord(save.records?.[recordKey(CIRCUIT_ID ?? '', rules)] ?? emptyRecord()); }
export function legacyBestLapOf(id: string) { return (!id ? legacyTaipei : legacyCircuits[id])?.best ?? null; }
export function ghostOf(id: string, rules = activeRules): Ghost | null { return id === (CIRCUIT_ID ?? '') && rules === activeRules ? save.ghost : save.records?.[recordKey(id, rules)]?.ghost ?? null; }
export function stampOf(id: string, rules = activeRules): string | undefined { return id === (CIRCUIT_ID ?? '') && rules === activeRules ? save.trackV : save.records?.[recordKey(id, rules)]?.v; }
export function playerIdentity(): string { if (!save.playerId || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(save.playerId)) { save.playerId = randomUuid(); writeSave(); } return save.playerId; }
export function prepareImportedSave(s: Save, dropped: string[] = []): { save: Save; preserved: string[] } {
  const current = serializedSave(), out = { ...s }, preserved: string[] = [];
  for (const k of ['season', 'seasonHistory', 'freePos', 'records', 'damage', 'ledger', 'playerId', 'driftChallenge', 'streetChallenge', 'streetSeries', 'taxiJob', 'taxiSettled', 'progress'] as const) if ((s[k] === undefined || dropped.some((name) => name === k || name.startsWith(k + '.'))) && current[k] !== undefined) { Object.assign(out, { [k]: current[k] }); preserved.push(k); }
  return { save: out, preserved };
}
/**
 * 套用匯入的存檔：直接寫進 localStorage 再讓 main 重新載入頁面（所有模組都從頭讀存檔，最不容易漏掉哪個狀態）。
 * 寫不進去（無痕模式、容量滿）回傳 false
 */
export function writeImported(s: Save, options: SaveRecoveryOptions = {}): boolean {
  if (reloadRequired) return false;
  if (!checkWriterCurrent().ok) return false;
  if (recovery.blocked && !preserveRecoveryOriginal(options).ok) return false;
  try {
    const before = localStorage.getItem(KEY);
    if (before) {
      try { writeWithSnapshotSpace(KEY + '-before-restore', before); }
      catch (e) { if (!recovery.blocked || !options.originalExported) throw e; } // 救援時已由玩家另存副本，這份重複副本寫不進去才可略過。
    }
    const raw = JSON.stringify(s), parsed = parseSaveFile(raw);
    if (!parsed.ok || criticalSaveDrops(parsed.dropped).length) return false;
    writeWithSnapshotSpace(KEY, raw); expectedRaw = raw; rememberGood(raw);
    reloadRequired = true; // main 延遲重新載入期間，舊記憶體也不能再自動覆寫剛匯入的資料。
    return true;
  } catch { return false; }
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
  return save.records?.[recordKey(id, activeRules)]?.best ?? null;
}
/** 某條賽道的「正賽最快圈」（大獎賽裡跑出來的最快一圈；吃尾流、車陣裡鑽出來的，不跟計時賽的最快圈混在一起） */
export function gpBestLapOf(id: string): number | null {
  if (id === (CIRCUIT_ID ?? '')) return save.gpBest ?? null;
  return save.records?.[recordKey(id, activeRules)]?.gpBest ?? null;
}
