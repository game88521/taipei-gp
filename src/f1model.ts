import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carBlob, type CarModel } from './carModel';

// 精緻的現代 F1 賽車（地面效應世代）：車頭朝 +z、長約 5.6 m、寬 2.0 m，原點在車底中心
// 機身用「放樣」：沿車長每一站給半寬、半高、中心高度，截面是圓角方形（超橢圓），連成平滑曲面
// 依材質合併成十幾個網格：每台車約 15 次繪製（輪子一顆一次，用頂點顏色分胎面、胎色圈、輪框罩）

export interface F1Livery {
  main: string; // 主色
  accent: string; // 第二色（前後翼端板、側箱條紋）
  accent2: string; // 第三色（前翼上層、DRS 襟翼）
  helmet: string;
  number: number;
  tyre?: string; // 胎色圈：紅＝軟胎、黃＝中性、白＝硬胎
}

interface Station { z: number; w: number; h: number; y: number; x?: number }

/**
 * 放樣：每一站一圈超橢圓截面，相鄰兩圈連成四邊形，頭尾封口。
 * 貼圖座標：u 繞一圈（0 = 底部、0.25 = 右側 +x、0.5 = 頂部、0.75 = 左側），v 沿車長從 v0（車尾）到 v1（車頭）；
 * 接縫放在底部看不到的地方
 */
