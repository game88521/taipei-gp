import type { RoomSnapshot } from '../shared/multiplayer-protocol';
export function spectatorTargets(room: RoomSnapshot | null, selfId: string | null) {
  const self = room?.players.find(player => player.id === selfId);
  const viewer=room?.spectators?.some(v=>v.id===selfId);
  if (!room || !viewer && (room.phase !== 'racing' || !self || (!self.dnf && self.finishMs === null && !self.timeTrialDone && !self.eliminated && self.arena?.active!==false))) return [];
  return room.players.filter(player => player.id !== selfId && player.connected && player.loaded && !player.dnf && !player.timeTrialDone && !player.eliminated && !player.eliminationWinner && player.arena?.active!==false && player.finishMs === null);
}
export function spectatorTarget(room: RoomSnapshot | null, selfId: string | null, selected: string | null) {
  const targets = spectatorTargets(room, selfId);
  return targets.find(player => player.id === selected)?.id ?? targets[0]?.id ?? null;
}
