import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF_WIDTH, WALL_OFF, type Track } from './track';
import { TEAMS } from './f1model';
import { canvasTex } from './world';

// 維修區（F1 的進站）：起跑線右側一條維修道。
// 進站口在線前 330 m 從賽道右側分出去、線前 150 m 是限速線，限速線之間是快車道（靠賽道）＋作業車道（靠車庫），
// 每隊一個停車格；線後 150 m 解除限速、330 m 匯回賽道。進出維修區全程自動駕駛（跟 F1 遊戲一樣），
// 位置與速度由 rivals.ts 推進；這裡負責幾何、外觀，以及維修人員（千斤頂、換胎、放行）的動畫。

export const PIT = {
  IN: -330, // 進站口（離起跑線的帶號距離，負 = 線前）
  TAPER: -200, // 到這裡完全離開賽道、進到快車道
  LIM_IN: -150, // 限速線
  LIM_OUT: 150,
  TAPER_OUT: 200,
  OUT: 330, // 出站口：回到賽道
  FAST: 15, // 快車道中心（右正，護牆 9.5 m 外）
  WORK: 20, // 作業車道（停車格）中心
  HALF: 2.5, // 一條車道的半寬
  G0: -130, // 車庫（11 隊停車格）的範圍：夠直的區間（fitPit 決定）；彎道裡的賽道會縮短
  G1: 130,
  BUILD: true, // 這條賽道能不能蓋車庫建築（車庫段整段都是急彎，像摩納哥、拉斯維加斯，就只畫停車格，沒有建築）
};

/**
 * 依賽道調整進出站車道的長度：從車庫往前、往後各最多 330 m，遇到曲率半徑 < 170 m 的彎就在彎之前 50 m 收住
 * （髮夾彎裡畫不出車道：偏移 15~24 m 比彎的半徑還大，車道會翻面、切進彎內側的草地）。
 * 進站口至少要在限速線前 90 m（車子才有時間降速）；車庫段（±150 m）本身就彎的賽道（拉斯維加斯）不縮，由 pitlane 把車道貼得近一點
 */
export function fitPit(t: Track) {
  const L = t.length;
  // 車庫範圍：-130 ~ 130 m 裡曲率半徑 ≥ 130 m 的最長連續區間（車庫深 16 m、屋頂 26 m，彎的半徑比這小，建築會翻面）；太短（< 80 m）就不蓋車庫，停車格擺在中間 80 m
  {
    let best: [number, number] = [0, 0], cur = NaN;
    const ok = (sd: number) => 1 / Math.max(1e-6, Math.abs(t.curv[Math.floor((((sd + L) % L) / t.ds)) % t.N])) >= 130;
    for (let sd = -130; sd <= 134; sd += 4) {
      if (sd <= 130 && ok(sd)) { if (Number.isNaN(cur)) cur = sd; }
      else if (!Number.isNaN(cur)) { if (sd - 4 - cur > best[1] - best[0]) best = [cur, sd - 4]; cur = NaN; }
    }
    PIT.G0 = best[0]; PIT.G1 = best[1]; PIT.BUILD = true;
    if (PIT.G1 - PIT.G0 < 120) { PIT.G0 = -110; PIT.G1 = 110; PIT.BUILD = false; } // 沒有夠長的直線：不蓋車庫建築，停車格照 ±110 m 排（維修道、人員照常）
  }
  const R = (sd: number) => 1 / Math.max(1e-6, Math.abs(t.curv[Math.floor((((sd + L) % L) / t.ds)) % t.N]));
  const CUT = 170;
  let inn = -330, out = 330;
  for (let sd = -160; sd >= -330; sd -= 6) if (R(sd) < CUT) { inn = sd + 50 > -150 - 90 ? -150 - 90 : sd + 50; break; }
  for (let sd = 160; sd <= 330; sd += 6) if (R(sd) < CUT) { out = sd - 50 < 150 + 90 ? 150 + 90 : sd - 50; break; }
  PIT.IN = inn; PIT.OUT = out;
  // 離開／回到賽道的過渡段：預設 130 m（-330 → -200），進出站口縮短時等比縮，但至少 60 m、且要在限速線前 40 m 完成
  PIT.TAPER = Math.min(inn + Math.max(60, Math.round(130 * (-150 - inn) / 180)), PIT.LIM_IN - 40);
  PIT.TAPER_OUT = Math.max(out - Math.max(60, Math.round(130 * (out - 150) / 180)), PIT.LIM_OUT + 40);
}

