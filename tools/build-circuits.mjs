// 從 OpenStreetMap 的賽道資料（probe-circuits.mjs 下載到 tools/circuits-cache/）組出每條 F1 賽道的中心線：
// 1. 有賽道 relation（街道賽多半是這種）：把成員路段頭尾接成一圈
// 2. 沒有：把 highway=raceway（排除維修道、卡丁車道）化成「路口 → 路口」的圖，找長度最接近官方長度（circuits-info.json）的封閉迴圈
// 起跑線：維修道中點最近的賽道點；方向照官方的順／逆時針。輸出 public/data/circuits/{id}.json 與 tools/circuits.svg（總覽，對照官方圖用）
// 地圖資料 © OpenStreetMap contributors（ODbL）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CIRCUITS } from './probe-circuits.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const info = JSON.parse(readFileSync(here('./circuits-info.json'), 'utf8'));
// 第二來源：bacinger/f1-circuits（MIT 授權，2026-02 更新）的 GeoJSON，賽道線照比賽方向畫、從起跑線開始
// OSM 組出來的長度跟官方差 1.5% 以內就用 OSM（點比較密），不然用這份；方向：維基百科有寫就照維基（新加坡這份畫反了），沒寫照這份
const BAC = JSON.parse(readFileSync(here('./f1-circuits.geojson'), 'utf8')).features;
const BAC_ID = { australia: 'au-1953', china: 'cn-2004', japan: 'jp-1962', miami: 'us-2022', canada: 'ca-1978', monaco: 'mc-1929', barcelona: 'es-1991', austria: 'at-1969', britain: 'gb-1948', belgium: 'be-1925', hungary: 'hu-1986', netherlands: 'nl-1948', italy: 'it-1922', madrid: 'es-2026', azerbaijan: 'az-2016', malaysia: 'my-1999', singapore: 'sg-2008', usa: 'us-2012', mexico: 'mx-1962', brazil: 'br-1940', lasvegas: 'us-2023', qatar: 'qa-2004', abudhabi: 'ae-2009' };
// 維修道、卡丁車道等不是賽道本身的路段（主直線常叫 Pit Straight，不能只看有沒有 pit）
const EXCLUDE = /pit ?lane|pitlane|pit entry|pit exit|pit in|pit out|boxen|bokszutca|pitstraat|voie des stands|sortie des stands|entrada al pit|sortida del pit|kart|garage|paddock|drag|oval|offroad|motocross|skid|long lap|national circuit|südschleife|south circuit|north circuit|junior|cutting/i;
// 維基百科「List of Formula One circuits」表格的方向欄（賽道頁沒寫的就看這裡）
const WIKI_LIST_DIR = { australia: 'clockwise', canada: 'clockwise', monaco: 'clockwise', barcelona: 'clockwise', belgium: 'clockwise', hungary: 'clockwise', netherlands: 'clockwise', italy: 'clockwise', madrid: 'clockwise', azerbaijan: 'anticlockwise', singapore: 'anticlockwise', usa: 'anticlockwise', mexico: 'clockwise', brazil: 'anticlockwise', lasvegas: 'anticlockwise', qatar: 'clockwise' };
const PITLANE = /pit ?lane|pitlane|boxen|bokszutca|pitstraat|voie des stands/i;
const signedArea = (pts) => { let A = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; A += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; } return A; };

const proj = (lat0, lon0) => (p) => [(p.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), -(p.lat - lat0) * 110574];
const plen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/** 一串路段頭尾相接成一條線（成員順序可能亂、方向可能反） */
function chain(segs) {
  const left = segs.map((s) => s.slice());
  if (!left.length) return null;
  const out = left.shift();
  const near = (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon) < 2.5e-4; // 成員之間常有小縫（約 25 m 內）
  while (left.length) {
    const end = out[out.length - 1];
    let k = left.findIndex((s) => near(s[0], end));
    if (k >= 0) { out.push(...left.splice(k, 1)[0].slice(1)); continue; }
    k = left.findIndex((s) => near(s[s.length - 1], end));
    if (k >= 0) { out.push(...left.splice(k, 1)[0].reverse().slice(1)); continue; }
    return null; // 接不起來
  }
  return near(out[0], out[out.length - 1]) ? out.slice(0, -1) : null;
}