function loft(st: Station[], seg = 20, n = 2.6, v0 = 0, v1 = 1): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const zs = st.map((s) => s.z), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const R = seg + 1;
  for (const s of st) {
    for (let k = 0; k <= seg; k++) {
      const a = -Math.PI / 2 + (k / seg) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
      // 超橢圓：|x/w|^n + |y/h|^n = 1
      const x = Math.sign(c) * Math.abs(c) ** (2 / n) * s.w, y = Math.sign(si) * Math.abs(si) ** (2 / n) * s.h;
      pos.push((s.x ?? 0) + x, s.y + y, s.z);
      uv.push(k / seg, v0 + ((s.z - zmin) / (zmax - zmin || 1)) * (v1 - v0));
    }
  }
  for (let i = 0; i + 1 < st.length; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * R + k, b = i * R + k + 1, c = (i + 1) * R + k, d = (i + 1) * R + k + 1;
      // 車頭在前（z 由大到小排）：照這個順序法線朝外
      if (st[i].z > st[i + 1].z) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  for (const [i, flip] of [[0, false], [st.length - 1, true]] as const) {
    const s = st[i], ci = pos.length / 3;
    pos.push(s.x ?? 0, s.y, s.z);
    uv.push(0.5, i === 0 ? v1 : v0);
    for (let k = 0; k < seg; k++) {
      const a = i * R + k, b = i * R + k + 1;
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 側面輪廓（z, y）沿 x 擠出成薄片（尾翼端板、鯊魚鰭） */
function plate(pts: [number, number][], thick: number, x: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 6 });
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
function rod(a: [number, number, number], b: [number, number, number], r: number, seg = 6): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
/** 有傾角的平直翼片 */
function wing(span: number, chord: number, thick: number, x: number, y: number, z: number, pitch: number) {
  return new THREE.BoxGeometry(span, thick, chord).rotateX(pitch).translate(x, y, z);
}
/**
 * 弧形翼片（現代前翼）：沿翼展切成很多段，外側往上翹（lift）、往後掠（sweep），中間平的；
 * 翼面是薄的方塊截面，前緣厚、後緣薄的感覺用傾角表現
 */
function curvedWing(span: number, chord: number, thick: number, y: number, z: number, pitch: number, lift: number, sweep: number, inner = 0) {
  const g = new THREE.BoxGeometry(span, thick, chord, 12, 1, 1).rotateX(pitch);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = Math.abs(p.getX(i)) / (span / 2);
    const k = Math.max(0, (t - inner) / (1 - inner));
    const s = k * k * (3 - 2 * k); // smoothstep：中間平、往外越翹越多
    p.setY(i, p.getY(i) + lift * s);
    p.setZ(i, p.getZ(i) - sweep * s);
  }
  g.computeVertexNormals();
  return g.translate(0, y, z);
}
/** 只留位置、法線、貼圖座標（沒有貼圖座標的補 0），才能合併 */
const strip = (g: THREE.BufferGeometry) => {
  const o = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') o.deleteAttribute(k);
  if (!o.attributes.uv) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
  if (!o.attributes.normal) o.computeVertexNormals();
  return o;
};
/** 幾何加上單一頂點顏色（輪子：胎面、胎色圈、輪框罩合成一個網格） */
const tint = (g: THREE.BufferGeometry, color: string) => {
  const o = strip(g), c = new THREE.Color(color), n = o.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  o.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return o;
};

const canvas = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
// 碳纖維編織紋（所有車共用一張）
let carbonTex: THREE.Texture | null = null;
const carbon = () => (carbonTex ??= (() => {
  const t = canvas(64, 64, (g) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const grd = (x + y) % 2 ? g.createLinearGradient(x * 8, 0, x * 8 + 8, 0) : g.createLinearGradient(0, y * 8, 0, y * 8 + 8);
      grd.addColorStop(0, '#1a1b1f'); grd.addColorStop(0.5, '#34363c'); grd.addColorStop(1, '#1a1b1f');
      g.fillStyle = grd; g.fillRect(x * 8, y * 8, 8, 8);
    }
  }, true);
  t.repeat.set(3, 3);
  return t;
})());
// 車身塗裝條紋（同配色的車共用）：背脊條紋、側邊斜紋、鼻尖色塊；側箱下緣細線。透明底，疊在主色上
const decalCache = new Map<string, THREE.Texture>();
function decalTexture(l: F1Livery) {
  const key = `${l.accent}|${l.accent2}`;
  let t = decalCache.get(key);
  if (t) return t;
  t = canvas(256, 256, (g) => {
    // 機身佔 v 0.4~1（畫布 y 0~154，y 0 = 車頭）；側箱佔 v 0~0.4（y 154~256，154 = 側箱前緣）
    // u：x 64 = 右側、128 = 頂部、192 = 左側（左右對稱 x' = 256 − x）
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = l.accent;
    g.beginPath(); g.moveTo(124, 6); g.lineTo(132, 6); g.lineTo(136, 150); g.lineTo(120, 150); g.closePath(); g.fill(); // 背脊條紋（往後變寬）
    g.fillStyle = l.accent2;
    g.fillRect(0, 0, 256, 7); // 鼻尖
    for (const m of [1, -1]) {
      const X = (x: number) => (m > 0 ? x : 256 - x);
      g.beginPath(); g.moveTo(X(100), 26); g.lineTo(X(108), 26); g.lineTo(X(80), 120); g.lineTo(X(72), 120); g.closePath(); g.fill(); // 側邊斜紋
      g.fillStyle = l.accent; g.fillRect(Math.min(X(40), X(46)), 170, 6, 80); g.fillStyle = l.accent2; // 側箱下緣細線
    }
  });
  decalCache.set(key, t);
  return t;
}
/** 車號與隊名的小貼圖：左半是車號圓牌、右半是隊名（鼻頭、引擎蓋兩側、側箱兩側共用一張） */
function badgeTexture(l: F1Livery, team: string) {
  return canvas(256, 128, (g) => {
    g.fillStyle = l.accent; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = l.accent === '#ffffff' || l.accent === '#ffd400' || l.accent === '#cedc00' || l.accent === '#52e252' ? '#111' : '#fff';
    g.font = '900 78px "Bahnschrift","DIN Condensed","Arial Narrow",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(l.number), 64, 70);
    g.clearRect(128, 0, 128, 128);
    g.fillStyle = l.main === '#f2f2f2' || l.main === '#b8bec4' ? '#111' : '#fff';
    g.font = '900 34px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
    g.fillText(team, 192, 66, 120);
  });
}

