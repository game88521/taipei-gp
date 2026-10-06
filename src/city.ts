import * as THREE from 'three';
import { makeFiller, buildFiller, type Filler } from './filler';
import { buildSpecial, buildTrails } from './landmarks3d';
import { buildElevated, type ElevatedHits } from './elevated';
import { canvasTex, SHADOW_PER_M, bakedShadowMaterial, blobTexture } from './world';
import { TOWER_101, CITY_SIZE, type Track } from './track';
import { stage, fetchJson } from './loading';

// 真實台北：public/data/city.json 由 tools/build-city.mjs 從 OpenStreetMap 產生
// 地圖資料 © OpenStreetMap contributors（ODbL）

import { terrainHeight, type CityData } from './citydata';
import { buildRoads, buildCrossings, buildStreetSigns, buildLandmarks, type Landmark } from './decor';
import type { Quality } from './quality';
import { scooterParkedGeo } from './models';
import { Breakables } from './breakables';

const FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
const FLOOR = 3.3; // 一層樓高
const TILE_U = 8; // 外牆貼圖橫向每 8 m（兩個開間）重複
const TILE_V = FLOOR * 2; // 縱向每兩層重複
const TILE = 300; // 城市分區塊的大小（m）

// 每棟樓的穩定亂數（同一份資料每次長得一樣）
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** 外牆貼圖：顏色圖 + 只有亮燈窗戶的發光圖（發光不受牆面染色影響） */
function facade(kind: 'res' | 'glass' | 'civic', seed: number, reflective = false) {
  const r = rng(seed);
  const look = seed % 3; // 公寓的三種長相：0 鐵窗冷氣、1 陽台欄杆、2 大窗＋遮雨棚
  const lit: [number, number, number, number][] = [];
  const map = canvasTex(256, 256, (g) => {
    if (kind === 'glass') {
      const grd = g.createLinearGradient(0, 0, 256, 256);
      grd.addColorStop(0, '#6f8fa3');
      grd.addColorStop(1, '#4a6878');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 8; col++) {
          const x = col * 32, y = row * 64;
          if (r() < 0.16) { lit.push([x + 2, y + 10, 28, 46]); g.fillStyle = '#ffe9b8'; g.fillRect(x + 2, y + 10, 28, 46); }
        }
        g.fillStyle = 'rgba(200,214,220,0.75)';
        g.fillRect(0, row * 64, 256, 6); // 樓板
      }
      g.fillStyle = 'rgba(210,225,232,0.45)';
      for (let col = 0; col <= 8; col++) g.fillRect(col * 32 - 1, 0, 2, 256); // 直向窗框
    } else if (kind === 'civic') {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 2; row++) {
        const y = row * 128 + 40;
        g.fillStyle = '#3a4250';
        g.fillRect(14, y, 228, 52);
        if (r() < 0.5) { lit.push([14, y, 228, 52]); g.fillStyle = '#fff1cc'; g.fillRect(14, y, 228, 52); }
        g.fillStyle = '#d8d8d8';
        for (let k = 1; k < 6; k++) g.fillRect(14 + k * 38, y, 3, 52);
      }
    } else {
      // 台北公寓：磁磚牆、鐵窗、冷氣機
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(0,0,0,0.06)';
      for (let y = 0; y < 256; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
      for (let row = 0; row < 2; row++) {
        if (look === 1) { // 陽台：一條水泥樓板帶＋欄杆
          g.fillStyle = 'rgba(0,0,0,0.12)';
          g.fillRect(0, row * 128 + 104, 256, 14);
          g.fillStyle = 'rgba(60,60,60,0.7)';
          for (let x = 0; x < 256; x += 9) g.fillRect(x, row * 128 + 92, 2, 14);
          g.fillRect(0, row * 128 + 90, 256, 3);
        }
        for (let col = 0; col < 2; col++) {
          const big = look === 2;
          const x = col * 128 + (big ? 12 : 22), y = row * 128 + (big ? 22 : 30), w = big ? 104 : 84, h = big ? 74 : 62;
          const on = r() < 0.4;
          g.fillStyle = on ? '#ffd88a' : '#2c3542';
          g.fillRect(x, y, w, h);
          if (on) lit.push([x, y, w, h]);
          if (big) { // 遮雨棚
            g.fillStyle = ['#3f7fae', '#4f9a5a', '#b8b0a0'][(row + col + seed) % 3];
            g.fillRect(x - 6, y - 12, w + 12, 9);
          }
          if (look === 0 && r() < 0.75) { // 鐵窗
            g.strokeStyle = 'rgba(70,70,70,0.85)';
            g.lineWidth = 2;
            g.strokeRect(x - 4, y - 4, w + 8, h + 8);
            for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(x + (k * w) / 6, y - 4); g.lineTo(x + (k * w) / 6, y + h + 4); g.stroke(); }
          }
          if (r() < 0.55) { g.fillStyle = '#d5d5d0'; g.fillRect(x + w - 34, y + h + 8, 30, 20); g.fillStyle = '#9a9a96'; g.fillRect(x + w - 30, y + h + 12, 22, 12); }
        }
      }
    }
  });
  const emissive = canvasTex(256, 256, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = kind === 'glass' ? '#ffe2a8' : '#ffcf80';
    for (const [x, y, w, h] of lit) g.fillRect(x, y, w, h);
  });
  map.anisotropy = emissive.anisotropy = 8;
  // 高畫質：玻璃帷幕用會反射天空的材質（夕陽時整面樓映出晚霞）
  // userData.windows：亮燈窗戶的亮度跟著時段變（weather.ts：白天暗、晚上亮）
  const m = reflective
    ? new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: '#ffffff', emissiveIntensity: 0.9, vertexColors: true, metalness: 0.55, roughness: 0.22, envMapIntensity: 1.1 })
    : new THREE.MeshLambertMaterial({ map, emissiveMap: emissive, emissive: '#ffffff', emissiveIntensity: 0.9, vertexColors: true });
  m.userData.windows = true;
  return m;
}

