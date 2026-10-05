import * as THREE from 'three';
import { FreeCar, type CarSpec } from './freecar';
import type { Collider, RoadNet } from './citydata';
import type { Router } from './router';
import type { Traffic } from './traffic';
import { buildPlayerVehicle, vehicleById, type PlayerVehicle } from './vehicles';

// 警察追逐（GTA 風）：撞車、撞人、闖紅燈、撞警車會累積通緝（最多 5 星），星數越多警車越多越快；
// 警車照路網追過來，近了直接衝撞；停在警車旁邊 3 秒＝被逮捕（罰款）；離所有警車夠遠撐 12 秒＝甩掉。
// 反過來：開巡邏車按「追緝」會冒出一台逃逸的嫌犯車，撞到它停下來就逮捕成功

interface Unit {
  car: FreeCar;
  pv: PlayerVehicle;
  path: [number, number][] | null;
  repath: number;
  stuck: number;
  reverse: number;
  goal?: [number, number]; // 嫌犯要逃去的地方
}

const COP_SPEC: CarSpec = { engine: 10.5, vmax: 40, brake: 18, grip: 15, mass: 1.25 };
const SUSPECT_SPEC: CarSpec = { engine: 9.5, vmax: 36, brake: 16, grip: 13.5, mass: 1 };
const MAX_UNITS = 4;
const LOSE_DIST = 160, LOSE_TIME = 12, BUST_TIME = 3;

/** 兩台 FreeCar 互撞：照質量交換動量（a 是主動算的那台，b 吃反作用）；回傳撞擊力道 */
export function bumpCars(a: FreeCar, b: FreeCar): number {
  if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) return 0;
  const R = FreeCar.RADIUS, inv = a.spec.mass / b.spec.mass, share = inv / (1 + inv);
  let impact = 0;
  for (const [ax, az] of a.circles()) for (const [bx, bz] of b.circles()) {
    const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
    if (d >= R * 2 || d < 1e-4) continue;
    const nx = dx / d, nz = dz / d, depth = R * 2 - d;
    const hit = a.contact(nx, nz, depth * (1 - share), bx + nx * R, bz + nz * R, b.vx, b.vz, 0.3, 0.4, inv);
    b.x -= nx * depth * share; b.z -= nz * depth * share;
    b.vx -= a.jx * inv; b.vz -= a.jz * inv;
    impact = Math.max(impact, hit);
  }
  return impact;
}

export class Police {
  heat = 0;
  stars = 0;
  units: Unit[] = [];
  lostT = 0; // 多久沒被警車看到
  bustT = 0; // 停在警車旁邊多久
  suspect: Unit | null = null;
  suspectHp = 0;
  pursuitT = 0; // 追緝剩幾秒
  private arrestT = 0;
  private escapeT = 0;
  private spawnT = 0;
  private lastSignal: object | null = null;
  private crashCool = 0;
  private copPool: PlayerVehicle[] = [];
  private suspectPv: PlayerVehicle;
  private suspectPaint = ['#2a2a2a', '#7a1f1f', '#e8e8e8', '#304a6e'];
  constructor(scene: THREE.Scene, private router: Router, private net: RoadNet) {
    for (let k = 0; k < MAX_UNITS; k++) {
      const pv = buildPlayerVehicle(vehicleById('police'));
      pv.model.root.visible = false;
      scene.add(pv.model.root);
      this.copPool.push(pv);
    }
    this.suspectPv = buildPlayerVehicle(vehicleById('sedan'));
    this.suspectPv.model.root.visible = false;
    scene.add(this.suspectPv.model.root);
  }

  get wanted() { return this.stars > 0; }
  get active() { return this.stars > 0 || !!this.suspect; }

