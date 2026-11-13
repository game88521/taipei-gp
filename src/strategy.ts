/** 限速段的基礎時間差；不假裝包含進出減速、煞停與排隊。 */
export function pitBaselineLoss(length: number, limit: number, racingTime: number): number | null {
  if (![length, limit, racingTime].every(Number.isFinite) || length <= 0 || limit <= 0 || racingTime < 0) return null;
  return Math.max(0, length / limit + 2.5 - racingTime);
}

/** 只比較已觀察到的濕度，不讀取未來天氣時刻。 */
export function wetTrend(previous: number, current: number): string {
  if (current > previous + 0.00001) return '路面持續變濕';
  if (current < previous - 0.00001) return '路面逐漸乾燥';
  return '路面大致穩定';
}

export interface PitStrategyInput {
  /** 限速線之間長度、限速(m/s)、同段賽道建議時間。 */
  laneLength: number; limit: number; racingTime: number;
  lapTime: number; wear: number; lapsRemaining: number; wearPerLap?: number;
  approachSpeed?: number; exitSpeed?: number;
  /** 僅使用已觀察的排隊／暖胎估值，不能傳入預先抽好的停站結果。 */
  queueSeconds?: number; warmupSeconds?: number; safetyCar?: boolean;
  /** 對手落後玩家的秒數，前車為負；未知差距保留 null。 */
  rivals?: { gap: number | null }[];
}
export interface EstimateRange { min: number; max: number }
export interface PitScenario { loss: EstimateRange; net: EstimateRange; rejoin: { best: number; worst: number } | null }

/** 完整估計包含減速、停車、加速、排隊及暖胎。範圍表示模型不確定性，
 * 不讀未來雨勢、AI 決策或已抽取而尚未發生的維修失誤。 */
export function estimatePitStrategy(input: PitStrategyInput): { currentLap: PitScenario; nextLap: PitScenario | null; assumptions: string[] } | null {
  const { laneLength, limit, racingTime, lapTime, wear, lapsRemaining } = input;
  if (![laneLength, limit, racingTime, lapTime, wear, lapsRemaining].every(Number.isFinite)
    || laneLength <= 0 || limit <= 0 || racingTime < 0 || lapTime <= 0 || wear < 0 || wear > 1 || lapsRemaining <= 0) return null;
  const finite = (n: number | undefined, fallback: number) => n !== undefined && Number.isFinite(n) ? Math.max(0, n) : fallback;
  const approach = Math.max(limit, finite(input.approachSpeed, 65)), exit = Math.max(limit, finite(input.exitSpeed, approach));
  const queue = finite(input.queueSeconds, 0), warmup = finite(input.warmupSeconds, 1);
  const observedRacing = input.safetyCar ? Math.max(racingTime, laneLength / 40) : racingTime;
  const cruise = laneLength / limit - observedRacing;
  // 用與正賽相同量級的減速／加速估計相對於不停車行駛的額外時間。
  const entryLoss = (approach - limit) ** 2 / (2 * 24 * approach);
  const exitLoss = (exit - limit) ** 2 / (2 * 11 * exit);
  const boxLoss = limit / 2 * (1 / 6 + 1 / 7);
  const nominal = Math.max(0, cruise + entryLoss + exitLoss + boxLoss);
  const loss = { min: Math.max(0, nominal + 2.2 + queue + warmup * 0.5), max: Math.max(0, nominal + 5.5 + queue + 2 + warmup * 1.5) };
  const degradation = Math.min(1, finite(input.wearPerLap, 0.1)), n = Math.min(100, Math.floor(lapsRemaining));
  const rejoin = (range: EstimateRange) => {
    if (!input.rivals?.length) return null;
    let best = 1, worst = 1;
    for (const r of input.rivals) {
      if (r.gap === null || !Number.isFinite(r.gap)) { worst++; continue; }
      if (r.gap <= range.min) best++;
      if (r.gap <= range.max) worst++;
    }
    return { best, worst };
  };
  const scenario = (delay: number): PitScenario => {
    let gain = 0;
    for (let i = delay; i < n; i++) {
      const oldWear = Math.min(1, wear + degradation * i), freshWear = Math.min(1, degradation * (i - delay));
      gain += Math.max(0, oldWear ** 1.5 - freshWear ** 1.5) * lapTime * 0.09;
    }
    return { loss: { ...loss }, net: { min: loss.min - gain * 1.3, max: loss.max - gain * 0.5 }, rejoin: rejoin(loss) };
  };
  return { currentLap: scenario(0), nextLap: n > 1 ? scenario(1) : null,
    assumptions: ['依已觀察圈速、胎耗及目前差距估算；名次不包含對手未來進站或超車',
      '停站作業估計 2.2～5.5 秒，包含進出減速、煞停、加速與暖胎範圍',
      input.safetyCar ? '依目前安全車狀態估算；下一圈是否仍有安全車未知' : '假設維持目前行駛狀態與胎種適用性',
      queue > 0 ? `目前觀察到排隊，額外估計 ${queue.toFixed(1)} 秒；實際放行可能較久` : '排隊與放行變化保留額外 0～2 秒；重大失誤可能超出範圍'] };
}
