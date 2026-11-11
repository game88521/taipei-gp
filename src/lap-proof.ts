import type { Ghost } from './save';

export interface LapProof { v: 1; trackStamp: string; samples: [number, number, number, number][] }
/** 只整理真實取樣，不補造缺少的首尾位置。舊影子車需重新跑圈才可送新榜。 */
export function createLapProof(ghost: Ghost | null, trackStamp: string | undefined, time: number): LapProof | null {
  if (!ghost || !trackStamp || ghost.t.length < 201 || ghost.t.length > 6500) return null;
  const n = ghost.t.length;
  if ([ghost.s, ghost.x, ghost.z].some((a) => a.length !== n) || Math.abs(ghost.t[0]) > 0.001 || Math.abs(ghost.t[n - 1] - time) > 0.003) return null;
  const length = Number(trackStamp.split(':')[1]) / 100;
  if (!Number.isFinite(length) || length <= 0) return null;
  let offset = 0, previous = ghost.s[0];
  const samples: LapProof['samples'] = [];
  for (let i = 0; i < n; i++) {
    const s = ghost.s[i];
    if (s < previous - length / 2) offset += length;
    previous = s;
    const point: [number, number, number, number] = [ghost.t[i], +(s + offset).toFixed(3), ghost.x[i], ghost.z[i]];
    if (point.some((v) => !Number.isFinite(v)) || (i && point[0] <= samples[i - 1][0])) return null;
    samples.push(point);
  }
  return { v: 1, trackStamp, samples };
}
