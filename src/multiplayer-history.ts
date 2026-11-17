import type { RoomSnapshot } from '../shared/multiplayer-protocol';
import { getMultiplayerTrack } from '../shared/multiplayer-tracks.ts';
import { DEFAULT_ROOM_RULES, parseRoomRules, type MultiplayerRoomRules } from '../shared/multiplayer-room-rules.ts';

export const MULTIPLAYER_HISTORY_KEY = 'taipei-gp-multiplayer-history-v1';
export interface HistoryPlayer { name: string; rank: number; finishMs: number | null; bestLapMs: number | null; lapTimesMs: number[]; dnf: boolean; dnfReason: string | null; points: number | null }
export interface HistoryRound { trackId: string; laps: number; players: HistoryPlayer[] }
export interface MultiplayerHistoryEntry { id: string; kind: 'race' | 'series'; at: number; rules: MultiplayerRoomRules; rounds: HistoryRound[]; players: HistoryPlayer[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const time = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 86400000;
const reasons = ['race-timeout', 'finish-timeout', 'disconnect-expired', 'left', 'server-stall'];
function parsePlayer(v: unknown): HistoryPlayer | null {
  if (!object(v) || typeof v.name !== 'string' || v.name.length > 64 || !integer(v.rank, 1, 4) || !time(v.finishMs) || !time(v.bestLapMs)
    || typeof v.dnf !== 'boolean' || v.dnf && v.finishMs !== null || !Array.isArray(v.lapTimesMs) || v.lapTimesMs.length > 5
    || v.lapTimesMs.some(n => n === null || !time(n)) || v.dnfReason !== null && !reasons.includes(String(v.dnfReason))
    || v.points !== null && !integer(v.points, 0, 50)) return null;
  return { name: v.name, rank: Number(v.rank), finishMs: v.finishMs as number | null, bestLapMs: v.bestLapMs as number | null,
    lapTimesMs: [...v.lapTimesMs] as number[], dnf: v.dnf, dnfReason: v.dnfReason as string | null, points: v.points as number | null };
}
function parsePlayers(v: unknown): HistoryPlayer[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 4) return null;
  const rows = v.map(parsePlayer); if (rows.some(p => !p)) return null;
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
    const rules = parseRoomRules(e.rules), players = parsePlayers(e.players); if (!rules || !players) return null;
    const rounds: HistoryRound[] = [];
    for (const r of e.rounds) {
      if (!object(r) || typeof r.trackId !== 'string' || !getMultiplayerTrack(r.trackId) || ![1, 3, 5].includes(Number(r.laps))) return null;
      const rp = parsePlayers(r.players); if (!rp) return null; rounds.push({ trackId: r.trackId, laps: Number(r.laps), players: rp });
    }
    if (e.kind === 'race' ? ++races > 20 || rounds.length !== 1 : ++series > 10) return null;
    ids.add(e.id); entries.push({ id: e.id, kind: e.kind as 'race' | 'series', at: Number(e.at), rules, rounds, players });
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
    const players = room.players.map(p => ({ ...noTiming(p), bestLapMs: p.bestLapMs ?? null, lapTimesMs: [...(p.lapTimesMs ?? [])], dnfReason: p.dnfReason ?? null }));
    const race: MultiplayerHistoryEntry = { id: `race:${room.matchId}`, kind: 'race', at: now, rules, rounds: [{ trackId: room.trackId, laps: room.laps, players }], players };
    const pending = [race], s = room.series;
    if (s?.complete && s.entrants.some(e => e.playerId === selfId)) pending.push({ id: `series:${s.id}`, kind: 'series', at: now, rules,
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
