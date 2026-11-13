import * as THREE from 'three';
import type { Landmark } from './decor';
import type { Router } from './router';
import { pedParts } from './models';
import { ROAD_Y } from './surface';
import { routeRemaining, sameRoadLevel } from './mission';
import { randomUuid } from './identity';
import { parseTaxiCheckpoint, parseTaxiSettledIds, type TaxiCheckpoint, type TaxiOrder, type TaxiPosition, type TaxiSettlement } from './street-taxi-state';
export { parseTaxiCheckpoint, parseTaxiSettledIds } from './street-taxi-state';
export type { TaxiCheckpoint, TaxiOrder, TaxiPosition, TaxiSettlement } from './street-taxi-state';

// 計程車任務：去地標前載乘客 → 限時送到另一個地標 → 照台北跳表收車資（提早到有小費、撞車扣小費）

type Phase = 'off' | 'seek' | 'ride';
interface Stop { x: number; z: number; y: number; nm: string }
export interface TaxiSummary {
  id?: string; relaxed?: boolean;
  from: string; to: string; distance: number; driven: number; remaining: number;
  timeLimit: number; timeLeft: number; junctions: number; driveSeconds: number; waitSeconds: number;
  fare: number; tipBeforeDeduction: number; collisionDeduction: number; hits: number; bonus: number; total: number;
  status: 'riding' | 'delivered' | 'timeout';
}
/** 路口是 Router 原始路網的交會節點；提供平均停等緩衝，不聲稱預測實際燈號。 */
export function taxiTimeBudget(length: number, junctions: number, condition = 1) {
  const driveSeconds = Math.ceil(length / (11 * Math.max(0.7, Math.min(1, condition))));
  const waitSeconds = Math.max(0, junctions) * 4;
  return { driveSeconds, waitSeconds, total: driveSeconds + waitSeconds + 15 };
}

// 不適合當上下車點的名字
const SKIP = /捷運站|出口|倉庫|教室|育嬰室|廳舍|鍋爐|修理廠|Top Floor|觀景/;

/** 台北計程車跳表：起跳 85 元（1.25 km），之後每 200 m 5 元 */
export function fareOf(meters: number) {
  return 85 + Math.max(0, Math.ceil((meters - 1250) / 200)) * 5;
}

export class TaxiJob {
  relaxed = false;
  private jobId = '';
  private destination: Stop | null = null;
  private offers = new Map<string, TaxiOrder>();
  private settled: string[] = [];
  private settlement: TaxiSettlement | null = null;
  phase: Phase = 'off';
  money = 0; // 累積收入（存檔）
  trips = 0;
  streak = 0; // 連續準時
  target: Stop | null = null;
  from = '';
  route: [number, number][] | null = null;
  routeYs: number[] | null = null; // 路線每一點的路面高度（路上的導航箭頭跟著上高架）
  routeLen = 0;
  timeLeft = 0;
  timeLimit = 0;
  odo = 0; // 載客後實際開了多遠
  hits = 0;
  remaining = 0;
  lastTrip: TaxiSummary | null = null;
  private junctions = 0;
  private budget = taxiTimeBudget(0, 0);
  private condition = 1;
  private remainingT = 0;
  private places: Stop[] = [];
  private beam: THREE.Mesh;
  private person: THREE.Group;
  private arm: THREE.Mesh;
  private wait = 0; // 停在目的地多久（要停穩 0.6 秒）
  private lastX = 0;
  private lastZ = 0;
  private rand = Math.random;

