import { DriftScore, type DriftMedal } from './drift';
import type { FreeCar } from './freecar';
import { randomUuid } from './identity';

export interface CityPoint { x: number; z: number; y: number }
export interface CargoStop extends CityPoint { id: string; name: string }
export interface CityCar extends CityPoint { vx: number; vz: number; h: number; slip: number }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pointOK = (p: CityPoint) => !!p && finite(p.x) && finite(p.z) && finite(p.y) && Math.abs(p.x) <= 20000 && Math.abs(p.z) <= 20000 && Math.abs(p.y) <= 2000;
const textOK = (s: unknown, max = 100): s is string => typeof s === 'string' && s.length > 0 && s.length <= max && !/[<>\u0000-\u001f]/u.test(s);
const distance = (a: CityPoint, b: CityPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const sameLevel = (a: CityPoint, b: CityPoint) => Math.abs(a.y - b.y) <= 2;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const CARGO_TTL = 7 * 24 * 3600 * 1000;
export interface CargoCheckpoint {
  v: 1; id: string; carId: string; stops: CargoStop[]; next: number; integrity: number;
  remaining: number; limit: number; distance: number; savedAt: number; position: CityPoint & { h: number };
}
export interface CargoResult { id: string; status: 'delivered' | 'timeout' | 'broken' | 'invalid'; delivered: number; total: number; integrity: number; reward: number }
export const cargoTimeBudget = (distanceM: number, count: number) => Math.ceil(distanceM / 9 + count * 18 + 45);
export function cargoReward(distanceM: number, count: number, integrity: number, remaining: number, limit: number) {
  return Math.max(0, Math.floor((count * 100 + distanceM * .06) * Math.max(0, integrity) / 100 + Math.max(0, remaining) / Math.max(1, limit) * 120));
}
export function parseCargoSettled(raw: unknown): string[] | null {
  return Array.isArray(raw) && raw.length <= 128 && new Set(raw).size === raw.length && raw.every(s => textOK(s, 160)) ? [...raw] : null;
}
export function parseCargoCheckpoint(raw: unknown, now = Date.now(), allowExpired = false): CargoCheckpoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as CargoCheckpoint;
  if (r.v !== 1 || !textOK(r.id, 160) || !textOK(r.carId, 80) || !Array.isArray(r.stops) || r.stops.length < 3 || r.stops.length > 5
    || new Set(r.stops.map(s => s?.id)).size !== r.stops.length || r.stops.some(s => !pointOK(s) || !textOK(s.id) || !textOK(s.name))
    || !Number.isInteger(r.next) || r.next < 0 || r.next >= r.stops.length || !finite(r.integrity) || r.integrity <= 0 || r.integrity > 100
    || !finite(r.remaining) || !finite(r.limit) || r.remaining <= 0 || r.limit < 30 || r.limit > 7200 || r.remaining > r.limit
    || !finite(r.distance) || r.distance < 50 || r.distance > 100000 || !Number.isSafeInteger(r.savedAt) || r.savedAt < 0 || r.savedAt > now + 60000 || !allowExpired && now - r.savedAt > CARGO_TTL
    || !pointOK(r.position) || !finite(r.position.h) || Math.abs(r.position.h) > 1000) return null;
  return copy({ v: 1, id: r.id, carId: r.carId, stops: r.stops.map(s => ({ id: s.id, name: s.name, x: s.x, z: s.z, y: s.y })), next: r.next,
    integrity: r.integrity, remaining: r.remaining, limit: r.limit, distance: r.distance, savedAt: r.savedAt,
    position: { x: r.position.x, z: r.position.z, y: r.position.y, h: r.position.h } });
}
/** Simulation-time delivery: pause/map/offline do not consume time. Completion itself never changes a wallet. */
export class FragileCargo {
  private state: CargoCheckpoint | null = null;
  private last: CityPoint | null = null;
  private speed = 0;
  private wait = 0;
  private hitCooldown = 0;
  result: CargoResult | null = null;
  get active() { return this.state !== null; }
  get progress() { const r = this.state; return r ? { next: r.next, total: r.stops.length, integrity: r.integrity, remaining: r.remaining, target: { ...r.stops[r.next] }, wait: this.wait } : null; }
  start(stops: CargoStop[], carId: string, distanceM: number, position: CityPoint & { h: number }, now = Date.now()) {
    const limit = cargoTimeBudget(distanceM, stops.length);
    const state = parseCargoCheckpoint({ v: 1, id: randomUuid(), carId, stops, next: 0, integrity: 100, remaining: limit, limit, distance: distanceM, savedAt: now, position }, now);
    if (!state) return false;
    this.adopt(state); return true;
  }
  restore(raw: unknown, catalog: CargoStop[], settled: string[], now = Date.now()) {
    const state = parseCargoCheckpoint(raw, now);
    if (!state || settled.includes(state.id) || state.stops.some(s => !catalog.some(c => c.id === s.id && c.name === s.name && distance(c, s) < .01 && Math.abs(c.y - s.y) < .01))) return false;
    this.adopt(state); return true;
  }
  private adopt(state: CargoCheckpoint) { this.state = state; this.last = { ...state.position }; this.speed = this.wait = this.hitCooldown = 0; this.result = null; }
  checkpoint(position: CityPoint & { h: number }, now = Date.now()) {
    if (!this.state || !pointOK(position) || !finite(position.h)) return null;
    return parseCargoCheckpoint({ ...this.state, savedAt: now, position: { x: position.x, z: position.z, y: position.y, h: position.h } }, now);
  }
  cancel() { this.state = null; this.last = null; this.result = null; this.wait = 0; }
  private finish(status: CargoResult['status']) {
    const r = this.state!;
    this.result = { id: r.id, status, delivered: r.next, total: r.stops.length, integrity: r.integrity,
      reward: status === 'delivered' ? cargoReward(r.distance, r.stops.length, r.integrity, r.remaining, r.limit) : 0 };
    this.state = null; return { finished: this.result };
  }
  update(dt: number, car: CityCar, impact: number): { finished?: CargoResult; delivered?: number } {
    const r = this.state; if (!r || !finite(dt) || dt <= 0 || dt > .25) return {};
    if (!pointOK(car) || !finite(car.vx) || !finite(car.vz) || !finite(impact) || impact < 0) return this.finish('invalid');
    // Explicit teleports cannot deliver cargo or avoid its damage model.
    if (this.last && distance(this.last, car) > 100 * dt + 2) return this.finish('invalid');
    const speed = Math.hypot(car.vx, car.vz), decel = (this.speed - speed) / dt;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (impact > 3 && this.hitCooldown <= 0) { r.integrity -= Math.min(55, (impact - 3) * 2.2); this.hitCooldown = .7; }
    if (decel > 6 && this.speed > 8) r.integrity -= Math.min(25, (decel - 6) * dt * 1.1);
    r.integrity = Math.max(0, r.integrity); r.remaining = Math.max(0, r.remaining - dt); this.speed = speed; this.last = { ...car };
    if (r.integrity <= 0) return this.finish('broken');
    if (r.remaining <= 0) return this.finish('timeout');
    const target = r.stops[r.next];
    this.wait = distance(car, target) <= 10 && sameLevel(car, target) && speed < 1 ? this.wait + dt : 0;
    if (this.wait >= .8) { r.next++; this.wait = 0; if (r.next === r.stops.length) return this.finish('delivered'); return { delivered: r.next }; }
    return {};
  }
}

