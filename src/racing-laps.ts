export interface SessionLapInput { time: number; sectors: readonly (number | null)[]; valid: boolean }
export interface SessionLap {
  lap: number; time: number; sectors: (number | null)[]; valid: boolean;
  delta: number | null; sectorDeltas: (number | null)[];
}
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** 僅記錄目前場次。無效圈保留在圈表，但不影響最佳圈、分段或穩定度。 */
export class SessionLaps {
  private laps: SessionLap[] = [];
  private serial = 0;
  private bestTime: number | null = null;
  private sectors: (number | null)[] = [null, null, null];
  constructor(private capacity = 10) { this.capacity = Math.max(1, Math.min(100, Math.floor(capacity) || 10)); }
  clear() { this.laps = []; this.serial = 0; this.bestTime = null; this.sectors = [null, null, null]; }
  add(input: SessionLapInput): SessionLap {
    const valid = input.valid && positive(input.time);
    const sectors = [0, 1, 2].map((i) => positive(input.sectors[i]) ? input.sectors[i] as number : null);
    const row: SessionLap = { lap: ++this.serial, time: positive(input.time) ? input.time : 0, sectors, valid,
      delta: valid && this.bestTime !== null ? input.time - this.bestTime : null,
      sectorDeltas: sectors.map((s, i) => valid && s !== null && this.sectors[i] !== null ? s - this.sectors[i]! : null) };
    if (valid) {
      this.bestTime = this.bestTime === null ? input.time : Math.min(this.bestTime, input.time);
      sectors.forEach((s, i) => { if (s !== null) this.sectors[i] = this.sectors[i] === null ? s : Math.min(this.sectors[i]!, s); });
    }
    this.laps.push(row);
    if (this.laps.length > this.capacity) this.laps.shift();
    return { ...row, sectors: [...row.sectors], sectorDeltas: [...row.sectorDeltas] };
  }
  rows(limit = 10): SessionLap[] {
    const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : this.capacity;
    return (n ? this.laps.slice(-n) : []).map((r) => ({ ...r, sectors: [...r.sectors], sectorDeltas: [...r.sectorDeltas] }));
  }
  /** 穩定度僅使用保留的最近有效圈；最佳圈／理論最佳則涵蓋整個場次。 */
  summary() {
    const values = this.laps.filter((r) => r.valid).map((r) => r.time);
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const stddev = average !== null ? Math.sqrt(values.reduce((a, b) => a + (b - average) ** 2, 0) / values.length) : null;
    return { count: this.serial, validCount: values.length, best: this.bestTime, average,
      spread: values.length ? Math.max(...values) - Math.min(...values) : null, stddev,
      consistency: average !== null && stddev !== null ? Math.max(0, 100 * (1 - stddev / average)) : null,
      bestSectors: [...this.sectors], theoreticalBest: this.sectors.every((s) => s !== null) ? this.sectors.reduce<number>((a, b) => a + b!, 0) : null };
  }
}

/** 有效圈及無效／超時嘗試都會消耗次數；最佳圈只取有效結果。 */
export class QualifyingAttempts {
  readonly limit: 1 | 2 | 3;
  completed = 0;
  best: number | null = null;
  constructor(limit: number = 1) { this.limit = limit === 2 || limit === 3 ? limit : 1; }
  get done() { return this.completed >= this.limit; }
  add(time: number | null) {
    if (!this.done) {
      this.completed++;
      if (positive(time)) this.best = this.best === null ? time : Math.min(this.best, time);
    }
    return { done: this.done, best: this.best, completed: this.completed };
  }
}
