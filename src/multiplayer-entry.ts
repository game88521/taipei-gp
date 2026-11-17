type EntryTransport = { connect(): Promise<void>; disconnect(): void };
type WaitPhase = 'connecting' | 'retrying';
export interface EntryWaitState { phase: WaitPhase; attempt: number; elapsedSeconds: number }
type Run = { transport: EntryTransport; started: number; phase: WaitPhase; attempt: number; stop: (error: Error) => void };
export const ENTRY_WAIT_MS = 45_000;
export const ENTRY_RETRY_MS = 1_500;
export const ENTRY_CANCELLED = '已取消連線；暱稱與房間碼已保留，可調整後再試。';
const TIMEOUT = '等待連線已超過 45 秒。伺服器可能仍在啟動，或網路／服務設定無法連線；請稍後重試。';

/** Only retry the transport handshake. Create/join/resume requests are never replayed. */
export class MultiplayerEntryWait {
  private current: Run | null = null;
  constructor(private changed: () => void = () => {}) {}
  get active() { return this.current !== null; }
  get state(): EntryWaitState | null {
    const run = this.current;
    return run ? { phase: run.phase, attempt: run.attempt, elapsedSeconds: Math.min(45, Math.max(0, Math.floor((performance.now() - run.started) / 1000))) } : null;
  }

  async open(transport: EntryTransport): Promise<void> {
    if (this.current) throw new Error('正在等待連線，請稍候或先取消。');
    let stop!: (error: Error) => void;
    const stopped = new Promise<never>((_, reject) => { stop = reject; });
    const run: Run = { transport, started: performance.now(), phase: 'connecting', attempt: 0, stop };
    this.current = run;
    let delay: ReturnType<typeof setTimeout> | null = null;
    const timeout = setTimeout(() => {
      if (this.current !== run) return;
      this.current = null;
      stop(new Error(TIMEOUT)); transport.disconnect(); this.changed();
    }, ENTRY_WAIT_MS);
    const ticker = setInterval(() => { if (this.current === run) this.changed(); }, 1000);
    try {
      for (;;) {
        if (this.current !== run) throw new Error(ENTRY_CANCELLED);
        run.phase = 'connecting'; run.attempt++; this.changed();
        try {
          await Promise.race([transport.connect(), stopped]);
          if (this.current !== run) throw new Error(ENTRY_CANCELLED);
          return;
        } catch (error) {
          if (this.current !== run) throw error;
          run.phase = 'retrying'; this.changed();
          await Promise.race([new Promise<void>(resolve => { delay = setTimeout(resolve, ENTRY_RETRY_MS); }), stopped]);
          delay = null;
        }
      }
    } finally {
      clearTimeout(timeout); clearInterval(ticker); if (delay !== null) clearTimeout(delay);
      if (this.current === run) { this.current = null; this.changed(); }
    }
  }

  cancel() {
    const run = this.current; if (!run) return false;
    this.current = null;
    run.stop(new Error(ENTRY_CANCELLED)); run.transport.disconnect(); this.changed(); return true;
  }
}

export function entryWaitText(state: EntryWaitState | null): string {
  if (!state) return '';
  if (state.phase === 'retrying') return `尚未連上，稍後會重試。已等待 ${state.elapsedSeconds} 秒（最多 45 秒），也可取消。`;
  return state.elapsedSeconds >= 7
    ? `伺服器可能正在啟動，已等待 ${state.elapsedSeconds} 秒（最多 45 秒，第 ${state.attempt} 次嘗試）。`
    : `正在連線（第 ${state.attempt} 次嘗試）…可隨時取消。`;
}
