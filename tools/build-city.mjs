// 把 tools/osm-raw.json（fetch-osm 下載的 OpenStreetMap 資料）轉成遊戲用的 src/data/city.json：
//   - 賽道：沿真實道路接成一圈（信義路 → 基隆路 → 忠孝東路 → 松仁路），路口直角修成圓弧
//   - 建築：輪廓 + 高度（有 building:part 的建築改畫各個部件，101 就是這樣長出真實形狀）
//   - 周邊道路、公園綠地、行道樹
// 用法：npm run build-city（改了賽道路線或篩選規則才需要重跑）
// 資料授權：© OpenStreetMap contributors，ODbL
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const raw = JSON.parse(readFileSync(here('./osm-raw.json'), 'utf8'));
const E = raw.elements;

// ---------------------------------------------------------------- 座標：以信義區中心為原點，x 向東、z 向南（公尺）
const LAT0 = 25.0375, LON0 = 121.562;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KZ = 110574;
const proj = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const r1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- 賽道：每一邊取那條路「行車方向正確」的車道，沿路的走向整理成一條線
// 不用路網找路：基隆路往北過了松壽路，主車道就進了車行地下道，地面上沒有連續的路可走。
// 遊戲是在地面上跑，只需要道路的平面走向，所以地下道的平面幾何也照樣採用（限高 2 m 的機車地下道除外）。
const DRIVE = /^(primary|secondary|tertiary|unclassified)$/;
const nodePos = new Map(); // node id → [x, z]
const roadWays = [];
for (const e of E) {
  const t = e.tags || {};
  if (e.type !== 'way' || !t.highway || !e.geometry) continue;
  roadWays.push(e);
  e.nodes.forEach((id, k) => nodePos.set(id, proj(e.geometry[k].lat, e.geometry[k].lon)));
}

