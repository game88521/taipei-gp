import {
  PROTOCOL_VERSION, PHYSICS_VERSION, validSeries, validSeriesTracks,
  type ClientMessage, type ServerMessage, type RoomSnapshot,
} from '../shared/multiplayer-protocol';
import { CATALOG_STAMP, DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack } from '../shared/multiplayer-tracks';
import { parseRoomRules, type MultiplayerRoomRules } from '../shared/multiplayer-room-rules';
import { parseRoomPreset, parseHorizon, validateHorizonSnapshot, type HorizonSettings, type RoomPreset } from '../shared/multiplayer-horizon';
import { decodeMultiplayerReplay, validReplayDescriptor, REPLAY_MAX_CHARS, REPLAY_CHUNK_CHARS, type MultiplayerReplay } from '../shared/nexus-replay';
import { validateArenaSnapshot, type ArenaMode } from '../shared/multiplayer-arena';
import {ATLAS_PIT_SERVICES,atlasSettings,validateAtlas,expeditionSettings,validateExpedition,type ExpeditionSettings,type AtlasSettings,type AtlasPitService} from '../shared/atlas-racing';
import type {VoyagerSettings} from '../shared/voyager-racing';
import {odysseySettings,type OdysseySettings,voyagerSettings,summitSettings,validateSummit,type SummitSettings,type SummitTyre,FRONTIER_CUP_VERSION,validateCupSnapshot,type CupIntent,type CupCommand} from '../shared/summit-racing';
import {AURORA_CUP_VERSION} from '../shared/frontier-cup';
import {meridianSettings,validateMeridianRacing,type MeridianSettings} from '../shared/meridian-racing';
import {MeridianCheckpointClient} from './meridian-checkpoint-client';
import type {CheckpointKind} from '../shared/meridian-checkpoints';

export type MultiplayerConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type StateListener = (client: MultiplayerClient) => void;
type SnapshotListener = (room: RoomSnapshot) => void;
type EntryKind = 'create' | 'join' | 'resume' | 'resume-series' | 'watch' | 'claim-seat' | 'create-configured'|'checkpoint-restore';
interface SavedSession {
  endpoint: string; code: string; playerId: string; token: string;
  version: number; physics: string; catalogStamp: string; savedAt: number;
}
interface PendingEntry {
  kind: EntryKind; id: string; timer: ReturnType<typeof setTimeout>;
  resolve: () => void; reject: (error: Error) => void;
}

