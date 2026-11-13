/** 回放輪胎角度的累積索引：建立一次，拖曳及倒退均以絕對時間查詢。 */
export function makeReplayWheelIndex(record: readonly number[], dt = 0.05, radius = 0.36): Float64Array {
  const n = Math.floor(record.length / 5), out = new Float64Array(n);
  if (!(dt > 0) || !(radius > 0)) return out;
  for (let i = 1; i < n; i++) {
    const a = record[(i - 1) * 5 + 4], b = record[i * 5 + 4];
    out[i] = out[i - 1] + (Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (a + b) / 2) * dt / radius : 0);
  }
  return out;
}
export function replayWheelAngle(index: Float64Array, time: number, dt = 0.05): number {
  if (!index.length || !Number.isFinite(time) || !(dt > 0)) return 0;
  const f = Math.max(0, Math.min(index.length - 1, time / dt)), i = Math.floor(f), j = Math.min(i + 1, index.length - 1);
  return index[i] + (index[j] - index[i]) * (f - i);
}
export function clampReplayTime(time: number, length: number): number {
  return Number.isFinite(time) && Number.isFinite(length) ? Math.max(0, Math.min(Math.max(0, length - 0.05), time)) : 0;
}
export function replayEventLabel(type: string): string {
  if (type.startsWith('stop:')) return `換胎完成 ${type.split(':')[1]} 秒`;
  return ({ rain: '開始下雨', 'sc-out': '安全車出動', 'sc-in': '安全車本圈進站', green: '綠旗', 'pit-in': '進入維修區', 'pit-out': '駛出維修區' } as Record<string, string>)[type] ?? type;
}
