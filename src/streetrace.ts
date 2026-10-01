import * as THREE from 'three';
import type { CityData } from './citydata';
import type { Landmark } from './decor';
import { makeSedan, type CarModel } from './carModel';
import type { Traffic } from './traffic';
import { TOWER_101 } from './track';

// 自由駕駛裡的街頭飆車：開到挑戰點接受挑戰 → 跟對手照真實道路跑到終點，沿路要依序穿過檢查點

interface ChallengeDef { id: string; title: string; rival: string; color: string; stops: (string | { x: number; z: number })[] }
const DEFS: ChallengeDef[] = [
  { id: 'cityhall-101', title: '市府衝 101', rival: '阿翔', color: '#e8e8e8', stops: ['臺北市政府', TOWER_101] },
  { id: 'sysmh-ticc', title: '國父紀念館 → 國際會議中心', rival: '小美', color: '#ff6fa8', stops: ['國父紀念館', '臺北國際會議中心'] },
  { id: 'xinyi-malls', title: '信義百貨巡禮', rival: '黑豹', color: '#1c1c1e', stops: ['統一國際大樓', '新光三越A8館', 'ATT 4 FUN', TOWER_101] },
];

export interface Challenge {
  def: ChallengeDef;
  path: [number, number][]; // 平滑後的路線
  cum: number[]; // 累積距離
  vmax: number[]; // 每一點的對手速度上限
  checkpoints: number[]; // 檢查點在路線上的索引
  start: { x: number; z: number; h: number };
  length: number;
  twoWay: boolean; // 起點是雙向道路（路線在中線上，兩台車都要排在右側車道）
}

type Phase = 'idle' | 'offer' | 'count' | 'race' | 'done';

const RIVAL_TOP = 25; // 對手最高速 m/s ≈ 90 km/h（玩家的車可以到 158 km/h，但要閃車流）

export class StreetRace {
  challenges: Challenge[] = [];
  phase: Phase = 'idle';
  active: Challenge | null = null;
  offered: Challenge | null = null;
  next = 0; // 下一個要過的檢查點
  time = 0;
  countdown = 0;
  rivalS = 0;
  rivalV = 0;
  rivalLat = 1.8;
  rivalDone: number | null = null;
  playerDone: number | null = null;
  rival = { x: 0, z: 0, h: 0, v: 0 };
  private rivalModel: CarModel;
  private markers: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private finishRing: THREE.Mesh;
  private stunned = 0;
  private blockedFor = 0;

