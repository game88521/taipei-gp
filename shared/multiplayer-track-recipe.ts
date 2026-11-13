import { buildTrack, spreadLegs, type Track } from '../src/track';
import type { CircuitData } from './circuit-catalog';
import type { MultiplayerTrackDescriptor } from './multiplayer-tracks';

type Point = [number, number];
const smooth = (points: Point[]): Point[] => points.map((_, i) => {
  let x = 0, z = 0;
  for (let k = -2; k <= 2; k++) { const q = points[(i + k + points.length) % points.length]; x += q[0]; z += q[1]; }
  return [x / 5, z / 5];
});
function official(points: Point[], km: number | null): Point[] {
  if (!km) return points;
  let length = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; length += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const scale = km * 1000 / length;
  return points.map(([x, z]) => [x * scale, z * scale]);
}

/** Geometry matches GP; all multiplayer maps retain the existing classic Car. */
export function buildMultiplayerTrackGeometry(descriptor: MultiplayerTrackDescriptor, data: unknown): Track {
  if (!descriptor.circuit) return buildTrack();
  const circuit = data as CircuitData;
  if (circuit.id !== descriptor.id || !Array.isArray(circuit.points) || circuit.points.length < 20
    || circuit.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))
    || (circuit.elev && (circuit.elev.length !== circuit.points.length || !circuit.elev.every(Number.isFinite)))) throw new Error('賽道幾何資料不完整。');
  const km = circuit.info.lengthKm;
  const points = official(spreadLegs(smooth(smooth(circuit.points)), circuit.elev, 17.5), km);
  const first = buildTrack(points, circuit.elev, descriptor.circuit.bank);
  if (!km) return first;
  const scale = km * 1000 / first.length;
  return buildTrack(points.map(([x, z]) => [x * scale, z * scale]), circuit.elev, descriptor.circuit.bank);
}
