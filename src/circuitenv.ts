import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_OFF, type Track } from './track';
import { fillerMaterial, WALLS } from './filler';
import { canvasTex, type World } from './world';
import type { CircuitMeta } from './circuits';
import { TEAMS } from './f1model';

// 各國賽道的通用場景（不載入真實街景）：有紋理的地面、彎道外側的碎石緩衝區、主看台與彎道看台（斜坡座位＋懸臂屋頂）、
// 維修道與車隊車庫、大螢幕、工作人員崗亭、成片的樹林（熱帶是棕櫚樹）或街道賽的城市方塊、夜賽的照明燈柱與路面光圈。
// 都離賽道中心線夠遠，不會擋到車。看台、維修區這些建物全部合併成「一種材質一次繪製」，手機才跑得動

function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

/** 截面的一段：從 pts[k] 到 pts[k+1]（u = 往外的橫向距離、v = 高度，公尺）用 mats[k] 這個材質（-1 = 不蓋）；
 *  unit[k]：貼圖 v 方向從 0 到 1 剛好蓋滿這一段（看台座位、車庫門）；rep[k]：貼圖沿賽道多少公尺重複一次；
 *  cap：兩端封口用的材質（截面要是封閉的多邊形，最後一點 = 第一點） */
interface Part { pts: [number, number][]; mats: number[]; unit?: boolean[]; rep?: number[]; cap?: number }

const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

