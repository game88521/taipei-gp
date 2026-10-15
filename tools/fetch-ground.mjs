// 全圖的地面高度（原始資料）：OpenTopoData 的 NASA SRTM 30 m，每 30 m 一點（約 300 × 180 格）
// 免費 API：每次 100 點、每秒 1 次、每天 1000 次 → 全圖約 540 次、10 分鐘。
// 輸出 tools/ground-cache/srtm30-30m.json：{ x0, z0, step, nx, nz, h }（h 是海拔公尺，含大樓與樹冠；過濾在 build-city.mjs 做）
// 中途斷掉：重跑會接著抓（每 20 次存一次進度）
// 用法：node tools/fetch-ground.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
// 跟 build-city.mjs 一樣的投影與範圍（BBOX 南、西、北、東）
const LAT0 = 25.0375, LON0 = 121.562, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KZ = 110574;
const BBOX = [25.02, 121.5, 25.068, 121.59];
const proj = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const unproj = (x, z) => [LAT0 - z / KZ, LON0 + x / KX];
const STEP = 30;
const [xa, za] = proj(BBOX[2], BBOX[1]), [xb, zb] = proj(BBOX[0], BBOX[3]);
const x0 = Math.floor(Math.min(xa, xb) / STEP) * STEP - STEP * 4, x1 = Math.ceil(Math.max(xa, xb) / STEP) * STEP + STEP * 4;
const z0 = Math.floor(Math.min(za, zb) / STEP) * STEP - STEP * 4, z1 = Math.ceil(Math.max(za, zb) / STEP) * STEP + STEP * 4;
const nx = (x1 - x0) / STEP + 1, nz = (z1 - z0) / STEP + 1;

mkdirSync(here('./ground-cache/'), { recursive: true });
const out = here('./ground-cache/srtm30-30m.json');
const part = here('./ground-cache/srtm30-30m.part.json');
let h = existsSync(part) ? JSON.parse(readFileSync(part, 'utf8')).h : [];
if (existsSync(out)) { console.log('已經有了：', out); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function query(locs) {
  for (let a = 0; a < 8; a++) {
    try {
      const r = await fetch('https://api.opentopodata.org/v1/srtm30m?locations=' + locs.map(([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`).join('|'));
      if (r.ok) { const d = await r.json(); if (d.status === 'OK') return d.results.map((x) => x.elevation ?? 0); }
    } catch { /* 再試 */ }
    await sleep(4000);
  }
  throw new Error('海拔查詢失敗（可能超過每天 1000 次的上限，明天再接著跑）');
}
const total = nx * nz;
console.log(`地面高度：${nx} × ${nz} = ${total} 點，從第 ${h.length} 點接著抓`);
let calls = 0;
while (h.length < total) {
  const locs = [];
  for (let k = h.length; k < Math.min(total, h.length + 100); k++) locs.push(unproj(x0 + (k % nx) * STEP, z0 + Math.floor(k / nx) * STEP));
  h.push(...(await query(locs)));
  if (++calls % 20 === 0) { writeFileSync(part, JSON.stringify({ h })); console.log(`  ${h.length} / ${total}`); }
  await sleep(1100);
}
writeFileSync(out, JSON.stringify({ x0, z0, step: STEP, nx, nz, h: h.map((v) => Math.round(v * 10) / 10) }));
console.log('完成：', out);
