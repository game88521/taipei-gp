/** Rex <game88521@gmail.com>. Presentation/streaming only; never advances a vehicle. */
export const CITY_BUILD_BUDGET_MS = 3;
export const CITY_URGENT_BUILD_BUDGET_MS = 4;
export const CITY_INSTANCE_BATCH = 64;
export const CITY_PREFETCH_LIMIT = 2;

export function streamingAbort() { return new DOMException('城市區塊已取消。', 'AbortError'); }
export function checkStreamingSignal(signal?: AbortSignal) { if (signal?.aborted) throw streamingAbort(); }

/** Required nearby tiles always precede speculative tiles. Teleports never imply huge velocity. */
export function planCityTiles(tiles: readonly (readonly number[])[], size: number, x: number, z: number, radius: number, motion?: { heading: number; speed: number }) {
  const range = radius + size * .71 + 100, urgent = size * 1.2;
  const speed = motion && Number.isFinite(motion.heading) && Number.isFinite(motion.speed) ? Math.min(120, Math.max(0, motion.speed)) : 0;
  const lead = Math.min(size * 1.5, speed * 2), fx = speed > 2 ? Math.sin(motion!.heading) : 0, fz = speed > 2 ? Math.cos(motion!.heading) : 0;
  const rows = tiles.map((tile, id) => { const dx = (tile[0] + .5) * size - x, dz = (tile[1] + .5) * size - z; return { id, distance: Math.hypot(dx, dz), ahead: dx * fx + dz * fz, predicted: Math.hypot(dx - fx * lead, dz - fz * lead) }; });
  const needed = rows.filter(row => row.distance < range);
  needed.sort((a, b) => Number(b.distance < urgent) - Number(a.distance < urgent) || (a.distance < urgent ? a.distance - b.distance : a.distance - a.ahead * .25 - b.distance + b.ahead * .25) || a.id - b.id);
  const extra = speed > 2 ? rows.filter(row => row.distance >= range && row.predicted < range && row.ahead > 0).sort((a, b) => a.predicted - b.predicted || a.id - b.id).slice(0, CITY_PREFETCH_LIMIT) : [];
  return [...needed, ...extra].map(row => row.id);
}

/** Cooperative CPU budget. A single native/driver call remains indivisible. */
export class CityBuildBudget {
  private start: number;
  busyMs = 0; yields = 0;
  constructor(public milliseconds: number, private readonly now: () => number, private readonly nextFrame: (signal?: AbortSignal) => Promise<void>) { this.start = now(); }
  restart() { this.start = this.now(); }
  async checkpoint(signal?: AbortSignal) {
    checkStreamingSignal(signal);
    const elapsed = this.now() - this.start;
    if (elapsed < this.milliseconds) return;
    this.busyMs += elapsed;
    this.yields++;
    try { await this.nextFrame(signal); } finally { this.start = this.now(); }
    checkStreamingSignal(signal);
  }
  finish() { this.busyMs += this.now() - this.start; }
}

/** Accumulates cosmetic time only. Event/physics callers keep their original callback delta. */
export class VisualWorkClock {
  private elapsed = 0;
  callbacks = 0; draws = 0;
  sample(dt: number, draw: boolean): number | null {
    this.callbacks++;
    if (Number.isFinite(dt) && dt > 0) this.elapsed += Math.min(.1, dt);
    if (!draw) return null;
    this.draws++;
    const result = Math.min(.1, this.elapsed); this.elapsed = 0; return result;
  }
  reset() { this.elapsed = 0; }
}
