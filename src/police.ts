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
// 甩掉：離所有警車 110 m 以外、撐 7 秒（Rex 覺得原本 160 m／12 秒太難）
const LOSE_DIST = 110, BUST_TIME = 3;
export const LOSE_TIME = 7;
const MAX_CHASERS = 3; // 同時追你的警車最多幾台

/** 拒馬：被撞到會飛出去（簡單的拋物線＋翻滾），一段時間後消失 */
interface Barrier { m: THREE.Mesh; x: number; z: number; vx: number; vy: number; vz: number; y: number; spin: number; hit: boolean }
/** 路障：兩台橫停的警車＋中間一排拒馬 */
interface Roadblock { cops: Unit[]; bars: Barrier[]; x: number; z: number; age: number }

/** 直升機：機身、尾桁、旋翼、探照燈光錐＋地上的光圈 */
function makeHeli(): { g: THREE.Group; rotor: THREE.Object3D; tail: THREE.Object3D; beam: THREE.Mesh; spot: THREE.Mesh } {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: '#1d2a4a' }), white = new THREE.MeshLambertMaterial({ color: '#e8e8e8' });
  const cab = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 10).scale(1, 0.85, 1.7), body);
  g.add(cab);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.1, 0.8, 1.2).rotateX(Math.PI / 2.4).translate(0, 0.2, 1.4), new THREE.MeshStandardMaterial({ color: '#7fb6d8', metalness: 0.5, roughness: 0.1 }));
  g.add(glass);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.25, 3.6).translate(0, -0.3, 0), white);
  g.add(stripe);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 5, 8).rotateX(Math.PI / 2).translate(0, 0.3, -4.2), body);
  g.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.8).translate(0, 0.9, -6.6), body);
  g.add(fin);
  for (const s of [-1, 1]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.2).translate(s * 1.1, -1.55, 0), white)); // 起落架
  const rotor = new THREE.Group();
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 6.2), new THREE.MeshLambertMaterial({ color: '#202226' })); b.rotation.y = (k * Math.PI) / 4; b.position.z = 0; rotor.add(b); }
  rotor.position.y = 1.55;
  g.add(rotor);
  const tail = new THREE.Group();
  tail.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.18), new THREE.MeshLambertMaterial({ color: '#202226' })));
  tail.position.set(0.15, 0.9, -6.6);
  g.add(tail);
  // 探照燈：往下的光錐（加法混色）＋地上的光圈
  const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 1, 24, 1, true).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1.1), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  const spot = new THREE.Mesh(new THREE.CircleGeometry(7, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.1, 1.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -60 }));
  g.visible = beam.visible = spot.visible = false;
  return { g, rotor, tail, beam, spot };
}

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
  private blockPool: PlayerVehicle[] = []; // 路障用的警車（另外一組）
  private barPool: THREE.Mesh[] = [];
  blocks: Roadblock[] = [];
  private blockT = 0;
  heli = { on: false, x: 0, z: 0, h: 0, vx: 0, vz: 0 };
  private heliM: ReturnType<typeof makeHeli>;
  /** 直升機旋翼聲要不要播（main 用）：0~1 */
  heliVol = 0;
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
    for (let k = 0; k < 4; k++) {
      const pv = buildPlayerVehicle(vehicleById('police'));
      pv.model.root.visible = false;
      scene.add(pv.model.root);
      this.blockPool.push(pv);
    }
    // 拒馬：紅白相間的橫桿＋兩支腳
    const barTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 8; const x = c.getContext('2d')!; for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#e01818'; x.fillRect(i * 8, 0, 8, 8); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    for (let k = 0; k < 12; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.12).translate(0, 0.95, 0), new THREE.MeshLambertMaterial({ map: barTex }));
      for (const s of [-1, 1]) m.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.5).translate(s * 1.0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#d8d8d8' })));
      m.visible = false;
      scene.add(m);
      this.barPool.push(m);
    }
    this.heliM = makeHeli();
    scene.add(this.heliM.g, this.heliM.beam, this.heliM.spot);
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
    for (const b of this.blocks) this.removeBlock(b);
    this.blocks = [];
    this.heli.on = false;
    this.heliVol = 0;
  }

  private removeBlock(b: Roadblock) {
    for (const c of b.cops) c.pv.model.root.visible = false;
    for (const r of b.bars) r.m.visible = false;
  }

  /** 4 星以上：在玩家前方約 200 m 的路上設路障（兩台橫停的警車＋中間一排拒馬） */
  private placeBlock(p: FreeCar) {
    const fx = Math.sin(p.h), fz = Math.cos(p.h);
    const at = this.roadPointNear(p.x + fx * 200, p.z + fz * 200, 0, p.h);
    if (!at) return;
    const [x, z, h] = at;
    const sx = Math.cos(h), sz = -Math.sin(h); // 道路的橫向
    const used = new Set(this.blocks.flatMap((b) => b.cops.map((c) => c.pv)));
    const pvs = this.blockPool.filter((pv) => !used.has(pv)).slice(0, 2);
    if (pvs.length < 2) return;
    const usedBars = new Set(this.blocks.flatMap((b) => b.bars.map((r) => r.m)));
    const bars = this.barPool.filter((m) => !usedBars.has(m)).slice(0, 4);
    const cops: Unit[] = pvs.map((pv, i) => {
      const car = new FreeCar();
      car.spec = COP_SPEC;
      const off = (i ? 1 : -1) * 6.5;
      car.place(x + sx * off, z + sz * off, h + Math.PI / 2 + (i ? 0.2 : -0.2)); // 車身橫在路上
      return { car, pv, path: null, repath: 0, stuck: 0, reverse: 0 };
    });
    const bs: Barrier[] = bars.map((m, i) => {
      const off = (i - 1.5) * 2.4;
      m.visible = true;
      m.rotation.set(0, h + Math.PI / 2, 0);
      return { m, x: x + sx * off, z: z + sz * off, vx: 0, vy: 0, vz: 0, y: -0.25, spin: 0, hit: false };
    });
    this.blocks.push({ cops, bars: bs, x, z, age: 0 });
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
      const want = Math.min(MAX_CHASERS, this.stars);
      this.spawnT -= dt;
      if (this.units.length < want && this.spawnT <= 0) {
        this.spawnT = 4; // 增援慢一點
        const a = Math.random() * Math.PI * 2;
        // 在甩開距離（LOSE_DIST）以內出現：一出現就算「被看到」，車頭大致朝向玩家
        const at = this.roadPointNear(p.x + Math.sin(a) * 95, p.z + Math.cos(a) * 95, 0, a + Math.PI);
        if (at) {
          const pv = this.copPool.find((c) => !this.units.some((u) => u.pv === c))!;
          const car = new FreeCar();
          car.spec = COP_SPEC;
          car.place(at[0], at[1], at[2]);
          this.units.push({ car, pv, path: null, repath: 0, stuck: 0, reverse: 0 });
        }
      }
      const vmax = 22 + this.stars * 2; // 1 星約 86 km/h、5 星約 115 km/h
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
      // ---- 路障（4 星以上）
      this.blockT -= dt;
      if (this.stars >= 4 && this.blockT <= 0 && this.blocks.length < 2 && Math.abs(p.v) > 8) { this.blockT = 25; this.placeBlock(p); }
      for (const b of this.blocks) {
        b.age += dt;
        for (const c of b.cops) {
          c.car.update(dt, 0, false, true, col); // 停著（被撞會被推動）
          bumpCars(p, c.car);
          nearest = Math.min(nearest, Math.hypot(c.car.x - p.x, c.car.z - p.z));
        }
        for (const r of b.bars) {
          if (!r.hit) {
            const d = Math.hypot(r.x - p.x, r.z - p.z);
            if (d < 2.2 && Math.abs(p.v) > 1) {
              // 撞到拒馬：飛出去翻滾，車子被擋一下
              r.hit = true;
              r.vx = p.vx * 0.9 + (r.x - p.x) * 2; r.vz = p.vz * 0.9 + (r.z - p.z) * 2; r.vy = 4 + Math.abs(p.v) * 0.25; r.spin = (Math.random() - 0.5) * 12;
              p.vx *= 0.82; p.vz *= 0.82;
            }
          } else if (r.y > -0.25 || r.vy > 0) {
            r.vy -= 18 * dt;
            r.x += r.vx * dt; r.z += r.vz * dt; r.y = Math.max(-0.25, r.y + r.vy * dt);
            r.m.rotation.x += r.spin * dt;
            if (r.y <= -0.25) { r.vx *= 0.4; r.vz *= 0.4; r.vy = r.vy < -3 ? -r.vy * 0.3 : 0; }
          }
          r.m.position.set(r.x, r.y, r.z);
        }
      }
      this.blocks = this.blocks.filter((b) => { const far = b.age > 70 || Math.hypot(b.x - p.x, b.z - p.z) > 450; if (far) this.removeBlock(b); return !far; });
      // ---- 直升機（5 星）：在玩家上方跟著飛，探照燈照著你；在你頭上 70 m 內就算看到你
      if (this.stars >= 5 && !this.heli.on) { this.heli.on = true; this.heli.x = p.x - Math.sin(p.h) * 260; this.heli.z = p.z - Math.cos(p.h) * 260; }
      if (this.heli.on) {
        const H = this.heli, dx = p.x + p.vx * 1.2 - H.x, dz = p.z + p.vz * 1.2 - H.z, d = Math.hypot(dx, dz);
        const want = Math.min(30, d * 0.8); // 最快約 108 km/h：開更快就甩得掉
        H.vx += ((dx / (d || 1)) * want - H.vx) * Math.min(1, dt * 1.2);
        H.vz += ((dz / (d || 1)) * want - H.vz) * Math.min(1, dt * 1.2);
        H.x += H.vx * dt; H.z += H.vz * dt;
        if (Math.hypot(H.vx, H.vz) > 2) H.h = Math.atan2(H.vx, H.vz);
        const hd = Math.hypot(H.x - p.x, H.z - p.z);
        if (hd < 70) nearest = Math.min(nearest, 0); // 被直升機照到＝被看到
        this.heliVol = Math.max(0, 1 - hd / 400);
      }
      // 太遠的警車收掉（之後會在附近重新出現）
      this.units = this.units.filter((u) => { const far = Math.hypot(u.car.x - p.x, u.car.z - p.z) > 450; if (far) u.pv.model.root.visible = false; return !far; });
      // 甩掉：離所有警車夠遠、撐一段時間
      if ((this.units.length || this.blocks.length || this.heli.on) && nearest > LOSE_DIST) this.lostT += dt; else this.lostT = 0; // 警車還沒出現時不算甩開
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
    for (const b of this.blocks) for (const c of b.cops) draw(c);
    if (this.suspect) draw(this.suspect);
    // 直升機
    const H = this.heli, M = this.heliM;
    M.g.visible = M.beam.visible = M.spot.visible = H.on;
    if (H.on) {
      const alt = 55;
      M.g.position.set(H.x, alt, H.z);
      M.g.rotation.set(Math.min(0.25, Math.hypot(H.vx, H.vz) * 0.01), H.h, 0, 'YXZ');
      M.rotor.rotation.y += dt * 28;
      M.tail.rotation.x += dt * 40;
      // 探照燈：從機腹垂直往下打（直升機緊跟著玩家，光圈就落在玩家附近）
      M.spot.position.set(H.x, -0.2, H.z);
      M.beam.position.set(H.x, alt - 1.5, H.z);
      M.beam.scale.set(1, alt - 1.5, 1);
    }
  }

  /** 小地圖用：警車（紅藍）與嫌犯（橘） */
  get mapDots(): { x: number; z: number; color: string }[] {
    return [...this.units.map((u) => ({ x: u.car.x, z: u.car.z, color: '#3a6cff' })), ...this.blocks.map((b) => ({ x: b.x, z: b.z, color: '#ff3b30' })), ...(this.heli.on ? [{ x: this.heli.x, z: this.heli.z, color: '#ffffff' }] : []), ...(this.suspect ? [{ x: this.suspect.car.x, z: this.suspect.car.z, color: '#ff8a1a' }] : [])];
  }

  hide() { this.clear(); this.endPursuit(); }
}
