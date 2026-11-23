import type { CityData } from './citydata';
import { Router } from './router';
import { ROAD_Y } from './surface';

export const WORKSHOP_VERSION = 'city-workshop-v1';
export const WORKSHOP_VERSION_2 = 'city-workshop-v2';
export const WORKSHOP_CARS = ['sedan', 'taxi', 'muscle', 'f1', 'super', 'police', 'pickup'] as const;
export const WORKSHOP_WEATHER = ['day', 'dusk', 'night', 'rain', 'rainnight'] as const;
export type WorkshopCar = typeof WORKSHOP_CARS[number];
export type WorkshopWeather = typeof WORKSHOP_WEATHER[number];
interface WorkshopBase { map: string; name: string; nodes: number[]; car: WorkshopCar; weather: WorkshopWeather; seconds: number; hits: number }
export type WorkshopDefinition = (WorkshopBase & { v: 1; physics: typeof WORKSHOP_VERSION }) | (WorkshopBase & { v: 2; physics: typeof WORKSHOP_VERSION_2; laps: 1 | 3 | 5; splits: number[] });
export interface WorkshopPoint { x: number; z: number; y: number }
export interface WorkshopRoute { path: [number, number][]; ys: number[]; length: number; anchors: WorkshopPoint[]; gates: WorkshopPoint[]; start: WorkshopPoint & { h: number } }
export interface WorkshopRouteSignature { route: string; heading: number }
export function workshopRouteSignature(route: WorkshopRoute): WorkshopRouteSignature { return { route: JSON.stringify(route), heading: route.start.h }; }
export function workshopRoutesMatch(expected: WorkshopRouteSignature, actual: WorkshopRoute): boolean {
  // Math.atan2 may differ by the last bit across Node/Chrome. All other road values stay exact.
  const heading = actual.start.h;
  return Number.isFinite(expected.heading) && Number.isFinite(heading) && Math.abs(expected.heading - heading) <= 1e-12 && expected.route === JSON.stringify({ ...actual, start: { ...actual.start, h: expected.heading } });
}
export interface WorkshopResult { success: boolean; elapsed: number; hits: number; reason: string; lapTimes?: number[]; segments?: number[][] }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function workshopHash(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
export function parseWorkshop(raw: unknown): WorkshopDefinition | null {
  if (!obj(raw)) return null;
  const advanced = raw.v === 2;
  if (Object.keys(raw).sort().join(',') !== (advanced ? 'car,hits,laps,map,name,nodes,physics,seconds,splits,v,weather' : 'car,hits,map,name,nodes,physics,seconds,v,weather')) return null;
  if (advanced ? raw.physics !== WORKSHOP_VERSION_2 : raw.v !== 1 || raw.physics !== WORKSHOP_VERSION) return null;
  if (typeof raw.map !== 'string' || !/^roads-v1:[0-9a-f]{8}$/.test(raw.map)) return null;
  if (typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > 36 || raw.name.trim() !== raw.name || /[\x00-\x1f\x7f<>]/.test(raw.name)) return null;
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 2 || raw.nodes.length > 12 || raw.nodes.some((v, i) => !Number.isSafeInteger(v) || v < 0 || v > 1e7 || (i > 0 && raw.nodes instanceof Array && v === raw.nodes[i - 1]))) return null;
  if (!WORKSHOP_CARS.includes(raw.car as WorkshopCar) || !WORKSHOP_WEATHER.includes(raw.weather as WorkshopWeather)) return null;
  if (!finite(raw.seconds) || !Number.isInteger(raw.seconds) || raw.seconds < 15 || raw.seconds > 1800 || !finite(raw.hits) || !Number.isInteger(raw.hits) || raw.hits < 0 || raw.hits > 20) return null;
  const base = { map: raw.map, name: raw.name, nodes: [...raw.nodes] as number[], car: raw.car as WorkshopCar, weather: raw.weather as WorkshopWeather, seconds: raw.seconds, hits: raw.hits };
  if (advanced) {
    if (![1, 3, 5].includes(raw.laps as number) || !Array.isArray(raw.splits) || raw.splits.length > 2 || raw.splits.some((n, i, a) => !Number.isSafeInteger(n) || n < 1 || n > 666 || i > 0 && n <= a[i - 1])) return null;
    if (raw.laps !== 1 && !workshopClosed(base.nodes)) return null;
    return { v: 2, physics: WORKSHOP_VERSION_2, ...base, laps: raw.laps as 1 | 3 | 5, splits: [...raw.splits] as number[] };
  }
  // Keep NG1 field order and bytes stable for existing codes and record keys.
  return { v: 1, physics: WORKSHOP_VERSION, ...base };
}
export function encodeWorkshop(definition: WorkshopDefinition) {
  const def = parseWorkshop(definition); if (!def) throw Error('挑戰設定無效');
  const bytes = new TextEncoder().encode(JSON.stringify(def)); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const payload = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `NG${def.v}.${payload}.${workshopHash(payload)}`;
}
export function decodeWorkshop(value: string): WorkshopDefinition {
  if (value.length > 4096) throw Error('分享碼過長，請使用工坊產生的分享碼');
  const code = value.trim(); const match = /^NG([12])\.([A-Za-z0-9_-]{10,3500})\.([0-9a-f]{8})$/.exec(code);
  if (!match || workshopHash(match[2]) !== match[3]) throw Error('分享碼不完整或已損壞');
  try {
    const decoded = atob(match[2].replaceAll('-', '+').replaceAll('_', '/'));
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(decoded, c => c.charCodeAt(0))));
    const def = parseWorkshop(raw); if (def && String(def.v) === match[1]) return def;
  } catch { /* Report a concise validation error; never execute shared data. */ }
  throw Error('挑戰版本或設定不支援，請請朋友重新產生分享碼');
}
export function workshopKey(def: WorkshopDefinition) { return encodeWorkshop(def); }
export function workshopInvite(def: WorkshopDefinition, current: string) { const url = new URL(current); url.pathname = '/'; url.search = ''; url.hash = `challenge=${encodeWorkshop(def)}`; return url.href; }
export function workshopFromUrl(current: string) { const hash = new URL(current).hash.slice(1); if (!hash.startsWith('challenge=')) return null; return decodeWorkshop(hash.slice(10)); }

