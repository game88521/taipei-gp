import * as THREE from 'three';
import { canvasTex } from './world';
import type { CityData, NetWay } from './citydata';
import type { Breakables } from './breakables';

// 街道細節：有標線的路面、斑馬線、路口的綠色路名牌、地標屋頂招牌

const FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
const ROAD_Y = -0.25;

/** 台灣路名的英文縮寫：Section 5, Xinyi Road → Sec. 5, Xinyi Rd. */
export function shortEn(en: string) {
  return en.replace(/Section/g, 'Sec.').replace(/\bRoad\b/g, 'Rd.').replace(/\bStreet\b/g, 'St.').replace(/\bAvenue\b/g, 'Ave.')
    .replace(/\bBoulevard\b/g, 'Blvd.').replace(/\bLane\b/g, 'Ln.').replace(/\bAlley\b/g, 'Aly.')
    .replace(/\bNorth\b/g, 'N.').replace(/\bSouth\b/g, 'S.').replace(/\bEast\b/g, 'E.').replace(/\bWest\b/g, 'W.');
}

export const lanesOf = (w: NetWay) => {
  if (w.l) return Math.max(1, Math.round(w.l));
  return w.o ? Math.max(1, Math.round(w.w / 3.4)) : Math.max(2, Math.round(w.w / 3.4 / 2) * 2);
};

/** 路面貼圖：u 橫跨路寬、v 沿路每 12 m 重複 */
function roadTexture(twoWay: boolean, lanes: number, marked: boolean) {
  return canvasTex(128, 256, (g) => {
    g.fillStyle = '#3c3e43';
    g.fillRect(0, 0, 128, 256);
    for (let k = 0; k < 900; k++) {
      const v = 52 + Math.random() * 26;
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5);
    }
    if (!marked) return;
    g.fillStyle = '#e8e8e8';
    g.fillRect(2, 0, 3, 256);
    g.fillRect(123, 0, 3, 256);
    const dash = (x: number) => { g.fillStyle = '#e8e8e8'; g.fillRect(x - 1.5, 0, 3, 86); }; // 4 m 實線 + 8 m 間隔
    if (twoWay) {
      g.fillStyle = '#f2c230'; // 雙向道路中央的雙黃線
      g.fillRect(60, 0, 3, 256);
      g.fillRect(66, 0, 3, 256);
      const per = lanes / 2;
      for (let k = 1; k < per; k++) { dash(64 - (64 * k) / per); dash(64 + (64 * k) / per); }
    } else {
      for (let k = 1; k < lanes; k++) dash((128 * k) / lanes);
    }
  });
}