const SESSION_KEY = 'taipei-gp-multiplayer-session-v2';
const SERIES_SEATS_KEY = 'taipei-gp-multiplayer-series-seats-v1';
const CONNECT_TIMEOUT = 7000, ENTRY_TIMEOUT = 7000, RECONNECT_WINDOW = 10000;
const HEARTBEAT_INTERVAL = 1500, HEARTBEAT_TIMEOUT = 6500;
const identity = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP, clientCapabilities: { meridianRacing:true as const,roomRules: true as const, evolution: true as const, horizon: true as const, nexusArena: true as const,summit:true as const,atlasRacing:true as const,voyagerRacing:true as const,odysseyRacing:true as const,expeditionRacing:true as const,frontierCup:FRONTIER_CUP_VERSION as typeof FRONTIER_CUP_VERSION,auroraCup:AURORA_CUP_VERSION as typeof AURORA_CUP_VERSION } };
const clock = () => performance.now();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 房間憑證只存在本分頁的 sessionStorage，完全不讀寫單人存檔。 */
export class MultiplayerClient {
  readonly url: string;
  readonly checkpoints:MeridianCheckpointClient;
  private socket: WebSocket | null = null;
  private connection: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDeadline = 0;
  private reconnectAttempts = 0;
  private wantsConnection = false;
  private authenticated = false;
  private entering = false;
  private pending: PendingEntry | null = null;
  private credentials: SavedSession | null = null;
  private listeners = new Set<StateListener>();
  private snapshotListeners = new Set<SnapshotListener>();
  private checkpointListeners = new Set<(checkpoint: { token: string; expiresAt: number; persistent: boolean }) => void>();
  private pings = new Map<number, number>();
  private clockSamples: { rtt: number; offset: number; at: number }[] = [];
  private offset = 0;
  private lastInbound = 0;
  private lastRoomTime = -Infinity;
  private retiredMatches = new Set<string>();
  private requestSeq = 0;
  private inputSeq = 0;
  private arenaSeq = 0;
  private summitSeq=0;private voyagerSeq=0;
  private lastInputAt = -Infinity;
  private lastInputBrake = true;
  private _status: MultiplayerConnectionStatus = 'idle';
  private _error: string | null = null;
  private _room: RoomSnapshot | null = null;
  private _snapshot: RoomSnapshot | null = null;
  private _selfId: string | null = null;
  private _rttMs: number | null = null;
  private _connectionGeneration = 0;
  setOdyssey(settings:OdysseySettings){const r=this._room,parsed=odysseySettings(settings);if(!parsed||!r?.capabilities?.odysseyRacing||r.phase!=='lobby'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'set-odyssey',settings:parsed,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  nextOdysseyStage(){const r=this._room;if(!r?.capabilities?.odysseyRacing||!r.odyssey?.settings.sprintWeekend||r.phase!=='results'||r.odyssey.weekend?.complete||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'next-odyssey-stage',roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  private preservedSeatKey = '';
  private spectatorId: string | null = null;
  private _horizonAvailable = false;
  private replayPending: { id: string; offset: number; total: number | null; chunks: string[]; timer: ReturnType<typeof setTimeout>; resolve: (value: MultiplayerReplay) => void; reject: (error: Error) => void } | null = null;

  constructor(url: string) {
    let endpoint: URL;
    try { endpoint = new URL(url); } catch { throw new Error('連線伺服器網址格式不正確。'); }
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new Error('連線伺服器必須使用有效的 ws 或 wss 網址。');
    if (typeof location !== 'undefined' && location.protocol === 'https:' && endpoint.protocol !== 'wss:') throw new Error('HTTPS 遊戲頁面需要使用 wss 安全連線。');
    this.url = endpoint.href;
    this.checkpoints=new MeridianCheckpointClient(this.url,m=>this.send(m as ClientMessage),()=>this.notify());
  }
  setMeridian(settings:MeridianSettings){const r=this._room,parsed=meridianSettings(settings);if(!parsed||!r?.capabilities?.meridianRacing||r.phase!=='lobby'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'set-meridian',settings:parsed,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  meridianTeam(team:'red'|'blue'){const r=this._room;if(r?.meridian?.settings.mode!=='relay-endurance'||!r.hostManagement||r.phase!=='lobby')return false;return this.command({type:'meridian-team',team,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  meridianHandoff(){const r=this._room,p=r?.players.find(p=>p.id===this.selfId);if(r?.meridian?.settings.mode!=='relay-endurance'||r.phase!=='racing'||!r.matchId||!p?.meridian?.active)return false;return this.command({type:'meridian-handoff',roomCode:r.code,matchId:r.matchId,trackRevision:r.trackRevision,driverGeneration:p.meridian.generation,seq:++this.arenaSeq});}
  meridianNext(){const r=this._room;if(!r?.meridian||r.hostId!==this.selfId||!r.hostManagement||r.phase!=='results')return false;return this.command({type:'meridian-next-stage',roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision,meridianRevision:r.meridian.revision});}
  meridianClose(){const r=this._room;if(!r?.meridian||r.hostId!==this.selfId||!r.hostManagement)return false;return this.command({type:'meridian-close',roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  exportCheckpoint(){const r=this._room;if(!r?.hostManagement||r.hostId!==this.selfId||this.isSpectator)return false;return this.command({type:'checkpoint-export',roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision,...(r.meridian?{meridianRevision:r.meridian.revision}:{}),...(r.cup?{cupRevision:r.cup.revision}:{})});}
  async restoreCheckpoint(ticket:string,kind?:CheckpointKind){if(this._room)throw Error('請先離開目前房間再恢復原席。');const proof=this.checkpoints.proof(ticket,kind);if(!proof)throw Error('沒有本機原席證明。');await this.enter('checkpoint-restore',{type:'checkpoint-restore',...identity,...proof});}

  get status() { return this._status; }
  get error() { return this._error; }
  get room() { return this._room; }
  get snapshot() { return this._snapshot; }
  get selfId() { return this._selfId; }
  get rttMs() { return this._rttMs; }
  get isSpectator() { return this.spectatorId !== null; }
  get horizonAvailable() { return this._horizonAvailable; }
  /** Explicit, result-only read. Parts are sequential and never enter the room state. */
  downloadReplay(): Promise<MultiplayerReplay> {
    const room=this._room,meta=room?.replay;
    if(this.replayPending)return Promise.reject(Error('正在取得回放，請稍候。'));
    if(!this.authenticated||this._status!=='connected'||room?.phase!=='results'||!room.capabilities?.replay||!meta?.ready)return Promise.reject(Error('目前服務或本場結算沒有可取得的回放。'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.rejectReplay('取得回放逾時；可以重新嘗試。'),20_000);
      this.replayPending={id:meta.id,offset:0,total:null,chunks:[],timer,resolve,reject};
      if(!this.send({type:'replay-chunk',replayId:meta.id,offset:0,requestId:`replay:${meta.id}`}))this.rejectReplay('連線已中斷，尚未取得回放。');
    });
  }
  private rejectReplay(message: string) {
    const p=this.replayPending;if(!p)return;this.replayPending=null;clearTimeout(p.timer);p.reject(Error(message));
  }
  setArena(mode:ArenaMode) {const r=this._room;if(!r?.capabilities?.nexusArena||r.phase!=='lobby'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'set-arena',mode,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  arenaTeam(team:'red'|'blue') {const r=this._room;if(!r?.capabilities?.nexusArena||r.phase!=='lobby'||!r.hostManagement||this.isSpectator)return false;return this.command({type:'arena-team',team,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  arenaAction(){const r=this._room,p=r?.players.find(v=>v.id===this.selfId);if(!r?.capabilities?.nexusArena||r.phase!=='racing'||!r.matchId||!p?.arena?.active||p.dnf||p.finishMs!==null||!p.loaded)return false;const type=r.arena?.mode==='items'?'use-item':'relay-handoff';return this.command({type,roomCode:r.code,matchId:r.matchId,trackRevision:r.trackRevision,seq:++this.arenaSeq});}
  setAtlas(settings:AtlasSettings){const r=this._room,parsed=atlasSettings(settings);if(!parsed||!r?.capabilities?.atlasRacing||r.phase!=='lobby'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'set-atlas',settings:parsed,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  setExpedition(settings:ExpeditionSettings){const r=this._room,parsed=expeditionSettings(settings);if(!parsed||!r?.capabilities?.expeditionRacing||r.phase!=='lobby'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'set-expedition',settings:parsed,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  setVoyager(settings:VoyagerSettings){const r=this._room,parsed=voyagerSettings(settings);if(!parsed||!r?.capabilities?.voyagerRacing||r.phase!=='lobby'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'set-voyager',settings:parsed,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  setVsc(active:boolean){const r=this._room;if(typeof active!=='boolean'||!r?.voyager?.settings.vsc||r.phase!=='racing'||!r.matchId||r.hostId!==this.selfId||this.isSpectator)return false;return this.command({type:'voyager-vsc',roomCode:r.code,matchId:r.matchId,trackRevision:r.trackRevision,seq:++this.voyagerSeq,active});}
  setSummit(settings:SummitSettings){const r=this._room,parsed=summitSettings(settings);if(!parsed||!r?.capabilities?.summit||r.phase!=='lobby'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'set-summit',settings:parsed,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  nextWeekend(){const r=this._room;if(!r?.capabilities?.summit||!r.summit?.settings.weekend||r.summit.stage!=='qualifying'||r.phase!=='results'||r.hostId!==this.selfId||!r.hostManagement||this.isSpectator)return false;return this.command({type:'next-weekend',roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});}
  setPitStrategy(armed:boolean,compound:SummitTyre,service:AtlasPitService='tyres'){const r=this._room,p=r?.players.find(v=>v.id===this.selfId);if(!r?.capabilities?.summit||(!r.summit?.settings.endurance&&(!r.voyager||r.voyager.settings.weather==='legacy')&&!r.atlas?.settings.damage)||r.summit?.stage==='qualifying'||r.phase!=='racing'||!r.matchId||!p||p.dnf||p.finishMs!==null||!p.loaded||p.summit?.pitUntil&&p.summit.pitUntil>this.serverNow()||this.isSpectator||!ATLAS_PIT_SERVICES.includes(service)||service!=='tyres'&&!r.atlas?.settings.damage||service!=='repair'&&!r.summit?.settings.endurance&&(!r.voyager||r.voyager.settings.weather==='legacy'))return false;return this.command({type:'summit-pit',roomCode:r.code,matchId:r.matchId,trackRevision:r.trackRevision,seq:++this.summitSeq,armed,compound,...(r.capabilities?.atlasRacing?{service}:{})});}
  async watch(code: string, name: string) {
    if (!this.horizonAvailable) throw Error('請先連線確認這個服務提供觀戰功能。');
    const normalized=code.trim().toUpperCase(); if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) throw Error('請輸入正確的 6 碼房間碼。');
    await this.enter('watch', { type:'watch', ...identity, code:normalized, name:this.cleanName(name) });
  }
  async claimSpectatorSeat() {
    const r=this._room; if (!this.isSpectator || !r?.capabilities?.horizon || !r.hostManagement) throw Error('目前沒有可轉入的觀眾身分。');
    await this.enter('claim-seat', { type:'claim-seat', roomCode:r.code, expectedLobbyRevision:r.hostManagement.lobbyRevision });
  }
  async createConfigured(name: string, preset: RoomPreset) {
    const parsed=parseRoomPreset(preset); if(!this.horizonAvailable || !parsed) throw Error('目前服務或範本不支援這項設定。');
    await this.enter('create-configured', { type:'create-configured', ...identity, name:this.cleanName(name), preset:parsed });
  }
  setHorizon(horizon: HorizonSettings) {
    const r=this._room,parsed=parseHorizon(horizon); if (!parsed||this.isSpectator||!r?.capabilities?.horizon||!r.hostManagement||r.phase!=='lobby'||r.hostId!==this._selfId||r.series?.locked) return false;
    return this.command({type:'set-horizon',horizon:parsed,roomCode:r.code,expectedLobbyRevision:r.hostManagement.lobbyRevision});
  }
  recoverBlock() {
    const r=this._room; if(!r?.matchId||!r.players.find(p=>p.id===this._selfId)?.block?.ghost)return false;
    return this.command({type:'recover-block',roomCode:r.code,matchId:r.matchId});
  }
  /** Changes on disconnect and authenticated welcome, including same-room resume. */
  get connectionGeneration() { return this._connectionGeneration; }
  get hasSavedSession() { return this.readSession() !== null; }
  serverNow() { return Date.now() + this.offset; }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    listener(this);
    return () => { this.listeners.delete(listener); };
  }
  onSnapshot(listener: SnapshotListener) {
    this.snapshotListeners.add(listener);
    return () => { this.snapshotListeners.delete(listener); };
  }
  onSeriesCheckpoint(listener: (checkpoint: { token: string; expiresAt: number; persistent: boolean }) => void) {
    this.checkpointListeners.add(listener); return () => { this.checkpointListeners.delete(listener); };
  }
  get savedSeriesSeats(): { playerId: string; name: string; seriesId: string; key: string }[] {
    return this.readSeriesSeats().map(seat => ({ playerId: seat.playerId, name: seat.name, seriesId: seat.seriesId, key: `${seat.seriesId}:${seat.playerId}` }));
  }
  private readSeriesSeats(): (SavedSession & { name: string; seriesId: string })[] {
    try {
      const raw = localStorage.getItem(SERIES_SEATS_KEY); if (!raw || raw.length > 20000) return [];
      const seats: unknown = JSON.parse(raw); if (!Array.isArray(seats)) return [];
      return seats.filter((s): s is SavedSession & { name: string; seriesId: string } => object(s) && s.endpoint === this.url && s.version === PROTOCOL_VERSION
        && s.physics === PHYSICS_VERSION && s.catalogStamp === CATALOG_STAMP && typeof s.name === 'string' && s.name.length <= 64
        && typeof s.seriesId === 'string' && s.seriesId.length > 0 && s.seriesId.length <= 128
        && typeof s.playerId === 'string' && s.playerId.length <= 128 && typeof s.token === 'string' && s.token.length >= 8 && s.token.length <= 512
        && finite(s.savedAt) && Date.now() - s.savedAt >= 0 && Date.now() - s.savedAt < 7 * 86400000).slice(0, 10);
    } catch { return []; }
  }
  private preserveSeriesSeat(room: RoomSnapshot) {
    if (!room.series?.locked || !this.credentials || !room.series.entrants.some(e => e.playerId === this._selfId)) return;
    const me = room.players.find(p => p.id === this._selfId); if (!me) return;
    const key = `${room.series.id}:${room.series.revision}:${this.credentials.token}`;
    if (key === this.preservedSeatKey) return; this.preservedSeatKey = key;
    const seats = this.readSeriesSeats(), stable = seats.find(s => s.playerId === this._selfId && s.seriesId === room.series!.id);
    try { localStorage.setItem(SERIES_SEATS_KEY, JSON.stringify([{ ...(stable ?? this.credentials), seriesId: room.series.id, name: me.name, savedAt: Date.now() },
      ...seats.filter(s => s.playerId !== this._selfId || s.seriesId !== room.series!.id)].slice(0, 10))); } catch { /* 本次分頁仍可續接。 */ }
  }
  async claimSeriesSeat(code: string, playerId: string) {
    const normalized = code.trim().toUpperCase(), seat = this.readSeriesSeats().find(s => s.playerId === playerId || `${s.seriesId}:${s.playerId}` === playerId);
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized) || !seat) throw new Error('請輸入續賽新房碼，並選擇原車手席位。');
    await this.enter('resume', { type: 'resume', ...identity, code: normalized, playerId: seat.playerId, token: seat.token });
  }
  async resumeSeries(token: string, name: string) {
    if (!token || token.length > 65536) throw new Error('續賽檔案格式不正確，請重新選擇。');
    await this.enter('resume-series', { type: 'resume-series', ...identity, token, name: this.cleanName(name) });
  }
  configureEvent(mode: 'race' | 'time-trial' | 'pursuit' | 'teams', durationSeconds: 180 | 300, releaseDelays: Record<string, 0 | 3 | 5 | 10>) {
    const room = this.evolutionLobby(true); if (!room || room.series?.locked) return false;
    return this.command({ type: 'configure-event', mode, durationSeconds, releaseDelays, roomCode: room.code, expectedLobbyRevision: room.hostManagement!.lobbyRevision });
  }
  selectTeam(team: 'red' | 'blue') {
    const room = this.evolutionLobby(false); if (!room || room.series?.locked) return false;
    return this.command({ type: 'select-team', team, roomCode: room.code, expectedLobbyRevision: room.hostManagement!.lobbyRevision });
  }
  voteTrack(trackId: string) {
    const room = this.evolutionLobby(false); if (!room || !room.evolution || !getMultiplayerTrack(trackId)) return false;
    return this.command({ type: 'vote-track', trackId, expectedVoteRevision: room.evolution.vote.revision, roomCode: room.code, expectedLobbyRevision: room.hostManagement!.lobbyRevision });
  }
  resolveVote() {
    const room = this.evolutionLobby(true); if (!room) return false;
    return this.command({ type: 'resolve-vote', roomCode: room.code, expectedLobbyRevision: room.hostManagement!.lobbyRevision });
  }
  randomSeries(count: 3 | 4 | 5) {
    const room = this.evolutionLobby(true); if (!room || room.series?.locked) return false;
    return this.command({ type: 'random-series', count, roomCode: room.code, expectedLobbyRevision: room.hostManagement!.lobbyRevision });
  }
  checkpointSeries() {
    const room = this._room;
    if (!room?.capabilities?.seriesResume || !room.series || room.series.complete || !room.matchId || room.phase !== 'results' || room.hostId !== this._selfId) return false;
    return this.command({ type: 'checkpoint-series', roomCode: room.code, matchId: room.matchId, expectedSeriesRevision: room.series.revision });
  }
  private evolutionLobby(host: boolean) {
    const room = this._room;
    return room?.phase === 'lobby' && room.hostManagement && room.capabilities?.evolution && (!host || room.hostId === this._selfId) ? room : null;
  }

  /** 單獨建立傳輸；constructor 不會自動開啟 socket。 */
  connect(): Promise<void> {
    this.wantsConnection = true;
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connection) return this.connection;
    this.clearReconnectTimer();
    this._status = this.reconnectDeadline ? 'reconnecting' : 'connecting';
    if (!this.reconnectDeadline) this._error = null;
    this.notify();
    const promise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve; this.connectReject = reject;
    });
    this.connection = promise;
    let socket: WebSocket;
    try { socket = new WebSocket(this.url); }
    catch {
      const reject = this.connectReject;
      this.connection = null;
      this.connectResolve = this.connectReject = null;
      this._status = 'disconnected'; this._error = '無法建立連線，請確認伺服器網址。'; this.notify();
      reject?.(new Error(this._error));
      return promise;
    }
    this.socket = socket;
    const remaining = this.reconnectDeadline ? Math.max(1, this.reconnectDeadline - clock()) : CONNECT_TIMEOUT;
    this.connectTimer = setTimeout(() => this.failSocket(socket, '連線逾時，請確認伺服器已啟動後再試。'), Math.min(CONNECT_TIMEOUT, remaining));
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      const done = this.connectResolve;
      this.connection = null; this.connectResolve = this.connectReject = null;
      this._status = this.reconnectDeadline ? 'reconnecting' : 'connected';
      this.lastInbound = clock();
      this.startHeartbeat(socket);
      this.notify(); done?.();
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      this.lastInbound = clock();
      try { this.receive(event.data); }
      catch (error) {
        if (!this.isSpectator) this.clearSession();
        this._room = this._snapshot = null; this._selfId = null;
        this.wantsConnection = false;
        this.failSocket(socket, error instanceof Error ? error.message : '伺服器回傳的資料無法讀取。');
      }
    });
    socket.addEventListener('close', () => this.closed(socket));
    socket.addEventListener('error', () => this.failSocket(socket, '連線失敗，請確認伺服器已啟動及網路可用。'));
    return promise;
  }

  async create(name: string, laps: 1 | 3 | 5 = 3, trackId = DEFAULT_MULTIPLAYER_TRACK_ID) {
    if (![1, 3, 5].includes(laps)) throw new Error('請選擇 1、3 或 5 圈。');
    if (!getMultiplayerTrack(trackId)) throw new Error('請選擇可用的比賽地圖。');
    await this.enter('create', { type: 'create', ...identity, name: this.cleanName(name), laps, trackId });
  }
  async join(code: string, name: string) {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) throw new Error('請輸入正確的 6 碼房間碼。');
    await this.enter('join', { type: 'join', ...identity, code: normalized, name: this.cleanName(name) });
  }

  /** 使用者按「重新連線」後才呼叫；不會在開頁時自動建立連線。 */
  async restore(): Promise<boolean> {
    if (this._room && this.authenticated) return true;
    const session = this.credentials ?? this.readSession();
    if (!session) return false;
    this.credentials = session;
    await this.enter('resume', { type: 'resume', ...identity, code: session.code, playerId: session.playerId, token: session.token });
    return true;
  }

  selectTrack(trackId: string) {
    if (!getMultiplayerTrack(trackId)) { this._error = '請選擇可用的比賽地圖。'; this.notify(); return false; }
    if (this._room && (this._room.hostId !== this._selfId || this._room.phase !== 'lobby')) {
      this._error = '只有房主能在大廳更換地圖。'; this.notify(); return false;
    }
    return this.command({ type: 'select-track', trackId, expectedRevision: this._room?.trackRevision ?? 0 });
  }
  setLaps(laps: 1 | 3 | 5) {
    const room = this.lobbyOptions('lobbyOptions');
    return !!room && [1, 3, 5].includes(laps) && this.command({ type: 'set-laps', laps, roomCode: room.code, expectedLobbyRevision: room.hostManagement!.lobbyRevision });
  }
  setRoomRules(rules: MultiplayerRoomRules) {
    const room = this._room, parsed = parseRoomRules(rules);
    if (!parsed || !room?.capabilities?.roomRules || !room.hostManagement || room.hostId !== this._selfId || room.phase !== 'lobby' || room.series?.locked) return false;
    return this.command({ type: 'set-room-rules', roomRules: parsed, roomCode: room.code, expectedLobbyRevision: room.hostManagement.lobbyRevision });
  }
  configureSeries(trackIds: string[]) {
    const room = this.lobbyOptions('championship');
    if (!room || room.series?.locked || !validSeriesTracks(trackIds)) return false;
    return this.command({ type: 'configure-series', trackIds: [...trackIds], roomCode: room.code, expectedLobbyRevision: room.hostManagement!.lobbyRevision });
  }
  endSeries() {
    const room = this._room;
    if (!room?.capabilities?.championship || !room.hostManagement || !room.series || room.hostId !== this._selfId || !['lobby', 'results'].includes(room.phase)) return false;
    return this.command({ type: 'end-series', roomCode: room.code, expectedLobbyRevision: room.hostManagement.lobbyRevision });
  }
  nextSeries() {
    const room = this._room;
    if (!room?.capabilities?.championship || !room.series || room.series.complete || !room.matchId || room.phase !== 'results' || room.hostId !== this._selfId) return false;
    return this.command({ type: 'next-series', roomCode: room.code, matchId: room.matchId, expectedSeriesRevision: room.series.revision });
  }
  private lobbyOptions(capability: 'lobbyOptions' | 'championship') {
    const room = this._room;
    return room?.phase === 'lobby' && room.hostManagement && room.capabilities?.[capability] && room.hostId === this._selfId ? room : null;
  }
  trackLoaded(selection: Pick<RoomSnapshot, 'trackId' | 'trackStamp' | 'trackRevision'>, generation = this._connectionGeneration) {
    const room = this._room;
    if (generation !== this._connectionGeneration || !room || room.trackId !== selection.trackId || room.trackStamp !== selection.trackStamp || room.trackRevision !== selection.trackRevision) return false;
    return this.command({ type: 'track-loaded', trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
  }
  ready(ready: boolean) {
    const room = this._room;
    if (ready && room && !room.players.find(player => player.id === this._selfId)?.loaded) {
      this._error = '請等目前地圖載入完成後再準備。'; this.notify(); return false;
    }
    return this.command({ type: 'ready', ready, trackRevision: room?.trackRevision ?? 0, trackStamp: room?.trackStamp ?? '',...(room?.meridian?{meridianRevision:room.meridian.revision,lobbyRevision:room.hostManagement?.lobbyRevision??0}:{}),...(room?.cup?{cupReady:{cupId:room.cup.id,cupRevision:room.cup.revision,lobbyRevision:room.hostManagement?.lobbyRevision??0}}:{}) });
  }
  start() { return this.command({ type: 'start', trackRevision: this._room?.trackRevision ?? 0 }); }
  reset() { return this.command({ type: 'reset' }); }
  captureCupIntent():CupIntent|null {
    const r=this._room;
    return r?.capabilities?.frontierCup===FRONTIER_CUP_VERSION&&r.hostManagement&&r.hostId===this._selfId?{roomCode:r.code,cupId:r.cup?.id??null,expectedCupRevision:r.cup?.revision??0,expectedLobbyRevision:r.hostManagement.lobbyRevision,matchId:r.matchId,trackRevision:r.trackRevision}:null;
  }
  cupCommand(type:CupCommand,intent:CupIntent|null=this.captureCupIntent()) {
    const current=this.captureCupIntent();
    return !!intent&&!!current&&Object.keys(current).every(k=>current[k as keyof CupIntent]===intent[k as keyof CupIntent])&&this.command({type,...intent});
  }
  kickPlayer(targetPlayerId: string) { return this.hostCommand('kick-player', targetPlayerId); }
  transferHost(targetPlayerId: string) { return this.hostCommand('transfer-host', targetPlayerId); }

  private hostCommand(type: 'kick-player' | 'transfer-host', targetPlayerId: string) {
    const room = this._room, target = room?.players.find(player => player.id === targetPlayerId);
    if (!room?.hostManagement || room.phase !== 'lobby' || room.hostId !== this._selfId) {
      this._error = '只有房主能在支援管理功能的大廳操作。'; this.notify(); return false;
    }
    if (!target || target.id === this._selfId || (type === 'transfer-host' && !target.connected)) {
      this._error = '請選擇其他有效車手；交棒對象必須仍在線上。'; this.notify(); return false;
    }
    return this.command({ type, targetPlayerId, roomCode: room.code, expectedLobbyRevision: room.hostManagement.lobbyRevision });
  }

  /** 最多約 30 次／秒；緊急煞車不等待下一個傳送時槽。 */
  sendInput(steer: number, brake: boolean) {
    if (!finite(steer) || !this.authenticated || this._status !== 'connected' || this._room?.phase !== 'racing' || !this._room.matchId || !this._room.players.find(player => player.id === this._selfId)?.loaded) return false;
    const self = this._room.players.find(player => player.id === this._selfId);
    if (self?.eliminated || self?.eliminationWinner || self?.block?.ghost || self?.arena?.active===false || self?.cup?.active===false||self?.meridian?.active===false) return false;
    if (!self || self.dnf || self.finishMs !== null || self.timeTrialDone) return false;
    if (this._room.evolution?.mode === 'pursuit' && this._room.startAt !== null
      && this.serverNow() < this._room.startAt + (this._room.evolution.releaseDelays[self.id] ?? 0) * 1000) return false;
    const now = clock();
    if (now - this.lastInputAt < 1000 / 30 && !(brake && !this.lastInputBrake)) return false;
    if ((this.socket?.bufferedAmount ?? 0) > 65536) {
      if (this.socket) this.failSocket(this.socket, '連線傳輸壅塞，正在重新連線。');
      return false;
    }
    this.lastInputAt = now; this.lastInputBrake = brake;
    return this.send({ type: 'input', matchId: this._room.matchId, trackRevision: this._room.trackRevision, seq: ++this.inputSeq, steer: Math.max(-1, Math.min(1, steer)), brake,...(self.meridian?{driverGeneration:self.meridian.generation}:{}) });
  }

  leave() {
    if (this.authenticated) this.send({ type: 'leave' });
    if (!this.isSpectator) this.clearSession();
    this.spectatorId=null; this.credentials=null;
    this._room = this._snapshot = null; this._selfId = null;
    this.lastRoomTime = -Infinity; this.retiredMatches.clear();
    this._error = null;
    this.disconnect();
  }

  /** 關閉本分頁的傳輸並停止自動重連；保留憑證供重新載入後續接。 */
  disconnect() {
    this.wantsConnection = false; this.authenticated = false;
    this.reconnectDeadline = 0; this.clearReconnectTimer();
    const socket = this.socket;
    if (socket) {
      this.closed(socket, '已中止連線。');
      try { socket.close(1000, 'client disconnect'); } catch { /* socket 已關閉 */ }
    } else {
      this.rejectPending('已中止連線。'); this.clearHeartbeat(); this.clearConnectTimer();
      this._status = 'disconnected'; this.notify();
    }
  }

  private cleanName(name: string) {
    const result = name.trim().replace(/[\u0000-\u001f\u007f]/g, '');
    if (!result || [...result].length > 16) throw new Error('請輸入 1～16 個字的車手名稱。');
    return result;
  }

  private async enter(kind: EntryKind, message: ClientMessage) {
    if (this.entering || this.pending) throw new Error('正在處理房間連線，請稍候。');
    if (this._room && kind !== 'resume' && kind !== 'claim-seat') throw new Error('請先離開目前房間。');
    this.entering = true;
    try {
      await this.connect();
      const id = String(++this.requestSeq);
      await new Promise<void>((resolve, reject) => {
        const remaining = this.reconnectDeadline ? Math.max(1, this.reconnectDeadline - clock()) : ENTRY_TIMEOUT;
        const timer = setTimeout(() => {
          if (this.pending?.id !== id) return;
          this.rejectPending('房間回應逾時，請重新連線後再試。');
          if (this.socket) this.failSocket(this.socket, '房間回應逾時，請重新連線後再試。');
        }, Math.min(ENTRY_TIMEOUT, remaining));
        this.pending = { kind, id, timer, resolve, reject };
        if (!this.send({ ...message, requestId: id } as ClientMessage)) this.rejectPending('連線已中斷，請再試一次。');
      });
    } catch (error) {
      this._error = error instanceof Error ? error.message : '無法加入房間。';
      this.notify(); throw error;
    } finally { this.entering = false; }
  }

  private command(message: ClientMessage) {
    if (this.isSpectator && !['track-loaded','leave'].includes(message.type)) { this._error='觀眾不能操作本場比賽。'; this.notify(); return false; }
    if (!this.authenticated || !this._room || this._status !== 'connected') {
      this._error = '尚未連上房間，請先建立或加入房間。'; this.notify(); return false;
    }
    this._error = null;
    const sent = this.send(message); this.notify(); return sent;
  }
  private send(message: ClientMessage) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(message)); return true; }
    catch { this.failSocket(socket, '連線中斷，正在重新連線。'); return false; }
  }

  private receive(data: unknown) {
    if (typeof data !== 'string' || data.length > 131072) throw new Error('伺服器回傳的訊息格式不正確。');
    const raw: unknown = JSON.parse(data);
    if (!object(raw) || typeof raw.type !== 'string') throw new Error('伺服器回傳的訊息格式不正確。');
    if(this.checkpoints.receive(raw))return;
    const message = raw as unknown as ServerMessage;
    if(message.type==='replay-part'){
      const p=this.replayPending;if(!p)return;
      if(this._room?.phase!=='results'||this._room.replay?.id!==p.id||message.replayId!==p.id||message.offset!==p.offset||!Number.isSafeInteger(message.totalChars)||message.totalChars<1||message.totalChars>REPLAY_MAX_CHARS
        ||typeof message.text!=='string'||!message.text.length||message.text.length>REPLAY_CHUNK_CHARS||p.offset+message.text.length>message.totalChars||p.total!==null&&p.total!==message.totalChars){this.rejectReplay('回放分段格式不正確，請重新取得。');return;}
      p.total=message.totalChars;p.chunks.push(message.text);p.offset+=message.text.length;
      if(p.offset===p.total){
        this.replayPending=null;clearTimeout(p.timer);
        try{const replay=decodeMultiplayerReplay(p.chunks.join(''));if(replay.id!==p.id)throw Error('回放識別不一致。');p.resolve(replay);}catch(e){p.reject(e instanceof Error?e:Error('回放檔無效。'));}
      }else if(message.text.length!==REPLAY_CHUNK_CHARS||!this.send({type:'replay-chunk',replayId:p.id,offset:p.offset,requestId:`replay:${p.id}`}))this.rejectReplay('回放傳輸中斷，請重新取得。');
      return;
    }
    if (message.type === 'series-checkpoint') {
      if (!this.authenticated || this._room?.hostId !== this._selfId || this._room.phase !== 'results' || !this._room.series) return;
      if (typeof message.token !== 'string' || message.token.length < 16 || message.token.length > 65536 || !finite(message.expiresAt)
        || message.expiresAt <= this.serverNow() || typeof message.persistent !== 'boolean') throw new Error('續賽檔案格式不正確。');
      for (const listener of this.checkpointListeners) listener({ token: message.token, expiresAt: message.expiresAt, persistent: message.persistent });
      return;
    }
    if (message.type === 'pong') {
      if (!finite(message.sentAt) || !finite(message.serverTime)) return;
      const began = this.pings.get(message.sentAt);
      if (began === undefined) return;
      this.pings.delete(message.sentAt);
      this._horizonAvailable = message.capabilities?.horizon === true;
      const now = clock(), rtt = Math.max(0, now - began);
      const sample = { rtt, offset: message.serverTime - (message.sentAt + rtt / 2), at: now };
      this.clockSamples = [...this.clockSamples.filter(s => now - s.at < 15000), sample].slice(-8);
      const best = this.clockSamples.reduce((a, b) => a.rtt <= b.rtt ? a : b);
      this.offset = best.offset; this._rttMs = rtt; this.notify(); return;
    }
    if (message.type === 'error') {
      if(message.requestId?.startsWith('replay:'))this.rejectReplay(typeof message.message==='string'?message.message:'無法取得回放。');
      const text = typeof message.message === 'string' ? message.message.slice(0, 300) : '房間操作失敗，請再試一次。';
      if (this.pending && message.requestId !== this.pending.id) return;
      const resuming = this.pending?.kind === 'resume';
      this._error = text;
      if (resuming) {
        this.clearSession(); this._room = this._snapshot = null; this._selfId = null;
        this.wantsConnection = false; this.reconnectDeadline = 0; this.clearReconnectTimer();
      }
      this.rejectPending(text); this.notify();
      if (resuming && this.socket) this.failSocket(this.socket, text);
      return;
    }
    if (message.type === 'watching') {
      if (!this.pending || this.pending.kind!=='watch' || message.requestId!==this.pending.id) return;
      this.validateRoom(message.room);
      if (!message.room.capabilities?.horizon || typeof message.spectatorId!=='string' || !message.room.spectators?.some(v=>v.id===message.spectatorId)) throw Error('服務未提供有效觀眾身分。');
      this.credentials=null;this.spectatorId=message.spectatorId;this._selfId=message.spectatorId;this.authenticated=true;this._connectionGeneration++;
      this._status='connected';this._error=null;this.lastRoomTime=-Infinity;this._horizonAvailable=true;
      if(!this.clockSamples.length)this.offset=message.room.serverTime-Date.now();
      this.acceptRoom(message.room,true);const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.resolve();this.notify();return;
    }
    if (message.type === 'welcome') {
      if (!this.pending || message.requestId !== this.pending.id) return;
      this.validateRoom(message.room);
      if (typeof message.playerId !== 'string' || typeof message.resumeToken !== 'string' || message.resumeToken.length < 8 || message.resumeToken.length > 512 || !message.room.players.some(p => p.id === message.playerId)) throw new Error('伺服器未提供有效的房間身分。');
      this._selfId = message.playerId;
      this.spectatorId=null;
      this.credentials = { endpoint: this.url, code: message.room.code, playerId: message.playerId, token: message.resumeToken, ...identity, savedAt: Date.now() };
      this.persistSession();
      this.authenticated = true; this.reconnectDeadline = 0; this.reconnectAttempts = 0;
      this._connectionGeneration++;
      this._status = 'connected'; this._error = null;
      this.lastRoomTime = -Infinity;
      if (!this.clockSamples.length) this.offset = message.room.serverTime - Date.now();
      this.acceptRoom(message.room, true);
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.resolve();
      this.notify(); return;
    }
    if (message.type === 'room' || message.type === 'snapshot') {
      if (!this.authenticated) return;
      this.validateRoom(message.room);
      this.acceptRoom(message.room, message.type === 'snapshot'); return;
    }
    if (message.type === 'left') {
      if (message.reason === 'kicked') {
        if (typeof message.roomCode !== 'string' || message.roomCode !== this._room?.code) return;
        this.clearSession(); this._room = this._snapshot = null; this._selfId = null;
        this.lastRoomTime = -Infinity; this.retiredMatches.clear(); this.disconnect();
        this._error = '房主已將你移出房間；可重新輸入房碼加入。'; this.notify();
      } else this.leave();
      return;
    }
    throw new Error('伺服器與遊戲通訊版本不相容，請重新載入。');
  }

  private validateRoom(room: unknown): asserts room is RoomSnapshot {
    if (!object(room) || room.version !== PROTOCOL_VERSION || room.physics !== PHYSICS_VERSION || room.catalogStamp !== CATALOG_STAMP) throw new Error('遊戲與伺服器版本或地圖清單不一致，請更新後重新連線。');
    const descriptor = typeof room.trackId === 'string' ? getMultiplayerTrack(room.trackId) : undefined;
    if (!descriptor || room.trackStamp !== descriptor.trackStamp || !Number.isSafeInteger(room.trackRevision) || Number(room.trackRevision) < 1) throw new Error('伺服器提供的地圖版本不一致，請更新後重新連線。');
    if (typeof room.code !== 'string' || typeof room.hostId !== 'string' || !['lobby', 'countdown', 'racing', 'results'].includes(String(room.phase)) || !finite(room.serverTime) || !finite(room.trackLength) || room.trackLength <= 0 || ![1, 3, 5].includes(Number(room.laps)) || (room.matchId !== null && typeof room.matchId !== 'string') || (room.startAt !== null && !finite(room.startAt)) || !Array.isArray(room.players) || room.players.length < (object(room.capabilities)&&room.capabilities.horizon===true?0:1) || room.players.length > 4) throw new Error('房間資料格式不正確，請重新連線。');
    validateHorizonSnapshot(room);
    const replayCap=object(room.capabilities)?room.capabilities.replay:undefined;
    if(replayCap!==undefined&&replayCap!==true||'replay' in room&&(replayCap!==true||room.replay!==null&&!validReplayDescriptor(room.replay)))throw Error('回放能力或錄製狀態格式不正確。');
    validateArenaSnapshot(room);
    validateSummit(room);validateAtlas(room);validateExpedition(room);validateCupSnapshot(room);validateMeridianRacing(room);
    const meridianQual=object(room.meridian)&&room.meridian.stage==='qualifying';
    const summit=object(room.summit)?room.summit:undefined,summitQual=summit?.stage==='qualifying'||meridianQual,summitEndurance=!!summit&&!summitQual&&object(summit.settings)&&Number(summit.settings.endurance)>0,summitTimed=summitQual||summitEndurance;
    const practice=object(room.voyager)&&object(room.voyager.settings)&&Number(room.voyager.settings.practiceSeconds)>0;
    const elimination=object(room.horizon)&&room.horizon.elimination===true;
    if ('hostManagement' in room && (!object(room.hostManagement) || !Number.isSafeInteger(room.hostManagement.lobbyRevision) || Number(room.hostManagement.lobbyRevision) < 1)) throw new Error('房主管理版本格式不正確，請重新連線。');
    if ('capabilities' in room && (!object(room.capabilities) || room.capabilities.lobbyOptions !== true || room.capabilities.championship !== true || !object(room.hostManagement))) throw new Error('房間功能能力格式不正確，請重新連線。');
    const rulesCap = object(room.capabilities) ? room.capabilities.roomRules : undefined;
    if ((rulesCap !== undefined && rulesCap !== true) || (rulesCap === true ? !parseRoomRules(room.roomRules) : 'roomRules' in room)) throw new Error('房間規則能力與設定不一致，請更新後重新連線。');
    const evo = room.evolution, evoCap = object(room.capabilities) ? room.capabilities.evolution : undefined;
    if (evoCap !== undefined && evoCap !== true || evoCap === true && (!object(evo) || !['race', 'time-trial', 'pursuit', 'teams'].includes(String(evo.mode))
      || ![180, 300].includes(Number(evo.durationSeconds)) || !object(evo.releaseDelays) || !object(evo.teams) || !object(evo.vote)
      || !Number.isSafeInteger(evo.vote.revision) || Number(evo.vote.revision) < 1 || !object(evo.vote.ballots)
      || Object.values(evo.releaseDelays).some(value => ![0, 3, 5, 10].includes(Number(value)))
      || Object.values(evo.teams).some(value => value !== 'red' && value !== 'blue')
      || Object.values(evo.vote.ballots).some(value => typeof value !== 'string' || !getMultiplayerTrack(value)))
      || evoCap !== true && 'evolution' in room) throw new Error('多人玩法設定格式不正確，請更新後重新連線。');
    if (object(evo) && 'teamStandings' in evo && (!Array.isArray(evo.teamStandings) || ![0, 2].includes(evo.teamStandings.length)
      || new Set(evo.teamStandings.map(t => object(t) ? t.team : null)).size !== evo.teamStandings.length
      || evo.teamStandings.some((t, index) => !object(t) || !['red', 'blue'].includes(String(t.team)) || t.rank !== index + 1
        || !['points', 'roundWins', 'wins', 'finishes', 'elapsedMs'].every(k => finite(t[k]) && Number(t[k]) >= 0 && Number(t[k]) <= 864000000)))) throw new Error('隊伍積分格式不正確，請重新連線。');
    const resumeCap = object(room.capabilities) ? room.capabilities.seriesResume : undefined;
    if (resumeCap !== undefined && (!object(resumeCap) || typeof resumeCap.persistent !== 'boolean' || !Number.isSafeInteger(resumeCap.ttlSeconds)
      || Number(resumeCap.ttlSeconds) < 1 || Number(resumeCap.ttlSeconds) > 2592000)) throw new Error('續賽能力格式不正確，請重新連線。');
    const timeTrial = object(evo) && evo.mode === 'time-trial';
    if ('series' in room && room.series !== null && (!object(room.capabilities) || room.capabilities.championship !== true || !validSeries(room.series, String(room.trackId), String(room.phase), room.matchId as string | null, Number(room.laps)))) throw new Error('系列賽成績格式不正確，請重新連線。');
    // Additive v2: absent metadata means an older server. If provided, validate
    // the complete pair rather than silently displaying an untrusted deadline.
    if ('deadlineAt' in room || 'deadlineReason' in room) {
      const validDeadline = room.deadlineAt === null && room.deadlineReason === null && room.phase === 'lobby'
        || finite(room.deadlineAt) && finite(room.startAt) && room.deadlineAt >= room.startAt && room.phase !== 'lobby'
          && ['race-timeout', 'finish-timeout', 'time-trial-timeout', 'time-trial-grace'].includes(String(room.deadlineReason));
      if (!validDeadline) throw new Error('比賽截止時間格式不正確，請重新連線。');
    }
    const ids = new Set<string>();
    for (const player of room.players) {
      if (!object(player) || typeof player.id !== 'string' || ids.has(player.id) || typeof player.name !== 'string' || player.name.length > 64 || typeof player.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(player.color) || typeof player.ready !== 'boolean' || typeof player.loaded !== 'boolean' || typeof player.connected !== 'boolean' || typeof player.dnf !== 'boolean' || !finite(player.ackSeq) || !Number.isSafeInteger(player.ackSeq) || player.ackSeq < -1 || !finite(player.completedLaps) || !finite(player.progress) || !finite(player.rank) || (player.finishMs !== null && !finite(player.finishMs)) || !object(player.car) || !object(player.car.pos) || !['x', 'z', 'h', 'v', 'steer'].every(key => finite((player.car as Record<string, unknown>)[key])) || !['i', 's', 'lat'].every(key => finite((player.car as { pos: Record<string, unknown> }).pos[key]))) throw new Error('車手狀態格式不正確，請重新連線。');
      if ('dnfReason' in player && (player.dnfReason === null ? player.dnf
        : !player.dnf || player.finishMs !== null || typeof player.dnfReason !== 'string' || !['race-timeout', 'finish-timeout', 'disconnect-expired', 'left', 'server-stall', 'no-valid-lap', 'time-trial-no-lap'].includes(player.dnfReason))) throw new Error('未完賽原因格式不正確，請重新連線。');
      if ('timeTrialDone' in player && (!timeTrial || typeof player.timeTrialDone !== 'boolean')) throw new Error('限時賽結束狀態格式不正確，請重新連線。');
      // Older v2 servers omit both fields. If either is present, require the
      // complete, bounded and internally consistent server timing record.
      if ('lapTimesMs' in player || 'bestLapMs' in player) {
        const times = player.lapTimesMs;
        const validLaps=practice&&object(player.voyager)?player.voyager.validLaps:meridianQual&&object(player.meridian)?player.meridian.validLaps:summitQual&&object(player.summit)?player.summit.validLaps:null;
        const bestTimes=summitQual||practice?validLaps:times;
        // Each authoritative lap and the total are independently rounded to 0.001 ms.
        const lapTotalTolerance = Math.max(0.003, (player.completedLaps + 1) * 0.0005) + 1e-7;
        if (!Array.isArray(times) || !Array.isArray(bestTimes) || typeof room.laps !== 'number' || !Number.isInteger(player.completedLaps) || player.completedLaps < 0 || player.completedLaps > (timeTrial || elimination || summitTimed || practice ? 128 : room.laps)
          || times.length !== player.completedLaps || times.length > (timeTrial || elimination || summitTimed || practice ? 128 : 5) || [...times].some(ms => !finite(ms) || ms <= 0 || ms > 86_400_000)
          || ((room.phase === 'lobby' || room.phase === 'countdown') && times.length > 0)
          || (bestTimes.length === 0 ? player.bestLapMs !== null : !finite(player.bestLapMs) || Math.abs(player.bestLapMs - Math.min(...bestTimes.map(Number))) > 0.001)
          || (summitQual||practice)&&(bestTimes.length>times.length||bestTimes.some(ms=>!times.includes(ms)))
          || (!timeTrial && !elimination && !summitTimed && !practice && player.completedLaps === room.laps && player.finishMs === null)
          || (player.finishMs !== null && (timeTrial||summitQual||practice ? !bestTimes.length || player.finishMs !== player.bestLapMs
            : (!summitEndurance&&player.completedLaps !== Number(room.laps)) || summitEndurance&&(player.finishMs<Number(summit!.durationSeconds)*1000||player.finishMs>Number(summit!.durationSeconds)*1000+120000) || player.finishMs <= 0 || player.finishMs > 86_400_000
            || Math.abs(times.reduce<number>((sum, ms) => sum + ms, 0) - (object(evo) && evo.mode === 'pursuit' ? Number(player.netFinishMs) : player.finishMs)) > lapTotalTolerance))) throw new Error('逐圈成績格式不正確，請重新連線。');
      }
      if (object(evo) && evo.mode === 'pursuit' && (player.finishMs !== null
        ? !finite(player.netFinishMs) || player.netFinishMs <= 0 || Math.abs(player.finishMs - player.netFinishMs - Number((evo.releaseDelays as Record<string, unknown>)[player.id] ?? 0) * 1000) > 0.003
        : player.netFinishMs !== null && player.netFinishMs !== undefined)) throw new Error('讓秒完賽時間格式不正確，請重新連線。');
      ids.add(player.id);
    }
  }
  private acceptRoom(room: RoomSnapshot, snapshot: boolean) {

    this._horizonAvailable=room.capabilities?.horizon===true;
    if (this.credentials && room.code !== this.credentials.code) return;
    const previousRoom = this._room;
    if (previousRoom?.hostManagement && room.hostManagement && room.hostManagement.lobbyRevision < previousRoom.hostManagement.lobbyRevision) return;
    if (previousRoom?.series && room.series?.id === previousRoom.series.id && room.series.revision < previousRoom.series.revision) return;
    if (previousRoom?.cup && room.cup?.id === previousRoom.cup.id && room.cup.revision < previousRoom.cup.revision) return;
    if (previousRoom && room.trackRevision < previousRoom.trackRevision) return;
    const changedTrack = !!previousRoom && room.trackRevision !== previousRoom.trackRevision;
    if (previousRoom && !changedTrack && (room.trackId !== previousRoom.trackId || room.trackStamp !== previousRoom.trackStamp)) throw new Error('地圖更新順序不正確，請重新連線。');
    if ((!changedTrack && room.serverTime < this.lastRoomTime) || (room.matchId && this.retiredMatches.has(room.matchId))) return;
    const previous = this._room?.matchId;
    if (previous && previous !== room.matchId) {
      this.retiredMatches.add(previous);
      if (this.retiredMatches.size > 16) this.retiredMatches.delete(this.retiredMatches.values().next().value!);
    }
    if(this.replayPending&&(room.phase!=='results'||room.replay?.id!==this.replayPending.id))this.rejectReplay('房間已開始下一場，回放傳輸已停止。');
    this.lastRoomTime = room.serverTime;
    this._room = room;
    this.preserveSeriesSeat(room);
    if (changedTrack) {
      this._snapshot = null; this.inputSeq = 0; this.lastInputAt = -Infinity; this.lastInputBrake = true;
    }
    const me = room.players.find(player => player.id === this._selfId);
    if (me) this.inputSeq = Math.max(this.inputSeq, me.ackSeq);
    if (snapshot) {
      this._snapshot = room;
      for (const listener of this.snapshotListeners) listener(room);
    }
    this.notify();
  }

  private startHeartbeat(socket: WebSocket) {
    this.clearHeartbeat();
    const ping = () => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (clock() - this.lastInbound > HEARTBEAT_TIMEOUT) { this.failSocket(socket, '伺服器暫時沒有回應，正在重新連線。'); return; }
      const sentAt = Date.now();
      this.pings.set(sentAt, clock());
      if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value!);
      this.send({ type: 'ping', sentAt });
    };
    ping(); this.heartbeat = setInterval(ping, HEARTBEAT_INTERVAL);
  }
  private failSocket(socket: WebSocket, message: string) {
    if (this.socket !== socket) return;
    this._error = message;
    this.closed(socket, message);
    try { socket.close(1000, 'connection interrupted'); } catch { /* socket 已關閉 */ }
  }
  private closed(socket: WebSocket, reason = '連線中斷，正在重新連線。') {
    if (this.socket !== socket) return;
    this.socket = null; this.authenticated = false;
    this.rejectReplay('連線已中斷，回放尚未取得。');
    this._connectionGeneration++;
    this.clearConnectTimer(); this.clearHeartbeat();
    const reject = this.connectReject;
    this.connection = null; this.connectResolve = this.connectReject = null;
    reject?.(new Error(reason)); this.rejectPending(reason);
    if (this.wantsConnection && this.credentials) this.scheduleReconnect();
    else { this._status = 'disconnected'; if (this.wantsConnection) this._error = reason; this.notify(); }
  }
  private scheduleReconnect() {
    if (!this.wantsConnection || !this.credentials || this.reconnectTimer) return;
    if (!this.reconnectDeadline) this.reconnectDeadline = clock() + (this._room?.cup?15000:RECONNECT_WINDOW);
    const remaining = this.reconnectDeadline - clock();
    if (remaining <= 0) {
      const seconds=this._room?.cup?15:10;
      this.wantsConnection = false; this.clearSession(); this.reconnectDeadline = 0;
      this._room = this._snapshot = null; this._selfId = null;
      this._status = 'disconnected'; this._error = `連線中斷已超過 ${seconds} 秒，本次續接已結束。`; this.notify(); return;
    }
    this._status = 'reconnecting'; this._error = `連線暫時中斷，正在重新連線（最多 ${this._room?.cup?15:10} 秒）…`; this.notify();
    const delay = Math.min(remaining, this.reconnectAttempts++ === 0 ? 100 : 750);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.wantsConnection || !this.credentials) return;
      void this.restore().catch(() => this.scheduleReconnect());
    }, delay);
  }
  private rejectPending(message: string) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null; clearTimeout(pending.timer); pending.reject(new Error(message));
  }
  private notify() { for (const listener of this.listeners) listener(this); }
  private clearConnectTimer() { if (this.connectTimer !== null) clearTimeout(this.connectTimer); this.connectTimer = null; }
  private clearReconnectTimer() { if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  private clearHeartbeat() {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null; this.pings.clear();
  }
  private readSession(): SavedSession | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw || raw.length > 2048) return null;
      const value: unknown = JSON.parse(raw);
      if (!object(value) || value.endpoint !== this.url || value.version !== PROTOCOL_VERSION || value.physics !== PHYSICS_VERSION || value.catalogStamp !== CATALOG_STAMP || typeof value.code !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(value.code) || typeof value.playerId !== 'string' || value.playerId.length > 128 || typeof value.token !== 'string' || value.token.length < 8 || value.token.length > 512 || !finite(value.savedAt) || Date.now() - value.savedAt > 86400000) return null;
      return value as unknown as SavedSession;
    } catch { return null; }
  }
  private persistSession() {
    try { if (this.credentials) sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.credentials)); }
    catch { /* storage 不可用時仍能在本次分頁連線 */ }
  }
  private clearSession() {
    this.credentials = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage 不可用 */ }
  }
}
