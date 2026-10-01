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
  assist: THREE.Mesh;
  race: THREE.Group;
}

export function buildWorld(scene: THREE.Scene, t: Track): World {
  const rand = rng(20261001);

  // ---- 天空（黃昏漸層）與霧
  const skyGeo = new THREE.SphereGeometry(2500, 32, 16);
  const skyCol: number[] = [];
  const top = new THREE.Color('#1c2552'), mid = new THREE.Color('#b5577a'), hor = new THREE.Color('#ff9d5c');
  const p = skyGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const h = Math.max(0, p.getY(i) / 2500);
    const c = h < 0.12 ? hor.clone().lerp(mid, h / 0.12) : mid.clone().lerp(top, Math.min(1, (h - 0.12) / 0.5));
    skyCol.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyCol, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog('#d98a6c', 300, 2400); // 拉遠一點，整圈都看得到 101

  scene.add(new THREE.HemisphereLight('#b8c6ff', '#4a3428', 1.6));
  const sun = new THREE.DirectionalLight('#ffb47a', 2.2);
  sun.position.set(-600, 220, 300);
  scene.add(sun);

  // ---- 地面
  // 人行道、廣場的顏色（真實道路、綠地另外鋪在上面）
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: '#77746e' }));
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
    new THREE.MeshLambertMaterial({ map: asphalt }),
  ));
  // 路肩（路緣外到護牆外 3 m，路燈立在上面）
  const shoulder = new THREE.MeshLambertMaterial({ color: '#4b4d52' });
  for (const s of [-1, 1]) {
    race.add(new THREE.Mesh(ribbon(t, { a: s * HALF_WIDTH, b: s * (WALL_OFF + 3), ya: -0.01, yb: -0.01, along: 10 }), shoulder));
  }

  // ---- 紅白路緣：只鋪在彎道
  const kerbTex = canvasTex(16, 64, (g) => {
    g.fillStyle = '#d81e2a'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 32, 16, 32);
  });
  const kerbMat = new THREE.MeshLambertMaterial({ map: kerbTex, polygonOffset: true, polygonOffsetFactor: -1 });
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
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
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
    new THREE.MeshLambertMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -3 }),
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

  return { sky, assist, race };
}