const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/** 維修區限速：摩納哥 60 km/h，其他 80 km/h */
export const pitSpeed = (circuitId?: string) => ((circuitId === 'monaco' ? 60 : 80) / 3.6);
/** 第 k 隊停車格的位置（離起跑線的帶號距離）：11 隊平均排在車庫前（-130 ~ 130 m）；
 *  跟 circuitenv 車庫門的貼圖同一個順序（右側的貼圖從賽道上看由右往左排，第 0 隊在 +130 m 那頭） */
export const boxS = (k: number) => PIT.G1 - ((k + 0.5) * (PIT.G1 - PIT.G0)) / TEAMS.length;
/** 賽道位置 s（0 ~ 全長）→ 離起跑線的帶號距離 */
export const signedS = (t: Track, s: number) => (s > t.length / 2 ? s - t.length : s);
/** 快車道中心線的橫向位置；entry／exit = 進站前、出站後在賽道上的橫向位置 */
export function laneLat(sd: number, entry = 5, exit = 5): number {
  if (sd <= PIT.IN) return entry;
  if (sd < PIT.TAPER) return entry + (PIT.FAST - entry) * smooth((sd - PIT.IN) / (PIT.TAPER - PIT.IN));
  if (sd <= PIT.TAPER_OUT) return PIT.FAST;
  if (sd < PIT.OUT) return PIT.FAST + (exit - PIT.FAST) * smooth((sd - PIT.TAPER_OUT) / (PIT.OUT - PIT.TAPER_OUT));
  return exit;
}
/** 作業車道有多寬（0 ~ 1）：限速線前後 35 m 漸寬 */
const workW = (sd: number) => smooth((sd - (PIT.LIM_IN - 35)) / 35) * smooth(((PIT.LIM_OUT + 35) - sd) / 35);
/** 右側護牆在第 i 點要不要開口（進出站的車道穿過護牆的那段） */
export function wallOpen(t: Track, i: number): boolean {
  const sd = signedS(t, t.dist[i]);
  if (sd < PIT.IN - 8 || sd > PIT.OUT + 8) return false;
  const c = laneLat(sd);
  return c - PIT.HALF < WALL_OFF + 0.8 && c + PIT.HALF > WALL_OFF - 0.8;
}

/** 一次停站給維修人員動畫用的資料（rivals.ts 每格給） */
export interface StopInfo {
  phase: 'approach' | 'service' | 'release';
  t: number; // 停好之後過了幾秒（approach 時 0）
  T: number; // 這次停站總共幾秒
  slow: number; // 出包的那個輪子（-1 沒有）
  newColor: string; // 新胎的顏色（胎種）
}

// 維修人員的角色：在停車格座標（a 沿賽道往前、b 往車庫方向）的站位
const WHEELS: [number, number][] = [[1.75, -0.95], [1.75, 0.95], [-1.6, -0.95], [-1.6, 0.95]]; // 左前、右前、左後、右後
const CREW_N = 15; // 每個輪子 3 人（槍手、拆胎、裝胎）＋前後千斤頂＋放行

