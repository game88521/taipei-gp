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