/** 圖上找長度最接近 target 的簡單迴圈（先化成路口之間的邊） */
function bestCycle(ways, target, P) {
  const adj = new Map();
  const addE = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  const pos = new Map();
  for (const w of ways) for (let i = 0; i < w.geometry.length; i++) {
    const k = key(w.geometry[i]);
    pos.set(k, w.geometry[i]);
    if (i) { const j = key(w.geometry[i - 1]); addE(k, j); addE(j, k); }
  }
  const junction = (k) => adj.get(k).size !== 2;
  const juncs = [...adj.keys()].filter(junction);
  if (!juncs.length) {
    // 只有一個圈：直接沿著走一圈
    const start = [...adj.keys()][0], path = [start];
    let prev = null, cur = start;
    for (;;) { const nx = [...adj.get(cur)].find((n) => n !== prev); if (!nx || nx === start) break; path.push(nx); prev = cur; cur = nx; if (path.length > 1e5) return null; }
    return path.map((k) => pos.get(k));
  }
  // 路口之間的邊：沿著度數 2 的點走到下一個路口
  const edges = new Map(); // 路口 → [{to, pts, len}]
  for (const j of juncs) {
    for (const first of adj.get(j)) {
      const pts = [j, first];
      let prev = j, cur = first;
      while (!junction(cur)) { const nx = [...adj.get(cur)].find((n) => n !== prev); prev = cur; cur = nx; pts.push(cur); }
      const L = plen(pts.map((k) => P(pos.get(k))));
      if (!edges.has(j)) edges.set(j, []);
      edges.get(j).push({ to: cur, pts, len: L });
    }
  }
  let best = null, bestErr = Infinity, budget = 3e6;
  const lo = target * 0.88, hi = target * 1.12;
  for (const s of juncs) {
    const used = new Set();
    const dfs = (u, len, path) => {
      if (--budget < 0) return;
      for (const e of edges.get(u) || []) {
        const nl = len + e.len;
        if (nl > hi) continue;
        const eid = e.pts.join('|');
        if (used.has(eid) || used.has([...e.pts].reverse().join('|'))) continue;
        if (e.to === s) {
          if (nl >= lo && Math.abs(nl - target) < bestErr) { bestErr = Math.abs(nl - target); best = [...path, e]; }
          continue;
        }
        if (path.some((p) => p.to === e.to)) continue; // 簡單迴圈：路口不重複
        used.add(eid);
        path.push(e);
        dfs(e.to, nl, path);
        path.pop();
        used.delete(eid);
      }
    };
    dfs(s, 0, []);
  }
  if (!best) return null;
  const keys = [];
  for (const e of best) keys.push(...e.pts.slice(0, -1));
  return keys.map((k) => pos.get(k));
}

