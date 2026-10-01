import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 車輛外型（照側面輪廓擠出、邊角倒圓）：車身漆色的部分與固定顏色的部分分開，給 InstancedMesh 用
// 座標：車頭朝 +z、y 向上、車寬沿 x，原點在車底中心

const tint = (g: THREE.BufferGeometry, color: string) => {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
/** 只留 position / normal / color（擠出幾何有 uv、Box 也有 uv，合併前統一） */
const clean = (g: THREE.BufferGeometry) => {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') out.deleteAttribute(k);
  return out;
};

/** 側面輪廓（z, y 座標）沿車寬擠出 */
function profile(pts: [number, number][], width: number, bevel = 0.05): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // 輪廓的 x → 車長 z、擠出方向 → 車寬 x，置中
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  g.computeVertexNormals();
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r: number, w: number, x: number, y: number, z: number, seg = 14) => new THREE.CylinderGeometry(r, r, w, seg).rotateZ(Math.PI / 2).translate(x, y, z);

export interface VehicleGeo {
  paint: THREE.BufferGeometry; // 吃 instanceColor 的車身
  fixed: THREE.BufferGeometry; // 玻璃、輪胎、燈（頂點色）
  wheels: [number, number, number, number][]; // 車輪位置與半徑（給玩家的車做轉向／滾動）
  length: number;
}

export function sedanGeo(opts: { taxi?: boolean; hatch?: boolean; noWheels?: boolean } = {}): VehicleGeo {
  const paint: THREE.BufferGeometry[] = [], fixed: THREE.BufferGeometry[] = [];
  const W = 1.76;
  // 下車身：車頭保險桿 → 引擎蓋 → 腰線 → 後車廂
  const rearZ = opts.hatch ? -2.0 : -2.3;
  paint.push(profile([[rearZ, 0.32], [2.3, 0.32], [2.34, 0.62], [2.22, 0.84], [1.0, 0.97], [-1.55, 1.0], [rearZ + 0.05, 0.98], [rearZ - 0.03, 0.62]], W, 0.07));
  // 車窗（擋風玻璃、側窗、後窗）
  const back: [number, number] = opts.hatch ? [rearZ + 0.12, 1.0] : [-1.6, 1.0];
  fixed.push(tint(profile([[1.0, 0.97], [0.36, 1.4], [-0.95, 1.42], back], W - 0.14, 0.04), '#22303d'));
  // 車頂板
  paint.push(profile([[0.3, 1.39], [-0.92, 1.41], [-0.9, 1.47], [0.26, 1.46]], W - 0.22, 0.03));
  // 前後燈、水箱罩、車牌、後照鏡
  for (const s of [-1, 1]) {
    fixed.push(tint(box(0.44, 0.13, 0.08, s * 0.58, 0.76, 2.3), '#fff4d6'));
    fixed.push(tint(box(0.4, 0.14, 0.06, s * 0.62, 0.8, rearZ - 0.02), '#e01818'));
    paint.push(box(0.08, 0.1, 0.18, s * (W / 2 + 0.06), 1.02, 0.85));
  }
  fixed.push(tint(box(0.7, 0.14, 0.06, 0, 0.58, 2.33), '#1a1c20'));
  fixed.push(tint(box(0.42, 0.13, 0.04, 0, 0.5, rearZ - 0.05), '#f2f2f2'));
  fixed.push(tint(box(W + 0.02, 0.16, 4.2 + (opts.hatch ? -0.3 : 0), 0, 0.34, (rearZ + 2.3) / 2), '#1d1f23')); // 下緣黑色裙邊
  if (opts.taxi) {
    fixed.push(tint(box(0.66, 0.22, 0.32, 0, 1.58, -0.3), '#fafaf0'));
    fixed.push(tint(box(0.68, 0.06, 0.34, 0, 1.47, -0.3), '#2a2a2a'));
  }
  const wheels: [number, number, number, number][] = [];
  const wz = opts.hatch ? [1.4, -1.25] : [1.45, -1.45];
  for (const s of [-1, 1]) for (const z of wz) {
    wheels.push([s * 0.8, 0.33, z, 0.33]);
    if (opts.noWheels) continue;
    fixed.push(tint(cyl(0.33, 0.24, s * 0.8, 0.33, z), '#151515'));
    fixed.push(tint(cyl(0.2, 0.02, s * 0.93, 0.33, z, 10), '#b8bcc2'));
  }
  return { paint: mergeGeometries(paint.map(clean)), fixed: mergeGeometries(fixed.map(clean)), wheels, length: rearZ < -2.1 ? 4.6 : 4.3 };
}