export function buildCircuitEnv(scene: THREE.Scene, t: Track, meta: CircuitMeta, world: World) {
  const r = rng(meta.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483647 || 1);
  // 常設賽道沒有城市路燈（街道賽才留著）
  if (meta.biome !== 'street') for (const l of world.lamps) l.visible = false;
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
  // 賽道 90 m 內一律壓在路面下 1 m：地形網格每格約 40 m，包住維修道、看台的三角形三個頂點都要在路面下，內插才不會穿出來
  // （起跑直線在低窪處的賽道，像蒙札，40 m 的話維修道會被外面比較高的頂點拉起來的地形蓋住）
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
    return Math.sqrt(nd) < WALL_OFF + 90 ? Math.min(h, ny - 1) : h;
  };
  // ---- 地面：照環境畫紋理（草地有割草條紋、沙漠有沙紋、街道是石板），蓋住整條賽道再往外 3 km；有高低起伏
  const grassy = meta.biome === 'grass' || meta.biome === 'tropical';
  const groundTex = canvasTex(512, 512, (g) => {
    g.fillStyle = { grass: '#5f8a45', tropical: '#4f8a3e', desert: '#c9ad7d', street: '#6d6b67' }[meta.biome];
    g.fillRect(0, 0, 512, 512);
    if (grassy) { g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 0; y < 512; y += 128) g.fillRect(0, y, 512, 64); }
    for (let k = 0; k < 9000; k++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
      g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    if (meta.biome === 'desert') {
      g.strokeStyle = 'rgba(120,88,50,0.14)'; g.lineWidth = 2;
      for (let y = 0; y < 512; y += 22) { g.beginPath(); for (let x = 0; x <= 512; x += 8) g.lineTo(x, y + Math.sin((x / 512) * Math.PI * 4 + y) * 5); g.stroke(); }
    }
    if (meta.biome === 'street') { g.fillStyle = 'rgba(0,0,0,0.09)'; for (let k = 0; k < 512; k += 64) { g.fillRect(k, 0, 2, 512); g.fillRect(0, k, 512, 2); } }
  });
  world.ground.visible = false;
  const W = x1 - x0 + 6000, D = z1 - z0 + 6000, SEG = 180;
  groundTex.repeat.set(W / 48, D / 48);
  const tg = new THREE.PlaneGeometry(W, D, SEG, SEG).rotateX(-Math.PI / 2);
  const tp = tg.attributes.position as THREE.BufferAttribute, gx = (x0 + x1) / 2, gz = (z0 + z1) / 2;
  for (let v = 0; v < tp.count; v++) tp.setY(v, hAt(tp.getX(v) + gx, tp.getZ(v) + gz) - 0.6);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ map: groundTex }));
  terrain.position.set(gx, 0, gz);
  terrain.userData.flat = true;
  scene.add(terrain);
  const clear = (x: number, z: number, d: number) => {
    const cx = Math.floor(x / G), cz = Math.floor(z / G), R = Math.ceil(d / G);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const i of grid.get(`${cx + a},${cz + b}`) || []) if ((t.px[i] - x) ** 2 + (t.pz[i] - z) ** 2 < d * d) return false;
    return true;
  };
  const at = (s: number) => ((Math.round(s / t.ds) % t.N) + t.N) % t.N;
  const side = (i: number, lat: number): [number, number] => [t.px[i] - t.tz[i] * lat, t.pz[i] + t.tx[i] * lat];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // ---- 彎道外側的碎石緩衝區（護牆外，從 TV 鏡頭、俯瞰看得到）；會蓋到別段賽道的地方不鋪
  const GRAVEL_IN = WALL_OFF + 3, GRAVEL_OUT = WALL_OFF + 26;
  const gravelSide = new Int8Array(t.N);
  {
    const span = Math.round(45 / t.ds);
    const strength = new Float32Array(t.N);
    for (let i = 0; i < t.N; i++) {
      const c = Math.abs(t.curv[i]);
      if (c < 1 / 110) continue;
      for (let k = -span; k <= span; k++) {
        const j = (i + k + t.N) % t.N;
        if (c > strength[j]) { strength[j] = c; gravelSide[j] = t.curv[i] > 0 ? -1 : 1; }
      }
    }
    for (let i = 0; i < t.N; i++) {
      const sg = gravelSide[i];
      if (!sg) continue;
      const [ox, oz] = side(i, sg * GRAVEL_OUT), [mx, mz] = side(i, sg * (GRAVEL_IN + 10));
      if (!clear(ox, oz, 20) || !clear(mx, mz, 9)) gravelSide[i] = 0;
    }
  }
  {
    const gravelTex = canvasTex(128, 128, (g) => {
      g.fillStyle = '#cbb68b'; g.fillRect(0, 0, 128, 128);
      for (let k = 0; k < 2600; k++) {
        const v = Math.random();
        g.fillStyle = v < 0.4 ? 'rgba(90,70,40,0.25)' : v < 0.8 ? 'rgba(255,250,235,0.3)' : 'rgba(60,55,50,0.3)';
        g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
    });
    const pos: number[] = [], uv: number[] = [];
    const vert = (i: number, lat: number, y: number, d: number) => {
      const [x, z] = side(i, lat);
      pos.push(x, y, z); uv.push(lat / 4, d / 4);
    };
    for (let i = 0; i < t.N; i++) {
      const j = (i + 1) % t.N, sg = gravelSide[i];
      if (!sg || gravelSide[j] !== sg) continue;
      const d0 = t.dist[i], d1 = j === 0 ? t.length : t.dist[j];
      const yo = (k: number) => { const [x, z] = side(k, sg * GRAVEL_OUT); return hAt(x, z) - 0.5; };
      vert(i, sg * GRAVEL_IN, t.py[i] - 0.02, d0); vert(i, sg * GRAVEL_OUT, yo(i), d0); vert(j, sg * GRAVEL_IN, t.py[j] - 0.02, d1);
      vert(i, sg * GRAVEL_OUT, yo(i), d0); vert(j, sg * GRAVEL_OUT, yo(j), d1); vert(j, sg * GRAVEL_IN, t.py[j] - 0.02, d1);
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: gravelTex, side: THREE.DoubleSide }));
      m.userData.flat = true;
      scene.add(m);
    }
  }

  // ---- 建物用的材質（編號 = bins 的 key）
  const C_CONCRETE = 0, C_CROWD = 1, C_ROOF = 2, C_BANNER = 3, C_GARAGE = 4, C_GLASS = 5, C_PITLANE = 6, C_SCREEN = 7;
  const crowdTex = canvasTex(512, 320, (g) => {
    // 20 排座位：每排下面是混凝土階、上面是坐著的觀眾（頭＋上衣），偶爾空位
    // 上衣以深色、白色居多，再混一些車隊色（紅、橘、藍）
    const shirts = ['#1d1f24', '#2b2f38', '#1d1f24', '#e8e8e8', '#d9d9d9', '#c41a1a', '#e10600', '#ff7a00', '#24489a', '#5a6270', '#ffd400', '#2f7a4a'];
    const skin = ['#f1c9a5', '#d9a77e', '#a87452', '#6e4a33'];
    for (let row = 0; row < 20; row++) {
      const y = row * 16;
      g.fillStyle = '#4a5468'; g.fillRect(0, y, 512, 11); // 座椅
      g.fillStyle = '#9a9ea6'; g.fillRect(0, y + 11, 512, 5); // 階梯
      for (let x = 1; x < 512; x += 8) {
        if (Math.random() < 0.18) continue;
        const dx = x + Math.floor(Math.random() * 2);
        g.fillStyle = shirts[Math.floor(Math.random() * shirts.length)]; g.fillRect(dx, y + 5, 6, 6);
        g.fillStyle = skin[Math.floor(Math.random() * skin.length)]; g.fillRect(dx + 1, y + 1, 4, 4);
      }
    }
  });
  const bannerTex = canvasTex(1024, 64, (g) => {
    const cols = ['#d81e2a', '#13306b', '#0f7a4a', '#141414'];
    meta.banner.forEach((txt, k) => {
      g.fillStyle = cols[k % cols.length]; g.fillRect(k * 256, 0, 256, 64);
      g.fillStyle = '#fff'; g.font = 'bold 34px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, k * 256 + 128, 34, 236);
    });
  });
  const garageTex = canvasTex(2048, 128, (g) => {
    // 11 隊的車庫：車隊色的門楣＋隊名、亮著燈的車庫內部
    const w = 2048 / TEAMS.length;
    g.fillStyle = '#d9dce0'; g.fillRect(0, 0, 2048, 128);
    TEAMS.forEach((tm, k) => {
      const x = k * w;
      g.fillStyle = tm.livery.main; g.fillRect(x + 6, 6, w - 12, 22);
      g.fillStyle = tm.livery.accent; g.fillRect(x + 6, 26, w - 12, 3);
      g.fillStyle = tm.livery.main === '#f2f2f2' ? '#c8102e' : '#fff';
      g.font = 'bold 15px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(tm.team.split(' ')[0], x + w / 2, 18, w - 20);
      const grd = g.createLinearGradient(0, 34, 0, 128);
      grd.addColorStop(0, '#f2f5fa'); grd.addColorStop(0.08, '#3a3e46'); grd.addColorStop(1, '#16181c');
      g.fillStyle = grd; g.fillRect(x + 12, 34, w - 24, 94);
      g.fillStyle = tm.livery.main; g.globalAlpha = 0.35; g.fillRect(x + 12, 112, w - 24, 16); g.globalAlpha = 1; // 地板反光
    });
  });
  const glassTex = canvasTex(256, 64, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, '#a9cbe6'); grd.addColorStop(0.55, '#4f7393'); grd.addColorStop(1, '#2c445c');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#20262e';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 3, 64);
    g.fillRect(0, 0, 256, 3); g.fillRect(0, 40, 256, 2);
  });
  const pitTex = canvasTex(64, 256, (g) => {
    g.fillStyle = '#45474c'; g.fillRect(0, 0, 64, 256);
    for (let k = 0; k < 500; k++) { const v = 55 + Math.random() * 30; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
    g.fillStyle = '#f0f0f0'; g.fillRect(0, 244, 64, 6); // 靠賽道那側的白線
    g.fillRect(0, 112, 32, 4); // 快車道／作業區的虛線
  });
  const screenTex = canvasTex(512, 288, (g) => {
    g.fillStyle = '#05070c'; g.fillRect(0, 0, 512, 288);
    g.fillStyle = '#e10600'; g.fillRect(0, 0, 512, 44);
    g.fillStyle = '#fff'; g.font = 'bold 28px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
    g.textBaseline = 'middle'; g.fillText(meta.banner[0], 16, 23);
    g.textAlign = 'right'; g.fillText('● LIVE', 496, 23); g.textAlign = 'left';
    g.font = 'bold 24px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
    for (let k = 0; k < 6; k++) {
      const y = 70 + k * 36, tm = TEAMS[(k * 3) % TEAMS.length];
      g.fillStyle = '#1b1f2a'; g.fillRect(12, y - 15, 488, 30);
      g.fillStyle = tm.livery.main; g.fillRect(12, y - 15, 8, 30);
      g.fillStyle = '#fff'; g.fillText(`P${k + 1}`, 32, y);
      g.fillText(tm.team.split(' ')[0], 90, y);
      g.fillStyle = '#ffd400'; g.textAlign = 'right'; g.fillText(k ? `+${(k * 1.7 + 0.4).toFixed(1)}` : '領先', 496, y); g.textAlign = 'left';
    }
  });
  // 夜間照明：看台被屋簷下的燈照亮、廣告看板與車庫打燈、玻璃帷幕裡的辦公室亮著
  // （nightEmissive = [白天, 晚上] 的自發光顏色，weather.ts 照時段漸變；emissiveMap 用同一張貼圖，亮起來才看得到內容）
  const lit = (m: THREE.MeshLambertMaterial, night: string, day = '#000000') => {
    if (m.map) m.emissiveMap = m.map;
    m.emissive.set(day);
    m.userData.nightEmissive = [day, night];
    return m;
  };
  const C_LAMP = 8;
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff2d8', toneMapped: false, side: THREE.DoubleSide });
  lampMat.userData.lamp = true; // 白天暗、晚上亮（weather.ts）
  const mats: Record<number, THREE.Material> = {
    [C_CONCRETE]: lit(new THREE.MeshLambertMaterial({ color: '#b2b6bd', side: THREE.DoubleSide }), '#2a2c32'),
    [C_CROWD]: lit(new THREE.MeshLambertMaterial({ map: crowdTex, side: THREE.DoubleSide }), '#8a8a90'),
    [C_ROOF]: lit(new THREE.MeshLambertMaterial({ color: '#c3c8cf', side: THREE.DoubleSide }), '#22252b'), // 淺色膜屋頂：從空中看才不會是一大塊黑
    [C_BANNER]: lit(new THREE.MeshLambertMaterial({ map: bannerTex, side: THREE.DoubleSide }), '#c8c8c8'),
    [C_GARAGE]: lit(new THREE.MeshLambertMaterial({ map: garageTex, side: THREE.DoubleSide }), '#b4b4b4'),
    [C_GLASS]: lit(new THREE.MeshLambertMaterial({ map: glassTex, side: THREE.DoubleSide }), '#d0dcec', '#0d1622'),
    [C_PITLANE]: lit(new THREE.MeshLambertMaterial({ map: pitTex, side: THREE.DoubleSide }), '#5a5a5e'),
    [C_SCREEN]: new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }),
    [C_LAMP]: lampMat,
  };
  // ---- 觀眾會動（著色器裡算，不花 CPU）：平時少數人在動；興奮時（起跑、超車、衝線）全場跳起來，還有沿看台跑的人浪
  // 座位貼圖一排 8 px 一個人、一張 64 人寬 × 20 排；取樣時把某些「人格子」往下挪幾 px = 那個人往上跳
  const crowdU = { uTime: { value: 0 }, uExcite: { value: 0 } };
  mats[C_CROWD].onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, crowdU);
    sh.fragmentShader = 'uniform float uTime;\nuniform float uExcite;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec2 cuv = vMapUv;
        {
          float col = floor(cuv.x * 64.0), row = floor(cuv.y * 20.0);
          float h = fract(sin(col * 12.9898 + row * 78.233) * 43758.5453);
          float idle = step(0.84, h) * pow(max(0.0, sin(uTime * (4.0 + h * 4.0) + h * 40.0)), 3.0) * 0.5;
          float hop = pow(max(0.0, sin(uTime * 9.0 + h * 30.0)), 2.0);
          float wave = pow(max(0.0, sin(col * 0.3 - uTime * 3.2)), 8.0);
          cuv.y -= max(idle, uExcite * max(hop * step(0.35, h), wave)) * 3.0 / 320.0;
        }
        diffuseColor *= texture2D( map, cuv );`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= texture2D( emissiveMap, cuv ).rgb;');
  };
  // 揮旗：看台上一面一面的小旗（頂點著色器讓旗面飄，越興奮揮得越快）
  const flagSpots: [number, number, number, number][] = [], standSpots: [number, number][] = [];
  let flagMesh: THREE.Object3D | null = null;
  const bins = new Map<number, THREE.BufferGeometry[]>();
  const push = (m: number, g: THREE.BufferGeometry) => { if (!bins.has(m)) bins.set(m, []); bins.get(m)!.push(g); };
  /** 一個方塊（世界座標、繞 y 轉 ang）丟進某個材質 */
  const box = (m: number, w: number, h: number, d: number, x: number, y: number, z: number, ang: number) => {
    Q.setFromAxisAngle(up, ang);
    push(m, ni(new THREE.BoxGeometry(w, h, d)).applyMatrix4(M.compose(V.set(x, y, z), Q, S.set(1, 1, 1))));
  };

  /** 沿賽道 s0~s1（公尺）、在 sg 那側離中心線 base 公尺外，把截面拉成長條建物 */
  const sweep = (s0: number, s1: number, sg: number, base: number, parts: Part[], step = 4) => {
    const ss: number[] = [];
    for (let s = s0; s < s1; s += step) ss.push(s);
    ss.push(s1);
    const fr = ss.map(at);
    const P = (i: number, u: number, v: number): [number, number, number] => {
      const lat = sg * (base + u);
      return [t.px[i] - t.tz[i] * lat, t.py[i] + v, t.pz[i] + t.tx[i] * lat];
    };
    for (const part of parts) {
      const per = new Map<number, { pos: number[]; uv: number[] }>();
      const get = (m: number) => { let b = per.get(m); if (!b) per.set(m, (b = { pos: [], uv: [] })); return b; };
      for (let e = 0; e < part.pts.length - 1; e++) {
        const m = part.mats[e];
        if (m < 0) continue;
        const [ua, va] = part.pts[e], [ub, vb] = part.pts[e + 1];
        const tb = part.unit?.[e] ? 1 : Math.hypot(ub - ua, vb - va) / 4, rep = part.rep?.[e] ?? 16;
        const b = get(m);
        for (let k = 0; k < ss.length - 1; k++) {
          // 右側（sg = 1）從賽道上看是由右往左排，貼圖要翻過來字才是正的
          const d0 = (-sg * (ss[k] - s0)) / rep, d1 = (-sg * (ss[k + 1] - s0)) / rep;
          const a0 = P(fr[k], ua, va), b0 = P(fr[k], ub, vb), a1 = P(fr[k + 1], ua, va), b1 = P(fr[k + 1], ub, vb);
          b.pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
          b.uv.push(d0, 0, d0, tb, d1, 0, d0, tb, d1, tb, d1, 0);
        }
      }
      if (part.cap != null) {
        const ring = part.pts.slice(0, -1).map(([u, v]) => new THREE.Vector2(u, v));
        const tris = THREE.ShapeUtils.triangulateShape(ring, []);
        const b = get(part.cap);
        for (const i of [fr[0], fr[fr.length - 1]]) for (const tri of tris) for (const k of tri) {
          b.pos.push(...P(i, ring[k].x, ring[k].y));
          b.uv.push(ring[k].x / 4, ring[k].y / 4);
        }
      }
      for (const [m, b] of per) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
        g.computeVertexNormals();
        push(m, g);
      }
    }
    return P;
  };

  // ---- 看台：斜坡座位區（前牆有廣告）＋懸臂屋頂（後排柱子撐著）
  const BOT = -4; // 底部埋進地面，地形低一點也不會懸空
  const stand = (s0: number, s1: number, sg: number, base: number) => {
    const P = sweep(s0, s1, sg, base, [
      { pts: [[0, BOT], [0, 0.6], [0, 2.4], [0.7, 2.4], [14, 11], [14.8, 11], [14.8, BOT], [0, BOT]], mats: [C_CONCRETE, C_BANNER, C_CONCRETE, C_CROWD, C_CONCRETE, C_CONCRETE, C_CONCRETE], unit: [false, true, false, true, false, false, false], rep: [16, 60, 16, 32, 16, 16, 16], cap: C_CONCRETE },
      { pts: [[-1.5, 15.6], [15.2, 13.4]], mats: [C_ROOF] },
      { pts: [[-1.5, 14.6], [-1.5, 15.6]], mats: [C_BANNER], unit: [true], rep: [60] },
      { pts: [[-1.1, 15.25], [-0.3, 15.2]], mats: [C_LAMP] }, // 屋簷下的燈條：晚上照亮看台
    ]);
    for (let s = s0; s <= s1; s += 16) {
      const i = at(s), [x, y, z] = P(i, 14.4, (BOT + 13.6) / 2);
      box(C_ROOF, 0.5, 13.6 - BOT, 0.5, x, y, z, Math.atan2(t.tx[i], t.tz[i]));
    }
    for (let s = s0 + 3; s < s1; s += 4 + r() * 4) {
      const i = at(s), u = 1.5 + r() * 11.5, [x, y, z] = P(i, u, 2.4 + ((u - 0.7) / 13.3) * 8.6 + 0.8);
      flagSpots.push([x, y, z, Math.atan2(sg * t.tz[i], -sg * t.tx[i])]);
    }
    const mid = at((s0 + s1) / 2), [cx, , cz] = P(mid, 7, 0);
    standSpots.push([cx, cz]);
  };
  // 主看台：起跑線前後、維修區的對面（維修區在右側）
  stand(-160, 160, -1, WALL_OFF + 5);
  // 彎道看台：最急的五個彎的外側（碎石區再過去）；旁邊立一面大螢幕
  const corners: number[] = [];
  const order = [...Array(t.N).keys()].sort((a, b) => Math.abs(t.curv[b]) - Math.abs(t.curv[a]));
  for (const i of order) {
    if (corners.length >= 5) break;
    const s = i * t.ds;
    if (s < 260 || s > t.length - 260) continue; // 主看台附近不要
    if (corners.every((c) => Math.abs(c - i) > 120 && Math.abs(c - i) < t.N - 120)) corners.push(i);
  }
  const screenGeo: THREE.BufferGeometry[] = [];
  corners.forEach((i, n) => {
    const sg = t.curv[i] > 0 ? -1 : 1, s = i * t.ds, base = WALL_OFF + 28;
    const len = n < 3 ? 50 : 32;
    stand(s - len, s + len, sg, base);
    // 大螢幕：看台尾端再過去一點，面向賽道
    const j = at(s + len + 18), [x, z] = side(j, sg * (base + 4)), y = t.py[j];
    const ang = Math.atan2(sg * t.tz[j], -sg * t.tx[j]);
    for (const l of [-5, 5]) box(C_ROOF, 0.6, 10, 0.6, x + Math.cos(ang) * l, y + 3, z - Math.sin(ang) * l, ang);
    box(C_ROOF, 16.8, 9.8, 0.6, x, y + 12.4, z, ang);
    Q.setFromAxisAngle(up, ang);
    screenGeo.push(new THREE.PlaneGeometry(16, 9).applyMatrix4(M.compose(V.set(x + Math.sin(ang) * 0.32, y + 12.4, z + Math.cos(ang) * 0.32), Q, S.set(1, 1, 1))));
  });
  if (screenGeo.length) { const m = new THREE.Mesh(mergeGeometries(screenGeo), mats[C_SCREEN]); scene.add(m); }
  {
    // 旗面 0.9 × 0.6 m，左緣是旗桿（x = 0），越往右飄得越大
    const flagMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    flagMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, crowdU);
      sh.vertexShader = 'uniform float uTime;\nuniform float uExcite;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3( position );
        float fid = float( gl_InstanceID );
        transformed.z += sin( uTime * (5.0 + uExcite * 6.0) + position.x * 5.0 + fid * 1.7 ) * 0.16 * position.x * (0.6 + uExcite);
        transformed.y += sin( uTime * (2.0 + uExcite * 5.0) + fid * 2.3 ) * 0.25 * uExcite;`);
    };
    const flags = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.6, 4, 1).translate(0.45, 0, 0), flagMat, Math.max(1, flagSpots.length));
    const fc = [...TEAMS.map((tm) => tm.livery.main), '#ffffff', '#e10600', '#ffd400'].map((c) => new THREE.Color(c));
    flagSpots.forEach(([x, y, z, a], k) => {
      Q.setFromAxisAngle(up, a);
      flags.setMatrixAt(k, M.compose(V.set(x, y, z), Q, S.set(1, 1, 1)));
      flags.setColorAt(k, fc[Math.floor(r() * fc.length)]);
    });
    flags.count = flagSpots.length;
    flags.computeBoundingSphere();
    scene.add(flags);
    flagMesh = flags;
  }

  // ---- 維修區：起跑線旁、右側（跟 AI 進站那側一樣）——維修道、11 隊車庫、二樓玻璃帷幕、屋頂廣告
  // （維修道的路面、標線、停車格由 pitlane.ts 畫；車庫門的貼圖 11 隊排滿 260 m，對齊 pitlane.boxS 的停車格）
  sweep(-130, 130, 1, WALL_OFF + 3, [
    {
      pts: [[10, BOT], [10, 0], [10, 5.2], [8.6, 5.2], [8.6, 9.4], [8.6, 10.2], [26, 10.2], [26, BOT], [10, BOT]],
      mats: [C_CONCRETE, C_GARAGE, C_CONCRETE, C_GLASS, C_BANNER, C_ROOF, C_CONCRETE, C_CONCRETE],
      unit: [false, true, false, true, true, false, false, false],
      rep: [16, 260, 16, 24, 60, 16, 16, 16],
      cap: C_CONCRETE,
    },
    { pts: [[9.0, 5.12], [9.8, 5.12]], mats: [C_LAMP] }, // 雨遮下的燈條：晚上照亮車庫門口
  ]);

  // 維修區屋頂上的空調箱、轉播棚（從空中看才不會是一整片平的）
  for (let s = -115; s <= 115; s += 23) {
    const i = at(s), ang = Math.atan2(t.tx[i], t.tz[i]);
    const [x, z] = side(i, WALL_OFF + 3 + 20 + (Math.abs(s) % 2) * 2);
    box(Math.abs(s) % 46 === 0 ? C_GLASS : C_CONCRETE, 5, 1.8, 6, x, t.py[i] + 11.1, z, ang);
  }

  // ---- 工作人員崗亭：每 280 m 一個，左右交錯，在護牆外
  {
    const huts: [number, number, number, number][] = [];
    for (let s = 200, k = 0; s < t.length - 200; s += 280, k++) {
      const i = at(s), sg = k % 2 ? 1 : -1;
      if (gravelSide[i] === sg) continue;
      if (sg > 0 && (s < 360 || s > t.length - 360)) continue; // 右側起跑線前後是進出維修區的車道
      const [x, z] = side(i, sg * (WALL_OFF + 4.5));
      if (!clear(x, z, WALL_OFF + 2)) continue;
      huts.push([x, t.py[i], z, Math.atan2(t.tx[i], t.tz[i])]);
    }
    const hut = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.6, 2.4).translate(0, 1.3 - 0.6, 0), new THREE.MeshLambertMaterial({ color: '#e6e8ea' }), Math.max(1, huts.length));
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.3, 3).translate(0, 2.15, 0), new THREE.MeshLambertMaterial({ color: '#ff7a1a' }), Math.max(1, huts.length));
    huts.forEach(([x, y, z, a], k) => {
      Q.setFromAxisAngle(up, a);
      M.compose(V.set(x, y, z), Q, S.set(1, 1, 1));
      hut.setMatrixAt(k, M); cap.setMatrixAt(k, M);
    });
    hut.count = cap.count = huts.length;
    hut.computeBoundingSphere(); cap.computeBoundingSphere();
    scene.add(hut, cap);
  }

  // 建物合併：一種材質一次繪製
  for (const [m, geos] of bins) scene.add(new THREE.Mesh(mergeGeometries(geos), mats[m]));

  // ---- 周圍：樹林，或街道賽的城市方塊
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
  const treeKeep = buildTrees(scene, meta, r, { x0, z0, x1, z1 }, clear, hAt);

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
  // 觀眾的情緒：cheer() 一下子拉滿、慢慢退；車子（或鏡頭）在看台 150 m 內時一直有點興奮
  let cheerLv = 0;
  /** 畫質（main 自動降級時呼叫）：中 = 樹留八成，低 = 樹留一半、不畫旗子 */
  const setDetail = (lv: 'high' | 'medium' | 'low') => {
    treeKeep(lv === 'high' ? 1 : lv === 'medium' ? 0.8 : 0.5);
    if (flagMesh) flagMesh.visible = lv !== 'low';
  };
  const crowd = {
    cheer(k = 1) { cheerLv = Math.max(cheerLv, k); },
    tick(dt: number, px: number, pz: number) {
      crowdU.uTime.value += dt;
      cheerLv = Math.max(0, cheerLv - dt * 0.22);
      const near = standSpots.some(([x, z]) => (x - px) ** 2 + (z - pz) ** 2 < 150 * 150);
      const want = Math.max(cheerLv, near ? 0.35 : 0);
      crowdU.uExcite.value += (want - crowdU.uExcite.value) * Math.min(1, dt * 3);
    },
  };
  return { center: new THREE.Vector3((x0 + x1) / 2, mean, (z0 + z1) / 2), extent: Math.max(x1 - x0, z1 - z0), crowd, setDetail };
}

