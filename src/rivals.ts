import * as THREE from 'three';
import { Car } from './car';
import type { CarModel } from './carModel';
import { makeF1, TEAMS } from './f1model';
import { CIRCUIT } from './circuits';
import { HALF_WIDTH, VMAX as VMAX0, GRIP0, GRIPK, surfaceY, bankRoll, locate, type Track } from './track';
import { PIT, boxS, laneLat, signedS, type PitLane, type StopInfo } from './pitlane';

// 街道賽的 AI 對手：走「賽車線」（彎道切內側）、照自己的極限速度曲線開、
// 被慢車擋住就挑比較空的一側超車、尾流加速、車與車照動量交換互相撞開

export const LAPS = 3; // 預設圈數（選單可選 3 或 6）

/** 胎種：抓地力倍數、每圈磨耗（磨到 1 抓地力少 18%）、胎色 */
export const TYRES = [
  { name: '軟胎', short: '軟', grip: 1.03, wear: 0.16, color: '#e10600' },
  { name: '中性胎', short: '中', grip: 1.0, wear: 0.1, color: '#ffd400' },
  { name: '硬胎', short: '硬', grip: 0.975, wear: 0.065, color: '#f2f2f2' },
  { name: '雨胎', short: '雨', grip: 0.97, wear: 0.1, color: '#2fbf6c' }, // 濕地才好用；乾地抓地力差、磨很快
];
export const RAIN = 3;
export type GpWeather = 'dry' | 'maybe' | 'wet';
const SC_SPEED = 40, SC_CATCHUP = 55; // 安全車期間：跟在車隊裡的限速、還沒追上車隊的限速（m/s）
const PIT_TEST = new URLSearchParams(location.search).has('pittest');
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/** 進站中的狀態：in 進維修區（減速、轉進停車格）→ box 停在格子裡換胎 → out 出站、匯回賽道 */
export interface PitState {
  ph: 'in' | 'box' | 'out';
  sd: number; // 離起跑線的帶號距離（沿賽道）
  v: number;
  entry: number; exit: number; // 進站前、出站後在賽道上的橫向位置
  t: number; T: number; // 停好之後過了幾秒、這次停站要幾秒
  slow: number; // 出包的輪子（-1 沒有）
  next: number; // 換上的胎
  box: number; // 停車格的位置
  team: number;
}

/** DRS 區：長直線；偵測點在區間起點前 80 m */
interface DrsZone { s0: number; s1: number; det: number }

export interface Racer {
  compound: number; // TYRES 的索引
  wear: number; // 0 新胎 … 1 磨光
  pitReq: boolean; // 下次經過進站口時進站
  pit: PitState | null; // 進站中（null = 在賽道上）
  pitTyre: number; // 玩家指定下一套胎（-1 = 照車隊建議）
  lift: number; // 千斤頂把車抬高多少（m）
  lastStop: number; // 上一次停站幾秒
  pits: number; // 進站次數
  drsOk: boolean; // 這個 DRS 區可以開（偵測點在前車 1 秒內）
  rec: number[]; // 回放紀錄：每 0.05 秒一筆 [x, z, h, steer, v]
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
  crashAt: number; // 最近一次重撞是比賽第幾秒
  slowT: number; // 車速一直很慢（< 8 m/s）多久了
  persona: Persona; // 個性：超車積不積極、會不會卡位、顧不顧輪胎、雨天強不強
  defT: number; // 卡位的冷卻（秒）：一次防守只換一次線
}

/** AI 個性（玩家用「均衡」）。aggr：超車的積極程度；defend：被追時換線卡位；tyre：輪胎磨耗倍率；wet：濕地抓地力損失少幾成 */
export interface Persona { tag: string; icon: string; aggr: number; defend: number; tyre: number; wet: number }
export const PERSONAS: Record<string, Persona> = {
  aggr: { tag: '激進', icon: '🔥', aggr: 0.9, defend: 0.5, tyre: 1.12, wet: 0 },
  defend: { tag: '防守', icon: '🛡️', aggr: 0.35, defend: 0.95, tyre: 1, wet: 0 },
  smooth: { tag: '穩健', icon: '🧊', aggr: 0.25, defend: 0.4, tyre: 0.85, wet: 0 },
  rain: { tag: '雨戰', icon: '🌧️', aggr: 0.5, defend: 0.5, tyre: 1, wet: 0.4 },
  even: { tag: '均衡', icon: '', aggr: 0.43, defend: 0.3, tyre: 1, wet: 0 }, // 跟加個性之前的行為一樣
};
// 每位車手的個性（照名字）；沒列的是均衡
const PERSONA_OF: Record<string, keyof typeof PERSONAS> = {
  林志豪: 'aggr', 王柏翰: 'aggr', 吳俊傑: 'aggr', 謝承翰: 'aggr', 賴俊宏: 'aggr',
  陳冠宇: 'defend', 張家瑋: 'defend', 許書豪: 'defend', 廖哲瑋: 'defend',
  李承恩: 'smooth', 蔡明哲: 'smooth', 郭彥廷: 'smooth', 周家豪: 'smooth',
  劉宇翔: 'rain', 鄭宇辰: 'rain', 洪志明: 'rain',
};
export const personaOf = (name: string): Persona => PERSONAS[PERSONA_OF[name] ?? 'even'];

