import * as THREE from 'three';
import type { World } from './world';

// 時段與天氣：黃昏（預設）、白天、夜晚、雨天、雨夜。
// 建築與樹的影子是預先算好的（方向固定），所以只換光的顏色亮度、天空、霧、窗戶與路燈，不改太陽方向

export type TimeKind = 'dusk' | 'day' | 'night' | 'rain' | 'rainnight' | 'auto';
export const TIME_NAME: Record<TimeKind, string> = { dusk: '黃昏', day: '白天', night: '夜晚', rain: '雨天', rainnight: '雨夜', auto: '自動（日夜交替）' };

interface Preset {
  sky: [string, string, string]; fog: string; fogMul: number; fogNear: number;
  hemiSky: string; hemiGround: string; hemi: number; sun: string; sunI: number; disc: number; cloud: string; cloudOp: number;
  windows: number; lamp: number; night: boolean; rain: boolean; bloom: number; env: number; tint: [number, number, number]; shadow: number; mtn: [string, string][]; beam: number;
}
const P: Record<Exclude<TimeKind, 'auto'>, Preset> = {
  dusk: { sky: ['#1c2552', '#b5577a', '#ff9d5c'], fog: '#d98a6c', fogMul: 1, fogNear: 300, hemiSky: '#b8c6ff', hemiGround: '#4a3428', hemi: 1.6, sun: '#ffb47a', sunI: 2.2, disc: 1, cloud: '#ffffff', cloudOp: 1, windows: 0.9, lamp: 1, night: false, rain: false, bloom: 0.55, env: 0.75, tint: [1.03, 1, 0.96], shadow: 0.42, mtn: [['#8a7a98', '#d9a88a'], ['#5e4e6e', '#c48a7a']], beam: 0 },
  day: { sky: ['#2f6fc8', '#79b2ea', '#d4e6f4'], fog: '#c4d6e4', fogMul: 1.1, fogNear: 400, hemiSky: '#d6e6ff', hemiGround: '#6e6656', hemi: 1.9, sun: '#fff1dc', sunI: 2.9, disc: 0.7, cloud: '#ffffff', cloudOp: 0.75, windows: 0.12, lamp: 0.35, night: false, rain: false, bloom: 0.22, env: 0.9, tint: [1.0, 1.0, 1.0], shadow: 0.5, mtn: [['#8ea3bd', '#c6d4e1'], ['#6f8299', '#aebfcf']], beam: 0 },
  night: { sky: ['#03050c', '#0b1128', '#26213d'], fog: '#151827', fogMul: 0.75, fogNear: 150, hemiSky: '#43507e', hemiGround: '#17120e', hemi: 0.55, sun: '#8ea4d8', sunI: 0.45, disc: 0, cloud: '#3a3a55', cloudOp: 0.5, windows: 1.3, lamp: 1.7, night: true, rain: false, bloom: 0.7, env: 0.3, tint: [0.96, 0.98, 1.06], shadow: 0.2, mtn: [['#191a2c', '#24243a'], ['#0f1020', '#1b1b2c']], beam: 1 },
  rain: { sky: ['#3b404c', '#686c78', '#8b8b8f'], fog: '#7b7e86', fogMul: 0.55, fogNear: 80, hemiSky: '#a2acc0', hemiGround: '#3a3936', hemi: 1.35, sun: '#d6d8e2', sunI: 0.8, disc: 0, cloud: '#9a9ca6', cloudOp: 0.9, windows: 0.8, lamp: 0.8, night: false, rain: true, bloom: 0.45, env: 0.7, tint: [0.98, 1.0, 1.03], shadow: 0.15, mtn: [['#646872', '#868990'], ['#50545d', '#73767d']], beam: 0.35 },
  rainnight: { sky: ['#06080e', '#12172a', '#262636'], fog: '#1a1d2a', fogMul: 0.5, fogNear: 60, hemiSky: '#3e4a6e', hemiGround: '#141210', hemi: 0.5, sun: '#8090b8', sunI: 0.3, disc: 0, cloud: '#2c2c40', cloudOp: 0.6, windows: 1.2, lamp: 1.8, night: true, rain: true, bloom: 0.75, env: 0.35, tint: [0.95, 0.98, 1.07], shadow: 0.1, mtn: [['#141522', '#1c1d2b'], ['#0c0d18', '#151622']], beam: 1 },
};

