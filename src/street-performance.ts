import type { CarSpec } from './freecar';

export const isClassStreetRule = (rules: string) => rules === 'traffic-class-v1' || rules === 'clear-class-v1';
export const baseStreetRule = (rules: string) => isClassStreetRule(rules) ? rules.replace('-class-v1', '') : rules;
const bounded = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
/** 獨立 v1 性能配對；不是完整 FreeCar AI，參數平衡仍需實際試玩。 */
export function streetPerformance(spec: CarSpec, index = 0, duel = true) {
  const vmax = bounded(spec.vmax, 20, 100), engine = bounded(spec.engine, 3, 20),
    grip = bounded(spec.grip, 6, 30), brake = bounded(spec.brake, 6, 40);
  const rank = duel ? bounded(index, 0, 3) : 2.5;
  const score = vmax * 0.45 + engine * 1.3 + grip * 1.1 + brake * 0.35;
  return { level: score >= 98 ? 'S' : score >= 78 ? 'A' : score >= 58 ? 'B' : 'C',
    top: vmax * (0.805 - rank * 0.0325), corner: Math.sqrt(grip / 7) * (0.96 - rank * 0.022),
    accel: engine * (0.88 - rank * 0.018), decel: brake * 0.75 };
}