export function makeF1(l: F1Livery, ghost = false): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  if (!ghost) root.add(carBlob(2.4, 6.4));
  const parts: Record<string, THREE.BufferGeometry[]> = { main: [], decal: [], accent: [], accent2: [], carbon: [], dark: [], helmet: [], visor: [], chrome: [], mirror: [], light: [] };
  const P = (k: keyof typeof parts, g: THREE.BufferGeometry) => parts[k].push(g);

  // ---- 機身（車鼻 → 駕駛艙 → 引擎蓋 → 車尾）；同一個形狀再疊一層塗裝條紋
  const hull = loft([
    { z: 2.8, w: 0.055, h: 0.04, y: 0.19 },
    { z: 2.6, w: 0.09, h: 0.06, y: 0.21 },
    { z: 2.3, w: 0.125, h: 0.085, y: 0.255 },
    { z: 1.9, w: 0.17, h: 0.12, y: 0.31 },
    { z: 1.5, w: 0.215, h: 0.16, y: 0.37 },
    { z: 1.1, w: 0.27, h: 0.2, y: 0.43 },
    { z: 0.7, w: 0.33, h: 0.24, y: 0.48 },
    { z: 0.2, w: 0.39, h: 0.27, y: 0.52 },
    { z: -0.4, w: 0.41, h: 0.29, y: 0.54 },
    { z: -1.0, w: 0.34, h: 0.29, y: 0.55 },
    { z: -1.5, w: 0.26, h: 0.24, y: 0.52 },
    { z: -1.9, w: 0.17, h: 0.18, y: 0.47 },
    { z: -2.2, w: 0.1, h: 0.12, y: 0.43 },
    { z: -2.38, w: 0.065, h: 0.085, y: 0.42 },
  ], 24, 2.6, 0.4, 1);
  P('main', hull);
  if (!ghost) P('decal', hull.clone());
  // 駕駛頭頂上方的進氣口＋往後收的背脊（進氣口是黑的）
  P('main', loft([
    { z: -0.18, w: 0.1, h: 0.13, y: 0.93 },
    { z: -0.45, w: 0.14, h: 0.19, y: 0.88 },
    { z: -0.95, w: 0.13, h: 0.18, y: 0.8 },
    { z: -1.6, w: 0.07, h: 0.11, y: 0.67 },
    { z: -2.05, w: 0.04, h: 0.05, y: 0.56 },
  ], 16));
  P('dark', loft([{ z: -0.15, w: 0.075, h: 0.095, y: 0.94 }, { z: -0.2, w: 0.075, h: 0.095, y: 0.94 }], 12));
  // 進氣口兩側的小耳朵（引擎進氣分流）
  for (const s of [-1, 1]) P('dark', loft([{ z: -0.32, w: 0.035, h: 0.05, y: 0.86, x: s * 0.15 }, { z: -0.36, w: 0.035, h: 0.05, y: 0.86, x: s * 0.15 }], 8));
  // 鯊魚鰭（後緣有一條第二色）
  P('main', plate([[-0.8, 1.0], [-1.95, 0.97], [-2.08, 0.66], [-1.25, 0.66]], 0.018, 0));
  P('accent', plate([[-1.86, 0.985], [-1.95, 0.975], [-2.08, 0.66], [-1.99, 0.66]], 0.022, 0));
  // 側箱：下切造型，前緣是進氣口；上面有散熱鰭片
  for (const s of [-1, 1]) {
    const pod = loft([
      { z: 0.62, w: 0.1, h: 0.17, y: 0.46, x: s * 0.6 },
      { z: 0.5, w: 0.19, h: 0.22, y: 0.46, x: s * 0.62 },
      { z: 0.3, w: 0.24, h: 0.245, y: 0.45, x: s * 0.63 },
      { z: -0.25, w: 0.25, h: 0.24, y: 0.44, x: s * 0.6 },
      { z: -0.95, w: 0.2, h: 0.18, y: 0.38, x: s * 0.5 },
      { z: -1.6, w: 0.1, h: 0.1, y: 0.31, x: s * 0.33 },
    ], 18, 2.6, 0, 0.4);
    P('main', pod);
    if (!ghost) P('decal', pod.clone());
    P('dark', loft([{ z: 0.63, w: 0.085, h: 0.145, y: 0.47, x: s * 0.6 }, { z: 0.6, w: 0.085, h: 0.145, y: 0.47, x: s * 0.6 }], 12));
    // 側箱上的第二色條紋
    P('accent', loft([
      { z: 0.4, w: 0.245, h: 0.03, y: 0.62, x: s * 0.63 },
      { z: -0.3, w: 0.255, h: 0.03, y: 0.62, x: s * 0.6 },
      { z: -0.95, w: 0.205, h: 0.025, y: 0.52, x: s * 0.5 },
    ], 12));
    // 散熱鰭片：側箱頂面後段一排斜的黑色細縫
    for (let k = 0; k < 6; k++) {
      const z = -0.32 - k * 0.1, x = s * (0.6 - k * 0.012), y = 0.68 - k * 0.012;
      P('dark', new THREE.BoxGeometry(0.2, 0.012, 0.035).rotateZ(s * -0.35).translate(x, y, z));
    }
    // 底板邊緣小翼（沿著底板外緣的細長翼片）
    P('carbon', new THREE.BoxGeometry(0.06, 0.012, 1.1).rotateZ(s * 0.5).translate(s * 0.93, 0.12, -0.75));
    // 底板前方的導流柵（四片直立小板）
    for (let k = 0; k < 4; k++) P('carbon', new THREE.BoxGeometry(0.01, 0.07, 0.42).rotateY(s * (0.12 + k * 0.05)).translate(s * (0.36 + k * 0.08), 0.1, 1.25 - k * 0.05));
  }
  // 駕駛艙開口（黑色）、頭枕、方向盤、車手（安全帽＋條紋＋護目鏡＋肩膀）
  P('dark', loft([{ z: 0.25, w: 0.2, h: 0.04, y: 0.79 }, { z: -0.05, w: 0.24, h: 0.05, y: 0.8 }, { z: -0.32, w: 0.2, h: 0.04, y: 0.8 }], 16, 2));
  for (const s of [-1, 1]) P('accent', new THREE.BoxGeometry(0.06, 0.07, 0.36).translate(s * 0.17, 0.82, -0.14)); // 頭枕護墊
  P('dark', new THREE.BoxGeometry(0.24, 0.1, 0.035).rotateX(0.5).translate(0, 0.8, 0.22)); // 方向盤
  for (const s of [-1, 1]) P('accent2', new THREE.BoxGeometry(0.04, 0.09, 0.04).rotateX(0.5).translate(s * 0.13, 0.8, 0.22));
  P('main', new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.35, 0.5, 0.8).translate(0, 0.79, -0.1)); // 肩膀（賽車服是車隊色）
  P('helmet', new THREE.SphereGeometry(0.15, 16, 10).scale(0.95, 1, 1.08).translate(0, 0.9, -0.12));
  P('accent', new THREE.TorusGeometry(0.146, 0.012, 4, 20).rotateX(Math.PI / 2 - 0.25).translate(0, 0.94, -0.12)); // 安全帽條紋
  P('visor', new THREE.SphereGeometry(0.153, 14, 5, Math.PI / 2 - 0.95, 1.9, 1.18, 0.42).scale(0.95, 1, 1.08).translate(0, 0.9, -0.12));
  // Halo（頭部保護環）＋ 中央支柱
  const haloCurve = new THREE.CatmullRomCurve3([
    [-0.33, 0.79, -0.32], [-0.31, 0.97, -0.08], [-0.2, 1.03, 0.2], [0, 1.04, 0.3], [0.2, 1.03, 0.2], [0.31, 0.97, -0.08], [0.33, 0.79, -0.32],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  P('carbon', new THREE.TubeGeometry(haloCurve, 24, 0.032, 6, false));
  P('carbon', rod([0, 1.04, 0.3], [0, 0.74, 0.48], 0.03));
  // 後照鏡：流線型外殼＋鏡面＋兩支支架
  for (const s of [-1, 1]) {
    P('main', new THREE.SphereGeometry(0.075, 12, 8).scale(1.1, 0.5, 0.45).translate(s * 0.48, 0.86, 0.27));
    P('mirror', new THREE.PlaneGeometry(0.14, 0.05).rotateY(Math.PI).translate(s * 0.48, 0.86, 0.235)); // 鏡面朝後
    P('carbon', rod([s * 0.34, 0.72, 0.3], [s * 0.46, 0.85, 0.28], 0.011));
    P('carbon', rod([s * 0.36, 0.7, 0.2], [s * 0.46, 0.84, 0.25], 0.009));
  }
  P('accent2', new THREE.BoxGeometry(0.11, 0.035, 0.06).translate(0, 1.13, -0.22)); // T 字攝影機
  P('carbon', rod([0, 0.21, 2.8], [0, 0.22, 3.0], 0.008)); // 鼻頭空速管
  // ---- 底板（地面效應）與擴散器（中間五片導流板）
  P('carbon', floorPlate([[-0.32, 1.55], [-0.72, 0.95], [-0.95, 0.35], [-0.97, -1.55], [-0.62, -2.05], [-0.45, -2.3], [0.45, -2.3], [0.62, -2.05], [0.97, -1.55], [0.95, 0.35], [0.72, 0.95], [0.32, 1.55]], 0.025, 0.06));
  P('carbon', new THREE.BoxGeometry(0.9, 0.025, 0.42).rotateX(-0.35).translate(0, 0.14, -2.42));
  for (const s of [-1, 1]) P('carbon', new THREE.BoxGeometry(0.02, 0.18, 0.42).translate(s * 0.45, 0.14, -2.42));
  for (let k = -2; k <= 2; k++) P('carbon', new THREE.BoxGeometry(0.012, 0.13, 0.38).translate(k * 0.15, 0.13, -2.42));
  // 車尾：防撞結構、排氣管、雨燈（下雨才亮）
  P('carbon', new THREE.BoxGeometry(0.16, 0.12, 0.3).translate(0, 0.4, -2.45));
  P('chrome', new THREE.CylinderGeometry(0.045, 0.05, 0.2, 12).rotateX(Math.PI / 2).translate(0, 0.52, -2.45));
  P('dark', new THREE.CircleGeometry(0.036, 12).rotateY(Math.PI).translate(0, 0.52, -2.551));
  P('light', new THREE.BoxGeometry(0.1, 0.04, 0.012).translate(0, 0.37, -2.606));
  // ---- 前翼：四片往外上揚、後掠的弧形翼片＋端板（含腳板）＋鼻樑支柱
  P('carbon', curvedWing(2.0, 0.34, 0.03, 0.1, 2.62, -0.06, 0.03, 0.02, 0.5));
  P('main', curvedWing(1.94, 0.2, 0.024, 0.165, 2.48, -0.25, 0.09, 0.12, 0.42));
  P('accent2', curvedWing(1.88, 0.15, 0.02, 0.215, 2.38, -0.42, 0.14, 0.2, 0.38));
  P('accent', curvedWing(1.8, 0.11, 0.018, 0.26, 2.3, -0.6, 0.18, 0.26, 0.34));
  for (const s of [-1, 1]) {
    P('accent', plate([[2.88, 0.05], [2.25, 0.05], [2.12, 0.2], [2.1, 0.36], [2.42, 0.37], [2.7, 0.2]], 0.02, s * 1.0));
    P('carbon', new THREE.BoxGeometry(0.12, 0.012, 0.5).translate(s * 0.95, 0.055, 2.55)); // 端板下的腳板
    P('carbon', rod([s * 0.08, 0.2, 2.35], [s * 0.12, 0.11, 2.45], 0.015));
  }
  // ---- 尾翼：主翼（中間微微下凹）＋ DRS 襟翼＋端板＋下方兩片樑翼＋中央天鵝頸支柱
  P('carbon', curvedWing(1.02, 0.32, 0.035, 0.93, -2.42, 0.18, 0.05, -0.02, 0));
  P('accent2', curvedWing(1.02, 0.2, 0.03, 1.04, -2.28, 0.5, 0.04, -0.01, 0));
  P('carbon', wing(0.82, 0.14, 0.025, 0, 0.56, -2.47, 0.12));
  P('carbon', wing(0.78, 0.1, 0.02, 0, 0.63, -2.38, 0.3));
  P('carbon', new THREE.BoxGeometry(0.05, 0.42, 0.14).translate(0, 0.74, -2.32));
  P('carbon', rod([0, 0.95, -2.3], [0, 1.06, -2.2], 0.02));
  for (const s of [-1, 1]) {
    P('main', plate([[-2.64, 0.46], [-2.12, 0.5], [-2.1, 1.0], [-2.2, 1.14], [-2.64, 1.15]], 0.022, s * 0.52));
    P('accent', plate([[-2.64, 1.08], [-2.18, 1.07], [-2.2, 1.14], [-2.64, 1.15]], 0.026, s * 0.52)); // 端板上緣的第二色
    for (let k = 0; k < 4; k++) P('dark', new THREE.BoxGeometry(0.026, 0.012, 0.3).translate(s * 0.52, 1.06 - k * 0.04, -2.4)); // 端板上緣的百葉
  }
  // ---- 懸吊（上下 A 臂＋推桿）、轉向拉桿
  for (const s of [-1, 1]) {
    for (const [zc, hubX] of [[1.78, 0.7], [-1.72, 0.66]] as const) {
      for (const [yb, yh] of [[0.5, 0.48], [0.34, 0.24]] as const) {
        P('carbon', rod([s * 0.2, yb, zc + 0.25], [s * hubX, yh, zc], 0.016));
        P('carbon', rod([s * 0.2, yb, zc - 0.22], [s * hubX, yh, zc], 0.016));
      }
      P('carbon', rod([s * 0.22, 0.6, zc + (zc > 0 ? -0.1 : 0.1)], [s * (hubX - 0.05), 0.27, zc], 0.014)); // 推桿／拉桿
    }
    P('carbon', rod([s * 0.2, 0.4, 1.92], [s * 0.68, 0.38, 1.9], 0.012)); // 轉向拉桿
  }

  // ---- 車號與隊名：鼻頭、引擎蓋兩側、側箱兩側（一張小貼圖、一次繪製）
  if (!ghost) {
    const team = TEAMS.find((t) => t.livery === l)?.team.split(' ')[0] ?? '';
    const quads: THREE.BufferGeometry[] = [];
    const quad = (w: number, h: number, u0: number, u1: number, m: THREE.Matrix4) => {
      const q = new THREE.PlaneGeometry(w, h), uv = q.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
      quads.push(q.applyMatrix4(m));
    };
    const M = (x: number, y: number, z: number, rx: number, ry: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    quad(0.22, 0.22, 0, 0.5, M(0, 0.452, 1.42, -Math.PI / 2 + 0.2, 0)); // 鼻頭（從上面看）
    for (const s of [-1, 1]) {
      quad(0.24, 0.24, 0, 0.5, M(s * 0.372, 0.62, -0.82, -0.32, s * Math.PI / 2)); // 引擎蓋兩側
      quad(0.5, 0.25, 0.5, 1, M(s * 0.858, 0.45, -0.2, 0, s * Math.PI / 2)); // 側箱外側的隊名
    }
    const badge = new THREE.Mesh(mergeGeometries(quads), new THREE.MeshBasicMaterial({ map: badgeTexture(l, team), transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
    body.add(badge);
  }

  // ---- 依材質合併成少數幾個網格
  const std = (color: string, metal: number, rough: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.25, depthWrite: false });
  let mats: Record<string, THREE.Material>;
  if (ghost) mats = Object.fromEntries(Object.keys(parts).map((k) => [k, ghostMat]));
  else {
    const light = new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false });
    mats = {
      main: std(l.main, 0.45, 0.28, { envMapIntensity: 1.25 }),
      decal: std('#ffffff', 0.4, 0.3, { map: decalTexture(l), transparent: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, envMapIntensity: 1.25 }),
      accent: std(l.accent, 0.4, 0.3), accent2: std(l.accent2, 0.4, 0.3),
      carbon: std('#ffffff', 0.35, 0.45, { map: carbon() }), dark: std('#050506', 0, 0.9), helmet: std(l.helmet, 0.3, 0.22), visor: std('#0d1014', 0.85, 0.08),
      chrome: std('#b9bec6', 1, 0.22), mirror: std('#c8d2dc', 1, 0.05), light,
    };
  }
  if (!ghost) root.userData.paint = mats.main; // 換烤漆用（vehicles.ts）
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list.map(strip)), mats[k]);
    if (k === 'light') m.userData.rainOnly = true; // 雨燈：下雨才亮（weather.ts）
    body.add(m);
  }

  // ---- 車輪：圓肩輪胎＋胎色圈＋輪框罩（2022 起的平面罩，上面三條標記看得出在轉）＋中心鎖；
  // 一顆輪子合成一個網格（頂點顏色），內側的煞車導管不跟著轉
  const steer: THREE.Group[] = [], spin: THREE.Mesh[] = [];
  const wheelMat = ghost ? ghostMat : new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.75 });
  const ductMat = ghost ? ghostMat : (mats.carbon as THREE.MeshStandardMaterial);
  for (const s of [-1, 1]) for (const [z, r, w] of [[1.78, 0.36, 0.3], [-1.72, 0.37, 0.4]] as const) {
    const g = new THREE.Group();
    g.position.set(s * (z > 0 ? 0.86 : 0.82), r, z);
    const rr = r * 0.66, sh = 0.05;
    // 胎面：側面輪廓繞軸轉一圈（軸先沿 y，再轉成沿 x）
    const prof = [[rr, -w / 2], [r * 0.9, -w / 2], [r - 0.012, -w / 2 + sh * 0.35], [r, -w / 2 + sh], [r, w / 2 - sh], [r - 0.012, w / 2 - sh * 0.35], [r * 0.9, w / 2], [rr, w / 2]].map(([a, b]) => new THREE.Vector2(a, b));
    const pieces = [tint(new THREE.LatheGeometry(prof, 24), '#141414')];
    for (const side of [-1, 1]) {
      const y = side * (w / 2 + 0.003), face = (geo: THREE.BufferGeometry) => geo.rotateX(side * -Math.PI / 2).translate(0, y, 0);
      pieces.push(tint(face(new THREE.RingGeometry(r * 0.76, r * 0.84, 24)), l.tyre ?? '#e10600')); // 胎色圈
      pieces.push(tint(face(new THREE.CircleGeometry(rr, 18)), '#1c1f24')); // 輪框罩
      pieces.push(tint(face(new THREE.RingGeometry(rr * 0.93, rr, 18)), '#6a7078')); // 輪框邊
      for (let k = 0; k < 3; k++) pieces.push(tint(face(new THREE.PlaneGeometry(0.025, rr * 0.8).translate(0, rr * 0.5, 0).rotateZ((k / 3) * Math.PI * 2)).translate(0, side * 0.001, 0), l.accent));
    }
    pieces.push(tint(new THREE.CylinderGeometry(0.045, 0.045, w + 0.03, 10), l.accent2)); // 中心鎖
    const wheelGeo = mergeGeometries(pieces).rotateZ(Math.PI / 2);
    const tyre = new THREE.Mesh(wheelGeo, wheelMat);
    g.add(tyre);
    // 煞車導管（輪子內側的碳纖維鼓）
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.55, 0.12, 14).rotateZ(Math.PI / 2).translate(-s * (w / 2 + 0.05), 0, 0), ductMat);
    g.add(duct);
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
  // 2026 起 11 隊 22 台車
  { team: '雪白 White Stallion', livery: { main: '#f2f2f2', accent: '#c8102e', accent2: '#1a1a1a', helmet: '#c8102e', number: 31, tyre: '#ffffff' } },
  { team: '鈦灰 Titan Grey', livery: { main: '#5a5f66', accent: '#e8002d', accent2: '#c0c0c0', helmet: '#e8002d', number: 5, tyre: '#ffd400' } },
  { team: '星夜黑 Midnight Star', livery: { main: '#101014', accent: '#d4af37', accent2: '#ffffff', helmet: '#d4af37', number: 11, tyre: '#e10600' } },
];
