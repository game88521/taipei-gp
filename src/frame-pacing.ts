export type FrameCap = '30' | '60' | 'unlimited';

export function frameCap(value: unknown, mobile = false): FrameCap {
  return value === '30' || value === '60' || value === 'unlimited' ? value : mobile ? '60' : 'unlimited';
}

/** 只節流繪圖；物理、計時與輸入仍由每次動畫回呼推進。0代表不設上限。 */
export class RenderPacer {
  private next = -Infinity;
  private limit = -1;
  reset() { this.next = -Infinity; this.limit = -1; }
  due(now: number, limit: number): boolean {
    if (limit !== this.limit) { this.next = -Infinity; this.limit = limit; }
    if (limit <= 0) return true;
    if (now + 0.05 < this.next) return false;
    const interval = 1000 / limit;
    this.next = this.next === -Infinity || now - this.next > interval ? now + interval : this.next + interval;
    return true;
  }
}

/** 使用實際繪圖的單調時間，避免物理dt上限把嚴重慢幀顯示成較高FPS。 */
export class RenderMeter {
  private start: number | null = null;
  private count = 0;
  reset() { this.start = null; this.count = 0; }
  sample(now: number): { fps: number; ms: number } | null {
    if (this.start == null || now < this.start) { this.start = now; this.count = 0; return null; }
    this.count++;
    const elapsed = now - this.start;
    if (elapsed < 500) return null;
    const result = { fps: this.count * 1000 / elapsed, ms: elapsed / this.count };
    this.start = now; this.count = 0;
    return result;
  }
}
