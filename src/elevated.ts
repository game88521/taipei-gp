import * as THREE from 'three';
import { Grid, type CityData } from './citydata';
import { bakedShadowMaterial, canvasTex, SHADOW_PER_M } from './world';
import { lanesOf, roadTexture } from './decor';
import { ROAD_Y, type Surface } from './surface';

// 高架道路（建國高架、市民大道高架…）、信義區人行空橋、捷運文湖線高架與月台、地下道入口。
// 車道的高架照路網（net.decks）畫：橋面就是能開的路面（surface.ts），護欄跟物理用同一份（分岔、匯入處有開口）；
// 人行空橋、文湖線照 elevated 畫，只是外型。橋墩只擋橋下的車（回傳給 Collider，帶高度範圍）。
// 橋面：跟地面道路同一套標線貼圖（decor.roadTexture）、每 28 m 一道伸縮縫；主線離地 6 m 以上裝透明隔音牆、
// 每 36 m 一支路燈；橋墩頂掛一盞往下照的燈（晚上橋下才不會一片黑）

const GROUND = -0.6;
/** posts：[x, z, 半徑, 擋車的最高高度（橋下）]；walls：護欄 [x1, z1, x2, z2, 擋車的最低, 最高] */
export interface ElevatedHits { posts: [number, number, number, number?][]; walls: [number, number, number, number, number, number][] }

/** 一條四邊形加進頂點陣列（a b c d 逆時針） */
function quad(pos: number[], a: number[], b: number[], c: number[], d: number[]) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); }

