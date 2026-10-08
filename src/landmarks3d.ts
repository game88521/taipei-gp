import * as THREE from 'three';
import { terrainHeight, type Building, type Terrain } from './citydata';

// 有自己造型的地標：國父紀念館（黃琉璃瓦、飛簷、廊柱）、大巨蛋／小巨蛋（橢圓圓頂）、煙囪、
// 中正紀念堂、自由廣場牌樓、國家戲劇院／音樂廳、總統府、臺北車站、北門、東門／小南門、西門紅樓；
// 以及象山一帶的登山步道（沿地形鋪的石階與步道）、六巨石。OSM 只有外框，造型是照實景手工做的

const GROUND = -0.6;

/** 外框的主方向（最長邊）與在這個方向上的外接矩形：中心、半長、半寬、角度 */
function frame(p: number[]) {
  const n = p.length / 2;
  let bl = 0, ang = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1], l = Math.hypot(dx, dz);
    if (l > bl) { bl = l; ang = Math.atan2(dx, dz); }
  }
  const ux = Math.sin(ang), uz = Math.cos(ang), vx = uz, vz = -ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = p[i * 2] * ux + p[i * 2 + 1] * uz, v = p[i * 2] * vx + p[i * 2 + 1] * vz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { x: cu * ux + cv * vx, z: cu * uz + cv * vz, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2, ang };
}

