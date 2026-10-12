import * as THREE from 'three';
import { WALL_OFF, type Track } from './track';
import { fillerMaterial, WALLS } from './filler';
import { canvasTex } from './world';
import type { CircuitMeta } from './circuits';

// 各國賽道的通用場景（不載入真實街景）：草地／沙漠的地面、主看台與彎道看台、維修區建築、
// 樹林（熱帶是棕櫚樹）或街道賽的城市方塊、夜賽的照明燈柱與路面光圈。都離賽道中心線夠遠，不會擋到車

function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

export function buildCircuitEnv(scene: THREE.Scene, t: Track, meta: CircuitMeta, ground: THREE.Mesh) {
  const r = rng(meta.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483647 || 1);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < t.N; i++) { x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]); z0 = Math.min(z0, t.pz[i]); z1 = Math.max(z1, t.pz[i]); }
  // 離賽道多遠：賽道點的格子
  const G = 40, grid = new Map<string, number[]>();
  for (let i = 0; i < t.N; i += 2) {
    const k = `${Math.floor(t.px[i] / G)},${Math.floor(t.pz[i] / G)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  }
  // 地形高度：附近賽道點的高度做距離加權平均（離賽道越遠越接近整條的平均高度）；
  // 賽道 40 m 內一律壓在路面下 1 m（地形的三角形才不會穿出路面）
  let mean = 0;
  for (let i = 0; i < t.N; i++) mean += t.py[i] / t.N;
  const hAt = (x: number, z: number) => {
    const cx = Math.floor(x / G), cz = Math.floor(z / G), R = 7;
    let w = 0.0004, h = mean * 0.0004, nd = Infinity, ny = 0;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const i of grid.get(`${cx + a},${cz + b}`) || []) {
      const d2 = (t.px[i] - x) ** 2 + (t.pz[i] - z) ** 2, k = 1 / (d2 + 400);
      w += k; h += t.py[i] * k;
      if (d2 < nd) { nd = d2; ny = t.py[i]; }
    }
    h /= w;
    return Math.sqrt(nd) < WALL_OFF + 40 ? Math.min(h, ny - 1) : h;
  };
  // 地面：顏色照環境、蓋住整條賽道再往外 3 km；有高低起伏
  const groundCol = { grass: '#5f8a45', tropical: '#4f8a3e', desert: '#c9ad7d', street: '#6d6b67' }[meta.biome];
  ground.visible = false;
  const W = x1 - x0 + 6000, D = z1 - z0 + 6000, SEG = 180;
  const tg = new THREE.PlaneGeometry(W, D, SEG, SEG).rotateX(-Math.PI / 2);
  const tp = tg.attributes.position as THREE.BufferAttribute, gx = (x0 + x1) / 2, gz = (z0 + z1) / 2;
  for (let v = 0; v < tp.count; v++) tp.setY(v, hAt(tp.getX(v) + gx, tp.getZ(v) + gz) - 0.6);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: groundCol }));
  terrain.position.set(gx, 0, gz);
  terrain.userData.flat = true;
  scene.add(terrain);
  const clear = (x: number, z: number, d: number) => {
    const cx = Math.floor(x / G), cz = Math.floor(z / G), R = Math.ceil(d / G);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const i of grid.get(`${cx + a},${cz + b}`) || []) if ((t.px[i] - x) ** 2 + (t.pz[i] - z) ** 2 < d * d) return false;
    return true;
  };
  const at = (s: number) => { const i = ((Math.round(s / t.ds) % t.N) + t.N) % t.N; return i; };
  const side = (i: number, lat: number): [number, number] => [t.px[i] - t.tz[i] * lat, t.pz[i] + t.tx[i] * lat];

  // ---- 看台：沿著賽道一段一段的階梯（觀眾是一格一格的彩色點點）
  const crowd = canvasTex(256, 64, (g) => {
    g.fillStyle = '#2a2d36'; g.fillRect(0, 0, 256, 64);
    const C = ['#e10600', '#ffffff', '#ffd400', '#2f6cff', '#ff8a00', '#2fbf6c', '#ff6fa8', '#202020'];
    for (let y = 4; y < 64; y += 8) for (let x = 2; x < 256; x += 5) { g.fillStyle = C[Math.floor(Math.random() * C.length)]; g.fillRect(x + (y % 16 ? 2 : 0), y, 3, 4); }
  });
  const crowdMat = new THREE.MeshLambertMaterial({ map: crowd }), standMat = new THREE.MeshLambertMaterial({ color: '#c8ccd2' }), roofMat = new THREE.MeshLambertMaterial({ color: '#3a3f48' });
  const stand = (s0: number, s1: number, sideSign: number) => {
    const g = new THREE.Group();
    for (let s = s0; s < s1; s += 12) {
      const i = at(s), j = at(s + 12);
      const [ax, az] = side(i, sideSign * (WALL_OFF + 6)), [bx, bz] = side(j, sideSign * (WALL_OFF + 6));
      const len = Math.hypot(bx - ax, bz - az) + 0.5, ang = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k < 4; k++) { // 四階，越往外越高
        const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6 + k * 1.6, len), k === 3 ? standMat : [standMat, standMat, crowdMat, standMat, standMat, standMat]);
        const off = sideSign * (WALL_OFF + 6 + k * 2.6);
        const [mx, mz] = side(at(s + 6), off);
        step.position.set(mx, (1.6 + k * 1.6) / 2 - 0.6 + t.py[at(s + 6)], mz);
        step.rotation.y = ang;
        g.add(step);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, len), roofMat);
      const [rx, rz] = side(at(s + 6), sideSign * (WALL_OFF + 10));
      roof.position.set(rx, 10.5 + t.py[at(s + 6)], rz);
      roof.rotation.y = ang;
      g.add(roof);
    }
    scene.add(g);
  };
  // 主看台：起跑線前後、維修區的對面（維修區在右側）
  stand(-160, 160, -1);
  // 彎道看台：最急的三個彎的外側
  const corners: number[] = [];
  const order = [...Array(t.N).keys()].sort((a, b) => Math.abs(t.curv[b]) - Math.abs(t.curv[a]));
  for (const i of order) { if (corners.length >= 3) break; if (corners.every((c) => Math.abs(c - i) > 120 && Math.abs(c - i) < t.N - 120)) corners.push(i); }
  for (const i of corners) stand(i * t.ds - 50, i * t.ds + 50, t.curv[i] > 0 ? -1 : 1);

  // ---- 維修區建築：起跑線旁、右側（跟 AI 進站那側一樣）
  const pitTex = canvasTex(256, 64, (g) => {
    g.fillStyle = '#eceef1'; g.fillRect(0, 0, 256, 64);
    for (let x = 6; x < 256; x += 32) { g.fillStyle = '#23262d'; g.fillRect(x, 22, 24, 42); g.fillStyle = '#e10600'; g.fillRect(x, 16, 24, 4); }
    g.fillStyle = '#9fd0ff'; g.fillRect(0, 2, 256, 10);
  });
  pitTex.wrapS = THREE.RepeatWrapping;
  const pitMat = new THREE.MeshLambertMaterial({ map: pitTex, color: '#b9bcc2' }), white = new THREE.MeshLambertMaterial({ color: '#a9adb4' }); // 灰一點：白牆在白天加光暈會過曝
  for (let s = -120; s < 120; s += 12) {
    const i = at(s), j = at(s + 12);
    const [ax, az] = side(i, WALL_OFF + 12), [bx, bz] = side(j, WALL_OFF + 12);
    const len = Math.hypot(bx - ax, bz - az) + 0.4;
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 9, len), [white, white, white, white, white, pitMat]);
    const [mx, mz] = side(at(s + 6), WALL_OFF + 12);
    box.position.set(mx, 3.9 + t.py[at(s + 6)], mz);
    box.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI; // 有車庫門那面朝賽道
    scene.add(box);
  }

  // ---- 周圍：樹林，或街道賽的城市方塊
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  if (meta.biome === 'street') {
    const boxes: number[][] = [];
    for (let s = 0; s < t.length; s += 22) for (const sg of [-1, 1]) {
      if (r() < 0.25) continue;
      const lat = sg * (WALL_OFF + 14 + r() * 40), i = at(s);
      const [x, z] = side(i, lat), w = 14 + r() * 18, d = 14 + r() * 18;
      if (!clear(x, z, WALL_OFF + 4 + Math.max(w, d) * 0.72)) continue;
      boxes.push([x, z, w, d, 12 + r() * (meta.id === 'lasvegas' || meta.id === 'singapore' ? 110 : 45), Math.atan2(t.tx[i], t.tz[i])]);
    }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), fillerMaterial(), Math.max(1, boxes.length));
    boxes.forEach(([x, z, w, d, h, a], k) => {
      Q.setFromAxisAngle(up, a);
      im.setMatrixAt(k, M.compose(V.set(x, hAt(x, z) - 0.6, z), Q, S.set(w, h, d)));
      im.setColorAt(k, WALLS[k % WALLS.length]);
    });
    im.count = boxes.length;
    im.computeBoundingSphere();
    scene.add(im);
  }
  const nTrees = { grass: 2200, tropical: 1800, desert: 260, street: 500 }[meta.biome];
  const palm = meta.biome === 'tropical' || meta.biome === 'desert';
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(palm ? 0.18 : 0.25, palm ? 0.26 : 0.35, palm ? 7 : 3, 6).translate(0, palm ? 3.5 : 1.5, 0), new THREE.MeshLambertMaterial({ color: palm ? '#7a6248' : '#5a4636' }), nTrees);
  const crown = new THREE.InstancedMesh(palm ? new THREE.ConeGeometry(2.6, 1.4, 7).translate(0, 7.4, 0) : new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.6, 0), new THREE.MeshLambertMaterial({ flatShading: true }), nTrees);
  const leaf = (palm ? ['#3f7a3a', '#4f8a3e', '#5c8f45'] : ['#3e6b35', '#4a7a3a', '#355f30', '#5b8a45']).map((c) => new THREE.Color(c));
  let n = 0;
  for (let tries = 0; n < nTrees && tries < nTrees * 6; tries++) {
    const x = x0 - 500 + r() * (x1 - x0 + 1000), z = z0 - 500 + r() * (z1 - z0 + 1000);
    if (!clear(x, z, WALL_OFF + 16)) continue;
    const k = 0.8 + r() * 0.7;
    Q.setFromAxisAngle(up, r() * 6.28);
    M.compose(V.set(x, hAt(x, z) - 0.6, z), Q, S.set(k, k, k));
    trunk.setMatrixAt(n, M); crown.setMatrixAt(n, M);
    crown.setColorAt(n, leaf[n % leaf.length]);
    n++;
  }
  trunk.count = crown.count = n;
  trunk.computeBoundingSphere(); crown.computeBoundingSphere();
  scene.add(trunk, crown);

  // ---- 夜賽、黃昏賽：照明燈柱（燈頭會亮）＋晚上照在路面上的光圈
  if (meta.time === 'night' || meta.time === 'dusk') {
    const nL = Math.floor(t.length / 60);
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 18, 6).translate(0, 9 - 0.6, 0), new THREE.MeshLambertMaterial({ color: '#5d6168' }), nL);
    const headMat = new THREE.MeshBasicMaterial({ color: '#fff4dc', toneMapped: false });
    headMat.userData.lamp = true; // 白天熄、晚上亮（weather.ts）
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.6, 1.2).translate(0, 17.6, 0), headMat, nL);
    const poolTex = canvasTex(64, 64, (g) => {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,240,210,0.6)'); grd.addColorStop(0.6, 'rgba(255,230,190,0.18)'); grd.addColorStop(1, 'rgba(255,220,180,0)');
      g.clearRect(0, 0, 64, 64); g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    }, false);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI / 2).translate(0, 0.03, 0), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), nL);
    pool.userData.nightOnly = true;
    pool.visible = false;
    for (let k = 0; k < nL; k++) {
      const i = at(k * 60), sg = k % 2 ? 1 : -1;
      const [x, z] = side(i, sg * (WALL_OFF + 4));
      Q.setFromAxisAngle(up, Math.atan2(t.tx[i], t.tz[i]));
      M.compose(V.set(x, t.py[i], z), Q, S.set(1, 1, 1));
      pole.setMatrixAt(k, M); head.setMatrixAt(k, M);
      M.compose(V.set(t.px[i], t.py[i], t.pz[i]), Q, S.set(1, 1, 1));
      pool.setMatrixAt(k, M);
    }
    for (const m of [pole, head, pool]) { m.computeBoundingSphere(); scene.add(m); }
  }
  return { center: new THREE.Vector3((x0 + x1) / 2, mean, (z0 + z1) / 2), extent: Math.max(x1 - x0, z1 - z0) };
}
