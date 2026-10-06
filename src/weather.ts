import * as THREE from 'three';
import type { World } from './world';

// 時段與天氣：黃昏（預設）、白天、夜晚、雨天、雨夜。
// 建築與樹的影子是預先算好的（方向固定），所以只換光的顏色亮度、天空、霧、窗戶與路燈，不改太陽方向

export type TimeKind = 'dusk' | 'day' | 'night' | 'rain' | 'rainnight';
export const TIME_NAME: Record<TimeKind, string> = { dusk: '黃昏', day: '白天', night: '夜晚', rain: '雨天', rainnight: '雨夜' };

interface Preset {
  sky: [string, string, string]; fog: string; fogMul: number; fogNear: number;
  hemiSky: string; hemiGround: string; hemi: number; sun: string; sunI: number; disc: number; cloud: string; cloudOp: number;
  windows: number; lamp: number; night: boolean; rain: boolean; bloom: number; env: number; tint: [number, number, number]; shadow: number; mtn: [string, string][]; beam: number;
}
const P: Record<TimeKind, Preset> = {
  dusk: { sky: ['#1c2552', '#b5577a', '#ff9d5c'], fog: '#d98a6c', fogMul: 1, fogNear: 300, hemiSky: '#b8c6ff', hemiGround: '#4a3428', hemi: 1.6, sun: '#ffb47a', sunI: 2.2, disc: 1, cloud: '#ffffff', cloudOp: 1, windows: 0.9, lamp: 1, night: false, rain: false, bloom: 0.55, env: 0.75, tint: [1.03, 1, 0.96], shadow: 0.42, mtn: [['#8a7a98', '#d9a88a'], ['#5e4e6e', '#c48a7a']], beam: 0 },
  day: { sky: ['#2f6fc8', '#79b2ea', '#d4e6f4'], fog: '#c4d6e4', fogMul: 1.1, fogNear: 400, hemiSky: '#d6e6ff', hemiGround: '#6e6656', hemi: 1.9, sun: '#fff1dc', sunI: 2.9, disc: 0.7, cloud: '#ffffff', cloudOp: 0.75, windows: 0.12, lamp: 0.35, night: false, rain: false, bloom: 0.22, env: 0.9, tint: [1.0, 1.0, 1.0], shadow: 0.5, mtn: [['#8ea3bd', '#c6d4e1'], ['#6f8299', '#aebfcf']], beam: 0 },
  night: { sky: ['#03050c', '#0b1128', '#26213d'], fog: '#151827', fogMul: 0.75, fogNear: 150, hemiSky: '#43507e', hemiGround: '#17120e', hemi: 0.55, sun: '#8ea4d8', sunI: 0.45, disc: 0, cloud: '#3a3a55', cloudOp: 0.5, windows: 1.3, lamp: 1.7, night: true, rain: false, bloom: 0.7, env: 0.3, tint: [0.96, 0.98, 1.06], shadow: 0.2, mtn: [['#191a2c', '#24243a'], ['#0f1020', '#1b1b2c']], beam: 1 },
  rain: { sky: ['#3b404c', '#686c78', '#8b8b8f'], fog: '#7b7e86', fogMul: 0.55, fogNear: 80, hemiSky: '#a2acc0', hemiGround: '#3a3936', hemi: 1.35, sun: '#d6d8e2', sunI: 0.8, disc: 0, cloud: '#9a9ca6', cloudOp: 0.9, windows: 0.8, lamp: 0.8, night: false, rain: true, bloom: 0.45, env: 0.7, tint: [0.98, 1.0, 1.03], shadow: 0.15, mtn: [['#646872', '#868990'], ['#50545d', '#73767d']], beam: 0.35 },
  rainnight: { sky: ['#06080e', '#12172a', '#262636'], fog: '#1a1d2a', fogMul: 0.5, fogNear: 60, hemiSky: '#3e4a6e', hemiGround: '#141210', hemi: 0.5, sun: '#8090b8', sunI: 0.3, disc: 0, cloud: '#2c2c40', cloudOp: 0.6, windows: 1.2, lamp: 1.8, night: true, rain: true, bloom: 0.75, env: 0.35, tint: [0.95, 0.98, 1.07], shadow: 0.1, mtn: [['#141522', '#1c1d2b'], ['#0c0d18', '#151622']], beam: 1 },
};

