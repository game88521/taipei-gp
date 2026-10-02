import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarModel } from './carModel';

// 精緻的現代 F1 賽車（地面效應世代）：車頭朝 +z、長約 5.6 m、寬 2.0 m，原點在車底中心
// 機身用「放樣」：沿車長每一站給半寬、半高、中心高度，截面是圓角方形（超橢圓），連成平滑曲面

export interface F1Livery {
  main: string; // 主色
  accent: string; // 第二色（前後翼端板、側箱條紋）
  accent2: string; // 第三色（前翼上層、DRS 襟翼）
  helmet: string;
  number: number;
  tyre?: string; // 胎色圈：紅＝軟胎、黃＝中性、白＝硬胎
}

interface Station { z: number; w: number; h: number; y: number; x?: number }

/** 放樣：每一站一圈超橢圓截面，相鄰兩圈連成四邊形，頭尾封口 */
function loft(st: Station[], seg = 20, n = 2.6): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const s of st) {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
      // 超橢圓：|x/w|^n + |y/h|^n = 1
      const x = Math.sign(c) * Math.abs(c) ** (2 / n) * s.w, y = Math.sign(si) * Math.abs(si) ** (2 / n) * s.h;
      pos.push((s.x ?? 0) + x, s.y + y, s.z);
    }
  }
  for (let i = 0; i + 1 < st.length; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg), c = (i + 1) * seg + k, d = (i + 1) * seg + ((k + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  // 封口：頭尾各加一個中心點
  for (const [i, flip] of [[0, false], [st.length - 1, true]] as const) {
    const s = st[i], ci = pos.length / 3;
    pos.push(s.x ?? 0, s.y, s.z);
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 側面輪廓（z, y）沿 x 擠出成薄片（尾翼端板、鯊魚鰭） */
function plate(pts: [number, number][], thick: number, x: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(x + thick / 2, 0, 0);
  return g;
}

/** 俯視輪廓（x, z）擠出成水平薄板（底板） */
function floorPlate(pts: [number, number][], thick: number, y: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** 兩點之間的細桿（懸吊連桿、後照鏡支架） */
function rod(a: [number, number, number], b: [number, number, number], r: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
/** 有傾角的翼片 */
function wing(span: number, chord: number, thick: number, x: number, y: number, z: number, pitch: number) {
  return new THREE.BoxGeometry(span, thick, chord).rotateX(pitch).translate(x, y, z);
}
const strip = (g: THREE.BufferGeometry) => {
  const o = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal') o.deleteAttribute(k);
  return o;
};

function numberTexture(n: number, bg: string, fg: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fg;
  g.font = '900 78px "Bahnschrift","DIN Condensed","Arial Narrow",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeF1(l: F1Livery, ghost = false): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const parts: Record<string, THREE.BufferGeometry[]> = { main: [], accent: [], accent2: [], carbon: [], dark: [], helmet: [], visor: [] };
  const P = (k: keyof typeof parts, g: THREE.BufferGeometry) => parts[k].push(g);

  // ---- 機身（車鼻 → 駕駛艙 → 引擎蓋 → 車尾）
  P('main', loft([
    { z: 2.78, w: 0.06, h: 0.045, y: 0.2 },
    { z: 2.45, w: 0.11, h: 0.075, y: 0.24 },
    { z: 1.9, w: 0.17, h: 0.12, y: 0.31 },
    { z: 1.3, w: 0.24, h: 0.18, y: 0.4 },
    { z: 0.75, w: 0.33, h: 0.24, y: 0.48 },
    { z: 0.2, w: 0.39, h: 0.27, y: 0.52 },
    { z: -0.4, w: 0.41, h: 0.29, y: 0.54 },
    { z: -1.0, w: 0.34, h: 0.29, y: 0.55 },
    { z: -1.6, w: 0.24, h: 0.23, y: 0.52 },
    { z: -2.1, w: 0.13, h: 0.15, y: 0.45 },
    { z: -2.38, w: 0.07, h: 0.09, y: 0.42 },
  ]));
  // 駕駛頭頂上方的進氣口＋往後收的背脊
  P('main', loft([
    { z: -0.18, w: 0.1, h: 0.13, y: 0.93 },
    { z: -0.45, w: 0.14, h: 0.19, y: 0.88 },
    { z: -0.95, w: 0.13, h: 0.18, y: 0.8 },
    { z: -1.6, w: 0.07, h: 0.11, y: 0.67 },
    { z: -2.05, w: 0.04, h: 0.05, y: 0.56 },
  ], 14));
  P('dark', loft([{ z: -0.15, w: 0.07, h: 0.09, y: 0.94 }, { z: -0.2, w: 0.07, h: 0.09, y: 0.94 }], 12));
  // 鯊魚鰭
  P('main', plate([[-0.8, 1.0], [-1.95, 0.97], [-2.08, 0.66], [-1.25, 0.66]], 0.018, 0));
  // 側箱：下切造型，前緣是進氣口
  for (const s of [-1, 1]) {
    P('main', loft([
      { z: 0.62, w: 0.1, h: 0.17, y: 0.46, x: s * 0.6 },
      { z: 0.42, w: 0.23, h: 0.24, y: 0.45, x: s * 0.63 },
      { z: -0.25, w: 0.25, h: 0.24, y: 0.44, x: s * 0.6 },
      { z: -0.95, w: 0.2, h: 0.18, y: 0.38, x: s * 0.5 },
      { z: -1.6, w: 0.1, h: 0.1, y: 0.31, x: s * 0.33 },
    ], 16));
    P('dark', loft([{ z: 0.63, w: 0.08, h: 0.14, y: 0.47, x: s * 0.6 }, { z: 0.6, w: 0.08, h: 0.14, y: 0.47, x: s * 0.6 }], 12));
    // 側箱上的第二色條紋
    P('accent', loft([
      { z: 0.4, w: 0.235, h: 0.03, y: 0.62, x: s * 0.63 },
      { z: -0.3, w: 0.255, h: 0.03, y: 0.62, x: s * 0.6 },
      { z: -0.95, w: 0.205, h: 0.025, y: 0.52, x: s * 0.5 },
    ], 12));
  }
  // 駕駛艙開口（黑色）＋ 車手安全帽與護目鏡
  P('dark', loft([{ z: 0.25, w: 0.2, h: 0.04, y: 0.79 }, { z: -0.05, w: 0.24, h: 0.05, y: 0.8 }, { z: -0.32, w: 0.2, h: 0.04, y: 0.8 }], 16, 2));
  P('helmet', new THREE.SphereGeometry(0.15, 20, 14).scale(0.95, 1, 1.08).translate(0, 0.9, -0.12));
  P('visor', new THREE.SphereGeometry(0.153, 20, 8, Math.PI / 2 - 0.95, 1.9, 1.18, 0.42).scale(0.95, 1, 1.08).translate(0, 0.9, -0.12));
  // Halo（頭部保護環）＋ 中央支柱
  const haloCurve = new THREE.CatmullRomCurve3([
    [-0.33, 0.79, -0.32], [-0.31, 0.97, -0.08], [-0.2, 1.03, 0.2], [0, 1.04, 0.3], [0.2, 1.03, 0.2], [0.31, 0.97, -0.08], [0.33, 0.79, -0.32],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  P('carbon', new THREE.TubeGeometry(haloCurve, 40, 0.032, 8, false));
  P('carbon', rod([0, 1.04, 0.3], [0, 0.74, 0.48], 0.03));
  // 後照鏡
  for (const s of [-1, 1]) {
    P('main', new THREE.BoxGeometry(0.14, 0.06, 0.035).translate(s * 0.47, 0.86, 0.28));
    P('carbon', rod([s * 0.34, 0.72, 0.3], [s * 0.45, 0.85, 0.28], 0.012));
  }
  P('accent2', new THREE.BoxGeometry(0.11, 0.035, 0.06).translate(0, 1.13, -0.22)); // T 字攝影機
  // ---- 底板（地面效應）與擴散器
  P('carbon', floorPlate([[-0.32, 1.55], [-0.72, 0.95], [-0.95, 0.35], [-0.97, -1.55], [-0.62, -2.05], [-0.45, -2.3], [0.45, -2.3], [0.62, -2.05], [0.97, -1.55], [0.95, 0.35], [0.72, 0.95], [0.32, 1.55]], 0.025, 0.06));
  P('carbon', new THREE.BoxGeometry(0.9, 0.025, 0.42).rotateX(-0.35).translate(0, 0.14, -2.42));
  for (const s of [-1, 1]) P('carbon', new THREE.BoxGeometry(0.02, 0.18, 0.42).translate(s * 0.45, 0.14, -2.42));
  // ---- 前翼：三層翼片＋端板＋鼻樑支柱
  P('carbon', wing(2.0, 0.34, 0.03, 0, 0.1, 2.62, -0.06));
  P('main', wing(1.88, 0.2, 0.024, 0, 0.17, 2.47, -0.28));
  P('accent2', wing(1.66, 0.15, 0.02, 0, 0.24, 2.36, -0.48));
  for (const s of [-1, 1]) {
    P('accent', plate([[2.86, 0.05], [2.3, 0.05], [2.25, 0.3], [2.62, 0.3]], 0.02, s * 1.0));
    P('carbon', rod([s * 0.08, 0.2, 2.35], [s * 0.12, 0.11, 2.45], 0.015));
  }
  // ---- 尾翼：主翼＋DRS 襟翼＋端板＋下方小翼＋支柱
  P('carbon', wing(1.02, 0.32, 0.035, 0, 0.93, -2.42, 0.18));
  P('accent2', wing(1.02, 0.2, 0.03, 0, 1.04, -2.28, 0.5));
  P('carbon', wing(0.82, 0.14, 0.025, 0, 0.56, -2.47, 0.12));
  P('carbon', new THREE.BoxGeometry(0.05, 0.42, 0.14).translate(0, 0.74, -2.32));
  for (const s of [-1, 1]) P('accent', plate([[-2.62, 0.48], [-2.12, 0.5], [-2.12, 1.12], [-2.62, 1.14]], 0.022, s * 0.52));
  // ---- 懸吊連桿（前後、上下兩組 A 臂）
  for (const s of [-1, 1]) {
    for (const [zc, hubX] of [[1.78, 0.7], [-1.72, 0.66]] as const) {
      for (const [yb, yh] of [[0.5, 0.48], [0.34, 0.24]] as const) {
        P('carbon', rod([s * 0.2, yb, zc + 0.25], [s * hubX, yh, zc], 0.016));
        P('carbon', rod([s * 0.2, yb, zc - 0.22], [s * hubX, yh, zc], 0.016));
      }
    }
  }
  // 鼻頭的車號
  if (!ghost) {
    const num = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ map: numberTexture(l.number, l.accent, l.accent === '#ffffff' ? '#111' : '#fff') }));
    num.rotation.x = -Math.PI / 2 + 0.2;
    num.position.set(0, 0.45, 1.42);
    body.add(num);
  }

  // ---- 依材質合併成少數幾個網格（每台車十幾次繪製，不是上百次）
  const std = (color: string, metal: number, rough: number) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.25, depthWrite: false });
  const mats: Record<string, THREE.Material> = ghost
    ? Object.fromEntries(Object.keys(parts).map((k) => [k, ghostMat]))
    : {
        main: std(l.main, 0.45, 0.28), accent: std(l.accent, 0.4, 0.3), accent2: std(l.accent2, 0.4, 0.3),
        carbon: std('#18191c', 0.3, 0.55), dark: std('#050506', 0, 0.9), helmet: std(l.helmet, 0.3, 0.25), visor: std('#0d1014', 0.8, 0.1),
      };
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    body.add(new THREE.Mesh(mergeGeometries(list.map(strip)), mats[k]));
  }

  // ---- 車輪：胎面＋胎色圈＋輪框（獨立網格：前輪要轉向、四輪要滾動）
  const steer: THREE.Group[] = [], spin: THREE.Mesh[] = [];
  const tyreMat = ghost ? ghostMat : std('#141414', 0, 0.85), rimMat = ghost ? ghostMat : std('#22252a', 0.7, 0.35);
  const bandMat = ghost ? ghostMat : new THREE.MeshStandardMaterial({ color: l.tyre ?? '#e10600', roughness: 0.6 });
  for (const s of [-1, 1]) for (const [z, r, w] of [[1.78, 0.36, 0.3], [-1.72, 0.37, 0.4]] as const) {
    const g = new THREE.Group();
    g.position.set(s * (z > 0 ? 0.86 : 0.82), r, z);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28).rotateZ(Math.PI / 2), tyreMat);
    const out = s * (w / 2 + 0.002);
    const band = new THREE.Mesh(new THREE.RingGeometry(r * 0.7, r * 0.8, 28).rotateY(s * Math.PI / 2).translate(out, 0, 0), bandMat);
    const rim = new THREE.Mesh(new THREE.CircleGeometry(r * 0.62, 24).rotateY(s * Math.PI / 2).translate(out * 0.99, 0, 0), rimMat);
    for (let k = 0; k < 6; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, r * 1.15, 0.05).translate(out * 1.01, 0, 0), bandMat);
      sp.rotation.x = (k / 6) * Math.PI;
      rim.add(sp);
    }
    tyre.add(band, rim);
    g.add(tyre);
    root.add(g);
    spin.push(tyre);
    if (z > 0) steer.push(g);
  }
  return { root, body, steer, spin };
}

