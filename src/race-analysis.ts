/** 旁觀已完成的物理步驟；不推進比賽、不改車手狀態或亂數。 */
export interface AnalysisRacer {
  name: string; laps: number; lapStart: number; compound: number; wear: number; pits: number;
  finish: number | null; dnf: boolean; pit: unknown; isPlayer?: boolean;
}
export interface AnalysisField { raceTime: number; wet: number; sc: { phase: string }; racers: readonly AnalysisRacer[] }
export interface AnalysisLap {
  lap: number; time: number | null; compound: number; endCompound: number; wear: number;
  wet: boolean; safetyCar: boolean; pit: boolean; partial: boolean; invalid: boolean; conditionsUnknown: boolean; stint: number;
}
export interface AnalysisStop { lap: number; time: number; compound: number; count: number; uncertain: boolean }
export interface AnalysisDriver { name: string; laps: AnalysisLap[]; stops: AnalysisStop[]; truncated: boolean; incomplete: boolean }
interface Observed {
  lap: number; start: number; compound: number; pits: number; wear: number; wet: boolean; safetyCar: boolean;
  pit: boolean; complete: boolean; invalid: boolean; conditionsUnknown: boolean; stint: number; lapStint: number; activeCompound: number;
}
const finite = (n: number) => Number.isFinite(n) && n >= 0;
export class RaceAnalysis {
  private drivers = new Map<string, AnalysisDriver>();
  private observed = new Map<string, Observed>();
  private previousTime = -1;
  private resumed = false;
  constructor(readonly trackLength: number, readonly capacity = 100) {}
  reset(resumed = false) { this.drivers.clear(); this.observed.clear(); this.previousTime = -1; this.resumed = resumed; }
  observe(field: AnalysisField, playerValid = true) {
    if (!finite(field.raceTime)) return;
    if (field.raceTime < this.previousTime) this.reset(true);
    const interval = this.previousTime >= 0 ? field.raceTime - this.previousTime : 0;
    const observationGap = interval > 2;
    this.previousTime = field.raceTime;
    for (const r of field.racers.slice(0, 22)) {
      if (!finite(r.lapStart) || !Number.isInteger(r.laps) || r.laps < 0) continue;
      let driver = this.drivers.get(r.name), previous = this.observed.get(r.name);
      if (!driver) {
        driver = { name: r.name, laps: [], stops: [], truncated: false, incomplete: this.resumed || r.laps > 0 };
        this.drivers.set(r.name, driver);
      }
      const wet = field.wet > .05, safetyCar = field.sc.phase !== 'off';
      if (previous && observationGap) previous.conditionsUnknown = true;
      const changedTyre = !!previous && (r.pits !== previous.pits || r.compound !== previous.activeCompound);
      if (previous && r.pits > previous.pits) {
        const count = r.pits - previous.pits;
        driver.stops.push({ lap: Math.max(1, r.laps), time: field.raceTime, compound: r.compound, count, uncertain: interval > .05 || count > 1 });
        if (count > 1) driver.incomplete = true;
        if (driver.stops.length > this.capacity) { driver.stops.shift(); driver.truncated = true; }
      }
      const stint = (previous?.stint ?? 1) + (changedTyre ? Math.max(1, r.pits - previous!.pits) : 0);
      if (previous && r.laps > previous.lap) {
        if (previous.lap >= 1) {
          const duration = r.lapStart - previous.start;
          const complete = previous.complete && r.laps === previous.lap + 1 && duration > 0 && Number.isFinite(duration);
          driver.laps.push({ lap: previous.lap, time: complete ? duration : null, compound: previous.compound,
            endCompound: r.compound, wear: r.wear, wet: previous.wet || wet, safetyCar: previous.safetyCar || safetyCar,
            pit: previous.pit || !!r.pit || changedTyre, partial: !complete, invalid: previous.invalid || (r.isPlayer === true && !playerValid), conditionsUnknown: previous.conditionsUnknown, stint: previous.lapStint });
          if (driver.laps.length > this.capacity) { driver.laps.shift(); driver.truncated = true; }
        }
        this.observed.set(r.name, { lap: r.laps, start: r.lapStart, compound: r.compound, pits: r.pits, wear: r.wear,
          // 此處 playerValid 描述剛完成的一圈；main 隨後 startLap，不能把無效標記帶進新圈。
          wet, safetyCar, pit: !!r.pit, complete: true, invalid: false, conditionsUnknown: observationGap && field.raceTime - r.lapStart > .02, stint, lapStint: stint, activeCompound: r.compound });
      } else if (!previous || r.laps < previous.lap || r.lapStart < previous.start) {
        this.observed.set(r.name, { lap: r.laps, start: r.lapStart, compound: r.compound, pits: r.pits, wear: r.wear,
          wet, safetyCar, pit: !!r.pit, complete: r.laps === 0, invalid: r.isPlayer === true && !playerValid, conditionsUnknown: this.resumed || r.laps > 0, stint, lapStint: stint, activeCompound: r.compound });
      } else {
        previous.wet ||= wet; previous.safetyCar ||= safetyCar; previous.pit ||= !!r.pit || changedTyre;
        previous.invalid ||= r.isPlayer === true && !playerValid;
        previous.pits = r.pits; previous.stint = stint; previous.activeCompound = r.compound;
        // 當圈跨胎段，保留起圈胎種；平均圈速將排除此進出站圈。
      }
    }
  }
  all(): AnalysisDriver[] { return [...this.drivers.values()].map(d => ({ ...d, laps: d.laps.map(l => ({ ...l })), stops: d.stops.map(s => ({ ...s })) })); }
  stints(driver: AnalysisDriver) {
    const stints = new Map<number, { stint: number; compound: number; first: number; last: number; laps: AnalysisLap[] }>();
    for (const lap of driver.laps) {
      let stint = stints.get(lap.stint);
      if (!stint) { stint = { stint: lap.stint, compound: lap.compound, first: lap.lap, last: lap.lap, laps: [] }; stints.set(lap.stint, stint); }
      stint.last = lap.lap; stint.laps.push(lap);
    }
    return [...stints.values()].map(s => {
      const clean = s.laps.filter(l => !l.partial && !l.pit && !l.safetyCar && !l.wet && !l.invalid && !l.conditionsUnknown && l.time !== null);
      const average = clean.length ? clean.reduce((sum, l) => sum + l.time!, 0) / clean.length : null;
      return { stint: s.stint, compound: s.compound, first: s.first, last: s.last, observed: s.laps.length,
        comparable: clean.length, average, averageSpeed: average && this.trackLength > 0 ? this.trackLength / average * 3.6 : null };
    });
  }
}
