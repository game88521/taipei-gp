export type PoliceDifficulty = 'easy' | 'standard' | 'hard';
export type PoliceDutyRating = 'A' | 'B' | 'C';
export interface PoliceCareer {
  v: 1; difficulty: PoliceDifficulty; completed: number; failed: number;
  consecutive: number; bestConsecutive: number;
}
export const POLICE_DUTIES = {
  easy: { label: '新手', seconds: 240, speed: 0.85, hp: 80, base: 300, perSecond: 1.5, cleanHits: 3 },
  standard: { label: '標準', seconds: 180, speed: 1, hp: 100, base: 400, perSecond: 2, cleanHits: 2 },
  hard: { label: '高手', seconds: 150, speed: 1.12, hp: 120, base: 550, perSecond: 3, cleanHits: 1 },
} as const;
export function newPoliceCareer(): PoliceCareer {
  return { v: 1, difficulty: 'standard', completed: 0, failed: 0, consecutive: 0, bestConsecutive: 0 };
}
/** 缺少或損毀回傳null，由save parser決定是否進救援；不悄悄把壞資料當零。 */
export function parsePoliceCareer(raw: unknown): PoliceCareer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as PoliceCareer;
  if (r.v !== 1 || typeof r.difficulty !== 'string' || !Object.hasOwn(POLICE_DUTIES, r.difficulty)
    || [r.completed, r.failed, r.consecutive, r.bestConsecutive].some((n) => !Number.isSafeInteger(n) || n < 0 || n > 1e7)
    || r.consecutive > r.bestConsecutive || r.bestConsecutive > r.completed) return null;
  return { v: 1, difficulty: r.difficulty, completed: r.completed, failed: r.failed,
    consecutive: r.consecutive, bestConsecutive: r.bestConsecutive };
}
export function policeDutyRating(hits: number, difficulty: PoliceDifficulty): PoliceDutyRating {
  return hits === 0 ? 'A' : hits <= POLICE_DUTIES[difficulty].cleanHits ? 'B' : 'C';
}
export interface PoliceDutyResult {
  difficulty: PoliceDifficulty; status: 'arrested' | 'distance' | 'timeout' | 'cancelled';
  collisions: number; elapsed: number; reward: number; rating: PoliceDutyRating | null; consecutive: number;
}
