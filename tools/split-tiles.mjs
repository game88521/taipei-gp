// 把 city.json 拆成「核心」＋「600 m 一塊的區塊檔」：
// 建築、行道樹、路邊機車占了大部分的資料和記憶體，改成依區塊放在 public/data/tiles/，遊戲只載入鏡頭附近的區塊（src/city.ts 的串流）；
// 路網、紅綠燈、綠地、地形、高架…留在核心（車流、導航、小地圖要整張地圖的路網）
// 單獨執行：node tools/split-tiles.mjs（讀還沒拆過的 public/data/city.json）；build-city.mjs 最後也會呼叫
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TILE_SIZE = 600;

const enc = (a, stride, scale) => {
  const o = new Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = Math.round(a[i] * scale) - (i >= stride ? Math.round(a[i - stride] * scale) : 0);
  return o;
};
const dec = (a, stride, scale) => { const acc = new Array(stride).fill(0); return a.map((v, i) => (acc[i % stride] += v) / scale); };

export function splitTiles(cityPath, tilesDir, trackPath) {
  const city = JSON.parse(readFileSync(cityPath, 'utf8'));
  if (city.tiles) throw new Error('city.json 已經拆過了（重跑 build-city.mjs 產生完整版）');
  if (city.enc !== 1) throw new Error('只支援瘦身格式（enc: 1）');
  const S = TILE_SIZE, tiles = new Map();
  const tile = (x, z) => {
    const k = `${Math.floor(x / S)}_${Math.floor(z / S)}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { buildings: [], trees: [], parked: [] }));
    return t;
  };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of city.buildings) {
    const p = dec(b.p, 2, 10);
    let cx = 0, cz = 0;
    for (let k = 0; k < p.length; k += 2) {
      cx += p[k]; cz += p[k + 1];
      x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]);
    }
    tile(cx / (p.length / 2), cz / (p.length / 2)).buildings.push(b); // 每棟的座標本來就各自從 0 累加，原樣搬過去
  }
  const trees = dec(city.trees, 2, 10);
  for (let k = 0; k < trees.length; k += 2) tile(trees[k], trees[k + 1]).trees.push(trees[k], trees[k + 1]);
  const parked = dec(city.parked ?? [], 4, 100);
  for (let k = 0; k < parked.length; k += 4) tile(parked[k], parked[k + 1]).parked.push(...parked.slice(k, k + 4));

  rmSync(tilesDir, { recursive: true, force: true });
  mkdirSync(tilesDir, { recursive: true });
  const list = [];
  let total = 0, biggest = 0;
  for (const [k, t] of [...tiles].sort()) {
    const json = JSON.stringify({ enc: 1, buildings: t.buildings, trees: enc(t.trees, 2, 10), parked: enc(t.parked, 4, 100) });
    writeFileSync(`${tilesDir}/${k}.json`, json);
    const [tx, tz] = k.split('_').map(Number);
    list.push([tx, tz, json.length]);
    total += json.length;
    biggest = Math.max(biggest, json.length);
  }
  delete city.buildings; delete city.trees; delete city.parked;
  city.tiles = { size: S, list, bounds: [x0, z0, x1, z1] };
  const core = JSON.stringify(city);
  writeFileSync(cityPath, core);
  if (trackPath) {
    const tr = JSON.parse(readFileSync(trackPath, 'utf8'));
    tr.citySize = core.length;
    writeFileSync(trackPath, JSON.stringify(tr));
  }
  console.log(`拆成 ${list.length} 個區塊（共 ${(total / 1024).toFixed(0)} KB、最大 ${(biggest / 1024).toFixed(0)} KB），核心 city.json ${(core.length / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  splitTiles(here('../public/data/city.json'), here('../public/data/tiles'), here('../src/data/track.json'));
}
