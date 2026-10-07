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

  /** 目前這段的分數（含倍率） */
  get total() { return Math.round(this.points * this.mult); }

  /** 每步更新；回傳入帳或歸零的事件 */
  update(dt: number, car: FreeCar, impact: number): { banked?: number; lost?: boolean } {
    const sp = Math.hypot(car.vx, car.vz), slip = car.slip;
    if (this.active && impact > 5) { this.active = false; return { lost: true }; }
    if (slip > MIN_SLIP && sp > 9 && slip < 1.4) {
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
