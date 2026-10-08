import * as THREE from 'three';
import { Grid, distSeg, type CityData } from './citydata';

// 行人徒步區（西門町的徒步街、各地的廣場）：鋪石板；查「這個點在不在徒步區裡」（main 用來提醒、讓路人瞪你）
// 行人在徒步街上走的路線在 peds.ts（一條街好幾排，人潮比一般人行道多）

type Zone = { nm?: string; seg?: [number, number, number, number, number]; poly?: number[]; bb?: [number, number, number, number] };

function stoneTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfc6b8';
  g.fillRect(0, 0, 128, 128);
  // 石板：深淺不一的方塊、細縫
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 190 + ((x * 7 + y * 13) % 5) * 7;
    g.fillStyle = `rgb(${v},${v - 8},${v - 18})`;
    g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
  }
  return new THREE.CanvasTexture(c);
}

const inPoly = (p: number[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

export class PedZones {
  private grid = new Grid<Zone>(25);
  private tmp: Zone[] = [];
  count = 0;

  constructor(scene: THREE.Scene, d: CityData) {
    const pos: number[] = [], uv: number[] = [];
    const Y = -0.27, T = 4; // 比車道低一點（路口車道蓋在上面）、比綠地高；石板貼圖每 4 m 重複
    const v = (x: number, z: number) => { pos.push(x, Y, z); uv.push(x / T, z / T); };
    for (const zn of d.pedzones ?? []) {
      const p = zn.p;
      if (zn.w > 0) {
        // 街道：每一段畫一條帶子
        for (let k = 0; k + 3 < p.length; k += 2) {
          const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], l = Math.hypot(bx - ax, bz - az);
          if (l < 0.3) continue;
          const nx = (-(bz - az) / l) * (zn.w / 2), nz = ((bx - ax) / l) * (zn.w / 2);
          v(ax + nx, az + nz); v(bx - nx, bz - nz); v(bx + nx, bz + nz);
          v(ax + nx, az + nz); v(ax - nx, az - nz); v(bx - nx, bz - nz);
          const seg: [number, number, number, number, number] = [ax, az, bx, bz, zn.w / 2 + 1];
          this.grid.addBox(Math.min(ax, bx) - zn.w, Math.min(az, bz) - zn.w, Math.max(ax, bx) + zn.w, Math.max(az, bz) + zn.w, { nm: zn.nm, seg });
        }
      } else {
        // 廣場：一整塊面
        const pts = [];
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let k = 0; k < p.length; k += 2) { pts.push(new THREE.Vector2(p[k], p[k + 1])); x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
        try {
          for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts, [])) {
            // 正面朝上：(b-a) × (c-a) 的 y 分量要是正的
            const cy = (pts[c].x - pts[a].x) * (pts[b].y - pts[a].y) - (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y);
            const [q, r] = cy > 0 ? [b, c] : [c, b];
            v(pts[a].x, pts[a].y); v(pts[q].x, pts[q].y); v(pts[r].x, pts[r].y);
          }
        } catch { continue; }
        this.grid.addBox(x0, z0, x1, z1, { nm: zn.nm, poly: p, bb: [x0, z0, x1, z1] });
      }
      this.count++;
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const tex = stoneTex();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 }));
    mesh.userData.flat = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  /** 這個點在哪個徒步區裡（不在就是 null） */
  at(x: number, z: number): Zone | null {
    for (const zn of this.grid.query(x, z, 0, this.tmp)) {
      if (zn.seg) { const [ax, az, bx, bz, r] = zn.seg; if (distSeg(x, z, ax, az, bx, bz) < r) return zn; }
      else if (zn.poly && zn.bb && x >= zn.bb[0] && x <= zn.bb[2] && z >= zn.bb[1] && z <= zn.bb[3] && inPoly(zn.poly, x, z)) return zn;
    }
    return null;
  }
}