/** 店面：一樓亮燈的玻璃櫥窗 + 上方橫式招牌，4 種店輪流 */
function storefrontMat() {
  const shops = [['便利商店', '#0a7a3a'], ['手搖飲', '#e8501a'], ['藥局', '#1a4fa8'], ['麵包店', '#8a3a1a'], ['眼鏡行', '#333a8a'], ['小吃', '#b8141a']];
  const map = canvasTex(1536, 256, (g) => {
    shops.forEach(([name, col], k) => {
      const x = k * 256;
      g.fillStyle = col;
      g.fillRect(x, 0, 256, 78);
      g.fillStyle = '#fff';
      g.font = `bold 52px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, x + 128, 42, 230);
      const grd = g.createLinearGradient(0, 84, 0, 256);
      grd.addColorStop(0, '#fff6d8');
      grd.addColorStop(1, '#ffc977');
      g.fillStyle = grd;
      g.fillRect(x + 6, 84, 244, 172);
      g.fillStyle = 'rgba(60,40,20,0.55)';
      g.fillRect(x + 6, 84, 4, 172);
      g.fillRect(x + 124, 84, 4, 172);
      g.fillRect(x + 246, 84, 4, 172);
      g.fillStyle = 'rgba(80,60,40,0.35)';
      for (let s = 0; s < 3; s++) g.fillRect(x + 20 + s * 80, 150 + (s % 2) * 20, 50, 80); // 店內貨架剪影
    });
  });
  const m = new THREE.MeshBasicMaterial({ map, toneMapped: false });
  m.userData.nightScale = 1.45; // 店面燈箱：晚上更亮、會暈開
  return m;
}

/** 直式霓虹招牌圖集（8 格） */
function signMat() {
  const words = ['珍珠奶茶', '鹹酥雞', '牛肉麵', '臭豆腐', '卡拉OK', '滷肉飯', '小籠包', '豆花'];
  const bg = ['#c8102e', '#0b3d91', '#006b3f', '#6a1b9a', '#e65100', '#1a1a1a', '#ad1457', '#00695c'];
  const map = canvasTex(1024, 512, (g) => {
    words.forEach((w, k) => {
      const x0 = k * 128;
      g.fillStyle = bg[k];
      g.fillRect(x0, 0, 128, 512);
      g.strokeStyle = '#ffe9a8';
      g.lineWidth = 6;
      g.strokeRect(x0 + 8, 8, 112, 496);
      g.fillStyle = '#ffffff';
      g.font = `bold 84px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const chars = w === '卡拉OK' ? ['卡', '拉', 'O', 'K'] : [...w];
      const step = 470 / chars.length;
      chars.forEach((ch, n) => g.fillText(ch, x0 + 64, 22 + step * (n + 0.5)));
    });
  }, false);
  const m = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, toneMapped: false });
  m.userData.nightScale = 1.6; // 直式招牌
  return m;
}

/** 累積三角形用的小工具 */
function releaseArray(this: { array: ArrayLike<number> | null }) { this.array = null; }

class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], n: number[], ua: number[], ub: number[], uc: number[], color?: THREE.Color) {
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc);
    if (color) for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b);
  }
  /** 每個頂點各自的顏色（牆腳的接地陰影用） */
  tri3(a: number[], b: number[], c: number[], n: number[], ua: number[], ub: number[], uc: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color) {
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    // 建完就丟掉 JS 陣列；送進顯示卡之後連 CPU 這份也丟掉（城市是靜態的，不會再改）。
    // 不丟的話：loadCity 回傳的 cull 會讓整個函式範圍（含 tiles）一直活著，大地圖光這些就吃掉幾百 MB
    this.pos = []; this.nor = []; this.uv = []; this.col = [];
    for (const k in g.attributes) (g.attributes[k] as THREE.BufferAttribute).onUpload(releaseArray);
    return g;
  }
}

const toRing = (p: number[]) => {
  const r: [number, number][] = [];
  for (let k = 0; k < p.length; k += 2) r.push([p[k], p[k + 1]]);
  return r;
};
const signedArea = (r: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
  return a / 2;
};