  constructor(scene: THREE.Scene, landmarks: Landmark[], private router: Router) {
    const seen = new Set<string>();
    for (const l of landmarks) {
      if (SKIP.test(l.nm) || seen.has(l.nm)) continue;
      seen.add(l.nm);
      // 上下車點：地標前最近的大馬路
      const n = router.route(l.x, l.z, l.x, l.z);
      if (!n) continue;
      this.places.push({ nm: l.nm, x: n.path[0][0], z: n.path[0][1], y: n.ys[0] + ROAD_Y });
    }
    // 招手的乘客（綠光柱＋一個人）、目的地（黃光柱）
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 50, 20, 1, true).translate(0, 25, 0),
      new THREE.MeshBasicMaterial({ color: '#3fff8a', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    this.beam.visible = false;
    scene.add(this.beam);
    this.person = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: '#e3b994' }), shirt = new THREE.MeshLambertMaterial({ color: '#3f8fd8' }), pants = new THREE.MeshLambertMaterial({ color: '#2a2f3a' });
    this.person.add(new THREE.Mesh(pedParts.torso(), shirt), new THREE.Mesh(pedParts.pelvis(), pants), new THREE.Mesh(pedParts.head(), skin), new THREE.Mesh(pedParts.neck(), skin));
    for (const s of [-0.09, 0.09]) { const leg = new THREE.Mesh(pedParts.leg(), pants); leg.position.set(s, 0.9, 0); this.person.add(leg); }
    const armL = new THREE.Mesh(pedParts.arm(), shirt);
    armL.position.set(-0.23, 1.44, 0);
    this.person.add(armL);
    this.arm = new THREE.Mesh(pedParts.arm(), shirt); // 招手的那隻手
    this.arm.position.set(0.23, 1.44, 0);
    this.person.add(this.arm);
    this.person.visible = false;
    scene.add(this.person);
  }

  setCondition(speedMul: number) { this.condition = Number.isFinite(speedMul) ? Math.max(0.7, Math.min(1, speedMul)) : 1; }

  get tripSummary(): TaxiSummary | null {
    if (this.phase !== 'ride' || !this.target) return null;
    const fare = fareOf(Math.max(this.odo, this.routeLen)), tipBeforeDeduction = this.relaxed ? 0 : Math.max(0, Math.round(this.timeLeft * 2));
    const collisionDeduction = Math.min(tipBeforeDeduction, this.hits * 10), bonus = !this.relaxed && this.streak + 1 >= 3 ? 50 : 0;
    return { id: this.jobId, relaxed: this.relaxed, from: this.from, to: this.target.nm, distance: this.routeLen, driven: this.odo, remaining: this.remaining,
      timeLimit: this.timeLimit, timeLeft: Math.max(0, this.timeLeft), junctions: this.junctions,
      driveSeconds: this.budget.driveSeconds, waitSeconds: this.budget.waitSeconds,
      fare, tipBeforeDeduction, collisionDeduction, hits: this.hits, bonus,
      total: fare + tipBeforeDeduction - collisionDeduction + bonus, status: 'riding' };
  }

  start(px: number, pz: number, py?: number) {
    if (!this.places.length) { this.stop(); return; }
    this.phase = 'seek';
    this.streak = 0;
    this.relaxed = false;
    this.pickNext(px, pz, py);
  }

  stop() {
    this.phase = 'off';
    this.target = null;
    this.route = null;
    this.routeYs = null;
    this.remaining = 0;
    this.jobId = ''; this.destination = null; this.offers.clear();
    this.beam.visible = this.person.visible = false;
  }

  /** 玩家明確切換玩法即取消；不能將舊checkpoint留到下次誤續接。main需同時清save.taxiJob。 */
  abandon() { this.stop(); }
  get settledIds() { return [...this.settled]; }
  setSettledIds(raw: unknown) { this.settled = parseTaxiSettledIds(raw); }
  /** money/trips已由update更新；此事件只用來與錢包一起保存ID，不能再加一次錢。 */
  consumeSettlement() { const result = this.settlement; this.settlement = null; return result; }
  checkpoint(car: TaxiPosition): TaxiCheckpoint | null {
    if (this.phase === 'off' || !this.target || !this.jobId || this.settled.includes(this.jobId)) return null;
    return parseTaxiCheckpoint({ v: 1, id: this.jobId, phase: this.phase, from: this.from, target: this.target,
      destination: this.destination, relaxed: this.relaxed, position: car, timeLeft: Math.max(0, this.timeLeft), timeLimit: this.timeLimit,
      odo: this.odo, hits: this.hits, streak: this.streak, routeLen: this.routeLen, junctions: this.junctions, condition: this.condition });
  }
  /** 使用目前路網重算，不讀入存檔金錢、不用離線牆鐘扣時。car應先還原checkpoint.position。 */
  resume(raw: unknown, car: TaxiPosition, settledIds: unknown = this.settled): { ok: true } | { ok: false; error: string } {
    const cp = parseTaxiCheckpoint(raw), settled = parseTaxiSettledIds(settledIds);
    if (!cp) return { ok: false, error: '載客續接資料不完整，請放棄舊行程後重新接單。' };
    if (settled.includes(cp.id)) return { ok: false, error: '這張訂單已結算，不能重複領取。' };
    if (!Number.isFinite(car.x) || !Number.isFinite(car.z) || Math.hypot(car.x - cp.position.x, car.z - cp.position.z) > 100)
      return { ok: false, error: '車輛位置與行程存檔不同，無法安全續接。' };
    const find = (s: Stop) => this.places.find((p) => p.nm === s.nm && Math.hypot(p.x - s.x, p.z - s.z) < 30 && Math.abs(p.y - s.y) <= 2);
    const target = find(cp.target), destination = cp.destination ? find(cp.destination) : null;
    if (!target || cp.destination && !destination) return { ok: false, error: '原上下車點已變更，請重新接單。' };
    const route = this.router.route(car.x, car.z, target.x, target.z, car.y, target.y - ROAD_Y);
    if (!route || !Number.isFinite(route.length)) return { ok: false, error: '原行程目前沒有可行路線。' };
    if (cp.phase === 'seek' && destination && !this.router.route(target.x, target.z, destination.x, destination.z, target.y - ROAD_Y, destination.y - ROAD_Y))
      return { ok: false, error: '原目的地目前無法抵達，請重新接單。' };
    this.settled = settled; this.phase = cp.phase; this.jobId = cp.id; this.from = cp.from;
    this.target = { ...target }; this.destination = destination ? { ...destination } : null; this.relaxed = cp.relaxed;
    this.timeLeft = cp.timeLeft; this.timeLimit = cp.timeLimit; this.odo = cp.odo; this.hits = cp.hits; this.streak = cp.streak;
    this.condition = cp.condition; this.junctions = cp.junctions; this.routeLen = cp.routeLen;
    this.budget = taxiTimeBudget(cp.routeLen, cp.junctions, cp.condition);
    this.route = route.path; this.routeYs = route.ys; this.remaining = route.length;
    this.lastX = car.x; this.lastZ = car.z; this.wait = 0; this.remainingT = 0; this.offers.clear(); this.settlement = null;
    return { ok: true };
  }

  /** 最多三張可預知目的地的訂單；距離/報酬來自真Router，預估含準時小費上限且非保證收入。 */
  previewOrders(px: number, pz: number, py?: number, count = 3): TaxiOrder[] {
    this.offers.clear();
    if (this.phase === 'ride') return [];
    const wanted = Math.max(1, Math.min(3, Math.floor(count) || 3));
    const pickups = [...this.places].sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz)).slice(0, 8);
    for (const pickup of pickups) {
      if (this.offers.size >= wanted) break;
      const toPickup = this.router.route(px, pz, pickup.x, pickup.z, py, pickup.y - ROAD_Y);
      if (!toPickup) continue;
      const destinations = this.places.filter((p) => p.nm !== pickup.nm && Math.hypot(p.x - pickup.x, p.z - pickup.z) > 100)
        .sort((a, b) => Math.hypot(a.x - pickup.x, a.z - pickup.z) - Math.hypot(b.x - pickup.x, b.z - pickup.z));
      // 每張採短／中／長不同距離；最多試八個合法候選，避免選單一次跑過多路由。
      const offset = this.offers.size % 3, step = Math.max(1, Math.floor(destinations.length / 3));
      const candidates = [...destinations.slice(offset * step), ...destinations.slice(0, offset * step)].slice(0, 8);
      for (const destination of candidates) {
        const route = this.router.route(pickup.x, pickup.z, destination.x, destination.z, pickup.y - ROAD_Y, destination.y - ROAD_Y);
        if (!route || !Number.isFinite(route.length) || route.length <= 0) continue;
        const timeLimit = taxiTimeBudget(route.length, route.junctions, this.condition).total, estimatedFare = fareOf(route.length);
        const order: TaxiOrder = { id: randomUuid(), from: pickup.nm, to: destination.nm, pickup: { ...pickup }, destination: { ...destination },
          pickupDistance: toPickup.length, distance: route.length, timeLimit, estimatedFare, estimatedTotal: estimatedFare + timeLimit * 2, junctions: route.junctions };
        this.offers.set(order.id, order); break;
      }
    }
    return [...this.offers.values()].map((o) => ({ ...o, pickup: { ...o.pickup }, destination: { ...o.destination } }));
  }
  acceptOrder(id: string, px: number, pz: number, py?: number, relaxed = false): boolean {
    const order = this.offers.get(id);
    if (!order || this.phase === 'ride') return false;
    const route = this.router.route(px, pz, order.pickup.x, order.pickup.z, py, order.pickup.y - ROAD_Y);
    const ride = this.router.route(order.pickup.x, order.pickup.z, order.destination.x, order.destination.z, order.pickup.y - ROAD_Y, order.destination.y - ROAD_Y);
    if (!route || !ride) return false;
    this.phase = 'seek'; this.target = { ...order.pickup }; this.from = order.from; this.destination = { ...order.destination };
    this.relaxed = relaxed; this.jobId = order.id; this.timeLeft = this.timeLimit = 0; this.odo = this.hits = 0;
    this.route = route.path; this.routeYs = route.ys; this.routeLen = this.remaining = route.length;
    this.wait = this.remainingT = 0; this.offers.clear(); return true;
  }

  /** 找下一位乘客：離玩家 250~800 m 的地標 */
  private pickNext(px: number, pz: number, py?: number) {
    this.jobId = randomUuid(); this.destination = null; this.timeLeft = this.timeLimit = 0; this.odo = this.hits = 0;
    const cand = this.places.filter((p) => { const d = Math.hypot(p.x - px, p.z - pz); return d > 250 && d < 800; });
    const p = (cand.length ? cand : this.places)[Math.floor(this.rand() * (cand.length || this.places.length))];
    this.target = p;
    this.from = p.nm;
    const r = this.router.route(px, pz, p.x, p.z, py, p.y - ROAD_Y);
    this.route = r?.path ?? null;
    this.routeYs = r?.ys ?? null;
    this.routeLen = r?.length ?? 0;
    this.remaining = r?.length ?? Math.hypot(p.x - px, p.z - pz);
    this.wait = 0;
  }

  /** 乘客上車：目的地是 600~1600 m 外的另一個地標；時限照路線長度給 */
  private board(px: number, pz: number, py?: number) {
    const cand = this.places.filter((p) => { const d = Math.hypot(p.x - px, p.z - pz); return d > 600 && d < 1600 && p.nm !== this.from; });
    const fallback = this.places.filter((p) => p.nm !== this.from && Math.hypot(p.x - px, p.z - pz) > 12);
    const pool = cand.length ? cand : fallback;
    const p = this.destination ?? pool[Math.floor(this.rand() * pool.length)];
    if (!p) { this.stop(); return false; }
    this.target = p;
    const r = this.router.route(px, pz, p.x, p.z, py, p.y - ROAD_Y);
    if (this.destination && !r) { this.stop(); return false; }
    this.route = r?.path ?? null;
    this.routeYs = r?.ys ?? null;
    this.routeLen = r?.length ?? Math.hypot(p.x - px, p.z - pz) * 1.3;
    this.junctions = r?.junctions ?? 0;
    this.budget = taxiTimeBudget(this.routeLen, this.junctions, this.condition);
    this.timeLimit = this.timeLeft = this.relaxed ? 0 : this.budget.total;
    this.remaining = this.routeLen;
    this.odo = 0;
    this.hits = 0;
    this.lastX = px;
    this.lastZ = pz;
    this.phase = 'ride';
    this.wait = 0;
    return true;
  }

  /** 撞到東西：載客中扣小費 */
  onHit(impact: number) { if (this.phase === 'ride' && impact > 4) this.hits++; }

  /** 每一步；回傳要顯示的訊息（null = 沒事） */
  update(dt: number, car: { x: number; z: number; y?: number; v: number }): string | null {
    if (this.phase === 'off' || !this.target) return null;
    const d = Math.hypot(car.x - this.target.x, car.z - this.target.z);
    this.remainingT += dt;
    if (this.remainingT >= 0.25) {
      this.remainingT = 0;
      this.remaining = this.route ? routeRemaining(this.route, car.x, car.z, this.routeYs, car.y) : d;
    }
    if (this.phase === 'ride') {
      this.odo += Math.hypot(car.x - this.lastX, car.z - this.lastZ);
      this.lastX = car.x;
      this.lastZ = car.z;
      if (!this.relaxed) this.timeLeft -= dt;
      if (!this.relaxed && this.timeLeft <= 0) {
        const summary = this.tripSummary!;
        this.lastTrip = { ...summary, status: 'timeout', total: 0, bonus: 0 };
        this.settle('timeout', 0);
        this.streak = 0;
        const msg = `😠 太慢了，乘客在路邊下車…`;
        if (this.destination) this.stop();
        else { this.phase = 'seek'; this.pickNext(car.x, car.z, car.y); }
        return msg;
      }
    }
    // 到點：停穩 0.6 秒
    if (d < 12 && sameRoadLevel(car, this.target) && Math.abs(car.v) < 2.5) this.wait += dt; else this.wait = 0;
    if (this.wait < 0.6) return null;
    if (this.phase === 'seek') {
      const from = this.target.nm;
      if (this.board(car.x, car.z, car.y) === false) return '⚠️ 這張訂單目前沒有可行目的地，請重新接單';
      return `🚕 乘客上車：${from} → ${this.target!.nm}（${this.relaxed ? '休閒不限時，無限時小費及連單獎勵' : `限時 ${Math.round(this.timeLimit)} 秒`}）`;
    }
    // 送達：跳表＋小費（提早每秒 2 元，撞一次扣 10 元，最低 0）
    const meter = fareOf(Math.max(this.odo, this.routeLen));
    const tip = this.relaxed ? 0 : Math.max(0, Math.round(this.timeLeft * 2) - this.hits * 10);
    this.streak = this.relaxed ? 0 : this.streak + 1;
    const bonus = !this.relaxed && this.streak >= 3 ? 50 : 0;
    const total = meter + tip + bonus;
    this.lastTrip = { ...this.tripSummary!, bonus, total, remaining: 0, status: 'delivered' };
    if (this.settle('delivered', total)) { this.money += total; this.trips++; }
    const msg = `💰 送達 ${this.target.nm}！車資 ${meter} ＋ 小費 ${tip}${bonus ? ` ＋ 連續準時 ${bonus}` : ''} ＝ NT$ ${total}`;
    if (this.destination) this.stop();
    else { this.phase = 'seek'; this.pickNext(car.x, car.z, car.y); }
    return msg;
  }

  private settle(status: TaxiSettlement['status'], total: number) {
    if (!this.jobId || this.settled.includes(this.jobId)) return false;
    this.settled = [...this.settled, this.jobId].slice(-64);
    this.settlement = { id: this.jobId, status, total }; return true;
  }
  /** 扶正/傳送後同步里程基準，避免把救援位移當作實際行駛。 */
  rebasePosition(car: TaxiPosition) { this.lastX = car.x; this.lastZ = car.z; this.wait = 0; }

  render(t: number) {
    const on = this.phase !== 'off' && !!this.target;
    this.beam.visible = on;
    this.person.visible = on && this.phase === 'seek';
    if (!on) return;
    const { x, z, y } = this.target!;
    this.beam.position.set(x, y, z);
    (this.beam.material as THREE.MeshBasicMaterial).color.set(this.phase === 'seek' ? '#3fff8a' : '#ffd400');
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * 3);
    this.person.position.set(x + 3, y, z);
    this.arm.rotation.z = Math.PI * 0.85 + Math.sin(t * 8) * 0.35; // 舉手招車
  }

  /** 小地圖：路線與目標 */
  get mapInfo() {
    return { route: this.route, next: this.target ? ([this.target.x, this.target.z] as [number, number]) : null };
  }

  /** 重算路線（偏離太多時） */
  reroute(px: number, pz: number, py?: number) {
    if (!this.target) return;
    const r = this.router.route(px, pz, this.target.x, this.target.z, py, this.target.y - ROAD_Y);
    if (r) { this.route = r.path; this.routeYs = r.ys; this.remaining = r.length; if (this.phase === 'seek') this.routeLen = r.length; }
  }
}