/** Bounded editor snapshots include settings as well as route mutations; sharing stays NG1. */
export class WorkshopHistory<T> {
  private rows: T[] = []; private cursor = -1;
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor >= 0 && this.cursor < this.rows.length - 1; }
  get size() { return this.rows.length; }
  record(value: T) { const text = JSON.stringify(value); if (this.cursor >= 0 && JSON.stringify(this.rows[this.cursor]) === text) return; this.rows.splice(this.cursor + 1); this.rows.push(JSON.parse(text) as T); if (this.rows.length > 100) this.rows.shift(); this.cursor = this.rows.length - 1; }
  undo(): T | null { return this.canUndo ? JSON.parse(JSON.stringify(this.rows[--this.cursor])) as T : null; }
  redo(): T | null { return this.canRedo ? JSON.parse(JSON.stringify(this.rows[++this.cursor])) as T : null; }
}
export function workshopClosed(nodes: number[]) { return nodes.length >= 3 && nodes[0] === nodes.at(-1); }

/** Only existing major road nodes may be selected. Route reconstruction obeys the real one-way graph and road levels. */
export class WorkshopRoads {
  readonly stamp: string;
  readonly nodes = new Map<number, WorkshopPoint & { name: string; elevated: boolean }>();
  private router: Router;
  constructor(readonly data: CityData) {
    this.router = new Router(data);
    this.stamp = `roads-v1:${workshopHash(JSON.stringify(data.net))}`;
    for (const way of [...data.net.ways, ...(data.net.decks ?? [])]) if (way.c <= 2) for (const n of way.n) {
      const x = data.net.nodes[n * 2], z = data.net.nodes[n * 2 + 1], y = data.net.y?.[n] ?? 0;
      if (finite(x) && finite(z) && finite(y)) this.nodes.set(n, { x, z, y, name: way.nm || '道路節點', elevated: !!way.e });
    }
  }
  nearest(x: number, z: number, layer: 'all' | 'ground' | 'deck' = 'all', radius = 90) {
    if (!finite(x) || !finite(z)) return null;
    let result: { id: number; point: WorkshopPoint & { name: string; elevated: boolean }; distance: number } | null = null;
    for (const [id, point] of this.nodes) {
      if (layer === 'ground' && point.elevated || layer === 'deck' && !point.elevated) continue;
      const distance = Math.hypot(x - point.x, z - point.z);
      if (distance <= radius && (!result || distance < result.distance)) result = { id, point, distance };
    }
    return result;
  }
  route(nodes: number[]): WorkshopRoute {
    if (nodes.length < 2 || nodes.length > 12) throw Error('請設定起點、終點，最多 12 個路線點');
    const anchors = nodes.map(id => { const p = this.nodes.get(id); if (!p) throw Error('路線點不在目前可駕駛道路'); return { x: p.x, z: p.z, y: p.y }; });
    const path: [number, number][] = [], ys: number[] = []; let length = 0;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 25 && Math.abs(a.y - b.y) < 3) throw Error(`第 ${i}、${i + 1} 點太近，請拉開至少 25 公尺`);
      const leg = this.router.route(a.x, a.z, b.x, b.z, a.y, b.y);
      if (!leg || leg.length < 25 || Math.abs(leg.ys[0] - a.y) > 2 || Math.abs(leg.ys.at(-1)! - b.y) > 2) throw Error(`第 ${i} → ${i + 1} 點無法沿單行方向與相同路層到達`);
      if (Math.hypot(leg.path[0][0] - a.x, leg.path[0][1] - a.z) > 4 || Math.hypot(leg.path.at(-1)![0] - b.x, leg.path.at(-1)![1] - b.z) > 4) throw Error('路線點無法連接主路網，請換鄰近道路');
      length += leg.length; if (length > 20000) throw Error('路線長度上限 20 公里，請減少折返或路線點');
      path.push(...leg.path.slice(i > 1 ? 1 : 0)); ys.push(...leg.ys.slice(i > 1 ? 1 : 0));
    }
    if (length < 100) throw Error('完整路線至少需要 100 公尺');
    if (path.length > 20000) throw Error('路線過於複雜，請減少路線點');
    const gates: WorkshopPoint[] = [];
    let since = 0;
    for (let i = 1; i < path.length; i++) {
      let ax = path[i - 1][0], az = path[i - 1][1], ay = ys[i - 1], remaining = Math.hypot(path[i][0] - ax, path[i][1] - az);
      while (since + remaining >= 30) {
        const t = (30 - since) / remaining;
        ax += (path[i][0] - ax) * t; az += (path[i][1] - az) * t; ay += (ys[i] - ay) * t;
        gates.push({ x: ax, z: az, y: ay }); remaining = Math.hypot(path[i][0] - ax, path[i][1] - az); since = 0;
      }
      since += remaining;
    }
    const last = path.at(-1)!; gates.push({ x: last[0], z: last[1], y: ys.at(-1)! });
    const first = path[0], next = path.find(p => Math.hypot(p[0] - first[0], p[1] - first[1]) > .5)!;
    return { path, ys, length, anchors, gates, start: { x: first[0], z: first[1], y: ys[0], h: Math.atan2(next[0] - first[0], next[1] - first[1]) } };
  }
  validate(def: WorkshopDefinition) { if (!parseWorkshop(def)) throw Error('挑戰設定無效'); if (def.map !== this.stamp) throw Error('城市地圖已更新，這份挑戰的路線版本不同；請重新編輯再分享'); const route = this.route(def.nodes); if (def.v === 2) { const a = route.gates.at(-1)!, b = route.gates.at(-2); if (b && Math.hypot(a.x - b.x, a.z - b.z, a.y - b.y) < .001) route.gates.pop(); if (def.splits.some(n => n >= route.gates.length)) throw Error('計時分段超出路線，請重新設定'); } return route; }
}

