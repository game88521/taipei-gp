export type MultiplayerQualityMode = 'auto' | 'standard' | 'economy';
export const MULTIPLAYER_QUALITY_KEY = 'taipei-gp-multiplayer-quality-v1';
export const qualityMode = (value: unknown): MultiplayerQualityMode => value === 'standard' || value === 'economy' ? value : 'auto';
/** Measures rAF delivery before FPS pacing. Never changes simulation, inputs or frame limit. */
export class MultiplayerAutoQuality {
  mode: MultiplayerQualityMode = 'auto';
  level: 'standard' | 'economy' = 'standard';
  private elapsed = 0; private samples = 0; private slow = 0; private fast = 0;
  setMode(value: unknown) { this.mode = qualityMode(value); this.level = this.mode === 'economy' ? 'economy' : 'standard'; this.reset(); }
  reset() { this.elapsed = 0; this.samples = 0; this.slow = 0; this.fast = 0; }
  sample(dt: number, active: boolean) {
    if (this.mode !== 'auto' || !active || !Number.isFinite(dt) || dt <= 0 || dt > .25) { this.reset(); return false; }
    this.elapsed += dt; this.samples++;
    if (this.elapsed < 3) return false;
    const average = this.elapsed / this.samples; this.elapsed = 0; this.samples = 0;
    this.slow = average > 1 / 38 ? this.slow + 1 : 0;
    this.fast = average < 1 / 55 ? this.fast + 1 : 0;
    if (this.level === 'standard' && this.slow >= 2) { this.level = 'economy'; this.slow = this.fast = 0; return true; }
    if (this.level === 'economy' && this.fast >= 5) { this.level = 'standard'; this.slow = this.fast = 0; return true; }
    return false;
  }
}
