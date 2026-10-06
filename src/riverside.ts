import * as THREE from 'three';
import type { CityData } from './citydata';

// 水域（基隆河、公園的池塘）：會反光的水面；饒河街觀光夜市：路兩側一排排攤位、招牌燈箱、頭上的紅燈籠

const GROUND = -0.6;

/** 水面：多邊形三角化後合成一個網格，比地面高一點點、比綠地和路面低 */
export function buildWater(scene: THREE.Scene, d: CityData) {
  const pos: number[] = [];
  for (const w of d.water ?? []) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < w.p.length; i += 2) pts.push(new THREE.Vector2(w.p[i], w.p[i + 1]));
    if (pts.length < 3) continue;
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const [a, b, c] of tris) for (const k of [a, c, b]) pos.push(pts[k].x, GROUND + 0.07, pts[k].y);
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: '#27495a', roughness: 0.1, metalness: 0.25, envMapIntensity: 1.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -2 });
  scene.add(new THREE.Mesh(g, mat));
}

/** 夜市：沿著饒河街每 3.2 m 兩側各一攤（攤子本體、彩色遮雨棚、招牌燈箱），每 6 m 一顆紅燈籠；回傳攤位位置（給碰撞用） */
export function buildMarket(scene: THREE.Scene, d: CityData): [number, number][] {
  const lines = d.market ?? [];
  const stalls: THREE.Matrix4[] = [], lanterns: THREE.Matrix4[] = [], spots: [number, number][] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (const L of lines) {
    let carry = 1.6, lc = 3;
    for (let i = 0; i + 3 < L.length; i += 2) {
      const ax = L[i], az = L[i + 1], bx = L[i + 2], bz = L[i + 3], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.5) continue;
      const ux = (bx - ax) / l, uz = (bz - az) / l, nx = -uz, nz = ux;
      let s = carry;
      for (; s < l; s += 3.2) {
        for (const side of [-1, 1]) {
          const x = ax + ux * s + nx * side * 3.4, z = az + uz * s + nz * side * 3.4;
          q.setFromAxisAngle(up, Math.atan2(-nx * side, -nz * side)); // 攤位面向街道中間
          stalls.push(new THREE.Matrix4().compose(v.set(x, GROUND, z), q, one));
          spots.push([x, z]);
        }
      }
      carry = s - l;
      for (; lc < l; lc += 6) lanterns.push(new THREE.Matrix4().compose(v.set(ax + ux * lc, GROUND + 4.6, az + uz * lc), q, one));
      lc -= l;
    }
  }
  if (!stalls.length) return spots;
  const n = stalls.length;
  const COLORS = ['#e03b3b', '#f0a020', '#2f8fd8', '#3fae5a', '#e05fa0', '#f2d23a', '#7a5ad8', '#ff7a30'].map((c) => new THREE.Color(c));
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 1.1, 1.8).translate(0, 0.55, 0), new THREE.MeshLambertMaterial({ color: '#8a8f96' }), n);
  const canopy = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.12, 2.6).rotateX(-0.18).translate(0, 2.55, 0.3), new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
  const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 2.5, 0.08).translate(1.35, 1.25, 1.4), new THREE.MeshLambertMaterial({ color: '#444' }), n);
  const signMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  signMat.userData.nightScale = 1.8; // 晚上燈箱更亮（weather.ts）
  const sign = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.42, 0.06).translate(0, 2.2, 1.15), signMat, n);
  const lanternMat = new THREE.MeshBasicMaterial({ color: '#e2261f', toneMapped: false });
  lanternMat.userData.nightScale = 2.4;
  const lantern = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8).scale(1, 1.25, 1), lanternMat, Math.max(1, lanterns.length));
  stalls.forEach((m, i) => {
    body.setMatrixAt(i, m); canopy.setMatrixAt(i, m); poles.setMatrixAt(i, m); sign.setMatrixAt(i, m);
    canopy.setColorAt(i, COLORS[i % COLORS.length]);
    sign.setColorAt(i, COLORS[(i * 3 + 1) % COLORS.length].clone().lerp(new THREE.Color('#ffffff'), 0.55));
  });
  lanterns.forEach((m, i) => lantern.setMatrixAt(i, m));
  lantern.count = lanterns.length;
  for (const im of [body, canopy, poles, sign, lantern]) { im.computeBoundingSphere(); scene.add(im); }
  return spots;
}
