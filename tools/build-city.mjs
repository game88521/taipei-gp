// 把 tools/osm-raw.json（fetch-osm 下載的 OpenStreetMap 資料）轉成遊戲用的 src/data/city.json：
//   - 賽道：沿真實道路接成一圈（信義路 → 基隆路 → 忠孝東路 → 松仁路），路口直角修成圓弧
//   - 建築：輪廓 + 高度（有 building:part 的建築改畫各個部件，101 就是這樣長出真實形狀）
//   - 周邊道路、公園綠地、行道樹
// 用法：npm run build-city（改了賽道路線或篩選規則才需要重跑）
// 資料授權：© OpenStreetMap contributors，ODbL
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
const trackOut = { origin: [LAT0, LON0], tower101: c101.map(r1), points: line.map(([x, z]) => [r1(x), r1(z)]) };
writeFileSync(here('../src/data/track.json'), JSON.stringify(trackOut));

// ================================================================ 城市
const TRACK_CLEAR = 11; // 建築／樹離賽道中心線至少這麼遠（護牆 9.5 m + 1.5 m）
const VIEW = 1e9; // 整個下載範圍都保留（執行時依距離只顯示附近的區塊）

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
const polyLen = (r) => r.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0);
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

// 地下的建築（捷運站、地下街）：OSM 照樣畫了外框，不排除的話會變成 15~25 m 高的方塊擋在忠孝東路正中間
const underground = (t) => (t.layer != null && Number(t.layer) < 0) || /underground/.test(t.location || '');
let droppedUnder = 0;
const parts = [], outlines = [];
for (const e of E) {
  const t = e.tags || {};
  if ((t.building || t['building:part']) && underground(t)) { droppedUnder++; if (t.name) outlines.push({ id: e.id, t, rings: e.geometry ? [ring(e.geometry)] : [], under: true }); continue; } // 名字留給地標提示
  if (e.type === 'way' && e.geometry && t['building:part'] && t['building:part'] !== 'roof') parts.push({ id: e.id, t, rings: [ring(e.geometry)] });
  else if (e.type === 'way' && e.geometry && t.building && !/^(roof|construction|no)$/.test(t.building)) outlines.push({ id: e.id, t, rings: [ring(e.geometry)] });
  else if (e.type === 'relation' && t.building && !/^(roof|construction)$/.test(t.building)) outlines.push({ id: e.id, t, rings: outerRings(e) });
}
// 有 building:part 的建築：外框不畫，改畫各部件（101、遠企都是這樣才有真實外形）
// 特殊地標：執行時換成專屬模型（landmarks3d.ts）；k = hall 國父紀念館、dome 大巨蛋、arena 小巨蛋、chimney 煙囪
// 這些保留外框、丟掉裡面的部件（反正要換模型）；市政府照部件畫，但部件套上外框的花崗岩色
const SPECIAL = [[/^國父紀念館$/, 'hall'], [/^臺北大巨蛋$/, 'dome'], [/^臺北小巨蛋$/, 'arena']];
const isSpecial = (t) => SPECIAL.some(([re]) => re.test(t.name || '')) || t.man_made === 'chimney';
const OUTLINE_COLOUR = [[/^臺北市政府$/, '#b8a487']];
const partCentroids = parts.map((p) => centroid(p.rings[0]));
const keep = [], dropParts = new Set();
let skippedOutline = 0, droppedTrack = 0;
for (const o of outlines) {
  const r0 = o.rings[0];
  if (!r0 || o.under) continue;
  const xs = r0.map((p) => p[0]), zs = r0.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const inner = parts.filter((_, i) => { const c = partCentroids[i]; return c[0] > x0 && c[0] < x1 && c[1] > z0 && c[1] < z1 && inside(c, r0); });
  if (inner.length && isSpecial(o.t)) { for (const p of inner) dropParts.add(p); keep.push(o); continue; }
  const oc = OUTLINE_COLOUR.find(([re]) => re.test(o.t.name || ''));
  if (oc) for (const p of inner) p.colour = oc[1];
  if (inner.length) { skippedOutline++; continue; }
  keep.push(o);
}
keep.push(...parts.filter((p) => !dropParts.has(p)));

