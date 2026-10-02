import * as THREE from 'three';
import { Car } from './car';
import type { CarModel } from './carModel';
import { makeF1, TEAMS } from './f1model';
import { HALF_WIDTH, type Track } from './track';

// 街道賽的 AI 對手：走「賽車線」（彎道切內側）、照自己的極限速度曲線開、
// 被慢車擋住就挑比較空的一側超車、尾流加速、車與車照動量交換互相撞開

export const LAPS = 3;

export interface Racer {
  name: string;
  team: string;
  color: string;
  car: Car;
  model: CarModel | null; // 玩家的模型由 main 管
  isPlayer: boolean;
  laps: number; // 已經通過起跑線幾次（發車格在線後，第一次通過＝開始第 1 圈）
  finish: number | null; // 完賽時間
  lapStart: number;
  bestLap: number | null;
  profile: Float32Array | null; // 這台 AI 的速度曲線（m/s）
  lat: number; // 超車用的橫向偏移（相對賽車線）
  stuck: number;
}

// 虛構車手；[過彎抓地力用到幾成, 煞車減速度 m/s², 引擎力]（越前面越強）
const DRIVERS: [string, number, number, number][] = [
  ['陳冠宇', 0.985, 36.5, 1.025],
  ['林志豪', 0.98, 36, 1.02],
  ['王柏翰', 0.975, 35.5, 1.015],
  ['張家瑋', 0.97, 35, 1.01],
  ['李承恩', 0.965, 34.5, 1.005],
  ['黃子軒', 0.96, 34, 1.0],
  ['吳俊傑', 0.955, 33.5, 0.995],
];

export const PLAYER_LIVERY = TEAMS[0].livery;

export class RaceField {
  racers: Racer[] = [];
  raceTime = 0;
  private line: Float32Array; // 每個取樣點的賽車線橫向位置（右正）

  aiHits = 0; // 測試用：AI 撞牆次數

  constructor(private scene: THREE.Scene, private t: Track, player: Car) {
    const lineScale = Number(new URLSearchParams(location.search).get('line') ?? 1); // 測試用：賽車線幅度
    this.line = racingLine(t).map((v) => v * lineScale);
    const qs = new URLSearchParams(location.search), gOv = qs.get('g'), bOv = qs.get('b'); // 測試用：覆寫第一台的參數
    DRIVERS.forEach(([name, grip0, brake0, power], k) => {
      const grip = k === 0 && gOv ? Number(gOv) : grip0, brake = k === 0 && bOv ? Number(bOv) : brake0;
      const { team, livery } = TEAMS[k + 1];
      const model = makeF1(livery);
      model.root.visible = false;
      scene.add(model.root);
      const car = new Car();
      car.power = power;
      this.racers.push({ name, team, color: livery.main, car, model, isPlayer: false, laps: 0, finish: null, lapStart: 0, bestLap: null, profile: speedProfile(t, this.line, grip, brake), lat: 0, stuck: 0 });
    });
    this.racers.push({ name: '你', team: TEAMS[0].team, color: TEAMS[0].livery.main, car: player, model: null, isPlayer: true, laps: 0, finish: null, lapStart: 0, bestLap: null, profile: null, lat: 0, stuck: 0 });
  }

  /** 排發車格：兩列交錯，每格 8 m；玩家排在第 playerSlot 格（0 = 竿位） */
  setup(playerSlot: number) {
    const order = this.racers.filter((r) => !r.isPlayer);
    const player = this.racers.find((r) => r.isPlayer)!;
    order.splice(Math.min(playerSlot, order.length), 0, player);
    const t = this.t;
    order.forEach((r, k) => {
      const back = 14 + k * 8;
      const i = Math.round((t.length - back) / t.ds) % t.N;
      r.car.placeAt(t, i);
      const lat = k % 2 === 0 ? -2.6 : 2.6;
      r.car.x += -t.tz[i] * lat;
      r.car.z += t.tx[i] * lat;
      r.car.pos.lat = lat;
      r.lat = lat - this.line[i];
      r.laps = 0;
      r.finish = null;
      r.bestLap = null;
      r.lapStart = 0;
      r.stuck = 0;
    });
    this.raceTime = 0;
    for (const r of this.racers) if (r.model) r.model.root.visible = true;
  }

  hide() { for (const r of this.racers) if (r.model) r.model.root.visible = false; }

  progress(r: Racer) { return (r.laps - 1) * this.t.length + r.car.pos.s; }

