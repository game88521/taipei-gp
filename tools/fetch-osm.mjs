// 從 OpenStreetMap（Overpass API）下載信義區周邊的道路、建築、公園，存成 tools/osm-raw.json
// 用法：npm run fetch-osm（只有要更新地圖資料時才需要跑；結果會被 build-city 使用）
// 資料授權：© OpenStreetMap contributors，ODbL
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 南、西、北、東（緯度、經度）
export const BBOX = [25.0255, 121.5475, 25.0485, 121.5765];
const bb = BBOX.join(',');
const query = `[out:json][timeout:120];
(
  way["highway"](${bb});
  way["building"](${bb});
  way["building:part"](${bb});
  relation["building"](${bb});
  way["leisure"~"park|garden|pitch"](${bb});
  way["landuse"~"grass|park|recreation_ground"](${bb});
  relation["leisure"="park"](${bb});
  node["natural"="tree"](${bb});
  node["highway"~"traffic_signals|crossing"](${bb});
);
out geom;`;

const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
for (const url of servers) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': 'taipei-gp/0.1 (game88521@gmail.com)', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!r.ok) { console.warn(`${url} → HTTP ${r.status}`); continue; }
    const d = await r.json();
    const out = fileURLToPath(new URL('./osm-raw.json', import.meta.url));
    writeFileSync(out, JSON.stringify(d));
    console.log(`下載 ${d.elements.length} 筆 → ${out}`);
    process.exit(0);
  } catch (e) {
    console.warn(`${url} 失敗：${e.message}`);
  }
}
process.exit(1);
