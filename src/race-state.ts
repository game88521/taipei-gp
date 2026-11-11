import type { CarState } from './car';
import type { Difficulty, PitState, Rules } from './rivals';
import type { TimingEntry } from './race-timing';

export interface RacerSnapshot {
  name: string; car: CarState; compound: number; wear: number; pitReq: boolean; pit: PitState | null;
  pitTyre: number; lift: number; lastStop: number; pits: number; drsOk: boolean; laps: number;
  finish: number | null; lapStart: number; bestLap: number | null; lat: number; stuck: number;
  crashAt: number; slowT: number; defT: number; dnf: boolean;
}
export interface RaceSnapshot {
  version: 1; trackLength: number; trackN: number; raceTime: number; laps: number;
  rules: Rules; difficulty: Difficulty; form: Record<string, number>; look: number;
  wet: number; rainAt: number | null; sc: { phase: 'off' | 'out' | 'in'; t: number; lapAt: number; used: boolean; s: number };
  scChance: number; scAt: number; pitSeed: number; recAcc: number; aiHits: number;
  racers: RacerSnapshot[]; timing: TimingEntry[];
}
export interface ReplayCarState { name: string; compound: number; wear: number; pit: PitState | null; lift: number; energy: number }
export interface ReplayState { time: number; raceTime: number; wet: number; rainAt: number | null; cars: ReplayCarState[] }
export interface CompletionProgress { completed: number; total: number; elapsed: number }
export interface CompletionOptions { signal?: AbortSignal; onProgress?: (p: CompletionProgress) => void; maxSeconds?: number }

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo = -1e9, hi = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const nulNum = (v: unknown, lo = 0, hi = 1e7) => v === null || num(v, lo, hi);
const name = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40;
function validPit(v: unknown): v is PitState | null {
  if (v === null) return true;
  if (!obj(v) || !['in', 'box', 'out'].includes(String(v.ph))) return false;
  return ['sd', 'entry', 'exit', 'box'].every((k) => num(v[k]))
    && ['v', 't', 'T'].every((k) => num(v[k], 0, 1e6)) && num(v.slow, -1, 3) && Number.isInteger(v.slow)
    && num(v.next, 0, 3) && Number.isInteger(v.next) && num(v.team, 0, 21) && Number.isInteger(v.team);
}
function validCar(v: unknown, n: number, length: number): v is CarState {
  if (!obj(v) || !obj(v.pos)) return false;
  return ['x', 'z', 'h'].every((k) => num(v[k])) && num(v.v, 0, 500) && num(v.steer, -1, 1)
    && num(v.power, 0, 5) && num(v.boost, 0, 1) && num(v.gripMul, 0, 3) && num(v.energy, 0, 1)
    && nulNum(v.speedCap, 0, 500) && num(v.hitCool, 0, 1) && ['drs', 'r26', 'aeroZone', 'ovt', 'touch'].every((k) => bool(v[k]))
    && num(v.pos.i, 0, n - 1) && Number.isInteger(v.pos.i) && num(v.pos.lat, -100, 100) && num(v.pos.s, 0, length + 1);
}
/** 匯入／localStorage 都不可信；只還原完整、有限且大小受控的快照。 */
export function parseRaceSnapshot(value: unknown): RaceSnapshot | null {
  if (!obj(value) || value.version !== 1 || !num(value.trackLength, 100, 50000) || !num(value.trackN, 20, 50000) || !Number.isInteger(value.trackN)) return null;
  if (!num(value.raceTime, 0, 86400) || !num(value.laps, 1, 100) || !Number.isInteger(value.laps)
    || !['classic', '2026'].includes(String(value.rules)) || !['easy', 'normal', 'hard'].includes(String(value.difficulty))) return null;
  if (!num(value.look, 0, 3) || !num(value.wet, 0, 1) || !nulNum(value.rainAt, -1, 86400)
    || !num(value.scChance, 0, 1) || !num(value.scAt, -1, 86400) || !num(value.pitSeed, 1, 2147483646)
    || !Number.isInteger(value.pitSeed) || !num(value.recAcc, 0, 0.1) || !num(value.aiHits, 0, 1e8)) return null;
  const sc = value.sc;
  if (!obj(sc) || !['off', 'out', 'in'].includes(String(sc.phase)) || !num(sc.t, 0, 86400)
    || !num(sc.lapAt, 0, 101) || !bool(sc.used) || !num(sc.s)) return null;
  if (!obj(value.form) || Object.keys(value.form).length > 22 || !Object.entries(value.form).every(([k, v]) => name(k) && num(v, -1, 1))) return null;
  if (!Array.isArray(value.racers) || value.racers.length !== 22 || !Array.isArray(value.timing) || value.timing.length > 22) return null;
  const names = new Set<string>();
  for (const r of value.racers) {
    if (!obj(r) || !name(r.name) || names.has(r.name) || !validCar(r.car, value.trackN, value.trackLength) || !validPit(r.pit)) return null;
    names.add(r.name);
    if (!num(r.compound, 0, 3) || !Number.isInteger(r.compound) || !num(r.wear, 0, 1) || !num(r.pitTyre, -1, 3) || !Number.isInteger(r.pitTyre)
      || !['pitReq', 'drsOk', 'dnf'].every((k) => bool(r[k])) || !num(r.lift, 0, 1) || !num(r.lastStop, 0, 86400)
      || !num(r.pits, 0, 1000) || !Number.isInteger(r.pits) || !num(r.laps, 0, 10000) || !Number.isInteger(r.laps)
      || !nulNum(r.finish) || !num(r.lapStart, 0, 86400) || !nulNum(r.bestLap) || !num(r.lat, -20, 20)
      || !num(r.stuck, 0, 100) || !num(r.crashAt, -100, 86400) || !num(r.slowT, 0, 86400) || !num(r.defT, 0, 10)) return null;
  }
  const seen = new Set<string>();
  for (const t of value.timing) {
    if (!obj(t) || !name(t.name) || !names.has(t.name) || seen.has(t.name) || !num(t.progress) || !num(t.time, 0, value.raceTime)
      || !Array.isArray(t.splits) || t.splits.length > 20000) return null;
    seen.add(t.name);
    let last = -Infinity;
    for (const pair of t.splits) {
      if (!Array.isArray(pair) || pair.length !== 2 || !num(pair[0]) || !Number.isInteger(pair[0]) || pair[0] <= last || !num(pair[1], 0, value.raceTime)) return null;
      last = pair[0];
    }
  }
  // 白名單重建，額外欄位（含 __proto__）不能進入 Object.assign 或車輛實例。
  const src = value as unknown as RaceSnapshot;
  const pit = (p: PitState | null): PitState | null => p ? { ph: p.ph, sd: p.sd, v: p.v, entry: p.entry, exit: p.exit,
    t: p.t, T: p.T, slow: p.slow, next: p.next, box: p.box, team: p.team } : null;
  const car = (c: CarState): CarState => ({ x: c.x, z: c.z, h: c.h, v: c.v, steer: c.steer, power: c.power,
    boost: c.boost, drs: c.drs, gripMul: c.gripMul, r26: c.r26, aeroZone: c.aeroZone, ovt: c.ovt,
    energy: c.energy, speedCap: c.speedCap, pos: { i: c.pos.i, s: c.pos.s, lat: c.pos.lat }, touch: c.touch, hitCool: c.hitCool });
  return { version: 1, trackLength: src.trackLength, trackN: src.trackN, raceTime: src.raceTime, laps: src.laps,
    rules: src.rules, difficulty: src.difficulty, form: Object.fromEntries(Object.entries(src.form)), look: src.look,
    wet: src.wet, rainAt: src.rainAt, sc: { phase: sc.phase as 'off' | 'out' | 'in', t: sc.t, lapAt: sc.lapAt, used: sc.used, s: sc.s },
    scChance: src.scChance, scAt: src.scAt, pitSeed: src.pitSeed, recAcc: src.recAcc, aiHits: src.aiHits,
    racers: src.racers.map((r) => ({ name: r.name, car: car(r.car), compound: r.compound, wear: r.wear, pitReq: r.pitReq,
      pit: pit(r.pit), pitTyre: r.pitTyre, lift: r.lift, lastStop: r.lastStop, pits: r.pits, drsOk: r.drsOk,
      laps: r.laps, finish: r.finish, lapStart: r.lapStart, bestLap: r.bestLap, lat: r.lat, stuck: r.stuck,
      crashAt: r.crashAt, slowT: r.slowT, defT: r.defT, dnf: r.dnf })),
    timing: src.timing.map((t) => ({ name: t.name, progress: t.progress, time: t.time, splits: t.splits.map(([a, b]) => [a, b]) })) };
}
