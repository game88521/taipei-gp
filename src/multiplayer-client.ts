import {
  PROTOCOL_VERSION, PHYSICS_VERSION,
  type ClientMessage, type ServerMessage, type RoomSnapshot,
} from '../shared/multiplayer-protocol';
import { CATALOG_STAMP, DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack } from '../shared/multiplayer-tracks';

export type MultiplayerConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type StateListener = (client: MultiplayerClient) => void;
type SnapshotListener = (room: RoomSnapshot) => void;
type EntryKind = 'create' | 'join' | 'resume';
interface SavedSession {
  endpoint: string; code: string; playerId: string; token: string;
  version: number; physics: string; catalogStamp: string; savedAt: number;
}
interface PendingEntry {
  kind: EntryKind; id: string; timer: ReturnType<typeof setTimeout>;
  resolve: () => void; reject: (error: Error) => void;
}

const SESSION_KEY = 'taipei-gp-multiplayer-session-v2';
const CONNECT_TIMEOUT = 7000, ENTRY_TIMEOUT = 7000, RECONNECT_WINDOW = 10000;
const HEARTBEAT_INTERVAL = 1500, HEARTBEAT_TIMEOUT = 6500;
const identity = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP };
const clock = () => performance.now();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 房間憑證只存在本分頁的 sessionStorage，完全不讀寫單人存檔。 */
export class MultiplayerClient {
  readonly url: string;
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
  private pings = new Map<number, number>();
  private clockSamples: { rtt: number; offset: number; at: number }[] = [];
  private offset = 0;
  private lastInbound = 0;
  private lastRoomTime = -Infinity;
  private retiredMatches = new Set<string>();
  private requestSeq = 0;
  private inputSeq = 0;
  private lastInputAt = -Infinity;
  private lastInputBrake = true;
  private _status: MultiplayerConnectionStatus = 'idle';
  private _error: string | null = null;
  private _room: RoomSnapshot | null = null;
  private _snapshot: RoomSnapshot | null = null;
  private _selfId: string | null = null;
  private _rttMs: number | null = null;
  private _connectionGeneration = 0;

  constructor(url: string) {
    let endpoint: URL;
    try { endpoint = new URL(url); } catch { throw new Error('連線伺服器網址格式不正確。'); }
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new Error('連線伺服器必須使用有效的 ws 或 wss 網址。');
    if (typeof location !== 'undefined' && location.protocol === 'https:' && endpoint.protocol !== 'wss:') throw new Error('HTTPS 遊戲頁面需要使用 wss 安全連線。');
    this.url = endpoint.href;
  }

