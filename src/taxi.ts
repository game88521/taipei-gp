import * as THREE from 'three';
import type { Landmark } from './decor';
import type { Router } from './router';
import { pedParts } from './models';

// 計程車任務：去地標前載乘客 → 限時送到另一個地標 → 照台北跳表收車資（提早到有小費、撞車扣小費）

type Phase = 'off' | 'seek' | 'ride';

// 不適合當上下車點的名字
const SKIP = /捷運站|出口|倉庫|教室|育嬰室|廳舍|鍋爐|修理廠|Top Floor|觀景/;

/** 台北計程車跳表：起跳 85 元（1.25 km），之後每 200 m 5 元 */
export function fareOf(meters: number) {
  return 85 + Math.max(0, Math.ceil((meters - 1250) / 200)) * 5;
}

export class TaxiJob {
  phase: Phase = 'off';
  money = 0; // 累積收入（存檔）
  trips = 0;
  streak = 0; // 連續準時
  target: { x: number; z: number; nm: string } | null = null;
  from = '';
  route: [number, number][] | null = null;
  routeLen = 0;
  timeLeft = 0;
  timeLimit = 0;
  odo = 0; // 載客後實際開了多遠
  hits = 0;
  private places: { nm: string; x: number; z: number }[] = [];
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
      this.places.push({ nm: l.nm, x: n.path[0][0], z: n.path[0][1] });
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

  start(px: number, pz: number) {
    this.phase = 'seek';
    this.streak = 0;
    this.pickNext(px, pz);
  }

  stop() {
    this.phase = 'off';
    this.target = null;
    this.route = null;
    this.beam.visible = this.person.visible = false;
  }

  /** 找下一位乘客：離玩家 250~800 m 的地標 */
  private pickNext(px: number, pz: number) {
    const cand = this.places.filter((p) => { const d = Math.hypot(p.x - px, p.z - pz); return d > 250 && d < 800; });
    const p = (cand.length ? cand : this.places)[Math.floor(this.rand() * (cand.length || this.places.length))];
    this.target = p;
    this.from = p.nm;
    const r = this.router.route(px, pz, p.x, p.z);
    this.route = r?.path ?? null;
    this.routeLen = r?.length ?? 0;
    this.wait = 0;
  }

  /** 乘客上車：目的地是 600~1600 m 外的另一個地標；時限照路線長度給 */
  private board(px: number, pz: number) {
    const cand = this.places.filter((p) => { const d = Math.hypot(p.x - px, p.z - pz); return d > 600 && d < 1600 && p.nm !== this.from; });
    const p = (cand.length ? cand : this.places)[Math.floor(this.rand() * (cand.length || this.places.length))];
    this.target = p;
    const r = this.router.route(px, pz, p.x, p.z);
    this.route = r?.path ?? null;
    this.routeLen = r?.length ?? Math.hypot(p.x - px, p.z - pz) * 1.3;
    this.timeLimit = this.timeLeft = Math.round(this.routeLen / 11 + 15);
    this.odo = 0;
    this.hits = 0;
    this.lastX = px;
    this.lastZ = pz;
    this.phase = 'ride';
    this.wait = 0;
  }

  /** 撞到東西：載客中扣小費 */
  onHit(impact: number) { if (this.phase === 'ride' && impact > 4) this.hits++; }

  /** 每一步；回傳要顯示的訊息（null = 沒事） */
  update(dt: number, car: { x: number; z: number; v: number }): string | null {
    if (this.phase === 'off' || !this.target) return null;
    const d = Math.hypot(car.x - this.target.x, car.z - this.target.z);
    if (this.phase === 'ride') {
      this.odo += Math.hypot(car.x - this.lastX, car.z - this.lastZ);
      this.lastX = car.x;
      this.lastZ = car.z;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.streak = 0;
        const msg = `😠 太慢了，乘客在路邊下車…`;
        this.phase = 'seek';
        this.pickNext(car.x, car.z);
        return msg;
      }
    }
    // 到點：停穩 0.6 秒
    if (d < 12 && Math.abs(car.v) < 2.5) this.wait += dt; else this.wait = 0;
    if (this.wait < 0.6) return null;
    if (this.phase === 'seek') {
      const from = this.target.nm;
      this.board(car.x, car.z);
      return `🚕 乘客上車：${from} → ${this.target!.nm}（限時 ${Math.round(this.timeLimit)} 秒）`;
    }
    // 送達：跳表＋小費（提早每秒 2 元，撞一次扣 10 元，最低 0）
    const meter = fareOf(Math.max(this.odo, this.routeLen));
    const tip = Math.max(0, Math.round(this.timeLeft * 2) - this.hits * 10);
    this.streak++;
    const bonus = this.streak >= 3 ? 50 : 0;
    const total = meter + tip + bonus;
    this.money += total;
    this.trips++;
    const msg = `💰 送達 ${this.target.nm}！車資 ${meter} ＋ 小費 ${tip}${bonus ? ` ＋ 連續準時 ${bonus}` : ''} ＝ NT$ ${total}`;
    this.phase = 'seek';
    this.pickNext(car.x, car.z);
    return msg;
  }

  render(t: number) {
    const on = this.phase !== 'off' && !!this.target;
    this.beam.visible = on;
    this.person.visible = on && this.phase === 'seek';
    if (!on) return;
    const { x, z } = this.target!;
    this.beam.position.set(x, -0.25, z);
    (this.beam.material as THREE.MeshBasicMaterial).color.set(this.phase === 'seek' ? '#3fff8a' : '#ffd400');
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * 3);
    this.person.position.set(x + 3, -0.25, z);
    this.arm.rotation.z = Math.PI * 0.85 + Math.sin(t * 8) * 0.35; // 舉手招車
  }

  /** 小地圖：路線與目標 */
  get mapInfo() {
    return { route: this.route, next: this.target ? ([this.target.x, this.target.z] as [number, number]) : null };
  }

  /** 重算路線（偏離太多時） */
  reroute(px: number, pz: number) {
    if (!this.target) return;
    const r = this.router.route(px, pz, this.target.x, this.target.z);
    if (r) { this.route = r.path; if (this.phase === 'seek') this.routeLen = r.length; }
  }
}
