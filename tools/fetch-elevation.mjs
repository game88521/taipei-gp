// 各國賽道的高低起伏：沿賽道每 40 m 查一次海拔（OpenTopoData 的 NASA SRTM 30 m 資料，免費 API：每次 100 點、每秒 1 次），
// 沿賽道平滑（SRTM 有 ±5 m 左右的雜訊）、限制坡度（真的 F1 最陡的 Eau Rouge 約 17~18%），內插回每 4 m 一點，
// 寫進 public/data/circuits/{id}.json 的 elev（相對起跑線的高度，公尺）
// 用法：node tools/fetch-elevation.mjs（快取在 tools/circuits-cache/elev-{id}.json）
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dir = here('../public/data/circuits/');
const STEP = 10; // 每 10 點（4 m × 10 = 40 m）查一次
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(locs) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch('https://api.opentopodata.org/v1/srtm30m?locations=' + locs.map(([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`).join('|'));
      if (r.ok) { const d = await r.json(); if (d.status === 'OK') return d.results.map((x) => x.elevation ?? 0); }
    } catch { /* 再試 */ }
    await sleep(3000);
  }
  throw new Error('海拔查詢失敗');
}

for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(dir + f, 'utf8'));
  const cache = here(`./circuits-cache/elev-${c.id}.json`);
  const [lat0, lon0] = c.origin, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110574;
  const idx = [];
  for (let i = 0; i < c.points.length; i += STEP) idx.push(i);
  let raw;
  if (existsSync(cache)) raw = JSON.parse(readFileSync(cache, 'utf8'));
  else {
    raw = [];
    for (let k = 0; k < idx.length; k += 100) {
      const locs = idx.slice(k, k + 100).map((i) => { const [x, z] = c.points[i]; return [lat0 - z / kz, lon0 + x / kx]; });
      raw.push(...(await query(locs)));
      await sleep(1100);
    }
    writeFileSync(cache, JSON.stringify(raw));
  }
  // 沿賽道平滑（前後各 2 個取樣點 ≈ ±80 m，做三次）
  const n = raw.length;
  let e = raw.slice();
  for (let pass = 0; pass < 3; pass++) e = e.map((_, i) => { let s = 0; for (let k = -2; k <= 2; k++) s += e[(i + k + n) % n]; return s / 5; });
  // 內插回每個點；以起跑線為 0
  const N = c.points.length, out = new Array(N);
  for (let i = 0; i < N; i++) {
    const f2 = i / STEP, a = Math.floor(f2) % n, b = (a + 1) % n, t = f2 - Math.floor(f2);
    out[i] = e[a] + (e[b] - e[a]) * t;
  }
  // 限制坡度：每 4 m 最多 0.72 m（18%），往前往後各掃一次
  const MAXD = 4 * 0.18;
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N; i++) {
    const d = out[i] - out[i - 1];
    if (Math.abs(d) > MAXD) out[i] = out[i - 1] + Math.sign(d) * MAXD;
  }
  const base = out[0];
  c.elev = out.map((v) => +(v - base).toFixed(2));
  const lo = Math.min(...c.elev), hi = Math.max(...c.elev);
  let maxG = 0;
  for (let i = 5; i < N; i += 5) maxG = Math.max(maxG, Math.abs(c.elev[i] - c.elev[i - 5]) / 20);
  writeFileSync(dir + f, JSON.stringify(c));
  console.log(`${c.id.padEnd(11)} 高低差 ${(hi - lo).toFixed(0).padStart(3)} m（${lo.toFixed(0)} ~ +${hi.toFixed(0)}）最陡約 ${(maxG * 100).toFixed(0)}%`);
}