// 虛構車手：11 隊 22 台（2026 起的規模），玩家在第 0 隊，隊友是李承恩
// [名字, 車隊（TEAMS 索引）]；能力照排列順序由強到弱：過彎抓地力用到幾成、煞車減速度 m/s²、引擎力
const DRIVERS: [string, number][] = [
  ['陳冠宇', 1], ['林志豪', 3], ['王柏翰', 2], ['張家瑋', 1], ['李承恩', 0], ['黃子軒', 2], ['吳俊傑', 3],
  ['劉宇翔', 4], ['蔡明哲', 5], ['楊凱文', 4], ['許書豪', 6], ['鄭宇辰', 5], ['謝承翰', 7], ['郭彥廷', 6],
  ['洪志明', 8], ['曾柏宇', 7], ['邱冠廷', 9], ['廖哲瑋', 8], ['賴俊宏', 10], ['周家豪', 9], ['葉子豪', 10],
];
const skill = (k: number): [number, number, number] => [0.985 - k * 0.002, 36.5 - k * 0.2, 1.025 - k * 0.002];
export type Rules = 'classic' | '2026';
/** AI 難度：整個車陣的過彎抓地力、煞車減速度、引擎力一起乘倍數（每位車手之間的強弱順序不變） */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { name: string; grip: number; brake: number; power: number }> = {
  easy: { name: '簡單', grip: 0.95, brake: 0.88, power: 0.96 },
  normal: { name: '普通', grip: 1, brake: 1, power: 1 },
  hard: { name: '困難', grip: 1.012, brake: 1.06, power: 1.012 },
};

export const PLAYER_LIVERY = TEAMS[0].livery;

export class RaceField {
  racers: Racer[] = [];
  raceTime = 0;
  laps = LAPS;
  ttMode = false; // 計時賽：DRS 不用偵測前車
  look = Number(new URLSearchParams(location.search).get('look') ?? 0.42); // AI 看多遠的路（秒）：各國賽道速度快，看太遠會切彎撞牆（main 設）
  rules: Rules = 'classic'; // 2026：主動空力＋電池＋超車模式（偵測點、區段沿用 DRS 的）
  // 天氣：wet 0 乾 … 1 全濕；rainAt = 比賽第幾秒開始下（Infinity 不下、負的＝雨戰一開始就濕）
  wet = 0;
  rainAt = Infinity;
  // 安全車：out 帶隊中、in 這圈進站、off 沒有；lapAt = 出動（或準備進站）時領先者的圈數；s = 安全車在賽道上的位置
  sc = { phase: 'off' as 'off' | 'out' | 'in', t: 0, lapAt: 0, used: false, s: 0 };
  scChance = 0.5; // 重撞時出動的機率（測試可設 1）
  scAt = -1; // 安全車在比賽第幾秒出動（-1 = 沒出；測試、無線電用）
  /** 給 main 的事件（安全車出動、進站、綠旗、開始下雨），main 每格拿走 */
  events: string[] = [];
  private solo = false; // 排位賽模擬：只算自己，不看別台車
  drsZones: DrsZone[] = [];
  private recAcc = 0;
  private line: Float32Array; // 每個取樣點的賽車線橫向位置（右正）
  private base: [number, number, number][] = []; // 每位 AI 普通難度的 [抓地力, 煞車, 引擎力]

  aiHits = 0; // 測試用：AI 撞牆次數
  /** 賽季的車手狀態（name → -1..+1）；空 = 沒有賽季，所有人倍率 1。改了之後要呼叫 applyDifficulty() 重算 */
  form: Record<string, number> = {};
  /** 維修區（main 建好之後設定）：外觀與維修人員動畫；限速 */
  pitlane: PitLane | null = null;
  private pitSeed = 11;
  private pitRnd() { this.pitSeed = (this.pitSeed * 16807) % 2147483647; return this.pitSeed / 2147483647; }
  private stops = new Map<number, StopInfo>();
  difficulty: Difficulty = 'normal';