// 路口位置：兩條路共用節點的平均
function junction(p1, p2) {
  const ids = (p) => {
    const s = new Set();
    for (const e of roadWays) {
      const n = e.tags.name || '';
      if (n.startsWith(p) && !n.includes('巷') && !n.includes('地下道')) e.nodes.forEach((id) => s.add(id));
    }
    return s;
  };
  const a = ids(p1), b = ids(p2);
  const pts = [...a].filter((id) => b.has(id)).map((id) => nodePos.get(id));
  if (!pts.length) throw new Error(`${p1} × ${p2} 沒有交會點`);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** 一條邊：A 路口 → B 路口，取名稱符合、方向跟 A→B 一致的車道，每 8 m 一格平均橫向位置 */
function side(re, A, B) {
  const ax = B[0] - A[0], az = B[1] - A[1], L = Math.hypot(ax, az), ux = ax / L, uz = az / L;
  const STEP = 8, nb = Math.floor(L / STEP) + 1;
  const sum = new Float64Array(nb), cnt = new Float64Array(nb);
  for (const e of roadWays) {
    const t = e.tags, n = t.name || '';
    if (!DRIVE.test(t.highway) || !re.test(n) || n.includes('巷')) continue;
    if (t.maxheight && Number(t.maxheight) < 3) continue;
    const ps = e.geometry.map((g) => proj(g.lat, g.lon));
    for (let k = 0; k + 1 < ps.length; k++) {
      const p = ps[k], q = ps[k + 1];
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      if (l < 0.5) continue;
      const c = (dx * ux + dz * uz) / l;
      if (t.oneway === 'yes' ? c < 0.7 : Math.abs(c) < 0.7) continue; // 對向車道、橫向的路不要
      for (let s = 0; s <= l; s += 2) {
        const x = p[0] + (dx * s) / l, z = p[1] + (dz * s) / l;
        const along = (x - A[0]) * ux + (z - A[1]) * uz, lat = -(x - A[0]) * uz + (z - A[1]) * ux;
        if (along < 0 || along > L || Math.abs(lat) > 160) continue;
        const b = Math.min(nb - 1, Math.round(along / STEP));
        sum[b] += lat;
        cnt[b]++;
      }
    }
  }
  const lat = new Float64Array(nb).fill(NaN);
  for (let b = 0; b < nb; b++) if (cnt[b]) lat[b] = sum[b] / cnt[b];
  const known = [...lat.keys()].filter((b) => !Number.isNaN(lat[b]));
  if (known.length < nb * 0.5) throw new Error(`${re} 的資料太少（${known.length}/${nb} 格）`);
  for (let b = 0; b < nb; b++) {
    if (!Number.isNaN(lat[b])) continue;
    const lo = known.filter((k) => k < b).pop(), hi = known.find((k) => k > b);
    lat[b] = lo == null ? lat[hi] : hi == null ? lat[lo] : lat[lo] + ((lat[hi] - lat[lo]) * (b - lo)) / (hi - lo);
  }
  const sm = [...lat].map((_, b) => {
    let s = 0, n = 0;
    for (let k = -7; k <= 7; k++) if (lat[b + k] !== undefined) { s += lat[b + k]; n++; }
    return s / n;
  });
  return sm.map((l, b) => [A[0] + ux * b * STEP - uz * l, A[1] + uz * b * STEP + ux * l]);
}

const J = {
  sw: junction('信義路', '基隆路一段'),
  nw: junction('忠孝東路', '基隆路一段'),
  ne: junction('忠孝東路', '松仁路'),
  se: junction('信義路', '松仁路'),
};
// 順時針：信義路往西 → 基隆路往北 → 忠孝東路往東 → 松仁路往南
const sides = [
  side(/^信義路/, J.se, J.sw),
  side(/^基隆路(一段|車行地下道)/, J.sw, J.nw),
  side(/^忠孝東路/, J.nw, J.ne),
  side(/^松仁路/, J.ne, J.se),
];
// 兩端各去掉 40 m（路口裡的資料亂），轉角用前後兩段延長線的交點
const TRIM = 5; // 格數 × 8 m
let line = [];
for (let k = 0; k < 4; k++) {
  const s = sides[k].slice(TRIM, -TRIM), n = sides[(k + 1) % 4].slice(TRIM, -TRIM);
  line.push(...s);
  const [p1, p2] = [s[s.length - 2], s[s.length - 1]], [q1, q2] = [n[0], n[1]];
  const d1 = [p2[0] - p1[0], p2[1] - p1[1]], d2 = [q2[0] - q1[0], q2[1] - q1[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) > 1e-6) {
    const tt = ((q1[0] - p2[0]) * d2[1] - (q1[1] - p2[1]) * d2[0]) / den;
    line.push([p2[0] + d1[0] * tt, p2[1] + d1[1] * tt]);
  }
}

// ---------------------------------------------------------------- 線形處理
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  let md = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / l;
    if (d > md) { md = d; mi = i; }
  }
  if (md < eps) return [a, b];
  return [...rdp(pts.slice(0, mi + 1), eps).slice(0, -1), ...rdp(pts.slice(mi), eps)];
}
// 閉合線：從離起點最遠的點切開再簡化，避免切點被當成轉角
{
  let far = 0, fd = 0;
  line.forEach((p, i) => { const d = Math.hypot(p[0] - line[0][0], p[1] - line[0][1]); if (d > fd) { fd = d; far = i; } });
  const a = rdp(line.slice(0, far + 1), 2), b = rdp([...line.slice(far), line[0]], 2);
  line = [...a.slice(0, -1), ...b.slice(0, -1)];
}

// 路口直角 → 圓弧（半徑 R，受前後直線長度限制）
function fillet(pts, R) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const ax = p0[0] - p1[0], az = p0[1] - p1[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)))); // 內角
    const turn = Math.PI - ang;
    if (turn < 0.25) { out.push(p1); continue; }
    let t = R / Math.tan(ang / 2);
    t = Math.min(t, la * 0.45, lb * 0.45);
    const r = t * Math.tan(ang / 2);
    const s = [p1[0] + (ax / la) * t, p1[1] + (az / la) * t];
    const e = [p1[0] + (bx / lb) * t, p1[1] + (bz / lb) * t];
    // 圓心：沿角平分線
    const hx = ax / la + bx / lb, hz = az / la + bz / lb, hl = Math.hypot(hx, hz);
    const dc = r / Math.sin(ang / 2);
    const c = [p1[0] + (hx / hl) * dc, p1[1] + (hz / hl) * dc];
    const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
    let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    let da = a1 - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const steps = Math.max(2, Math.ceil((Math.abs(da) * r) / 3));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (da * k) / steps;
      out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
  }
  return out;
}
line = fillet(line, 24);

// 往左（中央分隔島那側）平移，給右側人行道和店面多一點空間
function offsetLeft(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    // 右 = (-tz, tx)，往左就是減掉
    return [p[0] + (tz / l) * d, p[1] - (tx / l) * d];
  });
}
line = offsetLeft(line, 2.5);