  /** 名次：已完賽的照完賽時間，其他照跑了多遠 */
  standings(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.finish != null && b.finish != null) return a.finish - b.finish;
      if (a.finish != null) return -1;
      if (b.finish != null) return 1;
      return this.progress(b) - this.progress(a);
    });
  }

  /** 每一步：AI 開車、尾流、碰撞、計圈。回傳玩家撞到別車的力道 */
  update(dt: number, racing: boolean): number {
    const t = this.t;
    if (racing) this.raceTime += dt;
    // 尾流：前方 25 m 內、橫向 2.5 m 內有車 → 引擎多 5% 力
    for (const r of this.racers) {
      r.car.boost = 0;
      for (const o of this.racers) {
        if (o === r) continue;
        let d = o.car.pos.s - r.car.pos.s;
        if (d < -t.length / 2) d += t.length;
        if (d > 3 && d < 25 && Math.abs(o.car.pos.lat - r.car.pos.lat) < 2.5) { r.car.boost = 0.05; break; }
      }
    }
    for (const r of this.racers) {
      if (r.isPlayer) continue;
      const c = r.car;
      if (!racing) { c.update(dt, t, 0, true); continue; } // 起跑前停在格位
      const prevS = c.pos.s;
      const { steer, brake } = this.drive(r, r.finish != null);
      if (c.update(dt, t, steer, brake) > 0) this.aiHits++;
      this.lapCheck(r, prevS);
    }
    // ---- 車與車碰撞：前後兩個圓，同質量的動量交換（被撞的那台會被推開、車頭被撞歪）
    let playerHit = 0;
    for (let a = 0; a < this.racers.length; a++) for (let b = a + 1; b < this.racers.length; b++) {
      const A = this.racers[a].car, B = this.racers[b].car;
      if (Math.abs(A.x - B.x) > 8 || Math.abs(A.z - B.z) > 8) continue;
      for (const oa of [1.6, -1.6]) for (const ob of [1.6, -1.6]) {
        const ax = A.x + Math.sin(A.h) * oa, az = A.z + Math.cos(A.h) * oa;
        const bx = B.x + Math.sin(B.h) * ob, bz = B.z + Math.cos(B.h) * ob;
        const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), R = 1.9;
        if (d >= R || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, push = (R - d) / 2;
        A.x += nx * push; A.z += nz * push;
        B.x -= nx * push; B.z -= nz * push;
        const vax = Math.sin(A.h) * A.v, vaz = Math.cos(A.h) * A.v, vbx = Math.sin(B.h) * B.v, vbz = Math.cos(B.h) * B.v;
        const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
        if (vn >= 0) continue;
        const J = (-(1 + 0.35) * vn) / 2; // 同質量、反彈係數 0.35
        kick(A, nx * J, nz * J);
        kick(B, -nx * J, -nz * J);
        if (this.racers[a].isPlayer || this.racers[b].isPlayer) playerHit = Math.max(playerHit, -vn + 2);
      }
    }
    return playerHit;
  }

  /** 玩家的計圈（main 在玩家的物理之後呼叫） */
  playerLap(prevS: number) { this.lapCheck(this.racers.find((r) => r.isPlayer)!, prevS); }

  private lapCheck(r: Racer, prevS: number) {
    const L = this.t.length, s = r.car.pos.s;
    if (!(prevS > L - 40 && s < 40)) return;
    if (r.laps >= 1) {
      const lt = this.raceTime - r.lapStart;
      if (r.bestLap == null || lt < r.bestLap) r.bestLap = lt;
    }
    r.laps++;
    r.lapStart = this.raceTime;
    if (r.laps > LAPS && r.finish == null) r.finish = this.raceTime;
  }

  private drive(r: Racer, cooldown: boolean) {
    const t = this.t, c = r.car, i = c.pos.i, N = t.N;
    // 前方擋路的車：同一條線上、前面 24 m 內
    let blocker: Racer | null = null, gap = Infinity;
    for (const o of this.racers) {
      if (o === r) continue;
      let d = o.car.pos.s - c.pos.s;
      if (d < -t.length / 2) d += t.length;
      if (d > 0 && d < 24 && Math.abs(o.car.pos.lat - c.pos.lat) < 2.4 && d < gap) { gap = d; blocker = o; }
    }
    const ahead = (i + Math.round((c.v * 0.45) / t.ds)) % N;
    const want = cooldown ? Math.min(25, r.profile![ahead]) : r.profile![ahead]; // 完賽後跑慢速收車圈
    if (blocker && blocker.car.v < want + 2) {
      // 換到比較空的一側超車（相對賽車線，不超出路面）
      const crowd = (side: number) => this.racers.reduce((n, o) => {
        if (o === r || o === blocker) return n;
        let d = o.car.pos.s - c.pos.s;
        if (d < -t.length / 2) d += t.length;
        return n + (Math.abs(d) < 15 && Math.abs(o.car.pos.lat - side) < 2.2 ? 1 : 0);
      }, 0);
      const bl = blocker.car.pos.lat - this.line[i];
      const pref = bl > 0 ? -3.4 : 3.4, other = -pref;
      r.lat = crowd(this.line[i] + pref) <= crowd(this.line[i] + other) ? pref : other;
    } else if (!blocker) {
      r.lat += (0 - r.lat) * Math.min(1, 0.8 / 120); // 沒人擋：慢慢回到賽車線
    }
    const j = (i + Math.round((8 + c.v * 0.42) / t.ds)) % N;
    const off = Math.max(-(HALF_WIDTH - 1.3), Math.min(HALF_WIDTH - 1.3, this.line[j] + r.lat));
    const tx = t.px[j] - t.tz[j] * off, tz = t.pz[j] + t.tx[j] * off;
    let err = Math.atan2(tx - c.x, tz - c.z) - c.h;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    let brake = c.v > want + 0.5;
    // 換邊來不及就跟著前車速度（約 0.2 秒的跟車距離）
    if (blocker && gap < 6 + c.v * 0.12 && Math.abs(blocker.car.pos.lat - c.pos.lat) < 1.8 && c.v > blocker.car.v - 1) brake = true;
    // 卡住太久（撞牆停住）就自動扶正
    r.stuck = c.v < 2 ? r.stuck + 1 / 120 : 0;
    if (r.stuck > 3) { c.placeAt(t, i); r.stuck = 0; }
    return { steer: Math.max(-1, Math.min(1, -err * 2.6)), brake };
  }

  render(dt: number) {
    for (const r of this.racers) {
      if (!r.model) continue;
      const c = r.car, m = r.model;
      m.root.position.set(c.x, 0, c.z);
      m.root.rotation.y = c.h;
      m.body.rotation.z = c.steer * Math.min(1, c.v / 40) * 0.04;
      for (const w of m.steer) w.rotation.y = -c.steer * 0.35;
      for (const w of m.spin) w.rotation.x += (c.v / 0.36) * dt;
    }
  }
}