export function buildElevated(scene: THREE.Scene, d: CityData, surf?: Surface): ElevatedHits {
  const hits: ElevatedHits = { posts: [], walls: [] };
  const els = d.elevated ?? [];
  const deck: number[] = [], concrete: number[] = [], rail: number[] = [], walk: number[] = [], glass: number[] = [], roof: number[] = [], shadow: number[] = [];
  const pillars: THREE.Matrix4[] = [], columns: THREE.Matrix4[] = [];
  const decks = new Map<string, { pos: number[]; uv: number[]; tex: () => THREE.Texture }>(); // 橋面依「單雙向-車道數」分組，各一張標線貼圖
  const joint: number[] = [], barrier: number[] = [], frame: number[] = [];
  const lampsAt: THREE.Matrix4[] = [], underAt: THREE.Matrix4[] = [];
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
  // ---- 車道的高架：照路網畫（橋面 = 路面高度，含 −0.25）
  if (surf) {
    const NN = d.net.nodes, NY = d.net.y ?? [];
    for (const w of d.net.decks ?? []) {
      if (w.e !== 1) continue;
      const hw = w.w / 2, thick = 1.4, spacing = 28;
      let carry = spacing / 2;
      const lanes = Math.min(6, lanesOf(w)), key = `${w.o ? 1 : 2}-${lanes}`;
      if (!decks.has(key)) decks.set(key, { pos: [], uv: [], tex: () => roadTexture(!w.o, lanes, true) });
      const dg = decks.get(key)!;
      const main = w.w >= 9 && w.c <= 1; // 主線（匝道窄，不裝路燈、隔音牆）
      let along = 0, lampCarry = 18, lampSide = 1;
      for (let i = 0; i + 1 < w.n.length; i++) {
        const a = w.n[i], b = w.n[i + 1];
        const ax = NN[a * 2], az = NN[a * 2 + 1], bx = NN[b * 2], bz = NN[b * 2 + 1], ya = (NY[a] ?? 0) + ROAD_Y, yb = (NY[b] ?? 0) + ROAD_Y;
        const l = Math.hypot(bx - ax, bz - az);
        if (l < 0.2) continue;
        const ux = (bx - ax) / l, uz = (bz - az) / l, nx = -uz * hw, nz = ux * hw;
        const ex0 = i === 0 ? 0 : Math.min(1.5, hw * 0.4), ex1 = i + 2 === w.n.length ? 0 : Math.min(1.5, hw * 0.4);
        const x0 = ax - ux * ex0, z0 = az - uz * ex0, x1 = bx + ux * ex1, z1 = bz + uz * ex1;
        const L0 = [x0 - nx, ya, z0 - nz], R0 = [x0 + nx, ya, z0 + nz], L1 = [x1 - nx, yb, z1 - nz], R1 = [x1 + nx, yb, z1 + nz];
        const lo = (p: number[]) => [p[0], p[1] - thick, p[2]];
        // 橋面：u 橫跨路寬（0 左、1 右）、v 沿路每 12 m 一輪（跟地面道路一樣的標線）
        const v0 = (along - ex0) / 12, v1 = (along + l + ex1) / 12;
        dg.pos.push(...L0, ...R0, ...R1, ...L0, ...R1, ...L1);
        dg.uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
        along += l;
        quad(concrete, lo(L0), lo(L1), lo(R1), lo(R0));
        quad(concrete, lo(R0), lo(R1), R1, R0);
        quad(concrete, lo(L1), lo(L0), L0, L1);
        const gA = surf.groundY(ax, az), gB = surf.groundY(bx, bz);
        const sh = (x: number, z: number, y: number) => [x + SHADOW_PER_M.x * Math.min(y, 30), 0.03, z + SHADOW_PER_M.z * Math.min(y, 30)];
        if (ya - gA > 2 || yb - gB > 2) quad(shadow, sh(L0[0], L0[2], ya - gA), sh(L1[0], L1[2], yb - gB), sh(R1[0], R1[2], yb - gB), sh(R0[0], R0[2], ya - gA));
        // 橋墩：每 28 m 一支（離地 4.5 m 以上才有）；只擋橋下的車（擋到橋底為止）
        let t = carry;
        for (; t < l; t += spacing) {
          const f = t / l, y = ya + (yb - ya) * f, gy = surf.groundY(ax + ux * t, az + uz * t);
          if (y - gy < 4.5) continue;
          // 伸縮縫：橫跨橋面一條 30 cm 的鋼板（每跨一道，跟橋墩對齊）
          const jx = ax + ux * t, jz = az + uz * t, jy = y + 0.012, ox = -uz * (hw - 0.1), oz = ux * (hw - 0.1);
          quad(joint, [jx - ox - ux * 0.15, jy, jz - oz - uz * 0.15], [jx + ox - ux * 0.15, jy, jz + oz - uz * 0.15], [jx + ox + ux * 0.15, jy, jz + oz + uz * 0.15], [jx - ox + ux * 0.15, jy, jz - oz + uz * 0.15]);
          const at = placePillar(ax + ux * t, az + uz * t);
          if (!at) continue;
          const [px, pz] = at;
          if (surf.deckBelow(px, pz, y - thick, 1.2)) continue; // 下面還有一層匝道：不能立在它的車道上
          q.setFromAxisAngle(up, Math.atan2(ux, uz));
          const top = y - thick, foot = gy + ROAD_Y - 0.35;
          pillars.push(new THREE.Matrix4().compose(v.set(px, foot, pz), q, s.set(1.8, top - foot, 1.6)));
          hits.posts.push([px, pz, 1.0, top]);
          underAt.push(new THREE.Matrix4().compose(v.set(px, top, pz), q, s.set(1, (top - foot - 0.4) / 7, 1))); // 橋下的燈：y 縮放 = 橋底到地面路面的距離 ÷ 7（光圈落在路面上）
        }
        carry = t - l;
        // 橋上路燈：主線每 36 m 一支，單行道裝右側、雙向道兩側輪流；燈臂伸向路中間
        if (main) {
          let tl = lampCarry;
          for (; tl < l; tl += 36) {
            const f = tl / l, y = ya + (yb - ya) * f, gy = surf.groundY(ax + ux * tl, az + uz * tl);
            if (y - gy < 4.5) continue;
            const sd = w.o ? 1 : (lampSide = -lampSide);
            const px = ax + ux * tl - uz * sd * (hw - 0.15), pz = az + uz * tl + ux * sd * (hw - 0.15);
            q.setFromAxisAngle(up, Math.atan2(-(-uz * sd), -(ux * sd))); // 燈臂（本地 +z）朝路中間
            lampsAt.push(new THREE.Matrix4().compose(v.set(px, y + 1.0, pz), q, s.set(1, 1, 1)));
          }
          lampCarry = tl - l;
        }
      }
    }
    // 護欄（外觀與碰撞同一份，surface.ts 算好開口）
    const H = 1.0;
    for (const r of surf.rails) {
      if (r.e !== 1) continue;
      const a0 = [r.x1, r.ya, r.z1], a1 = [r.x2, r.yb, r.z2], b1 = [r.x2, r.yb + H, r.z2], b0 = [r.x1, r.ya + H, r.z1];
      quad(concrete, a0, a1, b1, b0);
      hits.walls.push([r.x1, r.z1, r.x2, r.z2, r.y1, r.y2]);
      // 隔音牆：主線離地 6 m 以上，護欄上面再 2.2 m 透明板＋頂框（台北的高架經過住宅區幾乎都有）
      if (r.way.w >= 9 && r.way.c <= 1 && Math.min(r.ya - surf.groundY(r.x1, r.z1), r.yb - surf.groundY(r.x2, r.z2)) > 6) {
        const B = 2.2, up0 = [r.x1, r.ya + H + B, r.z1], up1 = [r.x2, r.yb + H + B, r.z2];
        quad(barrier, b0, b1, up1, up0);
        quad(frame, [r.x1, r.ya + H + B - 0.14, r.z1], [r.x2, r.yb + H + B - 0.14, r.z2], up1, up0);
      }
    }
  }
  for (const e of els) {
    if (surf && e.k === 0) continue; // 車道的高架上面已經照路網畫了
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
      if (e.k === 0 && Math.max(ya, yb) < 4.5 && Math.min(ya, yb) > 0.4) for (const sd of [-1, 1]) hits.walls.push([ax + nx * sd, az + nz * sd, bx + nx * sd, bz + nz * sd, -10, 4.5]);
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
  for (const g of decks.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const tex = g.tex();
    tex.anisotropy = 8;
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: D });
    mat.userData.road = true; // 下雨時一樣會濕（weather.ts）
    scene.add(new THREE.Mesh(geo, mat));
  }
  mesh(joint, new THREE.MeshLambertMaterial({ color: '#2b2c30', side: D, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -20 }));
  mesh(barrier, new THREE.MeshStandardMaterial({ color: '#b9e2da', metalness: 0.1, roughness: 0.15, transparent: true, opacity: 0.3, side: D, depthWrite: false }));
  mesh(frame, new THREE.MeshLambertMaterial({ color: '#7d8389', side: D }));
  // 橋上路燈、橋下的燈（燈頭白天熄、晚上亮；地上的光圈只有晚上才出現）
  const glow = new THREE.MeshBasicMaterial({ color: '#ffe0a8', toneMapped: false });
  glow.userData.lamp = true;
  const poolTex = canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,214,150,0.5)');
    grd.addColorStop(0.5, 'rgba(255,190,120,0.16)');
    grd.addColorStop(1, 'rgba(255,170,100,0)');
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }, false);
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 });
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], night = false) => {
    if (!ms.length) return;
    const im = new THREE.InstancedMesh(geo, mat, ms.length);
    ms.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    if (night) { im.userData.nightOnly = true; im.visible = false; }
    scene.add(im);
  };
  const steel = new THREE.MeshLambertMaterial({ color: '#6b7076' });
  inst(new THREE.CylinderGeometry(0.08, 0.11, 8, 6).translate(0, 4, 0), steel, lampsAt);
  inst(new THREE.BoxGeometry(0.08, 0.08, 2.2).translate(0, 7.9, 1.1), steel, lampsAt);
  inst(new THREE.BoxGeometry(0.4, 0.13, 0.75).translate(0, 7.82, 2.1), glow, lampsAt);
  inst(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2).translate(0, -0.97, 3), poolMat, lampsAt, true); // 光圈貼在橋面上（路燈底座是護欄頂＝橋面 +1 m）
  // 橋下：橋墩頂下方一盞方燈，地上一圈光（矩陣的 y 縮放 = 燈到地面的距離 ÷ 7，光圈放在地面）
  inst(new THREE.BoxGeometry(0.9, 0.12, 0.9).translate(0, -0.1, 1.2), glow, underAt);
  inst(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(0, -7, 1.2), poolMat, underAt, true);
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
  const pt = surf ? [] : d.portals ?? []; // 隧道可以開進去之後（tunnel.ts）就不畫這個假的洞口
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
