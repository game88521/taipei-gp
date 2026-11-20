import catalog from './multiplayer-catalog.json' with { type: 'json' };
import type {VoyagerSettings,VoyagerState,VoyagerPlayer} from './voyager-racing';
import type { CarState } from '../src/car';
import type { MultiplayerSeries } from './multiplayer-series';
import type { MultiplayerRoomRules } from './multiplayer-room-rules';
import type { MultiplayerEvolution, MultiplayerEventMode, MultiplayerTeam, ReleaseDelaySeconds } from './multiplayer-evolution';
import type { HorizonSettings, BlockState, EliminationState, RoomPreset } from './multiplayer-horizon';
import type { ReplayDescriptor } from './nexus-replay';
import type { ArenaState, ArenaPlayer, ArenaMode } from './multiplayer-arena';
import type {AtlasState,AtlasPlayer,AtlasSettings,AtlasPitService} from './atlas-racing';
import type {SummitState,SummitPlayer,SummitSettings,SummitTyre} from './summit-racing';
import type {OdysseyState,OdysseyPlayer,OdysseySettings} from './odyssey-racing';
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
export type DeadlineReason = 'race-timeout' | 'finish-timeout' | 'time-trial-grace';
export type DnfReason = DeadlineReason | 'disconnect-expired' | 'left' | 'server-stall' | 'time-trial-no-lap';

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
  team?: MultiplayerTeam | null;
  releaseDelaySeconds?: ReleaseDelaySeconds;
  netFinishMs?: number | null;
  timeTrialDone?: boolean;
  block?: BlockState;
  arena?: ArenaPlayer;
  summit?: SummitPlayer;
  atlas?:AtlasPlayer;
  voyager?:VoyagerPlayer;
  odyssey?:OdysseyPlayer;
  gridIndex?: number;
  eliminated?: boolean;
  eliminationWinner?: boolean;
  eliminationRank?: number | null;
  eliminationReason?: string | null;
  eliminationAt?: number | null;
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
  capabilities?: { lobbyOptions: true; championship: true; roomRules?: true; evolution?: true; horizon?: true; replay?: true; nexusArena?: true; summit?:true;atlasRacing?:true;voyagerRacing?:true;odysseyRacing?:true;seriesResume?: { persistent: boolean; ttlSeconds: number } };
  replay?: ReplayDescriptor | null;
  arena?: ArenaState;
  summit?:SummitState;
  atlas?:AtlasState;
  voyager?:VoyagerState;
  odyssey?:OdysseyState;
  horizon?: HorizonSettings;
  spectators?: { id: string; name: string; loaded: boolean }[];
  elimination?: EliminationState;
  evolution?: MultiplayerEvolution;
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
type ClientCapabilities = { clientCapabilities?: { roomRules: true; evolution?: true; horizon?: true; nexusArena?: true;summit?:true;atlasRacing?:true;voyagerRacing?:true;odysseyRacing?:true } };
export type ClientMessage =
  | {type:'set-odyssey';roomCode:string;expectedLobbyRevision:number;settings:OdysseySettings}
  | {type:'next-odyssey-stage';roomCode:string;expectedLobbyRevision:number}
  | {type:'set-voyager';roomCode:string;expectedLobbyRevision:number;settings:VoyagerSettings}
  | {type:'voyager-vsc';roomCode:string;matchId:string;trackRevision:number;seq:number;active:boolean}
  | {type:'set-atlas';roomCode:string;expectedLobbyRevision:number;settings:AtlasSettings}
  | {type:'set-summit';roomCode:string;expectedLobbyRevision:number;settings:SummitSettings}
  | {type:'next-weekend';roomCode:string;expectedLobbyRevision:number}
  | {type:'summit-pit';roomCode:string;matchId:string;trackRevision:number;seq:number;armed:boolean;compound:SummitTyre;service?:AtlasPitService}
  | ({ type: 'replay-chunk'; replayId: string; offset: number } & Request)
  | { type:'set-arena';mode:ArenaMode;roomCode:string;expectedLobbyRevision:number }
  | { type:'arena-team';team:'red'|'blue';roomCode:string;expectedLobbyRevision:number }
  | { type:'relay-handoff'|'use-item';roomCode:string;matchId:string;trackRevision:number;seq:number }
  | ({ type: 'create-configured'; name: string; preset: RoomPreset } & Compatibility & Request & ClientCapabilities)
  | ({ type: 'watch'; code: string; name: string } & Compatibility & Request & ClientCapabilities)
  | ({ type: 'claim-seat'; roomCode: string; expectedLobbyRevision: number } & Request)
  | { type: 'set-horizon'; horizon: HorizonSettings; roomCode: string; expectedLobbyRevision: number }
  | { type: 'recover-block'; roomCode: string; matchId: string }
  | ({ type: 'create'; name: string; laps: MultiplayerLaps; trackId?: string } & Compatibility & Request & ClientCapabilities)
  | ({ type: 'join'; code: string; name: string } & Compatibility & Request & ClientCapabilities)
  | ({ type: 'resume'; code: string; playerId: string; token: string } & Compatibility & Request & ClientCapabilities)
  | ({ type: 'resume-series'; token: string; name?: string } & Compatibility & Request & ClientCapabilities)
  | { type: 'configure-event'; mode: MultiplayerEventMode; durationSeconds: 180 | 300; releaseDelays: Record<string, ReleaseDelaySeconds>; roomCode: string; expectedLobbyRevision: number }
  | { type: 'select-team'; team: MultiplayerTeam; roomCode: string; expectedLobbyRevision: number }
  | { type: 'vote-track'; trackId: string; expectedVoteRevision: number; roomCode: string; expectedLobbyRevision: number }
  | { type: 'resolve-vote'; roomCode: string; expectedLobbyRevision: number }
  | { type: 'random-series'; count: 3 | 4 | 5; roomCode: string; expectedLobbyRevision: number }
  | { type: 'checkpoint-series'; roomCode: string; matchId: string; expectedSeriesRevision: number }
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
  | { type: 'replay-part'; replayId: string; offset: number; totalChars: number; text: string }
  | ({ type: 'watching'; spectatorId: string; room: RoomSnapshot } & Request)
  | { type: 'series-checkpoint'; token: string; expiresAt: number; persistent: boolean }
  | ({ type: 'welcome'; playerId: string; resumeToken: string; room: RoomSnapshot } & Request)
  | { type: 'room' | 'snapshot'; room: RoomSnapshot }
  | ({ type: 'error'; code: string; message: string } & Request)
  | { type: 'pong'; sentAt: number; serverTime: number; capabilities?: { horizon: true } }
  | { type: 'left'; reason?: 'kicked'; roomCode?: string; message?: string };
