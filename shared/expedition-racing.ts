export const EXPEDITION_RACING_VERSION = 'expedition-racing-v1';
export interface ExpeditionSettings { boundary: boolean; vsc: boolean }
export interface ExpeditionRaceState { version: typeof EXPEDITION_RACING_VERSION; settings: ExpeditionSettings }
export interface ExpeditionPenalty { warnings: number; vscPasses: number; penaltyMs: number; adjustedFinishMs: number | null; lastReason: 'boundary' | 'vsc' | null; lastAt: number | null }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function expeditionSettings(v: unknown): ExpeditionSettings | null { return object(v) && Object.keys(v).length === 2 && typeof v.boundary === 'boolean' && typeof v.vsc === 'boolean' ? { boundary: v.boundary, vsc: v.vsc } : null; }
export const expeditionPenaltyMs = (warnings: number, passes: number) => Math.min(60000, (Math.max(0, warnings - 2) + passes) * 5000);
export function validExpeditionPenalty(v: unknown, finish: number | null, settings?: ExpeditionSettings): v is ExpeditionPenalty {
  if (!object(v) || Object.keys(v).length !== 6 || !Number.isInteger(v.warnings) || Number(v.warnings) < 0 || Number(v.warnings) > 999 || !Number.isInteger(v.vscPasses) || Number(v.vscPasses) < 0 || Number(v.vscPasses) > 999 || v.penaltyMs !== expeditionPenaltyMs(Number(v.warnings), Number(v.vscPasses)) || ![null, 'boundary', 'vsc'].includes(v.lastReason as string | null)
    || v.lastAt !== null && (typeof v.lastAt !== 'number' || !Number.isFinite(v.lastAt) || v.lastAt < 0 || v.lastAt > 86400000) || (Number(v.warnings) + Number(v.vscPasses) === 0) !== (v.lastReason === null && v.lastAt === null)
    || Number(v.warnings)+Number(v.vscPasses)>0&&(v.lastReason===null||v.lastAt===null||v.lastReason==='boundary'&&Number(v.warnings)===0||v.lastReason==='vsc'&&Number(v.vscPasses)===0)
    || settings && (!settings.boundary && Number(v.warnings) !== 0 || !settings.vsc && Number(v.vscPasses) !== 0)) return false;
  return finish === null ? v.adjustedFinishMs === null : typeof v.adjustedFinishMs === 'number' && Math.abs(v.adjustedFinishMs - finish - Number(v.penaltyMs)) < .002;
}
export function validateExpedition(room: Record<string, unknown>) {
  const state = room.expedition, players = room.players as Record<string, unknown>[];
  const cap=(room.capabilities as Record<string,unknown>|undefined)?.expeditionRacing;if(cap!==undefined&&cap!==true)throw Error('賽規能力無效。');
  if (state === undefined) { if (players.some(p => p.expedition !== undefined)) throw Error('賽規資料缺少設定。'); return; }
  if ((room.capabilities as Record<string, unknown>)?.expeditionRacing !== true || !object(state) || Object.keys(state).length !== 2 || state.version !== EXPEDITION_RACING_VERSION || !expeditionSettings(state.settings)) throw Error('賽規版本或設定無效。');
  const settings = expeditionSettings(state.settings)!;
  if (!settings.boundary && !settings.vsc || room.series || (room.evolution as { mode?: string })?.mode !== 'race' || Object.values(room.horizon as object ?? {}).some(Boolean) || (room.arena as { mode?: string })?.mode !== 'off' || room.odyssey || (room.summit as { settings?: { weekend?: boolean; endurance?: number } })?.settings?.weekend || (room.summit as { settings?: { endurance?: number } })?.settings?.endurance || (room.voyager as { settings?: { practiceSeconds?: number } })?.settings?.practiceSeconds) throw Error('目前玩法不能套用正式賽規。');
  for (const p of players) if (!validExpeditionPenalty(p.expedition, p.finishMs as number | null, settings)||(p.expedition as ExpeditionPenalty).lastAt!==null&&(p.expedition as ExpeditionPenalty).lastAt!>Math.max(0,Number(room.serverTime)-Number(room.startAt??room.serverTime))+1) throw Error('賽規罰秒資料無效。');
}