// 均勻重取樣（每 4 m 一點）
function resample(pts, step) {
  const closed = [...pts, pts[0]];
  const out = [closed[0]];
  let carry = 0;
  for (let i = 0; i + 1 < closed.length; i++) {
    const [a, b] = [closed[i], closed[i + 1]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = step - carry;
    while (s < l) {
      out.push([a[0] + ((b[0] - a[0]) * s) / l, a[1] + ((b[1] - a[1]) * s) / l]);
      s += step;
    }
    carry = l - (s - step);
  }
  if (Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5) out.pop();
  return out;
}
line = resample(line, 4);

// 起跑線放在信義路上、101 正前方
const b101 = E.find((e) => e.type === 'way' && e.tags?.name === '台北101' && e.tags.building);
const c101 = b101 ? b101.geometry.reduce((s, g) => { const p = proj(g.lat, g.lon); return [s[0] + p[0] / b101.geometry.length, s[1] + p[1] / b101.geometry.length]; }, [0, 0]) : [0, 0];
let si = 0, sd = Infinity;
line.forEach((p, i) => { const d = Math.abs(p[0] - c101[0]) + (p[1] > c101[1] ? 0 : 1e6); if (d < sd) { sd = d; si = i; } });
// 起跑線在 101 前方 180 m，起跑後直衝、101 從右手邊經過
si = (si - 45 + line.length) % line.length;
line = [...line.slice(si), ...line.slice(0, si)];

let length = 0;
for (let i = 0; i < line.length; i++) {
  const a = line[i], b = line[(i + 1) % line.length];
  length += Math.hypot(b[0] - a[0], b[1] - a[1]);
}
console.log(`賽道：${line.length} 點，約 ${(length / 1000).toFixed(2)} km`);
console.log('路口', Object.fromEntries(Object.entries(J).map(([k, v]) => [k, v.map(Math.round)])));
console.log('101 中心', c101.map(Math.round));

mkdirSync(here('../src/data/'), { recursive: true });
writeFileSync(here('../src/data/track.json'), JSON.stringify({ origin: [LAT0, LON0], tower101: c101.map(r1), points: line.map(([x, z]) => [r1(x), r1(z)]) }));

// ================================================================ 城市
const TRACK_CLEAR = 11; // 建築／樹離賽道中心線至少這麼遠（護牆 9.5 m + 1.5 m）
const VIEW = 900; // 離賽道超過這距離的東西不要（霧裡也看不到）

// 賽道的空間索引：每 40 m 一格，查「離賽道多遠」
const TG = 40, tgrid = new Map();
line.forEach((p, i) => {
  const k = `${Math.floor(p[0] / TG)},${Math.floor(p[1] / TG)}`;
  if (!tgrid.has(k)) tgrid.set(k, []);
  tgrid.get(k).push(i);
});
function distToTrack(x, z, maxR = 60) {
  let best = Infinity;
  const r = Math.ceil(maxR / TG), cx = Math.floor(x / TG), cz = Math.floor(z / TG);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    for (const i of tgrid.get(`${cx + a},${cz + b}`) || []) {
      const p = line[i], q = line[(i + 1) % line.length];
      const dx = q[0] - p[0], dz = q[1] - p[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / l2));
      best = Math.min(best, Math.hypot(x - p[0] - dx * t, z - p[1] - dz * t));
    }
  }
  return best;
}
// 粗略距離（給 VIEW 篩選用）：每 10 點取一點
const coarse = line.filter((_, i) => i % 10 === 0);
const farFromTrack = (x, z) => coarse.every((p) => Math.hypot(p[0] - x, p[1] - z) > VIEW);

