import * as THREE from 'three';
import { sedanGeo } from './models';
import { bakedShadowMaterial, blobTexture } from './world';

/** 車底柔邊影子（不用即時陰影也看得出車貼在地上） */
export function carBlob(w: number, l: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), bakedShadowMaterial(blobTexture()));
  m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

export interface CarModel {
  root: THREE.Group;
  body: THREE.Group; // 車身（會隨轉向微微側傾）
  steer: THREE.Group[]; // 前輪轉向
  spin: THREE.Mesh[]; // 四輪滾動
}

/** 低多邊形 F1 賽車：車頭朝 +z，長約 5.6 m */
export function makeCar(color: string, ghost = false): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mk = (c: string) => ghost
    ? new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.28, depthWrite: false })
    : new THREE.MeshStandardMaterial({ color: c, metalness: 0.35, roughness: 0.35 }); // 烤漆：會映出天空
  const paint = mk(color), white = mk('#f2f2f2'), carbon = mk('#1b1c20'), helmet = mk('#ffd400');

  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    body.add(mesh);
    return mesh;
  };
  box(0.9, 0.36, 4.0, paint, 0, 0.38, 0); // 車身
  box(1.7, 0.42, 1.8, paint, 0, 0.36, -0.5); // 側箱
  box(0.62, 0.55, 1.7, paint, 0, 0.7, -1.1); // 引擎蓋
  box(0.5, 0.26, 1.6, paint, 0, 0.32, 2.6); // 車鼻
  box(1.95, 0.06, 0.55, white, 0, 0.12, 3.3); // 前翼
  box(1.95, 0.05, 0.25, paint, 0, 0.2, 3.15);
  box(1.15, 0.06, 0.5, white, 0, 1.0, -2.25); // 尾翼
  box(1.15, 0.05, 0.3, paint, 0, 0.86, -2.3);
  for (const s of [-1, 1]) box(0.04, 0.6, 0.6, carbon, s * 0.57, 0.85, -2.25); // 尾翼端板
  box(0.12, 0.5, 0.12, carbon, 0, 0.75, -2.0); // 尾翼支架
  box(1.9, 0.1, 4.3, carbon, 0, 0.1, -0.2); // 底板
  box(0.06, 0.08, 0.8, carbon, 0, 0.9, 0.35); // halo
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), helmet);
  head.position.set(0, 0.78, 0.05);
  body.add(head);

  const steer: THREE.Group[] = [], spin: THREE.Mesh[] = [];
  const tyre = mk('#151515');
  const wheel = (x: number, z: number, r: number, w: number, front: boolean) => {
    const g = new THREE.Group();
    g.position.set(x, r, z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), tyre);
    g.add(m);
    root.add(g);
    spin.push(m);
    if (front) steer.push(g);
  };
  for (const s of [-1, 1]) {
    wheel(s * 0.86, 1.85, 0.36, 0.36, true);
    wheel(s * 0.84, -1.65, 0.37, 0.46, false);
  }
  return { root, body, steer, spin };
}

/** 一般轎車／計程車（玩家開的那台）：外型與車流共用 models.ts，車輪另外做才能轉向、滾動 */
export function makeSedan(color: string, taxi = false): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const g = sedanGeo({ taxi, noWheels: true });
  root.add(carBlob(2.5, 5.6));
  body.add(new THREE.Mesh(g.paint, new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.28 }))); // 烤漆：會映出天空
  body.add(new THREE.Mesh(g.fixed, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const steer: THREE.Group[] = [], spin: THREE.Mesh[] = [];
  const tyre = new THREE.MeshLambertMaterial({ color: '#151515' }), rim = new THREE.MeshLambertMaterial({ color: '#c4c8ce' });
  for (const [x, y, z, r] of g.wheels) {
    const w = new THREE.Group();
    w.position.set(x, y, z);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.24, 16).rotateZ(Math.PI / 2), tyre);
    // 輪框上加五根輻條，轉動時看得出來
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.03, 10).rotateZ(Math.PI / 2).translate(Math.sign(x) * 0.12, 0, 0), rim);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, r * 1.15, 0.06).translate(Math.sign(x) * 0.135, 0, 0), tyre);
      sp.rotation.x = (k / 5) * Math.PI;
      hub.add(sp);
    }
    t.add(hub);
    w.add(t);
    root.add(w);
    spin.push(t);
    if (z > 0) steer.push(w);
  }
  return { root, body, steer, spin };
}