const out = [];
mkdirSync(here('../public/data/circuits/'), { recursive: true });
for (const [id, name, lat, lon] of CIRCUITS) {
  const cache = here(`./circuits-cache/${id}.json`);
  const inf = info.find((c) => c.id === id) ?? {};
  const target = (inf.lengthKm ?? 5) * 1000;
  if (!existsSync(cache)) { console.log(id.padEnd(11), '沒有下載資料'); continue; }
  const d = JSON.parse(readFileSync(cache, 'utf8'));
  const P = proj(lat, lon);
  const ways = d.elements.filter((e) => e.type === 'way' && e.geometry);
  let loop = null, how = '';
  // 1. relation
  for (const r of d.elements.filter((e) => e.type === 'relation' && e.members)) {
    if (EXCLUDE.test(r.tags?.name ?? '')) continue;
    const segs = r.members.filter((m) => m.type === 'way' && m.geometry && !/pit/i.test(m.role ?? '')).map((m) => m.geometry);
    const c = chain(segs);
    if (c && Math.abs(plen(c.map(P)) - target) < target * 0.02) { loop = c; how = `OSM relation「${r.tags?.name ?? r.id}」`; break; }
  }
  // 2. 賽道線找迴圈
  if (!loop) {
    const track = ways.filter((w) => w.tags?.highway === 'raceway' && !EXCLUDE.test(`${w.tags?.name ?? ''} ${w.tags?.raceway ?? ''} ${w.tags?.service ?? ''} ${w.tags?.description ?? ''}`));
    loop = bestCycle(track, target, P);
    how = 'OSM 賽道線找迴圈';
  }
  const bac = BAC.find((f) => f.properties.id === BAC_ID[id]);
  const bacPts = bac ? bac.geometry.coordinates.map(([lo, la]) => P({ lat: la, lon: lo })) : null;
  let pts = loop ? loop.map(P) : null;
  if (!pts || Math.abs(plen([...pts, pts[0]]) - target) > target * 0.015) {
    if (!bacPts) { console.log(id.padEnd(11), '找不到賽道'); continue; }
    pts = bacPts.slice();
    if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1) pts.pop();
    how = 'bacinger/f1-circuits';
  }
  // 方向：x 東、z 南，signedArea > 0 是從上往下看順時針；維基有寫照維基，沒寫跟 bacinger 的線同方向
  const wikiDir = inf.direction ?? WIKI_LIST_DIR[id];
  const wantCw = wikiDir ? wikiDir === 'clockwise' : bacPts ? signedArea(bacPts) > 0 : null;
  if (wantCw != null && (signedArea(pts) > 0) !== wantCw) pts.reverse();
  // 起跑線：bacinger 的起點（它從起跑線開始畫）；沒有的話用維修道中點
  const pit = ways.find((w) => PITLANE.test(`${w.tags?.name ?? ''} ${w.tags?.service ?? ''} ${w.tags?.raceway ?? ''}`) && w.geometry.length > 2);
  const ref = bacPts ? bacPts[0] : pit ? P(pit.geometry[Math.floor(pit.geometry.length / 2)]) : null;
  if (ref) {
    let bi = 0, bd = Infinity;
    pts.forEach((p, i) => { const dd = (p[0] - ref[0]) ** 2 + (p[1] - ref[1]) ** 2; if (dd < bd) { bd = dd; bi = i; } });
    pts = [...pts.slice(bi), ...pts.slice(0, bi)];
  }
  // 每 4 m 重新取樣
  const L = plen([...pts, pts[0]]), N = Math.round(L / 4), res = [];
  const ring = [...pts, pts[0]];
  let seg = 0, acc = 0;
  for (let k = 0; k < N; k++) {
    const s = (k * L) / N;
    while (seg < ring.length - 2 && acc + Math.hypot(ring[seg + 1][0] - ring[seg][0], ring[seg + 1][1] - ring[seg][1]) < s) { acc += Math.hypot(ring[seg + 1][0] - ring[seg][0], ring[seg + 1][1] - ring[seg][1]); seg++; }
    const a = ring[seg], b = ring[seg + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, f = (s - acc) / l;
    res.push([+(a[0] + (b[0] - a[0]) * f).toFixed(1), +(a[1] + (b[1] - a[1]) * f).toFixed(1)]);
  }
  const err = (L - target) / target;
  const dirName = wantCw == null ? '方向?' : wantCw ? '順時針' : '逆時針';
  console.log(`${id.padEnd(11)} ${how.padEnd(34)} ${(L / 1000).toFixed(3)} km（官方 ${(target / 1000).toFixed(3)}，${err >= 0 ? '+' : ''}${(err * 100).toFixed(1)}%）${dirName}${wikiDir ? '（維基）' : '（照 bacinger）'}`);
  const rec = { id, name, origin: [lat, lon], points: res, lengthM: Math.round(L), info: inf, direction: wantCw ? 'clockwise' : 'anticlockwise', directionSource: wikiDir ? 'wikipedia' : 'bacinger', source: how };
  writeFileSync(here(`../public/data/circuits/${id}.json`), JSON.stringify(rec));
  out.push(rec);
}
// 總覽圖：5 欄，每條等比例縮到格子裡，起跑線畫紅點、行進方向畫箭頭
const C = 5, W = 260, H = 230, rows = Math.ceil(out.length / C);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${C * W}" height="${rows * H}" font-family="sans-serif"><rect width="100%" height="100%" fill="#101218"/>`;
out.forEach((c, k) => {
  const ox = (k % C) * W, oy = Math.floor(k / C) * H;
  const xs = c.points.map((p) => p[0]), zs = c.points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const s = Math.min((W - 30) / (x1 - x0), (H - 60) / (z1 - z0));
  const tx = (x) => ox + 15 + (x - x0) * s + ((W - 30) - (x1 - x0) * s) / 2, tz = (z) => oy + 40 + (z - z0) * s + ((H - 60) - (z1 - z0) * s) / 2;
  svg += `<polyline fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linejoin="round" points="${c.points.map((p) => `${tx(p[0]).toFixed(1)},${tz(p[1]).toFixed(1)}`).join(' ')} ${tx(c.points[0][0])},${tz(c.points[0][1])}"/>`;
  const a = c.points[0], b = c.points[Math.min(12, c.points.length - 1)];
  svg += `<circle cx="${tx(a[0])}" cy="${tz(a[1])}" r="5" fill="#e10600"/><line x1="${tx(a[0])}" y1="${tz(a[1])}" x2="${tx(b[0])}" y2="${tz(b[1])}" stroke="#ffd400" stroke-width="3"/>`;
  svg += `<text x="${ox + 10}" y="${oy + 20}" fill="#fff" font-size="14" font-weight="bold">${k + 1}. ${c.name}</text><text x="${ox + 10}" y="${oy + 34}" fill="#9aa" font-size="11">${(c.lengthM / 1000).toFixed(3)} km（官方 ${c.info.lengthKm ?? '?'}）</text>`;
});
writeFileSync(here('./circuits.svg'), svg + '</svg>');
console.log(`共 ${out.length} 條 → public/data/circuits/、tools/circuits.svg`);