// 虛構車隊：配色致敬經典車隊，但不使用任何真實車隊名稱或標誌（那些是註冊商標）
export const TEAMS: { team: string; livery: F1Livery }[] = [
  { team: '躍馬紅 Rosso Corsa', livery: { main: '#d40000', accent: '#ffffff', accent2: '#111111', helmet: '#ffd400', number: 16, tyre: '#e10600' } },
  { team: '銀箭 Silver Arrows', livery: { main: '#b8bec4', accent: '#00d2be', accent2: '#151515', helmet: '#e8e8e8', number: 44, tyre: '#e10600' } },
  { team: '木瓜橘 Papaya Racing', livery: { main: '#ff8000', accent: '#141414', accent2: '#47c7fc', helmet: '#ff8000', number: 4, tyre: '#ffd400' } },
  { team: '藍牛 Blue Bull', livery: { main: '#1b2650', accent: '#ffcc00', accent2: '#e10600', helmet: '#1b2650', number: 1, tyre: '#e10600' } },
  { team: '翡翠綠 Emerald', livery: { main: '#00594f', accent: '#cedc00', accent2: '#0a0a0a', helmet: '#cedc00', number: 14, tyre: '#ffd400' } },
  { team: '天藍粉 Azure Pink', livery: { main: '#0a78d4', accent: '#ff87bc', accent2: '#0a0a0a', helmet: '#ff87bc', number: 10, tyre: '#ffffff' } },
  { team: '海軍藍 Navy Grid', livery: { main: '#0b2a5a', accent: '#00a3e0', accent2: '#ffffff', helmet: '#00a3e0', number: 23, tyre: '#ffffff' } },
  { team: '螢光綠 Neon Speed', livery: { main: '#151515', accent: '#52e252', accent2: '#52e252', helmet: '#52e252', number: 27, tyre: '#ffd400' } },
];
