import { FreeCar, type CarSpec, type FreeCarGeometry } from './freecar';
import type { Router } from './router';
import { dockingReadout, DutyWinch, DutyRoadRules, parseDutyDetails, DUTY_STAGE_LABELS, type DutyDetails, type DutyDetailItem, type DutyLossReason } from './odyssey-city-models';

export type DutyKind = 'bus' | 'rescue';
export interface DutyPose { x: number; z: number; y: number; h: number }
export interface DutyStop extends DutyPose { name: string }
export interface DutyLeg { path: [number, number][]; ys: number[]; length: number; target: DutyStop; dueSeconds?: number }
export interface DutyPlan { kind: DutyKind; name: string; start: DutyPose; legs: DutyLeg[]; length: number; estimatedSeconds: number; environment?: 'road'; winch?: true; passengers?: { routeId: string; capacity: number; initial: number; requests: { board: number; alight: number }[] }; rescue?: { id: string; difficulty: string }; accessibility?: { wheelchairBoard: number; wheelchairAlight: number }[] }
export const BUS_ROUTES = [
  { id: 'south', name: '南城接駁線', stops: [0, 3, 0], demand: [{ board: 28, alight: 4 }, { board: 0, alight: 100 }] },
  { id: 'north', name: '信義—基隆直達線', stops: [0, 1, 0], demand: [{ board: 18, alight: 8 }, { board: 0, alight: 100 }] },
  { id: 'loop', name: '信義—基隆—市民環線', stops: [0, 1, 2, 0], demand: [{ board: 28, alight: 4 }, { board: 17, alight: 14 }, { board: 0, alight: 100 }] },
] as const;
export const BUS_SPEC: CarSpec = { engine: 3.8, vmax: 22, brake: 9, grip: 7, mass: 8 };
export const BUS_GEOMETRY: FreeCarGeometry = { wheelbase: 6.1, inertia: 11, radius: 1.27, offsets: [4.5, 2.25, 0, -2.25, -4.5], halfWidth: 1.15, surfaceSpan: 3.05 };
export const RESCUE_SPEC: CarSpec = { engine: 4.4, vmax: 25, brake: 10, grip: 8, mass: 4.5 };
export const RESCUE_LOADED_SPEC: CarSpec = { engine: 3.1, vmax: 20, brake: 7.8, grip: 6.8, mass: 7.2 };
export const RESCUE_CASES = [
  { id: 'south-assist', name: '信安街熄火救援', point: 3, difficulty: '初階 · 南向往返' },
  { id: 'north-breakdown', name: '基隆路故障回送', point: 1, difficulty: '標準 · 長距離轉向' },
  { id: 'market-recovery', name: '市民大道車輛回收', point: 2, difficulty: '進階 · 多路口往返' },
] as const;
export const RESCUE_GEOMETRY: FreeCarGeometry = { wheelbase: 4.5, inertia: 7.5, radius: 1.18, offsets: [2.7, 1.35, 0, -1.35, -2.7], halfWidth: 1.05, surfaceSpan: 2.25 };
// Fixed real road points from nexus-coop-city.json. Stop headings come from each actual incoming road.
const POINTS = [
  { x: 467.12, z: 515.8, y: -.25, name: '信義路勤務站' },
  { x: 595.94, z: -1066.54, y: -.25, name: '基隆路一段站' },
  { x: -474.26, z: -819.51, y: -.25, name: '市民大道四段站' },
  { x: -153.99, z: 1283.8, y: -.25, name: '信安街勤務站' },
];
const wrap = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
export function buildDutyPlan(router: Router, kind: DutyKind, routeId = 'practice', accessible = false, options: { road?: boolean; winch?: boolean } = {}): DutyPlan | null {
  const service = kind === 'bus' && routeId !== 'practice' ? BUS_ROUTES.find(r => r.id === routeId) : undefined;
  const rescue = kind === 'rescue' && routeId !== 'practice' ? RESCUE_CASES.find(r => r.id === routeId) : undefined;
  if (kind === 'rescue' && routeId !== 'practice' && !rescue) return null;
  if (kind === 'bus' && routeId !== 'practice' && !service) return null;
  if (options.road && (kind !== 'bus' || service?.id !== 'south')) return null;
  if (options.winch && (kind !== 'rescue' || rescue?.id !== 'south-assist')) return null;
  const itinerary = service?.stops ?? (kind === 'bus' ? [0, 1, 2, 0] : [0, rescue?.point ?? 3, 0]);
  const legs: DutyLeg[] = [];
  for (let i = 1; i < itinerary.length; i++) {
    const a = POINTS[itinerary[i - 1]], b = POINTS[itinerary[i]];
    const r = router.routeWithPreference('shortest', a.x, a.z, b.x, b.z, a.y, b.y);
    if (!r || r.path.length < 2) return null;
    const p = r.path.at(-1)!, prev = r.path.at(-2)!;
    const target: DutyStop = { x: p[0], z: p[1], y: r.ys.at(-1)! - .25, h: Math.atan2(p[0] - prev[0], p[1] - prev[1]), name: b.name };
    legs.push({ path: r.path, ys: r.ys, length: r.length, target });
  }
  const first = legs[0].path, p = first[0], next = first.find(q => Math.hypot(q[0] - p[0], q[1] - p[1]) > 1)!;
  const length = legs.reduce((n, leg) => n + leg.length, 0);
  const plan: DutyPlan = { kind, name: service?.name ?? (kind === 'bus' ? '信義—基隆—市民勤務線' : '信安街平板道路救援'), start: { x: p[0], z: p[1], y: legs[0].ys[0] - .25, h: Math.atan2(next[0] - p[0], next[1] - p[1]) }, legs, length, estimatedSeconds: Math.ceil(length / (kind === 'bus' ? 7.5 : 8.3) + (kind === 'bus' ? legs.length * 20 : 12)) };
  if (service) {
    plan.passengers = { routeId: service.id, capacity: 32, initial: 12, requests: service.demand.map(r => ({ ...r })) };
    let due = 0, onboard = 12;
    legs.forEach((leg, i) => { due += leg.length / 7.5; leg.dueSeconds = Math.ceil(due); const exchange = busExchange(onboard, 32, plan.passengers!.requests[i]); onboard = exchange.onboard; due += exchange.seconds + 1.5; });
    plan.estimatedSeconds = Math.ceil(due);
  }
  if (rescue) { plan.name = rescue.name; plan.rescue = { id: rescue.id, difficulty: rescue.difficulty }; plan.estimatedSeconds += 8; }
  if (accessible && service?.id === 'south') {
    plan.name += ' · 無障礙服務'; plan.accessibility = [{ wheelchairBoard: 1, wheelchairAlight: 0 }, { wheelchairBoard: 0, wheelchairAlight: 1 }];
    // The wheelchair passenger is included in the existing demand and capacity.
    let extra = 0; for (const leg of plan.legs) { leg.dueSeconds = (leg.dueSeconds ?? 0) + extra; extra += 10; } plan.estimatedSeconds += extra;
  }
  if (options.road) { plan.environment = 'road'; plan.name += ' · 一般道路'; let allowance = 0; for (const leg of plan.legs) { allowance += Math.ceil(leg.length / 300) * 12 + 30; leg.dueSeconds = (leg.dueSeconds ?? 0) + allowance; } plan.estimatedSeconds += allowance; }
  if (options.winch) { plan.winch = true; plan.name += ' · 絞盤裝載'; plan.estimatedSeconds += 20; }
  return plan;
}
export interface DutyRecord { id: string; kind: DutyKind; name: string; seconds: number; score: number; stops: number; impacts: number; integrity: number; at: number; service?: { routeId: string; boarded: number; alighted: number; leftBehind: number }; rescue?: { caseId: string; secured: true }; accessibility?: { wheelchairBoarded: number; wheelchairAlighted: number; bells: number }; details?: DutyDetails }
/** Passenger counts are deterministic requests, not individual pedestrian agents. */
export function busExchange(onboard: number, capacity: number, request: { board: number; alight: number }) { if (![onboard, capacity, request.board, request.alight].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000) || capacity < 1 || onboard > capacity) throw Error('乘客需求或容量無效'); const alighted = Math.min(onboard, request.alight), boarded = Math.min(capacity - onboard + alighted, request.board); return { alighted, boarded, leftBehind: request.board - boarded, onboard: onboard - alighted + boarded, seconds: Math.max(5, 2 + alighted * .6 + boarded * .8) }; }
export const DUTY_STORAGE_KEY = 'taipei-gp-summit-duty-v1';
export const DUTY_ROAD_STORAGE_KEY = 'taipei-gp-odyssey-road-duty-v1';
export const DUTY_IMPORT_MAX_BYTES = 1000000;
export function parseDutyRecords(value: unknown): DutyRecord[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const ids = new Set<string>(); const out: DutyRecord[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !/^[a-z0-9-]{8,80}$/.test(v.id) || ids.has(v.id) || !['bus', 'rescue'].includes(v.kind) || typeof v.name !== 'string' || v.name.length > 80 || !Number.isFinite(v.seconds) || v.seconds < 0 || v.seconds > 7200 || !Number.isInteger(v.score) || v.score < 0 || v.score > 100 || !Number.isInteger(v.stops) || v.stops < 0 || v.stops > 10 || !Number.isInteger(v.impacts) || v.impacts < 0 || v.impacts > 100000 || !Number.isFinite(v.integrity) || v.integrity < 0 || v.integrity > 100 || !Number.isFinite(v.at) || v.at < 0) return null;
    if (v.service !== undefined && (v.kind !== 'bus' || !v.service || typeof v.service !== 'object' || Object.keys(v.service).sort().join(',') !== 'alighted,boarded,leftBehind,routeId' || !BUS_ROUTES.some(r => r.id === v.service.routeId) || ![v.service.boarded, v.service.alighted, v.service.leftBehind].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000))) return null;
    if (v.rescue !== undefined && (v.kind !== 'rescue' || !v.rescue || typeof v.rescue !== 'object' || Object.keys(v.rescue).sort().join(',') !== 'caseId,secured' || v.rescue.secured !== true || !RESCUE_CASES.some(r => r.id === v.rescue.caseId))) return null;
    if (v.accessibility !== undefined && (v.kind !== 'bus' || v.service?.routeId !== 'south' || !v.accessibility || typeof v.accessibility !== 'object' || Object.keys(v.accessibility).sort().join(',') !== 'bells,wheelchairAlighted,wheelchairBoarded' || ![v.accessibility.wheelchairBoarded,v.accessibility.wheelchairAlighted,v.accessibility.bells].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2) || v.accessibility.wheelchairBoarded !== v.accessibility.wheelchairAlighted)) return null;
    const details = v.details === undefined ? undefined : parseDutyDetails(v.details); if (details === null || details?.environment === 'road' && (v.kind !== 'bus' || v.service?.routeId !== 'south') || details?.winch && (v.kind !== 'rescue' || v.rescue?.caseId !== 'south-assist')) return null;
    ids.add(v.id); out.push({ id: v.id, kind: v.kind, name: v.name, seconds: v.seconds, score: v.score, stops: v.stops, impacts: v.impacts, integrity: v.integrity, at: v.at, ...(v.service ? { service: { ...v.service } } : {}), ...(v.rescue ? { rescue: { ...v.rescue } } : {}), ...(v.accessibility ? { accessibility: { ...v.accessibility } } : {}), ...(details ? { details } : {}) });
  }
  return out;
}
export function exportDutyRecords(records: DutyRecord[]) { return JSON.stringify({ v: 1, type: 'taipei-duty-records', records }, null, 2); }
export function parseRoadDutyRecords(value: unknown): DutyRecord[] | null { const records = parseDutyRecords(value); return records && records.every(record => record.kind === 'bus' && record.service?.routeId === 'south' && record.details?.environment === 'road') ? records : null; }
export function importDutyRecords(text: string): DutyRecord[] | null { if (text.length > DUTY_IMPORT_MAX_BYTES) return null; try { const v = JSON.parse(text); return v?.v === 1 && v.type === 'taipei-duty-records' ? parseDutyRecords(v.records) : null; } catch { return null; } }
interface Gate { x: number; z: number; y: number }
function gates(leg: DutyLeg) {
  const out: Gate[] = []; let leftover = 0;
  for (let i = 1; i < leg.path.length; i++) {
    const a = leg.path[i - 1], b = leg.path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < .001) continue;
    for (let d = 18 - leftover; d <= len; d += 18) { const t = d / len; out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, y: leg.ys[i - 1] * (1 - t) + leg.ys[i] * t - .25 }); }
    leftover = (leftover + len) % 18;
  }
  out.push({ x: leg.target.x, z: leg.target.z, y: leg.target.y }); return out;
}
/** Single-player duty state only. Motion always comes from the same real FreeCar/collider as city driving. */
export class CityDutyRun {
  phase: 'driving' | 'doors' | 'loading' | 'complete' | 'failed' = 'driving';
  elapsed = 0; legIndex = 0; gateIndex = 0; stops = 0; impacts = 0; comfort = 100; punctuality = 100; integrity = 100; dwell = 0; operationTime = 0; doorOpen = false; loaded = false; message = '';
  onboard = 0; boarded = 0; alighted = 0; leftBehind = 0;
  rescueStage: 'approach' | 'warning' | 'positioning' | 'winch' | 'securing' | 'returning' | 'unloading' = 'approach';
  ramp: 'stowed' | 'deploying' | 'deployed' | 'retracting' = 'stowed'; rampTime = 0; wheelchairOnboard = 0; wheelchairBoarded = 0; wheelchairAlighted = 0; bellSequence = 0; bellText = ''; private bellLeg = -1;
  private exchange: ReturnType<typeof busExchange> | null = null;
  private routeGates: Gate[]; private previous: DutyPose; private previousSpeed = 0; private scoredArrival = false; private recorded = false;
  readonly roadRules = new DutyRoadRules(); winch: DutyWinch | null = null;
  private detailItems: DutyDetailItem[] = []; private detail: DutyDetailItem | null = null; private detailIntegrity = 100; private detailImpacts = 0;
  constructor(public readonly plan: DutyPlan, public readonly car: FreeCar) { this.previous = { ...plan.start }; this.routeGates = gates(plan.legs[0]); this.onboard = plan.passengers?.initial ?? 0; this.boarded = this.onboard; this.beginDetail(plan.kind === 'bus' ? 'stop' : 'approach'); }
  get leg() { return this.plan.legs[this.legIndex]; }
  get finished() { return this.phase === 'complete' || this.phase === 'failed'; }
  get locked() { return this.doorOpen || this.ramp !== 'stowed' || this.phase === 'loading' || this.rescueStage === 'winch' || this.finished; }
  get docking() { return dockingReadout(this.car, this.leg.target, this.dwell, this.gateIndex >= this.routeGates.length, this.plan.kind); }
  get breakdown(): DutyDetails { return { v: 1, environment: this.plan.environment ?? 'closed', items: this.detailItems.map(item => ({ ...item, losses: item.losses.map(loss => ({ ...loss })), ...(item.arrival ? { arrival: { ...item.arrival } } : {}) })), redLights: this.roadRules.redLights, roadPenalty: this.roadRules.penalty, ...(this.winch ? { winch: { seconds: this.winch.elapsed, corrections: this.winch.corrections } } : {}) }; }
  private beginDetail(stage: string) { this.detailIntegrity = this.integrity; this.detailImpacts = this.impacts; this.detail = { name: this.plan.kind === 'bus' ? this.leg.target.name : DUTY_STAGE_LABELS[stage], stage, startedAt: this.elapsed, endedAt: this.elapsed, impacts: 0, integrityLost: 0, losses: [] }; }
  private finishDetail() { if (!this.detail) return; this.detail.endedAt = this.elapsed; this.detail.impacts = this.impacts - this.detailImpacts; this.detail.integrityLost = Math.max(0, this.detailIntegrity - this.integrity); this.detailItems.push(this.detail); this.detail = null; }
  private changeStage(stage: CityDutyRun['rescueStage']) { this.finishDetail(); this.rescueStage = stage; this.beginDetail(stage); }
  private loss(reason: DutyLossReason, points: number) { if (!this.detail || points <= 0) return; const item = this.detail.losses.find(item => item.reason === reason); if (item) item.points = Math.min(100, item.points + points); else this.detail.losses.push({ reason, points: Math.min(100, points) }); }
  roadSample(signal: { id: object; red: boolean } | null) { if (this.plan.environment !== 'road' || this.finished) return; const before = this.roadRules.penalty; if (this.roadRules.sample(signal, Math.hypot(this.car.vx, this.car.vz))) { this.loss('red-light', this.roadRules.penalty - before); this.message = '進入紅燈路口，道路分扣8分；每次進入只記一次。'; } }
  operateWinch(dt: number, pull: number, side: number) { if (this.rescueStage !== 'winch' || this.finished || !this.winch) return; this.winch.update(dt, pull, side); this.message = this.winch.blocked ? '車輛偏出平台中心，先左右對準再收絞盤。' : this.winch.ready ? '故障車已入平台中心，請按「確認固定」才會進入固定作業。' : '油門收絞盤、煞車放絞盤、左右修正；或長按畫面操作鈕。'; }
  get ready() {
    const t = this.leg.target, c = this.car;
    return this.gateIndex >= this.routeGates.length && Math.hypot(c.x - t.x, c.z - t.z) <= (this.plan.kind === 'bus' ? 5 : 2.5) && Math.abs(c.y - t.y) < 1 && Math.abs(wrap(c.h - t.h)) < (this.plan.kind === 'bus' ? .35 : .18) && Math.hypot(c.vx, c.vz) < .3 && this.dwell >= 1.5;
  }
  get next() { return this.routeGates[this.gateIndex] ?? this.leg.target; }
  get due() { return this.leg.dueSeconds ?? this.plan.legs.slice(0, this.legIndex + 1).reduce((n, l) => n + l.length / 7.5 + 20, 0); }
  get stopDemand() { return this.plan.passengers?.requests[this.legIndex] ?? null; }
  get operationRequired() { return this.exchange?.seconds ?? 5; }
  get passengerExchange() { return this.exchange && { ...this.exchange }; }
  get accessDemand() { return this.plan.accessibility?.[this.legIndex] ?? null; }
  get rampRequired() { return !!this.accessDemand && (this.accessDemand.wheelchairBoard > 0 || this.accessDemand.wheelchairAlight > 0); }
  get rescueOperationSeconds() { return this.rescueStage === 'warning' || this.rescueStage === 'positioning' ? 2 : 4; }
  fail(reason: string) { if (this.finished) return; this.phase = 'failed'; this.doorOpen = false; this.car.vx = this.car.vz = this.car.w = 0; this.message = reason; }
  update(dt: number, impact: number) {
    if (this.finished || !Number.isFinite(dt) || dt <= 0 || dt > .1) return;
    const c = this.car, distance = Math.hypot(c.x - this.previous.x, c.z - this.previous.z);
    if (![c.x, c.z, c.y, c.h, c.vx, c.vz, impact].every(Number.isFinite) || distance > (this.plan.kind === 'bus' ? 32 : 38) * dt + .45) { this.fail('位置或時間不連續，本次勤務不計成績。請重新接班。'); return; }
    this.elapsed += dt; if (this.elapsed > 3600) { this.fail('勤務超過60分鐘，請重新接班。'); return; }
    const speed = Math.hypot(c.vx, c.vz), acceleration = Math.abs(speed - this.previousSpeed) / dt;
    if (acceleration > 3) { const before = this.comfort; this.comfort = Math.max(0, this.comfort - Math.min(acceleration - 3, 12) * dt * .35); this.loss('harsh-motion', before - this.comfort); }
    if (this.loaded && acceleration > 4) { const before = this.integrity; this.integrity = Math.max(0, this.integrity - Math.min(acceleration - 4, 15) * dt * .3); this.loss('cargo-motion', before - this.integrity); }
    if (impact > 2) { this.impacts++; const before = this.comfort; this.comfort = Math.max(0, this.comfort - impact * 1.8); this.loss('collision', before - this.comfort); if (this.loaded) { const cargoBefore = this.integrity; this.integrity = Math.max(0, this.integrity - impact * 2); this.loss('cargo-collision', cargoBefore - this.integrity); } }
    if (this.integrity <= 0) { this.fail('故障車固定與完整度已耗盡，本次救援失敗。'); return; }
    while (this.gateIndex < this.routeGates.length) { const g = this.routeGates[this.gateIndex]; if (Math.hypot(c.x - g.x, c.z - g.z) > 10 || Math.abs(c.y - g.y) > 1.8) break; this.gateIndex++; }
    const t = this.leg.target, aligned = this.gateIndex >= this.routeGates.length && Math.hypot(c.x - t.x, c.z - t.z) <= (this.plan.kind === 'bus' ? 5 : 2.5) && Math.abs(c.y - t.y) < 1 && Math.abs(wrap(c.h - t.h)) < (this.plan.kind === 'bus' ? .35 : .18) && speed < .3;
    this.dwell = aligned ? this.dwell + dt : 0;
    if (this.plan.accessibility && this.bellLeg !== this.legIndex && this.routeGates.length - this.gateIndex <= 14 && (this.stopDemand?.alight ?? 0) > 0) { this.bellLeg = this.legIndex; this.bellSequence++; this.bellText = `叮咚｜下車鈴：下一站${t.name}，預計${Math.min(this.onboard, this.stopDemand!.alight)}人下車${this.accessDemand?.wheelchairBoard ? '，1位輪椅乘客候車' : this.accessDemand?.wheelchairAlight ? '，1位輪椅乘客下車' : ''}。`; }
    if (this.ramp === 'deploying' || this.ramp === 'retracting') { this.rampTime += dt; if (this.rampTime >= 2) { this.ramp = this.ramp === 'deploying' ? 'deployed' : 'stowed'; this.rampTime = 0; this.message = this.ramp === 'deployed' ? '坡板已展開，輪椅服務進行中；請保持停穩。' : '坡板已收妥，可關門。'; } }
    if (this.doorOpen && (!this.rampRequired || this.ramp === 'deployed')) this.operationTime += dt;
    if (this.phase === 'loading') {
      if (!aligned) { this.phase = 'driving'; this.operationTime = 0; this.message = '車身離開停靠位置，作業已取消；重新停妥確認。'; }
      else if ((this.operationTime += dt) >= (this.plan.rescue ? this.rescueOperationSeconds : 4)) {
        if (this.plan.rescue && this.rescueStage === 'warning') { this.changeStage('positioning'); this.phase = 'driving'; this.dwell = this.operationTime = 0; this.message = '警示已設置，請同層對準平台並停穩，再確認定位。'; }
        else if (this.plan.rescue && this.rescueStage === 'positioning') { this.changeStage(this.plan.winch ? 'winch' : 'securing'); if (this.plan.winch) this.winch = new DutyWinch(); this.phase = 'driving'; this.operationTime = 0; this.message = this.plan.winch ? '絞盤遙控已啟用；先左右對準，再將故障車低速收進平台。' : '定位完成，確認固定故障車。'; }
        else if (this.loaded) { if (this.plan.rescue) { this.loaded = false; this.car.spec = RESCUE_SPEC; this.car.geometry = RESCUE_GEOMETRY; } this.complete(); }
        else { this.loaded = true; if (this.plan.rescue) { this.changeStage('returning'); this.car.spec = { ...RESCUE_LOADED_SPEC }; this.car.geometry = { ...RESCUE_GEOMETRY, inertia: 10.5 }; } this.advance(); this.message = '已固定故障車，滿載加速及煞車較慢，請平穩返回勤務站。'; }
      }
    }
    this.previous = { x: c.x, z: c.z, y: c.y, h: c.h }; this.previousSpeed = speed;
  }
  action() {
    if (this.finished) return false;
    if (this.plan.kind === 'bus') {
      if (this.doorOpen) {
        if (this.rampRequired && this.ramp === 'stowed' && this.operationTime === 0) { this.ramp = 'deploying'; this.rampTime = 0; this.message = '正在展開坡板（2秒），車輛鎖定。'; return true; }
        if (this.ramp === 'deploying' || this.ramp === 'retracting') return false;
        if (this.operationTime + .000001 < this.operationRequired + (this.rampRequired ? 6 : 0)) { this.message = `乘客服務中，還需 ${Math.ceil(this.operationRequired + (this.rampRequired ? 6 : 0) - this.operationTime)}秒。`; return false; }
        if (this.rampRequired && this.ramp === 'deployed') { this.ramp = 'retracting'; this.rampTime = 0; this.message = '輪椅服務完成，正在收回坡板（2秒）。'; return true; }
        if (this.exchange) { this.onboard = this.exchange.onboard; this.boarded += this.exchange.boarded; this.alighted += this.exchange.alighted; this.leftBehind += this.exchange.leftBehind; if (this.accessDemand) { const alight = Math.min(this.wheelchairOnboard, this.accessDemand.wheelchairAlight), board = Math.min(this.accessDemand.wheelchairBoard, this.exchange.boarded); this.wheelchairOnboard += board - alight; this.wheelchairBoarded += board; this.wheelchairAlighted += alight; } this.exchange = null; }
        this.doorOpen = false; this.stops++; this.finishDetail(); if (this.legIndex === this.plan.legs.length - 1) this.complete(); else { this.advance(); this.beginDetail('stop'); } return true;
      }
      if (!this.ready) { this.message = '依序經過路線，在站點5公尺內同層、對準箭頭，放開油門與煞車停穩1.5秒才能開門。'; return false; }
      this.doorOpen = true; this.phase = 'doors'; this.operationTime = 0;
      if (this.plan.passengers) this.exchange = busExchange(this.onboard, this.plan.passengers.capacity, this.plan.passengers.requests[this.legIndex]);
      if (!this.scoredArrival) { const before = this.punctuality; this.punctuality = Math.max(0, this.punctuality - Math.max(0, Math.abs(this.elapsed - this.due) - 30) / 8); this.loss('arrival-time', before - this.punctuality); if (this.detail) this.detail.arrival = { actual: this.elapsed, due: this.due, delta: this.elapsed - this.due }; this.scoredArrival = true; }
      this.message = this.exchange ? `本站下車${this.exchange.alighted}人／上車${this.exchange.boarded}人${this.exchange.leftBehind ? `，客滿候車${this.exchange.leftBehind}人` : ''}；車門作業${Math.ceil(this.exchange.seconds)}秒，行車鎖定。` : '車門已開，行車鎖定；至少5秒後關門繼續。'; return true;
    }
    if (this.rescueStage === 'winch') { if (!this.winch?.confirm()) { this.message = '尚未完成裝載：先把橫向偏移修到±0.35公尺，再將故障車收進平台。'; return false; } this.changeStage('securing'); this.phase = 'loading'; this.operationTime = 0; this.message = '入台位置已確認，正在固定故障車（4秒）。'; return true; }
    if (this.phase === 'loading') return false;
    if (!this.ready) { this.message = '沿路線到指定平台停靠點，同層2.5公尺內、對準箭頭，放開油門與煞車停穩1.5秒。'; return false; }
    if (this.plan.rescue) { if (this.rescueStage === 'approach') this.changeStage('warning'); else if (this.loaded) this.changeStage('unloading'); }
    this.phase = 'loading'; this.operationTime = 0; this.message = this.loaded ? '正在卸車，請保持停穩。' : this.plan.rescue && this.rescueStage === 'warning' ? '正在設置事故警示（2秒）。' : this.plan.rescue && this.rescueStage === 'positioning' ? '正在確認平台定位（2秒）。' : '正在將故障車固定到平板，請保持停穩。'; return true;
  }
  private advance() { this.legIndex++; this.routeGates = gates(this.leg); this.gateIndex = 0; this.phase = 'driving'; this.dwell = this.operationTime = 0; this.scoredArrival = false; }
  private complete() { this.finishDetail(); this.phase = 'complete'; this.car.vx = this.car.vz = this.car.w = 0; this.stops = this.plan.kind === 'bus' ? this.stops : 2; this.message = '勤務完成，獨立紀錄已結算。'; }
  result(at = Date.now()): DutyRecord | null {
    if (this.phase !== 'complete' || this.recorded) return null; this.recorded = true;
    return { id: `duty-${at.toString(36)}-${this.plan.kind}`, kind: this.plan.kind, name: this.plan.name, seconds: this.elapsed, score: Math.max(0, Math.round((this.plan.kind === 'bus' ? this.comfort * .6 + this.punctuality * .4 : this.comfort * .35 + this.integrity * .65) - this.roadRules.penalty)), stops: this.stops, impacts: this.impacts, integrity: this.integrity, at, ...(this.plan.passengers ? { service: { routeId: this.plan.passengers.routeId, boarded: this.boarded, alighted: this.alighted, leftBehind: this.leftBehind } } : {}), ...(this.plan.rescue ? { rescue: { caseId: this.plan.rescue.id, secured: true as const } } : {}), ...(this.plan.accessibility ? { accessibility: { wheelchairBoarded: this.wheelchairBoarded, wheelchairAlighted: this.wheelchairAlighted, bells: this.bellSequence } } : {}), details: this.breakdown };
  }
}
