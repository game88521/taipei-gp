// 從 OpenStreetMap（Overpass API）下載道路、建築、公園、樹、紅綠燈、斑馬線，存成 tools/osm-raw.json
// 範圍大（信義、東區、大安森林公園、小巨蛋、饒河、象山），一次抓會逾時，所以切成小塊依序下載再合併
// 用法：npm run fetch-osm（只有要更新地圖資料時才需要跑；結果給 build-city 用）
// 資料授權：© OpenStreetMap contributors，ODbL
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 南、西、北、東（緯度、經度）
export const BBOX = [25.02, 121.53, 25.056, 121.59];
const ROWS = 2, COLS = 3;

const q = (bb) => `[out:json][timeout:120];
(
  way["highway"](${bb});
  way["building"](${bb});
  way["building:part"](${bb});
  relation["building"](${bb});
  way["leisure"~"park|garden|pitch"](${bb});
  way["landuse"~"grass|park|recreation_ground|forest"](${bb});
  way["natural"~"wood|scrub"](${bb});
  relation["leisure"="park"](${bb});
  node["natural"="tree"](${bb});
  node["highway"~"traffic_signals|crossing"](${bb});
);
out geom;`;

const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const cacheDir = fileURLToPath(new URL('./osm-cache/', import.meta.url));
mkdirSync(cacheDir, { recursive: true });

async function fetchPart(bb, name) {
  const cache = cacheDir + name + '.json';
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8')); // 中斷後重跑不用重抓已經下載的塊
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = servers[attempt % servers.length];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'taipei-gp/0.2 (game88521@gmail.com)', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q(bb)),
      });
      if (!r.ok) { console.warn(`  ${name} ${url} → HTTP ${r.status}，等一下再試`); await new Promise((s) => setTimeout(s, 8000)); continue; }
      const d = await r.json();
      writeFileSync(cache, JSON.stringify(d));
      return d;
    } catch (e) {
      console.warn(`  ${name} ${url} 失敗：${e.message}`);
      await new Promise((s) => setTimeout(s, 8000));
    }
  }
  throw new Error(`${name} 下載失敗`);
}

const [s, w, n, e] = BBOX, all = new Map();
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const bb = [s + ((n - s) * r) / ROWS, w + ((e - w) * c) / COLS, s + ((n - s) * (r + 1)) / ROWS, w + ((e - w) * (c + 1)) / COLS].map((v) => v.toFixed(5)).join(',');
  const name = `part-${r}-${c}`;
  console.log(`下載 ${name}（${bb}）`);
  const d = await fetchPart(bb, name);
  for (const el of d.elements) all.set(el.type + el.id, el); // 跨塊的道路、建築會重複，用 id 去重
  console.log(`  ${d.elements.length} 筆，累計 ${all.size}`);
}
const out = fileURLToPath(new URL('./osm-raw.json', import.meta.url));
writeFileSync(out, JSON.stringify({ elements: [...all.values()] }));
console.log(`完成：${all.size} 筆 → ${out}`);