  constructor(private scene: THREE.Scene, private t: Track, player: Car) {
    const lineScale = Number(new URLSearchParams(location.search).get('line') ?? 1); // 測試用：賽車線幅度
    this.line = racingLine(t).map((v) => v * lineScale);
    const qs = new URLSearchParams(location.search), gOv = qs.get('g'), bOv = qs.get('b'); // 測試用：覆寫第一台的參數
    DRIVERS.forEach(([name, ti], k) => {
      const [grip0, brake0, power] = skill(k);
      const grip = k === 0 && gOv ? Number(gOv) : grip0, brake = k === 0 && bOv ? Number(bOv) : brake0;
      const { team, livery } = TEAMS[ti];
      const model = makeF1(livery);
      model.root.userData.dynamic = true; // 投射即時陰影
      model.root.visible = false;
      scene.add(model.root);
      const car = new Car();
      car.power = power;
      this.racers.push({ ...fresh(), name, team, color: livery.main, car, model, isPlayer: false, profile: speedProfile(t, this.line, grip, brake), persona: personaOf(name) });
      this.base.push([grip, brake, power]);
    });
    this.racers.push({ ...fresh(), name: '你', team: TEAMS[0].team, color: TEAMS[0].livery.main, car: player, model: null, isPlayer: true, profile: null, persona: PERSONAS.even });
    // DRS 區：建議速度幾乎全油門（frac）、連續 minLen 以上的直線
    const find = (minLen: number, frac: number) => {
      const out: DrsZone[] = [];
      const fast = (i: number) => t.vTarget[i] >= VMAX0 * frac;
      let start = -1;
      for (let k = 0; k <= t.N * 2; k++) {
        const i = k % t.N;
        if (fast(i) && start < 0 && !fast((i - 1 + t.N) % t.N)) start = k;
        if (!fast(i) && start >= 0) {
          const len = (k - start) * t.ds;
          if (len >= minLen && start < t.N) {
            const s0 = ((start * t.ds + 40) % t.length), s1 = ((k * t.ds - 30) % t.length);
            if (!out.some((z) => Math.abs(z.s0 - s0) < 1)) out.push({ s0, s1, det: (s0 - 80 + t.length) % t.length });
          }
          start = -1;
        }
      }
      return out;
    };
    let zones = find(250, 0.97);
    // 實際的 DRS 區數量（circuits.ts）：找到的不夠就放寬（短一點、帶點彎的直線也算，像摩納哥、墨西哥）；太多就留最長的那幾段
    const want = CIRCUIT?.drs;
    for (const [L, f] of [[200, 0.92], [150, 0.85], [120, 0.8]]) { if (!want || zones.length >= want) break; zones = find(L, f); }
    if (want && zones.length > want) {
      const len = (z: DrsZone) => (z.s1 - z.s0 + t.length) % t.length;
      zones = [...zones].sort((p, q) => len(q) - len(p)).slice(0, want).sort((p, q) => p.s0 - q.s0);
    }
    this.drsZones = zones;
  }

  /** 換難度：重算每台 AI 的速度曲線與引擎力（跟上次一樣就不算） */
  setDifficulty(d: Difficulty) {
    if (d === this.difficulty || !DIFFICULTY[d]) return;
    this.difficulty = d;
    this.applyDifficulty();
  }
  /** 依目前的難度與車手狀態（賽季）重算每位 AI 的速度曲線與引擎力；狀態 ±1 = 抓地力、煞車、引擎力 ±1.2%（formFactor） */
  applyDifficulty() {
    const D = DIFFICULTY[this.difficulty];
    this.base.forEach(([g, b, p], k) => {
      const r = this.racers[k], f = 1 + (this.form[r.name] ?? 0) * 0.012;
      r.profile = speedProfile(this.t, this.line, g * D.grip * f, b * D.brake * f);
      r.car.power = p * D.power * f;
    });
  }

  /** s 在不在某個 DRS 區裡（處理跨過起跑線的區間） */
  drsZoneAt(s: number): number {
    return this.drsZones.findIndex((z) => (z.s0 < z.s1 ? s >= z.s0 && s <= z.s1 : s >= z.s0 || s <= z.s1));
  }

