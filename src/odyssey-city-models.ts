/** Single-player duty helpers. No clocks, storage, random calls or vehicle placement. */
export type DutyEnvironment = 'closed' | 'road';
export interface DockPose { x: number; z: number; y: number; h: number }
export function dockingReadout(car: DockPose & { vx: number; vz: number }, target: DockPose, dwell: number, routeComplete: boolean, kind: 'bus' | 'rescue') {
  const dx = car.x - target.x, dz = car.z - target.z;
  const distance = Math.hypot(dx, dz), lateral = dx * Math.cos(target.h) - dz * Math.sin(target.h), longitudinal = dx * Math.sin(target.h) + dz * Math.cos(target.h);
  const angle = Math.atan2(Math.sin(car.h - target.h), Math.cos(car.h - target.h));
  const speed = Math.hypot(car.vx, car.vz), level = Math.abs(car.y - target.y) < 1;
  return { visible: distance <= 25, distance, lateral, longitudinal, angle, speed, level, routeComplete, dwell: Math.min(1.5, Math.max(0, dwell)), radius: kind === 'bus' ? 5 : 2.5, angleLimit: kind === 'bus' ? .35 : .18 };
}
export const DUTY_LOSS_LABELS = { 'harsh-motion': '急加減速／平順', collision: '碰撞／平順', 'arrival-time': '到站早晚／準點', 'cargo-motion': '急加減速／完整度', 'cargo-collision': '碰撞／完整度', 'red-light': '闖紅燈／道路分' } as const;
export type DutyLossReason = keyof typeof DUTY_LOSS_LABELS;
export interface DutyLoss { reason: DutyLossReason; points: number }
export interface DutyDetailItem { name: string; stage: string; startedAt: number; endedAt: number; impacts: number; integrityLost: number; losses: DutyLoss[]; arrival?: { actual: number; due: number; delta: number } }
export interface DutyDetails { v: 1; environment: DutyEnvironment; items: DutyDetailItem[]; redLights: number; roadPenalty: number; winch?: { seconds: number; corrections: number } }
const finite = (v: unknown, min = 0, max = 7200): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(key => keys.includes(key));
/** Optional extension: old v1 duty records remain readable, malformed new details never silently disappear. */
export function parseDutyDetails(value: unknown): DutyDetails | null {
  if (!object(value) || !only(value, ['v', 'environment', 'items', 'redLights', 'roadPenalty', 'winch']) || value.v !== 1 || !['closed', 'road'].includes(String(value.environment)) || !Array.isArray(value.items) || value.items.length > 32 || !Number.isSafeInteger(value.redLights) || !finite(value.redLights, 0, 10000) || !finite(value.roadPenalty, 0, 100) || (value.environment === 'closed' && (value.redLights !== 0 || value.roadPenalty !== 0))) return null;
  const items: DutyDetailItem[] = []; let previous = 0;
  for (const item of value.items) {
    if (!object(item) || !only(item, ['name', 'stage', 'startedAt', 'endedAt', 'impacts', 'integrityLost', 'losses', 'arrival']) || !text(item.name, 100) || !Object.hasOwn(DUTY_STAGE_LABELS, String(item.stage)) || !finite(item.startedAt) || !finite(item.endedAt) || item.endedAt < item.startedAt || item.startedAt < previous - .000001 || !Number.isSafeInteger(item.impacts) || !finite(item.impacts, 0, 100000) || !finite(item.integrityLost, 0, 100) || !Array.isArray(item.losses) || item.losses.length > 6) return null;
    const losses: DutyLoss[] = [], seen = new Set();
    for (const loss of item.losses) { if (!object(loss) || !only(loss, ['reason', 'points']) || !Object.hasOwn(DUTY_LOSS_LABELS, String(loss.reason)) || seen.has(loss.reason) || !finite(loss.points, 0, 100)) return null; seen.add(loss.reason); losses.push({ reason: loss.reason as DutyLossReason, points: loss.points }); }
    let arrival: DutyDetailItem['arrival'];
    if (item.arrival !== undefined) { const a = item.arrival; if (!object(a) || !only(a, ['actual', 'due', 'delta']) || !finite(a.actual) || !finite(a.due) || !finite(a.delta, -7200, 7200) || Math.abs(a.actual - a.due - a.delta) > .000001) return null; arrival = { actual: a.actual, due: a.due, delta: a.delta }; }
    items.push({ name: item.name, stage: String(item.stage), startedAt: item.startedAt, endedAt: item.endedAt, impacts: item.impacts, integrityLost: item.integrityLost, losses, ...(arrival ? { arrival } : {}) }); previous = item.endedAt;
  }
  let winch: DutyDetails['winch'];
  if (value.winch !== undefined) { const w = value.winch; if (!object(w) || !only(w, ['seconds', 'corrections']) || !finite(w.seconds) || !Number.isSafeInteger(w.corrections) || !finite(w.corrections, 0, 10000)) return null; winch = { seconds: w.seconds, corrections: w.corrections }; }
  return { v: 1, environment: value.environment as DutyEnvironment, items, redLights: value.redLights as number, roadPenalty: value.roadPenalty, ...(winch ? { winch } : {}) };
}
export const DUTY_STAGE_LABELS: Record<string, string> = { approach: '前往現場', warning: '設置警示', positioning: '平台定位', winch: '絞盤裝載', securing: '車輛固定', returning: '滿載返回', unloading: '卸載交付', stop: '公車站務' };
/** Simplified platform coordinates; only deliberate input moves the disabled vehicle. */
export class DutyWinch {
  along = 0; lateral = .85; elapsed = 0; corrections = 0; blocked = false; confirmed = false;
  readonly length = 4.2; readonly width = .35;
  private previousSide = 0;
  get aligned() { return Math.abs(this.lateral) <= this.width; }
  get ready() { return this.along >= this.length - .01 && this.aligned; }
  update(dt: number, pull: number, side: number) {
    if (this.confirmed || !finite(dt, .000001, .1) || !finite(pull, -1, 1) || !finite(side, -1, 1)) return;
    this.elapsed += dt;
    if (Math.abs(side) > .1 && Math.sign(side) !== this.previousSide) { this.corrections++; this.previousSide = Math.sign(side); }
    this.lateral = Math.max(-1.4, Math.min(1.4, this.lateral + side * .32 * dt));
    this.blocked = pull > 0 && !this.aligned;
    if (!this.blocked) this.along = Math.max(0, Math.min(this.length, this.along + pull * .48 * dt));
  }
  confirm() { if (!this.ready || this.confirmed) return false; this.confirmed = true; return true; }
}
/** One penalty per junction encounter. Stopping inside the approach does not count as a crossing. */
export class DutyRoadRules {
  redLights = 0; penalty = 0; private junction: object | null = null; private entered = false;
  sample(signal: { id: object; red: boolean } | null, speed: number) {
    if (!signal) { this.junction = null; this.entered = false; return false; }
    if (signal.id !== this.junction) { this.junction = signal.id; this.entered = false; }
    if (!Number.isFinite(speed) || speed < 1.5 || this.entered) return false;
    this.entered = true;
    if (!signal.red) return false;
    this.redLights++; this.penalty = Math.min(100, this.penalty + 8); return true;
  }
}
