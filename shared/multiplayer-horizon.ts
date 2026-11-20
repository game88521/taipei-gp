import { getMultiplayerTrack } from './multiplayer-tracks.ts';
import { parseRoomRules, type MultiplayerRoomRules } from './multiplayer-room-rules.ts';
import type { MultiplayerEventMode } from './multiplayer-evolution';
export interface HorizonSettings { antiBlock: boolean; reverseGrid: boolean; elimination: boolean }
export interface BlockState { ghost: boolean; reason: 'idle' | 'reverse' | null; warningAt: number | null; recoveryAt: number | null }
export interface EliminationState { nextAt: number; intervalMs: number; winnerId: string | null }
export interface RoomPreset {
  schema: 1; name: string; trackId: string; laps: 1 | 3 | 5; roomRules: MultiplayerRoomRules;
  mode: MultiplayerEventMode; durationSeconds: 180 | 300; trackIds: string[]; horizon: HorizonSettings;
}
export const defaultHorizon = (): HorizonSettings => ({ antiBlock: false, reverseGrid: false, elimination: false });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseHorizon(v: unknown): HorizonSettings | null {
  return object(v) && Object.keys(v).length === 3 && ['antiBlock', 'reverseGrid', 'elimination'].every(k => typeof v[k] === 'boolean')
    ? { antiBlock: v.antiBlock as boolean, reverseGrid: v.reverseGrid as boolean, elimination: v.elimination as boolean } : null;
}
export const horizonRequired = (v: HorizonSettings) => v.antiBlock || v.reverseGrid || v.elimination;
/** Projection rejects identity-bearing or unknown fields instead of retaining them. */
export function parseRoomPreset(v: unknown): RoomPreset | null {
  const keys = ['schema','name','trackId','laps','roomRules','mode','durationSeconds','trackIds','horizon'];
  if (!object(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) || v.schema !== 1
    || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 32 || /[\u0000-\u001f<>]/.test(v.name)
    || typeof v.trackId !== 'string' || !getMultiplayerTrack(v.trackId) || ![1,3,5].includes(Number(v.laps))
    || typeof v.laps !== 'number' || !['race','time-trial','pursuit','teams'].includes(String(v.mode)) || ![180,300].includes(Number(v.durationSeconds)) || typeof v.durationSeconds !== 'number'
    || !Array.isArray(v.trackIds) || ![0,3,4,5].includes(v.trackIds.length) || new Set(v.trackIds).size !== v.trackIds.length
    || v.trackIds.some(id => typeof id !== 'string' || !getMultiplayerTrack(id))) return null;
  const roomRules = parseRoomRules(v.roomRules), horizon = parseHorizon(v.horizon);
  if (!roomRules || !horizon || v.trackIds.length && v.trackIds[0] !== v.trackId
    || v.mode === 'time-trial' && roomRules.collisions || v.mode === 'teams' && (!roomRules.collisions || !v.trackIds.length)
    || horizon.elimination && (v.mode !== 'race' || v.trackIds.length || horizon.reverseGrid)) return null;
  return { schema: 1, name: v.name.trim(), trackId: v.trackId, laps: v.laps as 1|3|5, roomRules, mode: v.mode as MultiplayerEventMode,
    durationSeconds: v.durationSeconds as 180|300, trackIds: [...v.trackIds] as string[], horizon };
}
/** Shared authority eligibility; no client clock can grant collision immunity. */
export function horizonCollisionEligible(p: { connected: boolean; loaded: boolean; dnf: boolean; finishMs: number | null; eliminated?: boolean; eliminationWinner?: boolean; block?: BlockState }) {
  return p.connected && p.loaded && !p.dnf && p.finishMs === null && !p.eliminated && !p.eliminationWinner && !p.block?.ghost;
}
export function validateHorizonSnapshot(room: Record<string, unknown>) {
  const cap = object(room.capabilities) ? room.capabilities.horizon : undefined;
  if (cap === undefined) { if ('horizon' in room || 'spectators' in room || 'elimination' in room) throw Error('Horizon 能力與資料不一致。'); return; }
  const h = parseHorizon(room.horizon);
  if (cap !== true || !h || !Array.isArray(room.spectators) || room.spectators.length > 8 || new Set(room.spectators.map(v => object(v) ? v.id : null)).size !== room.spectators.length
    || room.spectators.some(v => !object(v) || typeof v.id !== 'string' || !v.id || v.id.length > 128 || typeof v.name !== 'string' || v.name.length > 16 || typeof v.loaded !== 'boolean')) throw Error('Horizon 房規或觀眾資料無效。');
  if (!Array.isArray(room.players)) throw Error('Horizon 車手資料無效。');
  if (room.spectators.some(v=>room.players instanceof Array && room.players.some(p=>object(p)&&object(v)&&p.id===v.id))) throw Error('觀眾與車手身分不可重複。');
  if (h.reverseGrid && new Set(room.players.map(p=>object(p)?p.gridIndex:null)).size!==room.players.length) throw Error('發車格序重複。');
  if (h.elimination) {
    const e=room.elimination;
    if (room.series || !object(room.evolution) || room.evolution.mode!=='race' || h.reverseGrid || !object(e) || typeof e.nextAt!=='number' || !Number.isFinite(e.nextAt) || e.intervalMs!==45000 || e.winnerId!==null && typeof e.winnerId!=='string') throw Error('淘汰賽資料無效。');
  } else if ('elimination' in room) throw Error('非淘汰賽不可提供淘汰狀態。');
  for (const value of room.players) {
    if (!object(value)) throw Error('車手資料無效。');
    if (h.reverseGrid && (!Number.isInteger(value.gridIndex) || Number(value.gridIndex)<0 || Number(value.gridIndex)>3)) throw Error('發車格序無效。');
    if (h.antiBlock) {
      const b=value.block;
      if (!object(b) || typeof b.ghost!=='boolean' || ![null,'idle','reverse'].includes(b.reason as null) || [b.warningAt,b.recoveryAt].some(t=>t!==null&&(typeof t!=='number'||!Number.isFinite(t))) || b.ghost&&b.reason===null) throw Error('防堵路狀態無效。');
    } else if ('block' in value) throw Error('未開啟防堵路不可提供保護狀態。');
    if (h.elimination) {
      if (typeof value.eliminated!=='boolean' || typeof value.eliminationWinner!=='boolean' || value.eliminated&&value.eliminationWinner || value.dnf || value.finishMs!==null
        || value.eliminationRank!==null&&(!Number.isInteger(value.eliminationRank)||Number(value.eliminationRank)<1||Number(value.eliminationRank)>4)
        || value.eliminationReason!==null&&!['last-place','disconnect-expired','left','server-stall','race-timeout','finish-timeout'].includes(String(value.eliminationReason))
        || value.eliminationAt!==null&&(typeof value.eliminationAt!=='number'||!Number.isFinite(value.eliminationAt))) throw Error('淘汰分類無效。');
    } else if ('eliminated' in value || 'eliminationWinner' in value || 'eliminationRank' in value) throw Error('非淘汰賽不可提供淘汰分類。');
  }
}
