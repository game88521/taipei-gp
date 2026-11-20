import { Car } from './car';
import { locate, type Track } from './track';
import { resolveMultiplayerCollisions } from '../shared/multiplayer-collisions';

export type SplitControl = { steer: number; throttle: boolean; brake: boolean };
export type SplitPhase = 'countdown' | 'racing' | 'paused' | 'results';
export type SplitDriver = { id: string; car: Car; distance: number; laps: number; gate: number; finish: number | null; dnf: boolean; hits: number };
export const SPLIT_STEP = 1 / 60;
const neutral: SplitControl = { steer: 0, throttle: false, brake: true };

/** Isolated local race. No save, wallet, unlock or online client is imported. */
export class SummitSplitRace {
  readonly drivers: SplitDriver[];
  phase: SplitPhase = 'countdown';
  elapsed = 0;
  countdown = 3;
  pauseReason = '';
  contacts = 0;
  private resumePhase: 'countdown' | 'racing' = 'countdown';
  private firstFinish: number | null = null;
  constructor(readonly track: Track, readonly laps: number) {
    if (!Number.isInteger(laps) || laps < 1 || laps > 5) throw Error('圈數須為 1～5。');
    this.drivers = ['P1','P2'].map((id, index) => {
      const car = new Car(), i = track.N - 4;
      car.resetTransient(false); car.placeAt(track, i);
      const lat = index === 0 ? -1.7 : 1.7;
      car.x += -track.tz[i] * lat; car.z += track.tx[i] * lat; locate(track, car.x, car.z, car.pos);
      return { id, car, distance: car.pos.s - track.length, laps: 0, gate: 1, finish: null, dnf: false, hits: 0 };
    });
  }
  pause(reason = '比賽已暫停') {
    if (this.phase === 'paused' || this.phase === 'results') return;
    this.resumePhase = this.phase; this.phase = 'paused'; this.pauseReason = reason;
  }
  resume() { if (this.phase === 'paused') { this.phase = this.resumePhase; this.pauseReason = ''; } }
  retire(id: string) {
    const driver = this.drivers.find(d => d.id === id);
    if (driver && driver.finish === null) { driver.dnf = true; driver.car.v = 0; }
    this.checkResults();
  }
  get order() {
    return [...this.drivers].sort((a,b) => (a.dnf ? 1 : 0) - (b.dnf ? 1 : 0)
      || (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.distance - a.distance || a.id.localeCompare(b.id));
  }
  private checkResults() { if (this.drivers.every(d => d.finish !== null || d.dnf)) this.phase = 'results'; }
  step(controls: readonly SplitControl[], dt = SPLIT_STEP) {
    if (dt !== SPLIT_STEP) throw Error('分割畫面物理只接受固定 60 Hz。');
    if (this.phase === 'paused' || this.phase === 'results') return;
    if (this.phase === 'countdown') { this.countdown = Math.max(0, this.countdown - dt); if (this.countdown <= 1e-8) this.phase = 'racing'; return; }
    this.elapsed += dt;
    const moving = this.drivers.filter(d => d.finish === null && !d.dnf).map(driver => ({ driver,
      previous: { x: driver.car.x, z: driver.car.z, h: driver.car.h }, s: driver.car.pos.s }));
    for (const { driver } of moving) {
      const input = controls[this.drivers.indexOf(driver)] ?? neutral;
      const steer = Number.isFinite(input.steer) ? Math.max(-1, Math.min(1, input.steer)) : 0;
      if (driver.car.update(dt, this.track, steer, input.brake || !input.throttle) > 5) driver.hits++;
    }
    const contacts = resolveMultiplayerCollisions(this.track, moving.map(({driver,previous}) => ({ id: driver.id, car: driver.car, previous })), dt);
    this.contacts += contacts.length;
    for (const { driver, s } of moving) {
      let delta = driver.car.pos.s - s;
      if (delta > this.track.length / 2) delta -= this.track.length;
      if (delta < -this.track.length / 2) delta += this.track.length;
      if (!Number.isFinite(delta) || Math.abs(delta) > Math.max(20, driver.car.v * dt * 3 + 6)) { driver.dnf = true; driver.car.v = 0; continue; }
      const before = driver.distance; driver.distance += delta;
      const gate = (driver.laps + driver.gate / 3) * this.track.length;
      if (delta > 0 && before < gate && driver.distance + 1e-8 >= gate) {
        if (driver.gate < 3) driver.gate++;
        else {
          driver.laps++; driver.gate = 1;
          if (driver.laps >= this.laps) {
            driver.finish = this.elapsed - dt * (1 - Math.max(0, Math.min(1, (gate - before) / delta)));
            driver.car.v = 0; this.firstFinish ??= this.elapsed;
          }
        }
      }
    }
    if (this.elapsed >= this.laps * 300 || this.firstFinish !== null && this.elapsed - this.firstFinish >= 90) {
      for (const d of this.drivers) if (d.finish === null) { d.dnf = true; d.car.v = 0; }
    }
    this.checkResults();
  }
}
