import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Car, buildMultiplayerTrackGeometry, getMultiplayerTrack, verifyMultiplayerTrackData, DEFAULT_MULTIPLAYER_TRACK_ID, resolveMultiplayerCollisions } from './physics.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol.ts';
import { validSeriesTracks, seriesStandings, SERIES_POINTS } from '../shared/multiplayer-series.ts';
import { DEFAULT_ROOM_RULES, parseRoomRules, defaultRoomRules } from '../shared/multiplayer-room-rules.ts';
import { defaultEvolution } from '../shared/multiplayer-evolution.ts';
import { MULTIPLAYER_TRACKS } from '../shared/multiplayer-tracks.ts';
import { SeriesCheckpointSigner, seatHash, MAX_CHECKPOINT_BYTES } from './series-checkpoint.mjs';
import { horizonReceive, defaultHorizon, horizonRequired, detachViewer, prepareGrid, gridCar, safeGrid, resetHorizonPlayer, updateBlock, contactProtection, eliminationStep } from './horizon-service.mjs';
import { horizonCollisionEligible } from '../shared/multiplayer-horizon.ts';
import { observeReplay, receiveReplay } from './nexus-replay-service.mjs';
import { defaultArena, arenaMode, arenaReceive, resetArenaPlayer, arenaStartError, prepareArena, arenaBeforeStep, arenaAfterStep, arenaSync, arenaCanDrive, arenaCanCollide, arenaPublic } from './nexus-arena-service.mjs';
import { summitActive, summitTimed, summitReceive, summitJoinError, summitRejectOther, summitResetPlayer, summitResetLobby, summitRosterChanged, summitLobby, summitPublic, summitStartError, summitGridCar, summitStart, summitBeforeStep, summitAfterStep, summitLap, summitFinish, summitDeadline } from './summit-racing-service.mjs';
import {atlasVisible,atlasEnsure,atlasReceive,atlasReset,atlasImpact,atlasContacts,atlasFlags,atlasJoinError} from './atlas-racing-service.mjs';
import {voyagerVisible,voyagerPractice,voyagerReset,voyagerAdded,voyagerPublic,voyagerJoinError,voyagerReceive,voyagerStart,voyagerTick,voyagerBefore,voyagerAfter,voyagerGate,voyagerOrder,voyagerFinish} from './voyager-racing-service.mjs';
import { summitEventsEnabled, summitEvent, summitContacts, summitOvertakes } from './summit-events-service.mjs';
import {odysseyActive,odysseyReceive,odysseyStartError,odysseyStart,odysseyResetPlayer,odysseyBeforeLobby,odysseyTick,odysseyFinalize,odysseyPublic,odysseyRuleMissed} from './odyssey-racing-service.mjs';
import {expeditionEnabled,expeditionReceive,expeditionReset,expeditionPlayer,expeditionJoinError,expeditionTick} from './expedition-racing-service.mjs';
import {FRONTIER_CUP_VERSION} from '../shared/frontier-cup.ts';
import {CUP_RESUME_MS,cupReceive,cupCanDrive,cupPlayer,cupGridCar,cupBeforeLobby,cupFinish,cupStall} from './frontier-cup-service.mjs';

