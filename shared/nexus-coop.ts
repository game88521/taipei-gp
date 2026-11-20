import catalog from './nexus-coop-city.json' with { type: 'json' };
import {parseCoopQuick,type CoopQuick} from './odyssey-coop.ts';

export const COOP_VERSION = 5;
export const COOP_URGENT_MS = 360000;
export const COOP_RELAY_STATION: CoopStation = { ...catalog.stations[3], name: '市民大道共同中繼站' };
export const COOP_HANDOFF_MS = 10_000;
export const COOP_RESERVATION_MS = 120_000;
export const COOP_PING_MS = 30_000;
export const COOP_CITY_STAMP = catalog.stamp;
export const COOP_STATIONS: readonly CoopStation[] = catalog.stations;
export const COOP_MAX_PLAYERS = 4;
export const COOP_SESSION_MS = 20 * 60_000;
export const COOP_GRACE_MS = 30_000;
export const COOP_DWELL_MS = 1200;
export interface CoopStation { id: string; name: string; x: number; z: number; y: number; h: number }
export interface CoopPose { x: number; z: number; y: number; h: number; speed: number; driving: boolean }
export interface CoopPhysics { vx:number; vz:number; w:number; vy:number; steer:number; pitch:number; roll:number }
export interface CoopInput { steer:number; throttle:boolean; brake:boolean; handbrake:boolean; active:boolean }
export interface CoopPlayer { id: string; name: string; vehicle: string; connected: boolean; ready: boolean; pose: CoopPose; physics:CoopPhysics; ack:number; cargo: string | null; delivered: number; points: number }
export interface CoopCargo { id: string; destination: string; state: 'waiting' | 'carried' | 'delivered'; owner: string | null; leg:'direct'|'to-relay'|'to-destination'; relayFrom:string|null; offer:{to:string;expiresAt:number}|null; kind?:'urgent'|'fragile'|'standard'; deadlineAt?:number|null; integrity?:number; score?:number|null }
export interface CoopReservation { cargoId: string; playerId: string; expiresAt: number }
export interface CoopPing { playerId: string; stationId: string; expiresAt: number }
export interface CoopDispatch { reservations: CoopReservation[]; pings: CoopPing[]; quick?: CoopQuick[] }
export interface CoopRoom { code: string; hostId: string; round: number; runId: string; mode:'direct'|'relay'|'special'; phase: 'lobby' | 'running' | 'finished'; reason: '' | 'complete' | 'timeout'; startedAt: number | null; endsAt: number | null; players: CoopPlayer[]; cargo: CoopCargo[]; delivered: number; points: number; serverTime: number; dispatch: CoopDispatch }
export const COOP_VEHICLES = ['sedan', 'taxi', 'muscle', 'f1', 'super', 'police', 'pickup'] as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, n: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= n && !/[\x00-\x1f\x7f]/.test(v);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export const validCoopCode = (v: unknown): v is string => typeof v === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(v);
export function validCoopPose(v: unknown): v is CoopPose { return record(v) && number(v.x, -12000, 12000) && number(v.z, -12000, 12000) && number(v.y, -80, 500) && number(v.h, -Math.PI * 2, Math.PI * 2) && number(v.speed, 0, 90) && typeof v.driving === 'boolean'; }
export function parseCoopRoom(raw: unknown): CoopRoom | null {
  if (!record(raw) || !['direct','relay','special'].includes(String(raw.mode)) || !validCoopCode(raw.code) || !text(raw.hostId, 50) || !text(raw.runId, 80) || !Number.isSafeInteger(raw.round) || !number(raw.round, 0, 1000000) || !['lobby', 'running', 'finished'].includes(String(raw.phase)) || !['', 'complete', 'timeout'].includes(String(raw.reason)) || !number(raw.serverTime, 0, 1e16) || !Array.isArray(raw.players) || raw.players.length < 1 || raw.players.length > 4 || !Array.isArray(raw.cargo) || raw.cargo.length !== (raw.mode==='relay'?5:6) || !number(raw.delivered, 0, raw.cargo.length) || !Number.isInteger(raw.delivered) || !number(raw.points, 0, raw.mode==='special'?1000:600)||!Number.isInteger(raw.points)) return null;
  if (![raw.startedAt, raw.endsAt].every(v => v === null || number(v, 0, 1e16))) return null;
  if (raw.phase === 'lobby' ? raw.startedAt !== null || raw.endsAt !== null || raw.reason !== '' : typeof raw.startedAt !== 'number' || typeof raw.endsAt !== 'number' || raw.endsAt - raw.startedAt !== COOP_SESSION_MS || (raw.phase === 'running' ? raw.reason !== '' : !['complete', 'timeout'].includes(String(raw.reason)))) return null;
  const players: CoopPlayer[] = [], cargo: CoopCargo[] = [], ids = new Set<string>(), cargos = new Set<string>();
  for (const p of raw.players) {
    if (!record(p) || !text(p.id, 50) || ids.has(p.id) || !text(p.name, 20) || !COOP_VEHICLES.includes(p.vehicle as typeof COOP_VEHICLES[number]) || typeof p.connected !== 'boolean' || typeof p.ready !== 'boolean' || !validCoopPose(p.pose) || !record(p.physics) || !['vx','vz','w','vy','steer','pitch','roll'].every(k=>number((p.physics as Record<string,unknown>)[k],-200,200)) || !Number.isSafeInteger(p.ack) || !number(p.ack,0,1e9) || !(p.cargo === null || text(p.cargo, 30)) || !Number.isInteger(p.delivered) || !number(p.delivered, 0, 6) || !number(p.points, 0, raw.mode==='special'?1000:600)||!Number.isInteger(p.points) || raw.mode!=='special'&&p.points !== p.delivered * 100) return null;
    ids.add(p.id); players.push({ id: p.id, name: p.name, vehicle: String(p.vehicle), connected: p.connected, ready: p.ready, pose: { ...p.pose }, physics:{...p.physics} as unknown as CoopPhysics,ack:Number(p.ack),cargo: p.cargo, delivered: p.delivered, points: p.points });
  }
  if (!ids.has(raw.hostId)) return null;
  for (const c of raw.cargo) {
    if (!record(c) || !text(c.id, 30) || cargos.has(c.id) || !COOP_STATIONS.slice(1).some(s => s.id === c.destination) || !['waiting', 'carried', 'delivered'].includes(String(c.state)) || !(c.owner === null || typeof c.owner === 'string' && ids.has(c.owner))) return null;
    if (c.state === 'waiting' && c.owner !== null || c.state === 'carried' && c.owner === null) return null;
    if(!['direct','to-relay','to-destination'].includes(String(c.leg))||raw.mode!=='relay'&&c.leg!=='direct'||raw.mode==='relay'&&(c.leg==='direct'||c.destination===COOP_RELAY_STATION.id)||!(c.relayFrom===null||text(c.relayFrom,50))||c.leg==='to-destination'&&!c.relayFrom||c.leg!=='to-destination'&&c.relayFrom!==null)return null;
    if(raw.mode==='special'){
      if(!['urgent','fragile','standard'].includes(String(c.kind))||!number(c.integrity,0,100)||!(c.deadlineAt===null||number(c.deadlineAt,0,1e16))||c.kind!=='urgent'&&c.deadlineAt!==null||c.kind==='urgent'&&c.state!=='waiting'&&c.deadlineAt===null||c.kind!=='fragile'&&c.integrity!==100)return null;
      if(c.state==='delivered'?(c.kind==='standard'?c.score!==100:c.kind==='urgent'?c.score!==100&&c.score!==200:c.score!==Math.round(Number(c.integrity)*2)):c.score!==null)return null;
    }else if(['kind','deadlineAt','integrity','score'].some(k=>k in c))return null;
    if(c.offer!==null&&(!record(c.offer)||c.leg!=='to-relay'||c.state!=='carried'||typeof c.offer.to!=='string'||c.offer.to===c.owner||!players.some(p=>p.id===(c.offer as Record<string,unknown>).to&&p.connected&&!p.cargo)||!number(c.offer.expiresAt,raw.serverTime,raw.serverTime+COOP_HANDOFF_MS)))return null;
    cargos.add(c.id); cargo.push({ id: c.id, destination: String(c.destination), state: c.state as CoopCargo['state'], owner: c.owner,leg:c.leg as CoopCargo['leg'],relayFrom:c.relayFrom as string|null,offer:c.offer?{...(c.offer as CoopCargo['offer'])} as CoopCargo['offer']:null,...raw.mode==='special'?{kind:c.kind as CoopCargo['kind'],deadlineAt:c.deadlineAt as number|null,integrity:Number(c.integrity),score:c.score as number|null}:{} });
  }
  if (new Set(cargo.map(c => c.destination)).size !== cargo.length || cargo.filter(c => c.state === 'delivered').length !== raw.delivered || raw.points !== (raw.mode==='special'?cargo.reduce((n,c)=>n+(c.score??0),0):Number(raw.delivered)*100)) return null;
  if(raw.mode==='special'&&(['urgent','fragile','standard'].some(kind=>cargo.filter(c=>c.kind===kind).length!==2)||players.some(p=>p.points!==cargo.filter(c=>c.state==='delivered'&&c.owner===p.id).reduce((n,c)=>n+(c.score??0),0))))return null;
  if (raw.reason === 'complete' && raw.delivered !== cargo.length || raw.phase !== 'finished' && raw.delivered === cargo.length) return null;
  for (const p of players) if (p.cargo !== null && !cargo.some(c => c.id === p.cargo && c.owner === p.id && c.state === 'carried')) return null;
  for (const c of cargo) if (c.state === 'carried' && !players.some(p => p.id === c.owner && p.cargo === c.id)) return null;
  if (!record(raw.dispatch) || !Array.isArray(raw.dispatch.reservations) || !Array.isArray(raw.dispatch.pings) || raw.dispatch.reservations.length > 4 || raw.dispatch.pings.length > 4) return null;
  if (raw.dispatch.reservations.length && raw.phase !== 'running') return null;
  const reservations: CoopReservation[] = [], pings: CoopPing[] = [], reservedPlayers = new Set(), reservedCargo = new Set(), pingPlayers = new Set();
  for (const r of raw.dispatch.reservations) {
    if (!record(r) || typeof r.playerId !== 'string' || !players.some(p => p.id === r.playerId && p.connected && !p.cargo) || typeof r.cargoId !== 'string' || !cargo.some(c => c.id === r.cargoId && c.state === 'waiting') || reservedPlayers.has(r.playerId) || reservedCargo.has(r.cargoId) || !number(r.expiresAt, raw.serverTime, raw.serverTime + COOP_RESERVATION_MS)) return null;
    reservedPlayers.add(r.playerId); reservedCargo.add(r.cargoId); reservations.push({ playerId: r.playerId, cargoId: r.cargoId, expiresAt: r.expiresAt });
  }
  for (const p of raw.dispatch.pings) {
    if (!record(p) || typeof p.playerId !== 'string' || !players.some(v => v.id === p.playerId && v.connected) || pingPlayers.has(p.playerId) || typeof p.stationId !== 'string' || !COOP_STATIONS.some(s => s.id === p.stationId) || !number(p.expiresAt, raw.serverTime, raw.serverTime + COOP_PING_MS)) return null;
    pingPlayers.add(p.playerId); pings.push({ playerId: p.playerId, stationId: p.stationId, expiresAt: p.expiresAt });
  }
  const quick = parseCoopQuick(raw.dispatch.quick ?? [], raw.serverTime, players, cargo); if (!quick || raw.phase !== 'running' && quick.length) return null;
  return { code: raw.code, hostId: raw.hostId, runId: raw.runId, round: Number(raw.round),mode:raw.mode as CoopRoom['mode'], phase: raw.phase as CoopRoom['phase'], reason: raw.reason as CoopRoom['reason'], startedAt: raw.startedAt as number | null, endsAt: raw.endsAt as number | null, players, cargo, delivered: Number(raw.delivered), points: Number(raw.points), serverTime: raw.serverTime, dispatch: { reservations, pings, quick } };
}
export const coopStation = (id: string) => COOP_STATIONS.find(s => s.id === id) ?? null;
export const coopNear = (pose: CoopPose, station: CoopStation) => Math.hypot(pose.x - station.x, pose.z - station.z) <= 12 && Math.abs(pose.y - station.y) <= 1.6;