export class PitLane {
  readonly speed: number;
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private tyre: THREE.InstancedMesh;
  private band: THREE.InstancedMesh;
  private sign: THREE.InstancedMesh;
  /** 每隊每人目前的 [a, b, 蹲（0 站 ~ 1 蹲）] */
  private pose: Float32Array;
  /** 每隊 8 顆輪胎（4 舊 4 新）目前的 [a, b, 高度]；看不到的高度設 -9 */
  private tyres: Float32Array;
  private active = new Set<number>();
  private linger = new Float32Array(TEAMS.length);
  private frames: { x: number; y: number; z: number; h: number }[] = [];
  private M = new THREE.Matrix4(); private Q = new THREE.Quaternion(); private V = new THREE.Vector3(); private S = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(parent: THREE.Object3D, private t: Track, garages: boolean, circuitId?: string) {
    fitPit(t);
    this.speed = pitSpeed(circuitId);
    const L = t.length, N = t.N;
    const iOf = (sd: number) => Math.round(((sd + L) % L) / t.ds) % N;
    /** (sd, lat) → 世界座標（取最近的取樣點；起跑直線上誤差很小） */
    const P = (sd: number, lat: number, y = 0): [number, number, number] => {
      const f = (((sd + L) % L) / t.ds), i = Math.floor(f) % N, j = (i + 1) % N, k = f - Math.floor(f);
      const px = t.px[i] + (t.px[j] - t.px[i]) * k, pz = t.pz[i] + (t.pz[j] - t.pz[i]) * k;
      // 傾斜彎：路面外的路肩、維修道維持路緣的高度（跟 surfaceY 一樣夾在路面半寬內），不然傾斜彎旁邊的維修道會比路肩高 2 m 多
      const edge = Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, lat));
      const py = t.py[i] + edge * t.bank[i] + (t.py[j] + edge * t.bank[j] - t.py[i] - edge * t.bank[i]) * k;
      const tx = t.tx[i], tz = t.tz[i];
      return [px - tz * lat, py + y, pz + tx * lat];
    };
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
    const lane: number[] = [], white: number[] = [], yellow: number[] = [], wall: number[] = [];
    const STEP = 2;
    const inner = (sd: number) => Math.max(HALF_WIDTH + 0.05, laneLat(sd) - PIT.HALF);
    const outer = (sd: number) => laneLat(sd) + PIT.HALF + workW(sd) * 2 * PIT.HALF;
    for (let sd = PIT.IN; sd < PIT.OUT; sd += STEP) {
      const s1 = sd + STEP;
      const a0 = inner(sd), b0 = outer(sd), a1 = inner(s1), b1 = outer(s1);
      if (b0 > a0 + 0.3 || b1 > a1 + 0.3) quad(lane, P(sd, a0, 0.012), P(sd, b0, 0.012), P(s1, b1, 0.012), P(s1, a1, 0.012));
      // 靠賽道那側的白實線（進站口分出去的那條線）、外側邊線
      if (b0 > a0 + 1) {
        quad(white, P(sd, a0, 0.02), P(sd, a0 + 0.2, 0.02), P(s1, a1 + 0.2, 0.02), P(s1, a1, 0.02));
        quad(white, P(sd, b0 - 0.2, 0.02), P(sd, b0, 0.02), P(s1, b1, 0.02), P(s1, b1 - 0.2, 0.02));
      }
      // 快車道／作業車道之間的虛線
      if (workW(sd) > 0.95 && Math.floor(sd / 3) % 2 === 0) { const m = PIT.FAST + PIT.HALF; quad(white, P(sd, m - 0.08, 0.02), P(sd, m + 0.08, 0.02), P(s1, m + 0.08, 0.02), P(s1, m - 0.08, 0.02)); }
      // 進出站車道外側的護牆（在賽道護牆外面的那段）
      if ((sd < PIT.LIM_IN || s1 > PIT.LIM_OUT) && b0 > WALL_OFF + 0.5 && b1 > WALL_OFF + 0.5) {
        const o0 = b0 + 0.3, o1 = b1 + 0.3;
        quad(wall, P(sd, o0, 0), P(s1, o1, 0), P(s1, o1, 1.2), P(sd, o0, 1.2));
      }
    }
    // 限速線：橫跨整條維修道
    for (const sd of [PIT.LIM_IN, PIT.LIM_OUT]) quad(white, P(sd - 0.3, inner(sd), 0.022), P(sd - 0.3, outer(sd), 0.022), P(sd + 0.3, outer(sd), 0.022), P(sd + 0.3, inner(sd), 0.022));
    // 停車格：黃色外框＋車隊色的車頭定位線
    const teamPos: number[] = [], teamCol: number[] = [];
    TEAMS.forEach((tm, k) => {
      const c = boxS(k), w0 = PIT.WORK - 1.7, w1 = PIT.WORK + 1.7, a0 = c - 3.2, a1 = c + 3.4, th = 0.14;
      quad(yellow, P(a0, w0, 0.024), P(a0, w1, 0.024), P(a0 + th, w1, 0.024), P(a0 + th, w0, 0.024));
      quad(yellow, P(a1 - th, w0, 0.024), P(a1 - th, w1, 0.024), P(a1, w1, 0.024), P(a1, w0, 0.024));
      quad(yellow, P(a0, w0, 0.024), P(a0, w0 + th, 0.024), P(a1, w0 + th, 0.024), P(a1, w0, 0.024));
      quad(yellow, P(a0, w1 - th, 0.024), P(a0, w1, 0.024), P(a1, w1, 0.024), P(a1, w1 - th, 0.024));
      const col = new THREE.Color(tm.livery.main), n0 = teamPos.length;
      quad(teamPos, P(c + 2.4, w0 + 0.3, 0.026), P(c + 2.4, w1 - 0.3, 0.026), P(c + 2.9, w1 - 0.3, 0.026), P(c + 2.9, w0 + 0.3, 0.026));
      for (let v = n0; v < teamPos.length; v += 3) teamCol.push(col.r, col.g, col.b);
    });
    const mesh = (pos: number[], mat: THREE.Material, col?: number[]) => {
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      parent.add(new THREE.Mesh(g, mat));
    };
    const D = THREE.DoubleSide;
    const laneMat = new THREE.MeshLambertMaterial({ color: '#4a4c52', side: D, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -70 });
    laneMat.userData.road = true; // 下雨會濕
    mesh(lane, laneMat);
    const lineMat = (c: string) => new THREE.MeshLambertMaterial({ color: c, side: D, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -80, vertexColors: false });
    mesh(white, lineMat('#ececec'));
    mesh(yellow, lineMat('#ffd400'));
    mesh(teamPos, new THREE.MeshLambertMaterial({ vertexColors: true, side: D, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -80 }), teamCol);
    mesh(wall, new THREE.MeshLambertMaterial({ color: '#d8d8d4', side: D }));

    // 告示牌：進站口「PIT ▶」、限速牌、出站燈（面向開過來的車）
    const board = (sd: number, lat: number, w: number, h: number, y: number, draw: (g: CanvasRenderingContext2D) => void) => {
      const tex = canvasTex(256, Math.round((256 * h) / w), draw, false);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: D, toneMapped: false }));
      const [x, yy, z] = P(sd, lat, y), i = iOf(sd);
      m.position.set(x, yy, z);
      m.rotation.y = Math.atan2(t.tx[i], t.tz[i]) + Math.PI; // 正面朝著開過來的車
      parent.add(m);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, y, 0.15), new THREE.MeshLambertMaterial({ color: '#555a60' }));
      pole.position.set(x, yy - y / 2, z);
      parent.add(pole);
    };
    const kmh = Math.round(this.speed * 3.6);
    board(PIT.IN - 70, WALL_OFF + 0.6, 2.4, 1.2, 2.6, (g) => { g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#fff'; g.font = 'bold 74px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PIT ▶', 128, 66); });
    board(PIT.LIM_IN - 4, outer(PIT.LIM_IN) + 0.8, 1.4, 1.4, 2.2, (g) => {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
      g.strokeStyle = '#d81e2a'; g.lineWidth = 26; g.beginPath(); g.arc(128, 128, 108, 0, 7); g.stroke();
      g.fillStyle = '#111'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(kmh), 128, 136);
    });
    board(PIT.LIM_OUT + 2, outer(PIT.LIM_OUT) + 0.8, 1.4, 1.4, 2.2, (g) => {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
      g.fillStyle = '#999'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(kmh), 128, 136);
      g.strokeStyle = '#111'; g.lineWidth = 18; g.beginPath(); g.moveTo(40, 216); g.lineTo(216, 40); g.stroke(); // 解除限速
    });
    board(PIT.OUT - 60, outer(PIT.OUT - 60) + 0.8, 1.0, 1.6, 2.4, (g) => {
      g.fillStyle = '#111'; g.fillRect(0, 0, 256, 410);
      g.fillStyle = '#22ff66'; g.beginPath(); g.arc(128, 120, 80, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.fillText('PIT', 128, 290); g.fillText('EXIT', 128, 350);
    });

    // 台北街道賽：沒有常設的維修區建築，搭一排臨時車庫（各國賽道 circuitenv.ts 已經蓋好了）
    if (garages && PIT.BUILD) this.buildGarages(parent, P);

    // ---- 維修人員、輪胎、放行牌（全部隊伍共用幾個 InstancedMesh）
    const n = TEAMS.length * CREW_N;
    const legs = new THREE.BoxGeometry(0.42, 0.85, 0.26).translate(0, 0.425, 0);
    const torso = new THREE.BoxGeometry(0.52, 0.62, 0.32).translate(0, 1.16, 0);
    this.body = new THREE.InstancedMesh(mergeGeometries([legs, torso]), new THREE.MeshLambertMaterial(), n);
    this.head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8).translate(0, 1.66, 0), new THREE.MeshLambertMaterial({ color: '#f2f2f2' }), n);
    const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.36, 14).rotateZ(Math.PI / 2);
    this.tyre = new THREE.InstancedMesh(tyreGeo, new THREE.MeshLambertMaterial({ color: '#1b1b1d' }), TEAMS.length * 8);
    this.band = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.38, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ side: D }), TEAMS.length * 8);
    this.sign = new THREE.InstancedMesh(mergeGeometries([new THREE.BoxGeometry(0.04, 1.4, 0.04).translate(0, 0.7, 0), new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16).rotateX(Math.PI / 2).translate(0, 1.55, 0)]), new THREE.MeshBasicMaterial(), TEAMS.length);
    this.pose = new Float32Array(n * 3);
    this.tyres = new Float32Array(TEAMS.length * 8 * 3);
    TEAMS.forEach((tm, k) => {
      const c = boxS(k), i = iOf(c), [x, y, z] = P(c, PIT.WORK);
      this.frames.push({ x, y, z, h: Math.atan2(t.tx[i], t.tz[i]) });
      const suit = new THREE.Color(tm.livery.main);
      for (let m = 0; m < CREW_N; m++) { this.body.setColorAt(k * CREW_N + m, suit); this.idlePose(k, m); }
      for (let q = 0; q < 8; q++) { this.tyres[(k * 8 + q) * 3 + 2] = -9; this.band.setColorAt(k * 8 + q, new THREE.Color('#ffd400')); }
      this.sign.setColorAt(k, new THREE.Color('#d81e2a'));
      this.place(k);
    });
    for (const im of [this.body, this.head, this.tyre, this.band, this.sign]) { im.computeBoundingSphere(); im.frustumCulled = false; parent.add(im); }
  }

  /** 台北的臨時車庫：每隊一間（白色帳篷式），門楣車隊色＋隊名，裡面暗暗的 */
  private buildGarages(parent: THREE.Object3D, P: (sd: number, lat: number, y?: number) => [number, number, number]) {
    const geo: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];
    const q = new THREE.Quaternion(), m = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const span = (PIT.G1 - PIT.G0) / TEAMS.length, b0 = PIT.WORK + PIT.HALF, depth = 8, H = 4.6;
    const header = canvasTex(1024, 64, (g) => {
      const w = 1024 / TEAMS.length;
      TEAMS.forEach((tm, k) => {
        g.fillStyle = tm.livery.main; g.fillRect(k * w, 0, w, 64);
        g.fillStyle = tm.livery.main === '#f2f2f2' ? '#c8102e' : '#fff';
        g.font = 'bold 26px "Microsoft JhengHei","PingFang TC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(tm.team.split(' ')[0], k * w + w / 2, 33, w - 8);
      });
    }, false);
    const strip: number[] = [], uv: number[] = [];
    TEAMS.forEach((_, k) => {
      const c = boxS(k), [x, y, z] = P(c, b0 + depth / 2), i0 = P(c - 1, b0), i1 = P(c + 1, b0);
      const h = Math.atan2(i1[0] - i0[0], i1[2] - i0[2]);
      q.setFromAxisAngle(up, h);
      const box = (w: number, hh: number, d: number, la: number, lb: number, ly: number, arr: THREE.BufferGeometry[]) => {
        // la：沿賽道、lb：往外（車庫深處）
        const g = new THREE.BoxGeometry(d, hh, w).translate(-lb, ly + hh / 2, la); // 轉向後本地 +x 指向賽道，往外要取負
        arr.push(g.applyMatrix4(m.compose(v.set(x, y, z), q, s)));
      };
      box(span - 0.4, 0.3, depth, 0, 0, H, geo); // 屋頂
      box(0.3, H, depth, -span / 2 + 0.2, 0, 0, geo); // 隔間牆
      box(span - 0.4, H, 0.3, 0, depth / 2 - 0.15, 0, dark); // 後牆（暗）
      box(span - 0.8, 0.02, depth - 0.4, 0, 0, 0.02, dark); // 地板
      // 門楣：一條貼圖帶
      const a0 = P(c - span / 2 + 0.2, b0 - 0.05, H - 0.9), a1 = P(c + span / 2 - 0.2, b0 - 0.05, H - 0.9), a2 = P(c + span / 2 - 0.2, b0 - 0.05, H), a3 = P(c - span / 2 + 0.2, b0 - 0.05, H);
      strip.push(...a0, ...a1, ...a2, ...a0, ...a2, ...a3);
      const u0 = k / TEAMS.length, u1 = (k + 1) / TEAMS.length;
      uv.push(u1, 0, u0, 0, u0, 1, u1, 0, u0, 1, u1, 1); // 從賽道看過去 +s 在左手邊：u 反過來字才是正的
    });
    parent.add(new THREE.Mesh(mergeGeometries(geo), new THREE.MeshLambertMaterial({ color: '#b8bcc3' }))); // 太白會被夕陽＋光暈打到過曝
    parent.add(new THREE.Mesh(mergeGeometries(dark), new THREE.MeshLambertMaterial({ color: '#2a2d33' })));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sg.computeVertexNormals();
    parent.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: header, side: THREE.DoubleSide, toneMapped: false })));
  }

  /** 沒事的時候：在車庫門口排一排 */
  private idlePose(k: number, m: number) {
    const o = (k * CREW_N + m) * 3;
    this.pose[o] = -6.5 + m * 0.92; this.pose[o + 1] = 2.1; this.pose[o + 2] = 0;
  }
  /** 第 m 個人在停站的第 t 秒（總長 T）該站哪、蹲多低；slow = 出包的輪子 */
  private servicePose(m: number, s: StopInfo): [number, number, number] {
    const T = s.T, tt = s.phase === 'approach' ? -1 : s.t;
    if (m < 12) {
      const w = Math.floor(m / 3), role = m % 3, [wa, wb] = WHEELS[w], sb = Math.sign(wb);
      if (role === 0) return [wa, wb + sb * 0.55, 1]; // 槍手：蹲在輪子旁
      if (role === 1) { // 拆胎：抱著舊胎往外走
        const f = tt < 0 ? 0 : smooth((tt - 0.3) / 0.45);
        return [wa + 0.15, wb + sb * (1.15 + f * 1.4), 0.25 * (1 - f)];
      }
      const late = w === s.slow ? Math.min(T - 1.1, 3.5) : 0; // 裝胎：從外面把新胎推進去（出包的那顆晚到）
      const f = tt < 0 ? 0 : smooth((tt - 0.55 - late) / 0.4);
      return [wa - 0.35, wb + sb * (2.4 - f * 1.2), 0.2 + f * 0.3];
    }
    if (m === 12) return [3.9, 0, 0.55]; // 前千斤頂
    if (m === 13) return [-3.5, 0, 0.55]; // 後千斤頂
    return [5.4, -0.6, 0]; // 放行（拿牌子的）
  }

  /** 每格：stops = 正在進站的隊伍 → 那一隊的停站狀態 */
  update(dt: number, stops: Map<number, StopInfo>) {
    const k8 = Math.min(1, dt * 6);
    for (const [k, s] of stops) { this.active.add(k); this.linger[k] = 1.6; this.animate(k, s, k8); }
    for (const k of [...this.active]) {
      if (stops.has(k)) continue;
      this.linger[k] -= dt;
      // 停站結束：慢慢走回車庫門口、輪胎收走
      let moving = false;
      for (let m = 0; m < CREW_N; m++) {
        const o = (k * CREW_N + m) * 3, tx = -6.5 + m * 0.92, ty = 2.1;
        this.pose[o] += (tx - this.pose[o]) * k8 * 0.5; this.pose[o + 1] += (ty - this.pose[o + 1]) * k8 * 0.5; this.pose[o + 2] *= 1 - k8;
        moving ||= Math.abs(tx - this.pose[o]) + Math.abs(ty - this.pose[o + 1]) > 0.02;
      }
      for (let q = 0; q < 8; q++) this.tyres[(k * 8 + q) * 3 + 2] = -9;
      this.sign.setColorAt(k, new THREE.Color('#d81e2a'));
      this.place(k);
      if (!moving && this.linger[k] <= 0) this.active.delete(k);
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    for (const im of [this.body, this.head, this.tyre, this.band, this.sign]) im.instanceMatrix.needsUpdate = true;
    if (this.band.instanceColor) this.band.instanceColor.needsUpdate = true;
    if (this.sign.instanceColor) this.sign.instanceColor.needsUpdate = true;
  }

  private animate(k: number, s: StopInfo, k8: number) {
    for (let m = 0; m < CREW_N; m++) {
      const o = (k * CREW_N + m) * 3, [a, b, c] = this.servicePose(m, s);
      const kk = s.phase === 'approach' ? k8 * 0.6 : Math.min(1, k8 * 3); // 停好之後動作要快
      this.pose[o] += (a - this.pose[o]) * kk; this.pose[o + 1] += (b - this.pose[o + 1]) * kk; this.pose[o + 2] += (c - this.pose[o + 2]) * kk;
    }
    // 輪胎：舊胎（0~3）跟著拆胎的人、新胎（4~7）跟著裝胎的人
    const col = new THREE.Color(s.newColor);
    for (let w = 0; w < 4; w++) {
      const off = (k * CREW_N + w * 3 + 1) * 3, on = (k * CREW_N + w * 3 + 2) * 3, sb = Math.sign(WHEELS[w][1]);
      const show = s.phase !== 'approach';
      const T0 = (k * 8 + w) * 3, T1 = (k * 8 + 4 + w) * 3;
      const offF = show ? smooth((s.t - 0.3) / 0.2) : 0; // 拆下來之後才看得到
      this.tyres[T0] = this.pose[off] - 0.1; this.tyres[T0 + 1] = this.pose[off + 1] - sb * 0.45; this.tyres[T0 + 2] = offF > 0.5 ? 0.62 : -9;
      this.tyres[T1] = this.pose[on] + 0.3; this.tyres[T1 + 1] = this.pose[on + 1] - sb * 0.5; this.tyres[T1 + 2] = 0.42;
      this.band.setColorAt(k * 8 + 4 + w, col);
      this.band.setColorAt(k * 8 + w, new THREE.Color('#5b5b5b')); // 舊胎磨得看不清楚顏色
    }
    this.sign.setColorAt(k, new THREE.Color(s.phase === 'release' ? '#22ff66' : '#d81e2a'));
    this.place(k);
  }

  /** 把第 k 隊的人、輪胎、放行牌放到世界座標 */
  private place(k: number) {
    const f = this.frames[k], ca = Math.cos(f.h), sa = Math.sin(f.h);
    // 沿賽道 (sin h, cos h)、往右（車庫方向）(-cos h, sin h)
    const W = (a: number, b: number): [number, number] => [f.x + sa * a - ca * b, f.z + ca * a + sa * b];
    const { M, Q, V, S, up } = this;
    for (let m = 0; m < CREW_N; m++) {
      const o = (k * CREW_N + m) * 3, [x, z] = W(this.pose[o], this.pose[o + 1]), crouch = this.pose[o + 2];
      const face = m < 12 ? f.h + (WHEELS[Math.floor(m / 3)][1] > 0 ? Math.PI / 2 : -Math.PI / 2) : m === 14 ? f.h + Math.PI : f.h;
      Q.setFromAxisAngle(up, face);
      M.compose(V.set(x, f.y, z), Q, S.set(1, 1 - crouch * 0.4, 1));
      this.body.setMatrixAt(k * CREW_N + m, M);
      this.head.setMatrixAt(k * CREW_N + m, M);
    }
    for (let q = 0; q < 8; q++) {
      const o = (k * 8 + q) * 3, [x, z] = W(this.tyres[o], this.tyres[o + 1]), y = this.tyres[o + 2];
      Q.setFromAxisAngle(up, f.h);
      M.compose(V.set(x, y < -5 ? -50 : f.y + y, z), Q, S.set(1, 1, 1));
      this.tyre.setMatrixAt(k * 8 + q, M);
      this.band.setMatrixAt(k * 8 + q, M);
    }
    const o = (k * CREW_N + 14) * 3, [x, z] = W(this.pose[o] + 0.35, this.pose[o + 1]);
    Q.setFromAxisAngle(up, f.h + Math.PI / 2);
    M.compose(V.set(x, f.y + 0.6, z), Q, S.set(1, 1, 1));
    this.sign.setMatrixAt(k, M);
  }
}
