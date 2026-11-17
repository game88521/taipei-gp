import type { RoomSnapshot } from '../shared/multiplayer-protocol';
export function spectatorTargets(room: RoomSnapshot | null, selfId: string | null) {
  const self = room?.players.find(player => player.id === selfId);
  if (!room || room.phase !== 'racing' || !self || (!self.dnf && self.finishMs === null)) return [];
  return room.players.filter(player => player.id !== selfId && player.connected && player.loaded && !player.dnf && player.finishMs === null);
}
export function spectatorTarget(room: RoomSnapshot | null, selfId: string | null, selected: string | null) {
  const targets = spectatorTargets(room, selfId);
  return targets.find(player => player.id === selected)?.id ?? targets[0]?.id ?? null;
}
