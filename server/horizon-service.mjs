import { randomUUID } from 'node:crypto';
import { Car, multiplayerCarsOverlap } from './physics.mjs';
import { defaultHorizon, parseHorizon, horizonRequired, parseRoomPreset } from '../shared/multiplayer-horizon.ts';
import { defaultEvolution } from '../shared/multiplayer-evolution.ts';
import {voyagerJoinError} from './voyager-racing-service.mjs';
import {summitActive,summitJoinError} from './summit-racing-service.mjs';
import {odysseyActive} from './odyssey-racing-service.mjs';
import {atlasJoinError} from './atlas-racing-service.mjs';
import {expeditionJoinError} from './expedition-racing-service.mjs';
import {meridianJoinError,meridianAdded} from './meridian-racing-service.mjs';
import {applyMeridianPreset,meridianPresetCapabilities} from './meridian-presets-service.mjs';
import {summitResetPlayer} from './summit-racing-service.mjs';
export { defaultHorizon, horizonRequired };
export const emptyBlock = () => ({ ghost: false, reason: null, warningAt: null, recoveryAt: null });
const validName = v => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 16 && !/[\u0000-\u001f\u007f<>"'`\\]/u.test(v);
const codeValid = v => typeof v === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(v);
const allHorizon = room => [...room.players.values()].every(p => p.supportsHorizon);
export function horizonReceive(service, client, m, now) {
  const room = client.room;
  if (m.type === 'watch' || m.type === 'create-configured') {
    if (room) { service.fail(client, 'ALREADY_JOINED', m); return true; }
    if (!service.compatible(m)) { service.fail(client, 'INCOMPATIBLE_VERSION', m); return true; }
    if (m.clientCapabilities?.horizon !== true || m.clientCapabilities?.evolution !== true || m.clientCapabilities?.roomRules !== true) { service.fail(client, 'HORIZON_UNSUPPORTED', m); return true; }
    if (!validName(m.name)) { service.fail(client, 'INVALID_NAME', m); return true; }
    if (m.type === 'watch') {
      const target = codeValid(m.code) && service.rooms.get(m.code);
      if (!target) { service.fail(client, 'ROOM_NOT_FOUND', m); return true; }
      if(meridianJoinError(target,m,true)){service.send(client,{type:'error',code:'MERIDIAN_RULE',requestId:m.requestId,message:meridianJoinError(target,m,true)});return true;}
      if(expeditionJoinError(target,m)){service.send(client,{type:'error',code:'EXPEDITION_RULE',requestId:m.requestId,message:expeditionJoinError(target,m)});return true;}
      if(odysseyActive(target)&&m.clientCapabilities?.odysseyRacing!==true){service.send(client,{type:'error',code:'ODYSSEY_RULE',requestId:m.requestId,message:'此房使用 Odyssey 房規，請更新後再觀戰。'});return true;}
      if(atlasJoinError(target,m)){service.send(client,{type:'error',code:'ATLAS_RULE',requestId:m.requestId,message:atlasJoinError(target,m)});return true;}
      if(voyagerJoinError(target,m)){service.send(client,{type:'error',code:'VOYAGER_RULE',requestId:m.requestId,message:voyagerJoinError(target,m)});return true;}
      if(summitActive(target)&&m.clientCapabilities?.summit!==true){service.send(client,{type:'error',code:'SUMMIT_RULE',requestId:m.requestId,message:'請更新遊戲後觀戰排位週末／AI／耐久。'});return true;}
      if(target.arena?.mode&&target.arena.mode!=='off'&&m.clientCapabilities?.nexusArena!==true){service.send(client,{type:'error',code:'ARENA_RULE',requestId:m.requestId,message:'此房使用接力／道具玩法，請更新後觀戰。'});return true;}
      if (target.spectators.size >= 8) { service.fail(client, 'SPECTATORS_FULL', m); return true; }
      const viewer = { id: randomUUID(), name: m.name.trim(), client, loaded: false, supportsMeridian:m.clientCapabilities?.meridianRacing===true,supportsExpedition:m.clientCapabilities?.expeditionRacing===true,supportsOdyssey:m.clientCapabilities?.odysseyRacing===true,supportsAtlas:m.clientCapabilities?.atlasRacing===true,supportsArena:m.clientCapabilities?.nexusArena===true,supportsVoyager:m.clientCapabilities?.voyagerRacing===true,supportsSummit:m.clientCapabilities?.summit===true };
      client.room = target; client.viewer = viewer; client.player = null; target.spectators.set(viewer.id, viewer);
      service.send(client, { type: 'watching', spectatorId: viewer.id, room: service.snapshot(target, now), requestId: m.requestId });
      service.broadcast(target, 'room', now); return true;
    }
    const preset = parseRoomPreset(m.preset);
    if (!preset||!meridianPresetCapabilities(preset,m.clientCapabilities)) { service.fail(client, 'INVALID_PRESET', m); return true; }
    if (service.rooms.size >= service.maxRooms) { service.fail(client, 'SERVER_FULL', m); return true; }
    let selected;
    try { for (const id of new Set([preset.trackId, ...preset.trackIds,...(preset.advanced?.meridian.mode==='championship'?preset.advanced.meridian.trackIds:[])])) { const t = service.trackFor(id); if (id === preset.trackId) selected = t; } }
    catch { service.fail(client, 'TRACK_UNAVAILABLE', m); return true; }
    let code; do { code = randomUUID().replaceAll('-', '').slice(0,6).toUpperCase().replace(/[01]/g, 'A'); } while (service.rooms.has(code));
    const event = defaultEvolution(); event.mode = preset.mode; event.durationSeconds = preset.durationSeconds;
    const created = { code, hostId: '', phase: 'lobby', matchId: null, startAt: null, laps: preset.laps, lobbyRevision: 1, removedPlayerIds: new Set(),
      series: null, roomRules: preset.roomRules, evolution: event, horizon: preset.horizon, spectators: new Map(), requiresEvolution: preset.mode !== 'race',
      trackId: preset.trackId, trackStamp: selected.descriptor.trackStamp, trackRevision: 1, track: selected.track,
      players: new Map(), createdAt: now, updatedAt: now, emptySince: null, simAt: null, lastSnapshotAt: now, firstFinishAt: null };
    // No room is visible until every setting and every track has been validated.
    if (preset.trackIds.length) created.series = { id: randomUUID(), originalHostId: '', revision: 1, trackIds: preset.trackIds,
      roundIndex: 0, locked: false, complete: false, entrants: [], rounds: [], standings: [] };
    applyMeridianPreset(created,preset.advanced);
    const host=service.makePlayer(created,m.name.trim(),m,now);host.client=client;created.players.set(host.id,host);created.hostId=host.id;meridianAdded(created,host);
    if(created.arena?.mode==='relay')created.arena.teams[host.id]='red';
    for(let i=0;i<(preset.advanced?.summit.ai??0);i++){const bot=service.makePlayer(created,`巡航 AI ${i+1}`,m,now);bot.isAi=true;bot.token=null;bot.client=null;summitResetPlayer(created,bot);created.players.set(bot.id,bot);}
    service.rooms.set(code, created);client.room=created;client.player=host;service.welcome(client,m,now);service.broadcast(created,'room',now);
    if (created.series) created.series.originalHostId = created.hostId;
    return true;
  }
  if (client.viewer) {
    if (m.type === 'leave') { detachViewer(client); service.broadcast(room, 'room', now); service.send(client, { type: 'left' }); return true; }
    if (m.type === 'track-loaded') {
      if (!service.currentSelection(room, m, true) || m.trackId !== room.trackId) service.fail(client, 'STALE_TRACK', m);
      else { client.viewer.loaded = true; service.send(client, { type: 'room', room: service.snapshot(room, now) }); }
      return true;
    }
    if (m.type === 'claim-seat') {
      if (m.roomCode !== room.code || m.expectedLobbyRevision !== room.lobbyRevision) service.fail(client, 'STALE_LOBBY', m);
      else if (room.phase !== 'lobby') service.fail(client, 'INVALID_PHASE', m);
      else if (room.series?.locked) service.fail(client, 'SERIES_LOCKED', m);
      else if(room.meridian?.locked||room.meridian&&!client.viewer.supportsMeridian)service.send(client,{type:'error',code:'MERIDIAN_RULE',requestId:m.requestId,message:'Meridian名單已鎖定，或觀眾版本不支援。'});
      else if (room.players.size >= 4) service.fail(client, 'ROOM_FULL', m);
      else if(summitJoinError(room,{clientCapabilities:{odysseyRacing:client.viewer.supportsOdyssey,summit:client.viewer.supportsSummit,atlasRacing:client.viewer.supportsAtlas}}))service.send(client,{type:'error',code:'SUMMIT_RULE',requestId:m.requestId,message:'這場週末已鎖定或需更新遊戲，現在無法轉入參賽。'});
      else if(room.arena?.mode&&room.arena.mode!=='off'&&!client.viewer.supportsArena)service.send(client,{type:'error',code:'ARENA_RULE',requestId:m.requestId,message:'請更新後再轉入接力／道具參賽。'});
      else { const expeditionRacing=client.viewer.supportsExpedition,odysseyRacing=client.viewer.supportsOdyssey,voyagerRacing=client.viewer.supportsVoyager,name = client.viewer.name,nexusArena=client.viewer.supportsArena,summit=client.viewer.supportsSummit,atlasRacing=client.viewer.supportsAtlas; detachViewer(client); service.addPlayer(client, room, name, { ...m, clientCapabilities: { roomRules: true, evolution: true, horizon: true, nexusArena,summit,atlasRacing,voyagerRacing,odysseyRacing,expeditionRacing } }, now); }
      return true;
    }
    service.fail(client, 'SPECTATOR_READ_ONLY', m); return true;
  }
  if (!['set-horizon','recover-block','claim-seat'].includes(m.type)) return false;
  if (!room || !client.player) { service.fail(client, 'NOT_IN_ROOM', m); return true; }
  const p = client.player;
  if (m.type === 'recover-block') {
    if (m.matchId !== room.matchId || m.roomCode !== room.code || room.phase !== 'racing' || !p.block?.ghost || p.eliminated || p.dnf) service.fail(client, 'INVALID_PHASE', m);
    else if (p.block.recoveryAt === null) { p.block.recoveryAt = now + 2000; service.broadcast(room, 'room', now); }
    return true;
  }
  if (m.type === 'claim-seat') { service.fail(client, 'INVALID_PHASE', m); return true; }
  const settings = parseHorizon(m.horizon);
  if(room.arena?.mode&&room.arena.mode!=='off'&&settings&&Object.values(settings).some(Boolean)){service.send(client,{type:'error',code:'ARENA_RULE',message:'請先將接力／道具切回一般競速，再開啟公平房規。'});return true;}
  if (p.id !== room.hostId) service.fail(client, 'HOST_ONLY', m);
  else if (room.phase !== 'lobby' || room.series?.locked) service.fail(client, 'INVALID_PHASE', m);
  else if (m.roomCode !== room.code || m.expectedLobbyRevision !== room.lobbyRevision) service.fail(client, 'STALE_LOBBY', m);
  else if (!settings || settings.elimination && (room.series || room.evolution.mode !== 'race' || settings.reverseGrid)) service.fail(client, 'INVALID_HORIZON', m);
  else if (horizonRequired(settings) && !allHorizon(room)) service.fail(client, 'HORIZON_UNSUPPORTED', m);
  else if (JSON.stringify(settings) !== JSON.stringify(room.horizon)) { room.horizon = settings; prepareGrid(room); service.invalidateEvolutionLobby(room, now); service.broadcast(room, 'room', now); }
  else service.broadcast(room, 'room', now);
  return true;
}
export function detachViewer(client) {
  if (!client.viewer) return false;
  client.room?.spectators.delete(client.viewer.id); client.viewer = null; client.room = null; return true;
}
export function prepareGrid(room) {
  let ordered = [...room.players.values()].sort((a,b) => a.slot-b.slot);
  if(room.summit?.settings.weekend&&room.summit.stage==='race')ordered.sort((a,b)=>(room.summit.qualifying.find(q=>q.id===a.id)?.grid??99)-(room.summit.qualifying.find(q=>q.id===b.id)?.grid??99)||a.slot-b.slot);
  const prior = room.series?.rounds.at(-1);
  if (room.horizon.reverseGrid && prior) ordered.sort((a,b) => (prior.results.find(p=>p.playerId===b.id)?.rank ?? 0)-(prior.results.find(p=>p.playerId===a.id)?.rank ?? 0) || a.slot-b.slot);
  room.gridSlots = new Map(ordered.map((p, i) => { p.gridIndex = i; return [p.slot, i]; }));
}
export function gridCar(room, slot) {
  if (!room.horizon?.reverseGrid) return null;
  const gridIndex = room.gridSlots?.get(slot) ?? slot, t = room.track;
  const i = gridIndex === 0 ? 0 : (t.N - Math.ceil(gridIndex*8/t.ds)) % t.N;
  const car = new Car(); car.resetTransient(false); car.placeAt(t, i);
  const lat = gridIndex % 2 ? 1 : -1; car.x -= t.tz[i]*lat; car.z += t.tx[i]*lat; car.pos.lat = lat;
  return car;
}
export function safeGrid(room) {
  if (!room.horizon.reverseGrid) return true;
  const cars = [...room.players.values()].map(p=>gridCar(room,p.slot));
  return cars.every((a,i)=>cars.every((b,j)=>i===j || !multiplayerCarsOverlap(room.track,a,b,.5)));
}
export function resetHorizonPlayer(room,p,now) {
  p.block = emptyBlock(); p.blockSince = null; p.blockReason = null; p.blockProtectedUntil = now+15000;
  p.eliminated = false; p.eliminationWinner = false; p.eliminationRank = null; p.eliminationReason = null; p.eliminationAt = null; p.eliminationActive = !!room.horizon.elimination;
  if (room.horizon.reverseGrid) p.distance = p.car.pos.s > room.track.length/2 ? p.car.pos.s-room.track.length : p.car.pos.s;
}
export function updateBlock(room,p,at) {
  const b = p.block;
  if (!b) return false;
  if (b.ghost) {
    p.car.v = 0;
    if (b.recoveryAt !== null && at >= b.recoveryAt) {
      const car = new Car(); car.restore(p.car.snapshot()); car.h = Math.atan2(room.track.tx[car.pos.i],room.track.tz[car.pos.i]);
      const clear = [...room.players.values()].every(q=>q===p || q.dnf || q.eliminated || q.finishMs!==null || !q.connected || !q.loaded || q.block?.ghost || !multiplayerCarsOverlap(room.track,car,q.car,.6));
      if (clear) { p.car.h = car.h; p.car.steer = 0; p.block = emptyBlock(); p.blockSince=null; p.blockReason=null; p.blockProtectedUntil=at+5000; }
    }
    return true; // A recovery tick never advances progress or grants a free move.
  }
  const release = room.startAt+(room.evolution.releaseDelays[p.id]??0)*1000;
  if (!room.horizon.antiBlock || !room.roomRules.collisions || room.evolution.mode==='time-trial' || !p.connected || !p.loaded || at<Math.max(room.startAt+15000,p.blockProtectedUntil,room.evolution.mode==='pursuit'?release+15000:0)) {
    p.blockSince=null; p.blockReason=null; b.warningAt=null; b.reason=null; return false;
  }
  const t=room.track, forward=Math.sin(p.car.h)*t.tx[p.car.pos.i]+Math.cos(p.car.h)*t.tz[p.car.pos.i];
  const reason=p.car.v<1?'idle':p.car.v>4&&forward<-.5?'reverse':null;
  if (!reason) { p.blockSince=null; p.blockReason=null; b.warningAt=null; b.reason=null; return false; }
  if (reason!==p.blockReason) { p.blockReason=reason; p.blockSince=at; b.warningAt=null; }
  const threshold=reason==='idle'?8000:3000;
  if(at-p.blockSince>=threshold) { b.reason=reason; b.warningAt??=at; if(at-b.warningAt>=3000){b.ghost=true;p.car.v=0;return true;} }
  return false;
}
export function contactProtection(room,contacts,at) {
  const slots = new Set(contacts.flatMap(c=>[c.a,c.b]));
  for(const p of room.players.values())if(slots.has(String(p.slot))){p.blockProtectedUntil=at+8000;p.blockSince=null;p.blockReason=null;if(!p.block?.ghost)p.block=emptyBlock();}
}
export function eliminationStep(service,room,at) {
  if(!room.horizon.elimination||room.phase!=='racing')return false;
  const players=[...room.players.values()];
  // Resolve simultaneous disqualifications deterministically; no unearned winner.
  for(const p of players.filter(p=>p.eliminated&&p.eliminationRank===null).sort((a,b)=>b.slot-a.slot)){
    p.eliminationRank=players.length-players.filter(q=>q.eliminationRank!==null).length;
  }
  let active=players.filter(p=>!p.eliminated);
  if(at>=room.elimination.nextAt&&active.length>1){
    const last=[...active].sort((a,b)=>a.distance-b.distance||b.slot-a.slot)[0];
    last.eliminated=true;last.eliminationRank=active.length;last.eliminationReason='last-place';last.eliminationAt=at;last.car.v=0;
    room.elimination.nextAt+=45000;active=active.filter(p=>p!==last);
  }
  if(active.length<=1){
    if(active[0]){active[0].eliminationWinner=true;active[0].eliminationRank=1;room.elimination.winnerId=active[0].id;}
    for(const p of players)p.car.v=0;
    room.phase='results';room.updatedAt=at;service.broadcast(room,'room',at);return true;
  }
  return false;
}
