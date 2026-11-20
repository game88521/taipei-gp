import {parseOdysseyState,odysseyStopWindow,type OdysseyState,type OdysseyPlayer} from '../shared/odyssey-racing.ts';
import {voyagerSettings,type VoyagerSettings} from '../shared/voyager-racing.ts';
import type { RoomSnapshot } from '../shared/multiplayer-protocol';
import {atlasSettings,type AtlasSettings} from '../shared/atlas-racing.ts';
import { getMultiplayerTrack } from '../shared/multiplayer-tracks.ts';
import { DEFAULT_ROOM_RULES, parseRoomRules, type MultiplayerRoomRules } from '../shared/multiplayer-room-rules.ts';

export const MULTIPLAYER_HISTORY_KEY = 'taipei-gp-multiplayer-history-v1';
export interface HistoryPlayer { name: string; rank: number; finishMs: number | null; bestLapMs: number | null; lapTimesMs: number[]; dnf: boolean; dnfReason: string | null; points: number | null; team?: 'red' | 'blue'; netFinishMs?: number | null; releaseDelaySeconds?: number; eliminated?: boolean; eliminationWinner?: boolean; eliminationRank?: number | null;ai?:boolean;practiceSectorsMs?:[number|null,number|null,number|null];odyssey?:OdysseyPlayer }
export interface HistoryRound { trackId: string; laps: number; players: HistoryPlayer[] }
export interface MultiplayerHistoryEntry { id: string; kind: 'race' | 'series'; at: number; rules: MultiplayerRoomRules; rounds: HistoryRound[]; players: HistoryPlayer[]; mode?: 'time-trial' | 'pursuit' | 'teams' | 'elimination' | 'relay' | 'items' | 'practice'; durationSeconds?: 180 | 300 | 600 | 1200; teamStandings?: { team: 'red' | 'blue'; rank: number; points: number }[];atlas?:AtlasSettings;voyager?:VoyagerSettings;summit?:{stage:'single'|'qualifying'|'sprint'|'race';weekend:boolean;mixed:boolean;durationSeconds:null|180|480|600};odyssey?:OdysseyState }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const time = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 86400000;
const reasons = ['race-timeout', 'finish-timeout', 'disconnect-expired', 'left', 'server-stall', 'time-trial-grace', 'time-trial-no-lap'];
function parsePlayer(v: unknown, maxLaps = 5): HistoryPlayer | null {
  if (!object(v) || typeof v.name !== 'string' || v.name.length > 64 || !integer(v.rank, 1, 4) || !time(v.finishMs) || !time(v.bestLapMs)
    || typeof v.dnf !== 'boolean' || v.dnf && v.finishMs !== null || !Array.isArray(v.lapTimesMs) || v.lapTimesMs.length > maxLaps
    || v.lapTimesMs.some(n => n === null || !time(n)) || v.dnfReason !== null && !reasons.includes(String(v.dnfReason))
    || v.points !== null && !integer(v.points, 0, 50)
    || v.practiceSectorsMs!==undefined&&(!Array.isArray(v.practiceSectorsMs)||v.practiceSectorsMs.length!==3||v.practiceSectorsMs.some(n=>!time(n)))
    || v.odyssey!==undefined&&(!object(v.odyssey)||Object.keys(v.odyssey).length!==3||!Object.hasOwn(v.odyssey,'pitStartedMs')||!Object.hasOwn(v.odyssey,'qualifiedStopMs')||typeof v.odyssey.stopMissed!=='boolean'||![v.odyssey.pitStartedMs,v.odyssey.qualifiedStopMs].every(n=>n===null||typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=86400000))
    || v.ai!==undefined&&typeof v.ai!=='boolean'
    || v.team !== undefined && v.team !== 'red' && v.team !== 'blue'
    || v.netFinishMs !== undefined && !time(v.netFinishMs)
    || v.releaseDelaySeconds !== undefined && ![0, 3, 5, 10].includes(Number(v.releaseDelaySeconds))
    || v.eliminated !== undefined && typeof v.eliminated !== 'boolean' || v.eliminationWinner !== undefined && typeof v.eliminationWinner !== 'boolean'
    || v.eliminationRank !== undefined && v.eliminationRank !== null && !integer(v.eliminationRank,1,4)
    || v.eliminated && (v.eliminationWinner || v.dnf || v.finishMs !== null)) return null;
  return { ...(v.odyssey===undefined?{}:{odyssey:structuredClone(v.odyssey) as unknown as OdysseyPlayer}),name: v.name, rank: Number(v.rank), finishMs: v.finishMs as number | null, bestLapMs: v.bestLapMs as number | null,
    lapTimesMs: [...v.lapTimesMs] as number[], dnf: v.dnf, dnfReason: v.dnfReason as string | null, points: v.points as number | null,
    ...(v.team === undefined ? {} : { team: v.team as 'red' | 'blue' }), ...(v.netFinishMs === undefined ? {} : { netFinishMs: v.netFinishMs as number | null }),
    ...(v.releaseDelaySeconds === undefined ? {} : { releaseDelaySeconds: Number(v.releaseDelaySeconds) }),
    ...(v.eliminated === undefined ? {} : { eliminated: v.eliminated as boolean, eliminationWinner: v.eliminationWinner as boolean, eliminationRank: v.eliminationRank as number|null }),...(v.ai===undefined?{}:{ai:v.ai}),...(v.practiceSectorsMs===undefined?{}:{practiceSectorsMs:[...(v.practiceSectorsMs as [number|null,number|null,number|null])] as [number|null,number|null,number|null]}) };
}
function parsePlayers(v: unknown, maxLaps = 5): HistoryPlayer[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 4) return null;
  const rows = v.map(p => parsePlayer(p, maxLaps)); if (rows.some(p => !p)) return null;
  if (new Set(rows.map(p => p!.rank)).size !== rows.length) return null; return rows as HistoryPlayer[];
}
export function parseHistory(raw: string | null): MultiplayerHistoryEntry[] | null {
  if (raw === null) return [];
  if (raw.length > 200000) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.v !== 1 || !Array.isArray(value.entries) || value.entries.length > 30) return null;
  const entries: MultiplayerHistoryEntry[] = [], ids = new Set<string>(); let races = 0, series = 0;
  for (const e of value.entries) {
    if (!object(e) || typeof e.id !== 'string' || e.id.length < 1 || e.id.length > 150 || ids.has(e.id)
      || !['race', 'series'].includes(String(e.kind)) || !integer(e.at, 0, 8640000000000000) || !Array.isArray(e.rounds) || e.rounds.length < 1 || e.rounds.length > 5) return null;
    const summit=e.summit;if(summit!==undefined&&(!object(summit)||!['single','qualifying','sprint','race'].includes(String(summit.stage))||typeof summit.weekend!=='boolean'||typeof summit.mixed!=='boolean'||!([null,180,480,600] as unknown[]).includes(summit.durationSeconds)||e.kind!=='race'||(summit.stage==='qualifying'?summit.durationSeconds!==180||!summit.weekend:summit.durationSeconds===180)))return null;
    const voyager=e.voyager===undefined?undefined:voyagerSettings(e.voyager);if(voyager===null||voyager!==undefined&&(e.kind!=='race'||(e.mode==='practice')!==(voyager.practiceSeconds>0)||voyager.practiceSeconds&&voyager.practiceSeconds!==e.durationSeconds))return null;
    const atlas=e.atlas===undefined?undefined:atlasSettings(e.atlas);if(atlas===null||atlas!==undefined&&e.kind!=='race')return null;
    const odyssey=e.odyssey===undefined?undefined:parseOdysseyState(e.odyssey);if(odyssey===null||odyssey&&(!object(summit)||e.kind!=='race'||summit.mixed||summit.stage==='sprint'&&!odyssey.settings.sprintWeekend)||object(summit)&&summit.stage==='sprint'&&!odyssey?.settings.sprintWeekend)return null;
    const maxLaps = e.mode === 'practice' || e.mode === 'time-trial' || e.mode === 'elimination' ||object(summit)&&summit.durationSeconds!==null ? 128 : 5;
    const rules = parseRoomRules(e.rules), players = parsePlayers(e.players, maxLaps); if (!rules || !players) return null;
    if(odyssey){
      const s=summit as Record<string,unknown>,window=odysseyStopWindow(Number(s.durationSeconds));
      if(e.mode!==undefined||players.length<2||players.some(p=>p.ai)||voyager&&(voyager.practiceSeconds||voyager.weather!=='legacy'||voyager.vsc))return null;
      if(odyssey.settings.sprintWeekend){if(!s.weekend||!['qualifying','sprint','race'].includes(String(s.stage))||s.durationSeconds!==(s.stage==='qualifying'?180:null)||!odyssey.weekend?.locked||odyssey.weekend.entrants.length!==players.length||s.stage==='qualifying'&&(odyssey.weekend.sprint.length||odyssey.weekend.race.length)||s.stage==='sprint'&&odyssey.weekend.race.length||s.stage==='race'&&!odyssey.weekend.sprint.length)return null;}
      else if(s.weekend||s.stage!=='single'||![480,600].includes(Number(s.durationSeconds)))return null;
      for(const p of players){const v=p.odyssey;if(!v||v.qualifiedStopMs!==null&&(v.qualifiedStopMs<window.openMs||v.qualifiedStopMs>window.closeMs||v.pitStartedMs===null||v.pitStartedMs<window.openMs||v.pitStartedMs>v.qualifiedStopMs||v.stopMissed)||odyssey.settings.mandatoryStop&&v.qualifiedStopMs===null&&!v.stopMissed||!odyssey.settings.mandatoryStop&&(v.pitStartedMs!==null||v.qualifiedStopMs!==null||v.stopMissed))return null;}
    }else if(players.some(p=>p.odyssey))return null;
    const rounds: HistoryRound[] = [];
    for (const r of e.rounds) {
      if (!object(r) || typeof r.trackId !== 'string' || !getMultiplayerTrack(r.trackId) || ![1, 3, 5].includes(Number(r.laps))) return null;
      const rp = parsePlayers(r.players, maxLaps); if (!rp) return null; rounds.push({ trackId: r.trackId, laps: Number(r.laps), players: rp });
    }
    for(const r of rounds){if(odyssey){if(r.players.length!==players.length||r.players.some(p=>{const top=players.find(v=>v.rank===p.rank);return !top||top.name!==p.name||!p.odyssey||!top.odyssey||(['pitStartedMs','qualifiedStopMs','stopMissed'] as const).some(k=>p.odyssey![k]!==top.odyssey![k]);})||odyssey.weekend&&(r.trackId!==odyssey.weekend.trackId||r.laps!==((summit as Record<string,unknown>).stage==='sprint'?1:odyssey.weekend.raceLaps)))return null;}else if(r.players.some(p=>p.odyssey))return null;}
    if (e.kind === 'race' ? ++races > 20 || rounds.length !== 1 : ++series > 10) return null;
    if (e.mode !== undefined && !['time-trial', 'pursuit', 'teams', 'elimination', 'relay', 'items','practice'].includes(String(e.mode))
      || e.mode === 'elimination' && (e.kind !== 'race' || players.some(p=>typeof p.eliminated!=='boolean'||typeof p.eliminationWinner!=='boolean'||p.dnf||p.finishMs!==null||p.eliminationRank!==p.rank))
      || e.mode==='practice'&&(e.kind!=='race'||!([600,1200] as unknown[]).includes(e.durationSeconds)||rules.collisions||players.some(p=>!p.practiceSectorsMs||p.finishMs!==null&&p.finishMs!==p.bestLapMs))
      || e.durationSeconds !== undefined && !(e.mode==='practice'?[600,1200]:[180, 300]).includes(Number(e.durationSeconds))
      || e.teamStandings !== undefined && (!Array.isArray(e.teamStandings) || e.teamStandings.length !== 2 || e.teamStandings.some(t => !object(t)
        || !['red', 'blue'].includes(String(t.team)) || !integer(t.rank, 1, 2) || !integer(t.points, 0, 100)))) return null;
    ids.add(e.id); entries.push({ id: e.id, kind: e.kind as 'race' | 'series', at: Number(e.at), rules, rounds, players,
      ...(odyssey?{odyssey}:{}),...(e.mode === undefined ? {} : { mode: e.mode as MultiplayerHistoryEntry['mode'] }),...(atlas?{atlas}:{}),...(voyager?{voyager}:{}),...(summit===undefined?{}:{summit:structuredClone(summit) as MultiplayerHistoryEntry['summit']}),
      ...(e.durationSeconds === undefined ? {} : { durationSeconds: Number(e.durationSeconds) as 180 | 300 | 600 | 1200 }),
      ...(e.teamStandings === undefined ? {} : { teamStandings: (e.teamStandings as { team: 'red' | 'blue'; rank: number; points: number }[]).map(t => ({ team: t.team, rank: t.rank, points: t.points })) }) });
  }
  return entries;
}
const bound = (entries: MultiplayerHistoryEntry[]) => { let races = 0, series = 0; return [...new Map(entries.map(e => [e.id, e])).values()].sort((a, b) => b.at - a.at).filter(e => e.kind === 'race' ? ++races <= 20 : ++series <= 10); };
const noTiming = (p: { name: string; rank: number; finishMs: number | null; dnf: boolean; points?: number }): HistoryPlayer => ({ name: p.name, rank: p.rank, finishMs: p.finishMs, dnf: p.dnf, points: p.points ?? null, bestLapMs: null, lapTimesMs: [], dnfReason: null });
export class MultiplayerHistory {
  entries: MultiplayerHistoryEntry[] = [];
  error = '';
  private seen = new Set<string>();
  private blocked = false;
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {
    this.storage = storage;
    if (!storage) this.error = '瀏覽器無法保存近期戰績，本次仍可查看與匯出。';
    try { const rows = parseHistory(storage?.getItem(MULTIPLAYER_HISTORY_KEY) ?? null); if (!rows) { this.blocked = true; this.error = '近期戰績資料無法讀取；原資料已保留，清除後才能重新保存。'; } else this.entries = rows; }
    catch { this.error = '瀏覽器無法保存近期戰績，本次仍可查看與匯出。'; }
  }
  capture(room: RoomSnapshot | null, selfId: string | null, now = Date.now()) {
    if (!room || room.phase !== 'results' || !room.matchId || !room.players.some(p => p.id === selfId)) return false;
    const rules = { ...(room.roomRules ?? DEFAULT_ROOM_RULES) };
    const mode = room.voyager?.settings.practiceSeconds?'practice':room.arena?.mode&&room.arena.mode!=='off'?room.arena.mode:room.horizon?.elimination ? 'elimination' : room.evolution?.mode, metadata = mode && mode !== 'race' ? { mode, ...(mode==='practice'?{durationSeconds:room.voyager!.settings.practiceSeconds as 600|1200}:{}),...(mode === 'time-trial' ? { durationSeconds: room.evolution!.durationSeconds } : {}),
      ...(mode === 'teams' ? { teamStandings: room.evolution!.teamStandings?.map(t => ({ team: t.team, rank: t.rank, points: t.points })) } : {}) } : {};
    const players = room.players.map(p => ({ ...noTiming(p),...(p.odyssey?{odyssey:structuredClone(p.odyssey)}:{}), bestLapMs: p.bestLapMs ?? null, lapTimesMs: [...(p.lapTimesMs ?? [])], dnfReason: p.dnfReason ?? null,
      ...(mode === 'elimination' ? { eliminated:!!p.eliminated, eliminationWinner:!!p.eliminationWinner, eliminationRank:p.eliminationRank??null } : {}),
      ...(mode === 'pursuit' ? { netFinishMs: p.netFinishMs ?? null, releaseDelaySeconds: room.evolution!.releaseDelays[p.id] ?? 0 } : {}),
      ...(mode === 'teams' && room.evolution!.teams[p.id] ? { team: room.evolution!.teams[p.id] } : {}),
      ...(mode === 'relay'&&room.arena?.teams[p.id]?{team:room.arena.teams[p.id]}:{}),...(p.summit?{ai:p.summit.ai}:{}),...(mode==='practice'?{practiceSectorsMs:p.voyager?.bestSectorsMs??[null,null,null] as [null,null,null]}:{}) }));
    const advanced=room.summit,summit=advanced&&(advanced.settings.weekend||advanced.settings.endurance||advanced.mixed)?{stage:advanced.stage,weekend:advanced.settings.weekend,mixed:advanced.mixed,durationSeconds:advanced.durationSeconds as null|180|480|600}:undefined;
    const a=room.atlas?.settings,atlas=a&&(a.aiLevel!=='standard'||a.damage||a.flags)?{...a}:undefined;
    const race: MultiplayerHistoryEntry = { ...(room.odyssey?{odyssey:structuredClone(room.odyssey)}:{}),id: `race:${room.matchId}`, kind: 'race', at: now, rules, rounds: [{ trackId: room.trackId, laps: room.laps, players }], players, ...metadata,...(room.voyager&&(room.voyager.settings.practiceSeconds||room.voyager.settings.weather!=='legacy'||room.voyager.settings.vsc)?{voyager:{...room.voyager.settings}}:{}),...(atlas?{atlas}:{}),...(summit?{summit}:{}) };
    const pending = [race], s = room.series;
    if (s?.complete && s.entrants.some(e => e.playerId === selfId)) pending.push({ id: `series:${s.id}`, kind: 'series', at: now, rules, ...metadata,
      rounds: s.rounds.map(r => ({ trackId: r.trackId, laps: r.laps, players: r.results.map(noTiming) })),
      players: s.standings.map(p => ({ ...noTiming({ ...p, finishMs: null, dnf: false }), points: p.points })) });
    const fresh = pending.filter(e => !this.seen.has(e.id) && !this.entries.some(old => old.id === e.id));
    pending.forEach(e => this.seen.add(e.id)); if (!fresh.length) return false;
    // Re-read before merge so a second game tab's completed race is retained.
    if (!this.blocked) try { const stored = parseHistory(this.storage?.getItem(MULTIPLAYER_HISTORY_KEY) ?? null); if (stored) { for (const e of stored) if (!this.entries.some(old => old.id === e.id)) this.entries.push(e); }
      else { this.blocked = true; this.error = '近期戰績資料無法讀取，原資料已保留；新成績只留在本頁。'; } } catch { /* Memory history still works. */ }
    this.entries = bound([...fresh, ...this.entries]);
    const validated = parseHistory(this.export());
    if (!validated) { this.entries = this.entries.filter(e => !fresh.includes(e)); this.error = '這筆成績格式不完整，未保存；比賽不受影響。'; return false; }
    this.entries = validated;
    if (!this.blocked) try { if (!this.storage) throw Error('storage unavailable'); this.storage.setItem(MULTIPLAYER_HISTORY_KEY, this.export()); this.error = ''; }
    catch { this.error = '近期戰績未能寫入；本頁仍可查看或匯出，重新載入可能遺失。'; }
    return true;
  }
  export() { return JSON.stringify({ v: 1, entries: this.entries }, null, 2); }
  clear() { this.entries.forEach(e => this.seen.add(e.id)); try { if (!this.storage) throw Error('storage unavailable'); this.storage.removeItem(MULTIPLAYER_HISTORY_KEY); this.entries = []; this.blocked = false; this.error = ''; return true; } catch { this.error = '無法清除瀏覽器資料，請檢查儲存權限後再試。'; return false; } }
}
