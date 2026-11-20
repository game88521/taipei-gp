import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = new URL('../public/data/city.json', import.meta.url);
const bytes = await readFile(source), city = JSON.parse(bytes);
const decode = (a, stride, scale) => { const acc = Array(stride).fill(0); return a.map((v, i) => (acc[i % stride] += v) / scale); };
if (city.enc === 1) {
  city.net.nodes = decode(city.net.nodes, 2, 10);
  city.net.y = decode(city.net.y ?? [], 1, 10);
  for (const way of city.net.ways) way.n = decode(way.n, 1, 1);
  if (city.terrain) city.terrain.h = decode(city.terrain.h, 1, 2);
}
const n = city.net.nodes, heights = city.net.y ?? [], adj = new Map(), rev = new Map();
function edge(a, b) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); if (!rev.has(b)) rev.set(b, []); rev.get(b).push(a); }
const ways = city.net.ways.filter(w => !w.e && w.c <= 2 && w.w >= 8);
for (const w of ways) for (let i = 1; i < w.n.length; i++) { if (w.o !== -1) edge(w.n[i - 1], w.n[i]); if (w.o !== 1) edge(w.n[i], w.n[i - 1]); }
let hub = [...adj.keys()].sort((a, b) => n[2 * a] ** 2 + n[2 * a + 1] ** 2 - n[2 * b] ** 2 - n[2 * b + 1] ** 2)[0];
function reachable(map) { const seen = new Set([hub]), stack = [hub]; while (stack.length) for (const x of map.get(stack.pop()) ?? []) if (!seen.has(x)) { seen.add(x); stack.push(x); } return seen; }
const fwd = reachable(adj), back = reachable(rev), candidates = [];
function ground(x, z) {
  const t = city.terrain; if (!t) return 0;
  const fx = (x - t.x0) / t.step, fz = (z - t.z0) / t.step, i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return 0;
  const a = fx - i, b = fz - j, h = t.h, stride = t.nx;
  return (h[j * stride + i] * (1 - a) + h[j * stride + i + 1] * a) * (1 - b) + (h[(j + 1) * stride + i] * (1 - a) + h[(j + 1) * stride + i + 1] * a) * b;
}
for (const w of ways) for (let k = 1; k < w.n.length; k++) {
  const a = w.n[k - 1], b = w.n[k]; if (![a, b].every(x => fwd.has(x) && back.has(x))) continue;
  let dx = n[2 * b] - n[2 * a], dz = n[2 * b + 1] - n[2 * a + 1], length = Math.hypot(dx, dz);
  if (length < 35) continue;
  let x = (n[2 * a] + n[2 * b]) / 2, z = (n[2 * a + 1] + n[2 * b + 1]) / 2;
  if (Math.hypot(x, z) > 2100 || Math.abs(((heights[a] ?? 0) + (heights[b] ?? 0)) / 2 - ground(x, z)) > 1.2) continue;
  if (w.o === -1) { dx = -dx; dz = -dz; }
  const offset = Math.min(2.8, w.w / 4); x += dz / length * offset; z -= dx / length * offset;
  candidates.push({ x: +x.toFixed(2), z: +z.toFixed(2), y: +(ground(x, z) - .25).toFixed(2), h: +Math.atan2(dx, dz).toFixed(5), road: (w.nm ?? '城市道路').slice(0, 30), nodes: [a, b] });
}
assert.ok(candidates.length > 7, '真實主路網沒有足夠站點');
candidates.sort((a, b) => Math.hypot(a.x - 440, a.z - 506) - Math.hypot(b.x - 440, b.z - 506));
const chosen = [candidates[0]];
while (chosen.length < 7) {
  const available = candidates.filter(p => chosen.every(q => Math.hypot(p.x - q.x, p.z - q.z) >= 280) && Math.hypot(p.x - chosen[0].x, p.z - chosen[0].z) <= 1650);
  available.sort((a, b) => Math.min(...chosen.map(q => Math.hypot(b.x - q.x, b.z - q.z))) - Math.min(...chosen.map(q => Math.hypot(a.x - q.x, a.z - q.z))));
  assert.ok(available.length, '真實站點間距不足'); chosen.push(available[0]);
}
const stations = chosen.map((p, i) => ({ id: `station-${i}`, name: i ? `${p.road}合作站${i}` : `${p.road}共同倉庫`, ...p }));
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
const stamp = createHash('sha256').update(JSON.stringify({ sourceSha256, stations })).digest('hex').slice(0, 20);
const result = { v: 1, stamp: `coop-city-v1:${stamp}`, sourceSha256, stations };
const out = new URL('../shared/nexus-coop-city.json', import.meta.url), body = JSON.stringify(result, null, 2) + '\n';
let old = ''; try { old = await readFile(out, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (old !== body) await writeFile(out, body);
console.log(JSON.stringify({ stations: stations.length, stamp: result.stamp, changed: old !== body, directedGroundNetworkHub: hub, reachableGroundNodes: fwd.size }));
