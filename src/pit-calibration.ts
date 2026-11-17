export interface PitErrorSample { predicted: number; observed: number; elapsed: number; baseline: number; at: number }
interface Bucket { key: string; samples: PitErrorSample[] }
const STORAGE = 'taipei-gp-pit-calibration-v1';
export class PitCalibration {
  private buckets: Bucket[] = [];
  private pending: { key: string; at: number; predicted: number; baseline: number; pits: number; wet: number; invalid: boolean } | null = null;
  private previousTime = -1;
  storageAvailable = true;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.storageAvailable = !!storage;
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(STORAGE) ?? 'null');
      if (Array.isArray(parsed)) this.buckets = parsed.slice(-48).flatMap(value => {
        if (!value || typeof value.key !== 'string' || value.key.length > 200 || !Array.isArray(value.samples)) return [];
        const samples = value.samples.slice(-40).filter((s: PitErrorSample) => s && [s.predicted, s.observed, s.elapsed, s.baseline, s.at].every(Number.isFinite) && Math.abs(s.observed) < 300 && s.elapsed > 0 && s.elapsed < 600 && s.baseline >= 0 && Math.abs(s.predicted) < 300);
        return [{ key: value.key, samples }];
      });
    } catch { this.storageAvailable = false; }
  }
  reset() { this.pending = null; this.previousTime = -1; }
  observe(input: { key: string; time: number; pit: { ph: string; sd: number } | null; pits: number; entry: number; wet: number; safetyCar: boolean; predicted: number; baseline: number; valid: boolean }) {
    if (input.time < this.previousTime) this.reset();
    const gap = this.previousTime < 0 ? 0 : input.time - this.previousTime; this.previousTime = input.time;
    if (this.pending && (!input.valid || input.safetyCar || gap > .25 || Math.abs(input.wet - this.pending.wet) > .05 || input.key !== this.pending.key)) this.pending.invalid = true;
    if (!this.pending && input.pit?.ph === 'in' && input.pit.sd >= input.entry - 2 && input.pit.sd <= input.entry + 5 && input.valid && !input.safetyCar && [input.predicted, input.baseline].every(Number.isFinite)) {
      this.pending = { key: input.key, at: input.time, predicted: input.predicted, baseline: input.baseline, pits: input.pits, wet: input.wet, invalid: false };
    }
    if (this.pending && !input.pit) {
      const pending = this.pending; this.pending = null;
      const elapsed = input.time - pending.at;
      if (pending.invalid || input.pits !== pending.pits + 1 || elapsed <= 1 || elapsed >= 600) return;
      const sample = { predicted: pending.predicted, observed: elapsed - pending.baseline, elapsed, baseline: pending.baseline, at: Date.now() };
      if (Math.abs(sample.observed) >= 300) return;
      let bucket = this.buckets.find(b => b.key === pending.key);
      if (!bucket) { bucket = { key: pending.key, samples: [] }; this.buckets.push(bucket); }
      bucket.samples.push(sample); bucket.samples = bucket.samples.slice(-40); this.buckets = this.buckets.slice(-48);
      try { this.storage?.setItem(STORAGE, JSON.stringify(this.buckets)); } catch { this.storageAvailable = false; }
    }
  }
  summary(key: string) {
    const samples = this.buckets.find(b => b.key === key)?.samples ?? [], errors = samples.map(s => s.observed - s.predicted).sort((a, b) => a - b);
    const median = (x: number[]) => x.length ? (x[Math.floor((x.length - 1) / 2)] + x[Math.floor(x.length / 2)]) / 2 : 0;
    const raw = median(errors), correction = Math.max(-30, Math.min(30, raw)), spread = Math.max(2, median(errors.map(e => Math.abs(e - raw)).sort((a, b) => a - b)) * 1.5);
    return { count: samples.length, ready: samples.length >= 3, correction, spread, last: samples.at(-1) ? { ...samples.at(-1)! } : null };
  }
  describe(key: string) {
    const s = this.summary(key), last = s.last;
    return `此圖／規則／乾濕分類 ${s.count} 筆有效進站觀測；${s.ready ? `以歷史中位誤差修正 ${s.correction >= 0 ? '+' : ''}${s.correction.toFixed(1)} 秒，保留至少 ±${s.spread.toFixed(1)} 秒不確定性` : '樣本不足 3 筆，維持原模型、不套校準'}。${last ? `最近觀測：進站口到匯回 ${last.elapsed.toFixed(1)} 秒，公開建議速度基準 ${last.baseline.toFixed(1)} 秒；基準差 ${last.observed.toFixed(1)} 秒，原預估 ${last.predicted.toFixed(1)} 秒。` : ''}基準差不是未進站的真實反事實圈速；安全車、濕度變化、重置或採樣缺口不納入。${this.storageAvailable ? '' : '本機保存不可用，資料僅本分頁。'}`;
  }
}