export class WorkshopRun {
  phase: 'countdown' | 'running' | 'done' = 'countdown';
  countdown = 3; elapsed = 0; next = 0; hits = 0; result: WorkshopResult | null = null;
  private last: WorkshopPoint; private lastHit = -100;
  completedLaps = 0; lapTimes: number[] = []; segments: number[][] = []; private lapStart = 0; private segmentStart = 0; private currentSegments: number[] = [];
  constructor(readonly definition: WorkshopDefinition, readonly route: WorkshopRoute, initial: WorkshopPoint, readonly vmax: number, readonly previousSegments: number[] = []) { this.last = { ...initial }; }
  get totalLaps() { return this.definition.v === 2 ? this.definition.laps : 1; }
  get currentLap() { return Math.min(this.totalLaps, this.completedLaps + 1); }
  get lastSegmentDelta() { const last = this.currentSegments.length ? this.currentSegments : this.segments.at(-1); if (!last?.length) return null; const index = last.length - 1, previous = this.previousSegments[index]; return finite(previous) ? last[index] - previous : null; }
  fail(reason: string) { if (!this.result) { this.result = { success: false, elapsed: this.elapsed, hits: this.hits, reason }; this.phase = 'done'; } return this.result; }
  step(dt: number, position: WorkshopPoint, impact = 0) {
    if (this.phase === 'done') return this.result;
    if (!finite(dt) || dt <= 0 || dt > .1 || ![position.x, position.z, position.y].every(finite)) return this.fail('模擬中斷，請重新挑戰');
    if (Math.hypot(position.x - this.last.x, position.z - this.last.z) > this.vmax * dt * 1.8 + 2 || Math.abs(position.y - this.last.y) > 8) return this.fail('使用扶正、重置或位置跳躍，本次不計成績');
    if (this.phase === 'countdown') { this.countdown = Math.max(0, this.countdown - dt); this.last = { ...position }; if (!this.countdown) this.phase = 'running'; return null; }
    this.elapsed += dt;
    if (impact > 6 && this.elapsed - this.lastHit > .75) { this.hits++; this.lastHit = this.elapsed; }
    if (this.hits > this.definition.hits) return this.fail('碰撞次數超過挑戰條件');
    if (this.definition.v === 2) return this.stepAdvanced(dt, position);
    if (this.elapsed > this.definition.seconds) return this.fail('超過目標時間');
    const gate = this.route.gates[this.next];
    if (gate) {
      const dx = position.x - this.last.x, dz = position.z - this.last.z, t = Math.max(0, Math.min(1, ((gate.x - this.last.x) * dx + (gate.z - this.last.z) * dz) / (dx * dx + dz * dz || 1)));
      const gx = this.last.x + dx * t, gz = this.last.z + dz * t, gy = this.last.y + (position.y - this.last.y) * t - ROAD_Y;
      if (Math.hypot(gx - gate.x, gz - gate.z) < (this.next === this.route.gates.length - 1 ? 8 : 12) && Math.abs(gy - gate.y) < 2.2) this.next++;
    }
    this.last = { ...position };
    if (this.next === this.route.gates.length) { this.result = { success: true, elapsed: this.elapsed, hits: this.hits, reason: '已依序完成所有檢查點並達成目標' }; this.phase = 'done'; }
    return this.result;
  }
  private stepAdvanced(dt: number, position: WorkshopPoint) {
    const def = this.definition; if (def.v !== 2) return null;
    const gate = this.route.gates[this.next], before = this.next ? this.route.gates[this.next - 1] : this.route.start;
    const nx = gate.x - before.x, nz = gate.z - before.z, norm = Math.hypot(nx, nz);
    const a = ((this.last.x - gate.x) * nx + (this.last.z - gate.z) * nz) / norm, b = ((position.x - gate.x) * nx + (position.z - gate.z) * nz) / norm;
    if (a <= .0001 && b >= 0 && b > a + .000001) {
      const t = Math.max(0, Math.min(1, -a / (b - a))), x = this.last.x + (position.x - this.last.x) * t, z = this.last.z + (position.z - this.last.z) * t, y = this.last.y + (position.y - this.last.y) * t - ROAD_Y;
      if (Math.hypot(x - gate.x, z - gate.z) < (this.next === this.route.gates.length - 1 ? 8 : 12) && Math.abs(y - gate.y) < 2.2) {
        this.next++; const at = this.elapsed - dt + dt * t, finish = this.next === this.route.gates.length;
        if (def.splits.includes(this.next) || finish) { this.currentSegments.push(at - this.segmentStart); this.segmentStart = at; }
        if (finish && at <= def.seconds) {
          this.completedLaps++; this.lapTimes.push(at - this.lapStart); this.segments.push(this.currentSegments); this.currentSegments = []; this.lapStart = at;
          if (this.completedLaps === this.totalLaps) { this.elapsed = at; this.result = { success: true, elapsed: at, hits: this.hits, reason: `已依序完成${this.totalLaps}圈及所有計時分段`, lapTimes: [...this.lapTimes], segments: this.segments.map(row => [...row]) }; this.phase = 'done'; }
          else this.next = 0;
        }
      }
    }
    this.last = { ...position };
    if (!this.result && this.elapsed > def.seconds) return this.fail('超過目標時間');
    return this.result;
  }
}

