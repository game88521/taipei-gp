import * as THREE from 'three';
import { canvasTex } from './world';
import { TOWER_101, type Track } from './track';

// 真實台北：public/data/city.json 由 tools/build-city.mjs 從 OpenStreetMap 產生
// 地圖資料 © OpenStreetMap contributors（ODbL）

import type { CityData } from './citydata';
import { buildRoads, buildCrossings, buildStreetSigns, buildLandmarks, type Landmark } from './decor';

const FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
const FLOOR = 3.3; // 一層樓高
const TILE_U = 8; // 外牆貼圖橫向每 8 m（兩個開間）重複
const TILE_V = FLOOR * 2; // 縱向每兩層重複

// 每棟樓的穩定亂數（同一份資料每次長得一樣）
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** 外牆貼圖：顏色圖 + 只有亮燈窗戶的發光圖（發光不受牆面染色影響） */
function facade(kind: 'res' | 'glass' | 'civic', seed: number) {
  const r = rng(seed);
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
        for (let col = 0; col < 2; col++) {
          const x = col * 128 + 22, y = row * 128 + 30, w = 84, h = 62;
          const on = r() < 0.4;
          g.fillStyle = on ? '#ffd88a' : '#2c3542';
          g.fillRect(x, y, w, h);
          if (on) lit.push([x, y, w, h]);
          if (r() < 0.6) { // 鐵窗
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
  return new THREE.MeshLambertMaterial({ map, emissiveMap: emissive, emissive: '#ffffff', emissiveIntensity: 0.9, vertexColors: true });
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
  return new THREE.MeshBasicMaterial({ map, toneMapped: false });
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
  return new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, toneMapped: false });
}

/** 累積三角形用的小工具 */
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
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
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

