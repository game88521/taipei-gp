import { decodeWorkshop, encodeWorkshop, type WorkshopDefinition, type WorkshopResult } from './nexus-workshop';

export const VOYAGER_WORKSHOP_GHOST_STORAGE_KEY = 'taipei-gp-voyager-workshop-ghost-v1';
export const VOYAGER_WORKSHOP_GHOST_MAX_BYTES = 2_000_000;
export const WORKSHOP_GHOST_FILE_MAX_BYTES = 250_000;
export const WORKSHOP_GHOST_INTERVAL_MS = 200;
export type WorkshopGhostSample = [number, number, number, number, number]; // ms,x,y,z,heading
export interface WorkshopGhost { type: 'taipei-gp-workshop-ghost'; v: 1; code: string; durationMs: number; samples: WorkshopGhostSample[] }
export interface WorkshopGhostStorage { v: 1; enabled: boolean; best: WorkshopGhost[] }
export interface GhostPose { x: number; y: number; z: number; h: number }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const wrap = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
const copy = (g: WorkshopGhost): WorkshopGhost => ({ ...g, samples: g.samples.map(s => [...s]) });

/** A local visual comparison, never an authority for results or a TT ghost. */
export function parseWorkshopGhost(value: unknown): WorkshopGhost | null {
  try {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'code,durationMs,samples,type,v' || value.type !== 'taipei-gp-workshop-ghost' || value.v !== 1 || typeof value.code !== 'string' || value.code.length > 4096 || !Number.isSafeInteger(value.durationMs) || (value.durationMs as number) < 1 || (value.durationMs as number) > 300_000 || !Array.isArray(value.samples)) return null;
    const def = decodeWorkshop(value.code), durationMs = value.durationMs as number;
    if (encodeWorkshop(def) !== value.code || durationMs > def.seconds * 1000 + 1 || value.samples.length !== Math.floor(durationMs / WORKSHOP_GHOST_INTERVAL_MS) + 1 || value.samples.length > 1501 || JSON.stringify(value).length > WORKSHOP_GHOST_FILE_MAX_BYTES) return null;
    const samples: WorkshopGhostSample[] = [];
    for (const [i, row] of value.samples.entries()) {
      if (!Array.isArray(row) || row.length !== 5 || !row.every(finite) || row[0] !== i * WORKSHOP_GHOST_INTERVAL_MS || Math.abs(row[1]) > 40000 || Math.abs(row[3]) > 40000 || row[2] < -1000 || row[2] > 5000 || Math.abs(row[4]) > Math.PI + .00001) return null;
      const last = samples.at(-1);
      if (last && (Math.hypot(row[1] - last[1], row[3] - last[3]) > 160 * .2 + 2 || Math.abs(row[2] - last[2]) > 10)) return null;
      samples.push([...row] as WorkshopGhostSample);
    }
    return { type: value.type, v: 1, code: value.code, durationMs, samples };
  } catch { return null; }
}
export function parseWorkshopGhostStorage(value: unknown): WorkshopGhostStorage | null {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'best,enabled,v' || value.v !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.best) || value.best.length > 12) return null;
  try {
    if (JSON.stringify(value).length > VOYAGER_WORKSHOP_GHOST_MAX_BYTES) return null;
    const best: WorkshopGhost[] = [], codes = new Set<string>();
    for (const row of value.best) { const g = parseWorkshopGhost(row); if (!g || codes.has(g.code)) return null; codes.add(g.code); best.push(g); }
    return { v: 1, enabled: value.enabled, best };
  } catch { return null; }
}
export function ghostCompatible(ghost: WorkshopGhost, definition: WorkshopDefinition) { return ghost.code === encodeWorkshop(definition); }
export function workshopGhostAt(g: WorkshopGhost, seconds: number): GhostPose | null {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || ms < 0 || ms > g.durationMs) return null;
  const index = Math.min(g.samples.length - 1, Math.floor(ms / WORKSHOP_GHOST_INTERVAL_MS)), a = g.samples[index], b = g.samples[index + 1] ?? a, f = a === b ? 0 : Math.max(0, Math.min(1, (ms - a[0]) / (b[0] - a[0])));
  return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, z: a[3] + (b[3] - a[3]) * f, h: wrap(a[4] + wrap(b[4] - a[4]) * f) };
}
export class WorkshopGhostRecorder {
  private samples: WorkshopGhostSample[] = []; private last: GhostPose; private lastMs = 0; private invalid = false;
  constructor(readonly definition: WorkshopDefinition, initial: GhostPose) { this.last = { ...initial }; this.samples.push([0, initial.x, initial.y, initial.z, wrap(initial.h)]); }
  step(seconds: number, pose: GhostPose) {
    const ms = seconds * 1000;
    if (this.invalid) return;
    if (!finite(ms) || ms < this.lastMs || ms > 300_000 || ![pose.x, pose.y, pose.z, pose.h].every(finite) || Math.hypot(pose.x - this.last.x, pose.z - this.last.z) > 160 * ((ms - this.lastMs) / 1000) + 2) { this.invalid = true; return; }
    for (let at = this.samples.length * WORKSHOP_GHOST_INTERVAL_MS; at <= ms + .000001; at += WORKSHOP_GHOST_INTERVAL_MS) {
      const f = ms === this.lastMs ? 0 : Math.max(0, Math.min(1, (at - this.lastMs) / (ms - this.lastMs)));
      this.samples.push([at, this.last.x + (pose.x - this.last.x) * f, this.last.y + (pose.y - this.last.y) * f, this.last.z + (pose.z - this.last.z) * f, wrap(this.last.h + wrap(pose.h - this.last.h) * f)]);
    }
    this.last = { ...pose }; this.lastMs = ms;
  }
  finish(result: WorkshopResult) {
    if (this.invalid || result.success !== true || !finite(result.elapsed) || result.elapsed <= 0 || result.elapsed > 300 || !Number.isSafeInteger(result.hits) || result.hits < 0 || result.hits > this.definition.hits || Math.abs(result.elapsed * 1000 - this.lastMs) > 1) return null;
    const durationMs = Math.floor(result.elapsed * 1000 + .000001);
    return parseWorkshopGhost({ type: 'taipei-gp-workshop-ghost', v: 1, code: encodeWorkshop(this.definition), durationMs, samples: this.samples.filter(s => s[0] <= durationMs) });
  }
}
export class WorkshopGhostLibrary {
  private state: WorkshopGhostStorage = { v: 1, enabled: true, best: [] }; error = ''; private blocked = false;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'> | null) { this.reload(); }
  get enabled() { return this.state.enabled; }
  get count() { return this.state.best.length; }
  list() { return this.state.best.map(g => ({ code: g.code, durationMs: g.durationMs })); }
  reload() {
    try { const raw = this.storage?.getItem(VOYAGER_WORKSHOP_GHOST_STORAGE_KEY), parsed = raw ? raw.length <= VOYAGER_WORKSHOP_GHOST_MAX_BYTES && parseWorkshopGhostStorage(JSON.parse(raw)) : { v: 1 as const, enabled: true, best: [] }; if (!parsed) throw Error(); this.state = parsed; this.blocked = false; this.error = ''; return true; }
    catch { this.blocked = true; this.error = '工坊幽靈資料無法讀取；原文保留且停止覆寫，請先匯出整包備份再還原。'; return false; }
  }
  get(def: WorkshopDefinition) { const row = this.state.best.find(g => ghostCompatible(g, def)); return row ? copy(row) : null; }
  private save(next: WorkshopGhostStorage) {
    if (this.blocked) return false;
    const valid = parseWorkshopGhostStorage(next); if (!valid) { this.error = '幽靈庫已達容量上限，請刪除不需要的路線幽靈。'; return false; }
    this.state = valid;
    try { if (!this.storage) throw Error(); this.storage.setItem(VOYAGER_WORKSHOP_GHOST_STORAGE_KEY, JSON.stringify(valid)); this.error = ''; return true; }
    catch { this.error = '幽靈只保留在本頁，儲存失敗；可先下載目前最佳幽靈。'; return false; }
  }
  setEnabled(enabled: boolean) { return this.save({ ...this.state, enabled }); }
  record(ghost: WorkshopGhost) {
    const valid = parseWorkshopGhost(ghost); if (!valid || this.blocked) return false;
    const old = this.state.best.find(g => g.code === valid.code); if (old && old.durationMs <= valid.durationMs) return false;
    if (!old && this.state.best.length >= 12) { this.error = '最多保留12條路線最佳幽靈；請先刪除目前路線不再需要的幽靈。'; return false; }
    return this.save({ ...this.state, best: [valid, ...this.state.best.filter(g => g.code !== valid.code)] });
  }
  forget(def: WorkshopDefinition) { return this.save({ ...this.state, best: this.state.best.filter(g => !ghostCompatible(g, def)) }); }
}