const BRICK_PARKS = E.filter((e) => e.type === 'way' && e.geometry && /^松山文創園區$/.test(e.tags?.name || '')).map((e) => ring(e.geometry));
const buildings = [];
for (const b of keep) {
  for (const r0 of b.rings) {
    let r = r0;
    if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5) r = r.slice(0, -1);
    if (r.length < 3 || (area(r) < 12 && b.t.man_made !== 'chimney')) continue; // 煙囪底面積很小，不能被當成雜訊濾掉
    const c = centroid(r);
    if (farFromTrack(c[0], c[1])) continue;
    if (r.some((p) => distToTrack(p[0], p[1]) < TRACK_CLEAR) || inside(line[0], r)) { droppedTrack++; continue; }
    const [h, mh] = heightOf(b.t, b.id, !!b.t['building:part']);
    if (h <= mh + 0.5) continue;
    const o = { p: r.flatMap(([x, z]) => [r1(x), r1(z)]), h: r1(h), s: styleOf(b.t, h) };
    if (b.t.layer != null && Number(b.t.layer) >= 1) Object.defineProperty(o, 'raised', { value: true }); // 高架（例：文湖線車站跨在和平東路上），不輸出
    if (mh > 0) o.m = r1(mh);
    const col = colour(b.t['building:colour']);
    if (col) o.c = col;
    if (b.t.name && (h > 25 || area(r) > 1500)) o.n = b.t.name; // 地標名稱：屋頂招牌與接近提示用
    for (const [re, k] of SPECIAL) if (re.test(b.t.name || '')) o.k = k;
    if (b.t.man_made === 'chimney') o.k = 'chimney';
    const oc = OUTLINE_COLOUR.find(([re]) => re.test(b.t.name || ''));
    if (b.colour || oc) o.c = b.colour || oc[1]; // 市政府：花崗岩外牆
    // 松菸：日治時期的紅磚廠房（園區裡的老建築）
    if (!o.k && h < 20 && BRICK_PARKS.some((pk) => inside(centroid(r), pk))) { o.c = '#a24e38'; o.s = 3; }
    buildings.push(o);
  }
}


// ---------------------------------------------------------------- 地標（有名字的建築）
// 有 building:part 的建築外框沒畫，但名字在外框上：名字、位置、最長那面牆照外框，高度取裡面最高的部件
const places = [];
{
  const partInfo = parts.map((pt) => ({ c: centroid(pt.rings[0]), h: heightOf(pt.t, pt.id, true)[0] }));
  for (const o of [...outlines, ...parts]) {
    const nm = o.t.name;
    if (!nm || !o.rings[0]) continue;
    let r = o.rings[0];
    if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5) r = r.slice(0, -1);
    if (r.length < 3) continue;
    const c = centroid(r);
    if (farFromTrack(c[0], c[1])) continue;
    let h = heightOf(o.t, o.id, !!o.t['building:part'])[0];
    for (const pi of partInfo) if (inside(pi.c, r)) h = Math.max(h, pi.h);
    const a = area(r);
    if (h < 18 && a < 800) continue;
    let bi = 0, bl = 0;
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length, l = Math.hypot(r[j][0] - r[i][0], r[j][1] - r[i][1]);
      if (l > bl) { bl = l; bi = i; }
    }
    const j = (bi + 1) % r.length;
    const rad = Math.max(...r.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
    places.push({ nm, x: r1(c[0]), z: r1(c[1]), r: r1(rad), h: r1(h), e: [r1(r[bi][0]), r1(r[bi][1]), r1(r[j][0]), r1(r[j][1])] });
  }
}

// ---------------------------------------------------------------- 周邊道路（畫路面用）＋ 路網（車流、路名、紅綠燈用）
const RW = { trunk: 12, primary: 11, secondary: 10, tertiary: 8, unclassified: 7, residential: 6, living_street: 5, service: 4.5, primary_link: 7, secondary_link: 7, tertiary_link: 6 };
// 道路等級代碼：0 主要幹道、1 次要、2 一般、3 巷弄、4 服務道路
const CLS = { trunk: 0, primary: 0, primary_link: 0, secondary: 1, secondary_link: 1, tertiary: 2, tertiary_link: 2, unclassified: 2, residential: 3, living_street: 3, service: 4 };
const roads = [];
const netIndex = new Map(); // OSM node id → 路網節點編號
const netNodes = [];
const netWays = [];
const passWays = new Set();
const nodeOf = (id, g) => {
  if (!netIndex.has(id)) {
    const [x, z] = proj(g.lat, g.lon);
    netIndex.set(id, netNodes.length / 2);
    netNodes.push(r1(x), r1(z));
  }
  return netIndex.get(id);
};
for (const e of roadWays) {
  const t = e.tags;
  let w = RW[t.highway];
  if (!w || t.tunnel === 'yes' || t.area === 'yes') continue;
  const r = ring(e.geometry);
  // 橋：40 m 以內、一層的小橋（跨排水溝）當成地面道路；長的高架另外畫（elevated，車子從底下過）
  const isBridge = (t.bridge && t.bridge !== 'no') || (t.layer && Number(t.layer) > 0);
  if (isBridge && !(polyLen(r) < 40 && !(Number(t.layer) > 1) && !/trunk|motorway/.test(t.highway))) continue;
  if (t.layer && Number(t.layer) < 0) continue;
  if (t.oneway !== 'yes' && /primary|secondary|tertiary/.test(t.highway)) w *= 1.6;
  if (r.every((p) => farFromTrack(p[0], p[1]))) continue;
  roads.push({ p: r.flatMap(([x, z]) => [r1(x), r1(z)]), w });
  const way = { n: e.nodes.map((id, k) => nodeOf(id, e.geometry[k])), w, c: CLS[t.highway] ?? 4 };
  const ow = t.oneway === 'yes' ? 1 : t.oneway === '-1' ? -1 : 0;
  if (ow) way.o = ow;
  const lanes = num(t.lanes);
  if (lanes) way.l = lanes;
  if (t.name) way.nm = t.name;
  if (t['name:en']) way.en = t['name:en'];
  netWays.push(way);
  if (t.tunnel === 'building_passage' || t.covered === 'yes') passWays.add(way); // 穿過建築底下的路（騎樓、門洞）
}

