// 載入進度：各階段之間讓出主執行緒（畫面才會更新、不會整個卡住），並記下每段花多久（?prof 會印在標題）
import { DownloadError, requestJson, type DownloadOptions } from './network';

type Handler = (label: string, frac: number) => void;
let handler: Handler = () => {};
export function onProgress(h: Handler) { handler = h; }

export const marks: [string, number][] = [];
let lastLabel = '開始', lastT = performance.now();

/** 進入下一個階段：回報進度、記錄上一段耗時、讓瀏覽器畫一格 */
export async function stage(label: string, frac: number) {
  const now = performance.now();
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  marks.push([lastLabel + (mem ? `(${Math.round(mem.usedJSHeapSize / 1e6)}MB)` : ''), Math.round(now - lastT)]); // ?prof：每段結束時的 JS 記憶體
  lastLabel = label;
  handler(label, frac);
  await new Promise((r) => setTimeout(r, 0));
  lastT = performance.now();
}

/** 只回報進度、不讓出（下載中途用） */
export function report(label: string, frac: number) { handler(label, frac); }

/**
 * 提前發出下載：主程式一開始就叫（台北街景），不用等後面約 2 秒的同步工作（建賽道、天空、環境反射）做完才開始下載。
 * fetchJson 同一個網址會直接接手這個請求；失敗的話丟掉，fetchJson 照舊重新請求並自己報錯
 */
type EarlyDownload = { task: ReturnType<typeof requestJson<unknown>>; progress?: (bytes: number) => void };
const early = new Map<string, EarlyDownload>();
export function prefetch(url: string, options: DownloadOptions = {}) {
  if (early.has(url)) return;
  const entry = {} as EarlyDownload;
  entry.task = requestJson(url, { label: '地圖資料', ...options, onProgress: (bytes) => { options.onProgress?.(bytes); entry.progress?.(bytes); } });
  entry.task.promise.catch(() => { if (early.get(url) === entry) early.delete(url); });
  early.set(url, entry);
}

export function cancelPrefetch(url?: string) {
  for (const [key, entry] of early) if (url === undefined || key === url) { entry.task.cancel(); early.delete(key); }
}

/** 下載並回報進度；expected 是解壓縮後的大約位元組數（伺服器壓縮傳輸時 Content-Length 不準） */
export async function fetchJson<T>(url: string, expected: number, label: string, from: number, to: number, options: DownloadOptions = {}): Promise<T> {
  if (options.signal?.aborted) throw new DownloadError('下載已取消。', 'cancelled');
  const pre = early.get(url);
  early.delete(url);
  let lastReport = 0;
  const progress = (got: number) => {
    options.onProgress?.(got);
    const now = performance.now();
    if (now - lastReport > 80) { lastReport = now; report(`${label} ${(got / 1048576).toFixed(1)} MB`, from + (to - from) * Math.min(1, got / expected)); }
  };
  const task = pre?.task ?? requestJson<T>(url, { ...options, label, onProgress: progress });
  if (pre) pre.progress = progress;
  const abort = () => task.cancel();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let data: T;
  try { data = await task.promise as T; }
  finally { options.signal?.removeEventListener('abort', abort); }
  await stage('解析地圖資料', to);
  return data;
}
