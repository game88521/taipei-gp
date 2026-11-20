import type { CarState } from './car';
import type { PracticeSnapshot } from './tt-practice';
import { parseRaceSnapshot, type RaceSnapshot } from './race-state';
import type { RaceField } from './rivals';

/** 週末暫借現有賽車陣；退出時還原全部物理/seed/規則與尚未開始的新模式設定。 */
export function preserveWeekendField(field: RaceField) {
  const prior = field.snapshot(), aiPolicy = field.aiPolicy, ttMode = field.ttMode;
  return () => { if (!field.restore(prior)) return false; field.aiPolicy = aiPolicy; field.ttMode = ttMode; return true; };
}

export interface PracticeFrame { car: CarState; practice: PracticeSnapshot; lapTime: number; lapValid: boolean }
/** 100ms 一筆、十秒上限。倒帶後丟棄未來；沒有到足秒數時拒絕，不偷偷回較短時間。 */
export class PracticeRewind {
  private frames: { at: number; value: PracticeFrame }[] = [];
  private now = 0;
  clear() { this.frames = []; this.now = 0; }
  capture(dt: number, frame: () => PracticeFrame) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1) return;
    this.now += dt;
    if (this.frames.length && this.now - this.frames.at(-1)!.at < .1 - 1e-8) return;
    this.frames.push({ at: this.now, value: structuredClone(frame()) });
    this.frames = this.frames.filter(f => f.at >= this.now - 10 - 1e-8).slice(-102);
  }
  canRewind(seconds: 3 | 5) { return !!this.frames.length && this.now - this.frames[0].at >= seconds - 1e-8; }
  rewind(seconds: 3 | 5): PracticeFrame | null {
    if (!this.canRewind(seconds)) return null;
    const target = this.now - seconds;
    let index = this.frames.length - 1;
    while (index >= 0 && this.frames[index].at > target + 1e-8) index--;
    if (index < 0) return null;
    const selected = this.frames[index];
    this.frames.splice(index + 1); this.now = selected.at;
    return structuredClone(selected.value);
  }
  get duration() { return this.frames.length ? Math.max(0, this.now - this.frames[0].at) : 0; }
  get size() { return this.frames.length; }
}

