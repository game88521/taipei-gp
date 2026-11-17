import catalog from './multiplayer-catalog.json' with { type: 'json' };
import type { CarState } from '../src/car';
import type { MultiplayerSeries } from './multiplayer-series';
import type { MultiplayerRoomRules } from './multiplayer-room-rules';
export { validSeries, validSeriesTracks } from './multiplayer-series.ts';

export type { CarState };
export const PROTOCOL_VERSION = 2;
// Collision response changes authority and prediction even though the wire
// schema remains v2. Both peers must use the same physical rules.
export const PHYSICS_VERSION = 'classic-multitrack-collisions-v3';
export const CATALOG_STAMP: string = catalog.catalogStamp;
/** Legacy test import only; v2 entry messages require catalogStamp. */
export const TRACK_STAMP: string = catalog.tracks[0].trackStamp;
export const MULTIPLAYER_MAX_PLAYERS = 4;
export const MULTIPLAYER_INPUT_HZ = 30;
export const MULTIPLAYER_TICK_HZ = 60;
export const MULTIPLAYER_SNAPSHOT_HZ = 20;
export type MultiplayerLaps = 1 | 3 | 5;
export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'results';
export type DeadlineReason = 'race-timeout' | 'finish-timeout';
export type DnfReason = DeadlineReason | 'disconnect-expired' | 'left' | 'server-stall';

export interface Compatibility {
  version: number;
  physics: string;
  catalogStamp: string;
}
export interface TrackSelection {
  trackId: string;
  trackStamp: string;
  trackRevision: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  loaded: boolean;
  car: CarState;
  ackSeq: number;
  completedLaps: number;
  /** Net forward distance since this race's start, in metres. */
  progress: number;
  /** Server elapsed milliseconds, never a client-provided time. */
  finishMs: number | null;
  /** Additive v2 pair: completed-lap milliseconds measured at server finish gates. */
  lapTimesMs?: number[];
  bestLapMs?: number | null;
  dnf: boolean;
  /** Additive v2 metadata. Older servers omit the reason. */
  dnfReason?: DnfReason | null;
  rank: number;
}

export interface RoomSnapshot extends Compatibility, TrackSelection {
  code: string;
  hostId: string;
  /** Additive v2 capability; absent on older servers. Commands bind this lobby generation. */
  hostManagement?: { lobbyRevision: number };
  /** Optional additive capabilities. Older servers omit these controls. */
  capabilities?: { lobbyOptions: true; championship: true; roomRules?: true };
  roomRules?: MultiplayerRoomRules;
  series?: MultiplayerSeries | null;
  phase: RoomPhase;
  matchId: string | null;
  startAt: number | null;
  /** Server deadline, including the existing leader-finish grace period. */
  deadlineAt?: number | null;
  deadlineReason?: DeadlineReason | null;
  laps: MultiplayerLaps;
  serverTime: number;
  trackLength: number;
  players: RoomPlayer[];
}

type Request = { requestId?: string };
type ClientCapabilities = { clientCapabilities?: { roomRules: true } };
export type ClientMessage =
  | ({ type: 'create'; name: string; laps: MultiplayerLaps; trackId?: string } & Compatibility & Request & ClientCapabilities)
  | ({ type: 'join'; code: string; name: string } & Compatibility & Request & ClientCapabilities)
  | ({ type: 'resume'; code: string; playerId: string; token: string } & Compatibility & Request & ClientCapabilities)
  | { type: 'set-room-rules'; roomRules: MultiplayerRoomRules; roomCode: string; expectedLobbyRevision: number }
  | { type: 'select-track'; trackId: string; expectedRevision: number }
  | { type: 'kick-player' | 'transfer-host'; targetPlayerId: string; roomCode: string; expectedLobbyRevision: number }
  | { type: 'set-laps'; laps: MultiplayerLaps; roomCode: string; expectedLobbyRevision: number }
  | { type: 'configure-series'; trackIds: string[]; roomCode: string; expectedLobbyRevision: number }
  | { type: 'end-series'; roomCode: string; expectedLobbyRevision: number }
  | { type: 'next-series'; roomCode: string; matchId: string; expectedSeriesRevision: number }
  | ({ type: 'track-loaded' } & TrackSelection)
  | { type: 'ready'; ready: boolean; trackRevision: number; trackStamp: string }
  | { type: 'start'; trackRevision: number }
  | { type: 'reset' }
  | { type: 'leave' }
  | { type: 'input'; matchId: string; trackRevision: number; seq: number; steer: number; brake: boolean }
  | { type: 'ping'; sentAt: number };

export type ServerMessage =
  | ({ type: 'welcome'; playerId: string; resumeToken: string; room: RoomSnapshot } & Request)
  | { type: 'room' | 'snapshot'; room: RoomSnapshot }
  | ({ type: 'error'; code: string; message: string } & Request)
  | { type: 'pong'; sentAt: number; serverTime: number }
  | { type: 'left'; reason?: 'kicked'; roomCode?: string; message?: string };