// ---------------------------------------------------------------- 高架道路、人行空橋、文湖線高架、地下道入口
// 高度：接到地面道路的節點 = 0；高架主線照 layer（一層約 6.5 m）；匝道沿線依距離從地面升到高架
// k：0 道路、1 人行空橋、2 捷運高架；車子不能開上去（物理是平面的），從底下過，橋墩會擋
const elevated = [];
const portals = [];
{
  const LAYER_H = 6.5;
  const deckOf = new Map(); // OSM 節點 → 這個節點所在高架主線的高度
  const elevWays = roadWays.filter((e) => {
    const t = e.tags;
    if (!e.geometry || t.tunnel === 'yes' || t.area === 'yes') return false;
    const isBridge = (t.bridge && t.bridge !== 'no') || (t.layer && Number(t.layer) > 0);
    if (!isBridge) return false;
    const r = ring(e.geometry);
    return !(polyLen(r) < 40 && !(Number(t.layer) > 1) && !/trunk|motorway/.test(t.highway)); // 短橋已經併進地面路網
  });
  const kindOf = (t) => (/footway|cycleway|path|pedestrian/.test(t.highway) ? 1 : /steps|construction/.test(t.highway) ? -1 : 0);
  for (const e of elevWays) {
    const t = e.tags, k = kindOf(t);
    if (k !== 0 || /_link$/.test(t.highway)) continue;
    const h = Math.max(1, Number(t.layer) || 1) * LAYER_H;
    for (const id of e.nodes) deckOf.set(id, Math.max(deckOf.get(id) ?? 0, h));
  }
  for (const e of elevWays) {
    const t = e.tags, k = kindOf(t);
    if (k < 0) continue;
    const r = ring(e.geometry);
    if (r.every((p) => farFromTrack(p[0], p[1]))) continue;
    const layerH = Math.max(1, Number(t.layer) || 1) * LAYER_H;
    let ys;
    if (k === 1) ys = r.map(() => 6);
    else {
      // 錨點：地面節點 0、主線節點＝主線高度、自己的端點＝自己的高度；中間照距離內插
      const anchor = e.nodes.map((id, i) => (netIndex.has(id) ? 0 : deckOf.has(id) ? deckOf.get(id) : i === 0 || i === e.nodes.length - 1 ? layerH : null));
      if (!/_link$/.test(t.highway)) for (let i = 0; i < anchor.length; i++) if (anchor[i] == null) anchor[i] = layerH;
      const s = [0];
      for (let i = 1; i < r.length; i++) s.push(s[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
      ys = anchor.map((a, i) => {
        if (a != null) return a;
        let lo = i, hi = i;
        while (lo > 0 && anchor[lo] == null) lo--;
        while (hi < anchor.length - 1 && anchor[hi] == null) hi++;
        const a0 = anchor[lo] ?? layerH, a1 = anchor[hi] ?? layerH, f = (s[i] - s[lo]) / (s[hi] - s[lo] || 1);
        return a0 + (a1 - a0) * f;
      });
    }
    const w = k === 1 ? 3.5 : (RW[t.highway] ?? 8) * (t.oneway !== 'yes' && !/_link$/.test(t.highway) ? 1.6 : 1);
    elevated.push({ p: r.flatMap(([x, z]) => [r1(x), r1(z)]), y: ys.map(r1), w: r1(w), k });
  }
  // 捷運文湖線高架（另外下載的 osm-rail.json；沒有就略過）
  const railFile = here('./osm-rail.json');
  if (existsSync(railFile)) {
    for (const e of JSON.parse(readFileSync(railFile, 'utf8')).elements) {
      const t = e.tags || {};
      if (e.type !== 'way' || !e.geometry || !(Number(t.layer) > 0 || t.bridge)) continue;
      if (!/subway|light_rail|monorail|platform/.test(t.railway || '')) continue;
      const r = ring(e.geometry);
      const y = 8 + Math.max(1, Number(t.layer) || 1) * 3; // 文湖線高架約 11~17 m
      elevated.push({ p: r.flatMap(([x, z]) => [r1(x), r1(z)]), y: r.map(() => y), w: t.railway === 'platform' ? 4 : 6.5, k: t.railway === 'platform' ? 3 : 2 });
    }
  }
  // 地下道入口：車行的地下道（layer < 0 或 tunnel=yes）接到地面道路的那一端
  for (const e of roadWays) {
    const t = e.tags;
    if (!e.geometry || !(t.tunnel === 'yes' || Number(t.layer) < 0) || !/trunk|primary|secondary|tertiary|unclassified|residential/.test(t.highway)) continue;
    const r = ring(e.geometry), n = e.nodes;
    for (const [i, j] of [[0, 1], [n.length - 1, n.length - 2]]) {
      if (!netIndex.has(n[i]) || n.length < 2) continue;
      const ang = Math.atan2(r[j][0] - r[i][0], r[j][1] - r[i][1]); // 朝隧道裡面
      const w = (RW[t.highway] ?? 8) * (t.oneway !== 'yes' ? 1.6 : 1);
      portals.push(r1(r[i][0]), r1(r[i][1]), Math.round(ang * 1000) / 1000, r1(w));
    }
  }
  console.log(`高架 ${elevated.filter((e) => e.k === 0).length} 段、人行空橋 ${elevated.filter((e) => e.k === 1).length}、文湖線 ${elevated.filter((e) => e.k >= 2).length}、地下道入口 ${portals.length / 4}`);
}

// 紅綠燈與斑馬線：只要落在車道上的
const signals = [];
const crossings = [];
for (const e of E) {
  if (e.type !== 'node' || !netIndex.has(e.id)) continue;
  if (e.tags?.highway === 'traffic_signals') signals.push(netIndex.get(e.id));
  if (e.tags?.highway === 'crossing') crossings.push(netIndex.get(e.id));
}

// 路名牌：兩條以上「不同名字」的道路交會的路口；雙向分隔道路會有好幾個交點，45 m 內同一組路名合成一面
const baseName = (n) => n.replace(/[一二三四五六七八九十]+段$/, '');
const byNode = new Map();
for (const w of netWays) {
  if (!w.nm || w.c > 2 || /巷|弄/.test(w.nm)) continue;
  w.n.forEach((ni, k) => {
    if (!byNode.has(ni)) byNode.set(ni, []);
    const a = w.n[Math.max(0, k - 1)], b = w.n[Math.min(w.n.length - 1, k + 1)];
    const ang = Math.atan2(netNodes[b * 2] - netNodes[a * 2], netNodes[b * 2 + 1] - netNodes[a * 2 + 1]);
    byNode.get(ni).push({ nm: w.nm, en: w.en, ang, w: w.w });
  });
}
const signs = [];
const signClusters = [];
for (const [ni, list] of byNode) {
  const names = [...new Map(list.map((r) => [baseName(r.nm), r])).values()];
  if (names.length < 2) continue;
  const key = names.map((r) => r.nm).sort().join('|');
  const x = netNodes[ni * 2], z = netNodes[ni * 2 + 1];
  const c = signClusters.find((s) => s.key === key && Math.hypot(s.x - x, s.z - z) < 45);
  if (c) { c.pts.push([x, z]); continue; }
  signClusters.push({ key, x, z, pts: [[x, z]], roads: names.slice(0, 2) });
}
for (const c of signClusters) {
  const cx = c.pts.reduce((s, p) => s + p[0], 0) / c.pts.length, cz = c.pts.reduce((s, p) => s + p[1], 0) / c.pts.length;
  const [A, B] = c.roads;
  // 立在路口的一角：沿 A 路走 B 路寬一半＋3 m，再沿 B 路走 A 路寬一半＋3 m
  const da = (B.w * (c.pts.length > 1 ? 1.4 : 0.7)) / 2 + 3, db = (A.w * (c.pts.length > 1 ? 1.4 : 0.7)) / 2 + 3;
  const x = cx + Math.sin(A.ang) * da + Math.sin(B.ang) * db, z = cz + Math.cos(A.ang) * da + Math.cos(B.ang) * db;
  if (distToTrack(x, z) < 3) continue;
  signs.push({ x: r1(x), z: r1(z), b: c.roads.map((r) => ({ nm: r.nm, en: r.en || '', a: +r.ang.toFixed(3) })) });
}

// ---------------------------------------------------------------- 綠地
const greens = [];
for (const e of E) {
  const t = e.tags || {};
  const kind = /pitch/.test(t.leisure || '') ? 2 : /park|garden|recreation_ground/.test(t.leisure || t.landuse || '') ? 1 : t.landuse === 'grass' ? 0 : t.landuse === 'forest' || /wood|scrub/.test(t.natural || '') ? 3 : -1;
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
// 車道的空間索引：樹不能種在任何車道上（雙向分開畫的道路，一側的路邊常常是另一側的車道）
const RG = 25, rgrid = new Map();
for (const w of netWays) {
  if (w.c > 3) continue;
  for (let k = 0; k + 1 < w.n.length; k++) {
    const s = [netNodes[w.n[k] * 2], netNodes[w.n[k] * 2 + 1], netNodes[w.n[k + 1] * 2], netNodes[w.n[k + 1] * 2 + 1], w.w / 2 + 1];
    for (let gx = Math.floor(Math.min(s[0], s[2]) / RG); gx <= Math.floor(Math.max(s[0], s[2]) / RG); gx++)
      for (let gz = Math.floor(Math.min(s[1], s[3]) / RG); gz <= Math.floor(Math.max(s[1], s[3]) / RG); gz++) {
        const k2 = `${gx},${gz}`;
        if (!rgrid.has(k2)) rgrid.set(k2, []);
        rgrid.get(k2).push(s);
      }
  }
}
const onRoad = (x, z) => {
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    for (const s of rgrid.get(`${Math.floor(x / RG) + a},${Math.floor(z / RG) + b}`) || []) {
      const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2));
      if (Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t) < s[4]) return true;
    }
  }
  return false;
};
const trees = [];
const tryTree = (x, z) => {
  if (farFromTrack(x, z) || distToTrack(x, z) < TRACK_CLEAR + 0.5 || inBuilding(x, z) || onRoad(x, z)) return;
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
  if (g.k === 1 || g.k === 3) {
    const r = [];
    for (let k = 0; k < g.p.length; k += 2) r.push([g.p[k], g.p[k + 1]]);
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    const n = g.k === 3 ? Math.min(2500, Math.floor(g.a / 90)) : Math.min(400, Math.floor(g.a / 140)); // 森林種得比較密
    for (let k = 0, got = 0; k < n * 3 && got < n; k++) {
      const x = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + rnd() * (Math.max(...zs) - Math.min(...zs));
      if (inside([x, z], r)) { tryTree(x, z); got++; }
    }
  }
  delete g.a;
}

