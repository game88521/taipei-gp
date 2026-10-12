// 探測：2026 賽曆 23 條賽道在 OpenStreetMap 有沒有賽道線（highway=raceway）、或賽道的 relation，結果存 tools/circuits-cache/
// 用法：node tools/probe-circuits.mjs
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CIRCUITS = [
  ['australia', 'Albert Park Circuit', -37.8497, 144.968],
  ['china', 'Shanghai International Circuit', 31.3389, 121.2197],
  ['japan', 'Suzuka Circuit', 34.8431, 136.541],
  ['miami', 'Miami International Autodrome', 25.9581, -80.2389],
  ['canada', 'Circuit Gilles Villeneuve', 45.5, -73.5228],
  ['monaco', 'Circuit de Monaco', 43.7347, 7.4206],
  ['barcelona', 'Circuit de Barcelona-Catalunya', 41.57, 2.2611],
  ['austria', 'Red Bull Ring', 47.2197, 14.7647],
  ['britain', 'Silverstone Circuit', 52.0786, -1.0169],
  ['belgium', 'Circuit de Spa-Francorchamps', 50.4372, 5.9714],
  ['hungary', 'Hungaroring', 47.5789, 19.2486],
  ['netherlands', 'Circuit Zandvoort', 52.3888, 4.5409],
  ['italy', 'Monza Circuit', 45.6156, 9.2811],
  ['madrid', 'Madring', 40.4645, -3.6157],
  ['azerbaijan', 'Baku City Circuit', 40.3725, 49.8533],
  ['malaysia', 'Sepang International Circuit', 2.7608, 101.7381],
  ['singapore', 'Marina Bay Street Circuit', 1.2914, 103.864],
  ['usa', 'Circuit of the Americas', 30.1328, -97.6411],
  ['mexico', 'Autódromo Hermanos Rodríguez', 19.4042, -99.0907],
  ['brazil', 'Interlagos Circuit', -23.7036, -46.6997],
  ['lasvegas', 'Las Vegas Strip Circuit', 36.1147, -115.1728],
  ['qatar', 'Lusail International Circuit', 25.49, 51.4542],
  ['abudhabi', 'Yas Marina Circuit', 24.4672, 54.6031],
];

const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const dir = fileURLToPath(new URL('./circuits-cache/', import.meta.url));
mkdirSync(dir, { recursive: true });

async function overpass(q, name) {
  const cache = dir + name + '.json';
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(servers[a % servers.length], { method: 'POST', headers: { 'User-Agent': 'taipei-gp/0.3 (game88521@gmail.com)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (!r.ok) { await new Promise((s) => setTimeout(s, 8000)); continue; }
      const d = await r.json();
      writeFileSync(cache, JSON.stringify(d));
      return d;
    } catch { await new Promise((s) => setTimeout(s, 8000)); }
  }
  throw new Error(name + ' 下載失敗');
}

const len = (g) => { let s = 0; for (let i = 1; i < g.length; i++) { const a = g[i - 1], b = g[i], k = Math.cos((a.lat * Math.PI) / 180); s += Math.hypot((b.lon - a.lon) * 111320 * k, (b.lat - a.lat) * 110574); } return s; };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [id, name, lat, lon] of CIRCUITS) {
    const q = `[out:json][timeout:90];(way["highway"="raceway"](around:3500,${lat},${lon});relation["type"~"route|circuit"]["route"~"racetrack|circuit"](around:3500,${lat},${lon});relation["sport"="motor"](around:3500,${lat},${lon}););out geom;`;
    try {
      const d = await overpass(q, id);
      const ways = d.elements.filter((e) => e.type === 'way');
      const rels = d.elements.filter((e) => e.type === 'relation');
      const total = ways.reduce((s, w) => s + len(w.geometry), 0);
      const named = [...new Set(ways.map((w) => w.tags?.name).filter(Boolean))].slice(0, 4);
      console.log(`${id.padEnd(11)} 賽道線 ${String(ways.length).padStart(3)} 段 共 ${(total / 1000).toFixed(1)} km｜relation ${rels.length}（${rels.map((r) => r.tags?.name).filter(Boolean).slice(0, 2).join('、')}）｜${named.join('、')}`);
    } catch (e) { console.log(id, '失敗', e.message); }
  }
}
