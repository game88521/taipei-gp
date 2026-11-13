export interface TaxiStop { x: number; z: number; y: number; nm: string }
export interface TaxiPosition { x: number; z: number; y?: number; h?: number }
export interface TaxiCheckpoint {
  v: 1; id: string; phase: 'seek' | 'ride'; from: string; target: TaxiStop; destination: TaxiStop | null;
  relaxed: boolean; position: TaxiPosition; timeLeft: number; timeLimit: number; odo: number; hits: number;
  streak: number; routeLen: number; junctions: number; condition: number;
}
export interface TaxiOrder {
  id: string; from: string; to: string; pickup: TaxiStop; destination: TaxiStop; pickupDistance: number;
  distance: number; timeLimit: number; estimatedFare: number; estimatedTotal: number; junctions: number;
}
export interface TaxiSettlement { id: string; status: 'delivered' | 'timeout'; total: number }
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const idOK = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,160}$/.test(id);
function stop(raw: unknown): TaxiStop | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as TaxiStop;
  return typeof p.nm === 'string' && p.nm.length > 0 && p.nm.length <= 160 && finite(p.x, -1e6, 1e6)
    && finite(p.z, -1e6, 1e6) && finite(p.y, -1e4, 1e4) ? { x: p.x, z: p.z, y: p.y, nm: p.nm } : null;
}
/** 單次結算識別有界；不從checkpoint讀入金錢或總趟數。 */
export function parseTaxiSettledIds(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(idOK))].slice(-64) : [];
}
export function parseTaxiCheckpoint(raw: unknown): TaxiCheckpoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as TaxiCheckpoint, target = stop(r.target), destination = r.destination == null ? null : stop(r.destination), p = r.position;
  if (r.v !== 1 || !idOK(r.id) || !['seek', 'ride'].includes(r.phase) || !target || (r.destination != null && !destination)
    || typeof r.from !== 'string' || !r.from || r.from.length > 160 || typeof r.relaxed !== 'boolean' || !p
    || !finite(p.x, -1e6, 1e6) || !finite(p.z, -1e6, 1e6) || p.y != null && !finite(p.y, -1e4, 1e4) || p.h != null && !finite(p.h, -1e6, 1e6)
    || !finite(r.timeLimit, 0, 86400) || !finite(r.timeLeft, 0, r.timeLimit) || !finite(r.odo, 0, 1e7)
    || !Number.isSafeInteger(r.hits) || r.hits < 0 || r.hits > 1e6 || !Number.isSafeInteger(r.streak) || r.streak < 0 || r.streak > 1e6
    || !finite(r.routeLen, 0, 1e7) || !Number.isSafeInteger(r.junctions) || r.junctions < 0 || r.junctions > 1e5 || !finite(r.condition, 0.7, 1)
    || r.phase === 'ride' && !r.relaxed && (r.timeLimit <= 0 || r.timeLeft <= 0)
    || r.relaxed && (r.timeLeft !== 0 || r.timeLimit !== 0)) return null;
  return { v: 1, id: r.id, phase: r.phase, from: r.from, target, destination, relaxed: r.relaxed,
    position: { x: p.x, z: p.z, ...(p.y != null ? { y: p.y } : {}), ...(p.h != null ? { h: p.h } : {}) },
    timeLeft: r.timeLeft, timeLimit: r.timeLimit, odo: r.odo, hits: r.hits, streak: r.streak, routeLen: r.routeLen,
    junctions: r.junctions, condition: r.condition };
}