// ---------------------------------------------------------------- 路燈、路邊停的機車
// 都要避開車道、建築、賽道護牆；機車另外避開路口（行人要過馬路）
const lamps = [];
const parked = [];
{
  const degree = new Map();
  for (const w of netWays) for (const ni of new Set(w.n)) degree.set(ni, (degree.get(ni) || 0) + 1);
  const JG = 30, jgrid = new Map();
  for (const [ni, dg] of degree) {
    if (dg < 2) continue;
    const p = [netNodes[ni * 2], netNodes[ni * 2 + 1]];
    const k = `${Math.floor(p[0] / JG)},${Math.floor(p[1] / JG)}`;
    if (!jgrid.has(k)) jgrid.set(k, []);
    jgrid.get(k).push(p);
  }
  const nearJunction = (x, z, r) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      for (const p of jgrid.get(`${Math.floor(x / JG) + a},${Math.floor(z / JG) + b}`) || []) if (Math.hypot(p[0] - x, p[1] - z) < r) return true;
    return false;
  };
  const ok = (x, z) => !farFromTrack(x, z) && distToTrack(x, z) > TRACK_CLEAR && !inBuilding(x, z) && !onRoad(x, z);
  let seed2 = 11;
  const rnd2 = () => (seed2 = (seed2 * 16807) % 2147483647) / 2147483647;
  for (const w of netWays) {
    if (w.c > 2) continue;
    let carryL = 17, carryP = 20 + rnd2() * 30;
    for (let k = 0; k + 1 < w.n.length; k++) {
      const ax = netNodes[w.n[k] * 2], az = netNodes[w.n[k] * 2 + 1], bx = netNodes[w.n[k + 1] * 2], bz = netNodes[w.n[k + 1] * 2 + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1) continue;
      const ux = dx / l, uz = dz / l, nx = -uz, nz = ux;
      // 路燈：每 34 m、兩側（另一側若是對向車道會被 onRoad 擋掉）；燈臂朝路中央
      let s = carryL;
      for (; s < l; s += 34) {
        for (const side of [-1, 1]) {
          const off = w.w / 2 + 1.4, x = ax + ux * s + nx * side * off, z = az + uz * s + nz * side * off;
          if (ok(x, z)) lamps.push(r1(x), r1(z), +Math.atan2(-nx * side, -nz * side).toFixed(3));
        }
      }
      carryL = s - l;
      // 機車：每 30~70 m 一排 5~10 台，斜停在路邊，車頭朝人行道
      let p = carryP;
      for (; p < l; p += 30 + rnd2() * 40) {
        for (const side of [-1, 1]) {
          if (rnd2() < 0.45) continue;
          const off = w.w / 2 + 1.7;
          const cx = ax + ux * p + nx * side * off, cz = az + uz * p + nz * side * off;
          if (nearJunction(cx, cz, 14)) continue;
          const count = 5 + Math.floor(rnd2() * 6);
          const ang = Math.atan2(nx * side, nz * side) + side * 0.35;
          for (let q = 0; q < count; q++) {
            const t = (q - count / 2) * 0.78, x = cx + ux * t, z = cz + uz * t;
            if (ok(x, z)) parked.push(r1(x), r1(z), +ang.toFixed(2), Math.floor(rnd2() * 7));
          }
        }
      }
      carryP = p - l;
    }
  }
}


