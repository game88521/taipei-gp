// 平面圖檢查：建築（灰）、道路（深灰）、綠地（綠）、樹（點）、賽道（紅），輸出 tools/plan.svg
import { readFileSync, writeFileSync } from 'node:fs';
const c = JSON.parse(readFileSync(new URL('../public/data/city.json', import.meta.url)));
const t = JSON.parse(readFileSync(new URL('../src/data/track.json', import.meta.url)));
const [x0, z0, x1, z1] = [-700, -850, 1100, 950];
const poly = (p) => { let s = ''; for (let k = 0; k < p.length; k += 2) s += `${p[k]},${p[k + 1]} `; return s; };
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" width="1600" height="1600" style="background:#e9e6df">`;
for (const g of c.greens) svg += `<polygon points="${poly(g.p)}" fill="${g.k === 2 ? '#9cc98a' : '#b9dca6'}"/>`;
for (const r of c.roads) svg += `<polyline points="${poly(r.p)}" fill="none" stroke="#9a9a9a" stroke-width="${r.w}" stroke-linecap="round"/>`;
for (const b of c.buildings) svg += `<polygon points="${poly(b.p)}" fill="${b.s === 1 ? '#6f8fa8' : b.h > 60 ? '#777' : '#b5aea3'}" stroke="#7a746b" stroke-width="0.4"/>`;
for (let k = 0; k < c.trees.length; k += 2) svg += `<circle cx="${c.trees[k]}" cy="${c.trees[k + 1]}" r="1.6" fill="#3f7f3a"/>`;
svg += `<polygon points="${t.points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#e10600" stroke-width="5" stroke-opacity="0.75"/>`;
svg += `<circle cx="${t.points[0][0]}" cy="${t.points[0][1]}" r="9" fill="#000"/><circle cx="${t.tower101[0]}" cy="${t.tower101[1]}" r="12" fill="none" stroke="#00a" stroke-width="3"/>`;
writeFileSync(new URL('./plan.svg', import.meta.url), svg + '</svg>');
