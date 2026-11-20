import { BigMap } from './bigmap';
import type { Router } from './router';
import type { RoadNet } from './citydata';
import type { Landmark } from './decor';
import { NAVIGATION_LABELS, type NavigationPreference } from './summit-navigation';
import './summit-city.css';

/** A preview never changes the active route until the driver explicitly adopts it. */
export function mountSummitNavigation(o: { host: HTMLElement; router(): Router | null; roads(): RoadNet | null; landmarks(): Landmark[]; position(): { x: number; z: number; y: number; h: number }; target(): { x: number; z: number; y: number; nm: string } | null; changed(): void }) {
  const panel = document.createElement('details'); panel.id = 'summit-navigation';
  const summary = document.createElement('summary'); summary.textContent = '導航路線偏好／預覽';
  const select = document.createElement('select'); select.id = 'navigation-preference'; select.setAttribute('aria-label', '導航路線偏好');
  for (const [id, label] of Object.entries(NAVIGATION_LABELS)) { const option = document.createElement('option'); option.value = id; option.textContent = label; select.append(option); }
  const text = document.createElement('p'); text.setAttribute('role', 'status');
  const canvas = document.createElement('canvas'); canvas.id = 'navigation-preview'; canvas.setAttribute('aria-label', '真實道路路線預覽'); canvas.style.cssText = 'width:100%;height:190px;touch-action:none;display:block';
  const refresh = document.createElement('button'); refresh.textContent = '更新預覽'; refresh.type = 'button'; refresh.id = 'navigation-refresh';
  const apply = document.createElement('button'); apply.textContent = '採用此偏好'; apply.type = 'button'; apply.id = 'navigation-apply';
  const hint = document.createElement('p'); hint.textContent = '先在大地圖選目的地，再重新開地圖預覽。時間依道路長度與轉彎估計，不含車流；避高架仍保留必要連通道路。僅影響手動導航，不改任務計酬。';
  hint.style.fontSize = '12px'; panel.append(summary, select, refresh, apply, text, canvas, hint); o.host.append(panel);
  let map: BigMap | null = null, route: ReturnType<Router['route']> = null;
  function preview() {
    const router = o.router(), roads = o.roads(), target = o.target(), p = o.position();
    if (!router || !roads || !target) { text.textContent = '請先選擇手動導航目的地。'; apply.disabled = true; return; }
    const preference = select.value as NavigationPreference;
    route = router.routeWithPreference(preference, p.x, p.z, target.x, target.z, p.y, target.y + .25);
    apply.disabled = !route;
    if (!route) { text.textContent = '目前路層沒有可達路線，未變更原導航。'; return; }
    let turns = 0; for (let i = 1; i + 1 < route.path.length; i++) { const a = route.path[i - 1], b = route.path[i], c = route.path[i + 1]; if (Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]))) > .5) turns++; }
    const eta = 'estimatedSeconds' in route ? Number(route.estimatedSeconds) : Math.ceil(route.length / 8.3 + turns * 5);
    text.textContent = `${target.nm} · ${(route.length / 1000).toFixed(2)} 公里 · 估計 ${Math.ceil(eta / 60)} 分鐘 · ${NAVIGATION_LABELS[preference]}（目前採用：${NAVIGATION_LABELS[router.navigationPreference]}）`;
    if (!map) { map = new BigMap(canvas, roads, o.landmarks()); map.side = 0; }
    const xs = route.path.map(v => v[0]), zs = route.path.map(v => v[1]); map.focus((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2); map.setZoom(Math.min(canvas.clientWidth / (Math.max(...xs) - Math.min(...xs) + 150), 170 / (Math.max(...zs) - Math.min(...zs) + 150)));
    map.draw(p.x, p.z, p.h, { x: target.x, z: target.z }, route.path);
  }
  select.onchange = refresh.onclick = preview; panel.ontoggle = () => { if (panel.open) preview(); };
  apply.onclick = () => { const router = o.router(); if (!router || !route) return; router.navigationPreference = select.value as NavigationPreference; o.changed(); preview(); };
  return { refresh: () => { if (panel.open) preview(); }, dispose() { map?.dispose(); map = null; panel.remove(); } };
}
