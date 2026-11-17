import type { Track } from './track';

export interface BrakingAssistPerf {
  vmax: number; brake: number; engine: number; g0: number; gk: number; gmax: number;
}
type AssistTrack = Pick<Track, 'N' | 'ds' | 'vTarget' | 'curv' | 'bankGrip'>;

/** 提示專用速度曲線；不寫回 Track、Car、AI 或任何物理參數。
 * gripMul 已包含胎種、胎耗與當下濕度，不能再次乘胎種或濕度。
 * 過彎限制以 κ v² <= gripMul × bank × min(gmax, g0 + gk v²) 計算，
 * 保留原輔助的 8% 餘裕與煞車／加速係數；這仍是中心線模型，並非保證安全速度。
 */
export class BrakingAssist {
  readonly targets: Float32Array;
  private readonly base: Float32Array;
  private readonly usable: boolean;
  private factor = 1;
  private updatedAt = -Infinity;

  constructor(private readonly track: AssistTrack, private readonly perf: BrakingAssistPerf) {
    this.base = Float32Array.from(track.vTarget, (value) => Number.isFinite(value) && value >= 0 ? value : 0);
    this.targets = new Float32Array(this.base);
    this.usable = Number.isInteger(track.N) && track.N > 0 && track.N === this.base.length
      && track.curv.length === track.N && track.bankGrip.length === track.N && Number.isFinite(track.ds) && track.ds > 0
      && Object.values(perf).every(Number.isFinite) && perf.vmax > 0 && perf.brake > 0 && perf.engine > 0
      && perf.g0 > 0 && perf.gk >= 0 && perf.gmax > 0;
  }

  /** 新場次／恢復點清掉節流時間與上一場胎況；每條賽道各建自己的實例。 */
  reset() { this.factor = 1; this.updatedAt = -Infinity; this.targets.set(this.base); }

  /** 時間單位為秒。最多 4Hz，抓地以向下 1% 量化；離開 GP 則立即恢復原曲線。 */
  update(gripMul: number, time: number, active: boolean): boolean {
    const grip = active && this.usable && Number.isFinite(gripMul) && gripMul > 0
      ? Math.floor(Math.max(0.4, Math.min(1, gripMul)) * 100 + 1e-8) / 100 : 1;
    if (grip === this.factor) return false;
    const now = Number.isFinite(time) ? time : this.updatedAt;
    if (active && now >= this.updatedAt && now - this.updatedAt < 0.25) return false;
    this.factor = grip; this.updatedAt = Number.isFinite(now) ? now : 0;
    this.targets.set(this.base);
    if (grip >= 1) return true; // 不把軟胎優勢變成較原輔助更激進的提示。
    const { N, ds, curv, bankGrip } = this.track, p = this.perf;
    for (let i = 0; i < N; i++) {
      const k = Math.abs(curv[i]), bank = bankGrip[i];
      if (!Number.isFinite(k) || !Number.isFinite(bank) || bank <= 0) continue;
      const g = 0.92 * grip * bank, g0 = p.g0 * g, gk = p.gk * g;
      const corner = k > gk + 1e-5 ? Math.sqrt(g0 / (k - gk)) : p.vmax;
      const cappedGrip = k > 1e-6 ? Math.sqrt(p.gmax * g / k) : p.vmax;
      this.targets[i] = Math.min(this.base[i], p.vmax, corner, cappedGrip);
    }
    // 與原曲線同樣繞環兩次，煞車提醒可穿越起跑線；縱向 BRAKE 並不乘胎種／濕度。
    for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N;
      this.targets[i] = Math.min(this.targets[i], Math.sqrt(this.targets[j] ** 2 + 2 * 30 * (p.brake / 38) * ds));
    }
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++) {
      const j = (i - 1 + N) % N;
      this.targets[i] = Math.min(this.targets[i], Math.sqrt(this.targets[j] ** 2 + 2 * 11 * (p.engine / 14) * ds));
    }
    return true;
  }
}