const ring = (geom) => geom.map((g) => proj(g.lat, g.lon));
const centroid = (r) => r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
function inside(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > pt[1]) !== (r[j][1] > pt[1]) && pt[0] < ((r[j][0] - r[i][0]) * (pt[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}
function area(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}
// multipolygon 的外環：把零散的 way 頭尾接起來
function outerRings(rel) {
  const segs = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => ring(m.geometry));
  const out = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  while (segs.length) {
    let cur = segs.shift();
    let grew = true;
    while (grew && !close(cur[0], cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s2 = segs[i], end = cur[cur.length - 1];
        if (close(s2[0], end)) cur = [...cur, ...s2.slice(1)];
        else if (close(s2[s2.length - 1], end)) cur = [...cur, ...[...s2].reverse().slice(1)];
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4) out.push(cur);
  }
  return out;
}
const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// 穩定的偽亂數（同一棟樓每次產生都一樣）
const hash = (id) => ((id % 2147483647) * 16807 % 2147483647) / 2147483647;

const NAMED = { white: '#f2f2f2', lightpink: '#ffb6c1', gray: '#808080', grey: '#808080', red: '#b03030', silver: '#c0c0c0', beige: '#f5f5dc', brown: '#8b5a2b', black: '#2a2a2a', blue: '#4060a0', yellow: '#e8d070', pink: '#ffc0cb', green: '#6a9a6a', orange: '#e09040' };
const colour = (c) => {
  if (!c) return null;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  return NAMED[c.toLowerCase()] || null;
};

// 樣式：0 住宅公寓、1 玻璃帷幕辦公、2 低樓層商店、3 學校／公家／廟
function styleOf(t, h) {
  const b = t.building || t['building:part'] || '';
  if (t['building:material'] === 'glass' || t['building:material'] === 'mirror') return 1;
  if (/school|university|public|government|hospital|temple|church|civic|train_station|transportation/.test(b)) return 3;
  if (/office|hotel/.test(b) || h >= 55) return 1;
  if (/commercial|retail/.test(b)) return h >= 30 ? 1 : 2;
  return 0;
}
function heightOf(t, id, isPart) {
  let h = num(t.height);
  const lv = num(t['building:levels']), rl = num(t['roof:levels']) || 0;
  if (h == null && lv != null) h = (lv + rl) * 3.3;
  if (h == null) {
    const b = t.building || t['building:part'] || '';
    const r = hash(id);
    h = b === 'house' ? 7 + r * 3
      : /apartments|residential/.test(b) ? 12 + r * 10
      : /commercial|retail|office/.test(b) ? 14 + r * 12
      : /school|university/.test(b) ? 13 + r * 6
      : isPart ? 10 : 9 + r * 8;
  }
  let mh = num(t.min_height);
  if (mh == null && num(t['building:min_level']) != null) mh = num(t['building:min_level']) * 3.3;
  return [h, mh || 0];
}

const parts = [], outlines = [];
for (const e of E) {
  const t = e.tags || {};
  if (e.type === 'way' && e.geometry && t['building:part'] && t['building:part'] !== 'roof') parts.push({ id: e.id, t, rings: [ring(e.geometry)] });
  else if (e.type === 'way' && e.geometry && t.building && !/^(roof|construction|no)$/.test(t.building)) outlines.push({ id: e.id, t, rings: [ring(e.geometry)] });
  else if (e.type === 'relation' && t.building && !/^(roof|construction)$/.test(t.building)) outlines.push({ id: e.id, t, rings: outerRings(e) });
}
// 有 building:part 的建築：外框不畫，改畫各部件（101、遠企都是這樣才有真實外形）
const partCentroids = parts.map((p) => centroid(p.rings[0]));
const keep = [];
let skippedOutline = 0, droppedTrack = 0;
for (const o of outlines) {
  const r0 = o.rings[0];
  if (!r0) continue;
  const xs = r0.map((p) => p[0]), zs = r0.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  if (partCentroids.some((c) => c[0] > x0 && c[0] < x1 && c[1] > z0 && c[1] < z1 && inside(c, r0))) { skippedOutline++; continue; }
  keep.push(o);
}
keep.push(...parts);

const buildings = [];
for (const b of keep) {
  for (const r0 of b.rings) {
    let r = r0;
    if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5) r = r.slice(0, -1);
    if (r.length < 3 || area(r) < 12) continue;
    const c = centroid(r);
    if (farFromTrack(c[0], c[1])) continue;
    if (r.some((p) => distToTrack(p[0], p[1]) < TRACK_CLEAR) || inside(line[0], r)) { droppedTrack++; continue; }
    const [h, mh] = heightOf(b.t, b.id, !!b.t['building:part']);
    if (h <= mh + 0.5) continue;
    const o = { p: r.flatMap(([x, z]) => [r1(x), r1(z)]), h: r1(h), s: styleOf(b.t, h) };
    if (mh > 0) o.m = r1(mh);
    const col = colour(b.t['building:colour']);
    if (col) o.c = col;
    if (b.t.name && h > 40) o.n = b.t.name;
    buildings.push(o);
  }
}

// ---------------------------------------------------------------- 周邊道路（賽道那幾條也畫：當作對向車道與路口）
const RW = { trunk: 12, primary: 11, secondary: 10, tertiary: 8, unclassified: 7, residential: 6, living_street: 5, service: 4.5, primary_link: 7, secondary_link: 7, tertiary_link: 6 };
const roads = [];
for (const e of roadWays) {
  const t = e.tags;
  let w = RW[t.highway];
  if (!w || t.tunnel === 'yes' || t.bridge === 'yes' || (t.layer && Number(t.layer) !== 0) || t.area === 'yes') continue;
  if (t.oneway !== 'yes' && /primary|secondary|tertiary/.test(t.highway)) w *= 1.6;
  const r = ring(e.geometry);
  if (r.every((p) => farFromTrack(p[0], p[1]))) continue;
  roads.push({ p: r.flatMap(([x, z]) => [r1(x), r1(z)]), w });
}

// ---------------------------------------------------------------- 綠地
const greens = [];
for (const e of E) {
  const t = e.tags || {};
  const kind = /pitch/.test(t.leisure || '') ? 2 : /park|garden|recreation_ground/.test(t.leisure || t.landuse || '') ? 1 : t.landuse === 'grass' ? 0 : -1;
  if (kind < 0 || t.building) continue;
  const rings = e.type === 'relation' ? outerRings(e) : e.geometry ? [ring(e.geometry)] : [];
  for (let r of rings) {
    if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5) r = r.slice(0, -1);
    if (r.length < 3 || area(r) < 20) continue;
    const c = centroid(r);
    if (farFromTrack(c[0], c[1])) continue;
    greens.push({ p: r.flatMap(([x, z]) => [r1(x), r1(z)]), k: kind, a: area(r) });
  }
}

