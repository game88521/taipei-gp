import { FreeCar } from './freecar';
import type { Landmark } from './decor';
import { landmarkId, explorationRegion } from './player-progress';

export const SCHOOL_IDS = ['brake', 'slalom', 'park', 'smooth'] as const;
export type SchoolId = typeof SCHOOL_IDS[number];
export type Medal = 'bronze' | 'silver' | 'gold';
export const DECALS = ['none', 'stripes', 'wave', 'chevron'] as const;
export const RIMS = ['original', 'silver', 'gold', 'cyan', 'violet'] as const;
export const BADGE_IDS = ['theme:water', 'theme:culture', 'region:東區', 'region:中區', 'region:西區'] as const;
export interface CarAppearance { number: string; decal: typeof DECALS[number]; rim: typeof RIMS[number] }
export interface HorizonCitySave {
  v: 1; school: Partial<Record<SchoolId, { score: number; medal: Medal }>>;
  badges: string[]; unlocked: string[]; appearance: Record<string, CarAppearance>;
}
export const newHorizonCity = (): HorizonCitySave => ({ v: 1, school: {}, badges: [], unlocked: ['number'], appearance: {} });
const validId = (v: unknown, n = 100): v is string => typeof v === 'string' && v.length > 0 && v.length <= n && !/[\x00-\x1f]/.test(v);
export function parseHorizonCity(raw: unknown): HorizonCitySave | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as HorizonCitySave;
  if (r.v !== 1 || !r.school || typeof r.school !== 'object' || Array.isArray(r.school) || !Array.isArray(r.badges) || r.badges.length > 30
    || !r.badges.every(s => BADGE_IDS.includes(s as typeof BADGE_IDS[number])) || new Set(r.badges).size !== r.badges.length
    || !Array.isArray(r.unlocked) || r.unlocked.length > 10 || new Set(r.unlocked).size !== r.unlocked.length || !r.unlocked.every(s => ['number', 'stripes', 'wave', 'chevron', 'silver', 'gold', 'cyan', 'violet'].includes(s))
    || !r.appearance || typeof r.appearance !== 'object' || Array.isArray(r.appearance) || Object.keys(r.appearance).length > 30) return null;
  const out = newHorizonCity(); out.badges = [...r.badges]; out.unlocked = [...new Set(['number', ...r.unlocked])];
  for (const [id, rec] of Object.entries(r.school)) {
    if (!SCHOOL_IDS.includes(id as SchoolId) || !rec || !Number.isInteger(rec.score) || rec.score < 1 || rec.score > 100 || !['bronze', 'silver', 'gold'].includes(rec.medal)
      || rec.medal !== medalFor(rec.score)) return null;
    out.school[id as SchoolId] = { score: rec.score, medal: rec.medal };
  }
  for (const [id, a] of Object.entries(r.appearance)) {
    if (!validId(id, 40) || ['__proto__', 'constructor', 'prototype'].includes(id) || !a || typeof a.number !== 'string' || !/^\d{0,2}$/.test(a.number) || !DECALS.includes(a.decal) || !RIMS.includes(a.rim)
      || a.decal !== 'none' && !out.unlocked.includes(a.decal) || a.rim !== 'original' && !out.unlocked.includes(a.rim)) return null;
    out.appearance[id] = { number: a.number, decal: a.decal, rim: a.rim };
  }
  return out;
}
export const medalFor = (score: number): Medal => score >= 90 ? 'gold' : score >= 70 ? 'silver' : 'bronze';
export const defaultAppearance = (): CarAppearance => ({ number: '', decal: 'none', rim: 'original' });
export function recordSchool(s: HorizonCitySave, id: SchoolId, score: number) {
  if (!SCHOOL_IDS.includes(id) || !Number.isInteger(score) || score < 1 || score > 100 || score <= (s.school[id]?.score ?? 0)) return false;
  s.school[id] = { score, medal: medalFor(score) }; return true;
}
export function unlockAppearance(s: HorizonCitySave, challengeWon = false) {
  const add: string[] = [];
  const grant = (id: string) => { if (!s.unlocked.includes(id)) { s.unlocked.push(id); add.push(id); } };
  if (Object.keys(s.school).length) { grant('stripes'); grant('silver'); }
  if (SCHOOL_IDS.every(id => s.school[id]?.medal === 'gold')) { grant('chevron'); grant('gold'); }
  if (s.badges.length) { grant('wave'); grant('cyan'); }
  if (challengeWon) grant('violet');
  return add;
}
export interface Theme {
  id: string; title: string; marks: Landmark[]; kind: 'theme' | 'region';
}
/** Only named, reachable ground-level landmarks are offered. No random synthetic goals. */
export function explorationThemes(marks: Landmark[], reachable: (l: Landmark) => boolean): Theme[] {
  const unique = new Set<string>();
  const available = marks.filter(l => /[^\d\s,，.、-]/.test(l.nm) && !unique.has(landmarkId(l)) && (unique.add(landmarkId(l)), reachable(l)))
    .sort((a, b) => landmarkId(a).localeCompare(landmarkId(b), 'zh-Hant'));
  const rows: Theme[] = [];
  for (const [id, title, pattern] of [['water', '水岸與橋梁', /河|橋|水岸|碼頭/], ['culture', '城市文化散策', /公園|館|寺|廟|古|紀念|廣場/]] as const) {
    const list = available.filter(l => pattern.test(l.nm)).slice(0, 4);
    if (list.length >= 2) rows.push({ id: `theme:${id}`, title, marks: list, kind: 'theme' });
  }
  for (const region of ['東區', '中區', '西區']) {
    const list = available.filter(l => explorationRegion(l) === region);
    if (list.length >= 3) rows.push({ id: `region:${region}`, title: `${region}探索里程碑`, marks: list.slice(0, 5), kind: 'region' });
  }
  return rows;
}
export function claimTheme(s: HorizonCitySave, theme: Theme, visited: readonly string[]) {
  const seen = new Set(visited);
  if (!BADGE_IDS.includes(theme.id as typeof BADGE_IDS[number]) || s.badges.includes(theme.id) || theme.marks.length < 2 || !theme.marks.every(l => seen.has(landmarkId(l)))) return false;
  s.badges.push(theme.id); unlockAppearance(s); return true;
}
export const SCHOOL = {
  brake: { title: '精準煞停', text: '直行加速到40km/h，再在50～60m綠色區內停穩一秒。別一直踩煞車，停住後會倒車。', limit: 60 },
  slalom: { title: '繞錐控制', text: '依序穿過左右交錯的四道綠門，再在最後白線前停穩。碰錐、漏門或駛出邊界即失敗。', limit: 90 },
  park: { title: '倒車入庫', text: '由原地向後倒進18m後方車格，車身對齊且停穩一秒；停止時放開煞車鍵。', limit: 60 },
  smooth: { title: '平順駕駛', text: '直行至120m；30～100m內維持25～50km/h，急減速會扣分。最後140m前停穩。', limit: 90 },
} as const;
export interface SchoolInput { steer: number; throttle: boolean; brake: boolean }
export interface SchoolResult { success: boolean; score: number; medal: Medal | null; elapsed: number; reason: string }
/** Own FreeCar, own clock, no wallet/official race/state mutation. Surface is never replaced. */
export class DrivingSchool {
  readonly car = new FreeCar();
  id: SchoolId = 'brake'; active = false; elapsed = 0; next = 0; peaked = 0; hold = 0; penalties = 0; reverse = 0;
  result: SchoolResult | null = null;
  private last = { x: 0, z: 0, speed: 0 };
  private settled = false;
  private cruise = 0;
  get gates() { return this.id === 'slalom' ? [{ x: -3.5, z: 20 }, { x: 3.5, z: 40 }, { x: -3.5, z: 60 }, { x: 3.5, z: 80 }] : []; }
  start(id: SchoolId) {
    if (!SCHOOL_IDS.includes(id)) return false;
    this.id = id; this.car.place(0, 0, 0); this.car.spec = { engine: 8.5, vmax: 24, brake: 16, grip: 13.5, mass: 1 };
    this.elapsed = this.next = this.peaked = this.hold = this.penalties = this.reverse = this.cruise = 0;
    this.result = null; this.active = true; this.settled = false; this.last = { x: 0, z: 0, speed: 0 }; return true;
  }
  stop() { this.active = false; }
  private finish(success: boolean, reason: string, precision = 0) {
    if (this.result) return this.result;
    const target = this.id === 'slalom' ? 35 : this.id === 'park' ? 18 : 23;
    const score = success ? Math.round(Math.max(1, 100 - this.penalties - Math.max(0, this.elapsed - target) * .55 - precision)) : 0;
    this.active = false; this.result = { success, score, medal: success ? medalFor(score) : null, elapsed: this.elapsed, reason }; return this.result;
  }
  /** Seconds must be simulation steps; background/paused frames never call this. */
  step(dt: number, input: SchoolInput): SchoolResult | null {
    if (!this.active || this.result) return this.result;
    if (!Number.isFinite(dt) || dt <= 0 || dt > .05 || !Number.isFinite(input.steer) || Math.abs(input.steer) > 1) return this.finish(false, '無效步進');
    // Detect external placement/reset before applying genuine physics.
    if (Math.hypot(this.car.x - this.last.x, this.car.z - this.last.z) > .02) return this.finish(false, '車輛位置被重置，請重試');
    this.car.update(dt, input.steer, input.throttle, input.brake, null);
    const c = this.car, speed = Math.abs(c.v), moved = Math.hypot(c.x - this.last.x, c.z - this.last.z);
    this.elapsed += dt; this.peaked = Math.max(this.peaked, speed); if (c.v < -.1) this.reverse += moved;
    if (![c.x, c.z, c.h, speed].every(Number.isFinite) || moved > 30 * dt + .02) return this.finish(false, '車輛狀態異常');
    if (Math.abs(c.x) > 14 || c.z < -28 || c.z > 150) return this.finish(false, '駛出練習邊界');
    if (this.elapsed > SCHOOL[this.id].limit) return this.finish(false, '超過練習時限');
    if (this.id === 'slalom') {
      const gate = this.gates[this.next];
      if (gate && this.last.z < gate.z && c.z >= gate.z) {
        const x = this.last.x + (c.x - this.last.x) * (gate.z - this.last.z) / (c.z - this.last.z);
        if (Math.abs(x - gate.x) > 2.2) return this.finish(false, '未依序穿過綠門');
        this.next++;
      }
      for (const g of this.gates) for (const x of [g.x - 3.3, g.x + 3.3]) {
        if (c.circles().some(([cx, cz]) => Math.hypot(cx - x, cz - g.z) < 1.25)) return this.finish(false, '碰到交通錐');
      }
    }
    if (this.id === 'smooth' && c.z >= 30 && c.z <= 100) {
      if (speed < 25 / 3.6 || speed > 50 / 3.6) this.penalties += dt * 4;
      else this.cruise += dt;
      if ((this.last.speed - speed) / dt > 5) this.penalties += dt * 8;
    }
    const heading = Math.abs(Math.atan2(Math.sin(c.h), Math.cos(c.h)));
    const zone = this.id === 'brake' ? this.peaked >= 40 / 3.6 && c.z >= 50 && c.z <= 60 && Math.abs(c.x) < 2.8
      : this.id === 'slalom' ? this.next === 4 && c.z >= 84 && c.z <= 105
      : this.id === 'park' ? this.reverse >= 15 && c.z >= -21 && c.z <= -15 && Math.abs(c.x) <= 1.5 && heading < .16
      : c.z >= 120 && c.z <= 140 && Math.abs(c.x) <= 3;
    this.hold = zone && speed < .2 ? this.hold + dt : 0;
    if (this.id === 'brake' && c.z > 64 || this.id === 'slalom' && c.z > 108 || this.id === 'smooth' && c.z > 144) return this.finish(false, '超過停車區');
    this.last = { x: c.x, z: c.z, speed };
    if (this.hold >= 1) {
      if (this.id === 'smooth' && (this.cruise < 4 || this.penalties > 60)) return this.finish(false, '速度控制未達標，請維持標示速度並平順減速');
      return this.finish(true, '完成課程', this.id === 'brake' ? Math.abs(c.z - 55) * 2 : this.id === 'park' ? Math.abs(c.x) * 5 + heading * 20 : 0);
    }
    return null;
  }
  consume() { if (this.settled || !this.result) return null; this.settled = true; return { ...this.result }; }
}
