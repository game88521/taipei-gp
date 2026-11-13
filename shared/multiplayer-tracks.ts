import catalog from './multiplayer-catalog.json' with { type: 'json' };
import { CIRCUITS, type CircuitMeta } from './circuit-catalog.ts';
import { canonicalJson, sha256Hex } from './multiplayer-track-fingerprint.ts';

export interface MultiplayerTrackDescriptor {
  readonly id: string; readonly name: string; readonly place: string; readonly flag: string;
  readonly trackStamp: string; readonly dataSha256: string; readonly circuit: CircuitMeta | null;
}
export const DEFAULT_MULTIPLAYER_TRACK_ID = 'taipei';
export const CATALOG_STAMP = catalog.catalogStamp;
export const MULTIPLAYER_TRACKS: readonly MultiplayerTrackDescriptor[] = Object.freeze(catalog.tracks.map(entry => {
  const circuit = entry.id === DEFAULT_MULTIPLAYER_TRACK_ID ? null : CIRCUITS.find(item => item.id === entry.id);
  if (circuit === undefined || sha256Hex(canonicalJson(circuit)) !== entry.metaSha256) throw new Error('賽道目錄尚未建置，請更新遊戲。');
  return Object.freeze({ id: entry.id, name: entry.name, place: entry.place, flag: entry.flag, trackStamp: entry.trackStamp, dataSha256: entry.dataSha256, circuit });
}));
const byId = new Map(MULTIPLAYER_TRACKS.map(entry => [entry.id, entry]));
export function getMultiplayerTrack(id: string): MultiplayerTrackDescriptor | undefined { return byId.get(id); }
export function verifyMultiplayerTrackData(descriptor: MultiplayerTrackDescriptor, data: unknown): void {
  if (sha256Hex(canonicalJson(data)) !== descriptor.dataSha256) throw new Error('賽道資料版本不同，請更新遊戲後重試。');
}