/**
 * 被撞的速度變化 (dvx, dvz) 套到賽車上：沿車頭的分量改變速度；側向分量讓車頭被撞歪、車身被推開。
 * （賽車物理只有沿車頭的速度，所以側向衝擊改成「轉向＋位移」來表現）
 */
function kick(c: Car, dvx: number, dvz: number) {
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  const dl = dvx * fx + dvz * fz, dlat = dvx * -fz + dvz * fx; // 右正
  c.v = Math.max(0, c.v + dl);
  c.h -= Math.atan2(dlat, Math.max(c.v, 8)) * 0.9;
  c.x += -fz * dlat * 0.12;
  c.z += fx * dlat * 0.12;
}

/** 賽車線：彎道往內側切（最多離中心 5.2 m），再大範圍平滑，讓進彎外側→彎心內側→出彎外側的形狀自然出現 */
function racingLine(t: Track): Float32Array {
  const N = t.N, raw = new Float32Array(N), out = new Float32Array(N);
  const MAX = HALF_WIDTH - Number(new URLSearchParams(location.search).get('lm') ?? 1.8); // 離路緣留多少（測試可調）
  // 曲率正 = 右彎，內側在右邊（橫向正）
  for (let i = 0; i < N; i++) raw[i] = Math.sign(t.curv[i]) * MAX * Math.min(1, Math.abs(t.curv[i]) / 0.018);
  let cur = raw;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(N), W = 14;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -W; k <= W; k++) s += cur[(i + k + N) % N];
      next[i] = s / (2 * W + 1);
    }
    cur = next;
  }
  for (let i = 0; i < N; i++) out[i] = Math.max(-MAX, Math.min(MAX, cur[i] * 1.6));
  return out;
}

/** 照賽車線本身的曲率算極限速度（grip 成抓地力），再往回推煞車點 */
function speedProfile(t: Track, line: Float32Array, grip: number, brake: number): Float32Array {
  const N = t.N, px = new Float32Array(N), pz = new Float32Array(N), v = new Float32Array(N);
  for (let i = 0; i < N; i++) { px[i] = t.px[i] - t.tz[i] * line[i]; pz[i] = t.pz[i] + t.tx[i] * line[i]; }
  const G0 = 20 * grip, GK = 0.004 * grip, VMAX = 84 * 1.03;
  // 曲率：用前後各 6 點（約 24 m）量方向變化，再平滑一次；量太短會有雜訊，害 AI 在不是彎的地方亂煞車
  const kr = new Float32Array(N), ks = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 6 + N) % N, b = (i + 6) % N, a1 = (i - 5 + N) % N, b1 = (i + 5) % N;
    const h1 = Math.atan2(px[a1] - px[a], pz[a1] - pz[a]), h2 = Math.atan2(px[b] - px[b1], pz[b] - pz[b1]);
    const dh = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
    let len = 0;
    for (let k = -6; k < 6; k++) { const p = (i + k + N) % N, q = (i + k + 1 + N) % N; len += Math.hypot(px[q] - px[p], pz[q] - pz[p]); }
    kr[i] = dh / (len - Math.hypot(px[a1] - px[a], pz[a1] - pz[a]) || 1);
  }
  for (let i = 0; i < N; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += kr[(i + k + N) % N]; ks[i] = s / 7; }
  for (let i = 0; i < N; i++) {
    const k = ks[i];
    v[i] = k > GK + 1e-5 ? Math.min(VMAX, Math.sqrt(G0 / (k - GK))) : VMAX;
  }
  const sm = v;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N;
      sm[i] = Math.min(sm[i], Math.sqrt(sm[j] ** 2 + 2 * brake * t.ds));
    }
  }
  return sm;
}
