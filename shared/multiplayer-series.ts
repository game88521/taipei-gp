import { getMultiplayerTrack } from './multiplayer-tracks.ts';

export interface SeriesResult {
  playerId: string; name: string; color: string; rank: number;
  finishMs: number | null; dnf: boolean; points: number;
}
export interface SeriesRound { matchId: string; trackId: string; laps: 1 | 3 | 5; results: SeriesResult[] }
export interface SeriesStanding { playerId: string; name: string; color: string; points: number; wins: number; finishes: number; rank: number }
export interface MultiplayerSeries {
  id: string; revision: number; trackIds: string[]; roundIndex: number;
  locked: boolean; complete: boolean; entrants: { playerId: string; name: string; color: string }[];
  rounds: SeriesRound[]; standings: SeriesStanding[];
}
export const SERIES_POINTS = [10, 6, 4, 3] as const;
export function validSeriesTracks(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 3 && value.length <= 5 && new Set(value).size === value.length
    && value.every(id => typeof id === 'string' && !!getMultiplayerTrack(id));
}
/** Stable identity, never the displayed name or a reused car slot. DNF scores zero. */
export function seriesStandings(entrants: MultiplayerSeries['entrants'], rounds: SeriesRound[]): SeriesStanding[] {
  return entrants.map((entrant, order) => {
    const results = rounds.flatMap(round => round.results.filter(result => result.playerId === entrant.playerId));
    const finished = results.filter(result => !result.dnf && result.finishMs !== null);
    return { ...entrant, points: results.reduce((sum, result) => sum + result.points, 0),
      wins: finished.filter(result => result.rank === 1).length, finishes: finished.length,
      counts: SERIES_POINTS.map((_, index) => finished.filter(result => result.rank === index + 1).length),
      elapsed: finished.reduce((sum, result) => sum + result.finishMs!, 0), order };
  }).sort((a, b) => b.points - a.points || b.counts[0] - a.counts[0] || b.counts[1] - a.counts[1]
    || b.counts[2] - a.counts[2] || b.counts[3] - a.counts[3] || a.elapsed - b.elapsed || a.order - b.order)
    .map(({ counts: _counts, elapsed: _elapsed, order: _order, ...row }, index) => ({ ...row, rank: index + 1 }));
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, low: number, high: number) => Number.isSafeInteger(v) && Number(v) >= low && Number(v) <= high;
const identity = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
/** Optional v2 extension: omission is legacy; provided series must be complete and consistent. */
export function validSeries(value: unknown, trackId: string, phase: string, matchId?: string | null, laps?: number): value is MultiplayerSeries {
  if (!obj(value) || !identity(value.id) || !integer(value.revision, 1, 1000000) || !validSeriesTracks(value.trackIds)
    || !integer(value.roundIndex, 0, value.trackIds.length - 1) || value.trackIds[Number(value.roundIndex)] !== trackId
    || typeof value.locked !== 'boolean' || typeof value.complete !== 'boolean'
    || !Array.isArray(value.entrants) || value.entrants.length > 4 || !Array.isArray(value.rounds) || value.rounds.length > value.trackIds.length
    || !Array.isArray(value.standings) || value.standings.length !== value.entrants.length) return false;
  const ids = new Set<string>();
  for (const entrant of value.entrants) {
    if (!obj(entrant) || !identity(entrant.playerId) || ids.has(entrant.playerId) || typeof entrant.name !== 'string' || entrant.name.length > 16
      || typeof entrant.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(entrant.color)) return false;
    ids.add(entrant.playerId);
  }
  const matches = new Set<string>();
  for (const [index, round] of value.rounds.entries()) {
    if (!obj(round) || !identity(round.matchId) || matches.has(round.matchId) || round.trackId !== value.trackIds[index]
      || typeof round.laps !== 'number' || ![1, 3, 5].includes(round.laps) || !Array.isArray(round.results) || round.results.length !== ids.size) return false;
    matches.add(round.matchId); const seen = new Set<string>(); const ranks = new Set<number>();
    let lastFinish = 0, sawDnf = false;
    for (const [resultIndex, result] of round.results.entries()) {
      if (!obj(result) || !identity(result.playerId) || !ids.has(result.playerId) || seen.has(result.playerId)
        || result.rank !== resultIndex + 1 || !integer(result.rank, 1, Math.max(1, ids.size)) || ranks.has(Number(result.rank)) || typeof result.dnf !== 'boolean'
        || typeof result.name !== 'string' || result.name.length > 16 || typeof result.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(result.color)
        || (result.dnf ? result.finishMs !== null || result.points !== 0
          : typeof result.finishMs !== 'number' || !Number.isFinite(result.finishMs) || result.finishMs <= 0 || result.finishMs > 86400000
            || result.points !== SERIES_POINTS[Number(result.rank) - 1])) return false;
      const entrant = value.entrants.find(entrant => obj(entrant) && entrant.playerId === result.playerId);
      if (!obj(entrant) || result.name !== entrant.name || result.color !== entrant.color) return false;
      if (result.dnf) sawDnf = true;
      else { if (sawDnf || Number(result.finishMs) < lastFinish) return false; lastFinish = Number(result.finishMs); }
      seen.add(result.playerId); ranks.add(Number(result.rank));
    }
  }
  if ((!value.locked && (phase !== 'lobby' || value.rounds.length !== 0)) || (value.locked && ids.size < 2)
    || value.complete !== (value.rounds.length === value.trackIds.length)
    || value.rounds.length !== Number(value.roundIndex) + (phase === 'results' ? 1 : 0)) return false;
  const latest = value.rounds.at(-1);
  if (phase === 'results' && obj(latest) && (matchId !== undefined && latest.matchId !== matchId || laps !== undefined && latest.laps !== laps)) return false;
  if ((phase === 'racing' || phase === 'countdown') && matchId && matches.has(matchId)) return false;
  const expected = seriesStandings(value.entrants as MultiplayerSeries['entrants'], value.rounds as SeriesRound[]);
  const standings = value.standings;
  return expected.every((row, index) => {
    const received = standings[index];
    return obj(received) && Object.entries(row).every(([key, entry]) => received[key] === entry);
  });
}