// ---------------------------------------------------------------- 地形：象山、四獸山一帶（只在 OSM 的森林裡隆起，不會蓋到道路和建築）
// 山頭（緯度、經度、高度 m、範圍 m）
const PEAKS = [
  [25.0272, 121.5766, 183, 330], // 象山
  [25.0240, 121.5836, 210, 380], // 拇指山一帶
  [25.0338, 121.5871, 150, 300], // 虎山
  [25.0300, 121.5855, 170, 260], // 豹山／獅山
  [25.0208, 121.5790, 160, 380], // 南側稜線
];
let terrain = null;
{
  const forests = greens.filter((g) => g.k === 3);
  if (forests.length) {
    const rings3 = forests.map((g) => { const r = []; for (let k = 0; k < g.p.length; k += 2) r.push([g.p[k], g.p[k + 1]]); return r; });
    const peaks = PEAKS.map(([la, lo, h, rad]) => { const [x, z] = proj(la, lo); return { x, z, h, rad }; });
    // 範圍：所有山頭外擴 600 m
    const x0 = Math.min(...peaks.map((p) => p.x)) - 600, x1 = Math.max(...peaks.map((p) => p.x)) + 600;
    const z0 = Math.min(...peaks.map((p) => p.z)) - 600, z1 = Math.max(...peaks.map((p) => p.z)) + 600;
    const STEP = 15, nx = Math.ceil((x1 - x0) / STEP) + 1, nz = Math.ceil((z1 - z0) / STEP) + 1;
    // 山的遮罩：格點在森林裡、或在山頭的核心範圍（等高線 > 25 m，OSM 不一定有畫森林）；
    // 離車道與建築夠遠 → 1，再模糊幾次讓邊緣是緩坡
    const core = (x, z) => peaks.reduce((v, p) => v + p.h * Math.exp(-(((x - p.x) ** 2 + (z - p.z) ** 2) / (p.rad * p.rad))), 0);
    const inForest = new Uint8Array(nx * nz);
    let mask = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP;
      inForest[j * nx + i] = rings3.some((r) => inside([x, z], r)) ? 1 : 0;
      if (!inForest[j * nx + i] && core(x, z) < 25) continue;
      if (onRoad(x, z) || inBuilding(x, z) || distToTrack(x, z) < 30) continue;
      mask[j * nx + i] = 1;
    }
    for (let pass = 0; pass < 4; pass++) {
      const m2 = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        if (!mask[j * nx + i]) continue; // 只往內收，不往外擴（邊緣維持 0，不會蓋到路）
        let s = 0, c = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
          const ii = i + a, jj = j + b;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          s += mask[jj * nx + ii]; c++;
        }
        m2[j * nx + i] = s / c;
      }
      mask = m2;
    }
    const h = new Array(nx * nz).fill(0);
    let maxH = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const m = mask[j * nx + i];
      if (!m) continue;
      const x = x0 + i * STEP, z = z0 + j * STEP;
      let v = 0;
      for (const p of peaks) v += p.h * Math.exp(-(((x - p.x) ** 2 + (z - p.z) ** 2) / (p.rad * p.rad)));
      // 一點起伏：讓山坡不是光滑的饅頭
      v += 6 * Math.sin(x * 0.021) * Math.cos(z * 0.017) + 3 * Math.sin(x * 0.053 + z * 0.041);
      const y = Math.max(0, v) * m ** 1.5;
      h[j * nx + i] = Math.round(y * 2) / 2;
      maxH = Math.max(maxH, y);
    }
    terrain = { x0: r1(x0), z0: r1(z0), step: STEP, nx, nz, h };
    // 不在 OSM 森林裡的山坡也種樹（森林裡的前面已經種過）
    const before = trees.length / 2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (inForest[j * nx + i] || h[j * nx + i] < 3 || rnd() > 0.75) continue;
      tryTree(x0 + (i + rnd() - 0.5) * STEP, z0 + (j + rnd() - 0.5) * STEP);
    }
    console.log(`地形：${nx}×${nz} 格，最高 ${maxH.toFixed(0)} m，山坡補種 ${trees.length / 2 - before} 棵樹`);
  }
}