export async function loadCity(scene: THREE.Scene, t: Track): Promise<{ data: CityData; landmarks: Landmark[] }> {
  const data = (await (await fetch('/data/city.json')).json()) as CityData;

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

  // ---- 綠地
  const green = new Geo();
  const gcol = [new THREE.Color('#5d7f45'), new THREE.Color('#557a40'), new THREE.Color('#4f8048')];
  for (const g of data.greens) {
    const r = toRing(g.p);
    try { flatPoly(green, r, -0.45, true, gcol[g.k] ?? gcol[0], () => [0, 0]); } catch { /* 少數畸形多邊形跳過 */ }
  }
  scene.add(new THREE.Mesh(green.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));

  // ---- 道路（有標線）、斑馬線、路名牌、地標招牌
  buildRoads(scene, data);
  buildCrossings(scene, data);
  buildStreetSigns(scene, data);
  const landmarks = buildLandmarks(scene, data);

  // ---- 建築
  const geos = [new Geo(), new Geo(), new Geo(), new Geo()]; // 依樣式：住宅、玻璃、商店（同住宅貼圖）、公家
  const roofs = new Geo(), shopsGeo = new Geo(), signsGeo = new Geo();
  const resTint = ['#e8e1d5', '#d9d0c3', '#cfc8bd', '#e3d6c8', '#c9cdd1', '#d8cbbd', '#bfb7aa', '#e6d9cf'].map((c) => new THREE.Color(c));
  const roofCol = [new THREE.Color('#8b8883'), new THREE.Color('#7d8288'), new THREE.Color('#96918a')];
  const white = new THREE.Color('#ffffff'), civic = new THREE.Color('#ddd7cc');
  const r = rng(101);
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
    const geo = geos[b.s === 2 ? 0 : b.s] ?? geos[0];
    let u = 0;
    const streetLevel = y0 < 0 && (b.s === 0 || b.s === 2) && y1 < 70;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      const n = [-dz / l, 0, dx / l];
      const u0 = u / TILE_U, u1 = (u + l) / TILE_U;
      geo.tri([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], n, [u0, y0 / TILE_V], [u1, y0 / TILE_V], [u1, y1 / TILE_V], tint);
      geo.tri([a[0], y0, a[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], n, [u0, y0 / TILE_V], [u1, y1 / TILE_V], [u0, y1 / TILE_V], tint);
      u += l;

      // 面向賽道的騎樓店面與直式招牌
      if (!streetLevel || l < 5) continue;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const [ti, d] = nearest(mx, mz);
      if (ti < 0 || d > 40) continue;
      const toT = [t.px[ti] - mx, t.pz[ti] - mz], tl = Math.hypot(toT[0], toT[1]) || 1;
      if ((n[0] * toT[0] + n[2] * toT[1]) / tl < 0.5) continue;
      const o = 0.06, sh = Math.min(4.4, y1 - 0.5);
      const A = [a[0] + n[0] * o, a[1] + n[2] * o], C = [c[0] + n[0] * o, c[1] + n[2] * o];
      const su0 = (u - l) / 7, su1 = u / 7; // 每 7 m 一間店
      shopsGeo.tri([A[0], -0.25, A[1]], [C[0], -0.25, C[1]], [C[0], sh, C[1]], n, [su0 / 6, 0], [su1 / 6, 0], [su1 / 6, 1]);
      shopsGeo.tri([A[0], -0.25, A[1]], [C[0], sh, C[1]], [A[0], sh, A[1]], n, [su0 / 6, 0], [su1 / 6, 1], [su0 / 6, 1]);
      if (y1 > 10 && l > 7 && r() < 0.55) {
        const f = 0.2 + r() * 0.6, sx = a[0] + dx * f + n[0] * 1.1, sz = a[1] + dz * f + n[2] * 1.1;
        const hgt = Math.min(7, y1 - 5), yc = 5 + hgt / 2 + r() * Math.max(0, y1 - 12 - hgt) * 0.3;
        const slot = Math.floor(r() * 8), fx = -t.tx[ti], fz = -t.tz[ti]; // 面對迎面而來的車
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
  const mats = [facade('res', 1), facade('glass', 2), facade('res', 3), facade('civic', 4)];
  geos.forEach((g, k) => { if (g.pos.length) scene.add(new THREE.Mesh(g.build(), mats[k])); });
  scene.add(new THREE.Mesh(roofs.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  if (shopsGeo.pos.length) {
    const m = storefrontMat();
    m.map!.wrapS = THREE.RepeatWrapping;
    scene.add(new THREE.Mesh(shopsGeo.build(), m));
  }
  if (signsGeo.pos.length) scene.add(new THREE.Mesh(signsGeo.build(), signMat()));

  scene.add(build101());

  // ---- 行道樹（InstancedMesh：上萬棵只要兩次繪製）
  const tr = data.trees;
  const pts: [number, number][] = [];
  for (let k = 0; k < tr.length; k += 2) {
    const [, d] = nearest(tr[k], tr[k + 1]);
    if (d < 90 || r() < 0.35) pts.push([tr[k], tr[k + 1]]); // 遠處的樹抽掉一些，省效能
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 3, 5, 1, true).translate(0, 1.5, 0), new THREE.MeshLambertMaterial({ color: '#5a4636' }), pts.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0).translate(0, 4.4, 0), new THREE.MeshLambertMaterial({ flatShading: true }), pts.length);
  const leaf = ['#3e6b35', '#4a7a3a', '#355f30', '#5b8a45', '#44703a'].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3();
  pts.forEach(([x, z], n) => {
    const k = 0.75 + r() * 0.6;
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    s.set(k, k * (0.9 + r() * 0.3), k);
    m.compose(new THREE.Vector3(x, -0.3, z), q, s);
    trunk.setMatrixAt(n, m);
    crown.setMatrixAt(n, m);
    crown.setColorAt(n, leaf[Math.floor(r() * leaf.length)]);
  });
  scene.add(trunk, crown);

  return { data, landmarks };
}

/** 台北 101：照真實比例的竹節造型（總高 508 m）。方形錐台 = 4 邊的圓柱轉 45°，邊對齊街道 */
function build101(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshLambertMaterial({ color: '#5f8f88', emissive: '#16332f' });
  const dark = new THREE.MeshLambertMaterial({ color: '#3f5f5a' });
  const glow = new THREE.MeshBasicMaterial({ color: '#c8fff0', toneMapped: false });
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
  // 頂部（收窄兩段）＋ 塔尖
  add(frustum(15, 18, 30), glass, y + 15);
  add(frustum(10, 12, 26), dark, y + 30 + 13);
  y += 56;
  add(new THREE.CylinderGeometry(0.9, 2.8, 508 - y, 8), new THREE.MeshLambertMaterial({ color: '#c8d0d4' }), y + (508 - y) / 2);
  add(new THREE.SphereGeometry(1.8, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a4a' }), 508);
  g.position.set(TOWER_101.x, 0, TOWER_101.z);
  return g;
}
