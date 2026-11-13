import { randomUuid } from './identity';

export type StreetDifficulty = 'easy' | 'standard' | 'hard';
export type StreetMedal = 'none' | 'bronze' | 'silver' | 'gold';
export interface StreetRaceOptions { difficulty: StreetDifficulty; carId: string; rules: string }
export interface StreetRaceResult extends StreetRaceOptions {
  id: string; key: string; routeId: string; duel: boolean; time: number | null; place: number; medal: StreetMedal; finished: boolean;
}
export interface StreetChallengeRecord { best: number; medal: StreetMedal }
export type StreetChallengeRecords = Record<string, StreetChallengeRecord>;
export const STREET_DIFFICULTY: Record<StreetDifficulty, { label: string; top: number; corner: number }> = {
  easy: { label: '新手', top: 0.82, corner: 0.9 },
  standard: { label: '標準', top: 1, corner: 1 },
  hard: { label: '高手', top: 1.12, corner: 1.06 },
};
export function streetChallengeKey(routeId: string, duel: boolean, options: StreetRaceOptions) {
  return ['street-v1', duel ? 'duel' : 'solo', routeId, options.carId, options.rules, options.difficulty].map(encodeURIComponent).join(':');
}
export function streetMedal(place: number, duel: boolean, finished: boolean): StreetMedal {
  if (!finished) return 'none';
  return place === 1 ? 'gold' : duel && place === 2 ? 'silver' : duel && place === 3 ? 'bronze' : 'none';
}
const medals: StreetMedal[] = ['none', 'bronze', 'silver', 'gold'];
export function parseStreetChallengeRecords(raw: unknown): StreetChallengeRecords {
  const out: StreetChallengeRecords = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw).slice(0, 2000)) {
    if (!/^street-v1:(duel|solo):[^:]{1,160}:[^:]{1,160}:[^:]{1,160}:(easy|standard|hard)$/.test(key) || !value || typeof value !== 'object') continue;
    const r = value as StreetChallengeRecord;
    if (!Number.isFinite(r.best) || r.best <= 0 || r.best > 86400 || !medals.includes(r.medal)) continue;
    out[key] = { best: r.best, medal: r.medal };
  }
  return out;
}
export function recordStreetResult(records: StreetChallengeRecords, result: StreetRaceResult) {
  if (!result.finished || result.time == null || !Number.isFinite(result.time) || result.time <= 0) return false;
  const old = records[result.key], improved = !old || result.time < old.best;
  records[result.key] = { best: improved ? result.time : old.best,
    medal: !old || medals.indexOf(result.medal) > medals.indexOf(old.medal) ? result.medal : old.medal };
  return improved;
}
export interface StreetSeriesCheckpoint extends StreetRaceOptions {
  v: 1; id: string; routeIds: [string, string, string]; next: number; results: StreetRaceResult[];
}
function validOptions(r: StreetRaceOptions) {
  return ['easy', 'standard', 'hard'].includes(r.difficulty) && typeof r.carId === 'string' && r.carId.length > 0 && r.carId.length <= 80
    && typeof r.rules === 'string' && r.rules.length > 0 && r.rules.length <= 80;
}
function validResult(r: StreetRaceResult) {
  return r && validOptions(r) && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 160
    && typeof r.routeId === 'string' && r.routeId.length > 0 && r.routeId.length <= 80 && typeof r.duel === 'boolean'
    && typeof r.finished === 'boolean' && Number.isInteger(r.place) && r.place >= 1 && r.place <= (r.duel ? 5 : 2)
    && (r.finished ? typeof r.time === 'number' && Number.isFinite(r.time) && r.time > 0 && r.time <= 86400 : r.time === null)
    && r.key === streetChallengeKey(r.routeId, r.duel, r) && r.medal === streetMedal(r.place, r.duel, r.finished);
}
export function parseStreetSeriesCheckpoint(raw: unknown): StreetSeriesCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as StreetSeriesCheckpoint;
  if (r.v !== 1 || !validOptions(r) || typeof r.id !== 'string' || !r.id || r.id.length > 160
    || !Array.isArray(r.routeIds) || r.routeIds.length !== 3 || new Set(r.routeIds).size !== 3
    || r.routeIds.some((s) => typeof s !== 'string' || !s || s.length > 80)
    || !Number.isInteger(r.next) || r.next < 0 || r.next > 3 || !Array.isArray(r.results) || r.results.length !== r.next) return null;
  const ids = new Set<string>();
  for (let i = 0; i < r.results.length; i++) {
    const q = r.results[i];
    if (!validResult(q) || !q.duel || ids.has(q.id) || q.routeId !== r.routeIds[i] || q.carId !== r.carId || q.rules !== r.rules || q.difficulty !== r.difficulty) return null;
    ids.add(q.id);
  }
  return JSON.parse(JSON.stringify({ ...r, results: r.results.map((q) => ({ ...q })) })) as StreetSeriesCheckpoint;
}
/** 三站短系列：固定車款／規則／難度；只保存已完成站次，途中離開可重跑本站。 */
export class StreetSeries {
  private state: StreetSeriesCheckpoint | null = null;
  get checkpoint() { return this.state ? parseStreetSeriesCheckpoint(this.state) : null; }
  get active() { return !!this.state && this.state.next < 3; }
  get complete() { return this.state?.next === 3; }
  get nextRouteId() { return this.active ? this.state!.routeIds[this.state!.next] : null; }
  get points() { return this.state?.results.reduce((sum, r) => sum + (r.finished ? [10, 6, 4, 2, 1][r.place - 1] : 0), 0) ?? 0; }
  get medal(): StreetMedal { return !this.complete ? 'none' : this.points >= 25 ? 'gold' : this.points >= 18 ? 'silver' : this.points >= 10 ? 'bronze' : 'none'; }
  start(routeIds: string[], options: StreetRaceOptions) {
    const state = parseStreetSeriesCheckpoint({ v: 1, id: randomUuid(), routeIds, next: 0, results: [], ...options });
    if (!state) return false;
    this.state = state; return true;
  }
  restore(raw: unknown, availableRouteIds?: string[]) {
    const state = parseStreetSeriesCheckpoint(raw);
    if (!state || availableRouteIds && state.routeIds.some((id) => !availableRouteIds.includes(id))) return false;
    this.state = state; return true;
  }
  finish(result: StreetRaceResult) {
    if (!this.active || !validResult(result)) return false;
    const state = this.state!;
    if (!result.duel || result.routeId !== this.nextRouteId || result.carId !== state.carId || result.rules !== state.rules
      || result.difficulty !== state.difficulty || state.results.some((r) => r.id === result.id)) return false;
    state.results.push({ ...result }); state.next++; return true;
  }
  abandon() { this.state = null; }
}