export interface RouteDriftRoute { id: string; title: string; points: CityPoint[] }
export interface RouteDriftRecord { score: number; medal: DriftMedal; completion: number }
export type RouteDriftRecords = Record<string, RouteDriftRecord>;
export interface RouteDriftResult extends RouteDriftRecord { key: string; reason: 'complete' | 'timeout' | 'invalid'; maxChain: number; apexScore: number }
export function routeDriftKey(routeId: string, carId: string) { return `route-drift-v1:${encodeURIComponent(routeId)}:${encodeURIComponent(carId)}`; }
export function parseRouteDriftRecords(raw: unknown): RouteDriftRecords | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 500) return null;
  const out: RouteDriftRecords = {};
  for (const [k, value] of Object.entries(raw)) {
    const v = value as RouteDriftRecord;
    if (!/^route-drift-v1:[^:]{1,160}:[^:]{1,160}$/.test(k) || !v || !Number.isSafeInteger(v.score) || v.score < 0 || v.score > 1e9 || !['none', 'bronze', 'silver', 'gold'].includes(v.medal)
      || !finite(v.completion) || v.completion < 0 || v.completion > 1) return null;
    out[k] = { score: v.score, medal: v.medal, completion: v.completion };
  }
  return out;
}
/** Ordered 15m gates plus local corridor checks. Owns the shared scorer while active. */
export class RouteDrift {
  active = false; next = 1; score = 0; remaining = 0; maxChain = 0; apexScore = 0; inZone = false;
  route: RouteDriftRoute | null = null; result: RouteDriftResult | null = null;
  private last: CityPoint | null = null;
  private carId = '';
  private cumulative: number[] = [];
  constructor(private scorer: DriftScore) {}
  start(route: RouteDriftRoute, carId: string) {
    if (!textOK(route.id, 80) || !textOK(carId, 80) || route.points.length < 3 || route.points.length > 5000 || route.points.some(p => !pointOK(p))) return false;
    const cumulative = [0];
    for (let i = 1; i < route.points.length; i++) { const length = distance(route.points[i - 1], route.points[i]); if (length < .01 || length > 30) return false; cumulative.push(cumulative.at(-1)! + length); }
    if (cumulative.at(-1)! < 30) return false;
    this.route = copy(route); this.carId = carId; this.next = 1; this.score = this.maxChain = this.apexScore = 0; this.last = { ...route.points[0] }; this.result = null;
    this.cumulative = cumulative;
    this.remaining = Math.min(900, Math.max(90, this.cumulative.at(-1)! / 7 + 45)); this.active = true; this.scorer.reset(); return true;
  }
  get completion() { return this.route ? this.cumulative[Math.min(this.next - 1, this.cumulative.length - 1)] / this.cumulative.at(-1)! : 0; }
  get target() { return this.active ? this.route!.points[this.next] : null; }
  cancel() { this.active = false; this.inZone = false; this.result = null; this.scorer.reset(); }
  private finish(reason: RouteDriftResult['reason']) {
    const score = reason === 'invalid' ? 0 : Math.round(this.score), completion = reason === 'complete' ? 1 : this.completion;
    const length = this.cumulative.at(-1)!, gold = Math.max(3000, length * 12);
    const medal: DriftMedal = completion < 1 ? 'none' : score >= gold ? 'gold' : score >= gold / 2 ? 'silver' : score >= gold / 6 ? 'bronze' : 'none';
    this.result = { key: routeDriftKey(this.route!.id, this.carId), score, completion, medal, reason, maxChain: this.maxChain, apexScore: this.apexScore };
    this.active = false; this.inZone = false; this.scorer.reset(); return { finished: this.result };
  }
  update(dt: number, car: CityCar, impact: number): { banked?: number; lost?: boolean; finished?: RouteDriftResult } {
    if (!this.active || !finite(dt) || dt <= 0 || dt > .25) return {};
    if (!pointOK(car) || !finite(car.vx) || !finite(car.vz) || !finite(car.slip) || !finite(impact) || !this.last || distance(this.last, car) > 100 * dt + 2) return this.finish('invalid');
    const points = this.route!.points, a = points[this.next - 1], b = points[this.next], dx = b.x - a.x, dz = b.z - a.z, ll = dx * dx + dz * dz;
    const t = ll > .01 ? ((car.x - a.x) * dx + (car.z - a.z) * dz) / ll : 0;
    const clamped = Math.max(0, Math.min(1, t)), px = a.x + dx * clamped, pz = a.z + dz * clamped;
    const off = Math.hypot(car.x - px, car.z - pz), forward = (car.x - this.last.x) * dx + (car.z - this.last.z) * dz;
    // A gate is accepted inside its 8m approach. The next corridor must include
    // that same overlap, otherwise every valid gate would cancel the chain.
    this.inZone = off <= 9 && t >= -.6 && t <= 1.4 && Math.abs(car.y - a.y - (b.y - a.y) * clamped) <= 2 && forward >= -.005;
    this.remaining = Math.max(0, this.remaining - dt); this.last = { ...car };
    if (!this.inZone) { this.scorer.finish('cancel'); if (this.remaining <= 0) return this.finish('timeout'); return {}; }
    const event = this.scorer.update(dt, car as FreeCar, impact);
    this.maxChain = Math.max(this.maxChain, this.scorer.total);
    if (event.banked) this.score += event.banked;
    const c = points[this.next + 1];
    if (c && this.scorer.qualifying && impact <= 5 && off >= 2 && off <= 7) {
      const turn = Math.abs(Math.atan2(dx * (c.z - b.z) - dz * (c.x - b.x), dx * (c.x - b.x) + dz * (c.z - b.z)));
      if (turn > .12) { const bonus = dt * Math.hypot(car.vx, car.vz) * 4; this.apexScore += bonus; this.score += bonus; }
    }
    if (distance(car, b) < 8 && sameLevel(car, b) && forward > 0) {
      this.next++; if (this.next >= points.length) { const bank = this.scorer.finish('bank'); this.score = Math.round(this.score + (bank.banked ?? 0)); this.apexScore = Math.round(this.apexScore); return this.finish('complete'); }
    }
    if (this.remaining <= 0) { this.score = Math.round(this.score); return this.finish('timeout'); }
    return event;
  }
}
