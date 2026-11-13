import { multiplayerCarsOverlap } from '../shared/multiplayer-collisions';
import type { CarState, RoomPlayer } from '../shared/multiplayer-protocol';
import type { Track } from './track';

export type AuthoritativeCarSample = { at: number; car: CarState };
export const MULTIPLAYER_COLLISION_FEEDBACK_MS = 100;
export const MULTIPLAYER_COLLISION_INTERPOLATION_RECOVERY_MS = 250;

/** 僅判斷畫面校正時機；位置、速度與碰撞結果仍完全來自伺服器。 */
export function nearMultiplayerOpponents(track: Track, self: RoomPlayer, players: RoomPlayer[]) {
  if (!self.connected || !self.loaded || self.dnf || self.finishMs !== null) return [];
  return players.filter(peer => peer.id !== self.id && peer.connected && peer.loaded && !peer.dnf && peer.finishMs === null
    && multiplayerCarsOverlap(track, self.car, peer.car, .4));
}
export function nearMultiplayerOpponent(track: Track, self: RoomPlayer, players: RoomPlayer[]) {
  return nearMultiplayerOpponents(track, self, players).length > 0;
}

/** 接觸的遠車先顯示最新權威姿態，再漸回一般插值延遲，時間軸不倒退。 */
export function collisionVisualTarget(now: number, contactUntil?: number) {
  if (contactUntil === undefined) return now - 110;
  const recovery = Math.max(0, Math.min(1, (now - contactUntil) / MULTIPLAYER_COLLISION_INTERPOLATION_RECOVERY_MS));
  return now - 110 * recovery;
}

/** 正常跟車／煞車照常預測；只有權威狀態的接觸突變才立即顯示。 */
export function authoritativeCollisionChanged(track: Track, previous: AuthoritativeCarSample | null, at: number, self: RoomPlayer, players: RoomPlayer[]) {
  if (!previous) return false;
  const elapsed = (at - previous.at) / 1000;
  if (elapsed <= 0 || elapsed > .25 || !nearMultiplayerOpponent(track, self, players)) return false;
  const before = previous.car, after = self.car;
  // Car 的正常最大煞車約38m/s²、加速14m/s²；保留額外餘量容納坡度與取樣。
  const speedChanged = before.v - after.v > 45 * elapsed + 1.5
    || after.v - before.v > 22 * elapsed + 1.5;
  const heading = before.h + Math.atan2(Math.sin(after.h - before.h), Math.cos(after.h - before.h)) * .5;
  const lateralShift = Math.abs((after.x - before.x) * Math.cos(heading) - (after.z - before.z) * Math.sin(heading));
  return speedChanged || lateralShift > .22;
}
