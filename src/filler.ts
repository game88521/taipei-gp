import * as THREE from 'three';
import { terrainHeight, type CityData } from './citydata';

// 地圖外圍的「遠景城市」：真實資料（OSM）範圍外再補一圈約 900 m 的街廓，
// 開到地圖邊邊往外看，不會是一片空地。全部是方塊＋著色器畫的窗戶：
// 4 個方向各一組 InstancedMesh、道路一個網格，總共 5 次繪製。

export interface FillerBox { x: number; z: number; w: number; d: number; h: number; c: number }
export interface Filler { boxes: FillerBox[]; streets: number[] /* x0,z0,x1,z1（軸對齊的長方形） */; bands: number[][] }

const BAND = 900; // 往外補多寬
const STREET = 14; // 街道寬

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 依真實建築的範圍算出外圍街廓（固定亂數種子：每次載入都一樣，碰撞也對得上） */
export function makeFiller(d: CityData): Filler {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of d.buildings) for (let k = 0; k < b.p.length; k += 2) {
    x0 = Math.min(x0, b.p[k]); x1 = Math.max(x1, b.p[k]);
    z0 = Math.min(z0, b.p[k + 1]); z1 = Math.max(z1, b.p[k + 1]);
  }
  x0 -= 25; z0 -= 25; x1 += 25; z1 += 25;
  const r = rng(2026);
  // 北、西、東是連綿的市區（松山、大安、南港）；南邊是山腳，只補窄窄一條、房子也矮
  const south = 420;
  const bands = [
    [x0 - BAND, z0 - BAND, x1 + BAND, z0], // 北
    [x0 - BAND, z1, x1 + BAND, z1 + south], // 南
    [x0 - BAND, z0, x0, z1], // 西
    [x1, z0, x1 + BAND, z1], // 東
  ];
  const boxes: FillerBox[] = [], streets: number[] = [];
  bands.forEach(([bx0, bz0, bx1, bz1], bi) => {
    // 沿 x、z 切出街廓的邊界（80~130 m 一格）
    const cuts = (a: number, b: number) => {
      const out = [a];
      for (let v = a + 80 + r() * 50; v < b - 60; v += 80 + r() * 50) out.push(v);
      out.push(b);
      return out;
    };
    const xs = cuts(bx0, bx1), zs = cuts(bz0, bz1);
    for (const x of xs.slice(1, -1)) streets.push(x - STREET / 2, bz0, x + STREET / 2, bz1);
    for (const z of zs.slice(1, -1)) streets.push(bx0, z - STREET / 2, bx1, z + STREET / 2);
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const ax = xs[i] + STREET / 2, bx = xs[i + 1] - STREET / 2, az = zs[j] + STREET / 2, bz = zs[j + 1] - STREET / 2;
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      // 離真實地圖越遠越稀疏；山坡上不蓋
      const far = Math.max(0, x0 - cx, cx - x1, z0 - cz, cz - z1) / BAND;
      if (r() < 0.12 + far * 0.25) continue;
      if (terrainHeight(d.terrain, cx, cz) > 0.3) continue;
      // 一個街廓切成 1~3 × 1~3 塊地，各蓋一棟
      const ni = 1 + Math.floor(r() * 3), nj = 1 + Math.floor(r() * 3);
      for (let a = 0; a < ni; a++) for (let b = 0; b < nj; b++) {
        if (r() < 0.12) continue; // 空地、停車場
        const lx0 = ax + ((bx - ax) * a) / ni, lx1 = ax + ((bx - ax) * (a + 1)) / ni;
        const lz0 = az + ((bz - az) * b) / nj, lz1 = az + ((bz - az) * (b + 1)) / nj;
        const sb = 2 + r() * 4; // 退縮
        const w = lx1 - lx0 - sb * 2, dd = lz1 - lz0 - sb * 2;
        if (w < 8 || dd < 8) continue;
        // 高度：大多 4~12 層公寓，少數 20~35 層大樓；南邊山腳都是矮房子
        let h = 10 + r() * r() * 32;
        if (bi !== 1 && r() < 0.07) h = 60 + r() * 55;
        if (bi === 1) h = Math.min(h, 22);
        boxes.push({ x: (lx0 + lx1) / 2, z: (lz0 + lz1) / 2, w, d: dd, h: Math.round(h / 3.3) * 3.3 + 1, c: Math.floor(r() * 6) });
      }
    }
  });
  return { boxes, streets, bands };
}

const WALLS = ['#cfc6b8', '#b9b3aa', '#d8d2c6', '#a9a49c', '#c4b49c', '#9fa7ad'].map((c) => new THREE.Color(c));

/** 窗戶用世界座標算（不靠 uv），方塊怎麼縮放窗戶大小都一樣：每層 3.3 m、每開間 3.6 m，部分亮燈 */
function fillerMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;\nvarying vec3 vFN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vec4 fw = vec4(transformed, 1.0);
  vec3 fn = objectNormal;
  #ifdef USE_INSTANCING
    fw = instanceMatrix * fw;
    fn = mat3(instanceMatrix) * fn;
  #endif
  vFW = (modelMatrix * fw).xyz;
  vFN = normalize(mat3(modelMatrix) * fn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;\nvarying vec3 vFN;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (vFN.y < 0.5) {
    float u = abs(vFN.x) > 0.5 ? vFW.z : vFW.x;
    vec2 cell = vec2(u / 3.6, (vFW.y + 0.6) / 3.3);
    vec2 f = fract(cell);
    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.32, f.y) * step(f.y, 0.86) * step(1.0, cell.y);
    float h = fract(sin(dot(floor(cell) + floor(vFW.xz / 41.0) * 7.0, vec2(12.9898, 78.233))) * 43758.5453);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.17, 0.21), win * 0.85);
    totalEmissiveRadiance += win * step(0.64, h) * vec3(1.0, 0.78, 0.48) * 0.75;
  } else {
    diffuseColor.rgb *= 0.78; // 屋頂暗一點
  }`);
  };
  return m;
}

export function buildFiller(scene: THREE.Scene, f: Filler) {
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = fillerMaterial();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  // 依所在的方向分 4 組，鏡頭沒朝那邊時整組被視錐剔除
  f.bands.forEach(([bx0, bz0, bx1, bz1]) => {
    const list = f.boxes.filter((b) => b.x >= bx0 && b.x <= bx1 && b.z >= bz0 && b.z <= bz1);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((b, n) => {
      im.setMatrixAt(n, m4.compose(p.set(b.x, -0.6, b.z), q, s.set(b.w, b.h, b.d)));
      im.setColorAt(n, WALLS[b.c % WALLS.length]);
    });
    im.computeBoundingSphere();
    scene.add(im);
  });
  // 街道：比真實道路低一點點，萬一重疊由真實道路蓋過去
  const pos: number[] = [], S = f.streets, Y = -0.27;
  for (let k = 0; k < S.length; k += 4) {
    const [a, b, c, d] = [S[k], S[k + 1], S[k + 2], S[k + 3]];
    pos.push(a, Y, b, a, Y, d, c, Y, d, a, Y, b, c, Y, d, c, Y, b);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rg.computeVertexNormals();
  scene.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: '#45474c', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
}
