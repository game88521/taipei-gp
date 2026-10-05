import * as THREE from 'three';
import { Grid, type CityData } from './citydata';
import { bakedShadowMaterial, SHADOW_PER_M } from './world';

// 高架道路（建國高架、市民大道高架…）、信義區人行空橋、捷運文湖線高架與月台、地下道入口。
// 物理是平面的，車子開不上去：只畫外型，從底下過；橋墩與匝道貼地那段算障礙物（回傳給 Collider）

const GROUND = -0.6;
export interface ElevatedHits { posts: [number, number, number][]; walls: [number, number, number, number][] }

/** 一條四邊形加進頂點陣列（a b c d 逆時針） */
function quad(pos: number[], a: number[], b: number[], c: number[], d: number[]) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); }

export function buildElevated(scene: THREE.Scene, d: CityData): ElevatedHits {
  const hits: ElevatedHits = { posts: [], walls: [] };
  const els = d.elevated ?? [];
  const deck: number[] = [], concrete: number[] = [], rail: number[] = [], walk: number[] = [], glass: number[] = [], roof: number[] = [], shadow: number[] = [];
  const pillars: THREE.Matrix4[] = [], columns: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3();
  // 橋墩不能立在車道中間：落在雙向道路上 → 移到道路中線（分隔島）；落在單行道上 → 不放
  const N = d.net.nodes, segs = new Grid<number[]>(30), tmp: number[][] = [];
  for (const w of d.net.ways) {
    if (w.c > 3) continue;
    for (let k = 0; k + 1 < w.n.length; k++) {
      const ax = N[w.n[k] * 2], az = N[w.n[k] * 2 + 1], bx = N[w.n[k + 1] * 2], bz = N[w.n[k + 1] * 2 + 1];
      segs.addBox(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, [ax, az, bx, bz, w.w / 2, w.o ? 1 : 0]);
    }
  }
  const placePillar = (x: number, z: number): [number, number] | null => {
    let best: number[] | null = null, bd = Infinity, bt = 0;
    for (const sg of segs.query(x, z, 14, tmp)) {
      const [ax, az, bx, bz] = sg, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const dd = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (dd < sg[4] + 1.2 && dd < bd) { bd = dd; best = sg; bt = t; }
    }
    if (!best) return [x, z];
    if (best[5]) return null;
    return [best[0] + (best[2] - best[0]) * bt, best[1] + (best[3] - best[1]) * bt];
  };
  for (const e of els) {
    const P = e.p, Y = e.y, n = P.length / 2, hw = e.w / 2;
    const thick = e.k === 1 ? 0.5 : e.k === 0 ? 1.4 : 1.1;
    const spacing = e.k === 0 ? 28 : e.k === 1 ? 18 : 24;
    let carry = spacing / 2;
    for (let i = 0; i + 1 < n; i++) {
      const ax = P[i * 2], az = P[i * 2 + 1], bx = P[i * 2 + 2], bz = P[i * 2 + 3], ya = Y[i], yb = Y[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 0.2) continue;
      const ux = (bx - ax) / l, uz = (bz - az) / l, nx = -uz * hw, nz = ux * hw;
      // 兩端各延伸一點蓋住轉折處的縫
      const ex0 = i === 0 ? 0 : Math.min(1.5, hw * 0.4), ex1 = i + 2 === n ? 0 : Math.min(1.5, hw * 0.4);
      const x0 = ax - ux * ex0, z0 = az - uz * ex0, x1 = bx + ux * ex1, z1 = bz + uz * ex1;
      const t0 = GROUND + ya + 0.6, t1 = GROUND + yb + 0.6; // 橋面高度（地面以上 y m）
      const L0 = [x0 - nx, t0, z0 - nz], R0 = [x0 + nx, t0, z0 + nz], L1 = [x1 - nx, t1, z1 - nz], R1 = [x1 + nx, t1, z1 + nz];
      const lo = (p: number[]) => [p[0], p[1] - thick, p[2]];
      // 橋面（向上）、橋底（向下）、兩側
      quad(e.k === 1 ? walk : e.k === 0 ? deck : concrete, L0, R0, R1, L1);
      quad(concrete, lo(L0), lo(L1), lo(R1), lo(R0));
      quad(concrete, lo(R0), lo(R1), R1, R0);
      quad(concrete, lo(L1), lo(L0), L0, L1);
      if (e.k === 1) {
        // 人行空橋：玻璃側牆＋頂棚
        const H = 2.6, upv = (p: number[]) => [p[0], p[1] + H, p[2]];
        quad(glass, R0, R1, upv(R1), upv(R0));
        quad(glass, L1, L0, upv(L0), upv(L1));
        quad(roof, upv(L0), upv(R0), upv(R1), upv(L1));
        quad(roof, upv(L1), upv(R1), upv(R0), upv(L0));
      } else {
        // 護欄（道路）／側牆（捷運）：內外兩面＋頂
        const H = e.k === 0 ? 1.0 : 1.3, T = 0.3;
        for (const sd of [-1, 1]) {
          const ox = -uz * sd, oz = ux * sd;
          const o0 = [x0 + nx * sd, t0, z0 + nz * sd], o1 = [x1 + nx * sd, t1, z1 + nz * sd];
          const i0 = [o0[0] - ox * T, t0, o0[2] - oz * T], i1 = [o1[0] - ox * T, t1, o1[2] - oz * T];
          const hgt = (p: number[]) => [p[0], p[1] + H, p[2]];
          quad(concrete, ...((sd > 0 ? [o0, o1, hgt(o1), hgt(o0)] : [o1, o0, hgt(o0), hgt(o1)]) as [number[], number[], number[], number[]]));
          quad(concrete, ...((sd > 0 ? [i1, i0, hgt(i0), hgt(i1)] : [i0, i1, hgt(i1), hgt(i0)]) as [number[], number[], number[], number[]]));
          quad(concrete, hgt(sd > 0 ? i0 : o0), hgt(sd > 0 ? o0 : i0), hgt(sd > 0 ? o1 : i1), hgt(sd > 0 ? i1 : o1));
        }
        if (e.k === 2) {
          // 文湖線的導軌：兩條深色的軌道梁
          for (const off of [-1.2, 1.2]) {
            const g0 = [ax + -uz * off - uz * 0.25, t0 + 0.02, az + ux * off + ux * 0.25], g1 = [bx + -uz * off - uz * 0.25, t1 + 0.02, bz + ux * off + ux * 0.25];
            const g2 = [bx + -uz * off + uz * 0.25, t1 + 0.02, bz + ux * off - ux * 0.25], g3 = [ax + -uz * off + uz * 0.25, t0 + 0.02, az + ux * off - ux * 0.25];
            quad(rail, g3, g0, g1, g2);
          }
        }
      }
      // 地上的影子：橋面沿太陽反方向投到地面
      const sh = (x: number, z: number, y: number) => [x + SHADOW_PER_M.x * Math.min(y, 30), 0.03, z + SHADOW_PER_M.z * Math.min(y, 30)];
      if (ya > 2 || yb > 2) quad(shadow, sh(L0[0], L0[2], ya), sh(L1[0], L1[2], yb), sh(R1[0], R1[2], yb), sh(R0[0], R0[2], ya));
      // 橋墩：每 spacing 公尺一支（橋夠高才有）；匝道貼地那段：兩側算牆
      let t = carry;
      for (; t < l; t += spacing) {
        const f = t / l, y = ya + (yb - ya) * f;
        if (y < 4.5) continue;
        const at = placePillar(ax + ux * t, az + uz * t);
        if (!at) continue;
        const [px, pz] = at;
        q.setFromAxisAngle(up, Math.atan2(ux, uz));
        const top = GROUND + y + 0.6 - thick;
        if (e.k === 0) pillars.push(new THREE.Matrix4().compose(v.set(px, GROUND, pz), q, s.set(1.8, top - GROUND, 1.6))); // 柱身窄（分隔島放得下），上面接橋面
        else columns.push(new THREE.Matrix4().compose(v.set(px, GROUND, pz), q, s.set(1, top - GROUND, 1)));
        hits.posts.push([px, pz, e.k === 0 ? 1.0 : e.k === 1 ? 0.5 : 0.9]);
      }
      carry = t - l;
      if (e.k === 0 && Math.max(ya, yb) < 4.5 && Math.min(ya, yb) > 0.4) for (const sd of [-1, 1]) hits.walls.push([ax + nx * sd, az + nz * sd, bx + nx * sd, bz + nz * sd]);
    }
  }
  const mesh = (pos: number[], mat: THREE.Material) => {
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    scene.add(new THREE.Mesh(g, mat));
  };
  // 頂點是手算的，正反面不一定一致：一律雙面（three.js 會幫背面翻法線，打光一樣正確）
  const D = THREE.DoubleSide;
  mesh(deck, new THREE.MeshLambertMaterial({ color: '#46484e', side: D }));
  mesh(concrete, new THREE.MeshLambertMaterial({ color: '#b3afa6', side: D }));
  mesh(rail, new THREE.MeshLambertMaterial({ color: '#3a3c40', side: D }));
  mesh(walk, new THREE.MeshLambertMaterial({ color: '#c9c1b2', side: D }));
  mesh(glass, new THREE.MeshStandardMaterial({ color: '#a6d6ea', metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
  mesh(roof, new THREE.MeshLambertMaterial({ color: '#dfe2e4', side: D }));
  mesh(shadow, bakedShadowMaterial());
  if (pillars.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#a7a399' }), pillars.length);
    pillars.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    scene.add(im);
  }
  if (columns.length) {
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 0.9, 1, 12).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#b9b5ab' }), columns.length);
    columns.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    scene.add(im);
  }
  // 地下道入口：路往下進隧道的地方立一個混凝土門框，裡面是黑的（物理上車子開不進去，門框不擋路，只是外型）
  const pt = d.portals ?? [];
  if (pt.length) {
    const frame: number[] = [], hole: number[] = [];
    for (let k = 0; k + 3 < pt.length; k += 4) {
      const x = pt[k], z = pt[k + 1], ang = pt[k + 2], w = pt[k + 3];
      const ux = Math.sin(ang), uz = Math.cos(ang), rx = uz, rz = -ux;
      const cx = x + ux * 14, cz = z + uz * 14, hw = w / 2 + 0.6, H = 5.2;
      const at = (s: number, y: number, f = 0) => [cx + rx * s + ux * f, GROUND + y, cz + rz * s + uz * f];
      // 門框正面（朝向來車）：上方橫梁＋兩側柱；後面一片黑
      quad(frame, at(hw, H), at(-hw, H), at(-hw, H + 1.6), at(hw, H + 1.6));
      for (const sd of [-1, 1]) quad(frame, ...((sd > 0 ? [at(hw, 0), at(hw - 0.9, 0), at(hw - 0.9, H), at(hw, H)] : [at(-hw + 0.9, 0), at(-hw, 0), at(-hw, H), at(-hw + 0.9, H)]) as [number[], number[], number[], number[]]));
      quad(hole, at(hw - 0.9, 0, 1.5), at(-hw + 0.9, 0, 1.5), at(-hw + 0.9, H, 1.5), at(hw - 0.9, H, 1.5));
    }
    mesh(frame, new THREE.MeshLambertMaterial({ color: '#c2beb4', side: THREE.DoubleSide }));
    mesh(hole, new THREE.MeshBasicMaterial({ color: '#07080a', side: THREE.DoubleSide }));
  }
  return hits;
}