export const WORKSHOP_STORAGE = 'taipei-gp-workshop-v1';
interface WorkshopRecord { code: string; best: number; wins: number; bestLap?: number; segments?: number[] }
/** Strict full-library parser for whole-profile backups; no invalid rows are discarded. */
export function parseWorkshopStorage(value: unknown): { v: 1; drafts: WorkshopDefinition[]; records: WorkshopRecord[] } | null {
  try {
    if (!obj(value) || Object.keys(value).sort().join(',') !== 'drafts,records,v' || value.v !== 1 || !Array.isArray(value.drafts) || value.drafts.length > 24 || !Array.isArray(value.records) || value.records.length > 80) return null;
    const drafts = value.drafts.map(d => { const row = parseWorkshop(d); if (!row) throw Error(); return row; });
    const codes = new Set<string>();
    const records = value.records.map(r => {
      if (!obj(r) || typeof r.code !== 'string' || codes.has(r.code) || !finite(r.best) || r.best <= 0 || r.best > 1800 || !Number.isSafeInteger(r.wins) || (r.wins as number) < 1 || (r.wins as number) > 1e7) throw Error();
      const definition = decodeWorkshop(r.code), best = r.best; codes.add(r.code);
      const advanced = r.bestLap !== undefined || r.segments !== undefined;
      if (best > definition.seconds || definition.v === 2 && !advanced) throw Error();
      if (Object.keys(r).sort().join(',') !== (advanced ? 'best,bestLap,code,segments,wins' : 'best,code,wins')) throw Error();
      if (advanced) { if (definition.v !== 2 || !finite(r.bestLap) || r.bestLap <= 0 || r.bestLap > best || !Array.isArray(r.segments) || r.segments.length !== definition.splits.length + 1 || r.segments.some(n => !finite(n) || n <= 0 || n > best)) throw Error(); return { code: r.code, best, wins: r.wins as number, bestLap: r.bestLap, segments: [...r.segments] as number[] }; }
      return { code: r.code, best, wins: r.wins as number };
    });
    return { v: 1, drafts, records };
  } catch { return null; }
}
/** A separate bounded library; imported settings never write the official save, wallet or race records. */
export class WorkshopLibrary {
  drafts: WorkshopDefinition[] = []; records: WorkshopRecord[] = []; error = '';
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'> | null) {
    try { const text = storage?.getItem(WORKSHOP_STORAGE); if (!text) return; if (text.length > 200000) throw Error('工坊資料過大'); const value = parseWorkshopStorage(JSON.parse(text)); if (!value) throw Error('工坊資料格式無效'); this.drafts = value.drafts; this.records = value.records;
    } catch { this.drafts = []; this.records = []; this.error = '工坊資料無法讀取；既有資料保留，請先匯出備份或使用分享碼'; }
  }
  private persist() { if (this.error.startsWith('工坊資料無法讀取')) return false; try { this.storage?.setItem(WORKSHOP_STORAGE, JSON.stringify({ v: 1, drafts: this.drafts, records: this.records })); this.error = this.storage ? '' : '儲存空間無法使用，這次草稿與成績只保留在本頁'; return !!this.storage; } catch { this.error = '儲存失敗，這次草稿與成績只保留在本頁；請複製分享碼備份'; return false; } }
  save(def: WorkshopDefinition) { const row = parseWorkshop(def); if (!row) throw Error('草稿設定無效'); const code = encodeWorkshop(row); this.drafts = [row, ...this.drafts.filter(d => encodeWorkshop(d) !== code)].slice(0, 24); return this.persist(); }
  duplicate(index: number) { const source = this.drafts[index]; if (!source) throw Error('草稿不存在'); if (this.drafts.length >= 24) throw Error('草稿已達24份，請先刪除不需要的草稿再複製'); let name = ''; for (let i = 1; i <= 24; i++) { const suffix = ` 副本${i}`; name = source.name.slice(0, 36 - suffix.length) + suffix; if (!this.drafts.some(d => d.name === name)) break; } const copy = { ...source, nodes: [...source.nodes], name }; this.save(copy); return copy; }
  remove(index: number) { if (!Number.isInteger(index) || index < 0 || index >= this.drafts.length) return; this.drafts.splice(index, 1); this.persist(); }
  best(def: WorkshopDefinition) { const row = this.records.find(r => r.code === workshopKey(def)); return row ? { ...row, ...(row.segments ? { segments: [...row.segments] } : {}) } : null; }
  record(def: WorkshopDefinition, result: WorkshopResult) { if (!result.success || !finite(result.elapsed) || result.elapsed <= 0 || result.elapsed > def.seconds || !Number.isInteger(result.hits) || result.hits < 0 || result.hits > def.hits) return false; const code = workshopKey(def), old = this.records.find(r => r.code === code); let advanced = {};
    if (def.v === 2) { const laps = result.lapTimes, segments = result.segments; if (!laps || !segments || laps.length !== def.laps || segments.length !== def.laps || laps.some(n => !finite(n) || n <= 0) || Math.abs(laps.reduce((a, b) => a + b, 0) - result.elapsed) > .001 || segments.some((row, i) => row.length !== def.splits.length + 1 || row.some(n => !finite(n) || n <= 0) || Math.abs(row.reduce((a, b) => a + b, 0) - laps[i]) > .001)) return false; advanced = { bestLap: Math.min(old?.bestLap ?? Infinity, ...laps), segments: Array.from({ length: def.splits.length + 1 }, (_, i) => Math.min(old?.segments?.[i] ?? Infinity, ...segments.map(row => row[i]))) }; }
    this.records = [{ code, best: Math.min(old?.best ?? Infinity, result.elapsed), wins: Math.min(1e7, (old?.wins ?? 0) + 1), ...advanced }, ...this.records.filter(r => r.code !== code)].slice(0, 80); this.persist(); return true; }
}