// ---- 自動日夜循環：每段 [時段, 停留秒數, 開始的時鐘（小時）, 結束的時鐘]；段與段之間 30 秒漸變
const CYCLE: [Exclude<TimeKind, 'auto' | 'rain' | 'rainnight'>, number, number, number][] = [
  ['day', 240, 9, 16.5], ['dusk', 120, 17, 18.5], ['night', 240, 19, 28.5], ['dusk', 90, 5, 6.5],
];
const FADE = 30;
export const CYCLE_LEN = CYCLE.reduce((s, c) => s + c[1] + FADE, 0);
/** 循環到 t 秒時：從哪個時段漸變到哪個、進度 0~1、遊戲裡的時鐘（小時）；inFade = 正在漸變 */
export function cycleAt(t: number) {
  t = ((t % CYCLE_LEN) + CYCLE_LEN) % CYCLE_LEN;
  for (let i = 0; i < CYCLE.length; i++) {
    const [k, hold, h0, h1] = CYCLE[i], next = CYCLE[(i + 1) % CYCLE.length];
    if (t < hold) return { from: k, to: k, f: 0, clock: h0 + ((h1 - h0) * t) / hold, inFade: false, seg: i * 2 };
    t -= hold;
    if (t < FADE) return { from: k, to: next[0], f: t / FADE, clock: h1 + (((next[2] + (next[2] < h1 ? 24 : 0)) - h1) * t) / FADE, inFade: true, seg: i * 2 + 1 };
    t -= FADE;
  }
  return { from: 'day' as const, to: 'day' as const, f: 0, clock: 12, inFade: false, seg: 0 };
}
/** 濕路面的顏色（乾路顏色隨雨強度往這個色靠近；原本一下子換成這個色） */
const WET_COLOR = new THREE.Color('#8a8c92');
const lerpC = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;
function blend(a: Preset, b: Preset, t: number): Preset {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pick = t < 0.5 ? a : b;
  return {
    sky: [0, 1, 2].map((i) => lerpC(a.sky[i], b.sky[i], t)) as [string, string, string],
    fog: lerpC(a.fog, b.fog, t), fogMul: lerpN(a.fogMul, b.fogMul, t), fogNear: lerpN(a.fogNear, b.fogNear, t),
    hemiSky: lerpC(a.hemiSky, b.hemiSky, t), hemiGround: lerpC(a.hemiGround, b.hemiGround, t), hemi: lerpN(a.hemi, b.hemi, t),
    sun: lerpC(a.sun, b.sun, t), sunI: lerpN(a.sunI, b.sunI, t), disc: lerpN(a.disc, b.disc, t), cloud: lerpC(a.cloud, b.cloud, t), cloudOp: lerpN(a.cloudOp, b.cloudOp, t),
    windows: lerpN(a.windows, b.windows, t), lamp: lerpN(a.lamp, b.lamp, t), night: pick.night, rain: false, bloom: lerpN(a.bloom, b.bloom, t), env: lerpN(a.env, b.env, t),
    // 自動日夜循環裡 a、b 都不是雨天（rain 一律 false）；基底 ↔ 雨天的混合另外走 Weather.apply 的 rainLevel，不經過這個旗標
    tint: [0, 1, 2].map((i) => lerpN(a.tint[i], b.tint[i], t)) as [number, number, number], shadow: lerpN(a.shadow, b.shadow, t),
    mtn: a.mtn.map((l, i) => [lerpC(l[0], b.mtn[i][0], t), lerpC(l[1], b.mtn[i][1], t)] as [string, string]), beam: lerpN(a.beam, b.beam, t),
  };
}

