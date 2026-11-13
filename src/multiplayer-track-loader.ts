import taipei from './data/track.json' with { type: 'json' };
import { fetchJsonWithRetry, type DownloadOptions } from './network';
import { getMultiplayerTrack, verifyMultiplayerTrackData, type MultiplayerTrackDescriptor } from '../shared/multiplayer-tracks';
import { buildMultiplayerTrackGeometry } from '../shared/multiplayer-track-recipe';
import type { Track } from './track';

const cancelled = (signal?: AbortSignal | null) => { if (signal?.aborted) throw new DOMException('賽道載入已取消。', 'AbortError'); };
export async function loadMultiplayerTrack(trackId: string, options: DownloadOptions = {}): Promise<{ track: Track; descriptor: MultiplayerTrackDescriptor }> {
  cancelled(options.signal);
  const descriptor = getMultiplayerTrack(trackId);
  if (!descriptor) throw new Error('不支援這張連線賽道。');
  const data: unknown = descriptor.circuit
    ? await fetchJsonWithRetry(`/data/circuits/${descriptor.id}.json`, { label: '連線賽道', ...options })
    : taipei;
  cancelled(options.signal);
  verifyMultiplayerTrackData(descriptor, data);
  cancelled(options.signal);
  const track = buildMultiplayerTrackGeometry(descriptor, data);
  cancelled(options.signal);
  return { track, descriptor };
}
