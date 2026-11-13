import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Car, buildMultiplayerTrackGeometry, getMultiplayerTrack, verifyMultiplayerTrackData, DEFAULT_MULTIPLAYER_TRACK_ID, resolveMultiplayerCollisions } from './physics.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol.ts';

export const TICK_MS = 1000 / 60;
export const SNAPSHOT_MS = 1000 / 20;
const COLORS = ['#ef5350', '#42a5f5', '#ffca28', '#66bb6a'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SEQUENCE = 0x7fffffff;
const MAX_BUFFERED_BYTES = 256 * 1024;
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
          trackId, trackStamp: selected.descriptor.trackStamp, trackRevision: 1, track: selected.track,
          players: new Map(), createdAt: now, updatedAt: now, emptySince: null, simAt: null,
          lastSnapshotAt: now, firstFinishAt: null };
        this.rooms.set(code, room); this.addPlayer(client, room, name, message, now); return;
      }
      if (!validCode(message.code)) return this.fail(client, 'ROOM_NOT_FOUND', message);
      const room = this.rooms.get(message.code);
      if (!room) return this.fail(client, 'ROOM_NOT_FOUND', message);
      this.expireDisconnected(room, now);
      if (room.phase !== 'lobby') return this.fail(client, 'ROOM_STARTED', message);
      if (room.players.size >= 4) return this.fail(client, 'ROOM_FULL', message);
      this.addPlayer(client, room, name, message, now); return;
    }
    const room = client.room, player = client.player;
    if (!room || !player) return this.fail(client, 'NOT_IN_ROOM', message);
    switch (message.type) {
      case 'leave': this.leave(client, now); this.send(client, { type: 'left' }); return;
      case 'select-track': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision !== room.trackRevision) return this.fail(client, 'STALE_TRACK', message);
        if (typeof message.trackId !== 'string' || !getMultiplayerTrack(message.trackId)) return this.fail(client, 'INVALID_TRACK', message);
        if (message.trackId === room.trackId) { this.broadcast(room, 'room', now); return; }
        let selected; try { selected = this.trackFor(message.trackId); } catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
        room.trackId = message.trackId; room.trackStamp = selected.descriptor.trackStamp; room.track = selected.track; room.trackRevision++;
        room.matchId = null; room.startAt = null; room.simAt = null; room.firstFinishAt = null; room.updatedAt = now;
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
        room.phase = 'countdown'; room.matchId = randomUUID(); room.startAt = now + 3000; room.simAt = room.startAt;
        room.firstFinishAt = null; room.updatedAt = now;
        for (const p of room.players.values()) this.resetPlayer(room, p, now);
        this.broadcast(room, 'room', now); return;
      case 'reset':
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'results') return this.fail(client, 'INVALID_PHASE', message);
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

  addPlayer(client, room, name, request, now) {
    const used = new Set([...room.players.values()].map((p) => p.slot));
    const slot = [0, 1, 2, 3].find((n) => !used.has(n));
    const player = { id: randomUUID(), token: randomBytes(32).toString('hex'), name, slot,
      color: COLORS[slot], ready: false, loaded: false, connected: true, client, disconnectedAt: null, expired: false,
      car: this.newCar(room, slot), ackSeq: -1, receivedSeq: -1, input: { steer: 0, brake: true }, lastInputAt: now,
      completedLaps: 0, distance: 0, nextGate: 1, finishMs: null, dnf: false, joinedAt: now };
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
    if (!player) return this.fail(client, 'INVALID_SESSION', request);
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
    player.client = client; player.connected = true; player.disconnectedAt = null; player.loaded = false; player.ready = false;
    player.input = { steer: 0, brake: true }; player.lastInputAt = now; player.receivedSeq = player.ackSeq;
    client.room = room; client.player = player; room.emptySince = null; room.updatedAt = now;
    if (!room.players.get(room.hostId)?.connected) room.hostId = player.id;
    this.welcome(client, request, now); this.broadcast(room, 'room', now);
  }

  resetPlayer(room, player, now) {
    player.car = this.newCar(room, player.slot); player.ackSeq = -1; player.receivedSeq = -1; player.input = { steer: 0, brake: true };
    player.lastInputAt = now; player.completedLaps = 0; player.distance = 0; player.nextGate = 1;
    player.finishMs = null; player.dnf = false;
  }

  toLobby(room, now) {
    room.phase = 'lobby'; room.matchId = null; room.startAt = null; room.simAt = null; room.firstFinishAt = null; room.updatedAt = now;
    for (const player of room.players.values()) { this.resetPlayer(room, player, now); player.ready = false; }
    this.electHost(room); this.broadcast(room, 'room', now);
  }

  electHost(room) {
    if (room.players.get(room.hostId)?.connected) return;
    room.hostId = [...room.players.values()].find((p) => p.connected)?.id ?? room.players.keys().next().value ?? '';
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
    player.disconnectedAt = now; player.dnf = player.finishMs === null; player.input = { steer: 0, brake: true };
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
      player.expired = true; player.token = null; player.dnf = player.finishMs === null; changed = true;
      if (room.phase === 'lobby') room.players.delete(player.id);
    }
    if (changed) { this.electHost(room); if (!this.maybeFinish(room, now)) this.broadcast(room, 'room', now); }
  }

  maybeFinish(room, now) {
    if (room.phase !== 'racing') return false;
    const players = [...room.players.values()];
    if (now - room.startAt < this.raceLimitMs && (room.firstFinishAt === null || now - room.firstFinishAt < this.finishGraceMs) && !players.every((p) => p.dnf || p.finishMs !== null)) return false;
    for (const player of players) if (player.finishMs === null) player.dnf = true;
    room.phase = 'results'; room.updatedAt = now; this.broadcast(room, 'room', now); return true;
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
    resolveMultiplayerCollisions(track, moving.filter(({ player }) => player.connected && player.loaded)
      .map(({ player, previous }) => ({ id: String(player.slot), car: player.car, previous })));
    for (const { player, s } of moving) {
      let delta = player.car.pos.s - s;
      if (delta > length / 2) delta -= length;
      if (delta < -length / 2) delta += length;
      const before = player.distance; player.distance += delta;
      const gate = (player.completedLaps + player.nextGate / 3) * length;
      if (delta > 0 && before < gate && player.distance + 1e-8 >= gate) {
        if (player.nextGate === 3) {
          player.completedLaps++; player.nextGate = 1;
          if (player.completedLaps >= room.laps) {
            // Interpolate within the authoritative step, independent of arrival
            // times of inputs, snapshots or any client wall clock.
            const fraction = Math.max(0, Math.min(1, (gate - before) / delta));
            player.finishMs = Math.max(0, at - room.startAt - TICK_MS * (1 - fraction));
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
          for (const p of room.players.values()) if (p.finishMs === null) p.dnf = true;
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
      finishMs: p.finishMs === null ? null : Math.round(p.finishMs * 1000) / 1000, dnf: p.dnf, rank: index + 1 }));
    return { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP,
      trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision,
      code: room.code, hostId: room.hostId, phase: room.phase, matchId: room.matchId, startAt: room.startAt,
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