/** 雨絲：鏡頭周圍一個 70×40×70 m 的盒子裡往下掉的線段，掉到底就回到上面 */
class Rain {
  mesh: THREE.LineSegments;
  private pos: Float32Array;
  private n: number;
  private shown: number; // 目前畫幾條（雨越大越多：下雨開始時是稀稀落落幾滴，不是整批一起出現）
  constructor(scene: THREE.Scene, n: number) {
    this.n = n;
    this.shown = n;
    this.pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 70, y = Math.random() * 40, z = (Math.random() - 0.5) * 70;
      this.pos.set([x, y, z, x + 0.12, y - 0.9, z + 0.06], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#b8c2d4', transparent: true, opacity: 0.45, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  /**
   * 雨強度 0~1 → 畫幾條、多透明。0.3 以下是預兆（天色變暗、還沒下）：沒有雨絲；
   * 0.3 → 1 條數照 ((強度−0.3)/0.7) 的 1.5 次方：剛下時稀稀落落，到大雨才密
   */
  setLevel(level: number) {
    const f = Math.max(0, Math.min(1, (level - 0.3) / 0.7));
    this.shown = Math.round(this.n * Math.pow(f, 1.5));
    this.mesh.geometry.setDrawRange(0, this.shown * 2);
    (this.mesh.material as THREE.LineBasicMaterial).opacity = 0.22 + 0.23 * f;
    this.mesh.visible = this.shown > 0;
  }
  update(dt: number, cam: THREE.Vector3) {
    if (!this.mesh.visible) return;
    const p = this.pos, fall = 26 * dt;
    for (let i = 0; i < this.shown; i++) { // 沒畫的雨絲不用動（小雨時省下大半運算）
      const k = i * 6;
      p[k + 1] -= fall; p[k + 4] -= fall;
      p[k] += 0.12 * fall / 0.9 * 0.1; p[k + 3] += 0.12 * fall / 0.9 * 0.1;
      if (p[k + 4] < -2) { const dy = 40 + Math.random() * 2; p[k + 1] += dy; p[k + 4] += dy; }
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.position.set(cam.x, cam.y - 15, cam.z);
  }
}

/**
 * 頭燈光斑的貼圖（所有車共用一張）：平面 12 m 寬 × 32 m 長，第 0 列在近端（車鼻）、最後一列在最遠。
 * 逐像素算 alpha，用半精度浮點存（8 位元 alpha 在暗部一格就差 6 個顯示色階，尾巴會看到一圈一圈的等高線）：
 *   縱向：從車鼻 2.5 m 內淡入（以前在車鼻直接截斷成一條亮邊），之後 (1−u)^1.2 平順收到 0（尾端斜率 0，看不到終點）
 *   橫向：平頂軟肩 exp(−(|x|/w)³)，w 從近處 2.6 m 隨距離變寬到 4.6 m（照亮一整片路面，不是一條線，邊緣也不會是硬邊）
 */
let beamTex: THREE.DataTexture | null = null;
function beamTexture(): THREE.DataTexture {
  if (beamTex) return beamTex;
  const W = 64, H = 128, data = new Uint16Array(W * H * 4), toH = THREE.DataUtils.toHalfFloat;
  const ss = (e1: number, v: number) => { const t = Math.max(0, Math.min(1, v / e1)); return t * t * (3 - 2 * t); };
  for (let r = 0; r < H; r++) {
    const u = (r + 0.5) / H; // 0 = 車鼻、1 = 最遠
    const along = 0.46 * Math.pow(1 - u, 1.2) * ss(0.08, u), w = 2.6 + 2 * u;
    for (let c = 0; c < W; c++) {
      const xm = ((c + 0.5) / W * 2 - 1) * 6; // 離中線的橫向距離（m）
      const o = (r * W + c) * 4;
      data[o] = toH(1); data[o + 1] = toH(0.87); data[o + 2] = toH(0.64); // 暖白（線性色）
      data[o + 3] = toH(along * Math.exp(-Math.pow(Math.abs(xm) / w, 3)));
    }
  }
  beamTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  beamTex.magFilter = beamTex.minFilter = THREE.LinearFilter;
  beamTex.generateMipmaps = false;
  beamTex.needsUpdate = true;
  return beamTex;
}

/** 車頭燈：地上一片往前延伸的光（加法混色）＋兩顆發亮的燈；掛在車子模型上，晚上才打開 */
export function headlightRig(front = 2.35, y = 0.72, half = 0.62): THREE.Group {
  const g = new THREE.Group();
  // 長 32 m、寬 12 m（以前 16 m × 7 m，而且不到 12 m 就淡光了）：夜間賽車大燈看得到前方約 30 m 的路面
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(12, 32).rotateX(-Math.PI / 2).rotateY(Math.PI), new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 }));
  beam.position.set(0, 0.06, front + 15.6);
  g.add(beam);
  g.userData.beam = beam.material;
  const lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.4), toneMapped: false });
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lens);
    l.position.set(s * half, y, front + 0.02);
    l.userData.lens = true; // 車內視角時藏起來（就在鏡頭正前方）
    g.add(l);
  }
  g.visible = false;
  return g;
}

