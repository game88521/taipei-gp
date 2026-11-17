export interface MultiplayerRoomRules { collisions: boolean; finishGraceSeconds: 30 | 60 | 120 }
export const DEFAULT_ROOM_RULES: Readonly<MultiplayerRoomRules> = Object.freeze({ collisions: true, finishGraceSeconds: 60 });
export function parseRoomRules(value: unknown): MultiplayerRoomRules | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 2 || !Object.hasOwn(r, 'collisions') || !Object.hasOwn(r, 'finishGraceSeconds')
    || typeof r.collisions !== 'boolean' || ![30, 60, 120].includes(r.finishGraceSeconds as number)) return null;
  return { collisions: r.collisions, finishGraceSeconds: r.finishGraceSeconds as 30 | 60 | 120 };
}
export const defaultRoomRules = (r: MultiplayerRoomRules) => r.collisions && r.finishGraceSeconds === 60;
export function roomRulesText(r: MultiplayerRoomRules = DEFAULT_ROOM_RULES) {
  return `${r.collisions ? '一般碰撞' : '無碰撞練習'} · 首車完賽後 ${r.finishGraceSeconds} 秒寬限`;
}