export function busGeo(): VehicleGeo {
  const paint: THREE.BufferGeometry[] = [], fixed: THREE.BufferGeometry[] = [];
  const W = 2.5, L = 11;
  // 白色車身（固定色）＋ 下半部與腰帶彩條（漆色＝路線顏色）
  fixed.push(tint(profile([[-L / 2, 0.45], [L / 2 - 0.2, 0.45], [L / 2, 0.9], [L / 2 - 0.05, 3.0], [L / 2 - 0.35, 3.15], [-L / 2 + 0.2, 3.15], [-L / 2, 2.9]], W, 0.1), '#f4f4f2'));
  paint.push(profile([[-L / 2 - 0.02, 0.44], [L / 2 - 0.18, 0.44], [L / 2 + 0.02, 0.9], [L / 2 + 0.01, 1.25], [-L / 2 - 0.02, 1.25]], W + 0.02, 0.05));
  // 側窗帶、擋風玻璃
  fixed.push(tint(box(W + 0.04, 1.05, L - 2.4, 0, 2.1, -0.5), '#22303d'));
  fixed.push(tint(box(W - 0.3, 1.5, 0.06, 0, 2.15, L / 2 + 0.01), '#22303d'));
  fixed.push(tint(box(1.6, 0.26, 0.06, 0, 2.95, L / 2 + 0.03), '#ff9a00')); // 路線顯示牌
  for (const s of [-1, 1]) {
    fixed.push(tint(box(0.3, 0.16, 0.05, s * 0.9, 0.85, L / 2 + 0.02), '#fff4d6'));
    for (const z of [3.6, -3.4]) {
      fixed.push(tint(cyl(0.5, 0.32, s * 1.05, 0.5, z), '#151515'));
      fixed.push(tint(cyl(0.3, 0.02, s * 1.23, 0.5, z, 10), '#9aa0a6'));
    }
  }
  return { paint: mergeGeometries(paint.map(clean)), fixed: mergeGeometries(fixed.map(clean)), wheels: [], length: L };
}

/** 機車＋騎士：車殼與安全帽吃漆色 */
export function scooterGeo(): VehicleGeo {
  const paint: THREE.BufferGeometry[] = [], fixed: THREE.BufferGeometry[] = [];
  // 車殼：前擋板（直立）＋ 腳踏板 ＋ 座墊下的後車身
  paint.push(profile([[0.55, 0.3], [0.7, 0.35], [0.72, 1.0], [0.6, 1.08], [0.48, 0.5]], 0.46, 0.04));
  paint.push(profile([[-0.75, 0.35], [0.5, 0.3], [0.5, 0.4], [-0.15, 0.42], [-0.3, 0.72], [-0.82, 0.74], [-0.88, 0.5]], 0.42, 0.04));
  fixed.push(tint(box(0.32, 0.1, 0.62, 0, 0.8, -0.5), '#1a1a1a')); // 座墊
  fixed.push(tint(box(0.62, 0.05, 0.05, 0, 1.12, 0.6), '#2a2a2a')); // 龍頭
  fixed.push(tint(box(0.16, 0.1, 0.05, 0, 0.95, 0.74), '#fff4d6'));
  fixed.push(tint(box(0.18, 0.07, 0.04, 0, 0.66, -0.9), '#e01818'));
  for (const z of [0.62, -0.62]) fixed.push(tint(cyl(0.24, 0.12, 0, 0.24, z, 12), '#151515'));
  // 騎士：坐姿（大腿水平、手握龍頭）
  const jacket = '#3a4250', jeans = '#2a3346', skin = '#e3b994';
  fixed.push(tint(new THREE.CylinderGeometry(0.17, 0.15, 0.55, 8).scale(1, 1, 0.7).rotateX(-0.25).translate(0, 1.2, -0.38), jacket));
  for (const s of [-1, 1]) {
    fixed.push(tint(box(0.13, 0.13, 0.5, s * 0.12, 0.9, -0.2), jeans)); // 大腿
    fixed.push(tint(box(0.12, 0.45, 0.13, s * 0.14, 0.62, 0.06), jeans)); // 小腿
    fixed.push(tint(new THREE.CylinderGeometry(0.045, 0.04, 0.62, 6).rotateX(Math.PI / 2 - 0.5).translate(s * 0.22, 1.2, 0.08), jacket)); // 手臂
    fixed.push(tint(new THREE.SphereGeometry(0.045, 6, 4).translate(s * 0.3, 1.1, 0.58), skin));
  }
  paint.push(new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.62, -0.32)); // 安全帽
  fixed.push(tint(box(0.22, 0.08, 0.04, 0, 1.6, -0.17), '#1a2a3a')); // 護目鏡
  return { paint: mergeGeometries(paint.map(clean)), fixed: mergeGeometries(fixed.map(clean)), wheels: [], length: 1.9 };
}

/** 行人各部位（以腳底為原點；四肢的原點在關節，方便擺動） */
export const pedParts = {
  torso: () => new THREE.CylinderGeometry(0.2, 0.16, 0.56, 10).scale(1, 1, 0.62).translate(0, 1.2, 0),
  pelvis: () => new THREE.CylinderGeometry(0.16, 0.17, 0.2, 10).scale(1, 1, 0.65).translate(0, 0.9, 0),
  head: () => new THREE.SphereGeometry(0.115, 12, 10).scale(0.92, 1.05, 1).translate(0, 1.64, 0),
  hair: () => new THREE.SphereGeometry(0.124, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56).translate(0, 1.665, -0.012),
  neck: () => new THREE.CylinderGeometry(0.05, 0.055, 0.12, 6).translate(0, 1.52, 0),
  arm: () => new THREE.CylinderGeometry(0.05, 0.04, 0.6, 6).translate(0, -0.3, 0),
  leg: () => new THREE.CylinderGeometry(0.075, 0.055, 0.86, 7).translate(0, -0.43, 0),
  shoe: () => new THREE.BoxGeometry(0.11, 0.07, 0.24).translate(0, -0.85, 0.04),
  bag: () => new THREE.BoxGeometry(0.28, 0.34, 0.13).translate(0, 1.2, -0.19),
};
