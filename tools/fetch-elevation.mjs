// 各國賽道的高低起伏：沿賽道每 40 m 查一次海拔（OpenTopoData 免費 API：每次 100 點、每秒 1 次），
// 寫進 public/data/circuits/{id}.json 的 elev（相對起跑線的高度，公尺）與 alt（賽道平均海拔，公尺；物理用來算空氣密度）
// 資料來源：
//   美國三站（COTA、邁阿密、拉斯維加斯）用 USGS 3DEP 1/3 角秒（ned10m，10 m、去掉建物與樹的「地面」高度）
//   其他用 NASA SRTM 30 m（srtm30m）：量的是「表面」高度，會把大樓、高架、樹冠算進去 →
//   街道賽改取「前後 ±200 m 內偏低的那四分之一」（第 25 百分位）當地面：大樓、高架、樹冠連成一片也能排掉
// 之後沿賽道平滑（SRTM 有 ±5 m 左右的雜訊，平滑三次；ned10m 雜訊小，只平滑一次，才不會把陡坡磨平）、限制坡度（真的 F1 最陡的 Eau Rouge 約 17~18%），內插回每 4 m 一點，
// 最後把過線處的高度接縫（取樣不等距造成的台階）沿整圈線性分攤掉
// 用法：node tools/fetch-elevation.mjs（快取在 tools/circuits-cache/elev-{id}[-資料集].json）
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dir = here('../public/data/circuits/');
const STEP = 10; // 每 10 點（4 m × 10 = 40 m）查一次
const DATASET = { usa: 'ned10m', miami: 'ned10m', lasvegas: 'ned10m' };
const STREET = new Set(['australia', 'monaco', 'madrid', 'azerbaijan', 'singapore', 'lasvegas']); // 兩旁有建物或樹林的街道賽
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(ds, locs) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(`https://api.opentopodata.org/v1/${ds}?locations=` + locs.map(([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`).join('|'));
      if (r.ok) { const d = await r.json(); if (d.status === 'OK') return d.results.map((x) => x.elevation ?? 0); }
    } catch { /* 再試 */ }
    await sleep(3000);
  }
  throw new Error('海拔查詢失敗');
}
/** 沿賽道（頭尾相接）每點取前後 w 個取樣裡的第 q 百分位 */
const quantile = (a, w, q) => a.map((_, i) => { const v = []; for (let k = -w; k <= w; k++) v.push(a[(i + k + a.length) % a.length]); v.sort((x, y) => x - y); return v[Math.round((v.length - 1) * q)]; });

for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'outlines.json')) {
  const c = JSON.parse(readFileSync(dir + f, 'utf8'));
  const ds = DATASET[c.id] ?? 'srtm30m';
  const cache = here(`./circuits-cache/elev-${c.id}${ds === 'srtm30m' ? '' : '-' + ds}.json`);
  const [lat0, lon0] = c.origin, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110574;
  const idx = [];
  for (let i = 0; i < c.points.length; i += STEP) idx.push(i);
  let raw;
  if (existsSync(cache)) raw = JSON.parse(readFileSync(cache, 'utf8'));
  else {
    raw = [];
    for (let k = 0; k < idx.length; k += 100) {
      const locs = idx.slice(k, k + 100).map((i) => { const [x, z] = c.points[i]; return [lat0 - z / kz, lon0 + x / kx]; });
      raw.push(...(await query(ds, locs)));
      await sleep(1100);
    }
    writeFileSync(cache, JSON.stringify(raw));
  }
  const n = raw.length;
  let e = raw.slice();
  // 排掉大樓、高架、樹冠；新加坡市中心整片高樓（原始資料有 2.5 km 被墊高 15~30 m），窗開大、取更低的一成
  if (STREET.has(c.id) && ds === 'srtm30m') e = c.id === 'singapore' ? quantile(e, 8, 0.1) : quantile(e, 5, 0.25);
  // 沿賽道平滑（前後各 2 個取樣點 ≈ ±80 m，做三次）
  for (let pass = 0; pass < (ds === 'ned10m' ? 1 : 3); pass++) e = e.map((_, i) => { let s = 0; for (let k = -2; k <= 2; k++) s += e[(i + k + n) % n]; return s / 5; });
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
  // 頭尾接縫：取樣不等距（最後一個取樣到繞回起跑線之間只有 N%10 點，不是 10 點），上面的內插走不完最後一段，
  // 剩下的高度差全堆在過線那一步（斯帕多出約 0.75 m，就是過線前那個突然的隆起）。
  // 量出「過線那一步比前後各 6 步的平均多出多少」E，沿整圈線性分攤：每點加 E × i / N，起跑線不動，整圈只微微傾斜。
  // 不改成按實際點數內插：差值被擠進最後 2~3 點，那幾步會陡到 3 倍（斯帕前兩步各 35 cm、鈴鹿 −60 cm，自然是 10~12 cm），變成新的隆起
  const M = 6, rise = (k) => out[(k + 1) % N] - out[k];
  let nat = 0;
  for (let k = 1; k <= M; k++) nat += rise(N - 1 - k) + rise(k - 1);
  const E = rise(N - 1) - nat / (2 * M);
  for (let i = 0; i < N; i++) out[i] += (E * i) / N;
  const base = out[0];
  c.elev = out.map((v) => +(v - base).toFixed(2));
  c.alt = Math.round([...raw].sort((a, b) => a - b)[Math.floor(n / 2)]); // 平均海拔（中位數）
  c.elevSource = ds;
  const lo = Math.min(...c.elev), hi = Math.max(...c.elev);
  let maxG = 0;
  for (let i = 5; i < N; i += 5) maxG = Math.max(maxG, Math.abs(c.elev[i] - c.elev[i - 5]) / 20);
  writeFileSync(dir + f, JSON.stringify(c));
  console.log(`${c.id.padEnd(11)} ${ds.padEnd(7)} 海拔 ${String(c.alt).padStart(5)} m  高低差 ${(hi - lo).toFixed(0).padStart(3)} m（${lo.toFixed(0)} ~ +${hi.toFixed(0)}）最陡約 ${(maxG * 100).toFixed(0)}%`);
}
