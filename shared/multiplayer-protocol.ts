import manifest from './taipei-track.json' with { type: 'json' };
import type { CarState } from '../src/car';

export type { CarState };
export const PROTOCOL_VERSION = 1;
export const PHYSICS_VERSION = 'taipei-classic-v1';
export const TRACK_STAMP: string = manifest.stamp;
export const MULTIPLAYER_MAX_PLAYERS = 4;
export const MULTIPLAYER_INPUT_HZ = 30;
export const MULTIPLAYER_TICK_HZ = 60;
export const MULTIPLAYER_SNAPSHOT_HZ = 20;
export type MultiplayerLaps = 1 | 3 | 5;
export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'results';

export interface Compatibility {
  version: number;
  physics: string;
  trackStamp: string;
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
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

export interface RoomSnapshot extends Compatibility {
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
  | ({ type: 'create'; name: string; laps: MultiplayerLaps } & Compatibility & Request)
  | ({ type: 'join'; code: string; name: string } & Compatibility & Request)
  | ({ type: 'resume'; code: string; playerId: string; token: string } & Compatibility & Request)
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'reset' }
  | { type: 'leave' }
  | { type: 'input'; matchId: string; seq: number; steer: number; brake: boolean }
  | { type: 'ping'; sentAt: number };

export type ServerMessage =
  | ({ type: 'welcome'; playerId: string; resumeToken: string; room: RoomSnapshot } & Request)
  | { type: 'room' | 'snapshot'; room: RoomSnapshot }
  | ({ type: 'error'; code: string; message: string } & Request)
  | { type: 'pong'; sentAt: number; serverTime: number }
  | { type: 'left' };
