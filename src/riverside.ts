import * as THREE from 'three';
import { Grid, distSeg, type CityData } from './citydata';

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

/**
 * 淡水河、基隆河的河濱（只做地圖範圍內的大河）：河岸往內 30 m 一道 5 m 高的混凝土堤防（車子撞得到），
 * 堤防跟河之間鋪河濱草地與紅色自行車道。道路穿過的地方、每 280 m 留一個水門缺口（不會被關在河邊出不來）
 */
export function buildLevee(scene: THREE.Scene, d: CityData, addWall: (x1: number, z1: number, x2: number, z2: number) => void): number {
  const B = d.tiles?.bounds;
  if (!B) return 0;
  const N = d.net.nodes, segs = new Grid<number[]>(40), tmp: number[][] = [];
  for (const w of d.net.ways) if (w.c <= 3) for (let k = 0; k + 1 < w.n.length; k++) {
    const s = [N[w.n[k] * 2], N[w.n[k] * 2 + 1], N[w.n[k + 1] * 2], N[w.n[k + 1] * 2 + 1], w.w / 2];
    segs.addBox(Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3]), s);
  }
  const nearRoad = (x: number, z: number, m: number) => segs.query(x, z, m + 10, tmp).some(([ax, az, bx, bz, hw]) => distSeg(x, z, ax, az, bx, bz) < hw + m);
  const inPoly = (p: number[], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
      const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const wall: number[] = [], path: number[] = [], grass: number[] = [];
  const quad = (arr: number[], ax: number, az: number, bx: number, bz: number, nx: number, nz: number, o0: number, o1: number, y: number) => {
    const p = [[ax + nx * o0, az + nz * o0], [bx + nx * o0, bz + nz * o0], [bx + nx * o1, bz + nz * o1], [ax + nx * o1, az + nz * o1]];
    for (const k of [0, 1, 2, 0, 2, 3]) arr.push(p[k][0], y, p[k][1]);
  };
  const OFF = 30, H = 5.2, Y0 = -0.6;
  let walls = 0;
  for (const w of d.water ?? []) {
    const p = w.p, n = p.length / 2;
    let A = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; A += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
    if (Math.abs(A / 2) < 150000) continue; // 池塘、小水道不做
    let run = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 1.5) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (mx < B[0] || mx > B[2] || mz < B[1] || mz > B[3]) { run = 0; continue; }
      // 往陸地那一側的法線
      let nx = -(bz - az) / l, nz = (bx - ax) / l;
      if (inPoly(p, mx + nx * 3, mz + nz * 3)) { nx = -nx; nz = -nz; }
      // 堤防離河岸多遠：30 m 為主；沿河的道路（環河北路…）貼著河岸時往河邊靠，夾在路和河中間
      const off = [OFF, 18, 10].find((o) => !nearRoad(mx + nx * o, mz + nz * o, 5) && !inPoly(p, mx + nx * o, mz + nz * o));
      run += l;
      if (off === undefined) continue;
      const gate = run % 280 < 14;
      quad(grass, ax, az, bx, bz, nx, nz, 1, off - 1, -0.46);
      if (off >= 14) quad(path, ax, az, bx, bz, nx, nz, off * 0.4, off * 0.4 + 3, -0.43);
      if (gate) continue;
      // 堤防：兩面牆＋頂面
      const x1 = ax + nx * off, z1 = az + nz * off, x2 = bx + nx * off, z2 = bz + nz * off;
      for (const [o, y0, y1] of [[0, Y0, Y0 + H], [1.2, Y0, Y0 + H]] as [number, number, number][]) {
        const ux = x1 + nx * o, uz = z1 + nz * o, vx = x2 + nx * o, vz = z2 + nz * o;
        wall.push(ux, y0, uz, vx, y0, vz, vx, y1, vz, ux, y0, uz, vx, y1, vz, ux, y1, uz);
      }
      quad(wall, ax, az, bx, bz, nx, nz, off, off + 1.2, Y0 + H);
      addWall(x1, z1, x2, z2);
      addWall(x1 + nx * 1.2, z1 + nz * 1.2, x2 + nx * 1.2, z2 + nz * 1.2);
      walls++;
    }
  }
  const mk = (arr: number[], color: string, flat: boolean) => {
    if (!arr.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: flat, polygonOffsetFactor: flat ? -1 : 0, polygonOffsetUnits: flat ? -4 : 0 }));
    if (flat) m.userData.flat = true;
    scene.add(m);
  };
  mk(grass, '#5d8546', true);
  mk(path, '#b04a3a', true);
  mk(wall, '#a2a6a8', false);
  return walls;
}
