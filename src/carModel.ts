import * as THREE from 'three';

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
    : new THREE.MeshLambertMaterial({ color: c });
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

/** 一般轎車／計程車：車頭朝 +z，長約 4.6 m */
export function makeSedan(color: string, taxi = false): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: '#1d2733' });
  const trim = new THREE.MeshLambertMaterial({ color: '#222326' });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    body.add(mesh);
    return mesh;
  };
  box(1.8, 0.62, 4.5, paint, 0, 0.62, 0); // 下車身
  box(1.62, 0.5, 2.3, paint, 0, 1.18, -0.25); // 車頂
  box(1.64, 0.4, 2.1, glass, 0, 1.15, -0.25); // 車窗（比車頂寬一點點，看起來是一圈玻璃）
  box(1.84, 0.18, 4.56, trim, 0, 0.36, 0); // 下緣保險桿
  const head = new THREE.MeshBasicMaterial({ color: '#fff6d8', toneMapped: false });
  const tail = new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false });
  for (const s of [-1, 1]) {
    box(0.42, 0.14, 0.05, head, s * 0.62, 0.72, 2.26);
    box(0.36, 0.14, 0.05, tail, s * 0.66, 0.76, -2.26);
  }
  if (taxi) {
    box(0.7, 0.22, 0.32, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#555544' }), 0, 1.55, -0.1);
  }
  const steer: THREE.Group[] = [], spin: THREE.Mesh[] = [];
  const tyre = new THREE.MeshLambertMaterial({ color: '#151515' });
  for (const s of [-1, 1]) for (const z of [1.45, -1.45]) {
    const g = new THREE.Group();
    g.position.set(s * 0.82, 0.33, z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.26, 12).rotateZ(Math.PI / 2), tyre);
    g.add(m);
    root.add(g);
    spin.push(m);
    if (z > 0) steer.push(g);
  }
  return { root, body, steer, spin };
}