export class Weather {
  kind: TimeKind = 'dusk';
  private rain: Rain;
  private windows: (THREE.MeshLambertMaterial | THREE.MeshStandardMaterial)[] = [];
  private lamps: THREE.MeshBasicMaterial[] = [];
  private nightOnly: THREE.Object3D[] = [];
  private rainOnly: THREE.Object3D[] = []; // 只有下雨才出現（賽道上的積水）
  private roads: { mesh: THREE.Mesh; dry: THREE.Material; wet?: THREE.Material }[] = [];
  private shadowMats: THREE.MeshBasicMaterial[] = [];
  private nightGlow: THREE.MeshBasicMaterial[] = []; // 晚上變亮的招牌、燈圈（userData.nightScale）
  private nightEmis: THREE.MeshLambertMaterial[] = []; // 晚上換發光色的（101 塔身）
  private nightFade: { mat: THREE.Material & { opacity: number }; meshes: THREE.Object3D[] }[] = []; // 晚上才浮現、隨夜晚程度漸變不透明度的（賽道夜間邊線；userData.nightFade = 最亮時的不透明度）
  private tickers: THREE.Texture[] = []; // 會捲動的跑馬燈
  headlights: THREE.Object3D[] = [];
  constructor(private scene: THREE.Scene, private world: World, rainDrops: number) {
    this.rain = new Rain(scene, rainDrops);
  }