export function buildRoads(scene: THREE.Scene, d: CityData) {
  const N = d.net.nodes;
  const groups = new Map<string, { pos: number[]; uv: number[]; tex: () => THREE.Texture }>();
  for (const w of d.net.ways) {
    const marked = w.c <= 2;
    const lanes = marked ? Math.min(6, lanesOf(w)) : 0;
    const key = `${w.o ? 1 : 2}-${lanes}-${marked ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { pos: [], uv: [], tex: () => roadTexture(!w.o, lanes, marked) });
    const g = groups.get(key)!;
    const hw = w.w / 2;
    let along = 0;
    for (let k = 0; k + 1 < w.n.length; k++) {
      const ax = N[w.n[k] * 2], az = N[w.n[k] * 2 + 1], bx = N[w.n[k + 1] * 2], bz = N[w.n[k + 1] * 2 + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 0.2) continue;
      const ux = dx / l, uz = dz / l, nx = -uz * hw, nz = ux * hw;
      // 兩端各延伸半個路寬蓋住轉折處的縫
      const e0 = k === 0 ? 0 : hw * 0.5, e1 = k + 2 === w.n.length ? 0 : hw * 0.5;
      const x0 = ax - ux * e0, z0 = az - uz * e0, x1 = bx + ux * e1, z1 = bz + uz * e1;
      const v0 = (along - e0) / 12, v1 = (along + l + e1) / 12;
      // 右 = (-uz, ux)：u=0 在左、u=1 在右
      const L0 = [x0 - nx, ROAD_Y, z0 - nz], R0 = [x0 + nx, ROAD_Y, z0 + nz], L1 = [x1 - nx, ROAD_Y, z1 - nz], R1 = [x1 + nx, ROAD_Y, z1 + nz];
      g.pos.push(...L0, ...R0, ...R1, ...L0, ...R1, ...L1);
      g.uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
      along += l;
    }
  }
  // 次要的路先畫、幹道後畫（重疊的路口由幹道蓋過去）
  const order = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  order.forEach((key, n) => {
    const g = groups.get(key)!;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.computeVertexNormals();
    const tex = g.tex();
    tex.anisotropy = 8;
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -n });
    mat.userData.road = true; // 下雨時換成會反光的濕路面（weather.ts）
    scene.add(new THREE.Mesh(geo, mat));
  });
}

/** 斑馬線：在路網的穿越道節點上，順著道路方向畫白色條紋 */
export function buildCrossings(scene: THREE.Scene, d: CityData) {
  const N = d.net.nodes;
  const wayAt = new Map<number, { w: NetWay; k: number }>();
  for (const w of d.net.ways) if (w.c <= 3) w.n.forEach((ni, k) => { if (!wayAt.has(ni)) wayAt.set(ni, { w, k }); });
  const pos: number[] = [], uv: number[] = [];
  for (const ni of d.crossings) {
    const at = wayAt.get(ni);
    if (!at) continue;
    const { w, k } = at;
    const a = w.n[Math.max(0, k - 1)], b = w.n[Math.min(w.n.length - 1, k + 1)];
    let ux = N[b * 2] - N[a * 2], uz = N[b * 2 + 1] - N[a * 2 + 1];
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    const x = N[ni * 2], z = N[ni * 2 + 1], hw = w.w / 2 - 0.3, hd = 2;
    const nx = -uz, nz = ux;
    const p = (s: number, t: number) => [x + nx * s + ux * t, ROAD_Y + 0.01, z + nz * s + uz * t];
    const rep = (w.w - 0.6) / 1.0; // 每 1 m 一條（0.5 m 白、0.5 m 空）
    const A = p(-hw, -hd), B = p(hw, -hd), C = p(hw, hd), D = p(-hw, hd);
    pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    uv.push(0, 0, rep, 0, rep, 1, 0, 0, rep, 1, 0, 1);
  }
  if (!pos.length) return;
  const tex = canvasTex(32, 8, (g) => { g.clearRect(0, 0, 32, 8); g.fillStyle = '#ececec'; g.fillRect(0, 0, 16, 8); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -20 })));
}

/** 文字圖集：每張 1024×1024，切成 2×8 格 512×128；回傳各格的 uv 範圍與所屬材質 */
function textAtlas(items: string[][], draw: (g: CanvasRenderingContext2D, x: number, y: number, item: string[]) => void, basic: THREE.MaterialParameters) {
  const per = 16, mats: THREE.Material[] = [], slots: { mat: number; u0: number; v0: number; u1: number; v1: number }[] = [];
  for (let start = 0; start < items.length; start += per) {
    const chunk = items.slice(start, start + per);
    const tex = canvasTex(1024, 1024, (g) => {
      g.clearRect(0, 0, 1024, 1024);
      chunk.forEach((it, k) => draw(g, (k % 2) * 512, Math.floor(k / 2) * 128, it));
    }, false);
    tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, ...basic });
    if (basic.transparent) mat.userData.nightScale = 1.7; // 地標屋頂招牌：晚上更亮（路名牌不透明，不變）
    mats.push(mat);
    chunk.forEach((_, k) => {
      const cx = k % 2, cy = Math.floor(k / 2);
      slots.push({ mat: mats.length - 1, u0: cx / 2, u1: (cx + 1) / 2, v0: 1 - (cy + 1) / 8, v1: 1 - cy / 8 });
    });
  }
  return { mats, slots };
}

/** 一塊雙面的長方形招牌加進對應圖集的幾何裡 */
function addBoard(buckets: { pos: number[]; uv: number[] }[], slot: { mat: number; u0: number; v0: number; u1: number; v1: number }, cx: number, cy: number, cz: number, ang: number, w: number, h: number) {
  const b = buckets[slot.mat];
  // 寬度方向 = 招牌面對方向轉 90°；正反兩面各一片，文字從兩邊看都是正的
  for (const face of [0, Math.PI]) {
    const a = ang + face, nx = Math.sin(a), nz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
    const o = face ? -0.02 : 0.02;
    const P = (s: number, t: number) => [cx + rx * s + nx * o, cy + t, cz + rz * s + nz * o];
    const A = P(-w / 2, -h / 2), B = P(w / 2, -h / 2), C = P(w / 2, h / 2), D = P(-w / 2, h / 2);
    b.pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    b.uv.push(slot.u0, slot.v0, slot.u1, slot.v0, slot.u1, slot.v1, slot.u0, slot.v0, slot.u1, slot.v1, slot.u0, slot.v1);
  }
}
function flush(scene: THREE.Object3D, mats: THREE.Material[], buckets: { pos: number[]; uv: number[] }[]) {
  buckets.forEach((b, k) => {
    if (!b.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    scene.add(new THREE.Mesh(g, mats[k]));
  });
}

/** 路口的綠色路名牌（中文大字＋英文小字），兩片各自跟所標示的道路平行 */
/** 回傳離賽道很近的那幾支（街道賽時要隱藏，招牌會伸到賽道上方擋視線） */
export function buildStreetSigns(scene: THREE.Scene, d: CityData, breakables?: Breakables, nearTrack?: (x: number, z: number) => boolean, onSign?: (g: THREE.Object3D, x: number, z: number) => void): THREE.Object3D[] {
  const hideInRace: THREE.Object3D[] = [];
  const blades: string[][] = [];
  const index = new Map<string, number>();
  for (const s of d.signs) for (const b of s.b) {
    const key = b.nm + '|' + b.en;
    if (!index.has(key)) { index.set(key, blades.length); blades.push([b.nm, shortEn(b.en)]); }
  }
  const { mats, slots } = textAtlas(blades, (g, x, y, [nm, en]) => {
    g.fillStyle = '#0b6b3c';
    g.fillRect(x + 4, y + 6, 504, 116);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.strokeRect(x + 12, y + 14, 488, 100);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 50px ${FONT}`;
    g.fillText(nm, x + 256, y + (en ? 50 : 64), 460);
    if (en) { g.font = `bold 24px Arial, sans-serif`; g.fillText(en, x + 256, y + 94, 460); }
  }, { side: THREE.FrontSide });
  // 每一支路名牌是獨立的物件（柱子＋招牌），才能單獨被撞倒
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6).translate(0, 2.6 - 0.6, 0), poleMat = new THREE.MeshLambertMaterial({ color: '#7d848c' });
  for (const s of d.signs) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(s.x, 0, s.z);
    g.add(pole);
    const buckets = mats.map(() => ({ pos: [] as number[], uv: [] as number[] }));
    s.b.forEach((b, k) => {
      const dx = Math.sin(b.a), dz = Math.cos(b.a);
      // 招牌面朝向與道路垂直；從柱子往道路方向伸出 1.35 m
      addBoard(buckets, slots[index.get(b.nm + '|' + b.en)!], s.x + dx * 1.35, 4.4 - k * 0.75, s.z + dz * 1.35, b.a + Math.PI / 2, 2.6, 0.65);
    });
    flush(g, mats, buckets);
    scene.add(g);
    breakables?.addObject(s.x, s.z, 0.12, 0.93, g); // 撞到會倒，車速剩 93%
    if (nearTrack?.(s.x, s.z)) hideInRace.push(g);
    onSign?.(g, s.x, s.z);
  }
  return hideInRace;
}

