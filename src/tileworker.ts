// 背景執行緒：下載城市區塊、解析 JSON、算外牆／屋頂／招牌的頂點（tilegen.ts），算好轉移回主執行緒建網格。
// 主執行緒分批建網格、最後發布碰撞；原生幾何呼叫與GPU上傳時間仍依裝置而定。
import { decodeTile } from './citydata';
import { genTile, makeCtx, transferables, type GenCtx, type GenInit } from './tilegen';
import { fetchJsonWithRetry } from './network';

let ctx: GenCtx | null = null;
const requests = new Map<number, AbortController>();

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: 'init'; init: GenInit } | { type: 'tile'; id: number; url: string; tag: number } | { type: 'cancel'; id: number };
  if (m.type === 'init') { ctx = makeCtx(m.init); return; }
  if (m.type === 'cancel') { requests.get(m.id)?.abort(); requests.delete(m.id); return; }
  const controller = new AbortController(); requests.set(m.id, controller);
  try {
    const data = await fetchJsonWithRetry<Parameters<typeof decodeTile>[0]>(m.url, { label: '城市區塊', signal: controller.signal });
    if (controller.signal.aborted) return;
    const out = genTile(decodeTile(data), m.tag, ctx!);
    if (controller.signal.aborted) return;
    (self as unknown as Worker).postMessage({ id: m.id, out }, transferables(out));
  } catch (err) {
    if (!controller.signal.aborted) (self as unknown as Worker).postMessage({ id: m.id, error: String(err) });
  } finally { requests.delete(m.id); }
};