  get status() { return this._status; }
  get error() { return this._error; }
  get room() { return this._room; }
  get snapshot() { return this._snapshot; }
  get selfId() { return this._selfId; }
  get rttMs() { return this._rttMs; }
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
        this.clearSession();
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
    return this.command({ type: 'ready', ready, trackRevision: room?.trackRevision ?? 0, trackStamp: room?.trackStamp ?? '' });
  }
  start() { return this.command({ type: 'start', trackRevision: this._room?.trackRevision ?? 0 }); }
  reset() { return this.command({ type: 'reset' }); }

  /** 最多約 30 次／秒；緊急煞車不等待下一個傳送時槽。 */
  sendInput(steer: number, brake: boolean) {
    if (!finite(steer) || !this.authenticated || this._status !== 'connected' || this._room?.phase !== 'racing' || !this._room.matchId || !this._room.players.find(player => player.id === this._selfId)?.loaded) return false;
    const now = clock();
    if (now - this.lastInputAt < 1000 / 30 && !(brake && !this.lastInputBrake)) return false;
    if ((this.socket?.bufferedAmount ?? 0) > 65536) {
      if (this.socket) this.failSocket(this.socket, '連線傳輸壅塞，正在重新連線。');
      return false;
    }
    this.lastInputAt = now; this.lastInputBrake = brake;
    return this.send({ type: 'input', matchId: this._room.matchId, trackRevision: this._room.trackRevision, seq: ++this.inputSeq, steer: Math.max(-1, Math.min(1, steer)), brake });
  }

  leave() {
    if (this.authenticated) this.send({ type: 'leave' });
    this.clearSession();
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
    if (this._room && kind !== 'resume') throw new Error('請先離開目前房間。');
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
    const message = raw as unknown as ServerMessage;
    if (message.type === 'pong') {
      if (!finite(message.sentAt) || !finite(message.serverTime)) return;
      const began = this.pings.get(message.sentAt);
      if (began === undefined) return;
      this.pings.delete(message.sentAt);
      const now = clock(), rtt = Math.max(0, now - began);
      const sample = { rtt, offset: message.serverTime - (message.sentAt + rtt / 2), at: now };
      this.clockSamples = [...this.clockSamples.filter(s => now - s.at < 15000), sample].slice(-8);
      const best = this.clockSamples.reduce((a, b) => a.rtt <= b.rtt ? a : b);
      this.offset = best.offset; this._rttMs = rtt; this.notify(); return;
    }
    if (message.type === 'error') {
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
    if (message.type === 'welcome') {
      if (!this.pending || message.requestId !== this.pending.id) return;
      this.validateRoom(message.room);
      if (typeof message.playerId !== 'string' || typeof message.resumeToken !== 'string' || message.resumeToken.length < 8 || message.resumeToken.length > 512 || !message.room.players.some(p => p.id === message.playerId)) throw new Error('伺服器未提供有效的房間身分。');
      this._selfId = message.playerId;
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
      this.leave(); return;
    }
    throw new Error('伺服器與遊戲通訊版本不相容，請重新載入。');
  }

  private validateRoom(room: unknown): asserts room is RoomSnapshot {
    if (!object(room) || room.version !== PROTOCOL_VERSION || room.physics !== PHYSICS_VERSION || room.catalogStamp !== CATALOG_STAMP) throw new Error('遊戲與伺服器版本或地圖清單不一致，請更新後重新連線。');
    const descriptor = typeof room.trackId === 'string' ? getMultiplayerTrack(room.trackId) : undefined;
    if (!descriptor || room.trackStamp !== descriptor.trackStamp || !Number.isSafeInteger(room.trackRevision) || Number(room.trackRevision) < 1) throw new Error('伺服器提供的地圖版本不一致，請更新後重新連線。');
    if (typeof room.code !== 'string' || typeof room.hostId !== 'string' || !['lobby', 'countdown', 'racing', 'results'].includes(String(room.phase)) || !finite(room.serverTime) || !finite(room.trackLength) || room.trackLength <= 0 || ![1, 3, 5].includes(Number(room.laps)) || (room.matchId !== null && typeof room.matchId !== 'string') || (room.startAt !== null && !finite(room.startAt)) || !Array.isArray(room.players) || room.players.length < 1 || room.players.length > 4) throw new Error('房間資料格式不正確，請重新連線。');
    const ids = new Set<string>();
    for (const player of room.players) {
      if (!object(player) || typeof player.id !== 'string' || ids.has(player.id) || typeof player.name !== 'string' || player.name.length > 64 || typeof player.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(player.color) || typeof player.ready !== 'boolean' || typeof player.loaded !== 'boolean' || typeof player.connected !== 'boolean' || typeof player.dnf !== 'boolean' || !finite(player.ackSeq) || !Number.isSafeInteger(player.ackSeq) || player.ackSeq < -1 || !finite(player.completedLaps) || !finite(player.progress) || !finite(player.rank) || (player.finishMs !== null && !finite(player.finishMs)) || !object(player.car) || !object(player.car.pos) || !['x', 'z', 'h', 'v', 'steer'].every(key => finite((player.car as Record<string, unknown>)[key])) || !['i', 's', 'lat'].every(key => finite((player.car as { pos: Record<string, unknown> }).pos[key]))) throw new Error('車手狀態格式不正確，請重新連線。');
      ids.add(player.id);
    }
  }
  private acceptRoom(room: RoomSnapshot, snapshot: boolean) {
    if (this.credentials && room.code !== this.credentials.code) return;
    const previousRoom = this._room;
    if (previousRoom && room.trackRevision < previousRoom.trackRevision) return;
    const changedTrack = !!previousRoom && room.trackRevision !== previousRoom.trackRevision;
    if (previousRoom && !changedTrack && (room.trackId !== previousRoom.trackId || room.trackStamp !== previousRoom.trackStamp)) throw new Error('地圖更新順序不正確，請重新連線。');
    if ((!changedTrack && room.serverTime < this.lastRoomTime) || (room.matchId && this.retiredMatches.has(room.matchId))) return;
    const previous = this._room?.matchId;
    if (previous && previous !== room.matchId) {
      this.retiredMatches.add(previous);
      if (this.retiredMatches.size > 16) this.retiredMatches.delete(this.retiredMatches.values().next().value!);
    }
    this.lastRoomTime = room.serverTime;
    this._room = room;
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
    if (!this.reconnectDeadline) this.reconnectDeadline = clock() + RECONNECT_WINDOW;
    const remaining = this.reconnectDeadline - clock();
    if (remaining <= 0) {
      this.wantsConnection = false; this.clearSession(); this.reconnectDeadline = 0;
      this._room = this._snapshot = null; this._selfId = null;
      this._status = 'disconnected'; this._error = '連線中斷已超過 10 秒，本次續接已結束。'; this.notify(); return;
    }
    this._status = 'reconnecting'; this._error = '連線暫時中斷，正在重新連線（最多 10 秒）…'; this.notify();
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
