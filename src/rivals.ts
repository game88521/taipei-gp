import * as THREE from 'three';
import { Car } from './car';
import { makeCar, type CarModel } from './carModel';
import { HALF_WIDTH, type Track } from './track';

// 街道賽的 AI 對手：照建議速度曲線開、被慢車擋住就換邊超車、尾流加速、互相碰撞

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
  skill: number; // 煞車點：建議速度 × skill
  lat: number; // 目標橫向位置（超車用）
  stuck: number;
}

// 虛構的車隊與車手
const FIELD: [string, string, string, number, number][] = [
  ['陳冠宇', '珍奶 Boba GP', '#c8a070', 1.035, 1.0],
  ['林志豪', '捷運藍 Metro Blue', '#1f5fa8', 1.03, 0.995],
  ['王柏翰', '夜市 Night Market', '#7a3cc8', 1.02, 0.99],
  ['張家瑋', '黃色計程 Taxi Racing', '#f5c518', 1.015, 0.985],
  ['李承恩', '玉山 Jade', '#1a8a5a', 1.005, 0.98],
  ['黃子軒', '鳳梨酥 Pineapple', '#f08a1a', 0.995, 0.975],
  ['吳俊傑', '白鷺 Egret', '#e8e8e8', 0.985, 0.97],
];

export class RaceField {
  racers: Racer[] = [];
  raceTime = 0;

  constructor(private scene: THREE.Scene, private t: Track, player: Car) {
    for (const [name, team, color, skill, power] of FIELD) {
      const model = makeCar(color);
      model.root.visible = false;
      scene.add(model.root);
      const car = new Car();
      car.power = power;
      this.racers.push({ name, team, color, car, model, isPlayer: false, laps: 0, finish: null, lapStart: 0, bestLap: null, skill, lat: 0, stuck: 0 });
    }
    this.racers.push({ name: '你', team: '台北 101 Racing', color: '#d81e2a', car: player, model: null, isPlayer: true, laps: 0, finish: null, lapStart: 0, bestLap: null, skill: 1, lat: 0, stuck: 0 });
  }

  /** 排發車格：兩列交錯，每格 8 m；玩家排在第 gridSlot 格（0 = 竿位） */
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
      r.lat = lat;
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
      c.update(dt, t, steer, brake);
      this.lapCheck(r, prevS);
    }
    // 車與車碰撞：每台車用前後兩個圓
    let playerHit = 0;
    for (let a = 0; a < this.racers.length; a++) for (let b = a + 1; b < this.racers.length; b++) {
      const A = this.racers[a].car, B = this.racers[b].car;
      if (Math.abs(A.x - B.x) > 8 || Math.abs(A.z - B.z) > 8) continue;
      for (const oa of [1.6, -1.6]) for (const ob of [1.6, -1.6]) {
        const ax = A.x + Math.sin(A.h) * oa, az = A.z + Math.cos(A.h) * oa;
        const bx = B.x + Math.sin(B.h) * ob, bz = B.z + Math.cos(B.h) * ob;
        const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), R = 1.9;
        if (d >= R || d < 1e-4) continue;
        const push = (R - d) / 2, nx = dx / d, nz = dz / d;
        A.x += nx * push; A.z += nz * push;
        B.x -= nx * push; B.z -= nz * push;
        // 追撞：後車掉速、前車被推一點
        const dv = A.v - B.v;
        const aBehind = (Math.sin(A.h) * -nx + Math.cos(A.h) * -nz) > 0;
        if (aBehind && dv > 0) { A.v -= dv * 0.6; B.v += dv * 0.2; } else if (!aBehind && dv < 0) { B.v += dv * 0.6; A.v -= dv * 0.2; }
        if (this.racers[a].isPlayer || this.racers[b].isPlayer) playerHit = Math.max(playerHit, Math.abs(dv) + 2);
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
    // 前方擋路的車：同一條線上、前面 22 m 內
    let blocker: Racer | null = null, gap = Infinity;
    for (const o of this.racers) {
      if (o === r) continue;
      let d = o.car.pos.s - c.pos.s;
      if (d < -t.length / 2) d += t.length;
      if (d > 0 && d < 22 && Math.abs(o.car.pos.lat - c.pos.lat) < 2.4 && d < gap) { gap = d; blocker = o; }
    }
    const ahead = (i + Math.round((c.v * 0.5) / t.ds)) % N;
    const want = cooldown ? Math.min(25, t.vTarget[ahead]) : t.vTarget[ahead] * r.skill; // 完賽後跑慢速收車圈
    if (blocker && blocker.car.v < want + 1) {
      // 換到另一邊超車（不超出路面）
      const left = -3.4, right = 3.4;
      const crowd = (side: number) => this.racers.reduce((n, o) => {
        if (o === r || o === blocker) return n;
        let d = o.car.pos.s - c.pos.s;
        if (d < -t.length / 2) d += t.length;
        return n + (Math.abs(d) < 15 && Math.abs(o.car.pos.lat - side) < 2.2 ? 1 : 0);
      }, 0);
      const pref = blocker.car.pos.lat > 0 ? left : right;
      const other = pref === left ? right : left;
      r.lat = crowd(pref) <= crowd(other) ? pref : other;
    } else if (!blocker) {
      // 沒人擋：慢慢回到賽車線（中心）
      r.lat += (0 - r.lat) * Math.min(1, 0.6 / 120);
    }
    r.lat = Math.max(-(HALF_WIDTH - 2), Math.min(HALF_WIDTH - 2, r.lat));
    const j = (i + Math.round((8 + c.v * 0.45) / t.ds)) % N;
    const tx = t.px[j] - t.tz[j] * r.lat, tz = t.pz[j] + t.tx[j] * r.lat;
    let err = Math.atan2(tx - c.x, tz - c.z) - c.h;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    let brake = c.v > want + 1;
    // 還是貼得太近（換邊來不及）就跟著前車速度
    if (blocker && gap < 6 + c.v * 0.12 && Math.abs(blocker.car.pos.lat - c.pos.lat) < 1.8 && c.v > blocker.car.v - 1) brake = true; // 約 0.2 秒的跟車距離
    // 卡住太久（撞牆停住）就自動扶正
    r.stuck = c.v < 2 ? r.stuck + 1 / 120 : 0;
    if (r.stuck > 3) { c.placeAt(t, i); r.stuck = 0; }
    return { steer: Math.max(-1, Math.min(1, -err * 2.5)), brake };
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
