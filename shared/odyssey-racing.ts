// Rex <game88521@gmail.com>. Optional racing extension; legacy Summit settings remain byte-compatible.
export const ODYSSEY_RACING_VERSION = 'odyssey-racing-v1';
export interface OdysseySettings { sprintWeekend: boolean; mandatoryStop: boolean }
export interface OdysseyRound { id: string; rank: number; finishMs: number | null; dnf: boolean; points: number }
export interface OdysseyStanding { id: string; points: number; sprintPoints: number; racePoints: number; rank: number }
export interface OdysseyWeekend {
  id: string; trackId: string; raceLaps: 1 | 3 | 5; locked: boolean; complete: boolean;
  entrants: { id: string; name: string }[]; sprint: OdysseyRound[]; race: OdysseyRound[]; standings: OdysseyStanding[];
}
export interface OdysseyState { version: typeof ODYSSEY_RACING_VERSION; settings: OdysseySettings; weekend: OdysseyWeekend | null }
export interface OdysseyPlayer { pitStartedMs: number | null; qualifiedStopMs: number | null; stopMissed: boolean }
export const ODYSSEY_SPRINT_POINTS = [4, 3, 2, 1] as const;
export const ODYSSEY_RACE_POINTS = [10, 6, 4, 3] as const;
export const odysseySettings = (v: unknown): OdysseySettings | null => {
  if (!object(v) || !exact(v, ['sprintWeekend', 'mandatoryStop']) || typeof v.sprintWeekend !== 'boolean' || typeof v.mandatoryStop !== 'boolean' || v.sprintWeekend && v.mandatoryStop) return null;
  return { sprintWeekend: v.sprintWeekend, mandatoryStop: v.mandatoryStop };
};
export const odysseyEnabled = (v?: OdysseySettings | null) => !!v && (v.sprintWeekend || v.mandatoryStop);
/** Both actual service start and completion must fall in this inclusive elapsed-time window. */
export const odysseyStopWindow = (seconds: number) => ({ openMs: seconds * 200, closeMs: seconds * 800 });
export function odysseyStandings(entrants: { id: string }[], sprint: OdysseyRound[], race: OdysseyRound[]): OdysseyStanding[] {
  const points = (rows: OdysseyRound[], id: string) => rows.find(r => r.id === id)?.points ?? 0;
  const rank = (rows: OdysseyRound[], id: string) => rows.find(r => r.id === id)?.rank ?? 99;
  return entrants.map((e, index) => ({ id: e.id, sprintPoints: points(sprint, e.id), racePoints: points(race, e.id), index }))
    .map(e => ({ ...e, points: e.sprintPoints + e.racePoints }))
    .sort((a, b) => b.points - a.points || rank(race, a.id) - rank(race, b.id) || rank(sprint, a.id) - rank(sprint, b.id) || a.index - b.index)
    .map(({ index: _index, ...e }, index) => ({ ...e, rank: index + 1 }));
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const finite = (v: unknown, min = 0, max = 86_400_000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const ident = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export function parseOdysseyState(value: unknown): OdysseyState | null {
  if (!object(value) || !exact(value, ['version', 'settings', 'weekend']) || value.version !== ODYSSEY_RACING_VERSION) return null;
  const settings = odysseySettings(value.settings); if (!settings || !odysseyEnabled(settings)) return null;
  const w = value.weekend;
  if (!settings.sprintWeekend) return w === null ? { version: ODYSSEY_RACING_VERSION, settings, weekend: null } : null;
  if (!object(w) || !exact(w, ['id', 'trackId', 'raceLaps', 'locked', 'complete', 'entrants', 'sprint', 'race', 'standings']) || !ident(w.id) || typeof w.trackId !== 'string' || ![1, 3, 5].includes(Number(w.raceLaps)) || typeof w.raceLaps !== 'number' || typeof w.locked !== 'boolean' || typeof w.complete !== 'boolean' || !Array.isArray(w.entrants) || w.entrants.length > 4) return null;
  if (w.entrants.some(e => !object(e) || !exact(e, ['id', 'name']) || !ident(e.id) || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 32 || /[\u0000-\u001f\u007f<>]/.test(e.name))) return null;
  const entrants = w.entrants as { id: string; name: string }[], ids = entrants.map(e => e.id);
  if (new Set(ids).size !== ids.length || (w.locked ? ids.length < 2 : ids.length !== 0)) return null;
  for (const [key, table] of [['sprint', ODYSSEY_SPRINT_POINTS], ['race', ODYSSEY_RACE_POINTS]] as const) {
    const rows = w[key]; if (!Array.isArray(rows) || rows.length !== 0 && rows.length !== ids.length) return null;
    if (rows.some((r, index) => !object(r) || !exact(r, ['id', 'rank', 'finishMs', 'dnf', 'points']) || !ids.includes(String(r.id)) || r.rank !== index + 1 || typeof r.dnf !== 'boolean' || (r.dnf ? r.finishMs !== null : !finite(r.finishMs, .001)) || r.points !== (r.dnf ? 0 : table[index]))) return null;
    if (new Set(rows.map(r => (r as OdysseyRound).id)).size !== rows.length) return null;
  }
  const sprint = w.sprint as OdysseyRound[], race = w.race as OdysseyRound[];
  const standings = odysseyStandings(entrants, sprint, race);
  if (race.length && !sprint.length || w.complete !== !!race.length || !w.locked && (sprint.length || race.length) || !Array.isArray(w.standings) || w.standings.length !== standings.length || w.standings.some((r, i) => !object(r) || !exact(r, ['id', 'points', 'sprintPoints', 'racePoints', 'rank']) || (Object.keys(standings[i]) as (keyof OdysseyStanding)[]).some(k => r[k] !== standings[i][k]))) return null;
  return structuredClone(value) as unknown as OdysseyState;
}
export function validateOdyssey(room: Record<string, unknown>) {
  const cap = (room.capabilities as Record<string, unknown> | undefined)?.odysseyRacing, players = room.players as { id: string; odyssey?: OdysseyPlayer; summit?: { ai?: boolean } }[];
  if (room.odyssey === undefined) { if (cap !== undefined && cap !== true || players.some(p => p.odyssey !== undefined)) throw Error('Odyssey 能力與資料不一致。'); return; }
  const state = parseOdysseyState(room.odyssey), summit = room.summit as { settings: { weekend: boolean; ai: number; endurance: number }; stage: string } | undefined, voyager = room.voyager as {settings:{practiceSeconds:number;weather:string;vsc:boolean}} | undefined;
  if (cap !== true || !state || !summit || summit.settings.ai || players.some(p => p.summit?.ai) || room.series || (room.evolution as { mode?: string } | undefined)?.mode !== 'race' || Object.values(room.horizon as object ?? {}).some(Boolean) || ((room.arena as { mode?: string } | undefined)?.mode ?? 'off') !== 'off' || voyager && (voyager.settings.practiceSeconds || voyager.settings.weather !== 'legacy' || voyager.settings.vsc)) throw Error('Odyssey 賽事或名單不相容。');
  if (state.settings.sprintWeekend) {
    const w = state.weekend!; if (!summit.settings.weekend || summit.settings.endurance || w.trackId !== room.trackId || !['qualifying', 'sprint', 'race'].includes(summit.stage) || room.laps !== (summit.stage === 'sprint' ? 1 : w.raceLaps) || w.locked && (players.length !== w.entrants.length || players.some(p => !w.entrants.some(e => e.id === p.id))) || summit.stage === 'qualifying' && (w.sprint.length || w.race.length) || summit.stage === 'sprint' && w.race.length || summit.stage === 'race' && !w.sprint.length || w.complete && room.phase !== 'results') throw Error('衝刺週末階段或固定名單無效。');
  } else if (summit.settings.weekend || ![480, 600].includes(summit.settings.endurance) || summit.stage !== 'single') throw Error('強制一停僅支援真人單場耐久。');
  const window = odysseyStopWindow(summit.settings.endurance), elapsed = Math.max(0, Number(room.serverTime) - Number(room.startAt ?? room.serverTime));
  for (const p of players) {
    const v = p.odyssey; if (!v || !object(v) || !exact(v, ['pitStartedMs', 'qualifiedStopMs', 'stopMissed']) || typeof v.stopMissed !== 'boolean' || v.pitStartedMs !== null && !finite(v.pitStartedMs, 0, elapsed) || v.qualifiedStopMs !== null && (!finite(v.qualifiedStopMs, window.openMs, Math.min(window.closeMs, elapsed)) || v.pitStartedMs === null || v.pitStartedMs < window.openMs || v.pitStartedMs > v.qualifiedStopMs || v.stopMissed) || !state.settings.mandatoryStop && (v.pitStartedMs !== null || v.qualifiedStopMs !== null || v.stopMissed) || state.settings.mandatoryStop && v.qualifiedStopMs === null && !v.stopMissed && (elapsed > window.closeMs || room.phase === 'results')) throw Error('有效換胎房規資料無效。');
  }
}