/** 水平多邊形（屋頂、綠地）：三角化並確保正面朝上（或朝下） */
function flatPoly(geo: Geo, r: [number, number][], y: number, up: boolean, color: THREE.Color, uvAt: (x: number, z: number) => number[]) {
  const tris = THREE.ShapeUtils.triangulateShape(r.map(([x, z]) => new THREE.Vector2(x, z)), []);
  const n = up ? [0, 1, 0] : [0, -1, 0];
  for (const [a, b, c] of tris) {
    let [pa, pb, pc] = [r[a], r[b], r[c]];
    const cy = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
    if ((cy < 0) === up) [pb, pc] = [pc, pb];
    geo.tri([pa[0], y, pa[1]], [pb[0], y, pb[1]], [pc[0], y, pc[1]], n, uvAt(pa[0], pa[1]), uvAt(pb[0], pb[1]), uvAt(pc[0], pc[1]), color);
  }
}

export async function loadCity(scene: THREE.Scene, t: Track, q: Quality): Promise<{ data: CityData; landmarks: Landmark[]; breakables: Breakables; raceHide: THREE.Object3D[]; cull: (x: number, z: number, r: number) => void; filler: Filler; elev: ElevatedHits }> {
  // 依距離顯示：每個區塊記住中心點，離鏡頭太遠就整塊不畫（地圖變大後很重要）
  // 分四層：far = 整個可視距離（建築、屋頂）；mid = 一半多（樹冠）；near = 550 m 內（店面、招牌、地上影子、機車、樹幹）；
  // close = 300 m 內（路名牌：一支一個物件，離遠了也看不清字）。遠處的小東西在手機螢幕上只有幾個像素，卻一個就多一次繪製
  // pad = 區塊半徑（區塊中心到角落），單一物件是 0
  type Layer = 'far' | 'mid' | 'near' | 'close';
  const cullables: { o: THREE.Object3D; x: number; z: number; layer: Layer; pad: number }[] = [];
  const cullAdd = (o: THREE.Object3D, x: number, z: number, layer: Layer = 'far', pad = TILE * 0.71) => cullables.push({ o, x, z, layer, pad });
  const breakables = new Breakables();
  const data = await fetchJson<CityData>('/data/city.json', CITY_SIZE, '下載台北街景', 0.02, 0.4);
  await stage('鋪地面與綠地', 0.42);

  // 賽道取樣點的格狀索引：查「離賽道多遠、賽道往哪走」
  const G = 30, grid = new Map<string, number[]>();
  for (let i = 0; i < t.N; i++) {
    const k = `${Math.floor(t.px[i] / G)},${Math.floor(t.pz[i] / G)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  }
  const nearest = (x: number, z: number): [number, number] => {
    let bi = -1, bd = Infinity;
    const cx = Math.floor(x / G), cz = Math.floor(z / G);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const i of grid.get(`${cx + a},${cz + b}`) || []) {
        const d = (x - t.px[i]) ** 2 + (z - t.pz[i]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
    }
    return [bi, Math.sqrt(bd)];
  };

  // 主要道路（幹道～一般道路）的格狀索引：給騎樓店面與招牌找「面向哪條路」
  const RG = 30, rgrid = new Map<string, [number, number, number, number, number][]>();
  {
    const NN = data.net.nodes;
    for (const w of data.net.ways) {
      if (w.c > 2) continue;
      for (let k = 0; k + 1 < w.n.length; k++) {
        const s: [number, number, number, number, number] = [NN[w.n[k] * 2], NN[w.n[k] * 2 + 1], NN[w.n[k + 1] * 2], NN[w.n[k + 1] * 2 + 1], w.w / 2];
        for (let gx = Math.floor(Math.min(s[0], s[2]) / RG); gx <= Math.floor(Math.max(s[0], s[2]) / RG); gx++)
          for (let gz = Math.floor(Math.min(s[1], s[3]) / RG); gz <= Math.floor(Math.max(s[1], s[3]) / RG); gz++) {
            const key = `${gx},${gz}`;
            if (!rgrid.has(key)) rgrid.set(key, []);
            rgrid.get(key)!.push(s);
          }
      }
    }
  }
  /** 最近的主要道路：路面邊緣的距離、道路方向、最近點 */
  const nearestRoad = (x: number, z: number) => {
    let best: { edge: number; ux: number; uz: number; px: number; pz: number } | null = null;
    const cx = Math.floor(x / RG), cz = Math.floor(z / RG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const [x1, z1, x2, z2, hw] of rgrid.get(`${cx + a},${cz + b}`) || []) {
        const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (l * l)));
        const px = x1 + dx * t, pz = z1 + dz * t, edge = Math.hypot(x - px, z - pz) - hw;
        if (!best || edge < best.edge) best = { edge, ux: dx / l, uz: dz / l, px, pz };
      }
    }
    return best;
  };

  // ---- 綠地
  const green = new Geo();
  const gcol = [new THREE.Color('#5d7f45'), new THREE.Color('#557a40'), new THREE.Color('#4f8048'), new THREE.Color('#3a5e32')]; // 草地、公園、球場、森林
  for (const g of data.greens) {
    const r = toRing(g.p);
    try { flatPoly(green, r, -0.45, true, gcol[g.k] ?? gcol[0], () => [0, 0]); } catch { /* 少數畸形多邊形跳過 */ }
  }
  const greenMesh = new THREE.Mesh(green.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  greenMesh.userData.flat = true; // 平面：只接受陰影、不投射
  if (data.terrain) scene.add(terrainMesh(data.terrain));
  scene.add(greenMesh);

  // ---- 道路（有標線）、斑馬線、路名牌、地標招牌
  await stage('鋪道路與斑馬線', 0.46);
  buildRoads(scene, data);
  buildCrossings(scene, data);
  const raceHide = buildStreetSigns(scene, data, breakables, (x, z) => nearest(x, z)[1] < 16, (g, x, z) => cullAdd(g, x, z, 'close', 0));
  const landmarks = buildLandmarks(scene, data);

  // ---- 建築
  await stage('蓋房子', 0.5);
  // 依 300 m 分區塊：鏡頭（和陰影）看不到的區塊整塊不畫
  // 外牆、屋頂從遠處就看得到，用 600 m 的大區塊（繪製次數少 4 倍）；店面、招牌、地上影子只在近處畫，用 300 m
  const BIG = TILE * 2;
  const tiles = new Map<string, Geo>();
  const sizeOf = (kind: string) => (kind === 'shop' || kind === 'sign' || kind === 'shadow' ? TILE : BIG);
  const tileGeo = (kind: string, x: number, z: number) => {
    const S = sizeOf(kind);
    const key = `${kind}|${Math.floor(x / S)},${Math.floor(z / S)}`;
    let g = tiles.get(key);
    if (!g) tiles.set(key, (g = new Geo()));
    return g;
  };
  // 頂樓：水塔（圓柱）、鐵皮加蓋（方塊），台北公寓的標準配備
  const tanks: [number, number, number, number][] = [], sheds: [number, number, number, number, number, number, number][] = [];
  const resTint = ['#e8e1d5', '#d9d0c3', '#cfc8bd', '#e3d6c8', '#c9cdd1', '#d8cbbd', '#bfb7aa', '#e6d9cf'].map((c) => new THREE.Color(c));
  const roofCol = [new THREE.Color('#8b8883'), new THREE.Color('#7d8288'), new THREE.Color('#96918a')];
  const white = new THREE.Color('#ffffff'), civic = new THREE.Color('#ddd7cc');
  const r = rng(101);
  const roofDetails = (ring: [number, number][], y: number) => {
    const A = Math.abs(signedArea(ring));
    if (A < 80) return;
    let cx = 0, cz = 0;
    for (const p of ring) { cx += p[0]; cz += p[1]; }
    cx /= ring.length; cz /= ring.length;
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i], [xj, zj] = ring[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    const span = Math.sqrt(A) * 0.3;
    const n = A > 300 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * span, z = cz + (r() - 0.5) * span;
      if (inside(x, z)) tanks.push([x, y, z, 0.9 + r() * 0.5]);
    }
    if (r() < 0.35) {
      // 鐵皮加蓋：大約占屋頂中間的一塊，順著最長的牆
      let bi = 0, bl = 0;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length, l = Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]);
        if (l > bl) { bl = l; bi = i; }
      }
      const j = (bi + 1) % ring.length;
      const ang = Math.atan2(ring[j][0] - ring[bi][0], ring[j][1] - ring[bi][1]);
      const w = Math.min(bl * 0.5, 9), d = Math.min(Math.sqrt(A) * 0.45, 7);
      if (inside(cx, cz)) sheds.push([cx, y, cz, w, d, ang, Math.floor(r() * 4)]);
    }
  };
  for (const b of data.buildings) {
    // 101 塔身：OSM 只有一根方柱，改用下面手工的竹節造型（裙樓購物中心照 OSM）
    if (b.h > 100) {
      let cx = 0, cz = 0;
      for (let k = 0; k < b.p.length; k += 2) { cx += b.p[k]; cz += b.p[k + 1]; }
      cx /= b.p.length / 2; cz /= b.p.length / 2;
      if (Math.hypot(cx - TOWER_101.x, cz - TOWER_101.z) < 40) continue;
    }
    let ring = toRing(b.p);
    if (signedArea(ring) > 0) ring = ring.reverse(); // 讓牆面法線朝外
    const y0 = b.m ?? -0.6, y1 = b.h; // 落地的樓從地面（-0.6）長起
    const tint = b.c ? new THREE.Color(b.c) : b.s === 1 ? white : b.s === 3 ? civic : resTint[Math.floor(r() * resTint.length)];
    if (b.c && b.s === 1) tint.lerp(white, 0.5); // 玻璃帷幕不要染太重
    const style = b.s === 2 ? 0 : b.s;
    // 外牆變化：公寓 3 款、玻璃帷幕 2 款，同一區不會整片長一樣
    const variant = style === 0 ? Math.floor(r() * 3) : style === 1 ? Math.floor(r() * 2) : 0;
    const geo = tileGeo(`f${style}${variant}`, ring[0][0], ring[0][1]);
    const roofs = tileGeo('roof', ring[0][0], ring[0][1]);
    const shopsGeo = tileGeo('shop', ring[0][0], ring[0][1]), signsGeo = tileGeo('sign', ring[0][0], ring[0][1]);
    if (q.rooftops && style === 0 && y0 < 0 && y1 < 45 && !b.k) roofDetails(ring, y1);
    const aoTint = tint.clone().multiplyScalar(0.5);
    // 預先算好的地面影子：腳印＋沿太陽反方向推出去的腳印，取凸包（高度最多算 80 m，免得 101 的影子拖到 1.5 km 外）
    if (y0 < 0 && y1 > 3) {
      const L = Math.min(y1, 80), ox = SHADOW_PER_M.x * L, oz = SHADOW_PER_M.z * L;
      const hull = convexHull([...ring, ...ring.map(([x, z]) => [x + ox, z + oz] as [number, number])]);
      const sg = tileGeo('shadow', ring[0][0], ring[0][1]);
      for (let k = 1; k + 1 < hull.length; k++) {
        const A = hull[0], B = hull[k], C = hull[k + 1];
        // 讓三角形正面朝上
        const cy = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
        const [P, Q] = cy < 0 ? [C, B] : [B, C];
        sg.tri([A[0], 0.03, A[1]], [P[0], 0.03, P[1]], [Q[0], 0.03, Q[1]], [0, 1, 0], [0, 0], [0, 0], [0, 0]);
      }
    }
    // 有專屬造型的地標：影子照外框算（上面），模型另外做
    if (b.k) {
      const m = buildSpecial(b);
      if (m) { scene.add(m); cullAdd(m, ring[0][0], ring[0][1], 'far', 200); continue; }
    }
    let u = 0;
    const streetLevel = y0 < 0 && (b.s === 0 || b.s === 2) && y1 < 70;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      const n = [-dz / l, 0, dx / l];
      const u0 = u / TILE_U, u1 = (u + l) / TILE_U;
      // 接地陰影：落地的牆最下面 3 m 由暗到亮（像環境光遮蔽），之上照常
      const band = y0 < 0 && y1 - y0 > 4 ? y0 + 3.4 : y0;
      if (band > y0) {
        const v0 = y0 / TILE_V, vb = band / TILE_V;
        geo.tri3([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], band, c[1]], n, [u0, v0], [u1, v0], [u1, vb], aoTint, aoTint, tint);
        geo.tri3([a[0], y0, a[1]], [c[0], band, c[1]], [a[0], band, a[1]], n, [u0, v0], [u1, vb], [u0, vb], aoTint, tint, tint);
      }
      geo.tri([a[0], band, a[1]], [c[0], band, c[1]], [c[0], y1, c[1]], n, [u0, band / TILE_V], [u1, band / TILE_V], [u1, y1 / TILE_V], tint);
      geo.tri([a[0], band, a[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], n, [u0, band / TILE_V], [u1, y1 / TILE_V], [u0, y1 / TILE_V], tint);
      u += l;

      // 面向主要道路的騎樓店面與直式招牌（整個城市的大馬路兩側都有）
      if (!streetLevel || l < 5) continue;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const rd = nearestRoad(mx, mz);
      if (!rd || rd.edge > 14) continue;
      const toT = [rd.px - mx, rd.pz - mz], tl = Math.hypot(toT[0], toT[1]) || 1;
      if ((n[0] * toT[0] + n[2] * toT[1]) / tl < 0.5) continue;
      const o = 0.06, sh = Math.min(4.4, y1 - 0.5);
      const A = [a[0] + n[0] * o, a[1] + n[2] * o], C = [c[0] + n[0] * o, c[1] + n[2] * o];
      const su0 = (u - l) / 7, su1 = u / 7; // 每 7 m 一間店
      shopsGeo.tri([A[0], -0.25, A[1]], [C[0], -0.25, C[1]], [C[0], sh, C[1]], n, [su0 / 6, 0], [su1 / 6, 0], [su1 / 6, 1]);
      shopsGeo.tri([A[0], -0.25, A[1]], [C[0], sh, C[1]], [A[0], sh, A[1]], n, [su0 / 6, 0], [su1 / 6, 1], [su0 / 6, 1]);
      if (y1 > 10 && l > 7 && r() < 0.55) {
        const f = 0.2 + r() * 0.6, sx = a[0] + dx * f + n[0] * 1.1, sz = a[1] + dz * f + n[2] * 1.1;
        const hgt = Math.min(7, y1 - 5), yc = 5 + hgt / 2 + r() * Math.max(0, y1 - 12 - hgt) * 0.3;
        // 招牌垂直於騎樓、面向道路其中一個方向（雙面材質，兩邊來的車都看得到）
        const flip = r() < 0.5 ? 1 : -1;
        const slot = Math.floor(r() * 8), fx = rd.ux * flip, fz = rd.uz * flip;
        const px = fz * 0.9, pz = -fx * 0.9; // 招牌寬度方向（從迎面看過去由左到右）
        const nn = [fx, 0, fz];
        const p1 = [sx - px, yc - hgt / 2, sz - pz], p2 = [sx + px, yc - hgt / 2, sz + pz], p3 = [sx + px, yc + hgt / 2, sz + pz], p4 = [sx - px, yc + hgt / 2, sz - pz];
        signsGeo.tri(p1, p2, p3, nn, [slot / 8, 0], [(slot + 1) / 8, 0], [(slot + 1) / 8, 1]);
        signsGeo.tri(p1, p3, p4, nn, [slot / 8, 0], [(slot + 1) / 8, 1], [slot / 8, 1]);
      }
    }
    try {
      flatPoly(roofs, ring, y1, true, roofCol[Math.floor(r() * roofCol.length)], () => [0, 0]);
      if (y0 > 3) flatPoly(roofs, ring, y0, false, roofCol[0], () => [0, 0]); // 懸空的部件（101 的竹節）要有底面
    } catch { /* 畸形多邊形就不加屋頂 */ }
  }
  const mats: Record<string, THREE.Material> = {
    f00: facade('res', 1), f01: facade('res', 5), f02: facade('res', 9),
    f10: facade('glass', 2, q.level === 'high'), f11: facade('glass', 7, q.level === 'high'), f30: facade('civic', 4),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true }), shop: storefrontMat(), sign: signMat(), shadow: bakedShadowMaterial(),
  };
  (mats.shop as THREE.MeshBasicMaterial).map!.wrapS = THREE.RepeatWrapping;
  for (const [key, g] of tiles) {
    if (!g.pos.length) continue;
    const mesh = new THREE.Mesh(g.build(), mats[key.split('|')[0]]);
    scene.add(mesh);
    const [tx, tz] = key.split('|')[1].split(',').map(Number), kind = key.split('|')[0], S = sizeOf(kind);
    cullAdd(mesh, (tx + 0.5) * S, (tz + 0.5) * S, S === TILE ? 'near' : 'far', S * 0.71);
  }
  tiles.clear();

  // ---- 頂樓水塔與鐵皮加蓋
  await stage('頂樓、路燈、路邊機車', 0.62);
  if (tanks.length) {
    const tank = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 0.75, 1.6, 12).translate(0, 1.6, 0), new THREE.MeshLambertMaterial({ color: '#c9ced3' }), tanks.length);
    const leg = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.8, 1.4).translate(0, 0.4, 0), new THREE.MeshLambertMaterial({ color: '#6a6f75' }), tanks.length);
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), qq = new THREE.Quaternion();
    tanks.forEach(([x, y, z, k], i) => {
      m4.compose(pos.set(x, y, z), qq, sc.setScalar(k));
      tank.setMatrixAt(i, m4);
      leg.setMatrixAt(i, m4);
    });
    tank.computeBoundingSphere();
    leg.computeBoundingSphere();
    scene.add(tank, leg);
  }
  if (sheds.length) {
    const tin = ['#5f8fb0', '#6aa07a', '#d8d8d0', '#b06a4a'].map((c) => new THREE.Color(c));
    // 單斜屋頂：一邊高 2.8 m、一邊 2.2 m
    const g = new THREE.BoxGeometry(1, 2.5, 1).translate(0, 1.25, 0);
    const shed = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial(), sheds.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    sheds.forEach(([x, y, z, w, d, ang, c], i) => {
      qq.setFromAxisAngle(up, ang);
      m4.compose(new THREE.Vector3(x, y, z), qq, new THREE.Vector3(d, 1, w));
      shed.setMatrixAt(i, m4);
      shed.setColorAt(i, tin[c]);
    });
    shed.computeBoundingSphere();
    scene.add(shed);
  }

  // ---- 路燈（燈頭會發光，開了光暈效果特別明顯）
  const L = data.lamps ?? [];
  if (L.length) {
    const n = L.length / 3;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 8.5, 6).translate(0, 4.25 - 0.6, 0), new THREE.MeshLambertMaterial({ color: '#5d6168' }), n);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.8).translate(0, 7.8, 0.9), new THREE.MeshLambertMaterial({ color: '#5d6168' }), n);
    const headMat = new THREE.MeshBasicMaterial({ color: '#ffe0a8', toneMapped: false });
    headMat.userData.lamp = true; // 白天熄燈、晚上更亮（weather.ts）
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.14, 0.75).translate(0, 7.72, 1.7), headMat, n);
    // 晚上路燈照在地上的光圈（平常隱藏；加法混色疊在路面上）
    const poolTex = canvasTex(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,214,150,0.55)');
      grd.addColorStop(0.5, 'rgba(255,190,120,0.18)');
      grd.addColorStop(1, 'rgba(255,170,100,0)');
      g.clearRect(0, 0, 64, 64);
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }, false);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2).translate(0, -0.2, 2.6), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 }), n);
    pool.userData.nightOnly = true;
    pool.visible = false;
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      qq.setFromAxisAngle(up, L[i * 3 + 2]);
      m4.compose(new THREE.Vector3(L[i * 3], 0, L[i * 3 + 1]), qq, one);
      pole.setMatrixAt(i, m4);
      arm.setMatrixAt(i, m4);
      head.setMatrixAt(i, m4);
      pool.setMatrixAt(i, m4);
      breakables.add(L[i * 3], L[i * 3 + 1], 0.2, 0.9, [pole, arm, head], i, m4); // 撞到會倒，車速剩 90%
    }
    for (const m of [pole, arm, head, pool]) { m.computeBoundingSphere(); scene.add(m); }
  }

  // ---- 路邊停的機車（簡化外型，數量多）
  const P = data.parked ?? [];
  if (q.parked && P.length) {
    // 四千多台：依區塊分組，看不到的區塊不畫
    const geo = scooterParkedGeo(), mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const colors = ['#e8e8e8', '#2a2a2a', '#c8102e', '#1f5fa8', '#e8c840', '#7fb8d8', '#f0a0b0'].map((c) => new THREE.Color(c));
    const groups = new Map<string, number[]>();
    for (let i = 0; i < P.length / 4; i++) {
      const key = `${Math.floor(P[i * 4] / TILE)},${Math.floor(P[i * 4 + 1] / TILE)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const ids of groups.values()) {
      const body = new THREE.InstancedMesh(geo, mat, ids.length);
      ids.forEach((i, n) => {
        qq.setFromAxisAngle(up, P[i * 4 + 2]);
        m4.compose(new THREE.Vector3(P[i * 4], -0.25, P[i * 4 + 1]), qq, one);
        body.setMatrixAt(n, m4);
        body.setColorAt(n, colors[P[i * 4 + 3] % colors.length]);
      });
      body.computeBoundingSphere();
      scene.add(body);
      cullAdd(body, (Math.floor(P[ids[0] * 4] / TILE) + 0.5) * TILE, (Math.floor(P[ids[0] * 4 + 1] / TILE) + 0.5) * TILE, 'near');
    }
  }

  scene.add(build101());

  await stage('種行道樹', 0.66);
  // ---- 行道樹：依區塊分成多組 InstancedMesh（看不到的區塊不畫）；離賽道遠的依畫質抽掉一些
  const tr = data.trees;
  const byTile = new Map<string, [number, number][]>();
  for (let k = 0; k < tr.length; k += 2) {
    const [, d] = nearest(tr[k], tr[k + 1]);
    if (d >= 90 && r() > q.treeKeep) continue;
    const key = `${Math.floor(tr[k] / TILE)},${Math.floor(tr[k + 1] / TILE)}`;
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key)!.push([tr[k], tr[k + 1]]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3, 5, 1, true).translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.9, q.level === 'high' ? 1 : 0).translate(0, 4.4, 0); // 高畫質：樹冠比較圓
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#5a4636' }), crownMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const leaf = ['#3e6b35', '#4a7a3a', '#355f30', '#5b8a45', '#44703a'].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3();
  // 樹影：沿太陽反方向拉長的柔邊橢圓（預先擺好，不用即時陰影）
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat = bakedShadowMaterial(blobTexture());
  const sl = Math.hypot(SHADOW_PER_M.x, SHADOW_PER_M.z), sdx = SHADOW_PER_M.x / sl, sdz = SHADOW_PER_M.z / sl, syaw = Math.atan2(sdx, sdz);
  const bq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), syaw), bm = new THREE.Matrix4();
  for (const pts of byTile.values()) {
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, pts.length), crown = new THREE.InstancedMesh(crownGeo, crownMat, pts.length);
    const blob = new THREE.InstancedMesh(blobGeo, blobMat, pts.length);
    pts.forEach(([x, z], n) => {
      const k = 0.75 + r() * 0.6;
      qt.setFromAxisAngle(up, r() * Math.PI * 2);
      s.set(k, k * (0.9 + r() * 0.3), k);
      const ty = terrainHeight(data.terrain, x, z); // 山上的樹長在坡面上
      m.compose(new THREE.Vector3(x, -0.3 + ty, z), qt, s);
      trunk.setMatrixAt(n, m);
      crown.setMatrixAt(n, m);
      // 影子長度 ≈ 樹高 × 影子比例（樹冠那團影子從樹幹往外一點開始）
      const len = 5.5 * k * sl * 0.8;
      bm.compose(new THREE.Vector3(x + sdx * len * 0.55, 0.035, z + sdz * len * 0.55), bq, new THREE.Vector3(3.6 * k, 1, len));
      if (ty > 0.5) bm.makeScale(0, 0, 0); // 坡上的樹不畫地面影子（平面影子貼不住坡）
      blob.setMatrixAt(n, bm);
      breakables.addParts(x, z, 0.35, 0.82, [
        { mesh: trunk, idx: n, base: m }, { mesh: crown, idx: n, base: m }, { mesh: blob, idx: n, base: bm, hide: true },
      ]); // 撞到會倒，車速剩 82%；倒下後地上的樹影跟著消失
      crown.setColorAt(n, leaf[Math.floor(r() * leaf.length)]);
    });
    trunk.computeBoundingSphere();
    crown.computeBoundingSphere();
    blob.computeBoundingSphere();
    scene.add(trunk, crown, blob);
    const cx = (Math.floor(pts[0][0] / TILE) + 0.5) * TILE, cz = (Math.floor(pts[0][1] / TILE) + 0.5) * TILE;
    cullAdd(trunk, cx, cz, 'near');
    cullAdd(blob, cx, cz, 'near');
    cullAdd(crown, cx, cz, 'mid');
  }

  const cull = (x: number, z: number, r: number) => {
    const R = { far: r, mid: r * 0.6, near: Math.min(r, 550), close: 300 };
    for (const c of cullables) {
      const inRange = (c.x - x) ** 2 + (c.z - z) ** 2 < (R[c.layer] + c.pad) ** 2;
      c.o.userData.inRange = inRange;
      c.o.visible = inRange && !c.o.userData.off; // off = 街道賽時藏起來的
    }
  };
  if (data.terrain && data.trails) scene.add(buildTrails(data.trails, data.terrain, data.rocks ?? []));
  const elev = buildElevated(scene, data); // 高架道路、人行空橋、文湖線、地下道入口
  await stage('外圍市區', 0.72);
  const filler = makeFiller(data);
  buildFiller(scene, filler);
  return { data, landmarks, breakables, raceHide, cull, filler, elev };
}

