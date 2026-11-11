/** 共同計時點的實測通過時間。不同速度、進站與套圈都不再以固定速度換算。 */
export interface TimingEntry { name: string; progress: number; time: number; splits: [number, number][] }
export class RaceTiming {
  private cars = new Map<string, { progress: number; time: number; splits: Map<number, number> }>();
  constructor(readonly spacing = 50) {}
  clear() { this.cars.clear(); }
  progressOf(name: string): number | undefined { return this.cars.get(name)?.progress; }
  observe(name: string, progress: number, time: number) {
    const old = this.cars.get(name);
    if (!old) { this.cars.set(name, { progress, time, splits: new Map() }); return; }
    if (progress > old.progress && time >= old.time) {
      const first = Math.floor(old.progress / this.spacing) + 1, last = Math.floor(progress / this.spacing);
      // 每一步只跨少量點；異常傳送不能製造整圈的計時證據。
      if (last - first < 20) for (let k = first; k <= last; k++) {
        if (!old.splits.has(k)) old.splits.set(k, old.time + ((k * this.spacing - old.progress) / (progress - old.progress)) * (time - old.time));
      }
    }
    old.progress = progress; old.time = time;
  }
  gap(ahead: string, behind: string): number | null {
    const a = this.cars.get(ahead), b = this.cars.get(behind);
    if (!a || !b || a.progress < b.progress) return null;
    const k = Math.floor(Math.min(a.progress, b.progress) / this.spacing);
    // 最近的共同比較點。尚未共同通過任何點時顯示未知，不捏造秒差。
    for (let n = k; n >= k - 20; n--) {
      const at = a.splits.get(n), bt = b.splits.get(n);
      if (at !== undefined && bt !== undefined) return Math.max(0, bt - at);
    }
    return null;
  }
  snapshot(): TimingEntry[] {
    return [...this.cars].map(([name, c]) => ({ name, progress: c.progress, time: c.time, splits: [...c.splits].sort((a, b) => a[0] - b[0]) }));
  }
  restore(entries: TimingEntry[]) {
    this.cars.clear();
    for (const c of entries) this.cars.set(c.name, { progress: c.progress, time: c.time, splits: new Map(c.splits) });
  }
}