/** 中式屋頂：從簷口往中間的屋脊升高，剖面內凹（簷口平、往上越陡），四個角往上翹（飛簷） */
function chineseRoof(w: number, d: number, h: number, lift: number, seg = 24): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d, seg, seg).rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // 屋脊長度：長邊方向留一段平的脊（廡殿頂），短邊收成一點
  const ridge = Math.max(0, (w - d) / 2) / (w / 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // 夾在 0~1：簷口的點因為浮點誤差可能算成 1.0000001，負數的 1.7 次方是 NaN，
    // NaN 經過光暈後處理會擴散成整個畫面全黑
    const sx = Math.min(1, Math.abs(x) / (w / 2)), sz = Math.min(1, Math.abs(z) / (d / 2));
    const ex = ridge < 1 ? Math.max(0, (sx - ridge) / (1 - ridge)) : 0;
    const m = Math.min(1, Math.max(ex, sz)); // 0 在屋脊、1 在簷口
    let y = h * Math.pow(1 - m, 1.7);
    y += lift * Math.pow(sx, 4) * Math.pow(sz, 4) * 2.5; // 角落起翹（平緩一點，不要像牛角）
    y += lift * 0.25 * Math.pow(m, 8); // 整圈簷口微微上揚
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

export function buildSpecial(b: Building): THREE.Object3D | null {
  const f = frame(b.p);
  const g = new THREE.Group();
  g.position.set(f.x, GROUND, f.z);
  g.rotation.y = f.ang; // 本地 z = 長邊方向、x = 短邊
  const L = f.hl * 2, W = f.hw * 2;
  const std = (color: string, metal = 0.1, rough = 0.6) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
  const lam = (color: string) => new THREE.MeshLambertMaterial({ color });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

  if (b.k === 'hall' || b.k === 'palace') {
    // 國父紀念館：石砌基座＋米白色牆＋灰色廊柱＋兩層黃琉璃瓦屋頂（大屋頂、飛簷）
    // 國家戲劇院／音樂廳（palace）：同樣的宮殿式，白色基座、紅牆紅柱、黃琉璃瓦
    const pal = b.k === 'palace';
    const base = pal ? 4 : 3, wallH = 15;
    add(new THREE.BoxGeometry(W + 8, base, L + 8), lam(pal ? '#e7e2d6' : '#c9c3b6'), 0, base / 2);
    add(new THREE.BoxGeometry(W + 14, 1.2, L + 14), lam(pal ? '#d6d0c2' : '#b9b3a6'), 0, 0.6); // 外圈台階
    const bw = W * 0.78, bl = L * 0.78;
    add(new THREE.BoxGeometry(bw, wallH, bl), lam(pal ? '#a3352b' : '#efe4cc'), 0, base + wallH / 2);
    // 廊柱：牆外一圈
    const colGeo = new THREE.CylinderGeometry(0.85, 0.95, wallH, 10), colMat = lam(pal ? '#b8362a' : '#bfb6a4');
    const cw = W * 0.45, cl = L * 0.45;
    const cols = new THREE.InstancedMesh(colGeo, colMat, 200);
    let n = 0;
    const m4 = new THREE.Matrix4();
    for (const s of [-1, 1]) {
      for (let t = -cw; t <= cw + 0.01; t += (cw * 2) / Math.max(1, Math.round((cw * 2) / 7.5))) { m4.makeTranslation(t, base + wallH / 2, s * cl); cols.setMatrixAt(n++, m4); }
      for (let t = -cl; t <= cl + 0.01; t += (cl * 2) / Math.max(1, Math.round((cl * 2) / 7.5))) { m4.makeTranslation(s * cw, base + wallH / 2, t); cols.setMatrixAt(n++, m4); }
    }
    cols.count = n;
    g.add(cols);
    // 屋頂：下層簷（大、翹）、中間的牆、上層簷
    const tile = std('#e3a62e', 0.15, 0.45), trim = lam('#7a2e1e');
    const y0 = base + wallH;
    add(new THREE.BoxGeometry(W * 0.98, 1.2, L * 0.98), trim, 0, y0 + 0.6); // 簷下的紅色斗拱帶
    const r1 = add(chineseRoof(W * 1.12, L * 1.12, 6, 1.6), tile, 0, y0 + 1.2);
    add(new THREE.BoxGeometry(W * 0.6, 4.5, L * 0.6), lam(pal ? '#a3352b' : '#efe4cc'), 0, y0 + 5);
    const r2 = add(chineseRoof(W * 0.8, L * 0.8, 9, 1.3), tile, 0, y0 + 7);
    for (const m of [r1, r2]) (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    return g;
  }

  // ---- 2026-10 往西擴的地標（造型照實景簡化；尺寸跟著 OSM 外框）
  // 東邊在本地的哪個方向：rotation.y = ang，本地 z → 世界 (sin, cos)、本地 x → 世界 (cos, −sin)；世界 x 朝東
  const east = (): ['x' | 'z', number] => (Math.abs(Math.cos(f.ang)) > Math.abs(Math.sin(f.ang)) ? ['x', Math.sign(Math.cos(f.ang))] : ['z', Math.sign(Math.sin(f.ang))]);
  const at = (axis: 'x' | 'z', d: number): [number, number] => (axis === 'x' ? [d, 0] : [0, d]);
  const oct = (rTop: number, rBot: number, h: number, mat: THREE.Material, y: number) => { const m = add(new THREE.CylinderGeometry(rTop, rBot, h, 8), mat, 0, y + h / 2); m.rotation.y = Math.PI / 8; return m; };
  const roofOf = (w: number, d: number, h: number, lift: number, mat: THREE.MeshStandardMaterial, y: number, x = 0, z = 0) => { mat.side = THREE.DoubleSide; return add(chineseRoof(w, d, h, lift), mat, x, y, z); };

  if (b.k === 'cks') {
    // 中正紀念堂：三層白色階梯平台、白色主殿、八角形兩層藍色琉璃瓦屋頂、金色寶頂（約 70 m）
    const S = Math.min(W, L), white = lam('#efeee8'), white2 = lam('#e2e0d8'), blue = std('#2450a4', 0.25, 0.35);
    add(new THREE.BoxGeometry(S * 0.92, 4, S * 0.92), white2, 0, 2);
    add(new THREE.BoxGeometry(S * 0.74, 4, S * 0.74), white, 0, 6);
    add(new THREE.BoxGeometry(S * 0.58, 4, S * 0.58), white2, 0, 10);
    add(new THREE.BoxGeometry(S * 0.44, 18, S * 0.44), white, 0, 21); // 主殿
    // 正面（朝西，自由廣場那側）的大階梯
    const [ax, sg] = east(), [sx, sz] = at(ax, -sg * S * 0.36);
    const stair = add(new THREE.BoxGeometry(ax === 'x' ? S * 0.16 : S * 0.2, 9, ax === 'x' ? S * 0.2 : S * 0.16), white2, sx, 4.5, sz);
    stair.rotation[ax === 'x' ? 'z' : 'x'] = sg * (ax === 'x' ? 0.5 : -0.5);
    add(new THREE.BoxGeometry(S * 0.47, 1.6, S * 0.47), lam('#c9a24a'), 0, 30.8); // 簷下金色帶
    oct(S * 0.24, S * 0.36, 6, blue, 31.6); // 下層藍瓦
    oct(S * 0.2, S * 0.2, 6, white, 37.6); // 八角鼓座
    oct(0.6, S * 0.26, 17, blue, 43.6); // 上層藍瓦（八角攢尖）
    add(new THREE.SphereGeometry(1.8, 12, 8), std('#e8c060', 0.8, 0.25), 0, 61.5); // 寶頂
    return g;
  }

  if (b.k === 'arch') {
    // 自由廣場牌樓：白色五開間、藍色琉璃瓦（中間最高），約 30 m
    const white = lam('#f1f0ea'), blue = std('#2450a4', 0.25, 0.35);
    const piers = 6, pw = L * 0.06;
    for (let k = 0; k < piers; k++) add(new THREE.BoxGeometry(W * 0.8, 18, pw), white, 0, 9, -L / 2 + pw / 2 + ((L - pw) * k) / (piers - 1));
    add(new THREE.BoxGeometry(W * 0.85, 5, L), white, 0, 20.5); // 橫樑
    add(new THREE.BoxGeometry(W * 0.75, 4, L * 0.3), white, 0, 25); // 中間抬高
    roofOf(W * 1.6, L * 0.32, 4, 1, blue, 27);
    roofOf(W * 1.5, L * 0.36, 3, 0.8, std('#2450a4', 0.25, 0.35), 23, 0, -L * 0.3);
    roofOf(W * 1.5, L * 0.36, 3, 0.8, std('#2450a4', 0.25, 0.35), 23, 0, L * 0.3);
    return g;
  }

  if (b.k === 'pres') {
    // 總統府：紅磚牆＋白色石材橫帶，正面（朝東）中央一座約 60 m 的塔樓
    const brick = lam('#a4452f'), stone = lam('#eee4d0');
    add(new THREE.BoxGeometry(W, 20, L), brick, 0, 10);
    for (const y of [0.6, 7, 13.5, 20]) add(new THREE.BoxGeometry(W + 0.6, 1, L + 0.6), stone, 0, y);
    const [ax, sg] = east(), D = ax === 'x' ? W : L, [tx, tz] = at(ax, sg * (D / 2 - 6));
    add(new THREE.BoxGeometry(14, 40, 14), brick, tx, 20, tz);
    for (const y of [28, 40]) add(new THREE.BoxGeometry(14.8, 1.2, 14.8), stone, tx, y, tz);
    add(new THREE.BoxGeometry(9, 10, 9), stone, tx, 45, tz);
    const cap = add(new THREE.ConeGeometry(6.4, 7, 4), lam('#5b6a6a'), tx, 53.5, tz);
    cap.rotation.y = Math.PI / 4;
    const [px, pz] = at(ax, sg * (D / 2 + 3));
    add(new THREE.BoxGeometry(ax === 'x' ? 7 : 26, 12, ax === 'x' ? 26 : 7), stone, px, 6, pz); // 正門門廊
    return g;
  }

  if (b.k === 'tms') {
    // 臺北車站：米色的大方盒子＋褐色琉璃瓦大屋頂，屋頂中間再疊一層
    const body = lam('#d9c9a6'), roof = std('#7b573a', 0.2, 0.5);
    add(new THREE.BoxGeometry(W, 22, L), body, 0, 11);
    for (const y of [6, 12, 18]) add(new THREE.BoxGeometry(W + 0.4, 2.2, L + 0.4), lam('#4b4a4c'), 0, y); // 一排排窗戶
    add(new THREE.BoxGeometry(W + 0.6, 1.4, L + 0.6), lam('#8a3a2a'), 0, 22.4);
    roofOf(W * 1.06, L * 1.06, 13, 2.2, roof, 23);
    add(new THREE.BoxGeometry(W * 0.36, 5, L * 0.36), body, 0, 34);
    roofOf(W * 0.46, L * 0.46, 9, 1.4, std('#7b573a', 0.2, 0.5), 36.5);
    return g;
  }

  if (b.k === 'ngate') {
    // 北門：碉堡式城門，灰色石砌基座＋拱門洞，上面磚牆小樓、深灰瓦歇山頂
    const sMat = lam('#8f8a80');
    add(new THREE.BoxGeometry(W, 7, L), sMat, 0, 3.5);
    add(new THREE.BoxGeometry(W * 0.32, 4.4, L + 0.3), lam('#1c1a18'), 0, 2.2); // 門洞
    add(new THREE.BoxGeometry(W * 0.84, 4.2, L * 0.84), lam('#c6bba6'), 0, 9.1);
    roofOf(W * 1.08, L * 1.08, 3.6, 0.7, std('#4b4e52', 0.1, 0.7), 11.2);
    return g;
  }

  if (b.k === 'gate') {
    // 東門、小南門：石砌城門上一座城樓（紅柱紅牆、雙層橘黃琉璃瓦）
    const sMat = lam('#9a9488');
    add(new THREE.BoxGeometry(W, 6.5, L), sMat, 0, 3.25);
    add(new THREE.BoxGeometry(W * 0.3, 4.2, L + 0.3), lam('#1c1a18'), 0, 2.1);
    add(new THREE.BoxGeometry(W * 0.62, 4.6, L * 0.62), lam('#a3352b'), 0, 8.8); // 城樓的牆
    const colGeo = new THREE.CylinderGeometry(0.28, 0.3, 4.6, 8), colMat = lam('#b8362a'), cols = new THREE.InstancedMesh(colGeo, colMat, 16);
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (let k = 0; k < 4; k++) for (const [x, z] of [[-1, -1 + k * 0.667], [1, -1 + k * 0.667], [-1 + k * 0.667, -1], [-1 + k * 0.667, 1]]) { if (n < 16) { m4.makeTranslation(x * W * 0.38, 8.8, z * L * 0.38); cols.setMatrixAt(n++, m4); } }
    g.add(cols);
    roofOf(W * 1.02, L * 1.02, 2.4, 0.8, std('#d98f2c', 0.15, 0.45), 11.1);
    add(new THREE.BoxGeometry(W * 0.5, 2, L * 0.5), lam('#a3352b'), 0, 14);
    roofOf(W * 0.72, L * 0.72, 3.4, 0.8, std('#d98f2c', 0.15, 0.45), 15);
    return g;
  }

  if (b.k === 'redhouse') {
    // 西門紅樓：前面的八角紅磚樓（白色橫帶、八角屋頂、頂上小塔），後面接十字樓
    const brick = lam('#a03c2b'), stone = lam('#eadfca'), dark = std('#3e3f44', 0.1, 0.7);
    const R = Math.min(W * 0.36, 14), zc = -L / 2 + R + 1;
    const o1 = oct(R, R, 10, brick, 0);
    o1.position.z = zc;
    for (const y of [0.5, 5, 10]) { const bnd = oct(R + 0.3, R + 0.3, 0.8, stone, y - 0.4); bnd.position.z = zc; }
    const o2 = oct(R * 0.25, R * 1.08, 4.5, dark, 10.4); o2.position.z = zc;
    const o3 = oct(R * 0.22, R * 0.22, 3, brick, 13.2); o3.position.z = zc;
    const o4 = oct(0.3, R * 0.3, 2.6, dark, 16.2); o4.position.z = zc;
    // 十字樓
    const zr = zc + R + (L - 2 * R - 2) / 2, lr = L - 2 * R - 2;
    add(new THREE.BoxGeometry(W * 0.5, 8, lr), brick, 0, 4, zr);
    add(new THREE.BoxGeometry(W * 0.9, 8, lr * 0.3), brick, 0, 4, zr);
    roofOf(W * 0.56, lr * 1.02, 3, 0, std('#3e3f44', 0.1, 0.7), 8, 0, zr);
    roofOf(W * 0.96, lr * 0.34, 3, 0, std('#3e3f44', 0.1, 0.7), 8, 0, zr);
    return g;
  }

  if (b.k === 'dome' || b.k === 'arena') {
    // 大巨蛋：低矮外牆＋銀灰色橢圓圓頂（OSM 的高度只標外牆）；小巨蛋：玻璃外牆＋比較平的殼狀屋頂
    const big = b.k === 'dome';
    const wallH = big ? 14 : 12, domeH = big ? 46 : 22;
    const wallMat = big ? lam('#d6dade') : std('#8fa9bd', 0.3, 0.25);
    const wall = add(new THREE.CylinderGeometry(1, 1.04, wallH, 72, 1, true), wallMat, 0, wallH / 2);
    wall.scale.set(f.hw, 1, f.hl);
    (wall.material as THREE.Material).side = THREE.DoubleSide;
    // 外牆上的橫帶（樓層）
    for (let k = 1; k < 3; k++) {
      const band = add(new THREE.CylinderGeometry(1.012, 1.012, 0.6, 72, 1, true), lam('#5e6670'), 0, (wallH * k) / 3);
      band.scale.set(f.hw, 1, f.hl);
    }
    const domeMat = std(big ? '#e4e8ec' : '#cfd6dc', 0.55, 0.3);
    const dome = add(new THREE.SphereGeometry(1, 64, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, 0, wallH);
    dome.scale.set(f.hw * 1.02, domeH, f.hl * 1.02);
    // 屋頂的骨架線
    const ribs = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1.004, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2)), new THREE.LineBasicMaterial({ color: '#8d969f' }));
    ribs.position.y = wallH;
    ribs.scale.set(f.hw * 1.02, domeH, f.hl * 1.02);
    g.add(ribs);
    return g;
  }

  if (b.k === 'chimney') {
    // 紅磚煙囪：底寬上窄，頂端兩道白環
    const r0 = Math.min(3.2, Math.max(1.6, Math.min(f.hl, f.hw))), h = b.h;
    add(new THREE.CylinderGeometry(r0 * 0.62, r0, h, 20), lam('#9a4632'), 0, h / 2);
    for (const y of [h - 2, h - 6]) add(new THREE.CylinderGeometry(r0 * 0.66, r0 * 0.66, 1, 20), lam('#ecebe6'), 0, y);
    add(new THREE.CylinderGeometry(r0 * 0.7, r0 * 0.66, 0.8, 20), lam('#3b3b3b'), 0, h + 0.4);
    return g;
  }
  return null;
}

