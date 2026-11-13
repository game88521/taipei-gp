// Browser GP selection retains the existing URL behaviour and metadata order.
import { CIRCUITS, type CircuitData, type CircuitMeta } from '../shared/circuit-catalog';
import { fetchJsonWithRetry, type DownloadOptions } from './network';
export { CIRCUITS } from '../shared/circuit-catalog';
export type { Biome, CircuitMeta, CircuitData } from '../shared/circuit-catalog';

/** 這次是哪條賽道（網址 ?circuit=…）；null = 台北信義街道賽 */
export const CIRCUIT: CircuitMeta | null = CIRCUITS.find((c) => c.id === new URLSearchParams(location.search).get('circuit')) ?? null;

export async function loadCircuitData(options: DownloadOptions = {}): Promise<CircuitData | null> {
  if (!CIRCUIT) return null;
  return fetchJsonWithRetry<CircuitData>(`/data/circuits/${CIRCUIT.id}.json`, { label: '賽道資料', ...options });
}