// ---------------------------------------------------------------- 登山步道（象山、虎山、拇指山…）與六巨石
// 只留在山坡上（地形高 > 1 m）的步道：石階（steps）與泥土／石板路；執行時沿地形鋪
const trails = [];
const rocks = [];
if (terrain) {
  const T = terrain;
  const th = (x, z) => {
    const fx = (x - T.x0) / T.step, fz = (z - T.z0) / T.step, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= T.nx - 1 || j >= T.nz - 1) return 0;
    const a = fx - i, b = fz - j, H = T.h, n = T.nx;
    return (H[j * n + i] * (1 - a) + H[j * n + i + 1] * a) * (1 - b) + (H[(j + 1) * n + i] * (1 - a) + H[(j + 1) * n + i + 1] * a) * b;
  };
  for (const e of E) {
    const t = e.tags || {};
    if (e.type !== 'way' || !e.geometry || !/^(steps|footway|path)$/.test(t.highway || '')) continue;
    const r = ring(e.geometry);
    if (r.filter((p) => th(p[0], p[1]) > 1).length < r.length * 0.5) continue;
    trails.push({ p: rdp(r, 0.8).flatMap(([x, z]) => [r1(x), r1(z)]), s: t.highway === 'steps' ? 1 : 0 });
  }
  for (const e of E) if (/六巨石/.test(e.tags?.name || '')) {
    const g = e.type === 'node' ? e : e.center || (e.geometry && e.geometry[0]);
    if (g?.lat) { const [x, z] = proj(g.lat, g.lon); rocks.push(r1(x), r1(z)); }
  }
  console.log(`登山步道 ${trails.length} 段（石階 ${trails.filter((t) => t.s).length}）、六巨石 ${rocks.length / 2} 處`);
}

