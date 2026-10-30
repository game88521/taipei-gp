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
  oldColor: string; // 舊胎的顏色（拆下來的那顆）
  /** 停在格子裡的那台車的模型（換胎動畫要動車上的輪子）；null = 還沒停好或沒有模型 */
  model: import('./carModel').CarModel | null;
  /** 擋住了：時間到了但快車道有車要過來，還不能放行 */
  hold: boolean;
  /** 放行燈：綠燈（放行前 0.25 秒、而且快車道沒有車要過來才亮；車手看到綠燈才起步） */
  go: boolean;
  /** 千斤頂把車頂起多高（m）：扳手跟著輪子中心的高度 */
  lift: number;
  /** 停車格在世界座標的位置（定位音效用） */
  x: number; z: number;
}

// 維修人員的角色：在停車格座標（a 沿賽道往前、b 往車庫方向）的站位
const WHEELS: [number, number][] = [[1.75, -0.95], [1.75, 0.95], [-1.6, -0.95], [-1.6, 0.95]]; // 左前、右前、左後、右後
/** WHEELS 的第 w 個輪子 → 車模 spin[] 的第幾個（f1model 的順序是 右前、右後、左前、左後；模型 +x 是車子左邊） */
const SPIN_OF = [2, 0, 3, 1];
const CREW_N = 15; // 每個輪子 3 人（槍手、拆胎、裝胎）＋前後千斤頂＋放行
const SEG_PER = 12; // 每人的骨頭段數：上臂、前臂、大腿、小腿（左右各一）＋手套、靴子（左右各一）
const TOOL_SEG = 4 * 5 + 2 * 3 + 4; // 每隊的工具段數：4 支扳手×5 段（套筒、槍身、槍把、兩段氣管）＋2 支千斤頂×3 段（長柄、立柱、墊頭）＋4 根軸頭（輪子拆掉時露出來）
const SEG_PER_TEAM = CREW_N * SEG_PER + TOOL_SEG;
/**
 * 一次停站的時間軸（停站總長 T 的比例；T 在進站口就決定了，動作排成比例就一定剛好在 T 做完，不用動停站時間）：
 *   0 ~ JACK 千斤頂前後同時頂起 → 槍手鬆螺帽（GUN1）→ 拆舊胎（OFF）→ 裝新胎（ON）→ 槍手鎖螺帽（GUN2）→ 千斤頂放下（DROP）→ 放行
 * 出包的那個輪子（slow）：裝新胎晚到，這一輪的後半段整個往後推，車子要等它
 */
const TL = { JACK: 0.08, GUN1: [0.08, 0.2], OFF: [0.2, 0.42], ON: [0.42, 0.66], GUN2: [0.66, 0.8], DROP: [0.84, 0.94] } as const;
/** 時間軸的基準長度：卡住的那次 T 會到 5~10 秒，其他三個輪子照正常節奏（最多 2.9 秒）做完，不跟著拖 */
const baseOf = (T: number) => Math.min(T, 2.9);
/** 新胎裝上車的時間（秒）：車上胎色圈從這一刻起換成新胎的顏色（rivals.ts 用；出包的那顆另外晚到，但拆下來時看不到） */
export const mountedAt = (T: number) => TL.ON[1] * baseOf(T);

// ---- 人形的骨架：停車格座標 (a, b, y)（a 沿賽道、b 往車庫、y 離地高度；三軸互相垂直）
type V3 = [number, number, number];
const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const addV = (p: V3, q: V3, s = 1): V3 => [p[0] + q[0] * s, p[1] + q[1] * s, p[2] + q[2] * s];
const unitV = (p: V3): V3 => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
const lerpV = (p: V3, q: V3, t: number): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
const wrapA = (x: number) => Math.atan2(Math.sin(x), Math.cos(x)); // 角度差拉回 −π ~ π
/** 第 k 隊第 m 個人的第 j 段骨頭在 bone 這個 InstancedMesh 裡的編號（j：0~3 手臂、4~7 腿、8~9 手套、10~11 靴子） */
const boneAt = (k: number, m: number, j: number) => k * SEG_PER_TEAM + m * SEG_PER + j;
type P3 = [number, number, number];
/** 一個人這一格的骨架基準（place 用）：hip 髖、fw 面向、lf 他的左手邊、td 軀幹往上的方向、sc 兩肩中心、ph 步伐相位、sp 走路速度、c 蹲的程度 */
interface Body { hip: V3; fw: V3; lf: V3; td: V3; sc: V3; ph: number; sp: number; c: number }
/** 依時間走路徑點：k = [[時間, [a, b, 蹲]], …]（時間遞增）；之前停在第一點、之後停在最後一點，中間用 smooth 補（目標位置；走多快由 animate 限制） */
const seq = (tt: number, k: [number, P3][]): P3 => {
  if (tt <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (tt >= k[i][0]) continue;
    const [t0, p0] = k[i - 1], [t1, p1] = k[i], u = smooth((tt - t0) / Math.max(1e-3, t1 - t0));
    return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, p0[2] + (p1[2] - p0[2]) * u];
  }
  return k[k.length - 1][1];
};
/** 四個輪子的軸頭：[沿賽道位置, 離車中心線, 輪胎半徑]（f1model 的輪子位置；WHEELS 是站位用的概略值） */
const HUB: [number, number, number][] = [[1.78, 0.86, 0.36], [1.78, 0.86, 0.36], [-1.72, 0.82, 0.37], [-1.72, 0.82, 0.37]];
/** 兩段骨架的解析 IK：肩（髖）S 到手（腳）T，上段 L1、下段 L2 夾住，關節往 pole 的方向彎；回傳 [關節, 末端]（夠不到就停在伸直的位置） */
function ik2(S: V3, T: V3, L1: number, L2: number, pole: V3): [V3, V3] {
  const n = unitV(addV(T, S, -1)), D = Math.max(1e-4, Math.min(Math.hypot(T[0] - S[0], T[1] - S[1], T[2] - S[2]), L1 + L2 - 1e-3));
  const x = (L1 * L1 - L2 * L2 + D * D) / (2 * D), r = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const p = unitV(addV(pole, n, -dot(pole, n)));
  return [addV(addV(S, n, x), p, r), addV(S, n, D)];
}