// ---------------------------------------------------------------- 行道樹：OSM 有標的樹 + 主要道路兩側每 11 m 一棵 + 公園裡隨機撒
const BG = 30, bgrid = new Map();
const rings2 = buildings.map((b) => { const r = []; for (let k = 0; k < b.p.length; k += 2) r.push([b.p[k], b.p[k + 1]]); return r; });
rings2.forEach((r, i) => {
  const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
  for (let gx = Math.floor(Math.min(...xs) / BG); gx <= Math.floor(Math.max(...xs) / BG); gx++)
    for (let gz = Math.floor(Math.min(...zs) / BG); gz <= Math.floor(Math.max(...zs) / BG); gz++) {
      const k = `${gx},${gz}`;
      if (!bgrid.has(k)) bgrid.set(k, []);
      bgrid.get(k).push(i);
    }
});
const inBuilding = (x, z) => (bgrid.get(`${Math.floor(x / BG)},${Math.floor(z / BG)}`) || []).some((i) => !buildings[i].m && inside([x, z], rings2[i]));
const trees = [];
const tryTree = (x, z) => {
  if (farFromTrack(x, z) || distToTrack(x, z) < TRACK_CLEAR + 0.5 || inBuilding(x, z)) return;
  trees.push(r1(x), r1(z));
};
for (const e of E) if (e.type === 'node' && e.tags?.natural === 'tree') { const p = proj(e.lat, e.lon); tryTree(p[0], p[1]); }
for (const e of roadWays) {
  const t = e.tags;
  if (!/^(primary|secondary|tertiary)$/.test(t.highway) || t.tunnel === 'yes' || (t.layer && Number(t.layer) !== 0)) continue;
  const r = ring(e.geometry), w = RW[t.highway] * (t.oneway !== 'yes' ? 1.6 : 1);
  let carry = hash(e.id) * 11;
  for (let k = 0; k + 1 < r.length; k++) {
    const p = r[k], q = r[k + 1];
    const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    if (l < 1) continue;
    const nx = -dz / l, nz = dx / l;
    let s = carry;
    for (; s < l; s += 11) {
      const x = p[0] + (dx * s) / l, z = p[1] + (dz * s) / l;
      for (const sd of [-1, 1]) tryTree(x + nx * sd * (w / 2 + 2.2), z + nz * sd * (w / 2 + 2.2));
    }
    carry = s - l;
  }
}
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const g of greens) {
  if (g.k === 1) {
    const r = [];
    for (let k = 0; k < g.p.length; k += 2) r.push([g.p[k], g.p[k + 1]]);
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    const n = Math.min(400, Math.floor(g.a / 140));
    for (let k = 0, got = 0; k < n * 3 && got < n; k++) {
      const x = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + rnd() * (Math.max(...zs) - Math.min(...zs));
      if (inside([x, z], r)) { tryTree(x, z); got++; }
    }
  }
  delete g.a;
}

const city = { attribution: '© OpenStreetMap contributors (ODbL)', buildings, roads, greens, trees };
mkdirSync(here('../public/data/'), { recursive: true });
const json = JSON.stringify(city);
writeFileSync(here('../public/data/city.json'), json);
console.log(`建築 ${buildings.length}（外框改畫部件 ${skippedOutline}、壓到賽道刪掉 ${droppedTrack}）、道路 ${roads.length}、綠地 ${greens.length}、樹 ${trees.length / 2}`);
console.log(`city.json ${(json.length / 1024).toFixed(0)} KB`);
