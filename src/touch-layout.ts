/** 與 CSS 的兩個尺寸限制一致；顯示設定要求值與實際適配值。 */
export function effectiveTouchScale(requested: number, width: number, height: number): number {
  let effective = requested;
  if (height <= 480) effective = Math.min(effective, 1);
  if (width <= 640 && height >= width) effective = Math.min(effective, 0.9);
  return effective;
}

export function touchScaleLabel(requested: number, width: number, height: number): string {
  const effective = effectiveTouchScale(requested, width, height);
  const selected = `${Math.round(requested * 100)}%`;
  return effective < requested ? `${selected}（此畫面適配 ${Math.round(effective * 100)}%）` : selected;
}
