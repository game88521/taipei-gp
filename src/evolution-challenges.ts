import type { RaceField } from './rivals';
import type { Track } from './track';
import type { RaceSnapshot } from './race-state';

export const GP_CHALLENGES = [
  { id: 'pursuit', seed: 81012, title: '最後兩圈：P12 追 P8', description: 'P12 滾動起跑，最後兩圈以第 8 名內完賽。新軟胎、簡單 AI；可進站但會損失時間。', grid: 12, goal: 8, remaining: 2, wear: .05, wet: 0, hits: 99 },
  { id: 'defend', seed: 81006, title: '舊胎守住 P6', description: 'P6 滾動起跑，剩一圈；中性胎已磨耗 78%，守住第 6 名內。追兵用較新的胎。', grid: 6, goal: 6, remaining: 1, wear: .78, wet: 0, hits: 99 },
  { id: 'rain', seed: 81010, title: '雨中穩住積分', description: 'P10 雨胎起跑，剩一圈；濕地 60%，第 10 名內完賽且重撞不超過 2 次。', grid: 10, goal: 10, remaining: 1, wear: .2, wet: .6, hits: 2 },
] as const;
export type GpChallenge = typeof GP_CHALLENGES[number];
export interface ChallengeResult { success: boolean; rank: number; elapsed: number; hits: number; reason: string }
/** Scenario construction uses its own fixed seed and restores the public, validated physics snapshot. */
export function makeChallengeSnapshot(field: RaceField, track: Track, def: GpChallenge): RaceSnapshot {
  field.form = {}; field.rules = 'classic'; field.setDifficulty('easy'); field.applyDifficulty();
  field.setup(def.grid - 1, def.wet ? 3 : def.id === 'defend' ? 1 : 0, 3, undefined, 'dry');
  let seed: number = def.seed;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const order = field.racers.filter(r => !r.isPlayer);
  for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  order.splice(def.grid - 1, 0, field.me);
  field.raceTime = 120; field.wet = def.wet; field.rainAt = def.wet ? -1 : Infinity;
  field.scChance = 0; field.events = [];
  order.forEach((r, rank) => {
    const s = track.length * .3 + (def.grid - 1 - rank) * 12;
    const i = Math.round(s / track.ds) % track.N, lat = rank % 2 ? -2.4 : 2.4;
    r.car.placeAt(track, i); r.car.x -= track.tz[i] * lat; r.car.z += track.tx[i] * lat; r.car.pos.lat = lat;
    r.car.v = Math.min(45, track.vTarget[i] * .8); r.car.h = Math.atan2(track.tx[i], track.tz[i]);
    r.laps = 4 - def.remaining; r.lapStart = 120; r.finish = null; r.dnf = false;
    r.wear = r.isPlayer ? def.wear : .1 + rnd() * .1; r.compound = def.wet ? 3 : r.isPlayer && def.id === 'defend' ? 1 : 0;
    r.car.gripMul = (r.compound === 0 ? 1.03 : r.compound === 1 ? 1 : .97) * (1 - .18 * r.wear);
    r.pitReq = false; r.pit = null; r.lat = lat; r.stuck = 0;
  });
  const snapshot = field.snapshot(); snapshot.timing = []; snapshot.pitSeed = def.seed;
  return snapshot;
}
export class GpChallengeRun {
  active = false;
  definition: GpChallenge | null = null;
  initial: RaceSnapshot | null = null;
  result: ChallengeResult | null = null;
  hits = 0;
  private lastHit = -100;
  private sector = 0;
  private startTime = 120;
  constructor(readonly length: number) {}
  start(field: RaceField, snapshot: RaceSnapshot, def: GpChallenge) {
    if (!field.restore(snapshot)) throw new Error('情境快照與目前賽道不符');
    field.aiPolicy = 'safe-v1'; field.ttMode = false;
    this.definition = def; this.initial = snapshot; this.result = null; this.hits = 0; this.lastHit = -100;
    this.sector = Math.min(2, Math.floor(field.me.car.pos.s / (this.length / 3)));
    this.startTime = field.raceTime; this.active = true;
  }
  update(field: RaceField, previousS: number, valid: boolean, impact: number) {
    if (!this.active || this.result || !this.definition) return this.result;
    const s = field.me.car.pos.s, crossed = previousS > this.length - 40 && s < 40;
    const delta = crossed ? s + this.length - previousS : s - previousS;
    if (impact > 18 && field.raceTime - this.lastHit > 1) { this.hits++; this.lastHit = field.raceTime; }
    if (this.sector < 2 && previousS < (this.sector + 1) * this.length / 3 && s >= (this.sector + 1) * this.length / 3 && delta < 30) this.sector++;
    const okay = valid && delta >= -3 && delta < 35;
    field.playerLap(previousS, okay, this.sector === 2);
    if (crossed) this.sector = 0;
    const elapsed = field.raceTime - this.startTime, rank = field.standings().findIndex(r => r.isPlayer) + 1;
    const timeout = elapsed > Math.min(1800, this.length / 10 * this.definition.remaining + 60);
    if (!okay || timeout || this.hits > this.definition.hits || field.me.finish !== null) {
      const success = okay && !timeout && this.hits <= this.definition.hits && field.me.finish !== null && rank <= this.definition.goal;
      this.result = { success, rank, elapsed, hits: this.hits, reason: !okay ? '使用扶正／重置或未依序通過賽道' : timeout ? '超過關卡時限' : this.hits > this.definition.hits ? '重撞次數超出條件' : success ? '達成關卡條件' : `目標 P${this.definition.goal}，實際 P${rank}` };
    }
    return this.result;
  }
  progress(field: RaceField) {
    if (!this.definition) return '';
    const rank = field.standings().findIndex(r => r.isPlayer) + 1;
    return `${this.definition.title} ｜ P${rank}／目標 P${this.definition.goal} ｜ 剩 ${Math.max(0, field.laps - field.me.laps + 1)} 圈 ｜ 胎況 ${Math.round((1 - field.me.wear) * 100)}% ｜ ${(field.raceTime - this.startTime).toFixed(1)} 秒${this.definition.hits < 99 ? ` ｜ 重撞 ${this.hits}/${this.definition.hits}` : ''}`;
  }
  stop() { this.active = false; this.definition = null; this.initial = null; this.result = null; }
}
export const challengeRecordKey = (stamp: string, id: string) => `${stamp}:classic:safe-v1:${id}`;
/** Isolated records: this key is never part of the official Save, wallet or achievement flow. */
export class ChallengeRecords {
  private rows: Record<string, { wins: number; best: number }> = {};
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try { const data = JSON.parse(storage?.getItem('taipei-gp-scenarios-v1') ?? '{}'); for (const [k, v] of Object.entries(data).slice(0, 100)) { const r = v as { wins: number; best: number }; if (k.length < 150 && Number.isInteger(r?.wins) && r.wins > 0 && r.wins < 1e6 && Number.isFinite(r.best) && r.best > 0 && r.best < 1801) this.rows[k] = { wins: r.wins, best: r.best }; } } catch { /* no official save dependency */ }
  }
  get(key: string) { return this.rows[key] ? { ...this.rows[key] } : null; }
  record(key: string, result: ChallengeResult) {
    if (!result.success) return;
    const old = this.rows[key]; this.rows[key] = { wins: (old?.wins ?? 0) + 1, best: Math.min(old?.best ?? Infinity, result.elapsed) };
    try { this.storage?.setItem('taipei-gp-scenarios-v1', JSON.stringify(this.rows)); } catch { /* still playable in memory */ }
  }
}
