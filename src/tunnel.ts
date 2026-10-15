import * as THREE from 'three';
import type { CityData } from './citydata';
import { ROAD_Y, type Surface } from './surface';

// 隧道與地下道（路網 e: 2，象山隧道、建國快速道路的地下段…）：
// 比地面深 5 m 以上的段是完整的隧道（路面、側牆、天花板、兩排燈）；淺的段是開放的路塹（側牆接到地面、兩側矮牆）。
// 路塹開口的地方要把地面「挖掉」：開口的形狀先畫進模板緩衝（stencil），地面與地形網格在模板 = 1 的地方不畫。
// 碰撞：隧道側牆擋隧道裡的車；路塹兩側的矮牆擋地面的車（不會掉進去）

export const CEIL = 5.4; // 隧道淨高
/** 被挖洞的材質（地面、地形網格）：模板 = 1 的地方不畫 */
export function holeAware(m: THREE.Material) {
  // three.js 只有 stencilWrite 開著才做模板測試；寫入遮罩設 0 = 只讀不寫
  m.stencilWrite = true;
  m.stencilWriteMask = 0;
  m.stencilRef = 1;
  m.stencilFunc = THREE.NotEqualStencilFunc;
}

export interface TunnelHits { walls: [number, number, number, number, number, number][] }

function quad(pos: number[], a: number[], b: number[], c: number[], d: number[]) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); }

export function buildTunnels(scene: THREE.Scene, d: CityData, surf: Surface): TunnelHits {
  const hits: TunnelHits = { walls: [] };
  const N = d.net.nodes, Y = d.net.y ?? [];
  const road: number[] = [], roadIn: number[] = [], wall: number[] = [], ceil: number[] = [], lamp: number[] = [], hole: number[] = [], parapet: number[] = [];
  for (const w of d.net.decks ?? []) {
    if (w.e !== 2) continue;
    const hw = w.w / 2;
    for (let k = 0; k + 1 < w.n.length; k++) {
      const a = w.n[k], b = w.n[k + 1];
      const ax = N[a * 2], az = N[a * 2 + 1], bx = N[b * 2], bz = N[b * 2 + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.2) continue;
      const ya = (Y[a] ?? 0) + ROAD_Y, yb = (Y[b] ?? 0) + ROAD_Y;
      const ux = (bx - ax) / l, uz = (bz - az) / l, nx = -uz, nz = ux;
      // 每 4 m 一小段：頂上的地面多高決定是隧道還是路塹
      const n = Math.max(1, Math.ceil(l / 4));
      for (let q = 0; q < n; q++) {
        const f0 = q / n, f1 = (q + 1) / n;
        const P = (f: number, s: number, dy = 0) => [ax + (bx - ax) * f + nx * s, ya + (yb - ya) * f + dy, az + (bz - az) * f + nz * s];
        const y0 = ya + (yb - ya) * f0, y1 = ya + (yb - ya) * f1;
        const mx = ax + (bx - ax) * (f0 + f1) / 2, mz = az + (bz - az) * (f0 + f1) / 2;
        const g = surf.groundY(mx, mz), depth = g - (y0 + y1) / 2; // 頂上的路面比隧道路面高多少
        if (depth < 0.3) continue; // 跟地面一樣高的段：就是地面道路，不用畫
        const covered = depth > CEIL;
        quad(covered ? roadIn : road, P(f0, -hw - 0.2), P(f0, hw + 0.2), P(f1, hw + 0.2), P(f1, -hw - 0.2)); // 鋪到牆腳，不留縫
        for (const sd of [-1, 1]) {
          const s = sd * (hw + 0.2);
          if (covered) {
            quad(wall, P(f0, s), P(f1, s), P(f1, s, CEIL), P(f0, s, CEIL));
            // 燈：天花板兩側每段一條發光燈管
            if (q % 2 === 0) quad(lamp, P(f0, sd * (hw - 0.6), CEIL - 0.05), P(f0, sd * (hw - 0.2), CEIL - 0.05), P(f1, sd * (hw - 0.2), CEIL - 0.05), P(f1, sd * (hw - 0.6), CEIL - 0.05));
          } else {
            // 路塹：側牆接到地面，牆頂再多 1 m 矮牆（地面的車撞到會被擋住）
            const ga = surf.groundY(ax + (bx - ax) * f0 + nx * s, az + (bz - az) * f0 + nz * s) + 0.25, gb = surf.groundY(ax + (bx - ax) * f1 + nx * s, az + (bz - az) * f1 + nz * s) + 0.25;
            const A0 = P(f0, s), A1 = P(f1, s), T0 = [A0[0], ga, A0[2]], T1 = [A1[0], gb, A1[2]];
            quad(wall, A0, A1, T1, T0);
            quad(parapet, T0, T1, [T1[0], gb + 1, T1[2]], [T0[0], ga + 1, T0[2]]);
            hits.walls.push([T0[0], T0[2], T1[0], T1[2], Math.min(ga, gb) - 0.9, Math.max(ga, gb) + 1.2]); // 擋地面的車
          }
          hits.walls.push([P(f0, sd * hw)[0], P(f0, sd * hw)[2], P(f1, sd * hw)[0], P(f1, sd * hw)[2], Math.min(y0, y1) - 0.3, Math.max(y0, y1) + CEIL]); // 擋隧道裡的車
        }
        if (covered) quad(ceil, P(f0, hw + 0.2, CEIL), P(f0, -hw - 0.2, CEIL), P(f1, -hw - 0.2, CEIL), P(f1, hw + 0.2, CEIL));
        else {
          // 地面開洞：路塹的範圍（略寬於路面）畫進模板緩衝
          const H = (f: number, s: number) => { const p = P(f, s); return [p[0], surf.groundY(p[0], p[2]) - 0.3, p[2]]; };
          quad(hole, H(f0, -hw - 0.3), H(f0, hw + 0.3), H(f1, hw + 0.3), H(f1, -hw - 0.3));
        }
      }
    }
  }
  const mesh = (pos: number[], mat: THREE.Material, order = 0) => {
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = order;
    scene.add(m);
    return m;
  };
  const D = THREE.DoubleSide;
  mesh(road, new THREE.MeshLambertMaterial({ color: '#34363b', side: D, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -10 }));
  // 隧道裡：照不到太陽，靠燈光（自發光）；車子開進去時 main 會把太陽、天空光調暗
  mesh(roadIn, new THREE.MeshLambertMaterial({ color: '#34363b', emissive: '#1d1c1a', side: D, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -10 }));
  mesh(wall, new THREE.MeshLambertMaterial({ color: '#8f8b83', emissive: '#5a554c', side: D }));
  mesh(ceil, new THREE.MeshLambertMaterial({ color: '#4e4f53', emissive: '#34312c', side: D }));
  mesh(parapet, new THREE.MeshLambertMaterial({ color: '#b3afa6', side: D }));
  mesh(lamp, new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false, side: D }));
  // 開洞：不畫顏色、不寫深度，只把模板設成 1；比地面先畫
  const holeMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: D });
  holeMat.stencilWrite = true;
  holeMat.stencilRef = 1;
  holeMat.stencilFunc = THREE.AlwaysStencilFunc;
  holeMat.stencilZPass = THREE.ReplaceStencilOp;
  mesh(hole, holeMat, -10);
  return hits;
}