/** 雨絲：鏡頭周圍一個 70×40×70 m 的盒子裡往下掉的線段，掉到底就回到上面 */
class Rain {
  mesh: THREE.LineSegments;
  private pos: Float32Array;
  private n: number;
  constructor(scene: THREE.Scene, n: number) {
    this.n = n;
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
  update(dt: number, cam: THREE.Vector3) {
    if (!this.mesh.visible) return;
    const p = this.pos, fall = 26 * dt;
    for (let i = 0; i < this.n; i++) {
      const k = i * 6;
      p[k + 1] -= fall; p[k + 4] -= fall;
      p[k] += 0.12 * fall / 0.9 * 0.1; p[k + 3] += 0.12 * fall / 0.9 * 0.1;
      if (p[k + 4] < -2) { const dy = 40 + Math.random() * 2; p[k + 1] += dy; p[k + 4] += dy; }
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.position.set(cam.x, cam.y - 15, cam.z);
  }
}

/** 車頭燈：地上一片往前延伸的光（加法混色）＋兩顆發亮的燈；掛在車子模型上，晚上才打開 */
export function headlightRig(front = 2.35, y = 0.72, half = 0.62): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d')!;
  // 畫布下緣＝車頭（窄）、上緣＝遠方（寬）；往前漸淡、兩側柔邊
  const grd = x.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, 'rgba(255,242,214,0.42)');
  grd.addColorStop(0.45, 'rgba(255,238,206,0.2)');
  grd.addColorStop(1, 'rgba(255,232,196,0)');
  x.filter = 'blur(5px)';
  x.fillStyle = grd;
  x.beginPath();
  x.moveTo(24, 128); x.lineTo(40, 128); x.lineTo(62, 0); x.lineTo(2, 0);
  x.closePath();
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 16).rotateX(-Math.PI / 2).rotateY(Math.PI), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 }));
  beam.position.set(0, 0.06, front + 7.6);
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
  private roads: { mesh: THREE.Mesh; dry: THREE.Material; wet?: THREE.Material }[] = [];
  private shadowMats: THREE.MeshBasicMaterial[] = [];
  headlights: THREE.Object3D[] = [];
  constructor(private scene: THREE.Scene, private world: World, rainDrops: number) {
    this.rain = new Rain(scene, rainDrops);
  }

  /** 城市載入後掃一遍：有標記的材質（窗戶、路燈、道路、只在晚上出現的東西） */
  collect() {
    this.windows = []; this.lamps = []; this.nightOnly = []; this.roads = []; this.shadowMats = [];
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (o.userData.nightOnly) this.nightOnly.push(o);
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || Array.isArray(m)) return;
      if (m.userData.road) this.roads.push({ mesh: o as THREE.Mesh, dry: m });
      if (seen.has(m)) return;
      seen.add(m);
      if (m.userData.windows) this.windows.push(m as THREE.MeshLambertMaterial);
      if (m.userData.lamp) { m.userData.base ??= (m as THREE.MeshBasicMaterial).color.clone(); this.lamps.push(m as THREE.MeshBasicMaterial); }
      if (m.userData.bakedShadow) this.shadowMats.push(m as THREE.MeshBasicMaterial);
    });
  }

  /** 套用時段；回傳要不要重建環境反射（天空換了） */
  apply(kind: TimeKind, fogFar: number, bloom: { strength: number } | null, grade: { uniforms: Record<string, { value: unknown }> } | null) {
    this.kind = kind;
    const p = P[kind], w = this.world;
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
    for (const h of this.headlights) { h.visible = p.beam > 0; (h.userData.beam as THREE.MeshBasicMaterial).opacity = p.beam; }
    w.setMountains(p.mtn);
    for (const m of this.shadowMats) m.opacity = p.shadow;
    if (bloom) bloom.strength = p.bloom;
    if (grade) (grade.uniforms.tint.value as THREE.Vector3).set(...p.tint);
    this.rain.mesh.visible = p.rain;
    // 濕路面：換成會反光（映出天空與燈）的材質，顏色暗一點
    for (const r of this.roads) {
      if (p.rain) {
        if (!r.wet) {
          const d = r.dry as THREE.MeshLambertMaterial;
          r.wet = new THREE.MeshStandardMaterial({ map: d.map, color: '#8a8c92', roughness: 0.28, metalness: 0.15, side: d.side, polygonOffset: true, polygonOffsetFactor: d.polygonOffsetFactor, polygonOffsetUnits: d.polygonOffsetUnits, envMapIntensity: 1.4 });
        }
        r.mesh.material = r.wet;
      } else r.mesh.material = r.dry;
    }
    return true;
  }

  get night() { return P[this.kind].night; }
  get raining() { return P[this.kind].rain; }
  /** 環境反射用：太陽（月亮）的亮度顏色 */
  get envSun() { const p = P[this.kind]; return new THREE.Color(p.sun).multiplyScalar(p.disc > 0 ? 4 : p.night ? 0.3 : 1.2); }

  update(dt: number, cam: THREE.Vector3) { this.rain.update(dt, cam); }
}
