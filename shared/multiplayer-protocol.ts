import catalog from './multiplayer-catalog.json' with { type: 'json' };
import type { CarState } from '../src/car';

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
  dnf: boolean;
  rank: number;
}

export interface RoomSnapshot extends Compatibility, TrackSelection {
  code: string;
  hostId: string;
  phase: RoomPhase;
  matchId: string | null;
  startAt: number | null;
  laps: MultiplayerLaps;
  serverTime: number;
  trackLength: number;
  players: RoomPlayer[];
}

type Request = { requestId?: string };
export type ClientMessage =
  | ({ type: 'create'; name: string; laps: MultiplayerLaps; trackId?: string } & Compatibility & Request)
  | ({ type: 'join'; code: string; name: string } & Compatibility & Request)
  | ({ type: 'resume'; code: string; playerId: string; token: string } & Compatibility & Request)
  | { type: 'select-track'; trackId: string; expectedRevision: number }
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
  | { type: 'left' };
