import { decodeTile } from './citydata';
import { genTile, makeCtx, type GenCtx, type GenInit, type GenOut } from './tilegen';
import { fetchJsonWithRetry } from './network';

// 幾個背景執行緒輪流算城市區塊（tileworker.ts）；開不了 Worker（很舊的瀏覽器）或 Worker 掛掉，就改在主執行緒算（結果一樣，只是比較會頓）

export class TilePool {
  private workers: Worker[] = [];
  private next = 0;
  private id = 0;
  private wait = new Map<number, { res: (o: GenOut) => void; rej: (e: Error) => void; w: Worker }>();
  private local: GenCtx | null = null;
  private disposed = false;
  private controller = new AbortController();

  constructor(private init: GenInit, n: number) {
    try {
      for (let k = 0; k < n; k++) {
        const w = new Worker(new URL('./tileworker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.done(e.data);
        w.onerror = (e) => { e.preventDefault(); this.drop(w); };
        w.postMessage({ type: 'init', init });
        this.workers.push(w);
      }
    } catch {
      for (const worker of this.workers) worker.terminate();
      this.workers = [];
    }
  }

  /** 同時在算的有幾個（開場預先送幾塊下去） */
  get size() { return Math.max(1, this.workers.length); }
  get usingWorkers() { return this.workers.length > 0; }

  private done(m: { id: number; out?: GenOut; error?: string }) {
    const p = this.wait.get(m.id);
    if (!p) return;
    this.wait.delete(m.id);
    if (m.error) p.rej(new Error(m.error)); else p.res(m.out!);
  }

  /** 這個 Worker 掛了：不再用它，交給它的工作改在主執行緒重算 */
  private drop(w: Worker) {
    this.workers = this.workers.filter((x) => x !== w);
    w.terminate();
    for (const [id, p] of this.wait) if (p.w === w) { this.wait.delete(id); p.rej(new Error('Worker 失敗')); }
  }

  /** 換地圖時停止背景工作；取消不走 Worker 失敗的主執行緒備援。 */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    for (const worker of this.workers) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
    this.workers = [];
    const error = new DOMException('城市載入已取消。', 'AbortError');
    for (const pending of this.wait.values()) pending.rej(error);
    this.wait.clear();
    this.local = null;
  }

  run(url: string, tag: number): Promise<GenOut> {
    if (this.disposed) return Promise.reject(new DOMException('城市載入已取消。', 'AbortError'));
    if (!this.workers.length) return this.runLocal(url, tag);
    const w = this.workers[this.next++ % this.workers.length], id = ++this.id;
    return new Promise<GenOut>((res, rej) => {
      this.wait.set(id, { res, rej, w });
      w.postMessage({ type: 'tile', id, url, tag });
    }).catch((e) => (this.disposed || this.workers.length ? Promise.reject(e) : this.runLocal(url, tag)));
  }

  private async runLocal(url: string, tag: number): Promise<GenOut> {
    if (this.disposed) throw new DOMException('城市載入已取消。', 'AbortError');
    this.local ??= makeCtx(this.init);
    const data = await fetchJsonWithRetry<Parameters<typeof decodeTile>[0]>(url, { label: '城市區塊', signal: this.controller.signal });
    if (this.disposed) throw new DOMException('城市載入已取消。', 'AbortError');
    return genTile(decodeTile(data), tag, this.local);
  }
}
