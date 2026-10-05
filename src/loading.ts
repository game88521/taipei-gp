// 載入進度：各階段之間讓出主執行緒（畫面才會更新、不會整個卡住），並記下每段花多久（?prof 會印在標題）

type Handler = (label: string, frac: number) => void;
let handler: Handler = () => {};
export function onProgress(h: Handler) { handler = h; }

export const marks: [string, number][] = [];
let lastLabel = '開始', lastT = performance.now();

/** 進入下一個階段：回報進度、記錄上一段耗時、讓瀏覽器畫一格 */
export async function stage(label: string, frac: number) {
  const now = performance.now();
  marks.push([lastLabel, Math.round(now - lastT)]);
  lastLabel = label;
  handler(label, frac);
  await new Promise((r) => setTimeout(r, 0));
  lastT = performance.now();
}

/** 只回報進度、不讓出（下載中途用） */
export function report(label: string, frac: number) { handler(label, frac); }

/** 下載並回報進度；expected 是解壓縮後的大約位元組數（伺服器壓縮傳輸時 Content-Length 不準） */
export async function fetchJson<T>(url: string, expected: number, label: string, from: number, to: number): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  if (!res.body) return res.json() as Promise<T>;
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
  let got = 0, lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    const now = performance.now();
    if (now - lastReport > 80) { lastReport = now; report(`${label} ${(got / 1048576).toFixed(1)} MB`, from + (to - from) * Math.min(1, got / expected)); }
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  await stage('解析地圖資料', to);
  return JSON.parse(new TextDecoder().decode(all)) as T;
}
