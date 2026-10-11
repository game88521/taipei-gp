// 背景執行緒：下載城市區塊、解析 JSON、算外牆／屋頂／招牌的頂點（tilegen.ts），算好轉移回主執行緒建網格。
// 主執行緒開車時只做建網格、登記碰撞這些輕的事，不會因為蓋房子而頓一下
import { decodeTile } from './citydata';
import { genTile, makeCtx, transferables, type GenCtx, type GenInit } from './tilegen';

let ctx: GenCtx | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: 'init'; init: GenInit } | { type: 'tile'; id: number; url: string; tag: number };
  if (m.type === 'init') { ctx = makeCtx(m.init); return; }
  try {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = genTile(decodeTile(await res.json()), m.tag, ctx!);
    (self as unknown as Worker).postMessage({ id: m.id, out }, transferables(out));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String(err) });
  }
};