export class PitLane {
  readonly speed: number;
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private tyre: THREE.InstancedMesh;
  private band: THREE.InstancedMesh;
  private sign: THREE.InstancedMesh;
  /** 四肢、手套、靴子、扳手、千斤頂、軸頭：全部是「骨頭」（六角柱，一段一個實例，place 每格用兩端點排出來） */
  private bone: THREE.InstancedMesh;
  /** 每隊每人目前的 [a, b, 蹲（0 站 ~ 1 蹲）] */
  private pose: Float32Array;
  /** 每隊 8 顆輪胎（4 舊 4 新）目前的 [在軸上的程度 0~1（1 = 在車上的輪軸、0 = 抱在人手上）, 未用, 高度]；高度 -9 = 看不到 */
  private tyres: Float32Array;
  /** 每人目前面向的方向（世界座標繞 y 的角度）、走路速度（m/s）、步伐相位（弧度） */
  private yaw: Float32Array; private spd: Float32Array; private gait: Float32Array;
  /** 每隊 4 支扳手頂在輪子上的程度（0 端在身邊 ~ 1 套在螺帽上）、4 個輪子是不是拆掉了（露出軸頭） */
  private gunEng: Float32Array; private axle: Uint8Array;
  private D = new THREE.Vector3();
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
    // 人形：骨盆＋軀幹是一個實例，頭（安全帽＋深色面罩）一個，四肢／手套／靴子／工具全是「骨頭」（六角柱，一段一個實例）
    const tint = (g: THREE.BufferGeometry, c: string) => { const col = new THREE.Color(c), a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const pelvis = new THREE.BoxGeometry(0.34, 0.2, 0.22).translate(0, 0.04, 0), chest = new THREE.BoxGeometry(0.44, 0.5, 0.25).translate(0, 0.38, 0);
    this.body = new THREE.InstancedMesh(mergeGeometries([pelvis, chest]), new THREE.MeshLambertMaterial(), n);
    const dome = tint(new THREE.SphereGeometry(0.15, 8, 6).scale(1, 1.08, 1.1), '#ffffff'), visor = tint(new THREE.BoxGeometry(0.2, 0.07, 0.1).translate(0, 0.02, 0.12), '#0c0e12');
    this.head = new THREE.InstancedMesh(mergeGeometries([dome, visor]), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
    this.bone = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), TEAMS.length * SEG_PER_TEAM); // 不封口：關節處被別段蓋住，省一半三角形
    const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.36, 14).rotateZ(Math.PI / 2);
    this.tyre = new THREE.InstancedMesh(tyreGeo, new THREE.MeshLambertMaterial({ color: '#1b1b1d' }), TEAMS.length * 8);
    this.band = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.38, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ side: D }), TEAMS.length * 8);
    this.sign = new THREE.InstancedMesh(mergeGeometries([new THREE.BoxGeometry(0.04, 1.4, 0.04).translate(0, 0.7, 0), new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16).rotateX(Math.PI / 2).translate(0, 1.55, 0)]), new THREE.MeshBasicMaterial(), TEAMS.length);
    this.pose = new Float32Array(n * 3);
    this.tyres = new Float32Array(TEAMS.length * 8 * 3);
    this.yaw = new Float32Array(n); this.spd = new Float32Array(n); this.gait = new Float32Array(n);
    this.gunEng = new Float32Array(TEAMS.length * 4); this.axle = new Uint8Array(TEAMS.length * 4);
    const dark = new THREE.Color('#17181b'), steel = new THREE.Color('#c4c9d1'), gunC = new THREE.Color('#5d6470'), hoseC = new THREE.Color('#25272b'), jackC = new THREE.Color('#8a9099'), padC = new THREE.Color('#202226'), hubC = new THREE.Color('#9aa0a8');
    TEAMS.forEach((tm, k) => {
      const c = boxS(k), i = iOf(c), [x, y, z] = P(c, PIT.WORK);
      this.frames.push({ x, y, z, h: Math.atan2(t.tx[i], t.tz[i]) });
      const suit = new THREE.Color(tm.livery.main), accent = new THREE.Color(tm.livery.accent), helmet = new THREE.Color(tm.livery.helmet);
      for (let m = 0; m < CREW_N; m++) {
        const idx = k * CREW_N + m;
        this.body.setColorAt(idx, suit); this.head.setColorAt(idx, helmet);
        for (let j = 0; j < SEG_PER; j++) this.bone.setColorAt(boneAt(k, m, j), j < 8 ? suit : dark); // 0~7 手臂、腿＝賽車服；8~11 手套、靴子
        this.idlePose(k, m); this.yaw[idx] = this.frames[k].h + Math.PI / 2; // 沒事的時候面向賽道
      }
      // 工具：每隻扳手 5 段（套筒、槍身、握把、氣管×2），千斤頂 3 段（長柄、立柱、墊頭），軸頭 1 段
      const tb = k * SEG_PER_TEAM + CREW_N * SEG_PER;
      for (let w = 0; w < 4; w++) for (const [j, col] of [steel, gunC, accent, hoseC, hoseC].entries()) this.bone.setColorAt(tb + w * 5 + j, col);
      for (let j = 0; j < 2; j++) for (const [q, col] of [jackC, gunC, padC].entries()) this.bone.setColorAt(tb + 20 + j * 3 + q, col);
      for (let w = 0; w < 4; w++) this.bone.setColorAt(tb + 26 + w, hubC);
      for (let q = 0; q < 8; q++) { this.tyres[(k * 8 + q) * 3 + 2] = -9; this.band.setColorAt(k * 8 + q, new THREE.Color('#ffd400')); }
      this.sign.setColorAt(k, new THREE.Color('#d81e2a'));
      this.place(k);
    });
    this.meshes = [this.body, this.head, this.bone, this.tyre, this.band, this.sign];
    for (const im of this.meshes) { im.computeBoundingSphere(); im.frustumCulled = false; parent.add(im); }
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

  /** 沒事的時候：在車庫門口排一排，面向賽道（車庫在右邊） */
  private idlePose(k: number, m: number) {
    const o = (k * CREW_N + m) * 3;
    this.pose[o] = -6.5 + m * 0.92; this.pose[o + 1] = 2.1; this.pose[o + 2] = 0;
  }
  private idleYaw(k: number) { return this.frames[k].h + Math.PI / 2; } // 面向賽道（往 −b 看）
  /**
   * 第 w 個輪子在這次停站的時間軸（秒）：[鬆螺帽開始, 拆下, 裝上, 鎖好]。
   * 一般輪子照 TL 的比例排；出包的那個（slow）裝新胎卡住，裝上與鎖好往後推（車子在等它），但要在千斤頂放下（0.84T）之前鎖完
   */
  private wheelTimes(w: number, s: StopInfo): [number, number, number, number] {
    const T = s.T, base = baseOf(T);
    const k = (f: number) => f * base;
    if (w !== s.slow) return [k(TL.GUN1[0]), k(TL.OFF[1]), k(TL.ON[1]), k(TL.GUN2[1])];
    return [k(TL.GUN1[0]), k(TL.OFF[1]), T * 0.74, T * 0.82];
  }
  /**
   * 一個輪子的動作時間表（秒；聲音、人、輪胎、扳手都看這一份）：
   *   A1~E1 扳手鬆螺帽 → pullS~pullE 舊胎從輪軸拔下來 → pushS（出包的輪子第一次嘗試）、finS~on 新胎推上輪軸 → V2~E2 扳手鎖緊
   * A1 是鬆螺帽的聲音；V2 是鎖螺帽的聲音，也是畫面上扳手第二次套上去的時間：新胎還沒裝好以前槍手不能鎖，所以最早在裝好後 0.12 秒
   */
  private plan(w: number, s: StopInfo) {
    const [g1, off, on, lock] = this.wheelTimes(w, s);
    const A1 = g1 + w * 0.03, E1 = A1 + 0.26, pullS = Math.max(off * 0.85 - 0.2, E1 + 0.12), V2 = Math.max(lock - 0.3 + w * 0.02, on + 0.12 + w * 0.03);
    return { A1, E1, pullS, pullE: pullS + 0.2, pushS: TL.ON[1] * baseOf(s.T) - 0.2, finS: on - 0.2, on, V2, E2: V2 + 0.2 };
  }
  /** 從 (pa, pb) 看向 (ta, tb)（停車格座標）時的面向角度（世界座標繞 y） */
  private look(k: number, pa: number, pb: number, ta: number, tb: number) {
    const h = this.frames[k].h, da = ta - pa, db = tb - pb;
    return Math.atan2(Math.sin(h) * da - Math.cos(h) * db, Math.cos(h) * da + Math.sin(h) * db);
  }
  /**
   * 第 m 個人在停站的第 t 秒該站哪：[a, b, 蹲（0 站 ~ 1 蹲）, 面向（世界座標繞 y 的角度）]。
   * 每個輪子旁三個人（da = 沿車身、正 = 往車頭；ob = 離輪子中心往外多遠）：
   *   槍手站在輪子前側斜角蹲著不動（扳手斜著伸向螺帽）；拆胎的從後面等著，鬆完就蹲到輪子正外側拔、抱著往前外側走開；
   *   裝胎的在後外側等著，舊胎一離開就蹲進來推上輪軸，推好退回去，槍手再鎖
   */
  private servicePose(k: number, m: number, s: StopInfo): [number, number, number, number] {
    const T = s.T, tt = s.phase === 'approach' ? -1 : s.hold ? T : s.t, h = this.frames[k].h;
    if (m < 12) {
      const w = Math.floor(m / 3), role = m % 3, [ha, hb] = HUB[w], sb = Math.sign(WHEELS[w][1]), pl = this.plan(w, s), hub = sb * hb;
      const at = (da: number, ob: number, c: number): P3 => [ha + da, sb * (hb + ob), c];
      const out = (r: P3, yw?: number): [number, number, number, number] => [r[0], r[1], r[2], yw ?? this.look(k, r[0], r[1], ha, hub)];
      if (role === 0) {
        const wait = at(0.55, 1.15, 0.25), work = at(0.38, 0.74, 1), done = at(0.6, 1.45, 0.05);
        return out(seq(tt, [[-1, wait], [pl.A1 - 0.3, wait], [pl.A1 - 0.08, work], [pl.E2 + 0.05, work], [pl.E2 + 0.35, done]]));
      }
      if (role === 1) {
        const wait = at(-0.62, 0.98, 0.2), grab = at(-0.05, 0.62, 0.9), pull = at(-0.05, 1.45, 0.65), away = at(0.8, 1.7, 0.1);
        return out(seq(tt, [[-1, wait], [pl.pullS - 0.3, wait], [pl.pullS - 0.04, grab], [pl.pullS, grab], [pl.pullE, pull], [pl.pullE + 0.5, away]]));
      }
      const wait = at(-0.75, 1.6, 0.2), push = at(-0.05, 0.62, 0.9);
      return out(seq(tt, [[-1, wait], [pl.pushS - 0.35, wait], [pl.pushS - 0.06, push], [pl.on - 0.02, push], [pl.on + 0.14, wait]]));
    }
    if (m < 14) { // 前、後千斤頂：先站在車頭（車尾）外面，車一停好就衝進去頂；車放下之後拉出來、閃到旁邊
      const j = m - 12, sg = j === 0 ? 1 : -1, dropT = TL.DROP[1] * T;
      const wait: P3 = [sg * 3.7, 1, 0], work: P3 = [sg * 3.7, 0, 0.55], gone: P3 = [sg * 4.4, 2.3, 0.05];
      const r = seq(tt, [[-1, wait], [-0.02, wait], [0.2, work], [dropT - 0.1, work], [dropT + 0.35, gone]]);
      return [r[0], r[1], r[2], h + (j === 0 ? Math.PI : 0)];
    }
    // 放行（拿牌子的）：站在車頭前面，面向車子；綠燈一亮就閃到車庫那一側，把路讓出來
    return [5.4, s.go ? 2.3 : -0.6, 0, h + Math.PI];
  }
  /** 第 m 個人往目標 (a, b, 蹲) 走一步：走路速度有上限 vmax（m/s）；順便更新走路速度、步伐相位、面向（走起來的時候面向行進方向） */
  private stepCrew(k: number, m: number, a: number, b: number, c: number, yawT: number, dt: number, kk: number, vmax: number) {
    const idx = k * CREW_N + m, o = idx * 3, da = (a - this.pose[o]) * kk, db = (b - this.pose[o + 1]) * kk, d = Math.hypot(da, db), cap = vmax * dt, sc = d > cap && d > 0 ? cap / d : 1;
    this.pose[o] += da * sc; this.pose[o + 1] += db * sc; this.pose[o + 2] += (c - this.pose[o + 2]) * Math.min(1, kk);
    this.spd[idx] += ((dt > 0 ? (d * sc) / dt : 0) - this.spd[idx]) * Math.min(1, dt * 12);
    this.gait[idx] += Math.min(this.spd[idx], 3.4) * dt * 4.5;
    let ty = yawT;
    if (this.spd[idx] > 1.2) { const f = this.frames[k].h; ty = Math.atan2(da * Math.sin(f) - db * Math.cos(f), da * Math.cos(f) + db * Math.sin(f)); }
    const dy = wrapA(ty - this.yaw[idx]) * Math.min(1, dt * 8), turn = 10 * dt; // 轉身最快 10 rad/s（轉 180° 至少 0.3 秒），不會一格就轉過去
    this.yaw[idx] += Math.max(-turn, Math.min(turn, dy));
  }

  /** 每格：stops = 正在進站的隊伍 → 那一隊的停站狀態 */
  update(dt: number, stops: Map<number, StopInfo>) {
    const k8 = Math.min(1, dt * 6);
    this.sounds.length = 0;
    for (const [k, s] of stops) { this.active.add(k); this.linger[k] = 1.6; if (s.phase === 'approach') this.released[k] = 0; this.animate(k, s, k8, dt); }
    for (const k of [...this.active]) {
      if (stops.has(k)) continue;
      this.lastT[k] = -1;
      this.released[k] = 0;
      this.linger[k] -= dt;
      // 停站結束：走回車庫門口、輪胎收走
      let moving = false;
      for (let m = 0; m < CREW_N; m++) {
        const o = (k * CREW_N + m) * 3, tx = -6.5 + m * 0.92, ty = 2.1;
        this.stepCrew(k, m, tx, ty, 0, this.idleYaw(k), dt, k8 * 0.5, 3);
        moving ||= Math.abs(tx - this.pose[o]) + Math.abs(ty - this.pose[o + 1]) > 0.02;
      }
      for (let q = 0; q < 8; q++) this.tyres[(k * 8 + q) * 3 + 2] = -9;
      for (let w = 0; w < 4; w++) { this.gunEng[k * 4 + w] = 0; this.axle[k * 4 + w] = 0; }
      this.sign.setColorAt(k, new THREE.Color('#d81e2a'));
      this.toolOn[k] = 0;
      this.dirty = true;
      this.place(k);
      if (!moving && this.linger[k] <= 0) this.active.delete(k);
    }
    if (!this.dirty) return; // 沒人在動：不用把幾百 KB 的矩陣再傳一次給顯示卡
    this.dirty = false;
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.band.instanceColor) this.band.instanceColor.needsUpdate = true;
    if (this.sign.instanceColor) this.sign.instanceColor.needsUpdate = true;
  }

  /**
   * 這一格發生的維修區聲音（main 拿去播）：每個停站在 t 跨過時間軸上的點時記一筆。
   * 跨點判斷用每隊上一格的 t，所以暫停、畫面卡住都不會重複播
   */
  sounds: { kind: 'gun' | 'jack' | 'go'; x: number; z: number }[] = [];
  private lastT = new Float64Array(TEAMS.length).fill(-1); // 要用雙精度：Float32 會把「剛好差一點點到門檻」的上一格 t 進位成門檻本身，prev < at 就不成立，那一聲會掉
  private released = new Uint8Array(TEAMS.length); // 這次停站已經播過放行聲了（停站結束時清掉）
  private dirty = true; // 有人在動、矩陣要重傳
  private meshes: THREE.InstancedMesh[] = [];
  private animate(k: number, s: StopInfo, k8: number, dt: number) {
    this.dirty = true;
    const kk = s.phase === 'approach' ? k8 * 0.6 : Math.min(1, k8 * 3); // 停好之後動作要快
    for (let m = 0; m < CREW_N; m++) { const [a, b, c, yw] = this.servicePose(k, m, s); this.stepCrew(k, m, a, b, c, yw, dt, kk, m >= 12 ? 6 : 4.5); }
    const inBox = s.phase !== 'approach', tt = inBox ? s.t : -1;
    // 聲音：千斤頂頂起、四個輪子各自的扳手（鬆、鎖）、千斤頂放下、放行
    // 上一格的 t：approach（還沒停好）是 -1，所以停好的那一格 prev = -1、tt = 0.0x，「頂起」也會被算到
    const prev = this.lastT[k];
    this.lastT[k] = tt;
    const cross = (at: number) => prev < at && tt >= at;
    if (inBox) {
      if (cross(0.02)) this.sounds.push({ kind: 'jack', x: s.x, z: s.z });
      for (let w = 0; w < 4; w++) { const pl = this.plan(w, s); if (cross(pl.A1) || cross(pl.V2)) this.sounds.push({ kind: 'gun', x: s.x, z: s.z }); } // 扳手聲跟畫面上扳手套上去同一刻
      if (cross(TL.DROP[0] * s.T)) this.sounds.push({ kind: 'jack', x: s.x, z: s.z });
      if (s.phase === 'release' && !s.hold && !this.released[k]) { this.released[k] = 1; this.sounds.push({ kind: 'go', x: s.x, z: s.z }); }
    }
    // 輪胎：舊胎（0~3）從輪軸被拔下來、抱著走；新胎（4~7）一開始在裝胎的人手上，推上輪軸之後交給車上的輪子
    // tyres[輪胎編號 * 3] = 進度（舊胎：0 在輪軸 ~ 1 在人手上；新胎：0 在人手上 ~ 1 在輪軸）、[+2] = 看得到（0）／看不到（-9）
    const colNew = new THREE.Color(s.newColor), colOld = new THREE.Color(s.oldColor);
    const bump = (a0: number, a1: number) => smooth((tt - (a0 - 0.06)) / 0.06) * (1 - smooth((tt - a1) / 0.06)); // 扳手套上去 → 放開
    for (let w = 0; w < 4; w++) {
      const pl = this.plan(w, s), slow = w === s.slow, T0 = (k * 8 + w) * 3, T1 = (k * 8 + 4 + w) * 3;
      const pulled = inBox && tt >= pl.pullS, mounted = inBox && tt >= pl.on; // 舊胎已經開始拔了、新胎已經裝上去了
      this.tyres[T0] = pulled ? smooth((tt - pl.pullS) / 0.2) : 0; this.tyres[T0 + 2] = pulled ? 0 : -9; // 拔以前它在車上，由車模的輪子顯示
      let pu = 0; // 新胎往輪軸推的進度；出包的輪子先推到六成卡住（抖動），晚到才推進去
      if (mounted) pu = 1;
      else if (inBox && tt >= pl.finS) pu = (slow ? 0.6 : 0) + (slow ? 0.4 : 1) * smooth((tt - pl.finS) / 0.2);
      else if (inBox && slow && tt >= pl.pushS) pu = 0.6 * smooth((tt - pl.pushS) / 0.25) * (0.88 + 0.12 * Math.sin(tt * 16));
      this.tyres[T1] = pu; this.tyres[T1 + 2] = mounted ? -9 : 0; // 裝上之後藏起來（換成車上的輪子，顏色是新胎）
      this.band.setColorAt(k * 8 + 4 + w, colNew);
      this.band.setColorAt(k * 8 + w, colOld); // 拆下來的舊胎還看得出是什麼胎（真的 F1 磨過也看得出顏色）
      this.gunEng[k * 4 + w] = inBox ? Math.max(bump(pl.A1, pl.E1), bump(pl.V2, pl.E2)) : 0;
      this.axle[k * 4 + w] = pulled && !mounted ? 1 : 0;
      // 車上的輪子：拔下來到裝上之間不在車上（scale 0：玩家的車每格會重設 visible，不能用 visible）
      const sp = s.model?.spin[SPIN_OF[w]];
      if (sp) sp.scale.setScalar(pulled && !mounted ? 1e-4 : 1);
    }
    // 放行牌：放行前 0.25 秒、而且快車道沒有車要過來才轉綠（被擋住時維持紅色；以前時間一到就綠、而且跟起步同一格）
    this.sign.setColorAt(k, new THREE.Color(s.go ? '#22ff66' : '#d81e2a'));
    // 工具：槍手的氣動扳手頂在輪子中心（跟著千斤頂的高度），千斤頂的長柄從車頭、車尾伸進車底
    this.toolLift[k] = inBox ? s.lift : 0;
    this.toolOn[k] = inBox ? 1 : s.phase === 'approach' ? 1 : 0;
    this.place(k);
  }
  /** 每隊：工具在不在手上、千斤頂把車頂多高（place 用） */
  private toolOn = new Uint8Array(TEAMS.length);
  private toolLift = new Float32Array(TEAMS.length);

  /** 把第 k 隊的人、輪胎、放行牌、工具放到世界座標 */
  private place(k: number) {
    const f = this.frames[k], ca = Math.cos(f.h), sa = Math.sin(f.h);
    // 停車格座標（a 沿賽道、b 往車庫、y 離地）→ 世界座標
    const W = (a: number, b: number, y = 0): V3 => [f.x + sa * a - ca * b, f.y + y, f.z + ca * a + sa * b];
    const { M, Q, V, S, up, D } = this;
    const UP: V3 = [0, 1, 0], on = this.toolOn[k] === 1, lift = this.toolLift[k];
    /** 第 i 段骨頭：A → B 的六角柱（r = 半徑） */
    const seg = (i: number, A: V3, B: V3, r: number) => {
      const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], len = Math.hypot(dx, dy, dz);
      if (len < 1e-4) { M.makeScale(0, 0, 0); this.bone.setMatrixAt(i, M); return; }
      Q.setFromUnitVectors(up, D.set(dx / len, dy / len, dz / len));
      M.compose(V.set(A[0], A[1], A[2]), Q, S.set(r, len, r));
      this.bone.setMatrixAt(i, M);
    };
    const hide = (i: number) => { M.makeScale(0, 0, 0); this.bone.setMatrixAt(i, M); }; // 縮成零：不用丟到地底下（那裡的座標是任意的）
    // ---- 1. 每個人的骨架基準：髖、面向、軀幹方向、肩（蹲得越低、走得越快，身體越前傾）
    const ps: Body[] = [];
    for (let m = 0; m < CREW_N; m++) {
      const idx = k * CREW_N + m, o = idx * 3, c = this.pose[o + 2], yaw = this.yaw[idx], sp = this.spd[idx], hp = W(this.pose[o], this.pose[o + 1]);
      const fw: V3 = [Math.sin(yaw), 0, Math.cos(yaw)], lf: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const hip: V3 = [hp[0], f.y + 0.88 - c * 0.4, hp[2]], lean = c * 0.7 + Math.min(1, sp / 3) * 0.14, sl = Math.sin(lean);
      const td: V3 = [fw[0] * sl, Math.cos(lean), fw[2] * sl];
      ps.push({ hip, fw, lf, td, sc: addV(hip, td, 0.5), ph: this.gait[idx], sp, c });
    }
    const hands: [V3 | null, V3 | null][] = ps.map(() => [null, null]);
    // ---- 2. 工具與輪胎：位置由輪子、千斤頂決定，手去抓
    const tb = k * SEG_PER_TEAM + CREW_N * SEG_PER;
    for (let w = 0; w < 4; w++) {
      const [ha, hb, hr] = HUB[w], sb = Math.sign(WHEELS[w][1]), i0 = tb + w * 5, e = this.gunEng[k * 4 + w], gm = w * 3;
      // 軸頭：輪子拆掉的時候露出來
      if (this.axle[k * 4 + w]) seg(tb + 26 + w, W(ha, sb * (hb - 0.1), hr + lift), W(ha, sb * (hb + 0.22), hr + lift), 0.05); else hide(tb + 26 + w);
      // 氣動扳手：套筒＋槍身＋握把＋氣管（兩段，垂到地上再拉回車庫）；套在螺帽上（e = 1）頂著輪子中心，沒在鎖的時候端在車旁
      if (!on) { for (let j = 0; j < 5; j++) hide(i0 + j); continue; }
      const ob: V3 = [-ca * sb, 0, sa * sb], tip = lerpV(W(ha, sb * (hb + 0.32), 0.58), W(ha, sb * (hb + 0.18), hr + lift), e), rear = addV(tip, ob, 0.46);
      const fl = W(ha - 0.7, sb * 3.3, 0.03), mid = lerpV(rear, fl, 0.5); mid[1] = f.y + 0.1;
      seg(i0, tip, addV(tip, ob, 0.08), 0.034);
      seg(i0 + 1, addV(tip, ob, 0.08), rear, 0.056);
      seg(i0 + 2, addV(addV(tip, ob, 0.3), UP, -0.03), addV(addV(tip, ob, 0.34), UP, -0.15), 0.028);
      seg(i0 + 3, rear, mid, 0.015); seg(i0 + 4, mid, fl, 0.015);
      hands[gm] = [addV(addV(tip, ob, 0.18), UP, 0.07), addV(addV(tip, ob, 0.34), UP, -0.13)];
    }
    for (let w = 0; w < 4; w++) { // 輪胎：舊胎從輪軸被拔下來抱走、新胎被抱過來推上輪軸（tyres[o] = 時間方向的進度；高度 < −5 = 看不到）
      const [ha, hb, hr] = HUB[w], sb = Math.sign(WHEELS[w][1]), ax = W(ha, sb * hb, hr + lift);
      for (const [q, role] of [[w, 1], [4 + w, 2]] as const) {
        const o = (k * 8 + q) * 3, qi = k * 8 + q;
        if (this.tyres[o + 2] < -5) { M.makeScale(0, 0, 0); this.tyre.setMatrixAt(qi, M); this.band.setMatrixAt(qi, M); continue; }
        const m = w * 3 + role, p = ps[m], held = addV(addV(p.hip, p.fw, 0.42), UP, -0.1);
        const atAxle = role === 1 ? 1 - this.tyres[o] : this.tyres[o], pos = lerpV(held, ax, atAxle);
        // 抱著的時候輪軸朝著人的面向（轉到一半的時候跟著轉）、在輪軸上時朝著車旁
        const d = this.yaw[k * CREW_N + m] - Math.PI / 2 - f.h, ang = f.h + (d - Math.PI * Math.round(d / Math.PI)) * (1 - atAxle);
        Q.setFromAxisAngle(up, ang);
        M.compose(V.set(pos[0], pos[1], pos[2]), Q, S.set(1, 1, 1));
        this.tyre.setMatrixAt(qi, M); this.band.setMatrixAt(qi, M);
        // 兩手扶在朝著人的那面胎壁上、左右兩側（輪軸在 xt、胎面所在平面的水平方向在 pr）
        const xt: V3 = [Math.cos(ang), 0, -Math.sin(ang)], pr: V3 = [Math.sin(ang), 0, Math.cos(ang)], sg = Math.sign(dot(p.lf, pr)) || 1;
        const gripC = addV(pos, xt, (Math.sign(dot(xt, addV(p.hip, pos, -1))) || 1) * 0.17);
        hands[m] = [addV(gripC, pr, 0.27 * sg), addV(gripC, pr, -0.27 * sg)];
      }
    }
    for (let j = 0; j < 2; j++) { // 前、後千斤頂：墊頭頂在車頭（車尾）底下，長柄伸到千斤頂的人手上
      const m = 12 + j, i0 = tb + 20 + j * 3, p = ps[m];
      if (!on) { for (let q = 0; q < 3; q++) hide(i0 + q); continue; }
      const ac = j === 0 ? 1.95 : -2.1, top = W(ac, 0, (j === 0 ? 0.2 : 0.3) + lift);
      const grip = addV(addV(p.hip, p.fw, 0.42), UP, 0.14), dir = unitV(addV(grip, top, -1));
      seg(i0, top, addV(grip, dir, 0.25), 0.022);
      seg(i0 + 1, W(ac, 0, 0.02), top, 0.035);
      seg(i0 + 2, addV(top, UP, -0.03), top, 0.09);
      hands[m] = [grip, addV(grip, dir, -0.3)];
    }
    { // 放行牌：舉在放行的人身前
      const p = ps[14], base = addV(p.hip, p.fw, 0.3);
      Q.setFromAxisAngle(up, f.h + Math.PI / 2);
      M.compose(V.set(base[0], f.y + 0.5, base[2]), Q, S.set(1, 1, 1));
      this.sign.setMatrixAt(k, M);
      hands[14] = [[base[0], f.y + 1.3, base[2]], [base[0], f.y + 1.02, base[2]]];
    }
    // ---- 3. 身體、頭、四肢
    for (let m = 0; m < CREW_N; m++) {
      const p = ps[m], idx = k * CREW_N + m, hd = hands[m], walk = Math.min(1, p.sp / 2);
      // 軀幹與頭盔：以軀幹方向為 y、面向為 z
      const dz = dot(p.fw, p.td), z = unitV([p.fw[0] - p.td[0] * dz, p.fw[1] - p.td[1] * dz, p.fw[2] - p.td[2] * dz]);
      const x: V3 = [p.td[1] * z[2] - p.td[2] * z[1], p.td[2] * z[0] - p.td[0] * z[2], p.td[0] * z[1] - p.td[1] * z[0]];
      const basis = (at: V3) => M.set(x[0], p.td[0], z[0], at[0], x[1], p.td[1], z[1], at[1], x[2], p.td[2], z[2], at[2], 0, 0, 0, 1);
      basis(p.hip); this.body.setMatrixAt(idx, M);
      basis(addV(p.sc, p.td, 0.24)); this.head.setMatrixAt(idx, M);
      for (const s of [1, -1]) {
        const j = s > 0 ? 0 : 1;
        // 腿：走路時前後擺、蹲的時候一腳在前一腳在後；膝蓋往前彎
        const ph = p.ph + (s > 0 ? 0 : Math.PI), fwd = walk * 0.3 * Math.sin(ph) + p.c * 0.2 * (s > 0 ? 1 : -0.8), fl = walk * 0.12 * Math.max(0, Math.cos(ph));
        const hj = addV(p.hip, p.lf, s * 0.09), an: V3 = [hj[0] + p.fw[0] * fwd, f.y + 0.08 + fl, hj[2] + p.fw[2] * fwd];
        const [kn, en] = ik2(hj, an, 0.41, 0.41, p.fw); // 腿 0.82 m：站直的時候髖到腳踝 0.81 m，膝蓋只微微彎
        seg(boneAt(k, m, 4 + j * 2), hj, kn, 0.075);
        seg(boneAt(k, m, 5 + j * 2), kn, en, 0.055);
        seg(boneAt(k, m, 10 + j), addV(addV(en, p.fw, -0.05), UP, -0.03), addV(addV(en, p.fw, 0.2), UP, -0.03), 0.055);
        // 手：有東西要抓就抓；沒有就自然垂著、走路時跟腿反相擺
        const sh = addV(p.sc, p.lf, s * 0.22);
        let tg = hd[j];
        if (!tg) { const sw = walk * 0.35 * Math.sin(p.ph + (s > 0 ? Math.PI : 0)); tg = [sh[0] + p.fw[0] * (sw + 0.04) + p.lf[0] * s * 0.05, sh[1] - 0.52, sh[2] + p.fw[2] * (sw + 0.04) + p.lf[2] * s * 0.05]; }
        const [el, wr] = ik2(sh, tg, 0.3, 0.28, [p.lf[0] * s * 0.5 - p.fw[0] * 0.4, -0.8, p.lf[2] * s * 0.5 - p.fw[2] * 0.4]);
        seg(boneAt(k, m, j * 2), sh, el, 0.045);
        seg(boneAt(k, m, j * 2 + 1), el, wr, 0.04);
        seg(boneAt(k, m, 8 + j), wr, addV(wr, unitV(addV(wr, el, -1)), 0.1), 0.05);
      }
    }
  }
}