  /** 城市載入後掃一遍：有標記的材質（窗戶、路燈、道路、只在晚上出現的東西） */
  collect() {
    this.windows = []; this.lamps = []; this.nightOnly = []; this.rainOnly = []; this.roads = []; this.shadowMats = []; this.nightGlow = []; this.nightEmis = []; this.nightFade = []; this.tickers = [];
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (o.userData.nightOnly) this.nightOnly.push(o);
      const fm = (o as THREE.Mesh).material as (THREE.Material & { opacity: number }) | undefined;
      if (fm && !Array.isArray(fm) && fm.userData.nightFade !== undefined) {
        let e = this.nightFade.find((x) => x.mat === fm);
        if (!e) this.nightFade.push(e = { mat: fm, meshes: [] });
        e.meshes.push(o);
      }
      if (o.userData.rainOnly) this.rainOnly.push(o);
      if (o.userData.ticker && !this.tickers.includes(o.userData.ticker)) this.tickers.push(o.userData.ticker);
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || Array.isArray(m)) return;
      if (m.userData.road) this.roads.push({ mesh: o as THREE.Mesh, dry: m });
      if (seen.has(m)) return;
      seen.add(m);
      if (m.userData.windows) this.windows.push(m as THREE.MeshLambertMaterial);
      if (m.userData.lamp) { m.userData.base ??= (m as THREE.MeshBasicMaterial).color.clone(); this.lamps.push(m as THREE.MeshBasicMaterial); }
      if (m.userData.bakedShadow) this.shadowMats.push(m as THREE.MeshBasicMaterial);
      if (m.userData.nightScale) this.nightGlow.push(m as THREE.MeshBasicMaterial);
      if (m.userData.nightEmissive) this.nightEmis.push(m as THREE.MeshLambertMaterial);
    });
  }

  private cur: Preset = P.dusk;
  /**
   * 雨強度 0~1（main 每格設）：天空、霧、光、路面、雨絲都在「基底時段」與「同一時段的雨天」之間照強度混合，
   * 所以下雨是慢慢變暗、慢慢變濕，不是同一格整組切換。基底本身是雨天（設定選了雨天／雨夜）時，強度固定當 1
   */
  rainLevel = 0;
  /**
   * 設定選了「雨天／雨夜」時，雨不是一選就整組換：從 0 慢慢下大。這個值是已經下到哪（0~1），由 update 推進；
   * 基底是白天（雨天）或夜晚（雨夜），所以選到雨天 = 白天慢慢下起雨，不是先跳到另一組天空
   */
  private picked = 0;
  private pickedWant = 0;
  /** 設定選了這個時段：雨天／雨夜 → 雨要下到 1，其他 → 收到 0；snap = true 就直接到位（開場、測試），否則慢慢推 */
  pick(kind: TimeKind, snap: boolean) {
    this.pickedWant = kind === 'rain' || kind === 'rainnight' ? 1 : 0;
    if (snap) this.picked = this.pickedWant;
  }
  /** 目前已經下到哪（0~1）；main 在選單裡換時段時，先 snap 到目標做環境反射，再退回這個值慢慢推 */
  get pickedNow() { return this.picked; }
  set pickedNow(v: number) { this.picked = v; }
  /** 套用時段（auto 時 t = 循環到第幾秒，會在兩個時段之間漸變） */
  apply(kind: TimeKind, fogFar: number, bloom: { strength: number } | null, grade: { uniforms: Record<string, { value: unknown }> } | null, t = 0) {
    this.kind = kind;
    // 選的是雨天／雨夜：基底改成白天／夜晚，雨強度由 picked 慢慢推到 1；其他時段維持原本的做法
    const effKind: Exclude<TimeKind, 'auto'> | 'auto' = kind === 'rain' ? 'day' : kind === 'rainnight' ? 'night' : kind;
    let base: Preset;
    if (effKind === 'auto') { const c = cycleAt(t); base = blend(P[c.from], P[c.to], c.f); } else base = P[effKind];
    // 同一個時段的雨天：晚上就是雨夜（auto 循環在夜晚段 night = true）
    const lv = Math.max(0, Math.min(1, Math.max(this.rainLevel, this.picked)));
    const p: Preset = lv > 0 ? { ...blend(base, base.night ? P.rainnight : P.rain, lv), night: base.night } : base;
    this.level = lv;
    this.cur = p;
    const w = this.world;
    w.setSky(...p.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(p.fog);
    fog.near = p.fogNear;
    fog.far = fogFar * p.fogMul;
    w.hemi.color.set(p.hemiSky);
    w.hemi.groundColor.set(p.hemiGround);
    w.hemi.intensity = p.hemi;
    w.sun.color.set(p.sun);
    w.sun.intensity = p.sunI;
    w.sunDisc.visible = p.disc > 0;
    w.sunDisc.material.opacity = p.disc;
    const cm = w.clouds.material as THREE.MeshBasicMaterial;
    cm.color.set(p.cloud);
    cm.opacity = p.cloudOp;
    this.scene.environmentIntensity = p.env;
    for (const m of this.windows) m.emissiveIntensity = p.windows;
    for (const m of this.lamps) m.color.copy(m.userData.base as THREE.Color).multiplyScalar(p.lamp);
    for (const o of this.nightOnly) o.visible = p.night;
    for (const h of this.headlights) { h.visible = p.beam > 0; h.userData.beamBase = p.beam; (h.userData.beam as THREE.MeshBasicMaterial).opacity = p.beam; }
    w.setMountains(p.mtn);
    for (const m of this.shadowMats) m.opacity = p.shadow;
    // 夜晚程度 0~1（照窗戶亮度換算，自動循環時會跟著漸變）
    const nightness = Math.max(0, Math.min(1, (p.windows - 0.12) / (1.25 - 0.12)));
    for (const m of this.nightGlow) m.color.setScalar(0.85 + ((m.userData.nightScale as number) - 0.85) * nightness);
    for (const m of this.nightEmis) { const [d, n] = m.userData.nightEmissive as [string, string]; m.emissive.set(d).lerp(new THREE.Color(n), nightness); }
    // 深夜程度：夜晚程度 0.75 以下是 0（黃昏約 0.69，不能受影響）、1.0 時全開；夜間邊線這類「只有真的夜裡才需要」的東西看這個
    const deep = Math.max(0, Math.min(1, (nightness - 0.75) / 0.25)), deepS = deep * deep * (3 - 2 * deep);
    for (const f of this.nightFade) { f.mat.opacity = (f.mat.userData.nightFade as number) * deepS; for (const o of f.meshes) o.visible = deepS > 0.005; }
    if (bloom) bloom.strength = p.bloom;
    if (grade) (grade.uniforms.tint.value as THREE.Vector3).set(...p.tint);
    // 雨絲：強度越大越密（小雨稀稀落落）
    this.rain.setLevel(lv);
    // 強度 0~0.3 是預兆（天色變暗、霧變近，還沒下）；0.3 之後才真的在下，下面這些都從 0.3 開始算
    // 只在下雨才有的東西：積水（透明材質）隨強度浮現，0.5 之後才看得到、到 0.9 全開；F1 雨燈（不透明）一開始下就亮
    for (const o of this.rainOnly) {
      const m = (o as THREE.Mesh).material as THREE.Material & { opacity: number };
      if (m.transparent) {
        m.userData.baseOpacity ??= m.opacity;
        const f = Math.max(0, Math.min(1, (lv - 0.5) / 0.4));
        m.opacity = (m.userData.baseOpacity as number) * f;
        o.visible = f > 0;
      } else o.visible = lv > 0.3;
    }
    // 濕路面：換成會反光（映出天空與燈）的材質，顏色暗一點。乾路是 Lambert、濕路是 Standard，著色器不同不能直接插值，
    // 所以一開始下（強度過 0.3）就換材質，但換上去的那一刻顏色、粗糙度還接近乾路，再隨強度慢慢變暗、變亮面（看不出換材質的那一格）
    const wet = Math.max(0, Math.min(1, (lv - 0.3) / 0.7));
    for (const r of this.roads) {
      if (lv > 0.3) {
        const w = this.wetOf(r.dry), d = r.dry as THREE.MeshLambertMaterial;
        w.color.copy(d.color).lerp(WET_COLOR, wet);
        w.roughness = 0.9 - (0.9 - 0.28) * wet;
        w.metalness = 0.15 * wet;
        r.mesh.material = w;
      } else r.mesh.material = r.dry;
    }
    return true;
  }
  /** 雨強度（套用後的值；基底是雨天時是 1） */
  private level = 0;
  /** 每個乾路材質共用一個濕路材質（同一種乾路有很多個 mesh） */
  private wetMats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private wetOf(dry: THREE.Material) {
    let w = this.wetMats.get(dry);
    if (!w) {
      const d = dry as THREE.MeshLambertMaterial;
      // 反光強弱靠 roughness／metalness（材質沒有自己的 envMap 時，three 一律用 scene.environmentIntensity，envMapIntensity 設了也沒用）
      w = new THREE.MeshStandardMaterial({ map: d.map, color: d.color.clone(), roughness: 0.9, metalness: 0, side: d.side, polygonOffset: true, polygonOffsetFactor: d.polygonOffsetFactor, polygonOffsetUnits: d.polygonOffsetUnits });
      this.wetMats.set(dry, w);
    }
    return w;
  }
  /** 開場就把濕路材質建好、掛在一個隱藏的代表上，讓 main 的 compileAsync 一起編著色器（不然第一次下雨那一格會卡） */
  prepareWet(scene: THREE.Scene) {
    for (const r of this.roads) {
      const w = this.wetOf(r.dry);
      if (w.userData.proxy) continue;
      const proxy = new THREE.Mesh(r.mesh.geometry, w);
      proxy.visible = false;
      proxy.frustumCulled = false;
      w.userData.proxy = proxy;
      scene.add(proxy);
    }
  }

  /** 目前時段的太陽、天空光強度（隧道裡調暗用） */
  get sunI() { return this.cur.sunI; }
  get hemiI() { return this.cur.hemi; }
  get night() { return this.cur.night; }
  /** 有在下雨（強度過 0.3，預兆期之後：車開燈這類「下或不下」的東西看這個） */
  get raining() { return this.level > 0.3; }
  /** 雨強度 0~1（雨聲、座艙雨滴、積水水花這類「越大越多」的東西看這個） */
  get rain01() { return this.level; }
  /** 環境反射用：太陽（月亮）的亮度顏色 */
  get envSun() { const p = this.cur; return new THREE.Color(p.sun).multiplyScalar(p.disc > 0.3 ? 4 : p.night ? 0.3 : 1.2); }

  /** 選了雨天／雨夜之後，雨強度慢慢推到目標（下大約 8 秒、收掉約 6 秒）；變化夠大才重套天氣 */
  private pickedAcc = 0;
  stepPicked(dt: number, reapply: () => void) {
    const d = this.pickedWant - this.picked;
    if (d === 0) return;
    this.picked += Math.max(-dt / 6, Math.min(dt / 8, d));
    this.pickedAcc += dt;
    if (this.pickedAcc > 0.25 || this.picked === this.pickedWant) { this.pickedAcc = 0; reapply(); }
  }
  update(dt: number, cam: THREE.Vector3) {
    this.rain.update(dt, cam);
    for (const t of this.tickers) t.offset.x = (t.offset.x + dt * 0.035) % 1;
  }
}
