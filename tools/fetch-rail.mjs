// 另外下載捷運／鐵路的軌道（文湖線高架、板南線地下），存成 tools/osm-rail.json 給 build-city 用
// 道路建築那份（fetch-osm）沒有抓 railway；這份資料量很小，一次抓完
// 用法：node tools/fetch-rail.mjs
// 資料授權：© OpenStreetMap contributors，ODbL
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// 範圍同 fetch-osm.mjs 的 BBOX（不 import：那支一載入就會開始下載）
const BBOX = [25.02, 121.52, 25.068, 121.59];

const bb = BBOX.join(',');
const q = `[out:json][timeout:90];
(
  way["railway"~"subway|light_rail|rail|monorail"](${bb});
  node["railway"="station"](${bb});
  way["railway"="platform"](${bb});
);
out geom;`;
const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
for (let attempt = 0; attempt < 6; attempt++) {
  const url = servers[attempt % servers.length];
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': 'taipei-gp/0.2 (game88521@gmail.com)', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!r.ok) { console.log(`  ${url} → HTTP ${r.status}`); await new Promise((s) => setTimeout(s, 8000)); continue; }
    const j = await r.json();
    writeFileSync(fileURLToPath(new URL('./osm-rail.json', import.meta.url)), JSON.stringify(j));
    console.log(`完成：${j.elements.length} 筆 → tools/osm-rail.json`);
    process.exit(0);
  } catch (e) {
    console.log(`  ${url} 失敗：${e.message}`);
    await new Promise((s) => setTimeout(s, 5000));
  }
}
console.log('下載失敗');
process.exit(1);