export const TICK_MS = 1000 / 60;
export const SNAPSHOT_MS = 1000 / 20;
const COLORS = ['#ef5350', '#42a5f5', '#ffca28', '#66bb6a'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SEQUENCE = 0x7fffffff;
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_REMOVED_PLAYER_IDS = 64;
const ERRORS = {
  REPLAY_UNAVAILABLE: '這場回放尚未完成或已結束保存，請在本場結算後取得。',
  HORIZON_UNSUPPORTED: '此房需要所有原車手更新 Horizon 版本。', INVALID_HORIZON: '請確認防堵路、系列倒序與單場淘汰的相容設定。',
  INVALID_PRESET: '房間範本無效或包含不相容設定，尚未建立房間。', SPECTATORS_FULL: '觀眾已滿，最多八位。',
  SPECTATOR_READ_ONLY: '觀眾只能追看；下局有空位時可明確選擇參賽。', INVALID_GRID: '目前發車格無法安全排列，請更換設定。',
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
  EVOLUTION_UNSUPPORTED: '房內全員（包含斷線保留席）需要更新版本才能使用這項玩法。',
  INVALID_EVENT: '請確認玩法、限時分鐘、讓秒與隊伍設定。',
  INVALID_VOTE: '請選擇有效地圖，投票必須屬於目前大廳世代。',
  TEAM_NOT_READY: '固定2v2需要原四名車手全員連線、各隊兩人，並設定系列賽。',
  INVALID_CHECKPOINT: '續賽憑證無效、已過期或版本不同；請使用原房主保存的憑證。',
  ORIGINAL_HOST_ONLY: '只有建立這個系列的原房主可以保存續賽憑證。',
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
    this.checkpoints = new SeriesCheckpointSigner(options.seriesResumeSecret);
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
      if (binary || Buffer.byteLength(data) > MAX_CHECKPOINT_BYTES + 2048) { this.fail(client, 'BAD_MESSAGE'); ws.close(1008, 'Invalid message'); return; }
      let message;
      try { message = JSON.parse(data.toString()); }
      catch { this.fail(client, 'BAD_MESSAGE'); if (Buffer.byteLength(data) > 4096) ws.close(1009, 'Message too large'); else if (++client.badMessages >= 3) ws.close(1008, 'Invalid JSON'); return; }
      if (message?.type !== 'resume-series' && Buffer.byteLength(data) > 4096) { this.fail(client, 'BAD_MESSAGE'); ws.close(1009, 'Message too large'); return; }
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
      this.send(client, { type: 'pong', sentAt: message.sentAt, serverTime: now, capabilities: { horizon: true } }); return;
    }
    if (cupReceive(this, client, message, now)) return;
    if (receiveReplay(this, client, message, now)) return;
    if (expeditionReceive(this, client, message, now)) return;
    if (odysseyReceive(this, client, message, now)) return;
    if (voyagerReceive(this, client, message, now)) return;
    if (atlasReceive(this, client, message, now)) return;
    if (summitReceive(this, client, message, now)) return;
    if (client.room && !client.viewer && summitRejectOther(client.room,message)) return this.send(client,{type:'error',code:'SUMMIT_RULE',message:'請先關閉排位週末／AI／耐久，再設定其他特殊玩法或系列。'});
    if (horizonReceive(this, client, message, now)) return;
    if (arenaReceive(this, client, message, now)) return;
    if (['create', 'join', 'resume', 'resume-series'].includes(message.type)) {
      if (client.room) return this.fail(client, 'ALREADY_JOINED', message);
      if (!this.compatible(message)) return this.fail(client, 'INCOMPATIBLE_VERSION', message);
      if (message.clientCapabilities !== undefined && (!isObject(message.clientCapabilities) || message.clientCapabilities.roomRules !== true)) return this.fail(client, 'BAD_MESSAGE', message);
      if (message.type === 'resume-series') return this.resumeSeries(client, message, now);
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
          lobbyRevision: 1, removedPlayerIds: new Set(), series: null, roomRules: { ...DEFAULT_ROOM_RULES }, evolution: defaultEvolution(), horizon: defaultHorizon(), arena: defaultArena(), spectators: new Map(),
          trackId, trackStamp: selected.descriptor.trackStamp, trackRevision: 1, track: selected.track,
          players: new Map(), createdAt: now, updatedAt: now, emptySince: null, simAt: null,
          lastSnapshotAt: now, firstFinishAt: null };
        this.rooms.set(code, room); this.addPlayer(client, room, name, message, now); return;
      }
      if (!validCode(message.code)) return this.fail(client, 'ROOM_NOT_FOUND', message);
      const room = this.rooms.get(message.code);
      if (!room) return this.fail(client, 'ROOM_NOT_FOUND', message);
      { const error=expeditionJoinError(room,message);if(error)return this.send(client,{type:'error',code:'EXPEDITION_RULE',requestId:message.requestId,message:error}); }
      { const error=voyagerJoinError(room,message);if(error)return this.send(client,{type:'error',code:'VOYAGER_RULE',requestId:message.requestId,message:error}); }
      { const error=summitJoinError(room,message); if(error)return this.send(client,{type:'error',code:'SUMMIT_RULE',requestId:message.requestId,message:error}); }
      if (arenaMode(room)!=='off' && message.clientCapabilities?.nexusArena!==true) return this.send(client,{type:'error',code:'ARENA_RULE',requestId:message.requestId,message:'此房已開啟接力／道具，請更新遊戲再加入。'});
      if (horizonRequired(room.horizon) && message.clientCapabilities?.horizon !== true) return this.fail(client, 'HORIZON_UNSUPPORTED', message);
      if (!defaultRoomRules(room.roomRules) && !message.clientCapabilities?.roomRules) return this.fail(client, 'RULES_UNSUPPORTED', message);
      if ((room.evolution.mode !== 'race' || room.requiresEvolution) && !message.clientCapabilities?.evolution) return this.fail(client, 'EVOLUTION_UNSUPPORTED', message);
      this.expireDisconnected(room, now);
      if (room.phase !== 'lobby' && !(voyagerPractice(room)&&room.phase==='racing')) return this.fail(client, 'ROOM_STARTED', message);
      if (room.series?.locked) return this.fail(client, 'SERIES_LOCKED', message);
      if (room.players.size >= 4) return this.fail(client, 'ROOM_FULL', message);
      this.addPlayer(client, room, name, message, now); return;
    }
    const room = client.room, player = client.player;
    if (!room || !player) return this.fail(client, 'NOT_IN_ROOM', message);
    switch (message.type) {
      case 'configure-event':
      case 'select-team':
      case 'vote-track':
      case 'resolve-vote':
      case 'random-series': return this.evolutionCommand(client, message, now);
      case 'checkpoint-series': return this.checkpointSeries(client, message, now);
      case 'set-room-rules': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (room.series?.locked) return this.fail(client, 'SERIES_ACTIVE', message);
        if (message.roomCode !== room.code || message.expectedLobbyRevision !== room.lobbyRevision) return this.fail(client, 'STALE_LOBBY', message);
        const rules = parseRoomRules(message.roomRules);
        if (!rules) return this.fail(client, 'INVALID_RULES', message);
        if (room.evolution.mode === 'time-trial' && rules.collisions || room.evolution.mode === 'teams' && !rules.collisions) return this.fail(client, 'INVALID_RULES', message);
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
        if(arenaMode(room)!=='off'&&message.type==='configure-series')return this.send(client,{type:'error',code:'ARENA_RULE',message:'請先切回一般競速，再建立系列。'});
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby' && !(message.type === 'end-series' && room.phase === 'results')) return this.fail(client, 'INVALID_PHASE', message);
        if (message.roomCode !== room.code || !Number.isSafeInteger(message.expectedLobbyRevision)
          || message.expectedLobbyRevision !== room.lobbyRevision) return this.fail(client, 'STALE_LOBBY', message);
        if (message.type === 'set-laps') {
          if(arenaMode(room)==='relay'&&message.laps===1)return this.send(client,{type:'error',code:'ARENA_RULE',message:'接力至少3圈，讓兩位隊員都能完成駕駛棒次。'});
          if (![1, 3, 5].includes(message.laps)) return this.fail(client, 'BAD_MESSAGE', message);
          if (room.laps === message.laps) return this.broadcast(room, 'room', now);
          room.laps = message.laps; room.trackRevision++;
          for (const p of room.players.values()) { this.resetPlayer(room, p, now); p.loaded = false; }
        } else if (message.type === 'configure-series') {
          if (room.horizon.elimination) return this.fail(client, 'INVALID_HORIZON', message);
          if (room.series?.locked) return this.fail(client, 'SERIES_ACTIVE', message);
          if (!validSeriesTracks(message.trackIds)) return this.fail(client, 'INVALID_SERIES', message);
          // Validate and prepare all selected maps before any room mutation.
          let selected; try { for (const id of message.trackIds) { const candidate = this.trackFor(id); if (id === message.trackIds[0]) selected = candidate; } }
          catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
          this.changeTrack(room, message.trackIds[0], selected, now);
          room.series = { id: randomUUID(), originalHostId: room.hostId, revision: 1, trackIds: [...message.trackIds], roundIndex: 0,
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
        if (!target || target.id === player.id || (message.type === 'transfer-host' && (!target.connected||target.isAi))) return this.fail(client, 'INVALID_TARGET', message);
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
          if(target.isAi&&room.summit)room.summit.settings.ai=[...room.players.values()].filter(p=>p.isAi).length;
          if (removedClient) {
            removedClient.room = null; removedClient.player = null;
            this.send(removedClient, { type: 'left', reason: 'kicked', roomCode: room.code, message: ERRORS.REMOVED_BY_HOST });
            try { removedClient.ws.close(1000, 'Removed by host'); } catch { /* already closed */ }
          }
        }
        if(summitRosterChanged(this,room,now))return;
        this.broadcast(room, 'room', now); return;
      }
      case 'select-track': {
        if (room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
        if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
        if (room.series) return this.fail(client, 'SERIES_ACTIVE', message);
        if(room.summit?.settings.weekend&&room.summit.stage==='race')return this.send(client,{type:'error',code:'SUMMIT_RULE',message:'週末正賽沿用排位賽道；要換圖請先重設完整週末。'});
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
        { const error=odysseyStartError(room); if(error)return this.send(client,{type:'error',code:'ODYSSEY_RULE',message:error}); }
        { const error=summitStartError(room); if(error)return this.send(client,{type:'error',code:'SUMMIT_RULE',message:error}); }
        { const error=arenaStartError(room); if(error)return this.send(client,{type:'error',code:'ARENA_RULE',message:error}); }
        if (horizonRequired(room.horizon) && [...room.players.values()].some(p => !p.supportsHorizon)) return this.fail(client, 'HORIZON_UNSUPPORTED', message);
        if (room.horizon.elimination && (room.series || room.evolution.mode !== 'race')) return this.fail(client, 'INVALID_HORIZON', message);
        prepareGrid(room);
        if (!safeGrid(room)) return this.fail(client, 'INVALID_GRID', message);
        if (!this.currentSelection(room, message)) return this.fail(client, 'STALE_TRACK', message);
        if ((room.evolution.mode !== 'race' || room.requiresEvolution) && [...room.players.values()].some(p => !p.supportsEvolution)) return this.fail(client, 'EVOLUTION_UNSUPPORTED', message);
        if (room.evolution.mode === 'teams' && (!room.series || room.players.size !== 4 || ['red', 'blue'].some(team => [...room.players.values()].filter(p => room.evolution.teams[p.id] === team).length !== 2)
          || room.series.locked && room.series.entrants.some(e => !room.players.has(e.playerId)))) return this.fail(client, 'TEAM_NOT_READY', message);
        if (room.players.size < 2 || [...room.players.values()].some((p) => !p.connected || !p.loaded || !p.ready)) return this.fail(client, 'NOT_READY', message);
        if (room.series && !room.series.locked) {
          room.series.locked = true; room.series.revision++;
          room.series.entrants = [...room.players.values()].map(p => ({ playerId: p.id, name: p.name, color: p.color, ...(room.evolution.mode === 'teams' ? { team: room.evolution.teams[p.id] } : {}) }));
          // A series seat capability remains stable across checkpoint restores.
          // Live session tokens still rotate when an archived seat is claimed.
          for (const p of room.players.values()) { p.seriesSeatId = room.series.id; p.seriesSeatHash = seatHash(p.token); }
          room.series.standings = seriesStandings(room.series.entrants, []);
        }
        room.phase = 'countdown'; room.matchId = randomUUID(); room.startAt = now + 3000; room.simAt = room.startAt;
        room.elimination = { nextAt: room.startAt + 45000, intervalMs: 45000, winnerId: null };
        room.firstFinishAt = null; room.updatedAt = now;
        odysseyStart(room);
        for (const p of room.players.values()) this.resetPlayer(room, p, now);
        prepareArena(room);
        summitStart(room,room.startAt);voyagerStart(room);
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
        if (message.seq <= player.receivedSeq || player.dnf || player.finishMs !== null || player.eliminated || player.eliminationWinner || player.block?.ghost) return;
        if (!arenaCanDrive(room,player)) return;
        if (room.evolution.mode === 'pursuit' && now < room.startAt + (room.evolution.releaseDelays[player.id] ?? 0) * 1000) return;
        player.receivedSeq = message.seq; player.input = { steer: message.steer, brake: message.brake }; player.lastInputAt = now; return;
      default: this.fail(client, 'BAD_MESSAGE', message);
    }
  }

  invalidateEvolutionLobby(room, now) {
    room.lobbyRevision++; room.trackRevision++; room.updatedAt = now;
    room.evolution.vote = { revision: room.evolution.vote.revision + 1, ballots: {} };
    for (const p of room.players.values()) { this.resetPlayer(room, p, now); p.ready = false; p.loaded = false; }
  }

  evolutionCommand(client, message, now) {
    const room = client.room, player = client.player;
    if (arenaMode(room)!=='off' && ['configure-event','random-series'].includes(message.type)) return this.send(client,{type:'error',code:'ARENA_RULE',message:'請先將接力／道具切回一般競速，再設定其他玩法或系列。'});
    const personal = ['select-team', 'vote-track'].includes(message.type);
    if (!personal && room.hostId !== player.id) return this.fail(client, 'HOST_ONLY', message);
    if (room.phase !== 'lobby') return this.fail(client, 'INVALID_PHASE', message);
    if (message.roomCode !== room.code || message.expectedLobbyRevision !== room.lobbyRevision) return this.fail(client, 'STALE_LOBBY', message);
    if ([...room.players.values()].some(p => !p.supportsEvolution)) return this.fail(client, 'EVOLUTION_UNSUPPORTED', message);
    if (room.series?.locked && message.type !== 'vote-track') return this.fail(client, 'SERIES_ACTIVE', message);
    const event = room.evolution;
    if (message.type === 'vote-track') {
      if (room.series || message.expectedVoteRevision !== event.vote.revision || !getMultiplayerTrack(message.trackId)) return this.fail(client, 'INVALID_VOTE', message);
      event.vote.ballots[player.id] = message.trackId; room.requiresEvolution = true; room.updatedAt = now;
    } else if (message.type === 'select-team') {
      if (!['red', 'blue'].includes(message.team) || event.mode !== 'teams') return this.fail(client, 'INVALID_EVENT', message);
      if (event.teams[player.id] === message.team) return this.broadcast(room, 'room', now);
      if ([...room.players.values()].filter(p => p.id !== player.id && event.teams[p.id] === message.team).length >= 2) return this.fail(client, 'TEAM_NOT_READY', message);
      event.teams[player.id] = message.team; this.invalidateEvolutionLobby(room, now);
    } else if (message.type === 'configure-event') {
      if (room.horizon.elimination && message.mode !== 'race') return this.fail(client, 'INVALID_HORIZON', message);
      if (!['race', 'time-trial', 'pursuit', 'teams'].includes(message.mode) || ![180, 300].includes(message.durationSeconds)
        || !isObject(message.releaseDelays) || Object.keys(message.releaseDelays).length > 4
        || !Object.entries(message.releaseDelays).every(([id, delay]) => room.players.has(id) && [0, 3, 5, 10].includes(delay))) return this.fail(client, 'INVALID_EVENT', message);
      event.mode = message.mode; event.durationSeconds = message.durationSeconds; event.releaseDelays = { ...message.releaseDelays };
      room.requiresEvolution = event.mode !== 'race';
      if (event.mode === 'time-trial') room.roomRules.collisions = false;
      if (event.mode === 'teams') room.roomRules.collisions = true;
      this.invalidateEvolutionLobby(room, now);
    } else if (message.type === 'resolve-vote') {
      if (room.series) return this.fail(client, 'SERIES_ACTIVE', message);
      const counts = new Map();
      for (const [id, trackId] of Object.entries(event.vote.ballots)) if (room.players.has(id)) counts.set(trackId, (counts.get(trackId) ?? 0) + 1);
      const winner = MULTIPLAYER_TRACKS.filter(t => counts.has(t.id)).sort((a, b) => counts.get(b.id) - counts.get(a.id))[0];
      if (!winner) return this.fail(client, 'INVALID_VOTE', message);
      let selected; try { selected = this.trackFor(winner.id); } catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
      this.changeTrack(room, winner.id, selected, now); this.invalidateEvolutionLobby(room, now);
    } else {
      if (room.horizon.elimination) return this.fail(client, 'INVALID_HORIZON', message);
      if (![3, 4, 5].includes(message.count)) return this.fail(client, 'INVALID_SERIES', message);
      const ids = MULTIPLAYER_TRACKS.map(t => t.id);
      for (let i = ids.length - 1; i > 0; i--) { const j = randomInt(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const selectedIds = ids.slice(0, message.count); let selected;
      try { for (const id of selectedIds) { const prepared = this.trackFor(id); if (id === selectedIds[0]) selected = prepared; } }
      catch { return this.fail(client, 'TRACK_UNAVAILABLE', message); }
      this.changeTrack(room, selectedIds[0], selected, now);
      room.requiresEvolution = true;
      room.series = { id: randomUUID(), originalHostId: room.hostId, revision: 1, trackIds: selectedIds, roundIndex: 0,
        locked: false, complete: false, entrants: [], rounds: [], standings: [] };
      this.invalidateEvolutionLobby(room, now);
    }
    this.broadcast(room, 'room', now);
  }

  checkpointSeries(client, message, now) {
    const room = client.room, series = room.series;
    if (room.hostId !== client.player.id) return this.fail(client, 'HOST_ONLY', message);
    if (room.phase !== 'results') return this.fail(client, 'INVALID_PHASE', message);
    if (!series || series.complete || message.roomCode !== room.code || message.matchId !== room.matchId || message.expectedSeriesRevision !== series.revision) return this.fail(client, 'STALE_SERIES', message);
    if (series.originalHostId !== client.player.id) return this.fail(client, 'ORIGINAL_HOST_ONLY', message);
    if ([...room.players.values()].some(p => !p.supportsEvolution)) return this.fail(client, 'EVOLUTION_UNSUPPORTED', message);
    const seats = series.entrants.map(e => room.players.get(e.playerId)).filter(p => p && p.token && !p.expired);
    if (seats.length < 2 || room.evolution.mode === 'teams' && seats.length !== 4) return this.fail(client, 'INVALID_CHECKPOINT', message);
    try {
      const checkpoint = this.checkpoints.sign({ series, evolution: room.evolution, roomRules: room.roomRules, trackId: room.trackId,
        horizon: room.horizon,
        matchId: room.matchId, laps: room.laps, originalHostId: series.originalHostId,
        seats: seats.map(p => ({ playerId: p.id, slot: p.slot, horizon: !!p.supportsHorizon, tokenHash: p.seriesSeatId === series.id && p.seriesSeatHash ? p.seriesSeatHash : seatHash(p.token) })) }, now);
      this.send(client, { type: 'series-checkpoint', ...checkpoint });
    } catch { this.fail(client, 'INVALID_CHECKPOINT', message); }
  }

  resumeSeries(client, request, now) {
    if (!request.clientCapabilities?.evolution) return this.fail(client, 'EVOLUTION_UNSUPPORTED', request);
    const data = this.checkpoints.verify(request.token, now);
    if (!data) return this.fail(client, 'INVALID_CHECKPOINT', request);
    if (data.horizon && horizonRequired(data.horizon) && request.clientCapabilities?.horizon !== true) return this.fail(client, 'HORIZON_UNSUPPORTED', request);
    if (this.rooms.size >= this.maxRooms) return this.fail(client, 'SERVER_FULL', request);
    const nextIndex = data.series.roundIndex + 1, trackId = data.series.trackIds[nextIndex]; let selected;
    try { selected = this.trackFor(trackId); } catch { return this.fail(client, 'TRACK_UNAVAILABLE', request); }
    let code; do { code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); } while (this.rooms.has(code));
    const series = structuredClone(data.series); series.roundIndex = nextIndex; series.revision++;
    const room = { code, hostId: data.originalHostId, phase: 'lobby', matchId: null, startAt: null, laps: data.laps,
      lobbyRevision: 1, removedPlayerIds: new Set(), series, roomRules: { ...data.roomRules }, evolution: structuredClone(data.evolution), requiresEvolution: true,
      horizon: data.horizon ?? defaultHorizon(), spectators: new Map(),
      trackId, trackStamp: selected.descriptor.trackStamp, trackRevision: 1, track: selected.track, players: new Map(),
      createdAt: now, updatedAt: now, emptySince: null, simAt: null, lastSnapshotAt: now, firstFinishAt: null };
    room.evolution.vote = { revision: room.evolution.vote.revision + 1, ballots: {} };
    for (const seat of data.seats) {
      const entrant = series.entrants.find(e => e.playerId === seat.playerId), host = entrant.playerId === data.originalHostId;
      const player = { id: entrant.playerId, name: entrant.name, color: entrant.color, slot: seat.slot,
        token: host ? randomBytes(32).toString('hex') : null, resumeHash: host ? null : seat.tokenHash,
        seriesSeatId: series.id, seriesSeatHash: seat.tokenHash,
        awaitingSeriesSeat: !host, ready: false, loaded: false, connected: host, client: host ? client : null,
        disconnectedAt: host ? null : now, expired: false, supportsRoomRules: true, supportsEvolution: true, supportsHorizon: host ? !!request.clientCapabilities?.horizon : seat.horizon === true,
        supportsVoyager:host&&request.clientCapabilities?.voyagerRacing===true,supportsArena:host&&request.clientCapabilities?.nexusArena===true,supportsAtlas:host&&request.clientCapabilities?.atlasRacing===true,supportsSummit:host&&request.clientCapabilities?.summit===true,joinedAt: now };
      this.resetPlayer(room, player, now); room.players.set(player.id, player);
      if (host) { client.room = room; client.player = player; }
    }
    prepareGrid(room);
    for (const p of room.players.values()) this.resetPlayer(room, p, now);
    this.rooms.set(code, room); this.welcome(client, request, now); this.broadcast(room, 'room', now);
  }

  teamStandings(room) {
    if (room.evolution.mode !== 'teams' || !room.series?.locked) return [];
    const series = room.series, rows = ['red', 'blue'].map(team => {
      const ids = series.entrants.filter(e => e.team === team).map(e => e.playerId);
      const results = series.rounds.flatMap(round => round.results.filter(r => ids.includes(r.playerId)));
      return { team, points: results.reduce((s, r) => s + r.points, 0), roundWins: series.rounds.filter(round => {
        const own = round.results.filter(r => ids.includes(r.playerId)).reduce((s, r) => s + r.points, 0);
        const other = round.results.filter(r => !ids.includes(r.playerId)).reduce((s, r) => s + r.points, 0); return own > other;
      }).length, wins: results.filter(r => r.rank === 1 && !r.dnf).length, finishes: results.filter(r => !r.dnf).length,
      elapsedMs: results.reduce((s, r) => s + (r.finishMs ?? 0), 0) };
    });
    return rows.sort((a, b) => b.points - a.points || b.roundWins - a.roundWins || b.wins - a.wins || b.finishes - a.finishes || a.elapsedMs - b.elapsedMs || (a.team === 'red' ? -1 : 1)).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  newCar(room, slot) {
    const cupGrid=cupGridCar(room,slot);if(cupGrid)return cupGrid;
    const summitGrid=summitGridCar(room,slot);if(summitGrid)return summitGrid;
    const grid = gridCar(room, slot); if (grid) return grid;
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
    series.rounds.push({ matchId: room.matchId, trackId: room.trackId, laps: room.laps, ...(room.evolution.mode !== 'race' ? { mode: room.evolution.mode } : {}), results });
    series.standings = seriesStandings(series.entrants, series.rounds);
    series.complete = series.rounds.length === series.trackIds.length; series.revision++;
  }

  makePlayer(room, name, request, now) {
    const used = new Set([...room.players.values()].map((p) => p.slot));
    const slot = [0, 1, 2, 3].find((n) => !used.has(n));
    const player = { id: randomUUID(), token: randomBytes(32).toString('hex'), name, slot,
      color: COLORS[slot], ready: false, loaded: false, connected: true, client:null, disconnectedAt: null, expired: false, supportsRoomRules: request.clientCapabilities?.roomRules === true, supportsEvolution: request.clientCapabilities?.evolution === true,
      car: this.newCar(room, slot), ackSeq: -1, receivedSeq: -1, input: { steer: 0, brake: true }, lastInputAt: now,
      completedLaps: 0, distance: 0, nextGate: 1, finishMs: null, lapTimesMs: [], bestLapMs: null, lastLapElapsedMs: 0,
      dnf: false, dnfReason: null, joinedAt: now };
    player.supportsHorizon = request.clientCapabilities?.horizon === true;
    player.supportsArena = request.clientCapabilities?.nexusArena === true;
    player.supportsAtlas = request.clientCapabilities?.atlasRacing === true;
    player.supportsSummit = request.clientCapabilities?.summit === true;
    player.supportsVoyager = request.clientCapabilities?.voyagerRacing === true;
    player.supportsOdyssey = request.clientCapabilities?.odysseyRacing === true;
    player.supportsExpedition = request.clientCapabilities?.expeditionRacing === true;
    player.supportsCup = request.clientCapabilities?.frontierCup === FRONTIER_CUP_VERSION;
    resetArenaPlayer(room,player);
    resetHorizonPlayer(room, player, now);
    summitResetPlayer(room,player);voyagerReset(room,player,now);odysseyResetPlayer(room,player);expeditionReset(player);
    return player;
  }

  addPlayer(client, room, name, request, now) {
    const player=this.makePlayer(room,name,request,now);player.client=client;
    client.room = room; client.player = player; room.players.set(player.id, player);
    voyagerAdded(room,player,now);
    room.hostId ||= player.id; room.updatedAt = now; room.emptySince = null;
    if (room.series && !room.series.originalHostId) room.series.originalHostId = room.hostId;
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
    if(room.cup&&request.clientCapabilities?.frontierCup!==FRONTIER_CUP_VERSION)return this.send(client,{type:'error',code:'CUP_RULE',requestId:request.requestId,message:'此房需要好友盃新版才能續接原席。'});
    if(expeditionJoinError(room,request))return this.send(client,{type:'error',code:'EXPEDITION_RULE',requestId:request.requestId,message:expeditionJoinError(room,request)});
    if(odysseyActive(room)&&request.clientCapabilities?.odysseyRacing!==true)return this.send(client,{type:'error',code:'ODYSSEY_RULE',requestId:request.requestId,message:'此房需要 Odyssey 新版才能續接。'});
    if(voyagerJoinError(room,request))return this.send(client,{type:'error',code:'VOYAGER_RULE',requestId:request.requestId,message:voyagerJoinError(room,request)});
    if(atlasJoinError(room,request))return this.send(client,{type:'error',code:'ATLAS_RULE',requestId:request.requestId,message:atlasJoinError(room,request)});
    if(summitActive(room)&&request.clientCapabilities?.summit!==true)return this.send(client,{type:'error',code:'SUMMIT_RULE',requestId:request.requestId,message:'此房需要排位週末／AI／耐久版本，請更新後續接。'});
    if(arenaMode(room)!=='off'&&request.clientCapabilities?.nexusArena!==true)return this.send(client,{type:'error',code:'ARENA_RULE',requestId:request.requestId,message:'此房需要接力／道具版本，請更新後續接。'});
    if (horizonRequired(room.horizon) && request.clientCapabilities?.horizon !== true) return this.fail(client, 'HORIZON_UNSUPPORTED', request);
    const player = room.players.get(request.playerId);
    if (!player) return this.fail(client, room.removedPlayerIds.has(request.playerId) ? 'REMOVED_BY_HOST' : 'INVALID_SESSION', request);
    if (!defaultRoomRules(room.roomRules) && !request.clientCapabilities?.roomRules) return this.fail(client, 'RULES_UNSUPPORTED', request);
    if ((room.evolution.mode !== 'race' || room.requiresEvolution) && !request.clientCapabilities?.evolution) return this.fail(client, 'EVOLUTION_UNSUPPORTED', request);
    if (player.expired || (!player.connected && !player.awaitingSeriesSeat && now - player.disconnectedAt >= (room.cup?CUP_RESUME_MS:this.disconnectMs))) {
      this.expireDisconnected(room, now); return this.fail(client, 'SESSION_EXPIRED', request);
    }
    if (!equalToken(request.token, player.token) && !(player.awaitingSeriesSeat && /^[a-f0-9]{64}$/.test(request.token) && equalToken(seatHash(request.token), player.resumeHash))) return this.fail(client, 'INVALID_SESSION', request);
    if (player.awaitingSeriesSeat) { player.token = randomBytes(32).toString('hex'); player.resumeHash = null; player.awaitingSeriesSeat = false; }
    // A single valid session owns at most one socket. The old close handler cannot
    // disconnect the replacement because it no longer owns player.client.
    const previous = player.client;
    if (previous && previous !== client) {
      previous.room = null; previous.player = null; this.send(previous, { type: 'left' }); previous.ws.close(1000, 'Session resumed');
    }
    player.client = client; player.connected = true; player.disconnectedAt = null; player.loaded = false; player.ready = false; player.supportsRoomRules = request.clientCapabilities?.roomRules === true;
    player.supportsEvolution = request.clientCapabilities?.evolution === true;
    player.supportsHorizon = request.clientCapabilities?.horizon === true;
    player.supportsArena = request.clientCapabilities?.nexusArena === true;
    player.supportsAtlas = request.clientCapabilities?.atlasRacing === true;
    player.supportsSummit = request.clientCapabilities?.summit === true;
    player.supportsVoyager = request.clientCapabilities?.voyagerRacing === true;
    player.supportsOdyssey = request.clientCapabilities?.odysseyRacing === true;
    player.supportsExpedition = request.clientCapabilities?.expeditionRacing === true;
    player.supportsCup = request.clientCapabilities?.frontierCup === FRONTIER_CUP_VERSION;
    player.input = { steer: 0, brake: true }; player.lastInputAt = now; player.receivedSeq = player.ackSeq;
    // Action sequences belong to this replacement socket; the retired socket is detached above.
    player.summitSeq = -1; player.arenaUsedSeq = -1;player.voyagerSeq=-1;
    client.room = room; client.player = player; room.emptySince = null; room.updatedAt = now;
    if (!room.players.get(room.hostId)?.connected && room.hostId !== player.id) { room.hostId = player.id; room.lobbyRevision++; }
    this.welcome(client, request, now); this.broadcast(room, 'room', now);
  }

  resetPlayer(room, player, now) {
    player.car = this.newCar(room, player.slot); player.ackSeq = -1; player.receivedSeq = -1; player.input = { steer: 0, brake: true };
    player.lastInputAt = now; player.completedLaps = 0; player.distance = 0; player.nextGate = 1;
    player.finishMs = null; player.lapTimesMs = []; player.bestLapMs = null; player.lastLapElapsedMs = 0;
    player.timeTrialDone = false;
    player.dnf = false; player.dnfReason = null;
    resetHorizonPlayer(room, player, now);
    resetArenaPlayer(room,player);
    summitResetPlayer(room,player);voyagerReset(room,player,now);odysseyResetPlayer(room,player);expeditionReset(player);
  }

  toLobby(room, now) {
    cupBeforeLobby(room);
    odysseyBeforeLobby(room);
    room.phase = 'lobby'; room.matchId = null; room.startAt = null; room.simAt = null; room.firstFinishAt = null; room.updatedAt = now;
    room.lobbyRevision++;
    summitResetLobby(room);
    prepareGrid(room);
    for (const player of room.players.values()) { this.resetPlayer(room, player, now); player.ready = false;if(room.summitTransition)player.loaded=false; }
    summitLobby(room);voyagerStart(room);
    this.electHost(room); this.broadcast(room, 'room', now);room.odysseyCancel=false;
  }

  electHost(room) {
    if (room.players.get(room.hostId)?.connected&&!room.players.get(room.hostId)?.isAi) return;
    const nextHost = [...room.players.values()].find((p) => p.connected&&!p.isAi)?.id ?? [...room.players.values()].find(p=>!p.isAi&&(!summitActive(room)||!p.expired))?.id ?? '';
    if (nextHost !== room.hostId) { room.hostId = nextHost; room.lobbyRevision++; }
  }

  disconnect(client) {
    this.clients.delete(client);
    if (client.viewer) { const room = client.room; detachViewer(client); this.broadcast(room, 'room'); return; }
    const room = client.room, player = client.player;
    client.room = null; client.player = null;
    if (!room || !player || player.client !== client) return;
    const now = this.now(); player.client = null; player.connected = false; player.ready = false; player.loaded = false;
    player.disconnectedAt = now; player.input = { steer: 0, brake: true }; player.lastInputAt = now;
    this.electHost(room); room.updatedAt = now;
    if (![...room.players.values()].some((p) => p.connected&&!p.isAi)) room.emptySince ??= now;
    if (room.phase === 'countdown') this.toLobby(room, now);
    else this.broadcast(room, 'room', now);
  }

  leave(client, now) {
    const room = client.room, player = client.player;
    client.room = null; client.player = null;
    if (!room || !player) return;
    player.client = null; player.connected = false; player.loaded = false; player.token = null; player.expired = true;
    player.disconnectedAt = now; if(cupCanDrive(room,player))this.markDnf(player, 'left'); player.input = { steer: 0, brake: true };
    if (!room.cup&&(room.phase === 'lobby' || room.phase === 'countdown' || voyagerPractice(room))) room.players.delete(player.id);
    this.electHost(room); room.updatedAt = now;
    if (![...room.players.values()].some((p) => p.connected&&!p.isAi)) room.emptySince ??= now;
    if (room.phase === 'countdown') this.toLobby(room, now);
    else if(summitRosterChanged(this,room,now))return;
    else if (!this.maybeFinish(room, now)) this.broadcast(room, 'room', now);
  }

  expireDisconnected(room, now) {
    let changed = false;
    for (const player of [...room.players.values()]) {
      if (player.connected || player.expired || player.awaitingSeriesSeat || now - player.disconnectedAt < (room.cup?CUP_RESUME_MS:this.disconnectMs)) continue;
      player.expired = true; player.token = null; if(cupCanDrive(room,player))this.markDnf(player, 'disconnect-expired'); changed = true;
      if (!room.cup&&(room.phase === 'lobby' || voyagerPractice(room))) room.players.delete(player.id);
    }
    if (changed) { this.electHost(room); if(summitRosterChanged(this,room,now))return; if (!this.maybeFinish(room, now)) this.broadcast(room, 'room', now); }
  }

  markDnf(player, reason) {
    if (player.eliminationActive) {
      if (!player.eliminated && !player.eliminationWinner) { player.eliminated = true; player.eliminationReason = reason; player.eliminationAt = this.now(); player.car.v = 0; }
      return;
    }
    if (player.finishMs !== null || player.dnf) return;
    player.dnf = true; player.dnfReason = reason;
  }

  graceMs(room) { return room.roomRules.finishGraceSeconds === 60 ? this.finishGraceMs : room.roomRules.finishGraceSeconds * 1000; }

  deadline(room) {
    if(voyagerPractice(room)&&room.startAt!==null)return{deadlineAt:room.startAt+voyagerPractice(room)*1000,deadlineReason:'race-timeout'};
    const summit=summitTimed(room)?summitDeadline(room):null;if(summit)return summit;
    if (room.startAt === null) return { deadlineAt: null, deadlineReason: null };
    if (room.evolution.mode === 'time-trial') return { deadlineAt: room.startAt + room.evolution.durationSeconds * 1000 + this.graceMs(room), deadlineReason: 'time-trial-grace' };
    const race = room.startAt + this.raceLimitMs;
    const finish = room.firstFinishAt === null ? Infinity : room.firstFinishAt + this.graceMs(room);
    return finish < race ? { deadlineAt: finish, deadlineReason: 'finish-timeout' }
      : { deadlineAt: race, deadlineReason: 'race-timeout' };
  }

  maybeFinish(room, now) {
    if (room.phase !== 'racing') return false;
    const cup=cupFinish(this,room,now);if(cup!==null)return cup;
    const practice=voyagerFinish(this,room,now);if(practice!==null)return practice;
    const summit=summitFinish(this,room,now);if(summit!==null)return summit;
    arenaSync(room);
    if (room.horizon.elimination) return eliminationStep(this, room, now);
    const players = [...room.players.values()];
    if (room.evolution.mode === 'time-trial') {
      const cutoff = room.startAt + room.evolution.durationSeconds * 1000;
      if (!players.every(p => p.dnf) && (now < cutoff || now < cutoff + this.graceMs(room) && !players.every(p => p.dnf || p.timeTrialDone))) return false;
      for (const player of players) {
        if (!player.dnf && player.bestLapMs !== null) player.finishMs = player.bestLapMs;
        else this.markDnf(player, 'time-trial-no-lap');
        player.car.v = 0;
      }
      room.phase = 'results'; room.updatedAt = now; this.recordSeriesRound(room); this.broadcast(room, 'room', now); return true;
    }
    if (now - room.startAt < this.raceLimitMs && (room.firstFinishAt === null || now - room.firstFinishAt < this.graceMs(room)) && !players.every((p) => p.dnf || p.finishMs !== null)) return false;
    const { deadlineReason } = this.deadline(room);
    for (const player of players) this.markDnf(player, deadlineReason);
    arenaSync(room);
    room.phase = 'results'; room.updatedAt = now; this.recordSeriesRound(room); this.broadcast(room, 'room', now); return true;
  }

  simulate(room, at) {
    voyagerTick(room,at);odysseyTick(room,at);
    const track = room.track, length = track.length;
    const moving = [];
    for (const player of room.players.values()) {
      if(!cupCanDrive(room,player))continue;
      if (player.dnf || player.finishMs !== null || player.timeTrialDone || player.eliminated || player.eliminationWinner) continue;
      if(voyagerPractice(room)&&(!player.loaded||player.completedLaps>=128))continue;
      if(summitBeforeStep(room,player,at))continue;
      voyagerBefore(room,player,at);
      if(arenaBeforeStep(room,player,at))continue;
      if (room.evolution.mode === 'pursuit' && at < room.startAt + (room.evolution.releaseDelays[player.id] ?? 0) * 1000) continue;
      if (updateBlock(room, player, at)) continue;
      const previous = { x: player.car.x, z: player.car.z, h: player.car.h };
      moving.push({ player, previous, s: player.car.pos.s });
      const stale = !player.connected || at - player.lastInputAt > 700;
      const impact=player.car.update(1 / 60, track, stale ? 0 : player.input.steer, stale || player.input.brake);
      voyagerAfter(room,player,at);
      atlasImpact(room,player,impact,at);
      if(impact>.5)summitEvent(room,at,'wall',[player.id],`護牆接觸強度 ${impact.toFixed(1)}；未判肇責`);
      player.ackSeq = player.receivedSeq;
    }
    // Every car first advances against the same step. Resolve contacts once for the room,
    // then use each final pose for progress and finish gates, including cars pushed by others.
    if (room.roomRules.collisions){const contacts=resolveMultiplayerCollisions(track, moving.filter(({ player }) => horizonCollisionEligible(player)&&arenaCanCollide(room,player,at)&&!(player.summit?.pitUntil>at))
      .map(({ player, previous }) => ({ id: String(player.slot), car: player.car, previous })));contactProtection(room,contacts,at);summitContacts(room,contacts,at);atlasContacts(room,contacts,at);
      if(room.summit?.stage==='qualifying')for(const c of contacts)for(const p of room.players.values())if([c.a,c.b].includes(String(p.slot)))p.summit.lapValid=false;
    }
    for (const { player, s } of moving) {
      let delta = player.car.pos.s - s;
      if (delta > length / 2) delta -= length;
      if (delta < -length / 2) delta += length;
      const before = player.distance; player.distance += delta;
      arenaAfterStep(room,player,before,at);
      summitAfterStep(room,player,before,at);
      const gate = (player.completedLaps + player.nextGate / 3) * length;
      if (delta > 0 && before < gate && player.distance + 1e-8 >= gate) {
        if (player.nextGate === 3) {
          // Use the same authoritative sub-step crossing for each completed lap
          // and the final result; client wall clocks never enter this calculation.
          const fraction = Math.max(0, Math.min(1, (gate - before) / delta));
          const elapsed = Math.max(0, at - room.startAt - TICK_MS * (1 - fraction));
          const runningElapsed = elapsed - (room.evolution.mode === 'pursuit' ? (room.evolution.releaseDelays[player.id] ?? 0) * 1000 : 0);
          const lapMs = runningElapsed - player.lastLapElapsedMs;
          if (room.evolution.mode === 'time-trial' && (player.lastLapElapsedMs >= room.evolution.durationSeconds * 1000 || elapsed > room.evolution.durationSeconds * 1000 + this.graceMs(room))) { player.timeTrialDone = true; continue; }
          player.lapTimesMs.push(lapMs); player.lastLapElapsedMs = runningElapsed;
          player.bestLapMs = player.bestLapMs === null ? lapMs : Math.min(player.bestLapMs, lapMs);
          player.completedLaps++; player.nextGate = 1;
          if(voyagerGate(room,player,3,runningElapsed,lapMs))continue;
          if(summitLap(room,player,elapsed,lapMs,at))continue;
          if (room.evolution.mode === 'time-trial') {
            if (elapsed >= room.evolution.durationSeconds * 1000) { player.timeTrialDone = true; player.car.v = 0; }
          } else if (!room.horizon.elimination && player.completedLaps >= room.laps) {
            player.finishMs = elapsed;
            player.car.v = 0; room.firstFinishAt ??= at;
          }
        } else {const fraction=Math.max(0,Math.min(1,(gate-before)/delta));voyagerGate(room,player,player.nextGate,Math.max(0,at-room.startAt-TICK_MS*(1-fraction)),0);player.nextGate++;}
      }
    }
    atlasFlags(room,at);
    expeditionTick(room,at);
    summitOvertakes(room,at);voyagerOrder(room,at);
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
          if(!cupStall(this,room,at)){
            for (const p of room.players.values()) this.markDnf(p, 'server-stall');
            this.maybeFinish(room, at);
          }
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
    odysseyFinalize(room,now);
    arenaSync(room);
    const voyager=voyagerVisible(room)?voyagerPublic(room):null;
    if(room.phase==='lobby')summitLobby(room);
    if (room.phase === 'lobby') prepareGrid(room);
    if (!room.series?.locked) for (const values of [room.evolution.teams, room.evolution.releaseDelays, room.evolution.vote.ballots]) {
      for (const id of Object.keys(values)) if (!room.players.has(id)) delete values[id];
    }
    if (room.voteLobbyRevision === undefined) room.voteLobbyRevision = room.lobbyRevision;
    if (room.voteLobbyRevision !== room.lobbyRevision) {
      room.evolution.vote = { revision: room.evolution.vote.revision + 1, ballots: {} }; room.voteLobbyRevision = room.lobbyRevision;
    }
    const players = [...room.players.values()].sort((a, b) => {
      if(room.cup&&cupCanDrive(room,a)!==cupCanDrive(room,b))return cupCanDrive(room,a)?-1:1;
      if(room.phase==='results'&&odysseyActive(room)){const aa=odysseyRuleMissed(room,a),bb=odysseyRuleMissed(room,b);if(a.dnf!==b.dnf)return a.dnf?1:-1;if(aa!==bb)return aa?1:-1;}
      if(voyagerPractice(room)||room.summit?.stage==='qualifying')return Number(a.dnf)-Number(b.dnf)||(a.bestLapMs??Infinity)-(b.bestLapMs??Infinity)||a.slot-b.slot;
      if (room.horizon.elimination) return (a.eliminationRank ?? 0) - (b.eliminationRank ?? 0) || b.distance-a.distance || a.slot-b.slot;
      if (room.evolution.mode === 'time-trial') {
        if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
        if (a.bestLapMs !== b.bestLapMs) return (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity);
        const aa = [...a.lapTimesMs].sort((x, y) => x - y), bb = [...b.lapTimesMs].sort((x, y) => x - y);
        if ((aa[1] ?? Infinity) !== (bb[1] ?? Infinity)) return (aa[1] ?? Infinity) - (bb[1] ?? Infinity);
        return b.completedLaps - a.completedLaps || a.slot - b.slot;
      }
      if (a.finishMs !== null || b.finishMs !== null) {
        if (a.finishMs === null) return 1;
        if (b.finishMs === null) return -1;
        const aa=a.finishMs+(expeditionEnabled(room)?a.expedition?.penaltyMs??0:0),bb=b.finishMs+(expeditionEnabled(room)?b.expedition?.penaltyMs??0:0);
        if (aa !== bb) return aa - bb;
      }
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.distance - a.distance || a.slot - b.slot;
    }).map((p, index) => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, loaded: p.loaded, connected: p.connected,
      car: p.car.snapshot(), ackSeq: p.ackSeq, completedLaps: p.completedLaps, progress: Math.max(0, p.distance),
      finishMs: p.finishMs === null ? null : Math.round(p.finishMs * 1000) / 1000,
      lapTimesMs: p.lapTimesMs.map(ms => Math.round(ms * 1000) / 1000),
      bestLapMs: p.bestLapMs === null ? null : Math.round(p.bestLapMs * 1000) / 1000,
      ...(room.horizon.antiBlock ? { block: { ...p.block } } : {}),
      ...(room.horizon.reverseGrid ? { gridIndex: p.gridIndex ?? p.slot } : {}),
      ...(room.horizon.elimination ? { eliminated: !!p.eliminated, eliminationWinner: !!p.eliminationWinner, eliminationRank: p.eliminationRank,
        eliminationReason: p.eliminationReason, eliminationAt: p.eliminationAt } : {}),
      ...(room.evolution.mode === 'time-trial' ? { timeTrialDone: !!p.timeTrialDone } : {}),
      ...(arenaMode(room)!=='off'?{arena:{...p.arena}}:{}),
      ...(atlasVisible(room)?{atlas:{...p.atlas}}:{}),
      ...(voyager?{voyager:{...structuredClone(p.voyager),validLaps:p.voyager.validLaps.map(ms=>Math.round(ms*1000)/1000)}}:{}),
      ...(odysseyActive(room)?{odyssey:{...p.odyssey}}:{}),
      ...(expeditionEnabled(room)?{expedition:expeditionPlayer(p)}:{}),
      ...(room.cup?{cup:cupPlayer(room,p)}:{}),
      ...(summitEventsEnabled(room)?{summit:{...p.summit,validLaps:p.summit.validLaps.map(ms=>Math.round(ms*1000)/1000)},...(room.summit?.settings.weekend&&['race','sprint'].includes(room.summit.stage)?{gridIndex:p.gridIndex??p.slot}:{})}:{}),
      ...(room.evolution.mode !== 'race' ? { team: room.evolution.teams[p.id] ?? null,
        releaseDelaySeconds: room.evolution.mode === 'pursuit' ? room.evolution.releaseDelays[p.id] ?? 0 : 0,
        netFinishMs: p.finishMs === null ? null : Math.round((p.finishMs - (room.evolution.mode === 'pursuit' ? (room.evolution.releaseDelays[p.id] ?? 0) * 1000 : 0)) * 1000) / 1000 } : {}),
      dnf: p.dnf, dnfReason: p.dnfReason ?? null, rank: index + 1 }));
    const replay = observeReplay(room, now, players);
    return { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP,
      trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision,
      code: room.code, hostId: room.hostId, hostManagement: { lobbyRevision: room.lobbyRevision }, arena: arenaPublic(room), replay,
      cup:room.cup?structuredClone(room.cup):null,
      ...(atlasVisible(room)?{atlas:structuredClone(atlasEnsure(room))}:{}),...(voyager?{voyager}:{}),
      ...(odysseyActive(room)?{odyssey:odysseyPublic(room)}:{}),
      ...(expeditionEnabled(room)?{expedition:structuredClone(room.expedition)}:{}),
      ...(summitEventsEnabled(room)?{summit:summitPublic(room)}:{}),capabilities: { lobbyOptions: true, championship: true, roomRules: true, horizon: true, replay: true, nexusArena: true,
        expeditionRacing:true,odysseyRacing:true,frontierCup:FRONTIER_CUP_VERSION,...(summitEventsEnabled(room)?{summit:true}:{}),...(voyager?{voyagerRacing:true}:{}),...(atlasVisible(room)?{atlasRacing:true}:{}),
        ...([...room.players.values()].some(p => p.supportsEvolution) ? { evolution: true, seriesResume: this.checkpoints.capability() } : {}) }, roomRules: { ...room.roomRules },
      ...([...room.players.values()].some(p => p.supportsEvolution) ? { evolution: { ...structuredClone(room.evolution), teamStandings: this.teamStandings(room) } } : {}),
      horizon: { ...room.horizon }, spectators: [...room.spectators.values()].map(v => ({ id: v.id, name: v.name, loaded: v.loaded })),
      ...(room.horizon.elimination ? { elimination: room.elimination ?? { nextAt: 0, intervalMs: 45000, winnerId: null } } : {}),
      series: room.series ? structuredClone(room.series) : null, phase: room.phase, matchId: room.matchId, startAt: room.startAt, ...this.deadline(room),
      laps: room.laps, serverTime: now, trackLength: room.track.length, players };
  }

  broadcast(room, type, now = this.now()) {
    const roomSnapshot = this.snapshot(room, now);
    for (const player of room.players.values()) if (player.connected) this.send(player.client, { type, room: roomSnapshot });
    for (const viewer of room.spectators.values()) this.send(viewer.client, { type, room: roomSnapshot });
  }

  heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) { client.ws.terminate(); continue; }
      client.alive = false;
      try { client.ws.ping(); } catch { client.ws.terminate(); }
    }
  }

  destroyRoom(room) {
    for (const viewer of room.spectators.values()) { const client=viewer.client; detachViewer(client); this.send(client, { type: 'left' }); }
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