  /**
   * 排發車格：兩列交錯，每格 8 m；grid = 排位賽的順序（沒有就照實力排、玩家在第 playerSlot 格）
   * weather：dry 晴天、maybe 中途可能下雨（四成）、wet 雨戰（全部雨胎起跑）
   */
  setup(playerSlot: number, playerCompound = 1, laps = LAPS, grid?: Racer[], weather: GpWeather = 'dry') {
    this.laps = laps;
    this.recAcc = 0;
    this.events = [];
    this.sc = { phase: 'off', t: 0, lapAt: 0, used: false, s: 0 };
    this.scAt = -1;
    this.wet = weather === 'wet' ? 1 : 0;
    this.rainAt = weather === 'wet' ? -1 : weather === 'maybe' && Math.random() < 0.4 ? laps * 55 * (0.3 + Math.random() * 0.3) : Infinity;
    // AI 的起跑胎：短比賽多用軟胎、長比賽多用中性胎
    this.pitSeed = 11;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const r of this.racers) {
      Object.assign(r, { wear: 0, pitReq: false, pit: null, pitTyre: -1, lift: 0, lastStop: 0, pits: 0, drsOk: false, rec: [] });
      r.compound = r.isPlayer ? playerCompound : laps <= 3 ? (rnd() < 0.7 ? 0 : 1) : rnd() < 0.5 ? 1 : rnd() < 0.5 ? 0 : 2;
      r.car.drs = false;
      r.car.gripMul = TYRES[r.compound].grip;
      r.car.r26 = this.rules === '2026';
      r.car.energy = 1;
      r.car.ovt = false;
      r.car.speedCap = Infinity;
      if (weather === 'wet') { r.compound = RAIN; r.car.gripMul = TYRES[RAIN].grip; }
    }
    let order: Racer[];
    if (grid) order = grid;
    else {
      order = this.racers.filter((r) => !r.isPlayer);
      order.splice(Math.min(playerSlot, order.length), 0, this.racers.find((r) => r.isPlayer)!);
    }
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
    // 下雨：開始下之後 40 秒內賽道慢慢變濕
    if (racing && this.raceTime >= this.rainAt && this.wet < 1) {
      if (this.wet === 0) this.events.push('rain');
      this.wet = Math.min(1, this.wet + dt / 40);
    }
    if (racing) this.safetyCar(dt);
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
    // 輪胎磨耗 → 抓地力；DRS 偵測與開關；進站中的車停住
    for (const r of this.racers) {
      const c = r.car, ty = TYRES[r.compound];
      const onRain = r.compound === RAIN;
      if (racing && !r.pit) r.wear = Math.min(1, r.wear + ((c.v * dt) / t.length) * ty.wear * r.persona.tyre * (1 + Math.abs(c.steer) * 0.6) * (onRain ? 1 + 2 * (1 - this.wet) : 1));
      // 濕地：乾地胎打滑（抓地力最多少 28%）；雨胎在濕地只少一點、在乾地反而差；雨戰型車手濕地少掉的抓地力少幾成
      const wetLoss = 1 - r.persona.wet;
      const wetK = (onRain ? (1 - 0.04 * this.wet * wetLoss) * (1 - 0.08 * (1 - this.wet)) : 1 - 0.28 * this.wet * wetLoss) * (1 + 0.06 * this.wet * r.persona.wet);
      c.gripMul = ty.grip * (1 - 0.18 * r.wear ** 1.5) * wetK;
      // 安全車：跟在車隊裡的、領先者限速；還沒追上的可以開快一點追上來（差距縮小）；不能開 DRS／超車
      if (this.sc.phase !== 'off' && r.finish == null) {
        c.speedCap = this.gapAhead(r) < 30 || r === this.leader() ? SC_SPEED : SC_CATCHUP;
        r.drsOk = false; c.drs = false; c.ovt = false;
      } else c.speedCap = Infinity;
      if (r.pit) { c.drs = false; c.ovt = false; continue; }
      const zi = this.drsZoneAt(c.pos.s);
      if (zi < 0) { c.drs = false; c.ovt = false; }
      c.aeroZone = zi >= 0;
      for (const z of this.drsZones) {
        // 經過偵測點：前車 1 秒內（或計時賽）→ 這個區可以開 DRS
        const d = c.pos.s - z.det;
        if (d >= 0 && d < c.v * dt + 0.5) r.drsOk = this.ttMode || this.gapAhead(r) < Math.max(15, c.v * 1.0);
      }
      if (zi < 0 && r.drsOk && !this.drsZones.some((z) => { const d = (c.pos.s - z.det + t.length) % t.length; return d < 80; })) r.drsOk = false;
    }
    // 進站：要求進站的車經過進站口 → 接手自動駕駛；已經在維修區的車照維修區規則開
    if (racing) for (const r of this.racers) {
      if (r.pit) { const prevS = r.car.pos.s; this.pitStep(r, dt); if (!r.isPlayer) this.lapCheck(r, prevS); continue; }
      if (!r.pitReq || r.finish != null || r.laps < 1 || r.laps >= this.laps) continue;
      const sd = signedS(t, r.car.pos.s);
      if (sd >= PIT.IN && sd < PIT.IN + 45) this.startPit(r);
    }
    for (const r of this.racers) {
      if (r.isPlayer) continue;
      const c = r.car;
      if (!racing || r.pit) { if (!racing) c.update(dt, t, 0, true); continue; } // 起跑前停在格位；進站中的車上面處理過了
      const prevS = c.pos.s;
      const { steer, brake } = this.drive(r, r.finish != null);
      // AI：可以開 DRS 就開（2026：超車模式，電還夠才開）；輪胎磨太多、還有兩圈以上就準備進站
      if (r.drsOk && this.drsZoneAt(c.pos.s) >= 0 && !brake) { if (this.rules === '2026') { if (c.energy > 0.25) c.ovt = true; } else c.drs = true; }
      if (!r.pitReq && r.wear > 0.7 && this.laps - r.laps >= 1 && r.finish == null) r.pitReq = true;
      if (PIT_TEST && r.laps === 1 && !r.pits && !r.pit && !r.pitReq) r.pitReq = true; // 測試（?pittest）：第 1 圈全部進站
      // 下雨了還穿乾地胎 → 這圈進站換雨胎
      if (!r.pitReq && r.finish == null && this.laps - r.laps >= 1 && this.wet > 0.35 && r.compound !== RAIN) r.pitReq = true;
      const hit = c.update(dt, t, steer, brake);
      if (hit > 0) this.aiHits++;
      // 安全車：重撞「而且車子幾乎停在賽道上」才可能出（高速擦牆的力道也會超過 20，但車還能跑，真的 F1 不會為這個出安全車）
      // 撞後 6 秒內，車速低於 8 m/s（約 29 km/h）超過 1.2 秒 = 撞停了
      if (hit > 18) r.crashAt = this.raceTime;
      r.slowT = c.v < 8 ? r.slowT + dt : 0;
      if (racing && r.slowT > 1.2 && this.raceTime - r.crashAt < 6) this.incident();
      this.lapCheck(r, prevS);
    }
    // 回放紀錄（每 0.05 秒）
    if (racing) {
      this.recAcc += dt;
      if (this.recAcc >= 0.05) {
        this.recAcc -= 0.05;
        for (const r of this.racers) r.rec.push(r.car.x, r.car.z, r.car.h, r.car.steer, r.car.v);
      }
    }
    // ---- 車與車碰撞：前後兩個圓，同質量的動量交換（被撞的那台會被推開、車頭被撞歪）
    let playerHit = 0;
    for (let a = 0; a < this.racers.length; a++) for (let b = a + 1; b < this.racers.length; b++) {
      const A = this.racers[a].car, B = this.racers[b].car;
      if (this.racers[a].pit || this.racers[b].pit) continue; // 在維修區裡的車不跟賽道上的車碰撞
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

  /** 領先者（還沒完賽、跑最遠的） */
  leader(): Racer {
    let best = this.racers[0], bp = -Infinity;
    for (const r of this.racers) { const p = r.finish != null ? Infinity : this.progress(r); if (p > bp) { bp = p; best = r; } }
    return best;
  }

  /** 有車撞停在賽道上：照 scChance 的機率安全車出動（一場最多一次；第一圈還沒跑完、最後一圈不出） */
  incident(force = false) {
    if (this.sc.used || this.sc.phase !== 'off') return;
    const L = this.leader();
    // laps 是過線次數：發車格在起跑線後，一起步就變 1，所以「跑完第一圈」是 laps >= 2
    if (!force && (L.laps < 2 || L.laps >= this.laps || Math.random() > this.scChance)) return; // laps = 總圈數 = 最後一圈
    this.sc = { phase: 'out', t: 0, lapAt: L.laps, used: true, s: L.car.pos.s + 35 };
    this.scAt = this.raceTime;
    this.events.push('sc-out');
  }

  /** 安全車：帶隊 18 秒後宣布「本圈進站」，領先者過線就綠旗 */
  private safetyCar(dt: number) {
    const sc = this.sc;
    if (sc.phase === 'off') return;
    sc.t += dt;
    const L = this.leader();
    sc.s = (L.car.pos.s + 35) % this.t.length;
    if (sc.phase === 'out' && sc.t > 18) { sc.phase = 'in'; sc.lapAt = L.laps; this.events.push('sc-in'); }
    else if (sc.phase === 'in' && L.laps > sc.lapAt) { sc.phase = 'off'; this.events.push('green'); }
  }

  /**
   * 排位賽：每台 AI 自己跑一圈（跟玩家一樣從起跑線後原地起步、中性胎、DRS／超車模式在直線區隨便開），
   * 用一樣的物理同步算，回傳圈速（加一點點隨機，每次排位結果不完全一樣）
   */
  qualify(): Map<Racer, number> {
    const t = this.t, out = new Map<Racer, number>(), dt = 1 / 120;
    this.solo = true;
    for (const r of this.racers) {
      if (r.isPlayer) continue;
      const c = r.car;
      c.placeAt(t, 1);
      Object.assign(c, { gripMul: 1, boost: 0, drs: false, ovt: false, energy: 1, r26: this.rules === '2026', speedCap: Infinity });
      r.lat = 0; r.stuck = 0;
      let time = 0, prevS = c.pos.s;
      for (let n = 0; n < 150 / dt; n++) {
        const { steer, brake } = this.drive(r, false);
        const zi = this.drsZoneAt(c.pos.s);
        c.aeroZone = zi >= 0;
        if (zi < 0) { c.drs = false; c.ovt = false; } else if (!brake) { if (c.r26) { if (c.energy > 0.1) c.ovt = true; } else c.drs = true; }
        c.update(dt, t, steer, brake);
        time += dt;
        const sNow = c.pos.s;
        if (prevS > t.length - 40 && sNow < 40) break;
        prevS = sNow;
      }
      out.set(r, time * (1 + (Math.random() - 0.5) * 0.006));
    }
    this.solo = false;
    return out;
  }

  /** 玩家的計圈（main 在玩家的物理之後呼叫） */
  playerLap(prevS: number) { this.lapCheck(this.racers.find((r) => r.isPlayer)!, prevS); }

  private lapCheck(r: Racer, prevS: number) {
    const L = this.t.length, s = r.car.pos.s;
    if (!(prevS > L - 40 && s < 40)) return;
    if (r.laps >= 1 && this.raceTime - r.lapStart < 20) return; // 在起跑線附近被撞得前後來回：不重複計圈
    if (r.laps >= 1) {
      const lt = this.raceTime - r.lapStart;
      if (r.bestLap == null || lt < r.bestLap) r.bestLap = lt;
    }
    r.laps++;
    r.lapStart = this.raceTime;
    if (r.laps > this.laps && r.finish == null) r.finish = this.raceTime;
  }

  /** 車隊建議的下一套胎：濕地換雨胎、剩兩圈以內換軟胎、不然中性／硬胎輪著用 */
  suggestTyre(r: Racer): number {
    const left = this.laps - r.laps;
    return this.wet > 0.3 ? RAIN : left <= 2 ? 0 : r.compound === 1 ? 2 : 1;
  }

  /** 經過進站口：開始進站（停站時間 2.0~2.9 秒；4% 機率某個輪子卡住，多 3~7 秒） */
  private startPit(r: Racer) {
    const c = r.car, k = Math.max(0, TEAMS.findIndex((tm) => tm.team === r.team));
    let T = 2.0 + this.pitRnd() * 0.9, slow = -1;
    if (this.pitRnd() < 0.04) { slow = Math.floor(this.pitRnd() * 4); T += 3 + this.pitRnd() * 4; }
    const next = r.isPlayer && r.pitTyre >= 0 ? r.pitTyre : this.suggestTyre(r);
    r.pit = { ph: 'in', sd: signedS(this.t, c.pos.s), v: c.v, entry: c.pos.lat, exit: 4.5, t: 0, T, slow, next, box: boxS(k), team: k };
    r.pitReq = false;
    c.drs = false; c.ovt = false;
    if (r.isPlayer) this.events.push('pit-in');
  }

  /** 維修區裡的自動駕駛：限速線前減速、轉進停車格、換胎、放行、限速線後加速、匯回賽道 */
  private pitStep(r: Racer, dt: number) {
    const p = r.pit!, c = r.car, VP = this.pitlane?.speed ?? 80 / 3.6;
    if (p.ph === 'box') {
      p.t += dt;
      c.v = 0;
      r.lift = p.t < p.T - 0.3 ? Math.min(0.1, p.t * 0.6) : Math.max(0, r.lift - dt * 0.5);
      // 放行：時間到、而且快車道後面 12 m 內沒有車正要開過來（不會放出去撞到人；同隊排隊等格子的不算）
      const clear = !this.racers.some((o) => o !== r && o.pit && o.pit.ph === 'in' && o.pit.team !== p.team && o.pit.sd > p.box - 12 && o.pit.sd < p.box + 2 && o.pit.box - o.pit.sd > 18);
      if (p.t >= p.T && clear) {
        r.wear = 0; r.compound = p.next; r.pits++; r.lastStop = p.t; r.lift = 0;
        p.ph = 'out';
        if (r.isPlayer) this.events.push(`stop:${p.t.toFixed(1)}:${p.next}:${p.slow}`);
      }
      this.placePit(r);
      return;
    }
    // 目標速度：進場要在限速線前降到限速、再停進格子；出場在限速線後全力加速
    let vt: number;
    if (p.ph === 'in') {
      vt = p.sd < PIT.LIM_IN ? Math.sqrt(VP * VP + 2 * 24 * (PIT.LIM_IN - p.sd)) : VP;
      vt = Math.min(vt, Math.sqrt(2 * 6 * Math.max(0, p.box - p.sd)) + 0.6);
    } else vt = p.sd < PIT.LIM_OUT ? VP : 95;
    // 前面有車：快車道上的車、或同隊在格子裡（排隊等）→ 保持 9 m
    for (const o of this.racers) {
      if (o === r || !o.pit) continue;
      const op = o.pit, gap = op.sd - p.sd;
      if (gap <= 0 || gap > 35) continue;
      const turningIn = op.ph === 'in' && op.box - op.sd < 18 && op.team !== p.team; // 已經轉進作業車道
      const blocks = op.ph === 'box' ? op.team === p.team && p.ph === 'in' : !turningIn;
      if (blocks) vt = Math.min(vt, Math.max(0, (gap - 9) * 1.6));
    }
    const acc = p.ph === 'out' && p.sd >= PIT.LIM_OUT ? 11 : 7;
    p.v = p.v > vt ? Math.max(vt, p.v - 26 * dt) : Math.min(vt, p.v + acc * dt);
    p.sd += p.v * dt;
    if (p.ph === 'in' && p.sd >= p.box - 0.3) { p.sd = p.box; p.v = 0; p.ph = 'box'; p.t = 0; }
    this.placePit(r);
    if (p.ph === 'out' && p.sd >= PIT.OUT) {
      // 匯回賽道：AI 從這個橫向位置慢慢回到賽車線
      c.v = p.v;
      if (!r.isPlayer) r.lat = p.exit - this.line[c.pos.i];
      r.pit = null;
    }
  }

  /** 照維修區路線（sd、橫向位置）擺車子：位置、車頭方向、賽道定位 */
  private placePit(r: Racer) {
    const p = r.pit!, c = r.car, t = this.t;
    const latAt = (sd: number) => {
      let lat = laneLat(sd, p.entry, p.exit);
      if (p.ph === 'box') return PIT.WORK;
      if (p.ph === 'in' && p.box - sd < 18) lat += (PIT.WORK - PIT.FAST) * smooth(1 - (p.box - sd) / 18);
      if (p.ph === 'out' && sd - p.box < 16) lat += (PIT.WORK - PIT.FAST) * smooth(1 - (sd - p.box) / 16);
      return lat;
    };
    const L = t.length, f = ((p.sd + L) % L) / t.ds, i = Math.floor(f) % t.N, j = (i + 1) % t.N, k = f - Math.floor(f);
    const lat = latAt(p.sd), slope = p.ph === 'box' ? 0 : (latAt(p.sd + 1) - latAt(p.sd - 1)) / 2;
    const tx = t.tx[i], tz = t.tz[i];
    c.x = t.px[i] + (t.px[j] - t.px[i]) * k - tz * lat;
    c.z = t.pz[i] + (t.pz[j] - t.pz[i]) * k + tx * lat;
    c.h = Math.atan2(tx - tz * slope, tz + tx * slope);
    c.v = p.v;
    c.steer += (Math.max(-1, Math.min(1, -slope * 6)) - c.steer) * 0.2;
    locate(t, c.x, c.z, c.pos);
  }

  /** 正在進站的隊伍 → 給維修人員動畫的停站狀態（同隊兩台都在維修區時，看停在格子裡、或比較接近格子的那台） */
  private stopInfo(): Map<number, StopInfo> {
    this.stops.clear();
    for (const r of this.racers) {
      const p = r.pit;
      if (!p) continue;
      const near = p.ph === 'box' || (p.ph === 'in' && p.box - p.sd < 140) || (p.ph === 'out' && p.sd - p.box < 6);
      if (!near) continue;
      const cur = this.stops.get(p.team);
      if (cur && cur.phase === 'service') continue;
      const phase: StopInfo['phase'] = p.ph === 'in' ? 'approach' : p.ph === 'box' && p.t < p.T ? 'service' : 'release';
      this.stops.set(p.team, { phase, t: p.t, T: p.T, slow: p.slow, newColor: TYRES[p.next].color });
    }
    return this.stops;
  }

  /** 正前方最近一台車的距離（m） */
  gapAhead(r: Racer): number {
    if (this.solo) return Infinity;
    let best = Infinity;
    for (const o of this.racers) {
      if (o === r || (o.pit && !r.pit)) continue; // 維修區裡的車不算前車
      let d = o.car.pos.s - r.car.pos.s;
      if (d < 0) d += this.t.length;
      if (d < best) best = d;
    }
    return best;
  }
  /** 玩家：申請 DRS（可以開才會開）、申請下次過線進站 */
  playerDrs(): boolean {
    const me = this.racers.find((r) => r.isPlayer)!;
    if (me.drsOk && this.drsZoneAt(me.car.pos.s) >= 0) {
      if (this.rules === '2026') { if (me.car.energy > 0.1) { me.car.ovt = true; return true; } return false; }
      me.car.drs = true;
      return true;
    }
    return false;
  }
  playerPit() {
    const me = this.racers.find((r) => r.isPlayer)!;
    if (me.pit) return false; // 已經在維修區裡
    if (me.finish == null && me.laps < this.laps) me.pitReq = !me.pitReq;
    if (!me.pitReq) me.pitTyre = -1;
    return me.pitReq;
  }
  get me() { return this.racers.find((r) => r.isPlayer)!; }

  /** 回放：第 t 秒每台車的位置（線性內插） */
  replayAt(time: number, apply: (r: Racer, x: number, z: number, h: number, steer: number, v: number) => void) {
    const f = time / 0.05, i = Math.floor(f), k = f - i;
    for (const r of this.racers) {
      const n = r.rec.length / 5;
      if (!n) continue;
      const a = Math.min(n - 1, i), b = Math.min(n - 1, i + 1), A = a * 5, B = b * 5;
      let dh = r.rec[B + 2] - r.rec[A + 2];
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      apply(r, r.rec[A] + (r.rec[B] - r.rec[A]) * k, r.rec[A + 1] + (r.rec[B + 1] - r.rec[A + 1]) * k, r.rec[A + 2] + dh * k, r.rec[A + 3], r.rec[A + 4]);
    }
  }
  get replayLength() { return (this.me.rec.length / 5) * 0.05; }

  private drive(r: Racer, cooldown: boolean) {
    const t = this.t, c = r.car, i = c.pos.i, N = t.N, P = r.persona;
    // 前方擋路的車：同一條線上、前面一段距離內（激進的看得遠、早一點開始找空檔）
    const range = 18 + 14 * P.aggr;
    let blocker: Racer | null = null, gap = Infinity, attacker: Racer | null = null, agap = Infinity;
    for (const o of this.racers) {
      if (o === r || this.solo || o.pit) continue; // 維修區裡的車不會擋路
      let d = o.car.pos.s - c.pos.s;
      if (d < -t.length / 2) d += t.length;
      if (d > t.length / 2) d -= t.length;
      if (d > 0 && d < range && Math.abs(o.car.pos.lat - c.pos.lat) < 2.4 && d < gap) { gap = d; blocker = o; }
      // 後面追上來的車（比我快、18 m 內）
      if (d < -2 && d > -18 && o.car.v > c.v - 0.5 && -d < agap) { agap = -d; attacker = o; }
    }
    const ahead = (i + Math.round((c.v * 0.45) / t.ds)) % N;
    // 輪胎磨耗後抓地力變小：過彎速度照 √(抓地力) 下修；完賽後跑慢速收車圈
    const tyreK = Math.sqrt(c.gripMul / 0.985);
    let want = cooldown ? Math.min(25, r.profile![ahead]) : r.profile![ahead] * Math.min(1.02, tyreK);
    // 激進型：跟前車並排纏鬥時晚煞車（多帶一點速度進彎，可能跑寬）
    if (blocker && P.aggr > 0.6 && gap < 10 && Math.abs(blocker.car.pos.lat - c.pos.lat) > 1.2) want += (P.aggr - 0.6) * 4;
    r.defT = Math.max(0, r.defT - 1 / 120);
    if (blocker && blocker.car.v < want + 1 + P.aggr * 2.3 && this.sc.phase === 'off') { // 安全車期間不超車
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
    } else if (!blocker && attacker && P.defend > 0.6 && r.defT <= 0 && this.sc.phase === 'off' && r.finish == null && t.vTarget[ahead] >= t.vTarget[i] - 0.1) {
      // 防守型：後車在旁邊找空檔 → 換到它那一側卡位（一次防守只換一次線，之後 3 秒不再動）
      const side = attacker.car.pos.lat - this.line[i];
      if (Math.abs(side - r.lat) > 1.2) { r.lat = Math.max(-2.6, Math.min(2.6, side)) * P.defend; r.defT = 3; }
    } else if (!blocker && r.defT <= 0) {
      r.lat += (0 - r.lat) * Math.min(1, 0.8 / 120); // 沒人擋：慢慢回到賽車線
    }
    const j = (i + Math.round((8 + c.v * this.look) / t.ds)) % N;
    const off = Math.max(-(HALF_WIDTH - 1.3), Math.min(HALF_WIDTH - 1.3, this.line[j] + r.lat));
    const tx = t.px[j] - t.tz[j] * off, tz = t.pz[j] + t.tx[j] * off;
    let err = Math.atan2(tx - c.x, tz - c.z) - c.h;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    let brake = c.v > want + 0.5;
    // 換邊來不及就跟著前車速度（約 0.2 秒的跟車距離）
    // 跟車距離：激進的貼得近、穩健的留多一點
    if (blocker && gap < 7.29 - 3 * P.aggr + c.v * (0.1415 - 0.05 * P.aggr) && Math.abs(blocker.car.pos.lat - c.pos.lat) < 1.8 && c.v > blocker.car.v - 1) brake = true;
    // 卡住太久（撞牆停住）就自動扶正
    r.stuck = c.v < 2 ? r.stuck + 1 / 120 : 0;
    if (r.stuck > 3) { c.placeAt(t, i); r.stuck = 0; }
    const steer = -err * 2.6;
    return { steer: Math.max(-1, Math.min(1, steer)), brake };
  }

  render(dt: number) {
    for (const r of this.racers) {
      if (!r.model) continue;
      const c = r.car, m = r.model;
      m.root.position.set(c.x, surfaceY(this.t, c.pos.i, c.pos.lat) + r.lift, c.z); // 換胎時千斤頂把車抬起來
      m.root.rotation.set(-Math.atan(this.t.grade[c.pos.i]), c.h, bankRoll(this.t, c.pos.i, c.pos.lat), 'YXZ');
      m.body.rotation.z = c.steer * Math.min(1, c.v / 40) * 0.04;
      for (const w of m.steer) w.rotation.y = -c.steer * 0.35;
      for (const w of m.spin) w.rotation.x += (c.v / 0.36) * dt;
    }
    this.pitlane?.update(dt, this.stopInfo());
  }
}

/** 每台車比賽開始時的狀態 */
function fresh() {
  return { laps: 0, finish: null, lapStart: 0, bestLap: null, lat: 0, stuck: 0, crashAt: -99, slowT: 0, defT: 0, compound: 1, wear: 0, pitReq: false, pit: null as PitState | null, pitTyre: -1, lift: 0, lastStop: 0, pits: 0, drsOk: false, rec: [] as number[] };
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
export function racingLine(t: Track): Float32Array {
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
  const G0 = GRIP0 * grip, GK = GRIPK * grip, VMAX = VMAX0 * 1.03;
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
    const k = ks[i], g0 = G0 * t.bankGrip[i], gk = GK * t.bankGrip[i]; // 傾斜彎過得比較快
    v[i] = k > gk + 1e-5 ? Math.min(VMAX, Math.sqrt(g0 / (k - gk))) : VMAX;
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