  /** 犯規：amount 加到通緝值上（滿 1 是一顆星）；回傳要顯示的訊息（星數變多時） */
  crime(amount: number, why: string): string | null {
    if (this.suspect) return null; // 自己在當警察
    if (why === '撞車') { if (this.crashCool > 0) return null; this.crashCool = 1; }
    const before = this.stars;
    this.heat = Math.min(5.99, this.heat + amount);
    this.stars = Math.min(5, Math.floor(this.heat));
    this.lostT = 0;
    if (this.stars > before) return `🚨 ${why}！通緝 ${'★'.repeat(this.stars)}`;
    return null;
  }

  clear() {
    this.heat = 0; this.stars = 0; this.lostT = 0; this.bustT = 0;
    for (const u of this.units) u.pv.model.root.visible = false;
    this.units = [];
  }

  /** 開巡邏車時：叫出一台逃逸的嫌犯車 */
  startPursuit(p: FreeCar): string | null {
    if (this.suspect || this.wanted) return null;
    const at = this.roadPointNear(p.x + Math.sin(p.h) * 90, p.z + Math.cos(p.h) * 90, 0, p.h);
    if (!at) return null;
    const car = new FreeCar();
    car.spec = SUSPECT_SPEC;
    car.place(at[0], at[1], at[2]);
    this.suspectPv.setPaint(this.suspectPaint[Math.floor(Math.random() * this.suspectPaint.length)]);
    this.suspect = { car, pv: this.suspectPv, path: null, repath: 0, stuck: 0, reverse: 0 };
    this.suspectHp = 100;
    this.pursuitT = 150; this.arrestT = 0; this.escapeT = 0;
    this.pickGoal(this.suspect, p);
    return '🎯 嫌犯出現！撞到它停下來';
  }