// ---------------------------------------------------------------- 擋在車道上的建築
// 車道中心線穿過建築底面：高架的（layer ≥ 1）或路標成「穿過建築」的，把建築墊高讓車從底下過；
// 其他的多半是資料錯誤（或沒標 layer 的地下結構），直接拿掉。幹道、一般道路穿過 3 m 以上就算，巷弄 8 m 以上
let raisedOver = 0, droppedOver = 0;
{
  const S = 40, grid = new Map();
  buildings.forEach((b, i) => {
    if ((b.m ?? 0) > 2) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < b.p.length; k += 2) { x0 = Math.min(x0, b.p[k]); x1 = Math.max(x1, b.p[k]); z0 = Math.min(z0, b.p[k + 1]); z1 = Math.max(z1, b.p[k + 1]); }
    b._bb = [x0, z0, x1, z1];
    for (let gx = Math.floor(x0 / S); gx <= Math.floor(x1 / S); gx++) for (let gz = Math.floor(z0 / S); gz <= Math.floor(z1 / S); gz++) {
      const k = `${gx},${gz}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
  const inFlat = (x, z, p) => {
    let c = false;
    for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
      const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const crossed = new Map(); // 建築編號 → { main: 幹道／一般道路穿過的 m, lane: 巷弄的 m, pass: 有沒有標成穿過建築 }
  for (const w of netWays) {
    if (w.c > 3) continue;
    for (let k = 0; k + 1 < w.n.length; k++) {
      const ax = netNodes[w.n[k] * 2], az = netNodes[w.n[k] * 2 + 1], bx = netNodes[w.n[k + 1] * 2], bz = netNodes[w.n[k + 1] * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az);
      for (let s = 0.5; s < l; s += 1) {
        const x = ax + ((bx - ax) * s) / l, z = az + ((bz - az) * s) / l;
        for (const i of grid.get(`${Math.floor(x / S)},${Math.floor(z / S)}`) || []) {
          const b = buildings[i], bb = b._bb;
          if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3] || !inFlat(x, z, b.p)) continue;
          const c = crossed.get(i) || { main: 0, lane: 0, pass: false };
          if (w.c <= 2) c.main++; else c.lane++;
          if (passWays.has(w)) c.pass = true;
          crossed.set(i, c);
        }
      }
    }
  }
  const drop = new Set();
  for (const [i, c] of crossed) {
    if (c.main < 3 && c.lane < 8) continue;
    const b = buildings[i];
    if (b.raised || c.pass) { b.m = Math.max(b.m ?? 0, b.raised ? 7 : 4.5); raisedOver++; if (b.h <= b.m + 2) b.h = r1(b.m + 4); }
    else { drop.add(i); droppedOver++; }
  }
  for (const b of buildings) delete b._bb;
  for (let i = buildings.length - 1; i >= 0; i--) if (drop.has(i)) buildings.splice(i, 1);
}
console.log(`擋路的建築：地下結構不畫 ${droppedUnder}、跨在路上墊高 ${raisedOver}、壓在路上拿掉 ${droppedOver}`);

const city = { attribution: '© OpenStreetMap contributors (ODbL)', buildings, roads, greens, trees, net: { nodes: netNodes, ways: netWays }, signals, crossings, signs, places, lamps, parked, terrain, trails, rocks, elevated, portals };
mkdirSync(here('../public/data/'), { recursive: true });
// 瘦身：座標乘上倍數變整數、每 stride 個一組存「跟上一組的差」（數字變小，brotli 壓得更好、解析更快）；
// roads 執行時沒用到（路面是用 net 畫的），不輸出。解碼在 src/citydata.ts decodeCity()
const enc = (a, stride, scale) => {
  const o = new Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = Math.round(a[i] * scale) - (i >= stride ? Math.round(a[i - stride] * scale) : 0);
  return o;
};
const packed = { ...city, enc: 1 };
delete packed.roads;
packed.buildings = buildings.map((b) => ({ ...b, p: enc(b.p, 2, 10) }));
packed.greens = greens.map((g) => ({ ...g, p: enc(g.p, 2, 10) }));
packed.trees = enc(trees, 2, 10);
packed.net = { nodes: enc(netNodes, 2, 10), ways: netWays.map((w) => ({ ...w, n: enc(w.n, 1, 1) })) };
packed.lamps = enc(lamps, 3, 100);
packed.parked = enc(parked, 4, 100);
if (terrain) packed.terrain = { ...terrain, h: enc(terrain.h, 1, 2) };
packed.trails = trails.map((t) => ({ ...t, p: enc(t.p, 2, 10) }));
packed.elevated = elevated.map((e) => ({ ...e, p: enc(e.p, 2, 10), y: enc(e.y, 1, 10) }));
const json = JSON.stringify(packed);
{
  // 自我檢查：解回來跟原本差多少（座標應該完全一樣；路燈、機車的角度最多差 0.005 rad）
  const dec = (a, stride, scale) => { const acc = new Array(stride).fill(0); return a.map((v, i) => (acc[i % stride] += v) / scale); };
  const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
  const P = JSON.parse(json);
  const worst = Math.max(
    ...P.buildings.map((b, i) => maxDiff(dec(b.p, 2, 10), buildings[i].p)),
    maxDiff(dec(P.trees, 2, 10), trees), maxDiff(dec(P.net.nodes, 2, 10), netNodes),
    ...P.net.ways.map((w, i) => maxDiff(dec(w.n, 1, 1), netWays[i].n)),
    terrain ? maxDiff(dec(P.terrain.h, 1, 2), terrain.h) : 0,
  );
  console.log(`瘦身格式自我檢查：座標最大誤差 ${worst.toExponential(1)}，路燈角度最大誤差 ${maxDiff(dec(P.lamps, 3, 100), lamps).toFixed(4)}`);
}
writeFileSync(here('../public/data/city.json'), json);
// 載入進度條要知道解壓縮後有多大（伺服器用 brotli 傳，Content-Length 是壓縮後的）
writeFileSync(here('../src/data/track.json'), JSON.stringify({ ...trackOut, citySize: Buffer.byteLength(json) }));
console.log(`建築 ${buildings.length}（外框改畫部件 ${skippedOutline}、壓到賽道刪掉 ${droppedTrack}）、道路 ${roads.length}、綠地 ${greens.length}、樹 ${trees.length / 2}`);
console.log(`路網 ${netNodes.length / 2} 節點 ${netWays.length} 條、紅綠燈 ${signals.length}、斑馬線 ${crossings.length}、路名牌 ${signs.length}、地標 ${places.length}、路燈 ${lamps.length / 3}、路邊機車 ${parked.length / 4}`);
console.log(`city.json ${(json.length / 1024).toFixed(0)} KB`);
