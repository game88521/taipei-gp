/** Arrival timing only affects remote-car presentation. Authority/input/prediction are untouched. */
export class MultiplayerNetworkWindow {
  delayMs = 110;
  private arrivals: number[] = [];
  private gaps: number[] = [];
  private transit: number[] = [];
  private lastServer = -Infinity;
  private lastArrival = -Infinity;
  reset() { this.delayMs = 110; this.arrivals = []; this.gaps = []; this.transit = []; this.lastServer = this.lastArrival = -Infinity; }
  observe(arrival: number, serverTime: number, estimatedServerNow = serverTime) {
    if (!Number.isFinite(arrival) || !Number.isFinite(serverTime) || !Number.isFinite(estimatedServerNow) || arrival < this.lastArrival || serverTime <= this.lastServer) return;
    if (Number.isFinite(this.lastArrival)) {
      const gap = Math.max(0, arrival - this.lastArrival);
      this.gaps.push(Math.min(1000, gap)); this.gaps = this.gaps.slice(-40);
      const sorted = [...this.gaps].sort((a, b) => a - b), p90 = sorted[Math.floor((sorted.length - 1) * .9)] ?? 50;
      const ages = [...this.transit].sort((a, b) => a - b), age = ages[Math.floor((ages.length - 1) * .9)] ?? 0;
      const target = Math.max(80, Math.min(220, age + p90 + 30));
      this.delayMs = Math.max(80, Math.min(220, this.delayMs + Math.max(-1, Math.min(12, target - this.delayMs))));
    }
    this.lastServer = serverTime; this.lastArrival = arrival;
    this.transit.push(Math.max(0, Math.min(1000, estimatedServerNow - serverTime))); this.transit = this.transit.slice(-40);
    this.arrivals.push(arrival); this.arrivals = this.arrivals.slice(-40);
  }
  age(now: number) { return Number.isFinite(this.lastArrival) ? Math.max(0, now - this.lastArrival) : null; }
  warning(now: number) { const age = this.age(now); return age !== null && age > 500 ? `網路快照已停頓 ${(age / 1000).toFixed(1)} 秒，畫面等待同步。` : ''; }
  diagnostics(now: number) { return { interpolationMs: this.delayMs, snapshotAgeMs: this.age(now), samples: this.arrivals.length }; }
}
