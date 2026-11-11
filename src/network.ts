// 網路讀取共用期限：包含回應標頭與串流，不讓載入停在永遠 pending。
export interface DownloadOptions extends RequestInit {
  timeoutMs?: number;
  idleTimeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  label?: string;
  onProgress?: (bytes: number) => void;
}

export class DownloadError extends Error {
  constructor(message: string, readonly code: 'timeout' | 'idle' | 'http' | 'network' | 'invalid' | 'cancelled', readonly status?: number) {
    super(message);
    this.name = code === 'cancelled' ? 'AbortError' : 'DownloadError';
  }
  get retryable() { return this.code === 'timeout' || this.code === 'idle' || this.code === 'network' || (this.code === 'http' && (this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500)); }
}

const cancelled = () => new DownloadError('下載已取消。', 'cancelled');
const deadline = (value: number | undefined, fallback: number) => Number.isFinite(value) && value! > 0 ? value! : fallback;

async function readAttempt<T>(url: string, options: DownloadOptions, signal: AbortSignal): Promise<T> {
  const { timeoutMs, idleTimeoutMs, retries: _retries, retryDelayMs: _delay, label = '資料', onProgress, ...init } = options;
  void _retries; void _delay;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort!: (reason: DownloadError) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = (reason: DownloadError) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectAbort(reason);
    void reader?.cancel(reason).catch(() => {});
  };
  const abort = () => stop(cancelled());
  signal.addEventListener('abort', abort, { once: true });
  const totalTimer = setTimeout(() => stop(new DownloadError(`${label}下載逾時，請檢查連線後重試。`, 'timeout')), deadline(timeoutMs, 45000));
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop(new DownloadError(`${label}傳輸中斷太久，請檢查連線後重試。`, 'idle')), deadline(idleTimeoutMs, 15000));
  };
  const work = async (): Promise<T> => {
    if (signal.aborted) { abort(); throw cancelled(); }
    touch();
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new DownloadError(`${label}下載失敗（HTTP ${response.status}）。`, 'http', response.status);
    }
    let text: string;
    if (!response.body) {
      text = await response.text();
    } else {
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        touch();
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); bytes += value.byteLength;
        onProgress?.(bytes);
      }
      const all = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
      text = new TextDecoder().decode(all);
    }
    try { return JSON.parse(text) as T; }
    catch { throw new DownloadError(`${label}格式無法讀取，請重試或更新遊戲。`, 'invalid'); }
  };
  try {
    return await Promise.race([work(), interrupted]);
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    if (signal.aborted) throw cancelled();
    throw new DownloadError(`${label}無法連線，請檢查網路後重試。`, 'network');
  } finally {
    clearTimeout(totalTimer); clearTimeout(idleTimer);
    signal.removeEventListener('abort', abort);
    try { reader?.releaseLock(); } catch { /* 中止中的 read 尚未結束 */ }
  }
}

function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const end = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { end(); reject(cancelled()); };
    const timer = setTimeout(() => { end(); resolve(); }, Math.max(0, ms));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** GET 可重試；寫入請求一律不自動重送，避免實際成功卻重複寫入。 */
export function requestJson<T>(url: string, options: DownloadOptions = {}): { promise: Promise<T>; cancel: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const method = (options.method ?? 'GET').toUpperCase();
  const requestedRetries = Number.isFinite(options.retries) ? Math.floor(options.retries!) : 1;
  const retries = method === 'GET' || method === 'HEAD' ? Math.max(0, Math.min(3, requestedRetries)) : 0;
  const promise = (async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        if (controller.signal.aborted) throw cancelled();
        try { return await readAttempt<T>(url, options, controller.signal); }
        catch (error) {
          if (!(error instanceof DownloadError) || !error.retryable || attempt >= retries || controller.signal.aborted) throw error;
          await retryDelay(options.retryDelayMs ?? 300, controller.signal);
        }
      }
    } finally { options.signal?.removeEventListener('abort', abort); }
  })();
  return { promise, cancel: abort };
}

export function fetchJsonWithRetry<T>(url: string, options: DownloadOptions = {}): Promise<T> {
  return requestJson<T>(url, options).promise;
}