/** 登山步道：沿著地形鋪一條 1.8 m 寬的帶子；石階一階一階深淺交錯，步道是石板色 */
export function buildTrails(trails: { p: number[]; s: number }[], t: Terrain, rocks: number[]): THREE.Object3D {
  const g = new THREE.Group();
  const pos: number[] = [], col: number[] = [];
  const stepA = new THREE.Color('#b4ad9f'), stepB = new THREE.Color('#7f786c'), path = new THREE.Color('#a39886'), edge = new THREE.Color('#6e6a5f');
  const HW = 0.9;
  const yAt = (x: number, z: number) => terrainHeight(t, x, z) + GROUND + 0.12;
  for (const tr of trails) {
    const p = tr.p;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.1) continue;
      const nx = -(bz - az) / l * HW, nz = (bx - ax) / l * HW;
      const stepLen = tr.s ? 0.45 : 2;
      const n = Math.max(1, Math.ceil(l / stepLen));
      for (let i = 0; i < n; i++) {
        const f0 = i / n, f1 = (i + 1) / n;
        const x0 = ax + (bx - ax) * f0, z0 = az + (bz - az) * f0, x1 = ax + (bx - ax) * f1, z1 = az + (bz - az) * f1;
        const y0 = yAt(x0, z0), y1 = yAt(x1, z1);
        if (y0 < GROUND + 0.6 && y1 < GROUND + 0.6) continue; // 平地的部分不鋪（城裡有自己的路面）
        const c = tr.s ? (i % 2 ? stepA : stepB) : path;
        const P = [[x0 - nx, y0, z0 - nz], [x0 + nx, y0, z0 + nz], [x1 + nx, y1, z1 + nz], [x1 - nx, y1, z1 - nz]];
        pos.push(...P[0], ...P[2], ...P[1], ...P[0], ...P[3], ...P[2]);
        for (let q = 0; q < 6; q++) col.push(c.r, c.g, c.b);
        // 兩側的矮邊（深色），從側面看得出是一條步道
        for (const s of [-1, 1]) {
          const e0 = s < 0 ? P[0] : P[1], e1 = s < 0 ? P[3] : P[2];
          const up0 = [e0[0], e0[1] + 0.18, e0[2]], up1 = [e1[0], e1[1] + 0.18, e1[2]];
          pos.push(...e0, ...e1, ...up1, ...e0, ...up1, ...up0);
          for (let q = 0; q < 6; q++) col.push(edge.r, edge.g, edge.b);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));

  // 六巨石：觀景平台旁六顆大石頭（打亂頂點的二十面體），旁邊一塊木平台
  const rockMat = new THREE.MeshLambertMaterial({ color: '#a39d92', flatShading: true });
  for (let k = 0; k + 1 < rocks.length; k += 2) {
    const cx = rocks[k], cz = rocks[k + 1];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd() * 0.5, d = 7 + rnd() * 6;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const geo2 = new THREE.IcosahedronGeometry(1, 1);
      const pa = geo2.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pa.count; v++) pa.setXYZ(v, pa.getX(v) * (0.8 + rnd() * 0.4), pa.getY(v) * (0.8 + rnd() * 0.4), pa.getZ(v) * (0.8 + rnd() * 0.4));
      geo2.computeVertexNormals();
      const m = new THREE.Mesh(geo2, rockMat);
      const s = 3.5 + rnd() * 2.5;
      m.scale.set(s, s * (1.1 + rnd() * 0.6), s * (0.8 + rnd() * 0.4));
      m.rotation.set(rnd() * 0.4, rnd() * 6, rnd() * 0.4);
      m.position.set(x, terrainHeight(t, x, z) + GROUND + s * 0.6, z);
      g.add(m);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 6), new THREE.MeshLambertMaterial({ color: '#8a5d3b' }));
    deck.position.set(cx, terrainHeight(t, cx, cz) + GROUND + 0.5, cz);
    g.add(deck);
  }
  return g;
}
