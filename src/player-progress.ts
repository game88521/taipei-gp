import { ACHIEVEMENTS, type Stats } from './achievements';
import { sameRoadLevel, type RoadPosition } from './mission';
import type { Landmark } from './decor';

export interface PlayerProgress { visited: string[]; pinned: string[]; title: string }
export const newPlayerProgress = (): PlayerProgress => ({ visited: [], pinned: [], title: 'rookie' });
export function parsePlayerProgress(value: unknown): PlayerProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Partial<PlayerProgress>;
  if (!Array.isArray(p.visited) || p.visited.length > 10000 || !p.visited.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 180)) return null;
  if (!Array.isArray(p.pinned) || p.pinned.length > 3 || !p.pinned.every((v) => ACHIEVEMENTS.some((a) => a.id === v))) return null;
  if (typeof p.title !== 'string' || !TITLES.some((t) => t.id === p.title)) return null;
  return { visited: [...new Set(p.visited)], pinned: [...new Set(p.pinned)], title: p.title };
}
export const landmarkId = (l: Pick<Landmark, 'nm' | 'x' | 'z'>) => `${l.nm}:${Math.round(l.x)}:${Math.round(l.z)}`;
export const explorationRegion = (l: Pick<Landmark, 'x'>) => l.x >= -1500 ? '東區' : l.x >= -3500 ? '中區' : '西區';
export function visitLandmarks(progress: PlayerProgress, marks: Landmark[], car: RoadPosition): Landmark[] {
  const seen = new Set(progress.visited), added: Landmark[] = [];
  for (const l of marks) {
    if (seen.has(landmarkId(l)) || !sameRoadLevel(car, l) || Math.hypot(l.x - car.x, l.z - car.z) > Math.max(20, Math.min(l.r, 65))) continue;
    seen.add(landmarkId(l)); added.push(l);
  }
  progress.visited = [...seen];
  return added;
}
export function explorationSummary(progress: PlayerProgress, marks: Landmark[]) {
  const visited = new Set(progress.visited), regions = new Map<string, { total: number; visited: number }>();
  let count = 0;
  for (const l of marks) {
    const region = explorationRegion(l), value = regions.get(region) ?? { total: 0, visited: 0 };
    value.total++; if (visited.has(landmarkId(l))) { value.visited++; count++; } regions.set(region, value);
  }
  return { count, total: marks.length, regions };
}
export function togglePinned(progress: PlayerProgress, id: string): boolean {
  if (!ACHIEVEMENTS.some((a) => a.id === id)) return false;
  if (progress.pinned.includes(id)) { progress.pinned = progress.pinned.filter((v) => v !== id); return true; }
  if (progress.pinned.length >= 3) return false;
  progress.pinned.push(id); return true;
}
export function pinnedTargets(progress: PlayerProgress, stats: Stats, achieved: string[]) {
  return progress.pinned.map((id) => ACHIEVEMENTS.find((a) => a.id === id)!).filter(Boolean).map((a) => ({
    id: a.id, name: a.name, icon: a.icon, done: achieved.includes(a.id), fraction: Math.min(1, a.value(stats) / a.goal),
    progress: `${Math.min(a.goal, Math.floor(a.value(stats)))} / ${a.goal}`,
  }));
}
export const TITLES = [
  { id: 'rookie', label: '新手車手', requirement: '開始駕駛', unlocked: (_p: PlayerProgress, _a: string[]) => true },
  { id: 'explorer', label: '城市旅人', requirement: '造訪 5 個地標', unlocked: (p: PlayerProgress) => p.visited.length >= 5 },
  { id: 'guide', label: '台北領航員', requirement: '造訪 20 個地標', unlocked: (p: PlayerProgress) => p.visited.length >= 20 },
  { id: 'drifter', label: '甩尾行家', requirement: '解鎖甩尾大師成就', unlocked: (_p: PlayerProgress, a: string[]) => a.includes('drift2') },
  { id: 'racer', label: '賽道新星', requirement: '贏得一場 GP', unlocked: (_p: PlayerProgress, a: string[]) => a.includes('gp') },
  { id: 'street', label: '街頭王者', requirement: '贏得五場街賽', unlocked: (_p: PlayerProgress, a: string[]) => a.includes('street5') },
];
export function equippedTitle(progress: PlayerProgress, achieved: string[]) {
  return (TITLES.find((t) => t.id === progress.title && t.unlocked(progress, achieved)) ?? TITLES[0]).label;
}