// 不當地標的名字：附屬建物、太通用的
const NOT_LANDMARK = /教室|倉庫|育嬰室|廳舍|修理廠|鍋爐房|^.{1,2}$|樓$/;
const LANDMARK_HINT = /101|市政府|紀念館|世貿|會議中心|百貨|廣場|飯店|酒店|醫院|商場|中心|大樓|大廈|ATT|Neo|三越|誠品|議會|菸廠|製菸|巨蛋|國際/;

export interface Landmark { nm: string; x: number; z: number; r: number }

/** 地標：屋頂招牌（最長那面牆上方）＋ 回傳接近提示用的清單 */
export function buildLandmarks(scene: THREE.Scene, d: CityData): Landmark[] {
  const list = d.places.filter((p) => !(NOT_LANDMARK.test(p.nm.trim()) && !LANDMARK_HINT.test(p.nm)));
  // 屋頂招牌只掛最高的 160 棟（地圖變大後地標上千個，全部掛會吃掉太多記憶體）；接近提示照樣全部都有
  const signed = new Set([...list].sort((a, b) => b.h - a.h).slice(0, 160).map((p) => p.nm.trim()));
  const names = [...signed];
  const colors = ['#ffffff', '#ff4b4b', '#ffd84a', '#7fd8ff'];
  const { mats, slots } = textAtlas(names.map((n) => [n]), (g, x, y, [nm]) => {
    g.font = `900 72px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 8;
    g.fillStyle = colors[nm.length % colors.length];
    g.fillText(nm, x + 256, y + 66, 496);
    g.shadowBlur = 0;
  }, { transparent: true, alphaTest: 0.25, side: THREE.FrontSide });
  const buckets = mats.map(() => ({ pos: [] as number[], uv: [] as number[] }));
  const done = new Set<string>();
  const out: Landmark[] = [];
  for (const p of list) {
    const nm = p.nm.trim();
    out.push({ nm, x: p.x, z: p.z, r: p.r });
    if (done.has(nm) || p.h > 300 || !signed.has(nm)) continue; // 同名只掛一塊；101 不掛（塔身本身就是招牌）
    done.add(nm);
    const [x1, z1, x2, z2] = p.e, bl = Math.hypot(x2 - x1, z2 - z1);
    const ang = Math.atan2(x2 - x1, z2 - z1) + Math.PI / 2;
    const w = Math.min(bl * 0.9, nm.length * 3.2 + 2), h = (w / 4) * 0.9;
    addBoard(buckets, slots[names.indexOf(nm)], (x1 + x2) / 2, p.h + h / 2 + 0.6, (z1 + z2) / 2, ang, w, h);
  }
  flush(scene, mats, buckets);
  return out;
}
