/** 只讀 Police 的真實 escapeIn；不持有或推進追緝計時。 */
export class PoliceEscapeWarning {
  private second = -1;
  update(active: boolean, distance: number, escapeIn: number) {
    if (!active || !Number.isFinite(distance) || distance <= 450 || !Number.isFinite(escapeIn)) {
      this.second = -1; return null;
    }
    const remaining = Math.max(0, Math.min(8, escapeIn)), second = Math.ceil(remaining);
    const beep = second > 0 && second !== this.second;
    this.second = second;
    return { remaining, urgent: remaining <= 3, beep,
      text: `跟丟倒數 ${remaining.toFixed(1)} s｜追回 450 m 內` };
  }
}
