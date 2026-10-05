import * as THREE from 'three';
import { HALF_WIDTH, WALL_OFF, VMAX, type Track } from './track';

// 賽道本身（路面、路緣、護牆、門架、路燈）與天空光線；城市建築在 city.ts（真實 OpenStreetMap 資料）
// 沒有外部模型、沒有圖片檔，貼圖全用 canvas 畫

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/**
 * 台北盆地四周的遠山（天空的一部分，跟著鏡頭走、沒有視差）：
 * 依方位（從北順時針）給「仰角」——陽明山在北、觀音山在西北、四獸山／南港山在東、新店山區在南
 * 兩層：遠的淡（大氣透視）、近的深
 */
function farMountains(): THREE.Group {
  const g = new THREE.Group();
  const R = 2250;
  const layers: [number, [number, number][], string, string][] = [
    // 遠層：仰角（度）
    [R, [[0, 3.9], [20, 3.2], [40, 2.5], [60, 2.9], [80, 3.6], [100, 3.4], [125, 3.0], [150, 2.4], [175, 2.7], [200, 2.2], [225, 1.5], [250, 0.9], [270, 0.7], [290, 1.8], [305, 2.2], [320, 3.0], [340, 4.4], [360, 3.9]], '#8a7a98', '#d9a88a'],
    // 近層：比較低、比較深（東邊的南港山、南邊的山麓）
    [R * 0.97, [[0, 1.6], [30, 1.1], [60, 1.9], [85, 3.2], [105, 2.9], [130, 2.2], [160, 1.6], [190, 1.4], [220, 0.8], [260, 0.4], [300, 0.9], [330, 1.6], [360, 1.6]], '#5e4e6e', '#c48a7a'],
  ];
  layers.forEach(([rad, prof, top, bottom], li) => {
    const pos: number[] = [], col: number[] = [];
    const cTop = new THREE.Color(top), cBot = new THREE.Color(bottom);
    const at = (deg: number) => {
      let k = 0;
      while (k < prof.length - 2 && prof[k + 1][0] < deg) k++;
      const [a0, h0] = prof[k], [a1, h1] = prof[k + 1];
      const f = (deg - a0) / (a1 - a0 || 1);
      const base = h0 + (h1 - h0) * (f * f * (3 - 2 * f));
      // 稜線起伏：幾個頻率疊起來
      const r = deg * (Math.PI / 180);
      return Math.max(0.2, base + 0.35 * Math.sin(r * 23 + li) + 0.2 * Math.sin(r * 61 + li * 3) + 0.12 * Math.sin(r * 137));
    };
    for (let d = 0; d < 360; d += 1) {
      const b0 = (d * Math.PI) / 180, b1 = ((d + 1) * Math.PI) / 180;
      const e0 = (at(d) * Math.PI) / 180, e1 = (at(d + 1) * Math.PI) / 180;
      // 方位 b（從北順時針）→ 方向 (sin b, -cos b)：x 向東、z 向南
      const p = (b: number, y: number) => [Math.sin(b) * rad, y, -Math.cos(b) * rad];
      const A = p(b0, -120), B = p(b1, -120), C = p(b1, Math.tan(e1) * rad), D = p(b0, Math.tan(e0) * rad);
      pos.push(...A, ...C, ...B, ...A, ...D, ...C);
      for (const c of [cBot, cTop, cBot, cBot, cTop, cTop]) col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.userData.top = Float32Array.from(col.filter((_, i) => i % 3 === 0).map((_, v) => ([1, 4, 5].includes(v % 6) ? 1 : 0))); // 每個頂點是稜線（1）還是山腳（0）
    // 會寫入深度：山後面那片（霧色的）遠方地面被山擋住，從高空看山腳才不會跟地面之間空出一條天空
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -0.5 + li * 0.1; // 天空（-1）之後、城市之前
    g.add(m);
  });
  return g;
}

/** 太陽方向（從地面指向太陽）：夕陽在西北偏西、仰角約 18° */
export const SUN_DIR = new THREE.Vector3(-600, 220, 300).normalize();
/** 地面影子：每 1 m 高度往哪個方向延伸多遠（太陽的反方向） */
export const SHADOW_PER_M = { x: -SUN_DIR.x / SUN_DIR.y, z: -SUN_DIR.z / SUN_DIR.y };

/** 預先算好的影子共用材質：半透明深色、用 stencil 讓重疊的影子不會疊得更黑 */
let shadowMat: THREE.MeshBasicMaterial | null = null;
export function bakedShadowMaterial(map?: THREE.Texture) {
  const m = new THREE.MeshBasicMaterial({
    color: '#1b1530', transparent: true, opacity: 0.42, depthWrite: false, fog: true, map: map ?? null, alphaTest: map ? 0.04 : 0,
    polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -150,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  if (!map) { shadowMat ??= m; shadowMat.userData.bakedShadow = true; } // 太陽投出來的影子：晚上、陰天要淡（weather.ts）；車底的柔邊影子不變
  return map ? m : shadowMat!;
}
/** 柔邊的橢圓影子貼圖（樹、車、人） */
let blobTex: THREE.Texture | null = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  blobTex = canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }, false);
  return blobTex;
}

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

