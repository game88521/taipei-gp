import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Car, buildMultiplayerTrackGeometry, getMultiplayerTrack, verifyMultiplayerTrackData, DEFAULT_MULTIPLAYER_TRACK_ID, resolveMultiplayerCollisions } from './physics.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol.ts';
import { validSeriesTracks, seriesStandings, SERIES_POINTS } from '../shared/multiplayer-series.ts';
import { DEFAULT_ROOM_RULES, parseRoomRules, defaultRoomRules } from '../shared/multiplayer-room-rules.ts';

export const TICK_MS = 1000 / 60;
export const SNAPSHOT_MS = 1000 / 20;
const COLORS = ['#ef5350', '#42a5f5', '#ffca28', '#66bb6a'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SEQUENCE = 0x7fffffff;
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_REMOVED_PLAYER_IDS = 64;
const ERRORS = {
  BAD_MESSAGE: '無效的連線訊息。', INCOMPATIBLE_VERSION: '遊戲版本不同，請雙方更新後再加入。',
  ALREADY_JOINED: '請先離開目前房間。', ROOM_NOT_FOUND: '找不到房間，可能已關閉。',
  ROOM_FULL: '房間已滿，最多四名車手。', ROOM_STARTED: '比賽已開始，請等下一場。',
  SERVER_FULL: '目前連線已滿，請稍後再試。', INVALID_NAME: '請輸入一至十六字的車手名稱。',
  INVALID_SESSION: '無法恢復這個連線，請重新加入房間。', SESSION_EXPIRED: '重連期限已過，請重新加入。',
  NOT_IN_ROOM: '請先建立或加入房間。', HOST_ONLY: '只有房主能進行這項操作。',
  NOT_READY: '至少兩名車手，而且所有人都要連線並準備完成。', INVALID_PHASE: '目前無法進行這項操作。',
  STALE_MATCH: '這是上一場比賽的操作，已忽略。', RATE_LIMIT: '操作過於頻繁，請稍後再試。',
  INVALID_TRACK: '不支援這張連線賽道。', STALE_TRACK: '房間賽道已變更，請等待新賽道載入。',
  TRACK_UNAVAILABLE: '這張賽道暫時無法載入，請稍後重試。',
  STALE_LOBBY: '房間狀態已變更，請確認最新大廳後再操作。',
  INVALID_TARGET: '請選擇大廳中的其他有效車手；交棒對象必須已連線。',
  REMOVED_BY_HOST: '房主已將你移出房間；可重新輸入房碼加入。',
  INVALID_SERIES: '請依序選擇三至五張不重複的合法地圖。',
  SERIES_ACTIVE: '系列賽進行中，請使用下一站，或先明確結束系列賽。',
  SERIES_LOCKED: '系列賽名單已鎖定；原車手可續接，新車手請等系列結束。',
  STALE_SERIES: '系列賽狀態已更新，請確認目前站次後再操作。',
  RULES_UNSUPPORTED: '房內有車手的版本不支援此規則，請全員更新，或改回一般碰撞與60秒寬限。',
  INVALID_RULES: '請選擇合法碰撞設定與30、60或120秒完賽寬限。',
};

function validName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 16 && !/[\u0000-\u001f\u007f<>"'`\\]/u.test(name) ? name : null;
}
function validCode(value) { return typeof value === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(value); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function equalToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f0-9]{64}$/.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** In-memory authoritative rooms. Only input controls are accepted over the wire. */
export class RoomService {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.trackCache = new Map();
    this.rooms = new Map();
    this.clients = new Set();
    this.bySocket = new WeakMap();
    this.maxRooms = options.maxRooms ?? 50;
    this.maxClients = options.maxClients ?? 256;
    this.disconnectMs = options.disconnectMs ?? 10_000;
    this.emptyRoomMs = options.emptyRoomMs ?? 60_000;
    this.idleRoomMs = options.idleRoomMs ?? 30 * 60_000;
    this.raceLimitMs = options.raceLimitMs ?? 10 * 60_000;
    this.finishGraceMs = options.finishGraceMs ?? 60_000;
    this.closed = false;
  }

  accept(ws) {
    if (this.closed || this.clients.size >= this.maxClients) {
      ws.close(1013, 'Server full'); return null;
    }
    const now = this.now();
    const client = { ws, room: null, player: null, tokens: 120, rateAt: now, alive: true, badMessages: 0 };
    this.clients.add(client); this.bySocket.set(ws, client);
    ws.on('message', (data, binary) => {
      if (binary || Buffer.byteLength(data) > 4096) { this.fail(client, 'BAD_MESSAGE'); ws.close(1008, 'Invalid message'); return; }
      let message;
      try { message = JSON.parse(data.toString()); }
      catch { this.fail(client, 'BAD_MESSAGE'); if (++client.badMessages >= 3) ws.close(1008, 'Invalid JSON'); return; }
      this.receive(client, message);
    });
    ws.on('pong', () => { client.alive = true; });
    ws.on('close', () => this.disconnect(client));
    // The close event performs cleanup; an error must never crash the service.
    ws.on('error', () => {});
    return client;
  }

  send(client, message) {
    if (!client || client.ws.readyState !== 1) return false;
    if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) { client.ws.close(1013, 'Slow connection'); return false; }
    try { client.ws.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  fail(client, code, request) {
    const response = { type: 'error', code, message: ERRORS[code] ?? ERRORS.BAD_MESSAGE };
    if (typeof request?.requestId === 'string' && request.requestId.length <= 80) response.requestId = request.requestId;
    this.send(client, response);
  }

  compatible(message) {
    return message.version === PROTOCOL_VERSION && message.physics === PHYSICS_VERSION && message.catalogStamp === CATALOG_STAMP;
  }

  trackFor(id) {
    const descriptor = getMultiplayerTrack(id);
    if (!descriptor) return null;
    let cached = this.trackCache.get(id);
    if (!cached) {
      const source = descriptor.circuit ? `../public/data/circuits/${id}.json` : '../src/data/track.json';
      const data = JSON.parse(readFileSync(new URL(source, import.meta.url), 'utf8'));
      verifyMultiplayerTrackData(descriptor, data);
      cached = Object.freeze(buildMultiplayerTrackGeometry(descriptor, data));
      this.trackCache.set(id, cached);
    }
    // Each room owns its arrays. Cached geometry is never passed to Car.update.
    const track = Object.freeze(Object.fromEntries(Object.entries(cached).map(([key, value]) => [key, ArrayBuffer.isView(value) ? value.slice() : value])));
    return { descriptor, track };
  }

  currentSelection(room, message, stamp = false) {
    return Number.isSafeInteger(message.trackRevision) && message.trackRevision === room.trackRevision
      && (!stamp || message.trackStamp === room.trackStamp);
  }

  receive(client, message) {
    if (!this.clients.has(client) || this.closed) return;
    const now = this.now();
    client.tokens = Math.min(120, client.tokens + Math.max(0, now - client.rateAt) * 0.06);
    client.rateAt = now;
    if (client.tokens < 1) { this.fail(client, 'RATE_LIMIT', message); client.ws.close(1008, 'Rate limit'); return; }
    client.tokens--;
    if (!isObject(message) || typeof message.type !== 'string') { this.fail(client, 'BAD_MESSAGE', message); return; }
    if (message.requestId !== undefined && (typeof message.requestId !== 'string' || message.requestId.length > 80)) { this.fail(client, 'BAD_MESSAGE'); return; }
    if (message.type === 'ping') {
      if (typeof message.sentAt !== 'number' || !Number.isFinite(message.sentAt)) return this.fail(client, 'BAD_MESSAGE', message);
      this.send(client, { type: 'pong', sentAt: message.sentAt, serverTime: now }); return;
    }
    if (['create', 'join', 'resume'].includes(message.type)) {
      if (client.room) return this.fail(client, 'ALREADY_JOINED', message);
      if (!this.compatible(message)) return this.fail(client, 'INCOMPATIBLE_VERSION', message);
      if (message.clientCapabilities !== undefined && (!isObject(message.clientCapabilities) || message.clientCapabilities.roomRules !== true)) return this.fail(client, 'BAD_MESSAGE', message);
      if (message.type === 'resume') return this.resume(client, message, now);
      const name = validName(message.name);
      if (!name) return this.fail(client, 'INVALID_NAME', message);
      if (message.type === 'create') {
        if (![1, 3, 5].includes(message.laps)) return this.fail(client, 'BAD_MESSAGE', message);
        if (this.rooms.size >= this.maxRooms) return this.fail(client, 'SERVER_FULL', message);
        const trackId = message.trackId ?? DEFAULT_MULTIPLAYER_TRACK_ID;
        if (typeof trackId !== 'string' || !getMultiplayerTrack(trackId)) return this.fail(client, 'INVALID_TRACK', message);
        let selected; try { selected = this.trackFor(trackId); } catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
        let code;
        do { code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); } while (this.rooms.has(code));
        const room = { code, hostId: '', phase: 'lobby', matchId: null, startAt: null, laps: message.laps,
          lobbyRevision: 1, removedPlayerIds: new Set(), series: null, roomRules: { ...DEFAULT_ROOM_RULES },
          trackId, trackStamp: selected.descriptor.trackStamp, trackRevision: 1, track: selected.track,
          players: new Map(), createdAt: now, updatedAt: now, emptySince: null, simAt: null,
          lastSnapshotAt: now, firstFinishAt: null };
        this.rooms.set(code, room); this.addPlayer(client, room, name, message, now); return;
      }
      if (!validCode(message.code)) return this.fail(client, 'ROOM_NOT_FOUND', message);
      const room = this.rooms.get(message.code);
      if (!room) return this.fail(client, 'ROOM_NOT_FOUND', message);
      if (!defaultRoomRules(room.roomRules) && !message.clientCapabilities?.roomRules) return this.fail(client, 'RULES_UNSUPPORTED', message);
      this.expireDisconnected(room, now);
      if (room.phase !== 'lobby') return this.fail(client, 'ROOM_STARTED', message);
      if (room.series?.locked) return this.fail(client, 'SERIES_LOCKED', message);
      if (room.players.size >= 4) return this.fail(client, 'ROOM_FULL', message);
      this.addPlayer(client, room, name, message, now); return;
    }
    const room = client.room, player = client.player;
    if (!room || !player) return this.fail(client, 'NOT_IN_ROOM', message);
    switch (message.type) {
      case 'set-room-rules': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (room.series?.locked) return this.fail(client, 'SERIES_ACTIVE', message);
        if (message.roomCode !== room.code || message.expectedLobbyRevision !== room.lobbyRevision) return this.fail(client, 'STALE_LOBBY', message);
        const rules = parseRoomRules(message.roomRules);
        if (!rules) return this.fail(client, 'INVALID_RULES', message);
        if (!defaultRoomRules(rules) && [...room.players.values()].some(p => !p.supportsRoomRules)) return this.fail(client, 'RULES_UNSUPPORTED', message);
        if (rules.collisions === room.roomRules.collisions && rules.finishGraceSeconds === room.roomRules.finishGraceSeconds) return;
        room.roomRules = rules; room.lobbyRevision++; room.trackRevision++; room.updatedAt = now;
        for (const p of room.players.values()) { this.resetPlayer(room, p, now); p.ready = false; p.loaded = false; }
        this.broadcast(room, 'room', now); return;
      }
      case 'leave': this.leave(client, now); this.send(client, { type: 'left' }); return;
      case 'set-laps':
      case 'configure-series':
      case 'end-series': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby' && !(message.type === 'end-series' && room.phase === 'results')) return this.fail(client, 'INVALID_PHASE', message);
        if (message.roomCode !== room.code || !Number.isSafeInteger(message.expectedLobbyRevision)
          || message.expectedLobbyRevision !== room.lobbyRevision) return this.fail(client, 'STALE_LOBBY', message);
        if (message.type === 'set-laps') {
          if (![1, 3, 5].includes(message.laps)) return this.fail(client, 'BAD_MESSAGE', message);
          if (room.laps === message.laps) return this.broadcast(room, 'room', now);
          room.laps = message.laps; room.trackRevision++;
          for (const p of room.players.values()) { this.resetPlayer(room, p, now); p.loaded = false; }
        } else if (message.type === 'configure-series') {
          if (room.series?.locked) return this.fail(client, 'SERIES_ACTIVE', message);
          if (!validSeriesTracks(message.trackIds)) return this.fail(client, 'INVALID_SERIES', message);
          // Validate and prepare all selected maps before any room mutation.
          let selected; try { for (const id of message.trackIds) { const candidate = this.trackFor(id); if (id === message.trackIds[0]) selected = candidate; } }
          catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
          this.changeTrack(room, message.trackIds[0], selected, now);
          room.series = { id: randomUUID(), revision: 1, trackIds: [...message.trackIds], roundIndex: 0,
            locked: false, complete: false, entrants: [], rounds: [], standings: [] };
        } else room.series = null;
        room.lobbyRevision++; room.updatedAt = now;
        for (const p of room.players.values()) p.ready = false;
        this.broadcast(room, 'room', now); return;
      }
      case 'next-series': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'results') return this.fail(client, 'INVALID_PHASE', message);
        const series = room.series;
        if (message.roomCode !== room.code || !series || series.complete || message.matchId !== room.matchId
          || !Number.isSafeInteger(message.expectedSeriesRevision) || message.expectedSeriesRevision !== series.revision) return this.fail(client, 'STALE_SERIES', message);
        // Do not cut short an original driver's existing ten-second resume window.
        this.expireDisconnected(room, now);
        const available = [...room.players.values()].filter(p => p.connected);
        if (available.length < 2 || [...room.players.values()].some(p => !p.connected && !p.expired)) return this.fail(client, 'NOT_READY', message);
        const id = series.trackIds[series.roundIndex + 1];
        let selected; try { selected = this.trackFor(id); } catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
        for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
        series.roundIndex++; series.revision++;
        this.changeTrack(room, id, selected, now); this.toLobby(room, now); return;
      }
      case 'kick-player':
      case 'transfer-host': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (message.roomCode !== room.code || !Number.isSafeInteger(message.expectedLobbyRevision)
          || message.expectedLobbyRevision !== room.lobbyRevision) return this.fail(client, 'STALE_LOBBY', message);
        const target = typeof message.targetPlayerId === 'string' && message.targetPlayerId.length <= 128
          ? room.players.get(message.targetPlayerId) : null;
        if (!target || target.id === player.id || (message.type === 'transfer-host' && !target.connected)) return this.fail(client, 'INVALID_TARGET', message);
        room.lobbyRevision++; room.updatedAt = now;
        if (message.type === 'transfer-host') room.hostId = target.id;
        else {
          // Revoke the identity before notifying/closing its socket. Neither an
          // in-flight resume nor the old close callback can restore the player.
          room.removedPlayerIds.add(target.id);
          if (room.removedPlayerIds.size > MAX_REMOVED_PLAYER_IDS) room.removedPlayerIds.delete(room.removedPlayerIds.values().next().value);
          target.expired = true; target.token = null; target.input = { steer: 0, brake: true };
          const removedClient = target.client;
          target.client = null; target.connected = false; target.ready = false; target.loaded = false;
          room.players.delete(target.id);
          if (removedClient) {
            removedClient.room = null; removedClient.player = null;
            this.send(removedClient, { type: 'left', reason: 'kicked', roomCode: room.code, message: ERRORS.REMOVED_BY_HOST });
            try { removedClient.ws.close(1000, 'Removed by host'); } catch { /* already closed */ }
          }
        }
        this.broadcast(room, 'room', now); return;
      }
      case 'select-track': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (room.series) return this.fail(client, 'SERIES_ACTIVE', message);
        if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision !== room.trackRevision) return this.fail(client, 'STALE_TRACK', message);
        if (typeof message.trackId !== 'string' || !getMultiplayerTrack(message.trackId)) return this.fail(client, 'INVALID_TRACK', message);
        if (message.trackId === room.trackId) { this.broadcast(room, 'room', now); return; }
        let selected; try { selected = this.trackFor(message.trackId); } catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
        room.trackId = message.trackId; room.trackStamp = selected.descriptor.trackStamp; room.track = selected.track; room.trackRevision++;
        room.matchId = null; room.startAt = null; room.simAt = null; room.firstFinishAt = null; room.updatedAt = now; room.lobbyRevision++;
        for (const p of room.players.values()) { this.resetPlayer(room, p, now); p.ready = false; p.loaded = false; }
        this.broadcast(room, 'room', now); return;
      }
      case 'track-loaded':
        if (!this.currentSelection(room, message, true) || message.trackId !== room.trackId) return this.fail(client, 'STALE_TRACK', message);
        player.loaded = true; room.updatedAt = now; this.broadcast(room, 'room', now); return;
      case 'ready':
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (typeof message.ready !== 'boolean') return this.fail(client, 'BAD_MESSAGE', message);
        if (!this.currentSelection(room, message, true)) return this.fail(client, 'STALE_TRACK', message);
        if (message.ready && !player.loaded) return this.fail(client, 'NOT_READY', message);
        player.ready = message.ready; room.updatedAt = now; this.broadcast(room, 'room', now); return;
      case 'start':
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (!this.currentSelection(room, message)) return this.fail(client, 'STALE_TRACK', message);
        if (room.players.size < 2 || [...room.players.values()].some((p) => !p.connected || !p.loaded || !p.ready)) return this.fail(client, 'NOT_READY', message);
        if (room.series && !room.series.locked) {
          room.series.locked = true; room.series.revision++;
          room.series.entrants = [...room.players.values()].map(p => ({ playerId: p.id, name: p.name, color: p.color }));
          room.series.standings = seriesStandings(room.series.entrants, []);
        }
        room.phase = 'countdown'; room.matchId = randomUUID(); room.startAt = now + 3000; room.simAt = room.startAt;
        room.firstFinishAt = null; room.updatedAt = now;
        for (const p of room.players.values()) this.resetPlayer(room, p, now);
        this.broadcast(room, 'room', now); return;
      case 'reset':
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'results') return this.fail(client, 'INVALID_PHASE', message);
        if (room.series) return this.fail(client, 'SERIES_ACTIVE', message);
        for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
        this.toLobby(room, now); return;
      case 'input':
        if (message.matchId !== room.matchId || typeof message.matchId !== 'string') return this.fail(client, 'STALE_MATCH', message);
        if (!this.currentSelection(room, message)) return this.fail(client, 'STALE_TRACK', message);
        if (room.phase !== 'racing' && room.phase !== 'countdown') return;
        if (!player.loaded) return this.fail(client, 'NOT_READY', message);
        if (!Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq > MAX_SEQUENCE || typeof message.steer !== 'number' || !Number.isFinite(message.steer) || Math.abs(message.steer) > 1 || typeof message.brake !== 'boolean') return this.fail(client, 'BAD_MESSAGE', message);
        if (message.seq <= player.receivedSeq || player.dnf || player.finishMs !== null) return;
        player.receivedSeq = message.seq; player.input = { steer: message.steer, brake: message.brake }; player.lastInputAt = now; return;
      default: this.fail(client, 'BAD_MESSAGE', message);
    }
  }

  newCar(room, slot) {
    const track = room.track;
    const car = new Car(); car.resetTransient(false); car.placeAt(track, 0);
    // Same longitudinal start for fairness; 2m spacing leaves a 0.1m gap between collision bodies.
    const lat = [-3, -1, 1, 3][slot];
    car.x += -track.tz[0] * lat; car.z += track.tx[0] * lat; car.pos.lat = lat;
    return car;
  }

  changeTrack(room, id, selected, now) {
    if (id === room.trackId) return;
    room.trackId = id; room.trackStamp = selected.descriptor.trackStamp; room.track = selected.track; room.trackRevision++;
    room.matchId = null; room.startAt = null; room.simAt = null; room.firstFinishAt = null;
    for (const p of room.players.values()) { this.resetPlayer(room, p, now); p.ready = false; p.loaded = false; }
  }

  recordSeriesRound(room) {
    const series = room.series;
    if (!series?.locked || !room.matchId || series.rounds.some(round => round.matchId === room.matchId)) return;
    const classified = this.snapshot(room).players;
    const entrants = new Map(series.entrants.map(entrant => [entrant.playerId, entrant]));
    const current = classified.filter(p => entrants.has(p.id));
    const missing = series.entrants.filter(entrant => !current.some(p => p.id === entrant.playerId));
    const results = [...current.map((p, index) => ({ playerId: p.id, name: p.name, color: p.color, rank: index + 1,
      finishMs: p.finishMs, dnf: p.finishMs === null, points: p.finishMs === null ? 0 : SERIES_POINTS[index] })),
      ...missing.map((entrant, index) => ({ ...entrant, rank: current.length + index + 1, finishMs: null, dnf: true, points: 0 }))];
    series.rounds.push({ matchId: room.matchId, trackId: room.trackId, laps: room.laps, results });
    series.standings = seriesStandings(series.entrants, series.rounds);
    series.complete = series.rounds.length === series.trackIds.length; series.revision++;
  }

  addPlayer(client, room, name, request, now) {
    const used = new Set([...room.players.values()].map((p) => p.slot));
    const slot = [0, 1, 2, 3].find((n) => !used.has(n));
    const player = { id: randomUUID(), token: randomBytes(32).toString('hex'), name, slot,
      color: COLORS[slot], ready: false, loaded: false, connected: true, client, disconnectedAt: null, expired: false, supportsRoomRules: request.clientCapabilities?.roomRules === true,
      car: this.newCar(room, slot), ackSeq: -1, receivedSeq: -1, input: { steer: 0, brake: true }, lastInputAt: now,
      completedLaps: 0, distance: 0, nextGate: 1, finishMs: null, lapTimesMs: [], bestLapMs: null, lastLapElapsedMs: 0,
      dnf: false, dnfReason: null, joinedAt: now };
    client.room = room; client.player = player; room.players.set(player.id, player);
    room.hostId ||= player.id; room.updatedAt = now; room.emptySince = null;
    this.welcome(client, request, now); this.broadcast(room, 'room', now);
  }

  welcome(client, request, now) {
    const response = { type: 'welcome', playerId: client.player.id, resumeToken: client.player.token, room: this.snapshot(client.room, now) };
    if (request.requestId !== undefined) response.requestId = request.requestId;
    this.send(client, response);
  }

  resume(client, request, now) {
    if (!validCode(request.code)) return this.fail(client, 'ROOM_NOT_FOUND', request);
    const room = this.rooms.get(request.code);
    if (!room) return this.fail(client, 'ROOM_NOT_FOUND', request);
    const player = room.players.get(request.playerId);
    if (!player) return this.fail(client, room.removedPlayerIds.has(request.playerId) ? 'REMOVED_BY_HOST' : 'INVALID_SESSION', request);
    if (!defaultRoomRules(room.roomRules) && !request.clientCapabilities?.roomRules) return this.fail(client, 'RULES_UNSUPPORTED', request);
    if (player.expired || (!player.connected && now - player.disconnectedAt >= this.disconnectMs)) {
      this.expireDisconnected(room, now); return this.fail(client, 'SESSION_EXPIRED', request);
    }
    if (!equalToken(request.token, player.token)) return this.fail(client, 'INVALID_SESSION', request);
    // A single valid session owns at most one socket. The old close handler cannot
    // disconnect the replacement because it no longer owns player.client.
    const previous = player.client;
    if (previous && previous !== client) {
      previous.room = null; previous.player = null; this.send(previous, { type: 'left' }); previous.ws.close(1000, 'Session resumed');
    }
    player.client = client; player.connected = true; player.disconnectedAt = null; player.loaded = false; player.ready = false; player.supportsRoomRules = request.clientCapabilities?.roomRules === true;
    player.input = { steer: 0, brake: true }; player.lastInputAt = now; player.receivedSeq = player.ackSeq;
    client.room = room; client.player = player; room.emptySince = null; room.updatedAt = now;
    if (!room.players.get(room.hostId)?.connected && room.hostId !== player.id) { room.hostId = player.id; room.lobbyRevision++; }
    this.welcome(client, request, now); this.broadcast(room, 'room', now);
  }

  resetPlayer(room, player, now) {
    player.car = this.newCar(room, player.slot); player.ackSeq = -1; player.receivedSeq = -1; player.input = { steer: 0, brake: true };
    player.lastInputAt = now; player.completedLaps = 0; player.distance = 0; player.nextGate = 1;
    player.finishMs = null; player.lapTimesMs = []; player.bestLapMs = null; player.lastLapElapsedMs = 0;
    player.dnf = false; player.dnfReason = null;
  }

  toLobby(room, now) {
    room.phase = 'lobby'; room.matchId = null; room.startAt = null; room.simAt = null; room.firstFinishAt = null; room.updatedAt = now;
    room.lobbyRevision++;
    for (const player of room.players.values()) { this.resetPlayer(room, player, now); player.ready = false; }
    this.electHost(room); this.broadcast(room, 'room', now);
  }

  electHost(room) {
    if (room.players.get(room.hostId)?.connected) return;
    const nextHost = [...room.players.values()].find((p) => p.connected)?.id ?? room.players.keys().next().value ?? '';
    if (nextHost !== room.hostId) { room.hostId = nextHost; room.lobbyRevision++; }
  }

  disconnect(client) {
    this.clients.delete(client);
    const room = client.room, player = client.player;
    client.room = null; client.player = null;
    if (!room || !player || player.client !== client) return;
    const now = this.now(); player.client = null; player.connected = false; player.ready = false; player.loaded = false;
    player.disconnectedAt = now; player.input = { steer: 0, brake: true }; player.lastInputAt = now;
    this.electHost(room); room.updatedAt = now;
    if (![...room.players.values()].some((p) => p.connected)) room.emptySince ??= now;
    if (room.phase === 'countdown') this.toLobby(room, now);
    else this.broadcast(room, 'room', now);
  }

  leave(client, now) {
    const room = client.room, player = client.player;
    client.room = null; client.player = null;
    if (!room || !player) return;
    player.client = null; player.connected = false; player.loaded = false; player.token = null; player.expired = true;
    player.disconnectedAt = now; this.markDnf(player, 'left'); player.input = { steer: 0, brake: true };
    if (room.phase === 'lobby' || room.phase === 'countdown') room.players.delete(player.id);
    this.electHost(room); room.updatedAt = now;
    if (![...room.players.values()].some((p) => p.connected)) room.emptySince ??= now;
    if (room.phase === 'countdown') this.toLobby(room, now);
    else if (!this.maybeFinish(room, now)) this.broadcast(room, 'room', now);
  }

  expireDisconnected(room, now) {
    let changed = false;
    for (const player of [...room.players.values()]) {
      if (player.connected || player.expired || now - player.disconnectedAt < this.disconnectMs) continue;
      player.expired = true; player.token = null; this.markDnf(player, 'disconnect-expired'); changed = true;
      if (room.phase === 'lobby') room.players.delete(player.id);
    }
    if (changed) { this.electHost(room); if (!this.maybeFinish(room, now)) this.broadcast(room, 'room', now); }
  }

  markDnf(player, reason) {
    if (player.finishMs !== null || player.dnf) return;
    player.dnf = true; player.dnfReason = reason;
  }

  graceMs(room) { return room.roomRules.finishGraceSeconds === 60 ? this.finishGraceMs : room.roomRules.finishGraceSeconds * 1000; }

  deadline(room) {
    if (room.startAt === null) return { deadlineAt: null, deadlineReason: null };
    const race = room.startAt + this.raceLimitMs;
    const finish = room.firstFinishAt === null ? Infinity : room.firstFinishAt + this.graceMs(room);
    return finish < race ? { deadlineAt: finish, deadlineReason: 'finish-timeout' }
      : { deadlineAt: race, deadlineReason: 'race-timeout' };
  }

  maybeFinish(room, now) {
    if (room.phase !== 'racing') return false;
    const players = [...room.players.values()];
    if (now - room.startAt < this.raceLimitMs && (room.firstFinishAt === null || now - room.firstFinishAt < this.graceMs(room)) && !players.every((p) => p.dnf || p.finishMs !== null)) return false;
    const { deadlineReason } = this.deadline(room);
    for (const player of players) this.markDnf(player, deadlineReason);
    room.phase = 'results'; room.updatedAt = now; this.recordSeriesRound(room); this.broadcast(room, 'room', now); return true;
  }

  simulate(room, at) {
    const track = room.track, length = track.length;
    const moving = [];
    for (const player of room.players.values()) {
      if (player.dnf || player.finishMs !== null) continue;
      const previous = { x: player.car.x, z: player.car.z, h: player.car.h };
      moving.push({ player, previous, s: player.car.pos.s });
      const stale = !player.connected || at - player.lastInputAt > 700;
      player.car.update(1 / 60, track, stale ? 0 : player.input.steer, stale || player.input.brake);
      player.ackSeq = player.receivedSeq;
    }
    // Every car first advances against the same step. Resolve contacts once for the room,
    // then use each final pose for progress and finish gates, including cars pushed by others.
    if (room.roomRules.collisions) resolveMultiplayerCollisions(track, moving.filter(({ player }) => player.connected && player.loaded)
      .map(({ player, previous }) => ({ id: String(player.slot), car: player.car, previous })));
    for (const { player, s } of moving) {
      let delta = player.car.pos.s - s;
      if (delta > length / 2) delta -= length;
      if (delta < -length / 2) delta += length;
      const before = player.distance; player.distance += delta;
      const gate = (player.completedLaps + player.nextGate / 3) * length;
      if (delta > 0 && before < gate && player.distance + 1e-8 >= gate) {
        if (player.nextGate === 3) {
          // Use the same authoritative sub-step crossing for each completed lap
          // and the final result; client wall clocks never enter this calculation.
          const fraction = Math.max(0, Math.min(1, (gate - before) / delta));
          const elapsed = Math.max(0, at - room.startAt - TICK_MS * (1 - fraction));
          const lapMs = elapsed - player.lastLapElapsedMs;
          player.lapTimesMs.push(lapMs); player.lastLapElapsedMs = elapsed;
          player.bestLapMs = player.bestLapMs === null ? lapMs : Math.min(player.bestLapMs, lapMs);
          player.completedLaps++; player.nextGate = 1;
          if (player.completedLaps >= room.laps) {
            player.finishMs = elapsed;
            player.car.v = 0; room.firstFinishAt ??= at;
          }
        } else player.nextGate++;
      }
    }
  }

  tick(at = this.now()) {
    if (this.closed || !Number.isFinite(at)) return;
    for (const room of [...this.rooms.values()]) {
      this.expireDisconnected(room, at);
      if ((room.emptySince !== null && at - room.emptySince >= this.emptyRoomMs) || (['lobby', 'results'].includes(room.phase) && at - room.updatedAt >= this.idleRoomMs)) { this.destroyRoom(room); continue; }
      if (room.phase === 'countdown' && at >= room.startAt) { room.phase = 'racing'; room.updatedAt = at; this.broadcast(room, 'room', at); }
      if (room.phase === 'racing') {
        // A busy server must not run an unbounded catch-up loop. A prolonged
        // pause aborts the match rather than silently changing race speed.
        if (at - room.simAt > 5000) {
          for (const p of room.players.values()) this.markDnf(p, 'server-stall');
          this.maybeFinish(room, at);
        } else {
          let steps = 0;
          while (room.phase === 'racing' && room.simAt + TICK_MS <= at + 1e-6 && steps++ < 300) {
            room.simAt += TICK_MS; this.simulate(room, room.simAt);
            if (this.maybeFinish(room, room.simAt)) break;
          }
          this.maybeFinish(room, at);
        }
      }
      if (at - room.lastSnapshotAt >= SNAPSHOT_MS - 1e-6) { room.lastSnapshotAt = at; this.broadcast(room, 'snapshot', at); }
    }
  }

  snapshot(room, now = this.now()) {
    const players = [...room.players.values()].sort((a, b) => {
      if (a.finishMs !== null || b.finishMs !== null) {
        if (a.finishMs === null) return 1;
        if (b.finishMs === null) return -1;
        if (a.finishMs !== b.finishMs) return a.finishMs - b.finishMs;
      }
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.distance - a.distance || a.slot - b.slot;
    }).map((p, index) => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, loaded: p.loaded, connected: p.connected,
      car: p.car.snapshot(), ackSeq: p.ackSeq, completedLaps: p.completedLaps, progress: Math.max(0, p.distance),
      finishMs: p.finishMs === null ? null : Math.round(p.finishMs * 1000) / 1000,
      lapTimesMs: p.lapTimesMs.map(ms => Math.round(ms * 1000) / 1000),
      bestLapMs: p.bestLapMs === null ? null : Math.round(p.bestLapMs * 1000) / 1000,
      dnf: p.dnf, dnfReason: p.dnfReason ?? null, rank: index + 1 }));
    return { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP,
      trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision,
      code: room.code, hostId: room.hostId, hostManagement: { lobbyRevision: room.lobbyRevision }, capabilities: { lobbyOptions: true, championship: true, roomRules: true }, roomRules: { ...room.roomRules },
      series: room.series ? structuredClone(room.series) : null, phase: room.phase, matchId: room.matchId, startAt: room.startAt, ...this.deadline(room),
      laps: room.laps, serverTime: now, trackLength: room.track.length, players };
  }

  broadcast(room, type, now = this.now()) {
    const roomSnapshot = this.snapshot(room, now);
    for (const player of room.players.values()) if (player.connected) this.send(player.client, { type, room: roomSnapshot });
  }

  heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) { client.ws.terminate(); continue; }
      client.alive = false;
      try { client.ws.ping(); } catch { client.ws.terminate(); }
    }
  }

  destroyRoom(room) {
    for (const player of room.players.values()) if (player.client) {
      player.client.room = null; player.client.player = null; this.send(player.client, { type: 'left' });
    }
    this.rooms.delete(room.code);
  }

  close() {
    this.closed = true;
    for (const client of this.clients) client.ws.close(1001, 'Server shutting down');
    this.clients.clear(); this.rooms.clear();
  }
}
