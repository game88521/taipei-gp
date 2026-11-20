/** Deduplicated downloads; cancelling an opener never mounts a late UI. */
export class SummitLazy<T> {
  private pending: Promise<T> | null = null;
  private value: T | null = null;
  private generation = 0;
  loading = false;
  attempts = 0;
  downloadMs = 0;
  error = '';
  constructor(private readonly loader: () => Promise<T>) {}
  cancel() { this.generation++; this.loading = false; }
  async open(use: (value: T) => void | Promise<void>): Promise<boolean> {
    if (this.loading) return false;
    const token = ++this.generation; this.loading = true; this.error = '';
    try {
      if (!this.value) {
        if (!this.pending) {
          this.attempts++; const start = performance.now();
          this.pending = this.loader().then(value => { this.value = value; this.downloadMs = performance.now() - start; return value; });
        }
        try { await this.pending; } finally { this.pending = null; }
      }
      if (token !== this.generation) return false;
      await use(this.value!); return token === this.generation;
    } catch (error) {
      if (token === this.generation) this.error = error instanceof Error ? error.message : '功能載入失敗，請再試一次。';
      return false;
    } finally { if (token === this.generation) this.loading = false; }
  }
}