interface RibbonOpt {
  a: number; // 起點橫向偏移
  b: number; // 終點橫向偏移
  ya: number;
  yb: number;
  along: number; // 貼圖沿賽道方向每幾公尺重複一次；負數 = 左右翻轉
  alongIsU?: boolean; // 沿賽道方向放在 u（看板文字用）
  mask?: (i: number) => boolean;
  color?: (i: number) => THREE.Color;
}

/** 沿著賽道拉一條帶狀網格：路面、路緣、護牆、輔助線都用它 */
function ribbon(t: Track, o: RibbonOpt): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const vert = (i: number, off: number, y: number, across: number, d: number) => {
    pos.push(t.px[i] - t.tz[i] * off, y, t.pz[i] + t.tx[i] * off);
    const along = d / o.along;
    if (o.alongIsU) uv.push(along, across); else uv.push(across, along);
    if (o.color) { const c = o.color(i); col.push(c.r, c.g, c.b); }
  };
  for (let i = 0; i < t.N; i++) {
    if (o.mask && !o.mask(i)) continue;
    const j = (i + 1) % t.N;
    const d0 = t.dist[i], d1 = j === 0 ? t.length : t.dist[j];
    vert(i, o.a, o.ya, 0, d0); vert(i, o.b, o.yb, 1, d0); vert(j, o.a, o.ya, 0, d1);
    vert(i, o.b, o.yb, 1, d0); vert(j, o.b, o.yb, 1, d1); vert(j, o.a, o.ya, 0, d1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (o.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export interface World {
  sky: THREE.Mesh;
  /** 遠山：跟著天空水平移動，但山腳固定在地面高度（每格由 main 設 y = -鏡頭高度） */
  mountains: THREE.Group;
  assist: THREE.Mesh;
  race: THREE.Group;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  hemi: THREE.HemisphereLight;
  sunDisc: THREE.Sprite;
  clouds: THREE.Mesh;
  /** 重新上色天空漸層（頂、中、地平線）：換時段天氣用 */
  setSky: (top: string, mid: string, hor: string) => void;
  /** 重新上色遠山：每層 [稜線色, 山腳色]（遠層、近層） */
  setMountains: (layers: [string, string][]) => void;
}

export function buildWorld(scene: THREE.Scene, t: Track): World {
  const rand = rng(20261001);

  // ---- 天空（黃昏漸層）與霧
  const skyGeo = new THREE.SphereGeometry(2500, 32, 16);
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const setSky = (topC: string, midC: string, horC: string) => {
    const top = new THREE.Color(topC), mid = new THREE.Color(midC), hor = new THREE.Color(horC);
    const p = skyGeo.attributes.position, col = skyGeo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const h = Math.max(0, p.getY(i) / 2500);
      const c = h < 0.12 ? hor.clone().lerp(mid, h / 0.12) : mid.clone().lerp(top, Math.min(1, (h - 0.12) / 0.5));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  };
  setSky('#1c2552', '#b5577a', '#ff9d5c'); // 黃昏（預設）
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog('#d98a6c', 300, 2400); // 拉遠一點，整圈都看得到 101

  const hemi = new THREE.HemisphereLight('#b8c6ff', '#4a3428', 1.6);
  scene.add(hemi);
  // 夕陽：低角度的平行光（main.ts 會讓它跟著玩家，陰影才夠細）
  const sunDir = SUN_DIR.clone();
  const sun = new THREE.DirectionalLight('#ffb47a', 2.2);
  sun.position.copy(sunDir).multiplyScalar(400);
  scene.add(sun, sun.target);
  // 太陽本體：天空上一個發光的圓（開了光暈會暈開），跟天空一起跟著鏡頭
  const sunTex = canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,248,225,1)');
    grd.addColorStop(0.25, 'rgba(255,214,150,0.95)');
    grd.addColorStop(0.6, 'rgba(255,150,80,0.25)');
    grd.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }, false);
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, toneMapped: false, transparent: true }));
  sunDisc.scale.setScalar(420);
  sunDisc.position.copy(sunDir).multiplyScalar(2300);
  sky.add(sunDisc);
  // 晚霞雲層：上半球一圈半透明的雲（canvas 隨機畫柔邊雲團），靠太陽那側偏橘、另一側偏粉紫
  const cloudTex = canvasTex(1024, 256, (g) => {
    g.clearRect(0, 0, 1024, 256);
    const rr = rng(77);
    for (let k = 0; k < 140; k++) {
      const x = rr() * 1024, y = 40 + rr() * 170, rad = 20 + rr() * 70;
      const warm = Math.abs(x / 1024 - 0.62) < 0.2;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = warm ? '255,190,140' : '230,160,190';
      grd.addColorStop(0, `rgba(${c},${0.22 + rr() * 0.2})`);
      grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });
  cloudTex.wrapT = THREE.ClampToEdgeWrapping;
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 48, 12, 0, Math.PI * 2, Math.PI * 0.18, Math.PI * 0.3),
    new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  clouds.rotation.y = Math.atan2(sunDir.x, sunDir.z) - Math.PI * 0.62 * 2;
  sky.add(clouds);
  const mountains = farMountains();
  sky.add(mountains);

  // ---- 地面
  // 人行道、廣場的顏色（真實道路、綠地另外鋪在上面）
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14000, 12000), new THREE.MeshLambertMaterial({ color: '#77746e' })); // 地圖擴大後要更大
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(200, -0.6, 50); // 各層高度拉開，手機的深度精度才不會讓地面蓋過路面
  scene.add(ground);

  // 以下是街道賽才有的東西（封路的護牆、路緣、門架、輔助線…），自由駕駛時整組隱藏
  const race = new THREE.Group();
  scene.add(race);

  // ---- 路面：柏油 + 兩側白線
  const asphalt = canvasTex(256, 512, (g) => {
    g.fillStyle = '#3d3f44';
    g.fillRect(0, 0, 256, 512);
    for (let k = 0; k < 4000; k++) {
      const v = 50 + Math.random() * 30;
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2);
    }
    g.fillStyle = '#e8e8e8';
    g.fillRect(5, 0, 7, 512);
    g.fillRect(244, 0, 7, 512);
  });
  race.add(new THREE.Mesh(
    ribbon(t, { a: -HALF_WIDTH, b: HALF_WIDTH, ya: 0, yb: 0, along: 12 }),
    // 城市道路的標線有往鏡頭偏移（避免閃爍），賽道路面要偏移得更多，才不會被底下的雙黃線透出來
    new THREE.MeshLambertMaterial({ map: asphalt, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -60 }),
  ));
  // 路肩（路緣外到護牆外 3 m，路燈立在上面）
  const shoulder = new THREE.MeshLambertMaterial({ color: '#4b4d52', polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -60 });
  for (const s of [-1, 1]) {
    race.add(new THREE.Mesh(ribbon(t, { a: s * HALF_WIDTH, b: s * (WALL_OFF + 3), ya: -0.01, yb: -0.01, along: 10 }), shoulder));
  }

  // ---- 紅白路緣：只鋪在彎道
  const kerbTex = canvasTex(16, 64, (g) => {
    g.fillStyle = '#d81e2a'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 32, 16, 32);
  });
  const kerbMat = new THREE.MeshLambertMaterial({ map: kerbTex, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -70 });
  const inCorner = (i: number) => Math.abs(t.curv[i]) > 1 / 200;
  for (const s of [-1, 1]) {
    race.add(new THREE.Mesh(ribbon(t, { a: s * (HALF_WIDTH - 0.6), b: s * (HALF_WIDTH + 1.2), ya: 0.02, yb: 0.02, along: 4, mask: inCorner }), kerbMat));
  }

  // ---- 行車輔助線：綠 = 可以全油門，黃 = 彎中，紅 = 該煞車
  const red = new THREE.Color('#ff2a2a'), yellow = new THREE.Color('#ffd23a'), green = new THREE.Color('#2aff7a');
  const assist = new THREE.Mesh(
    ribbon(t, {
      a: -0.45, b: 0.45, ya: 0.04, yb: 0.04, along: 10,
      color: (i) => {
        const ahead = t.vTarget[(i + 2) % t.N];
        if (ahead < t.vTarget[i] - 0.15) return red;
        if (t.vTarget[i] < VMAX * 0.93) return yellow;
        return green;
      },
    }),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -80 }),
  );
  race.add(assist);

  // ---- 起跑線（棋盤格）
  const checker = canvasTex(64, 16, (g) => {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  });
  race.add(new THREE.Mesh(
    ribbon(t, { a: -HALF_WIDTH, b: HALF_WIDTH, ya: 0.03, yb: 0.03, along: 2, mask: (i) => i === 0 }),
    new THREE.MeshLambertMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -80 }),
  ));

  // ---- 護牆 + 廣告看板
  const ads = ['台北街道賽', 'TAIPEI STREET GP', '珍珠奶茶', '信義區', '夜市美食', 'XINYI 2026', '鹹酥雞', 'NIGHT RACE'];
  const adCols = ['#d81e2a', '#13306b', '#0f7a4a', '#f2f2f2', '#ff7a00', '#5a1a8a'];
  const wallTex = canvasTex(2048, 64, (g) => {
    for (let k = 0; k < 8; k++) {
      const bg = adCols[k % adCols.length];
      g.fillStyle = bg;
      g.fillRect(k * 256, 0, 256, 64);
      g.fillStyle = bg === '#f2f2f2' ? '#d81e2a' : '#ffffff';
      g.font = 'bold 34px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ads[k], k * 256 + 128, 34, 240);
    }
  });
  wallTex.wrapT = THREE.ClampToEdgeWrapping;
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    // 右側牆要把文字翻過來，從賽道上看才是正的
    race.add(new THREE.Mesh(ribbon(t, { a: s * WALL_OFF, b: s * WALL_OFF, ya: 0, yb: 1.2, along: s * -38, alongIsU: true }), wallMat));
  }
  // 牆頂的鐵絲網（半透明灰）
  const fenceMat = new THREE.MeshBasicMaterial({ color: '#9aa0a8', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  for (const s of [-1, 1]) {
    race.add(new THREE.Mesh(ribbon(t, { a: s * WALL_OFF, b: s * WALL_OFF, ya: 1.2, yb: 3.6, along: 10 }), fenceMat));
  }

  // ---- 起點門架
  {
    const i = 4, off = WALL_OFF + 0.6;
    const ang = Math.atan2(t.tx[i], t.tz[i]);
    const g = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: '#2a2d33' });
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), metal);
      pillar.position.set(-s * off, 4.5, 0);
      g.add(pillar);
    }
    const banner = canvasTex(1024, 96, (c) => {
      c.fillStyle = '#d81e2a'; c.fillRect(0, 0, 1024, 96);
      c.fillStyle = '#fff';
      c.font = 'bold 60px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('台北街道賽  TAIPEI GP', 512, 52);
    }, false);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(off * 2 + 0.8, 1.8, 0.6), [metal, metal, metal, metal, new THREE.MeshBasicMaterial({ map: banner }), new THREE.MeshBasicMaterial({ map: banner })]);
    beam.position.y = 8.6;
    g.add(beam);
    g.position.set(t.px[i], 0, t.pz[i]);
    g.rotation.y = ang;
    race.add(g);
  }

  // ---- 路燈（InstancedMesh：幾百支只要兩次繪製）
  {
    const lamps: { x: number; z: number; ang: number }[] = [];
    for (let i = 0, k = 0; i < t.N; i += 20, k++) {
      const s = k % 2 ? 1 : -1;
      const off = s * (WALL_OFF + 0.7);
      lamps.push({ x: t.px[i] - t.tz[i] * off, z: t.pz[i] + t.tx[i] * off, ang: Math.atan2(t.tx[i], t.tz[i]) + (s > 0 ? 0 : Math.PI) });
    }
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 6), new THREE.MeshLambertMaterial({ color: '#555a62' }), lamps.length);
    const headGeo = new THREE.BoxGeometry(1.6, 0.2, 0.45).translate(0.8, 0, 0);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: '#ffe2b0' }), lamps.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    lamps.forEach((l, n) => {
      q.setFromAxisAngle(up, l.ang);
      m.compose(new THREE.Vector3(l.x, 4.5, l.z), q, one);
      pole.setMatrixAt(n, m);
      m.compose(new THREE.Vector3(l.x, 9, l.z), q, one);
      head.setMatrixAt(n, m);
    });
    race.add(pole, head);
  }

  const setMountains = (layers: [string, string][]) => {
    mountains.children.forEach((m, li) => {
      const g = (m as THREE.Mesh).geometry, col = g.attributes.color as THREE.BufferAttribute, top = g.userData.top as Float32Array;
      const [ct, cb] = (layers[li] ?? layers[0]).map((c) => new THREE.Color(c));
      for (let v = 0; v < col.count; v++) { const c = top[v] ? ct : cb; col.setXYZ(v, c.r, c.g, c.b); }
      col.needsUpdate = true;
    });
  };
  return { sky, mountains, assist, race, sun, sunDir, hemi, sunDisc, clouds, setSky, setMountains };
}
