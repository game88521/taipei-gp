import * as THREE from 'three';
import type { CityData } from './citydata';
import type { Landmark } from './decor';
import { makeSedan, type CarModel } from './carModel';
import type { Traffic } from './traffic';
import { FreeCar } from './freecar';
import { TOWER_101 } from './track';

// 開放街道上的比賽：照真實道路規劃路線，沿路要依序穿過檢查點，路上照樣有車流和紅綠燈
// - 自由駕駛的「挑戰」：開到光柱停下來接受，跟 1 位對手單挑
// - 選單的「街頭對決」：選路線，跟 4 位對手一起跑，有名次

interface ChallengeDef { id: string; title: string; rival: string; color: string; stops: (string | { x: number; z: number })[] }
const DEFS: ChallengeDef[] = [
  { id: 'cityhall-101', title: '市府衝 101', rival: '阿翔', color: '#e8e8e8', stops: ['臺北市政府', TOWER_101] },
  { id: 'sysmh-ticc', title: '國父紀念館 → 國際會議中心', rival: '小美', color: '#ff6fa8', stops: ['國父紀念館', '臺北國際會議中心'] },
  { id: 'xinyi-malls', title: '信義百貨巡禮', rival: '黑豹', color: '#1c1c1e', stops: ['統一國際大樓', '新光三越A8館', 'ATT 4 FUN', TOWER_101] },
  { id: 'xinyi-loop', title: '信義大環線', rival: '老K', color: '#ff8a1a', stops: [TOWER_101, '國父紀念館', '臺北市政府', TOWER_101] },
  { id: 'ticc-a8', title: '世貿 → 國父紀念館 → 新光三越', rival: '阿凱', color: '#3fd0ff', stops: ['臺北國際會議中心', '國父紀念館', '新光三越A8館'] },
];

// 街頭對決的對手：最高速（m/s）與過彎能力（相對值）
const DUEL_FIELD: [string, string, number, number][] = [
  ['阿翔', '#e8e8e8', 27, 1.06],
  ['小美', '#ff6fa8', 25.5, 1.0],
  ['黑豹', '#1c1c1e', 24.5, 0.97],
  ['老K', '#ff8a1a', 23.5, 0.94],
];

export interface Challenge {
  def: ChallengeDef;
  path: [number, number][]; // 平滑後的路線
  cum: number[]; // 累積距離
  vmax: number[]; // 每一點的過彎速度上限（橫向 7 m/s²）
  checkpoints: number[]; // 檢查點在路線上的索引
  start: { x: number; z: number; h: number };
  length: number;
  twoWay: boolean; // 起點是雙向道路（路線在中線上，車都要排在右側車道）
}

export interface Rival {
  name: string;
  color: string;
  top: number;
  corner: number;
  s: number;
  v: number;
  lat: number; // 離路線中心的橫向位置（右正）
  blockedFor: number;
  stunned: number;
  done: number | null;
  pos: { x: number; z: number; h: number; v: number };
  model: CarModel;
}

type Phase = 'idle' | 'offer' | 'count' | 'race' | 'done';
const PROFILE_TOP = 30;