/** 台北 101：照真實比例的竹節造型（總高 508 m）。方形錐台 = 4 邊的圓柱轉 45°，邊對齊街道 */
function build101(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshLambertMaterial({ color: '#5f8f88', emissive: '#16332f' });
  glass.userData.nightEmissive = ['#16332f', '#2fbf8f']; // 晚上塔身亮翠綠（weather.ts）
  const dark = new THREE.MeshLambertMaterial({ color: '#3f5f5a' });
  const glow = new THREE.MeshBasicMaterial({ color: '#c8fff0', toneMapped: false });
  glow.userData.nightScale = 2.4; // 竹節之間的燈圈：晚上更亮
  const frustum = (top: number, bot: number, h: number) => new THREE.CylinderGeometry(top * Math.SQRT2, bot * Math.SQRT2, h, 4, 1).rotateY(Math.PI / 4);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    g.add(m);
  };
  // 基座：往上收的金字塔形（約 25 層）
  add(frustum(25, 31, 92), glass, 46);
  // 八節竹節：每節上寬下窄，節與節之間有一圈亮燈
  let y = 92;
  for (let k = 0; k < 8; k++) {
    add(frustum(29, 23, 35.5), glass, y + 17.75);
    add(frustum(29.6, 29.6, 1.2), glow, y + 35.5);
    y += 35.8;
  }
  // 跑馬燈：第 7 節外圍四面的 LED 字幕（晚上才亮，文字一直往左捲）
  {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 96;
    const x = c.getContext('2d')!;
    x.fillStyle = '#000';
    x.fillRect(0, 0, 2048, 96);
    x.font = '900 64px "Microsoft JhengHei","PingFang TC",Arial,sans-serif';
    x.textBaseline = 'middle';
    const text = '  TAIPEI 101  ★  台北街道賽 TAIPEI STREET GP  ★  今晚開跑  ★  ';
    const grd = x.createLinearGradient(0, 0, 2048, 0);
    grd.addColorStop(0, '#ffd84a'); grd.addColorStop(0.5, '#7fffd4'); grd.addColorStop(1, '#ff7ab8');
    x.fillStyle = grd;
    x.fillText(text, 0, 50);
    x.fillText(text, x.measureText(text).width, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(0.5, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    const yy = 92 + 35.8 * 6 + 18, half = 27.4;
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 2, 7), mat);
      const a = (k * Math.PI) / 2;
      m.position.set(Math.sin(a) * half, yy, Math.cos(a) * half);
      m.rotation.y = a;
      m.userData.nightOnly = true;
      m.userData.ticker = tex;
      m.visible = false;
      g.add(m);
    }
  }
  // 頂部（收窄兩段）＋ 塔尖
  add(frustum(15, 18, 30), glass, y + 15);
  add(frustum(10, 12, 26), dark, y + 30 + 13);
  y += 56;
  add(new THREE.CylinderGeometry(0.9, 2.8, 508 - y, 8), new THREE.MeshLambertMaterial({ color: '#c8d0d4' }), y + (508 - y) / 2);
  add(new THREE.SphereGeometry(1.8, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a4a' }), 508);
  g.position.set(TOWER_101.x, 0, TOWER_101.z);
  return g;
}

/** 凸包（Andrew 單調鏈）：預先算地面影子的形狀用 */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 山的網格：高度大於 0 的格子才畫；顏色依高度與坡度（低處深綠、陡坡露出岩石） */
function terrainMesh(t: { x0: number; z0: number; step: number; nx: number; nz: number; h: number[] }): THREE.Mesh {
  const { x0, z0, step, nx, nz, h } = t;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), idx: number[] = [];
  const lo = new THREE.Color('#2f5a2c'), hi = new THREE.Color('#4f7a3a'), rock = new THREE.Color('#7a7466'), c = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, y = h[k];
    pos.set([x0 + i * step, y - 0.6, z0 + j * step], k * 3);
    const gx = (h[j * nx + Math.min(nx - 1, i + 1)] - h[j * nx + Math.max(0, i - 1)]) / (2 * step);
    const gz = (h[Math.min(nz - 1, j + 1) * nx + i] - h[Math.max(0, j - 1) * nx + i]) / (2 * step);
    const slope = Math.hypot(gx, gz);
    c.copy(lo).lerp(hi, Math.min(1, y / 160)).lerp(rock, Math.max(0, Math.min(1, (slope - 0.7) * 1.5)));
    const n = (Math.sin(i * 1.7) * Math.cos(j * 2.3)) * 0.04; // 一點色差，不會整片同一個綠
    col.set([c.r + n, c.g + n, c.b + n], k * 3);
  }
  for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    if (Math.max(h[a], h[b], h[d], h[e]) <= 0.05) continue;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false }));
  m.receiveShadow = true;
  return m;
}