export type WeekendStage = 'qualifying' | 'sprint' | 'race';
export interface WeekendConfig {
  trackId: string; trackV: string; sprintLaps: 1 | 2; raceLaps: 3 | 6;
  difficulty: 'easy' | 'normal' | 'hard'; rules: 'classic' | '2026'; weather: 'dry' | 'wet'; tyre: number;
}
export interface WeekendResult { name: string; finish: number | null; dnf: boolean }
export interface WeekendPlayerState { lapTime: number; lapValid: boolean; sectorIdx: number; sectorStart: number; lastLap: number | null }
export interface WeekendCheckpoint { stage: 'sprint' | 'race'; race: RaceSnapshot; player: WeekendPlayerState; aiPolicy: 'legacy' | 'safe-v1' }
export interface WeekendSave {
  version: 1; id: string; at: number; config: WeekendConfig; names: string[];
  stage: WeekendStage | 'complete'; qualifying?: { name: string; time: number | null }[];
  sprint?: WeekendResult[]; race?: WeekendResult[]; checkpoint?: WeekendCheckpoint;
}
export interface WeekendSummary { id: string; at: number; trackId: string; sprintLaps: 1 | 2; raceLaps: 3 | 6; rows: { name: string; points: number; rank: number }[] }
export interface HorizonRacingSave { version: 1; weekend?: WeekendSave; history: WeekendSummary[] }
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1] as const;
export const WEEKEND_GP_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;
export function newWeekend(config: WeekendConfig, names: string[], id: string, at: number): WeekendSave {
  return { version: 1, id, at, config: { ...config }, names: [...names], stage: 'qualifying' };
}
export function weekendQualifying(weekend: WeekendSave, times: { name: string; time: number | null }[]): boolean {
  if (weekend.stage !== 'qualifying' || weekend.qualifying || !Array.isArray(times) || !times.every(t => object(t)) || !validNames(times.map(t => t.name), weekend.names)) return false;
  if (times.some(t => t.time !== null && !finite(t.time, 1, 151))) return false;
  weekend.qualifying = [...times].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || weekend.names.indexOf(a.name) - weekend.names.indexOf(b.name));
  weekend.stage = 'sprint'; delete weekend.checkpoint; return true;
}
export function weekendFinish(weekend: WeekendSave, stage: 'sprint' | 'race', results: WeekendResult[]): boolean {
  if (weekend.stage !== stage || weekend[stage] || !validResults(results, weekend.names)) return false;
  // 已完賽按實測時間；同時／DNF 保留排位次序，與既有賽季的決勝規則分開。
  const grid = weekend.qualifying!.map(r => r.name);
  weekend[stage] = structuredClone(results).sort((a, b) => Number(a.dnf) - Number(b.dnf)
    || (a.finish ?? Infinity) - (b.finish ?? Infinity) || grid.indexOf(a.name) - grid.indexOf(b.name));
  weekend.stage = stage === 'sprint' ? 'race' : 'complete'; delete weekend.checkpoint; return true;
}
export function weekendStandings(weekend: WeekendSave) {
  const points = (rows: WeekendResult[] | undefined, name: string, table: readonly number[]) => {
    const index = rows?.findIndex(r => r.name === name) ?? -1;
    return index >= 0 && !rows![index].dnf && rows![index].finish !== null ? table[index] ?? 0 : 0;
  };
  const rank = (rows: { name: string }[] | undefined, name: string) => rows ? rows.findIndex(r => r.name === name) : 99;
  return weekend.names.map(name => ({ name, sprint: points(weekend.sprint, name, SPRINT_POINTS), gp: points(weekend.race, name, WEEKEND_GP_POINTS) }))
    .map(r => ({ ...r, points: r.sprint + r.gp }))
    .sort((a, b) => b.points - a.points || rank(weekend.race, a.name) - rank(weekend.race, b.name)
      || rank(weekend.sprint, a.name) - rank(weekend.sprint, b.name) || rank(weekend.qualifying, a.name) - rank(weekend.qualifying, b.name)
      || weekend.names.indexOf(a.name) - weekend.names.indexOf(b.name))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
export function archiveWeekend(save: HorizonRacingSave) {
  const w = save.weekend;
  if (!w || w.stage !== 'complete' || save.history.some(h => h.id === w.id)) return;
  save.history.unshift({ id: w.id, at: w.at, trackId: w.config.trackId, sprintLaps: w.config.sprintLaps, raceLaps: w.config.raceLaps,
    rows: weekendStandings(w).map(({ name, points, rank }) => ({ name, points, rank })) });
  save.history = save.history.slice(0, 10);
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min = 0, max = 86400): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f<>]/.test(v);
const validNames = (names: unknown[], expected?: string[]) => names.length === 22 && names.every(n => text(n, 40)) && new Set(names).size === 22
  && (!expected || names.every(n => expected.includes(String(n))));