export class StreetRace {
  challenges: Challenge[] = [];
  phase: Phase = 'idle';
  active: Challenge | null = null;
  offered: Challenge | null = null;
  duel = false; // true = 選單的街頭對決（4 位對手、有名次）
  next = 0; // 下一個要過的檢查點
  time = 0;
  countdown = 0;
  playerDone: number | null = null;
  rivals: Rival[] = [];
  private pool: CarModel[] = [];
  private markers: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private finishRing: THREE.Mesh;
  private playerProg = 0;

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
      const route: number[] = [];
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
      const vmax = path.map((_, i) => {
        if (i === 0 || i === path.length - 1) return PROFILE_TOP;
        const a = path[i - 1], b = path[i], c = path[i + 1];
        const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
        const dh = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
        const k = dh / ((cum[i + 1] - cum[i - 1]) / 2 || 1);
        return k < 1e-4 ? PROFILE_TOP : Math.min(PROFILE_TOP, Math.sqrt(7 / k));
      });
      // 往回推煞車點（6 m/s²）
      for (let i = path.length - 2; i >= 0; i--) vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] ** 2 + 2 * 6 * (cum[i + 1] - cum[i])));
      const length = cum[cum.length - 1];
      const checkpoints: number[] = [];
      for (let s = 140; s < length - 60; s += 140) checkpoints.push(cum.findIndex((c) => c >= s));
      checkpoints.push(path.length - 1);
      const h = Math.atan2(path[3][0] - path[0][0], path[3][1] - path[0][1]);
      // 起點附近前 6 段多數是雙向道才算（只看第一段，剛好落在路口時會判斷錯）
      let tw = 0, n = 0;
      for (let k = 0; k + 1 < Math.min(route.length, 7); k++, n++) if (twoWayEdge.has(route[k] + ':' + route[k + 1])) tw++;
      const twoWay = tw * 2 > n;
      this.challenges.push({ def, path, cum, vmax, checkpoints, start: { x: path[0][0], z: path[0][1], h }, length, twoWay });
    }

    // ---- 挑戰點的光柱、檢查點光圈、終點光圈、對手的車
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
    for (let k = 0; k < DUEL_FIELD.length; k++) {
      const m = makeSedan('#e8e8e8');
      m.root.visible = false;
      scene.add(m.root);
      this.pool.push(m);
    }
  }

  // 舊介面（單挑時只有一位對手）
  get rivalDone() { return this.rivals[0]?.done ?? null; }
  get rivalS() { return this.rivals[0]?.s ?? 0; }

  /** 玩家在挑戰點停下來 → 提出挑戰 */
  checkOffer(px: number, pz: number, v: number): Challenge | null {
    if (this.phase !== 'idle' && this.phase !== 'offer') return null;
    const c = this.challenges.find((q) => Math.hypot(q.start.x - px, q.start.z - pz) < 9) ?? null;
    this.offered = c && Math.abs(v) < 4 ? c : null;
    this.phase = this.offered ? 'offer' : 'idle';
    return this.offered;
  }

  /**
   * 開始比賽。單挑：玩家與對手並排；對決：4 位對手排在前面兩排，玩家從最後面起跑。
   * 雙向道的路線在雙黃線上，所以車都排右側兩個車道；單行道就左右各一。
   */
  begin(c: Challenge, place: (x: number, z: number, h: number) => void, duel = false) {
    this.active = c;
    this.duel = duel;
    this.phase = 'count';
    this.countdown = 3.99;
    this.next = 0;
    this.time = 0;
    this.playerDone = null;
    this.playerProg = 0;
    const A = c.twoWay ? 1.8 : -1.8, B = c.twoWay ? 5.1 : 1.8;
    const field: [string, string, number, number][] = duel ? DUEL_FIELD : [[c.def.rival, c.def.color, 25, 1.0]];
    const slots = duel ? [[24, A], [24, B], [15, A], [15, B]] : [[6, B]];
    this.rivals = field.map(([name, color, top, corner], k) => {
      const model = this.pool[k];
      (model.body.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>).material.color.set(color);
      model.root.visible = true;
      const r: Rival = { name, color, top, corner, s: slots[k][0], v: 0, lat: slots[k][1], blockedFor: 0, stunned: 0, done: null, pos: { x: 0, z: 0, h: 0, v: 0 }, model };
      this.placeRival(r);
      return r;
    });
    for (let k = this.rivals.length; k < this.pool.length; k++) this.pool[k].root.visible = false;
    const [x, z, h] = this.at(6);
    place(x - Math.cos(h) * A, z + Math.sin(h) * A, h);
    for (const m of this.markers) m.visible = false;
  }

  cancel() {
    this.phase = 'idle';
    this.active = null;
    this.duel = false;
    this.rivals = [];
    for (const m of this.pool) m.root.visible = false;
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
  private placeRival(r: Rival) {
    const [x, z, h] = this.at(r.s);
    r.pos.x = x - Math.cos(h) * r.lat;
    r.pos.z = z + Math.sin(h) * r.lat;
    r.pos.h = h;
    r.pos.v = r.v;
  }

  /** 每一步；回傳要顯示的事件文字（倒數、檢查點、勝負），沒有就回傳 null */
  update(dt: number, player: { x: number; z: number; h: number; v: number }, traffic: Traffic | null): string | null {
    const c = this.active;
    if (!c) return null;
    if (this.phase === 'count') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = 'race'; return 'GO!'; }
      return Math.ceil(this.countdown) !== before ? String(Math.ceil(this.countdown)) : null;
    }
    if (this.phase !== 'race') return null;
    this.time += dt;
    let msg: string | null = null;

    for (const r of this.rivals) {
      if (r.done != null) continue;
      this.driveRival(r, dt, player, traffic);
      if (r.s >= c.length - 2) {
        r.done = this.time;
        if (this.playerDone == null && this.rivals.filter((q) => q.done != null).length === 1) msg = `${r.name} 先到終點了…`;
      }
    }

    // ---- 玩家過檢查點（名次用的進度不能超過下一個檢查點，抄近路不算領先）
    if (this.playerDone == null) {
      const cp = c.path[c.checkpoints[this.next]];
      if (Math.hypot(player.x - cp[0], player.z - cp[1]) < 11) {
        this.next++;
        if (this.next >= c.checkpoints.length) {
          this.playerDone = this.time;
          const place = this.rivals.filter((q) => q.done != null).length + 1;
          msg = place === 1 ? '🏁 第一名！' : `🏁 第 ${place} 名`;
        } else msg = `檢查點 ${this.next}/${c.checkpoints.length}`;
      }
      this.playerProg = Math.min(this.project(player.x, player.z), c.cum[c.checkpoints[Math.min(this.next, c.checkpoints.length - 1)]]);
    }
    const allRivals = this.rivals.every((r) => r.done != null);
    if (this.playerDone != null && (allRivals || this.time - this.playerDone > 0.6)) this.phase = 'done';
    // 對手全部到了，玩家 30 秒內還沒到就算未完賽
    const lastRival = Math.max(...this.rivals.map((r) => r.done ?? -1));
    if (allRivals && this.playerDone == null && this.time - lastRival > 30) { this.playerDone = Infinity; this.phase = 'done'; }
    return msg;
  }

  /** 對手：沿路線開，前面有車（車流、玩家、其他對手）就換車道或減速，不理紅綠燈 */
  private driveRival(r: Rival, dt: number, player: { x: number; z: number; v: number }, traffic: Traffic | null) {
    const c = this.active!;
    const fi = c.cum.findIndex((q) => q >= r.s + r.v * 1.2);
    let want = Math.min(r.top, c.vmax[fi < 0 ? c.vmax.length - 1 : fi] * r.corner);
    const fx = Math.sin(r.pos.h), fz = Math.cos(r.pos.h);
    const others = traffic?.near(r.pos.x, r.pos.z, 30) ?? [];
    const blocked = (lat: number) => {
      let gap = Infinity, v = 0;
      const check = (x: number, z: number, ov: number) => {
        const dx = x - r.pos.x, dz = z - r.pos.z, ahead = dx * fx + dz * fz;
        const side = -dx * fz + dz * fx; // 右正
        if (ahead > 0 && ahead < 26 && Math.abs(side - (lat - r.lat)) < 1.6 && ahead < gap) { gap = ahead; v = ov; }
      };
      for (const o of others) check(o.x, o.z, o.v);
      check(player.x, player.z, player.v);
      for (const q of this.rivals) if (q !== r && q.done == null) check(q.pos.x, q.pos.z, q.v);
      return { gap, v };
    };
    const cur = blocked(r.lat);
    if (cur.gap < 26 && r.blockedFor < 6) {
      // 換到比較空的車道；被擋超過 2.5 秒就連對向、路肩也看（街頭飆車不守規矩）
      const steps = r.blockedFor > 2.5 ? [-3.3, 3.3, -6.6, 6.6] : [-3.3, 3.3];
      const free = steps.map((d) => r.lat + d).filter((l) => l > -8 && l < 8).find((l) => blocked(l).gap > 30);
      if (free != null) r.lat = free;
      else if (cur.gap < 12) want = Math.min(want, cur.v);
    }
    // 卡住太久（前後左右都是車）就硬擠過去
    r.blockedFor = r.v < 2 ? r.blockedFor + dt : Math.max(0, r.blockedFor - dt * 2);
    if (r.stunned > 0) { r.stunned -= dt; want = 0; }
    // 加速 4.5 m/s²、減速 8 m/s²
    r.v = want > r.v ? Math.min(want, r.v + 4.5 * dt) : Math.max(want, r.v - 8 * dt);
    r.s += r.v * dt;
    this.placeRival(r);
  }

  /** 玩家跟對手的碰撞：推開玩家，對手停一下 */
  collide(p: FreeCar): number {
    if (!this.active || this.phase !== 'race') return 0;
    let hit = 0;
    for (const r of this.rivals) {
      if (r.done != null || Math.abs(p.x - r.pos.x) > 8 || Math.abs(p.z - r.pos.z) > 8) continue;
      const fx = Math.sin(r.pos.h), fz = Math.cos(r.pos.h);
      // 兩台車各用三個圓：玩家照剛體彈開，對手被推往旁邊、掉速
      for (const [px, pz] of p.circles()) for (const o of [1.45, 0, -1.45]) {
        const qx = r.pos.x + fx * o, qz = r.pos.z + fz * o;
        const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz), R = FreeCar.RADIUS * 2;
        if (d >= R || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d;
        const h = p.contact(nx, nz, (R - d) * 0.6, qx + nx * FreeCar.RADIUS, qz + nz * FreeCar.RADIUS, fx * r.v, fz * r.v, 0.4, 0.4);
        hit = Math.max(hit, h);
        // 對手：橫向被推開（換到旁邊的位置）、速度掉一些
        const side = nx * fz - nz * fx; // 推力（−n）在對手右手方向 (−fz, fx) 的分量
        r.lat += side * (R - d) * 0.4 + Math.sign(side) * Math.min(1, h * 0.05);
        r.v *= h > 0 ? 0.75 : 0.98;
        if (h > 4) r.stunned = Math.max(r.stunned, 0.5);
      }
    }
    return hit;
  }

  /** 對手當作車流的障礙物（讓車流會讓它們） */
  obstacle() { return this.active && this.phase === 'race' ? this.rivals.filter((r) => r.done == null).map((r) => r.pos) : []; }

  /** 名次：先比誰到終點、到的比時間；沒到的比跑了多遠 */
  standings() {
    const list = [
      { name: '你', isPlayer: true, done: this.playerDone, prog: this.playerProg, color: '#ff3b30' },
      ...this.rivals.map((r) => ({ name: r.name, isPlayer: false, done: r.done, prog: r.s, color: r.color })),
    ];
    return list.sort((a, b) => {
      const fa = a.done != null && isFinite(a.done), fb = b.done != null && isFinite(b.done);
      if (fa && fb) return a.done! - b.done!;
      if (fa) return -1;
      if (fb) return 1;
      return b.prog - a.prog;
    });
  }

  render(dt: number) {
    const c = this.active;
    const show = !!c && this.phase !== 'idle' && this.phase !== 'offer';
    for (const r of this.rivals) {
      const m = r.model;
      m.root.visible = show && (r.done == null || this.duel);
      m.root.position.set(r.pos.x, -0.25, r.pos.z);
      m.root.rotation.y = r.pos.h;
      for (const w of m.spin) w.rotation.x += (r.v / 0.33) * dt;
    }
    // 檢查點：顯示下一個（亮）和再下一個（淡）；最後一個用白色終點圈
    for (let k = 0; k < 2; k++) {
      const ring = this.rings[k], idx = this.next + k;
      ring.visible = show && this.playerDone == null && idx < c!.checkpoints.length - 1;
      if (ring.visible) this.orient(ring, c!, c!.checkpoints[idx]);
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

  /** 小地圖用：目前路線、下一個檢查點、對手、挑戰點 */
  get mapInfo() {
    const c = this.active;
    const racing = !!c && this.phase !== 'idle' && this.phase !== 'offer';
    return {
      route: racing ? c!.path : null,
      next: racing ? c!.path[c!.checkpoints[Math.min(this.next, c!.checkpoints.length - 1)]] : null,
      rivals: racing ? this.rivals.filter((r) => r.done == null).map((r) => r.pos) : [],
      flags: this.phase === 'idle' || this.phase === 'offer' ? this.challenges.map((q) => q.start) : [],
    };
  }

  /** 玩家在路線上的投影距離 */
  private project(px: number, pz: number) {
    const c = this.active!;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < c.path.length; i += 2) { const d = (c.path[i][0] - px) ** 2 + (c.path[i][1] - pz) ** 2; if (d < bd) { bd = d; bi = i; } }
    return c.cum[bi];
  }

  /** 玩家與最前面那位對手的差距（m，正 = 玩家領先） */
  lead(px: number, pz: number): number {
    if (!this.active || !this.rivals.length) return 0;
    return this.project(px, pz) - Math.max(...this.rivals.map((r) => r.s));
  }
}