/** 樹：成片的樹林（一群一群）加零星散樹；草地是闊葉樹混針葉樹，熱帶、沙漠是棕櫚樹 */
function buildTrees(
  scene: THREE.Scene, meta: CircuitMeta, r: () => number, b: { x0: number; z0: number; x1: number; z1: number },
  clear: (x: number, z: number, d: number) => boolean, hAt: (x: number, z: number) => number,
) {
  const nTrees = { grass: 2400, tropical: 1800, desert: 260, street: 500 }[meta.biome];
  const palm = meta.biome === 'tropical' || meta.biome === 'desert';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // 樹冠形狀
  let kinds: THREE.BufferGeometry[];
  if (palm) {
    const fr: THREE.BufferGeometry[] = [];
    // 葉子是兩段往下垂的薄片（雙面材質），比方塊省三角形
    for (let k = 0; k < 8; k++) {
      const droop = 0.35 + (k % 2) * 0.2, yaw = (k / 8) * Math.PI * 2;
      fr.push(ni(new THREE.PlaneGeometry(0.9, 2).rotateX(-Math.PI / 2).translate(0, 0, 1).rotateX(droop).rotateY(yaw).translate(0, 7.3, 0)));
      const z0 = 2 * Math.cos(droop), y0 = -2 * Math.sin(droop);
      fr.push(ni(new THREE.PlaneGeometry(0.7, 1.8).rotateX(-Math.PI / 2).translate(0, 0, 0.9).rotateX(droop + 0.5).translate(0, y0, z0).rotateY(yaw).translate(0, 7.3, 0)));
    }
    fr.push(ni(new THREE.IcosahedronGeometry(0.55, 0).translate(0, 7.1, 0)));
    kinds = [mergeGeometries(fr)];
  } else {
    // 闊葉：二十面體細分一次、頂點隨機往內外推（一樣的頂點推一樣多，才不會裂開）
    const broad = new THREE.IcosahedronGeometry(2.4, 1);
    const p = broad.attributes.position as THREE.BufferAttribute, push = new Map<string, number>();
    for (let v = 0; v < p.count; v++) {
      const key = `${p.getX(v).toFixed(2)},${p.getY(v).toFixed(2)},${p.getZ(v).toFixed(2)}`;
      if (!push.has(key)) push.set(key, 0.82 + r() * 0.36);
      const k = push.get(key)!;
      p.setXYZ(v, p.getX(v) * k, p.getY(v) * k * 0.85, p.getZ(v) * k);
    }
    broad.translate(0, 4.6, 0).computeVertexNormals();
    const conifer = mergeGeometries([ni(new THREE.ConeGeometry(2.1, 4.4, 8).translate(0, 4.1, 0)), ni(new THREE.ConeGeometry(1.5, 3.4, 8).translate(0, 6.4, 0))]);
    conifer.computeVertexNormals();
    kinds = [broad, conifer];
  }
  // 每種樹各一份樹幹：畫質降低時兩邊一起減量（第 k 棵的樹幹和樹冠編號一樣），才不會有幹沒冠
  const trunkGeo = new THREE.CylinderGeometry(palm ? 0.18 : 0.25, palm ? 0.28 : 0.35, palm ? 7.2 : 3, 6).translate(0, palm ? 3.6 : 1.5, 0), trunkMat = new THREE.MeshLambertMaterial({ color: palm ? '#7a6248' : '#5a4636' });
  const trunks = kinds.map(() => new THREE.InstancedMesh(trunkGeo, trunkMat, nTrees));
  const crowns = kinds.map((g) => new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ flatShading: true, side: palm ? THREE.DoubleSide : THREE.FrontSide }), nTrees));
  const leaf = (palm ? ['#3f7a3a', '#4f8a3e', '#5c8f45'] : ['#3e6b35', '#4a7a3a', '#355f30', '#5b8a45']).map((c) => new THREE.Color(c));
  const pine = ['#2d5230', '#365e36', '#2a4a2c'].map((c) => new THREE.Color(c));
  const col = new THREE.Color();
  // 樹林的中心：散在賽道周圍
  const pad = 500, W = b.x1 - b.x0 + pad * 2, D = b.z1 - b.z0 + pad * 2;
  const groves = Array.from({ length: Math.max(8, Math.round(nTrees / 30)) }, () => ({ x: b.x0 - pad + r() * W, z: b.z0 - pad + r() * D, rad: 40 + r() * 90, pine: r() < 0.4 }));
  let n = 0;
  const cn = crowns.map(() => 0);
  for (let tries = 0; n < nTrees && tries < nTrees * 8; tries++) {
    let x: number, z: number, gr: (typeof groves)[number] | null = null;
    if (r() < 0.72) {
      gr = groves[Math.floor(r() * groves.length)];
      const a = r() * 6.283, d = gr.rad * Math.sqrt(r());
      x = gr.x + Math.cos(a) * d; z = gr.z + Math.sin(a) * d;
    } else { x = b.x0 - pad + r() * W; z = b.z0 - pad + r() * D; }
    if (!clear(x, z, WALL_OFF + 30)) continue;
    const k = 0.75 + r() * 0.75, kind = palm ? 0 : (gr ? gr.pine : r() < 0.3) ? 1 : 0;
    Q.setFromAxisAngle(up, r() * 6.28);
    M.compose(V.set(x, hAt(x, z) - 0.6, z), Q, S.set(k, k * (0.9 + r() * 0.25), k));
    const cm = crowns[kind], ci = cn[kind]++;
    trunks[kind].setMatrixAt(ci, M);
    cm.setMatrixAt(ci, M);
    const base = kind === 1 ? pine : leaf;
    cm.setColorAt(ci, col.copy(base[ci % base.length]).offsetHSL(0, 0, (r() - 0.5) * 0.06));
    n++;
  }
  crowns.forEach((m, k) => { m.count = trunks[k].count = cn[k]; m.computeBoundingSphere(); trunks[k].computeBoundingSphere(); });
  scene.add(...trunks, ...crowns);
  /** 只畫前 keep 比例的樹（樹是隨機撒的，取前面一段就是均勻變稀疏） */
  return (keep: number) => crowns.forEach((m, k) => { m.count = trunks[k].count = Math.round(cn[k] * keep); });
}
