import type { CargoStop } from './evolution-city-models';
import { explorationRegion } from './player-progress';
export function cargoLabel(stop: CargoStop, catalog: readonly CargoStop[]) {
  if (/[^\d\s,，.、-]/.test(stop.name)) return stop.name;
  const near = catalog.filter(s => /[^\d\s,，.、-]/.test(s.name)).sort((a, b) => Math.hypot(a.x - stop.x, a.z - stop.z) - Math.hypot(b.x - stop.x, b.z - stop.z))[0];
  return `${explorationRegion(stop)}道路配送站${near && Math.hypot(near.x - stop.x, near.z - stop.z) < 350 ? `（近${near.name}）` : ''} · ${Math.round(stop.x)},${Math.round(stop.z)}`;
}
export function cargoLayer(stop: CargoStop, ground: (x: number, z: number) => number) {
  const dy = stop.y - ground(stop.x, stop.z);
  return dy > 3 ? '高架' : dy < -3 ? '地下' : '地面';
}
export function visibleCargoStops(catalog: readonly CargoStop[], query: string, nearby: boolean, car: { x: number; z: number }) {
  const q = query.trim().normalize('NFKC').toLocaleLowerCase();
  return catalog.filter(s => `${cargoLabel(s, catalog)} ${s.name} ${explorationRegion(s)}`.normalize('NFKC').toLocaleLowerCase().includes(q))
    .sort((a, b) => nearby ? Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z) || a.id.localeCompare(b.id) : cargoLabel(a, catalog).localeCompare(cargoLabel(b, catalog), 'zh-Hant'));
}
