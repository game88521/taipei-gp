import { getMultiplayerTrack } from './multiplayer-tracks.ts';

export type MultiplayerEventMode = 'race' | 'time-trial' | 'pursuit' | 'teams';
export type MultiplayerTeam = 'red' | 'blue';
export type ReleaseDelaySeconds = 0 | 3 | 5 | 10;
export interface MultiplayerEvolution {
  mode: MultiplayerEventMode;
  durationSeconds: 180 | 300;
  releaseDelays: Record<string, ReleaseDelaySeconds>;
  teams: Record<string, MultiplayerTeam>;
  vote: { revision: number; ballots: Record<string, string> };
  teamStandings?: TeamStanding[];
}
export interface TeamStanding { team: MultiplayerTeam; points: number; roundWins: number; wins: number; finishes: number; elapsedMs: number; rank: number }
export function defaultEvolution(): MultiplayerEvolution {
  return { mode: 'race', durationSeconds: 180, releaseDelays: {}, teams: {}, vote: { revision: 1, ballots: {} } };
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validEvolution(value: unknown): value is MultiplayerEvolution {
  if (!obj(value) || !['race', 'time-trial', 'pursuit', 'teams'].includes(String(value.mode)) || ![180, 300].includes(Number(value.durationSeconds))
    || !obj(value.releaseDelays) || !obj(value.teams) || !obj(value.vote) || !Number.isSafeInteger(value.vote.revision)
    || Number(value.vote.revision) < 1 || !obj(value.vote.ballots)) return false;
  return Object.keys(value.releaseDelays).length <= 4 && Object.values(value.releaseDelays).every(v => [0, 3, 5, 10].includes(Number(v)) && typeof v === 'number')
    && Object.keys(value.teams).length <= 4 && Object.values(value.teams).every(v => v === 'red' || v === 'blue')
    && Object.keys(value.vote.ballots).length <= 4 && Object.values(value.vote.ballots).every(v => typeof v === 'string' && !!getMultiplayerTrack(v));
}
