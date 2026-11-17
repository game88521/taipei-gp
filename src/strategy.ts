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
  /** 使用目前及已選下一套的公開胎種資料，不接觸對手決策或未來天氣。 */
  tyres?: { current: StrategyTyre; next: StrategyTyre };
  wetness?: number; previousWetness?: number;
  /** 近期有效行駛距離的胎耗／圈；沒有足夠樣本時省略，勿拿磨耗封頂後的零增量當樣本。 */
  observedWearPerLap?: number;
  /** 來自同圖／規則／乾濕分類至少三次實際進站的有界誤差範圍。 */
  calibration?: { correction: number; spread: number };
}
export interface StrategyTyre { label: string; grip: number; wearPerLap: number; rain: boolean }
export interface EstimateRange { min: number; max: number }
export interface PitScenario { loss: EstimateRange; net: EstimateRange; rejoin: { best: number; worst: number } | null }

/** 完整估計包含減速、停車、加速、排隊及暖胎。範圍表示模型不確定性，
 * 不讀未來雨勢、AI 決策或已抽取而尚未發生的維修失誤。 */
export function estimatePitStrategy(input: PitStrategyInput): { currentLap: PitScenario; nextLap: PitScenario | null; assumptions: string[] } | null {
  const { laneLength, limit, racingTime, lapTime, wear, lapsRemaining } = input;
  if (![laneLength, limit, racingTime, lapTime, wear, lapsRemaining].every(Number.isFinite)
    || laneLength <= 0 || limit <= 0 || racingTime < 0 || lapTime <= 0 || wear < 0 || wear > 1 || lapsRemaining <= 0) return null;
  const validTyre = (tyre: StrategyTyre) => tyre && typeof tyre.label === 'string' && tyre.label.length > 0 && tyre.label.length <= 30
    && Number.isFinite(tyre.grip) && tyre.grip >= 0.1 && tyre.grip <= 2
    && Number.isFinite(tyre.wearPerLap) && tyre.wearPerLap >= 0 && tyre.wearPerLap <= 1 && typeof tyre.rain === 'boolean';
  const inUnit = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1;
  if (input.tyres && (!validTyre(input.tyres.current) || !validTyre(input.tyres.next) || !inUnit(input.wetness))) return null;
  if ((input.previousWetness !== undefined && !inUnit(input.previousWetness))
    || (input.observedWearPerLap !== undefined && !inUnit(input.observedWearPerLap))) return null;
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
  if (input.calibration && [input.calibration.correction, input.calibration.spread].every(Number.isFinite)) {
    const shift = Math.max(-30, Math.min(30, input.calibration.correction)), spread = Math.max(2, Math.min(60, input.calibration.spread));
    loss.min = Math.max(0, loss.min + shift - spread); loss.max = Math.max(loss.min, loss.max + shift + spread);
  }
  const degradation = Math.min(1, finite(input.wearPerLap, 0.1)), n = Math.min(100, Math.floor(lapsRemaining));
  // 玩家物理公開的胎種關係：雨胎在乾地磨得更快，乾胎在濕地損失抓地。
  // 估計維持「現在」觀察到的濕度；不外推雨勢或讀取 rainAt。
  const tyres = input.tyres, wet = input.wetness ?? 0;
  const wetGrip = (tyre: StrategyTyre) => tyre.rain ? (1 - 0.04 * wet) * (1 - 0.08 * (1 - wet)) : 1 - 0.28 * wet;
  const baseWear = (tyre: StrategyTyre) => tyre.wearPerLap * (tyre.rain ? 1 + 2 * (1 - wet) : 1);
  const currentBase = tyres ? baseWear(tyres.current) : degradation;
  const observed = input.observedWearPerLap;
  const currentRate = tyres ? observed ?? currentBase : degradation;
  const drivingFactor = tyres && observed !== undefined && currentBase > 0 ? observed / currentBase : 1;
  const nextRate = tyres ? Math.min(1, baseWear(tyres.next) * drivingFactor) : degradation;
  const changing = input.previousWetness !== undefined && Math.abs(wet - input.previousWetness) > 0.00001;
  const timeFactor = (tyre: StrategyTyre, tyreWear: number) => 1 / Math.sqrt(tyre.grip * (1 - 0.18 * tyreWear ** 1.5) * wetGrip(tyre));
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
      if (tyres) {
        const oldWear = Math.min(1, wear + currentRate * (i + 0.5));
        const freshWear = Math.min(1, nextRate * (i - delay + 0.5));
        // 全圈不全受抓地限制，以65%敏感度估算；錯胎的收益可為負，不能當成免費換胎。
        gain += (timeFactor(tyres.current, oldWear) - timeFactor(tyres.next, freshWear)) * lapTime * 0.65;
      } else {
        // 舊呼叫沒有胎種資料時保留既有退化模型，不假造下一套胎。
        const oldWear = Math.min(1, wear + degradation * i), freshWear = Math.min(1, degradation * (i - delay));
        gain += Math.max(0, oldWear ** 1.5 - freshWear ** 1.5) * lapTime * 0.09;
      }
    }
    const uncertainty = tyres ? Math.abs(gain) * (changing ? 0.65 : 0.4) : 0;
    return { loss: { ...loss }, net: tyres
      ? { min: loss.min - gain - uncertainty, max: loss.max - gain + uncertainty }
      : { min: loss.min - gain * 1.3, max: loss.max - gain * 0.5 }, rejoin: rejoin(loss) };
  };
  const tyreAssumptions = !tyres ? [] : [
    `比較目前${tyres.current.label}與已選${tyres.next.label}，依當下濕度 ${Math.round(wet * 100)}% 分別估算抓地及胎耗`,
    observed === undefined ? '近期胎耗樣本不足，使用胎種基礎耗損；轉向與交通會影響實際結果' : '使用近期實際胎耗調整兩套胎的退化估計；假設駕駛方式大致相同',
    changing ? `${wetTrend(input.previousWetness!, wet)}，因此放寬收益區間；未預測未來雨勢` : '假設目前濕度維持；未預測未來雨勢',
    '胎種抓地對圈速的影響為模型估計，尚未逐圖校準；錯胎可能增加全程代價',
  ];
  return { currentLap: scenario(0), nextLap: n > 1 ? scenario(1) : null,
    assumptions: ['依已觀察圈速、胎耗及目前差距估算；名次不包含對手未來進站或超車',
      '停站作業估計 2.2～5.5 秒，包含進出減速、煞停、加速與暖胎範圍',
      input.safetyCar ? '依目前安全車狀態估算；下一圈是否仍有安全車未知' : '假設維持目前行駛狀態',
      queue > 0 ? `目前觀察到排隊，額外估計 ${queue.toFixed(1)} 秒；實際放行可能較久` : '排隊與放行變化保留額外 0～2 秒；重大失誤可能超出範圍',
      ...tyreAssumptions] };
}