  constructor(private scene: THREE.Scene, d: CityData, landmarks: Landmark[]) {
    // ---- 路網（照單行方向）
    const N = d.net.nodes, adj = new Map<number, [number, number][]>();
    const twoWayEdge = new Set<string>();
    for (const w of d.net.ways) if (!w.o) for (let k = 0; k + 1 < w.n.length; k++) twoWayEdge.add(w.n[k] + ':' + w.n[k + 1]).add(w.n[k + 1] + ':' + w.n[k]);
    const nodeOK = new Set<number>();
    for (const w of d.net.ways) {
      if (w.c > 3) continue;
      for (let k = 0; k + 1 < w.n.length; k++) {
        const a = w.n[k], b = w.n[k + 1], l = Math.hypot(N[b * 2] - N[a * 2], N[b * 2 + 1] - N[a * 2 + 1]);
        const add = (u: number, v: number) => { if (!adj.has(u)) adj.set(u, []); adj.get(u)!.push([v, l * (w.c >= 3 ? 1.6 : 1)]); };
        if (w.o !== -1) add(a, b);
        if (w.o !== 1) add(b, a);
        if (w.c <= 2) { nodeOK.add(a); nodeOK.add(b); }
      }
    }
    const nearestNode = (x: number, z: number) => {
      let bi = -1, bd = Infinity;
      for (const ni of nodeOK) { const dd = (N[ni * 2] - x) ** 2 + (N[ni * 2 + 1] - z) ** 2; if (dd < bd) { bd = dd; bi = ni; } }
      return bi;
    };
    const dijkstra = (from: number, to: number): number[] | null => {
      const dist = new Map([[from, 0]]), prev = new Map<number, number>(), done = new Set<number>();
      const open: [number, number][] = [[0, from]];
      while (open.length) {
        let mi = 0;
        for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i;
        const [dd, u] = open.splice(mi, 1)[0];
        if (done.has(u)) continue;
        done.add(u);
        if (u === to) break;
        for (const [v, l] of adj.get(u) || []) {
          const nd = dd + l;
          if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); open.push([nd, v]); }
        }
      }
      if (!dist.has(to)) return null;
      const p = [to];
      while (p[0] !== from) p.unshift(prev.get(p[0])!);
      return p;
    };
    const where = (s: string | { x: number; z: number }) => {
      if (typeof s !== 'string') return s;
      const l = landmarks.find((q) => q.nm === s);
      return l ? { x: l.x, z: l.z } : null;
    };

    for (const def of DEFS) {
      const pts = def.stops.map(where);
      if (pts.some((p) => !p)) continue;
      const nodes = pts.map((p) => nearestNode(p!.x, p!.z));
      let route: number[] = [];
      let ok = true;
      for (let k = 0; k + 1 < nodes.length; k++) {
        const leg = dijkstra(nodes[k], nodes[k + 1]);
        if (!leg) { ok = false; break; }
        route.push(...(k ? leg.slice(1) : leg));
      }
      if (!ok || route.length < 2) continue;
      let path: [number, number][] = route.map((ni) => [N[ni * 2], N[ni * 2 + 1]]);
      // Chaikin 平滑兩次：路口的直角變圓，對手才不會像機器人一樣折彎
      for (let it = 0; it < 2; it++) {
        const out: [number, number][] = [path[0]];
        for (let i = 0; i + 1 < path.length; i++) {
          const [a, b] = [path[i], path[i + 1]];
          out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        out.push(path[path.length - 1]);
        path = out;
      }
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
      // 對手速度：照轉彎半徑（橫向 7 m/s²），再往回推煞車點（6 m/s²）
      const vmax = path.map((_, i) => {
        if (i === 0 || i === path.length - 1) return RIVAL_TOP;
        const a = path[i - 1], b = path[i], c = path[i + 1];
        const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
        let dh = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
        const ds = (cum[i + 1] - cum[i - 1]) / 2 || 1;
        const k = dh / ds;
        return k < 1e-4 ? RIVAL_TOP : Math.min(RIVAL_TOP, Math.sqrt(7 / k));
      });
      for (let i = path.length - 2; i >= 0; i--) vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] ** 2 + 2 * 6 * (cum[i + 1] - cum[i])));
      const length = cum[cum.length - 1];
      const checkpoints: number[] = [];
      for (let s = 140; s < length - 60; s += 140) checkpoints.push(cum.findIndex((c) => c >= s));
      checkpoints.push(path.length - 1);
      const h = Math.atan2(path[3][0] - path[0][0], path[3][1] - path[0][1]);
      const twoWay = twoWayEdge.has(route[0] + ':' + route[1]);
      this.challenges.push({ def, path, cum, vmax, checkpoints, start: { x: path[0][0], z: path[0][1], h }, length, twoWay });
    }

    // ---- 挑戰點的光柱、檢查點光圈、終點光圈
    const beam = new THREE.CylinderGeometry(2.2, 2.2, 60, 20, 1, true).translate(0, 30, 0);
    for (const c of this.challenges) {
      const m = new THREE.Mesh(beam, new THREE.MeshBasicMaterial({ color: '#ff8a1a', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      m.position.set(c.start.x, -0.25, c.start.z);
      scene.add(m);
      this.markers.push(m);
    }
    const ringGeo = new THREE.TorusGeometry(6.5, 0.35, 8, 40);
    for (let k = 0; k < 2; k++) {
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: k ? '#fff2a0' : '#ffd400', transparent: true, opacity: k ? 0.35 : 0.85, toneMapped: false }));
      r.visible = false;
      scene.add(r);
      this.rings.push(r);
    }
    this.finishRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, toneMapped: false }));
    this.finishRing.visible = false;
    scene.add(this.finishRing);
    this.rivalModel = makeSedan('#e8e8e8');
    this.rivalModel.root.visible = false;
    scene.add(this.rivalModel.root);
  }

  /** 玩家在挑戰點停下來 → 提出挑戰 */
  checkOffer(px: number, pz: number, v: number): Challenge | null {
    if (this.phase !== 'idle' && this.phase !== 'offer') return null;
    const c = this.challenges.find((q) => Math.hypot(q.start.x - px, q.start.z - pz) < 9) ?? null;
    this.offered = c && Math.abs(v) < 4 ? c : null;
    this.phase = this.offered ? 'offer' : 'idle';
    return this.offered;
  }

  /** 接受挑戰：玩家和對手並排在起點，倒數 3 秒 */
  begin(c: Challenge, place: (x: number, z: number, h: number) => void) {
    this.active = c;
    this.phase = 'count';
    this.countdown = 3.99;
    this.next = 0;
    this.time = 0;
    this.rivalS = 0;
    this.rivalV = 0;
    // 雙向道：路線在雙黃線上，玩家排右側內車道、對手排外車道；單行道：左右各一
    const pl = c.twoWay ? 1.8 : -1.8;
    this.rivalLat = c.twoWay ? 5.1 : 1.8;
    this.blockedFor = 0;
    this.rivalDone = this.playerDone = null;
    const { x, z, h } = c.start;
    place(x - Math.cos(h) * pl, z + Math.sin(h) * pl, h);
    (this.rivalModel.body.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>).material.color.set(c.def.color);
    this.rivalModel.root.visible = true;
    this.placeRival();
    for (const m of this.markers) m.visible = false;
  }

  cancel() {
    this.phase = 'idle';
    this.active = null;
    this.rivalModel.root.visible = false;
    for (const r of this.rings) r.visible = false;
    this.finishRing.visible = false;
    for (const m of this.markers) m.visible = true;
  }

  private at(s: number): [number, number, number] {
    const c = this.active!, cum = c.cum;
    let lo = 0, hi = cum.length - 1;
    s = Math.max(0, Math.min(c.length, s));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m; else hi = m; }
    const f = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const [a, b] = [c.path[lo], c.path[hi]];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[0] - a[0], b[1] - a[1])];
  }
  private placeRival() {
    const [x, z, h] = this.at(this.rivalS);
    this.rival.x = x - Math.cos(h) * this.rivalLat;
    this.rival.z = z + Math.sin(h) * this.rivalLat;
    this.rival.h = h;
    this.rival.v = this.rivalV;
  }

  /** 每一步；回傳要顯示的事件文字（倒數、檢查點、勝負），沒有就回傳 null */
  update(dt: number, player: { x: number; z: number; h: number; v: number }, traffic: Traffic | null): string | null {
    const c = this.active;
    if (!c) return null;
    if (this.phase === 'count') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (this.countdown <= 0) { this.phase = 'race'; return 'GO!'; }
      return now !== before ? String(now) : null;
    }
    if (this.phase !== 'race') return null;
    this.time += dt;
    let msg: string | null = null;

    // ---- 對手：沿路線開，前面有車就換車道或減速，不理紅綠燈
    if (this.rivalDone == null) {
      const fi = c.cum.findIndex((q) => q >= this.rivalS + this.rivalV * 1.2);
      let want = c.vmax[fi < 0 ? c.vmax.length - 1 : fi];
      const fx = Math.sin(this.rival.h), fz = Math.cos(this.rival.h);
      const blocked = (lat: number) => {
        let gap = Infinity, v = 0;
        const check = (x: number, z: number, ov: number) => {
          const dx = x - this.rival.x, dz = z - this.rival.z, ahead = dx * fx + dz * fz;
          const side = -dx * fz + dz * fx; // 右正
          if (ahead > 0 && ahead < 26 && Math.abs(side - (lat - this.rivalLat)) < 1.6 && ahead < gap) { gap = ahead; v = ov; }
        };
        for (const o of traffic?.near(this.rival.x, this.rival.z, 30) ?? []) check(o.x, o.z, o.v);
        check(player.x, player.z, player.v);
        return { gap, v };
      };
      const cur = blocked(this.rivalLat);
      if (cur.gap < 26 && this.blockedFor < 6) {
        // 換到比較空的車道；被擋超過 2.5 秒就連對向、路肩也看（街頭飆車不守規矩）
        const steps = this.blockedFor > 2.5 ? [-3.3, 3.3, -6.6, 6.6] : [-3.3, 3.3];
        const options = steps.map((d) => this.rivalLat + d).filter((l) => l > -8 && l < 8);
        const free = options.find((l) => blocked(l).gap > 30);
        if (free != null) this.rivalLat = free;
        else if (cur.gap < 12) want = Math.min(want, cur.v);
      }
      // 卡住太久（前後左右都是車）就硬擠過去
      this.blockedFor = this.rivalV < 2 ? this.blockedFor + dt : Math.max(0, this.blockedFor - dt * 2);
      if (this.stunned > 0) { this.stunned -= dt; want = 0; }
      // 加速 4.5 m/s²、減速 8 m/s²
      this.rivalV = want > this.rivalV ? Math.min(want, this.rivalV + 4.5 * dt) : Math.max(want, this.rivalV - 8 * dt);
      this.rivalS += this.rivalV * dt;
      this.placeRival();
      if (this.rivalS >= c.length - 2) { this.rivalDone = this.time; if (this.playerDone == null) msg = `${c.def.rival} 先到終點了…`; }
    }

    // ---- 玩家過檢查點
    if (this.playerDone == null) {
      const cp = c.path[c.checkpoints[this.next]];
      if (Math.hypot(player.x - cp[0], player.z - cp[1]) < 11) {
        this.next++;
        if (this.next >= c.checkpoints.length) {
          this.playerDone = this.time;
          msg = this.rivalDone == null ? '🏁 你贏了！' : '🏁 抵達終點';
        } else msg = `檢查點 ${this.next}/${c.checkpoints.length}`;
      }
    }
    if (this.playerDone != null && (this.rivalDone != null || this.time - this.playerDone > 0.5)) this.phase = 'done';
    if (this.rivalDone != null && this.playerDone == null && this.time - this.rivalDone > 30) { this.playerDone = Infinity; this.phase = 'done'; }
    return msg;
  }

  /** 玩家跟對手的碰撞：推開玩家，對手停一下 */
  collide(p: { x: number; z: number; h: number; v: number }): number {
    if (!this.active || this.phase !== 'race') return 0;
    const dx = p.x - this.rival.x, dz = p.z - this.rival.z, d = Math.hypot(dx, dz);
    if (d > 2.6 || d < 1e-3) return 0;
    p.x += (dx / d) * (2.6 - d);
    p.z += (dz / d) * (2.6 - d);
    const hit = Math.abs(p.v - this.rivalV);
    p.v *= 0.7;
    this.rivalV *= 0.6;
    this.stunned = 0.6;
    return hit;
  }

  /** 對手當作車流的障礙物（讓車流會讓它） */
  obstacle() { return this.active && this.phase === 'race' ? [this.rival] : []; }

  render(dt: number) {
    const c = this.active;
    const show = !!c && this.phase !== 'idle' && this.phase !== 'offer';
    this.rivalModel.root.visible = show && this.rivalDone == null;
    if (show) {
      const m = this.rivalModel;
      m.root.position.set(this.rival.x, -0.25, this.rival.z);
      m.root.rotation.y = this.rival.h;
      for (const w of m.spin) w.rotation.x += (this.rivalV / 0.33) * dt;
    }
    // 檢查點：顯示下一個（亮）和再下一個（淡）；最後一個用白色終點圈
    for (let k = 0; k < 2; k++) {
      const r = this.rings[k], idx = this.next + k;
      r.visible = show && this.playerDone == null && idx < c!.checkpoints.length - 1;
      if (r.visible) this.orient(r, c!, c!.checkpoints[idx]);
    }
    this.finishRing.visible = show && this.playerDone == null && this.next >= c!.checkpoints.length - 2;
    if (this.finishRing.visible) this.orient(this.finishRing, c!, c!.path.length - 1);
    const t = performance.now() / 1000;
    for (const m of this.markers) (m.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.12 * Math.sin(t * 3);
  }
  private orient(r: THREE.Mesh, c: Challenge, i: number) {
    const a = c.path[Math.max(0, i - 1)], b = c.path[Math.min(c.path.length - 1, i + 1)];
    r.position.set(c.path[i][0], 5.5, c.path[i][1]);
    r.rotation.set(0, Math.atan2(b[0] - a[0], b[1] - a[1]), 0);
  }

  /** 小地圖用：目前路線、下一個檢查點、挑戰點 */
  get mapInfo() {
    const c = this.active;
    return {
      route: c && this.phase !== 'idle' && this.phase !== 'offer' ? c.path : null,
      next: c ? c.path[c.checkpoints[Math.min(this.next, c.checkpoints.length - 1)]] : null,
      rival: c && this.phase === 'race' ? this.rival : null,
      flags: this.phase === 'idle' || this.phase === 'offer' ? this.challenges.map((q) => q.start) : [],
    };
  }

  /** 玩家與對手的差距（m，正 = 玩家領先），用路線上的投影估算 */
  lead(px: number, pz: number): number {
    const c = this.active;
    if (!c) return 0;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < c.path.length; i += 2) { const d = (c.path[i][0] - px) ** 2 + (c.path[i][1] - pz) ** 2; if (d < bd) { bd = d; bi = i; } }
    return c.cum[bi] - this.rivalS;
  }
}
