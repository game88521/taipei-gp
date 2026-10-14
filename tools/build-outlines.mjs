// 選賽道頁的賽道外型小圖：每條賽道的中心線縮成 100 × 100 方框裡約 120 點的 SVG 路徑（＋起點位置），
// 寫到 public/data/circuits/outlines.json（選單一次抓這個小檔，不用下載 23 條完整賽道）
// 台北信義街道賽用 src/data/track.json；各國賽道用 public/data/circuits/{id}.json（tools/build-circuits.mjs 產生）
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const tracks = { taipei: JSON.parse(readFileSync(here('../src/data/track.json'), 'utf8')).points };
for (const f of readdirSync(here('../public/data/circuits/'))) {
  if (!f.endsWith('.json') || f === 'outlines.json') continue;
  tracks[f.replace('.json', '')] = JSON.parse(readFileSync(here(`../public/data/circuits/${f}`), 'utf8')).points;
}
const out = {};
for (const [id, pts] of Object.entries(tracks)) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  // 等比例縮進 100 × 100（四邊留 6），置中；遊戲的 z 朝南，畫成 SVG 的 y（北在上，跟大地圖一樣）
  const k = 88 / Math.max(x1 - x0, z1 - z0), ox = (100 - (x1 - x0) * k) / 2, oz = (100 - (z1 - z0) * k) / 2;
  const P = ([x, z]) => [+(ox + (x - x0) * k).toFixed(1), +(oz + (z - z0) * k).toFixed(1)];
  const step = Math.max(1, Math.floor(pts.length / 120));
  const s = [];
  for (let i = 0; i < pts.length; i += step) s.push(P(pts[i]));
  out[id] = { d: 'M' + s.map(([a, b]) => `${a} ${b}`).join('L') + 'Z', start: P(pts[0]) };
}
writeFileSync(here('../public/data/circuits/outlines.json'), JSON.stringify(out));
console.log(`賽道外型 ${Object.keys(out).length} 條 → public/data/circuits/outlines.json`);