  private pickGoal(u: Unit, p: FreeCar) {
    // 往離玩家遠的方向逃：900~1500 m 外的道路
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, d = 900 + Math.random() * 600;
      const at = this.roadPointNear(u.car.x + Math.sin(a) * d, u.car.z + Math.cos(a) * d, 0, 0);
      if (at && Math.hypot(at[0] - p.x, at[1] - p.z) > Math.hypot(u.car.x - p.x, u.car.z - p.z)) { u.goal = [at[0], at[1]]; u.repath = 0; return; }
    }
  }

  /** 離 (x, z) 最近的主要道路上的點（含順著道路的車頭方向）；minD > 0 時找離玩家至少這麼遠的 */
  private roadPointNear(x: number, z: number, _minD: number, h: number): [number, number, number] | null {
    let best: [number, number, number] | null = null, bd = Infinity;
    for (const s of this.net.segGrid.query(x, z, 60)) {
      if (s.way.c > 2) continue;
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / l2));
      const px = s.x1 + dx * t, pz = s.z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d >= bd) continue;
      bd = d;
      let hh = Math.atan2(dx, dz);
      if (s.way.o === -1) hh += Math.PI;
      else if (!s.way.o && Math.cos(hh - h) < 0) hh += Math.PI;
      best = [px, pz, hh];
    }
    return best;
  }

  /** 開車：沿路線（或近距離直接衝向目標）；回傳要不要開、方向盤 */
  private drive(u: Unit, tx: number, tz: number, vmax: number, dt: number, col: Collider | null, direct: boolean, closeV = Infinity) {
    const c = u.car;
    u.repath -= dt;
    if (!direct && u.repath <= 0) {
      u.repath = 1.5;
      u.path = this.router.route(c.x, c.z, tx, tz)?.path ?? null;
    }
    let ax = tx, az = tz;
    if (!direct && u.path && u.path.length > 1) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < u.path.length; i++) { const d = (u.path[i][0] - c.x) ** 2 + (u.path[i][1] - c.z) ** 2; if (d < bd) { bd = d; bi = i; } }
      const j = Math.min(u.path.length - 1, bi + 3 + Math.round(Math.abs(c.v) * 0.3));
      [ax, az] = u.path[j];
    }
    let e = Math.atan2(ax - c.x, az - c.z) - c.h;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    let steer = Math.max(-1, Math.min(1, -e * 2.2)), throttle = true, brake = false;
    const want = Math.min(closeV, vmax * (Math.abs(e) > 0.6 ? 0.4 : Math.abs(e) > 0.3 ? 0.65 : 1));
    if (c.v > want + 2) { throttle = false; brake = true; }
    // 卡住（撞到牆、被車擋住）：倒車一下再走
    if (u.reverse > 0) {
      u.reverse -= dt;
      throttle = false; brake = true; steer = e > 0 ? -1 : 1;
    } else if (throttle && Math.abs(c.v) < 1.2) {
      u.stuck += dt;
      if (u.stuck > 1.5) { u.stuck = 0; u.reverse = 1.1; }
    } else u.stuck = 0;
    c.update(dt, steer, throttle, brake, col);
  }

  /** 每步更新；crimesOn = false 時（街頭比賽、自己開警車）不會被通緝。回傳要顯示的訊息與金額變化 */
  update(dt: number, p: FreeCar, col: Collider | null, traffic: Traffic | null, crimesOn: boolean): { msg: string | null; money: number } {
    let msg: string | null = null, money = 0;
    this.crashCool = Math.max(0, this.crashCool - dt);
    // 闖紅燈：開進號誌路口那一刻是紅燈、速度夠快
    const copNear = this.units.some((u) => Math.hypot(u.car.x - p.x, u.car.z - p.z) < 15); // 被警車撞進路口不算闖紅燈
    if (crimesOn && traffic && !this.suspect) {
      const s = traffic.signalAt(p.x, p.z, Math.sin(p.h), Math.cos(p.h));
      if (s && s.id !== this.lastSignal && s.red && p.v > 8 && !copNear) msg = this.crime(0.6, '闖紅燈') ?? msg;
      this.lastSignal = s ? s.id : null;
    }
    if (!crimesOn && this.wanted && !this.suspect) { this.clear(); return { msg: null, money: 0 }; }

    // ---- 被通緝：警車
    if (this.wanted) {
      const want = Math.min(MAX_UNITS, this.stars);
      this.spawnT -= dt;
      if (this.units.length < want && this.spawnT <= 0) {
        this.spawnT = 2.5;
        const a = Math.random() * Math.PI * 2;
        // 在甩開距離以內出現（130 m）：一出現就算「被看到」，車頭大致朝向玩家
        const at = this.roadPointNear(p.x + Math.sin(a) * 130, p.z + Math.cos(a) * 130, 0, a + Math.PI);
        if (at) {
          const pv = this.copPool.find((c) => !this.units.some((u) => u.pv === c))!;
          const car = new FreeCar();
          car.spec = COP_SPEC;
          car.place(at[0], at[1], at[2]);
          this.units.push({ car, pv, path: null, repath: 0, stuck: 0, reverse: 0 });
        }
      }
      const vmax = 24 + this.stars * 2.5;
      let nearest = Infinity;
      for (const u of this.units) {
        const d = Math.hypot(u.car.x - p.x, u.car.z - p.z);
        nearest = Math.min(nearest, d);
        // 近了直接衝撞（往玩家前面一點的位置）
        const lead = Math.min(0.6, d / 40);
        // 遠的時候全速追、35 m 內直接衝過來、12 m 內放慢貼著你（逼停，不要一直把人撞飛）
        this.drive(u, p.x + p.vx * lead, p.z + p.vz * lead, vmax, dt, col, d < 35, d < 12 ? Math.abs(p.v) + 3 : Infinity);
        if (traffic) traffic.collidePlayer(u.car); // 警車也會把車流撞開
        // 撞警車：只算玩家主動撞過去（朝著警車、而且比它快）
        const tx = u.car.x - p.x, tz = u.car.z - p.z, tl = Math.hypot(tx, tz) || 1;
        const toward = (p.vx * tx + p.vz * tz) / tl, copToward = -(u.car.vx * tx + u.car.vz * tz) / tl;
        const hit = bumpCars(p, u.car);
        if (hit > 4 && crimesOn && toward > 6 && toward > copToward) msg = this.crime(0.4, '撞警車') ?? msg;
      }
      for (let i = 0; i < this.units.length; i++) for (let j = i + 1; j < this.units.length; j++) bumpCars(this.units[i].car, this.units[j].car);
      // 太遠的警車收掉（之後會在附近重新出現）
      this.units = this.units.filter((u) => { const far = Math.hypot(u.car.x - p.x, u.car.z - p.z) > 450; if (far) u.pv.model.root.visible = false; return !far; });
      // 甩掉：離所有警車夠遠、撐一段時間
      if (this.units.length && nearest > LOSE_DIST) this.lostT += dt; else this.lostT = 0; // 警車還沒出現時不算甩開
      if (this.lostT > LOSE_TIME) { this.clear(); msg = '😎 甩掉警察了！'; }
      // 被逮捕：警車在旁邊、自己停住
      if (nearest < 9 && Math.hypot(p.vx, p.vz) < 4) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt * 2);
      if (this.bustT > BUST_TIME) {
        const fine = 200 * this.stars;
        this.clear();
        money = -fine;
        msg = `🚔 被逮捕了！罰款 NT$ ${fine}`;
      }
    }

    // ---- 自己當警察：嫌犯車
    const s = this.suspect;
    if (s) {
      this.pursuitT -= dt;
      const d = Math.hypot(s.car.x - p.x, s.car.z - p.z);
      if (this.suspectHp > 0) {
        if (!s.goal || Math.hypot(s.goal[0] - s.car.x, s.goal[1] - s.car.z) < 40) this.pickGoal(s, p);
        this.drive(s, s.goal![0], s.goal![1], SUSPECT_SPEC.vmax * (d < 60 ? 1 : 0.8), dt, col, false);
        if (traffic) traffic.collidePlayer(s.car);
      } else s.car.update(dt, 0, false, true, col); // 撞壞了：停下來
      const hit = bumpCars(p, s.car);
      if (hit > 2) this.suspectHp = Math.max(0, this.suspectHp - hit * 5);
      // 逮捕：嫌犯停下來（撞壞或被逼停）、警車貼在旁邊
      if (d < 10 && Math.abs(s.car.v) < 2) this.arrestT += dt; else this.arrestT = Math.max(0, this.arrestT - dt);
      if (d > 380) this.escapeT += dt; else this.escapeT = 0;
      if (this.arrestT > 1.5) {
        const reward = 400 + Math.round(Math.max(0, this.pursuitT) * 2);
        money = reward;
        msg = `✅ 逮捕嫌犯！獎金 NT$ ${reward}`;
        this.endPursuit();
      } else if (this.escapeT > 6 || this.pursuitT <= 0) {
        msg = '💨 嫌犯跑掉了…';
        this.endPursuit();
      }
    }
    return { msg, money };
  }

  endPursuit() {
    if (this.suspect) this.suspect.pv.model.root.visible = false;
    this.suspect = null;
  }

  /** 畫面：警車與嫌犯車的位置、車輪、警示燈 */
  render(dt: number, t: number) {
    const draw = (u: Unit) => {
      const m = u.pv.model;
      m.root.visible = true;
      m.root.position.set(u.car.x, -0.25, u.car.z);
      m.root.rotation.y = u.car.h;
      m.body.rotation.z = u.car.steer * Math.min(1, Math.abs(u.car.v) / 40) * 0.06;
      for (const w of m.steer) w.rotation.y = -u.car.steer * 0.45;
      for (const w of m.spin) w.rotation.x += (u.car.v / 0.35) * dt;
      u.pv.tick(t);
    };
    for (const u of this.units) draw(u);
    if (this.suspect) draw(this.suspect);
  }

  /** 小地圖用：警車（紅藍）與嫌犯（橘） */
  get mapDots(): { x: number; z: number; color: string }[] {
    return [...this.units.map((u) => ({ x: u.car.x, z: u.car.z, color: '#3a6cff' })), ...(this.suspect ? [{ x: this.suspect.car.x, z: this.suspect.car.z, color: '#ff8a1a' }] : [])];
  }

  hide() { this.clear(); this.endPursuit(); }
}