function validResults(v: unknown, names: string[]): v is WeekendResult[] {
  return Array.isArray(v) && validNames(v.map(r => object(r) ? r.name : null), names)
    && v.every(r => object(r) && typeof r.dnf === 'boolean' && (r.dnf ? r.finish === null : finite(r.finish, 1, 86400)));
}
export function parseHorizonRacing(value: unknown): HorizonRacingSave | undefined {
  if (value === undefined || value === null) return undefined;
  if (!object(value) || value.version !== 1 || !Array.isArray(value.history) || value.history.length > 10) return undefined;
  const history: WeekendSummary[] = [];
  for (const row of value.history) {
    if (!object(row) || !text(row.id) || history.some(h => h.id === row.id) || !finite(row.at, 0, 1e15) || !text(row.trackId, 30) || typeof row.sprintLaps !== 'number' || ![1, 2].includes(row.sprintLaps) || typeof row.raceLaps !== 'number' || ![3, 6].includes(row.raceLaps)
      || !Array.isArray(row.rows) || !validNames(row.rows.map(r => object(r) ? r.name : null))
      || row.rows.some((r, i) => !object(r) || r.rank !== i + 1 || !Number.isInteger(r.points) || !finite(r.points, 0, 33))) return undefined;
    history.push({ id: row.id, at: row.at, trackId: row.trackId, sprintLaps: row.sprintLaps as 1 | 2, raceLaps: row.raceLaps as 3 | 6,
      rows: row.rows.map(r => ({ name: r.name as string, points: r.points as number, rank: r.rank as number })) });
  }
  const out: HorizonRacingSave = { version: 1, history };
  if (value.weekend === undefined) return out;
  const w = value.weekend;
  if (!object(w) || w.version !== 1 || !text(w.id) || !finite(w.at, 0, 1e15) || !Array.isArray(w.names) || !validNames(w.names) || !object(w.config)
    || typeof w.stage !== 'string' || !['qualifying', 'sprint', 'race', 'complete'].includes(w.stage)) return undefined;
  const c = w.config;
  if (!text(c.trackId, 30) || !text(c.trackV, 120) || ![1, 2].includes(Number(c.sprintLaps)) || typeof c.sprintLaps !== 'number'
    || ![3, 6].includes(Number(c.raceLaps)) || typeof c.raceLaps !== 'number' || typeof c.difficulty !== 'string' || !['easy', 'normal', 'hard'].includes(c.difficulty)
    || typeof c.rules !== 'string' || !['classic', '2026'].includes(c.rules) || typeof c.weather !== 'string' || !['dry', 'wet'].includes(c.weather) || !Number.isInteger(c.tyre) || !finite(c.tyre, 0, 3)) return undefined;
  const clean = newWeekend({ trackId: c.trackId, trackV: c.trackV, sprintLaps: c.sprintLaps as 1 | 2, raceLaps: c.raceLaps as 3 | 6,
    difficulty: c.difficulty as WeekendConfig['difficulty'], rules: c.rules as WeekendConfig['rules'], weather: c.weather as WeekendConfig['weather'], tyre: c.tyre }, w.names as string[], w.id, w.at);
  if (w.qualifying !== undefined) {
    if (!Array.isArray(w.qualifying) || !weekendQualifying(clean, w.qualifying as { name: string; time: number | null }[])) return undefined;
  }
  if (w.sprint !== undefined && !weekendFinish(clean, 'sprint', w.sprint as WeekendResult[])) return undefined;
  if (w.race !== undefined && !weekendFinish(clean, 'race', w.race as WeekendResult[])) return undefined;
  if (clean.stage !== w.stage) return undefined;
  if (w.checkpoint !== undefined) {
    const cp = w.checkpoint;
    if (!object(cp) || cp.stage !== w.stage || typeof cp.stage !== 'string' || !['sprint', 'race'].includes(cp.stage) || typeof cp.aiPolicy !== 'string' || !['legacy', 'safe-v1'].includes(cp.aiPolicy) || !object(cp.player)) return undefined;
    const race = parseRaceSnapshot(cp.race), p = cp.player;
    if (!race || !validNames(race.racers.map(r => r.name), clean.names) || race.rules !== clean.config.rules || race.difficulty !== clean.config.difficulty
      || race.laps !== (cp.stage === 'sprint' ? clean.config.sprintLaps : clean.config.raceLaps)
      || !finite(p.lapTime, 0, 86400) || typeof p.lapValid !== 'boolean' || !Number.isInteger(p.sectorIdx) || !finite(p.sectorIdx, 0, 2)
      || !finite(p.sectorStart, 0, p.lapTime) || !(p.lastLap === null || finite(p.lastLap))) return undefined;
    clean.checkpoint = { stage: cp.stage as 'sprint' | 'race', race, aiPolicy: cp.aiPolicy as 'legacy' | 'safe-v1',
      player: { lapTime: p.lapTime, lapValid: p.lapValid, sectorIdx: p.sectorIdx, sectorStart: p.sectorStart, lastLap: p.lastLap as number | null } };
  }
  out.weekend = clean; return out;
}
