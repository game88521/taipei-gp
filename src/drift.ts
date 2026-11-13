import type { FreeCar } from './freecar';

// 甩尾計分：側滑角夠大、速度夠快就累積分數（越快、角度越大分數越多）；
// 連續甩每 1.5 秒倍率 +1（最多 ×5），停下來 2 秒內接著甩算連擊；2 秒沒甩就入帳；甩到一半撞車＝這段分數歸零

const MIN_SLIP = 0.22; // 約 12.6°
const BANK_AFTER = 2;

export class DriftScore {
  active = false;
  points = 0;
  mult = 1;
  private chainT = 0;
  private idleT = 0;
  qualifying = false;

  get bankIn() { return this.active ? Math.max(0, BANK_AFTER - this.idleT) : 0; }
  get multProgress() { return this.mult >= 5 ? 1 : (this.chainT % 1.5) / 1.5; }
  reset() { this.active = false; this.points = 0; this.mult = 1; this.chainT = 0; this.idleT = 0; this.qualifying = false; }
  /** 正常換玩法可先結算；扶正／傳送必須取消，不能保留連擊。 */
  finish(action: 'bank' | 'cancel' = 'cancel'): { banked?: number } {
    const banked = action === 'bank' && this.active && this.total >= 100 ? this.total : 0;
    this.reset();
    return banked ? { banked } : {};
  }

  /** 目前這段的分數（含倍率） */
  get total() { return Math.round(this.points * this.mult); }

  /** 每步更新；回傳入帳或歸零的事件 */
  update(dt: number, car: FreeCar, impact: number): { banked?: number; lost?: boolean } {
    const sp = Math.hypot(car.vx, car.vz), slip = car.slip;
    this.qualifying = slip > MIN_SLIP && sp > 9 && slip < 1.4;
    if (this.active && impact > 5) { this.reset(); return { lost: true }; }
    if (this.qualifying) {
      if (!this.active) { this.active = true; this.points = 0; this.mult = 1; this.chainT = 0; }
      const deg = (slip * 180) / Math.PI;
      this.points += dt * sp * (deg - 10) * 0.6;
      this.chainT += dt;
      this.mult = Math.min(5, 1 + Math.floor(this.chainT / 1.5));
      this.idleT = 0;
    } else if (this.active) {
      this.idleT += dt;
      if (this.idleT > BANK_AFTER) {
        this.active = false;
        const t = this.total;
        return t >= 100 ? { banked: t } : {};
      }
    }
    return {};
  }
}

export type DriftDuration = 60 | 90;
export type DriftMedal = 'none' | 'bronze' | 'silver' | 'gold';
export interface DriftChallengeRecord { score: number; medal: DriftMedal }
export type DriftChallengeRecords = Record<string, DriftChallengeRecord>;
export interface DriftChallengeResult extends DriftChallengeRecord { carId: string; duration: DriftDuration; key: string; personalBest: boolean }
export function driftChallengeKey(carId: string, duration: DriftDuration) { return `drift-v1:${encodeURIComponent(carId)}:${duration}`; }
export function driftMedal(score: number, duration: DriftDuration): DriftMedal {
  const scale = duration / 60;
  return score >= 18000 * scale ? 'gold' : score >= 9000 * scale ? 'silver' : score >= 3000 * scale ? 'bronze' : 'none';
}
export function parseDriftChallengeRecords(raw: unknown): DriftChallengeRecords {
  const out: DriftChallengeRecords = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw).slice(0, 500)) {
    if (!/^drift-v1:[^:]{1,160}:(60|90)$/.test(key) || !value || typeof value !== 'object') continue;
    const r = value as DriftChallengeRecord;
    if (!Number.isSafeInteger(r.score) || r.score < 0 || r.score > 1e9) continue;
    const duration: DriftDuration = key.endsWith(':90') ? 90 : 60;
    out[key] = { score: r.score, medal: driftMedal(r.score, duration) };
  }
  return out;
}

/** 與自由甩尾共用計分器；啟用時由本類呼叫 update，main 不可再呼叫一次。
 * 只計限時內已正常入帳的連擊；到時取消未入帳連擊。暫停／看地圖時不呼叫 update。 */
export class DriftChallenge {
  active = false;
  remaining = 0;
  score = 0;
  result: DriftChallengeResult | null = null;
  private duration: DriftDuration = 60;
  private carId = '';
  private records: DriftChallengeRecords = {};
  constructor(private scorer: DriftScore) {}
  start(duration: DriftDuration, carId: string, records: DriftChallengeRecords = {}) {
    if ((duration !== 60 && duration !== 90) || !carId || carId.length > 80) return false;
    this.scorer.reset();
    this.duration = duration; this.carId = carId; this.records = records;
    this.remaining = duration; this.score = 0; this.result = null; this.active = true;
    return true;
  }
  cancel() { this.active = false; this.remaining = 0; this.result = null; this.scorer.reset(); }
  update(dt: number, car: FreeCar, impact: number): { banked?: number; lost?: boolean; finished?: DriftChallengeResult } {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return {};
    const elapsed = Math.min(dt, this.remaining), event = this.scorer.update(elapsed, car, impact);
    this.score += event.banked ?? 0;
    this.remaining = Math.max(0, this.remaining - elapsed);
    if (this.remaining > 1e-8) return event;
    this.remaining = 0; this.active = false; this.scorer.reset();
    const key = driftChallengeKey(this.carId, this.duration), previous = this.records[key]?.score ?? 0;
    const medal = driftMedal(this.score, this.duration), personalBest = this.score > previous;
    this.result = { key, carId: this.carId, duration: this.duration, score: this.score, medal, personalBest };
    if (personalBest) this.records[key] = { score: this.score, medal };
    return { ...event, finished: this.result };
  }
}
