import { groundH } from './citydata';
import { ROAD_Y } from './surface';
import { FragileCargo, RouteDrift, cargoTimeBudget, parseCargoCheckpoint, type CargoStop, type CityPoint, type RouteDriftRoute } from './evolution-city-models';
import type { Challenge } from './streetrace';
import type { FreeCar } from './freecar';
import type { DriftScore } from './drift';
import type { Router } from './router';
import type { Save } from './save';
import type { Landmark } from './decor';
import { cargoLabel, cargoLayer, visibleCargoStops } from './horizon-cargo';
import { explorationRegion } from './player-progress';

interface Options {
  host: HTMLElement; hud: HTMLElement; calendar: HTMLElement; car: FreeCar; scorer: DriftScore; save: Save;
  getCarId(): string; getRoutes(): Challenge[]; getRouter(): Router | null; getLandmarks(): Landmark[];
  prepare(): Promise<boolean>; enter(): void; pause(): void; persist(): void; earn(amount: number, reason: string): void;
  notify(message: string): void; navigate(p: CityPoint, name: string): void; startCalendar(ids: string[], isCurrent: () => boolean): Promise<boolean>;
  canStart(): boolean; visible(): boolean;
}
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const e = document.createElement(tag); e.textContent = text; return e; };
const button = (id: string, text: string) => { const e = make('button', text); e.id = id; e.type = 'button'; e.className = 'ghost-btn'; return e; };
const medal = { none: '無獎牌', bronze: '🥉銅牌', silver: '🥈銀牌', gold: '🥇金牌' };
export function routeDriftRoute(c: Challenge): RouteDriftRoute {
  const points: CityPoint[] = [];
  for (let i = 0; i < c.path.length; i++) {
    const [x, z] = c.path[i], last = points.at(-1), length = last ? Math.hypot(last.x - x, last.z - z) : Infinity;
    if (last && length < .01) continue;
    if (!last || length >= 12 || i === c.path.length - 1) {
      if (last) { const steps = Math.ceil(length / 15); for (let j = 1; j < steps; j++) { const px = last.x + (x - last.x) * j / steps, pz = last.z + (z - last.z) * j / steps; points.push({ x: px, z: pz, y: groundH(px, pz) + ROAD_Y }); } }
      points.push({ x, z, y: groundH(x, z) + ROAD_Y });
    }
  }
  return { id: c.def.id, title: c.def.title, points };
}
/** Equally usable with keyboard and touch; all asynchronous launches are scoped to the current page intent. */
export function mountEvolutionCity(o: Options) {
  const cargo = new FragileCargo(), routeDrift = new RouteDrift(o.scorer);
  let generation = 0, busy = false, catalog: CargoStop[] = [], selectedStops: string[] = [], selectedRoutes: string[] = [], shownTarget = '', stopped = false;
  const page = o.host, routeSection = make('section'), cargoSection = make('section'), status = make('p'); status.id = 'evolution-city-status'; status.setAttribute('role', 'status');
  const routeSelect = make('select'); routeSelect.id = 'route-drift-route';
  const routeStart = button('route-drift-start', '開始路段甩尾');
  const routeRecord = make('p'); routeRecord.id = 'route-drift-record';
  const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); preview.id = 'route-drift-preview'; preview.setAttribute('viewBox', '0 0 300 160'); preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', '甩尾路線與行進方向');
  routeSection.append(make('h2', '路段甩尾賽'), make('p', '依序通過道路評分門，只計道路走廊內向前行駛的甩尾。離開走廊或倒行會取消連段；傳送取消本場。暫停、看地圖暫停計時；重載不保留這場。全程完成才有獎牌與一次獎金。'), routeSelect, preview, routeRecord, routeStart);
  const stopSelect = make('select'); stopSelect.id = 'cargo-stop-select';
  const search = make('input'); search.id = 'cargo-search'; search.type = 'search'; search.placeholder = '搜尋站名或東／中／西區'; search.setAttribute('aria-label', '搜尋配送站');
  const sort = make('select'); sort.id = 'cargo-sort'; sort.setAttribute('aria-label', '配送站排序');
  for (const [id, label] of [['nearby', '附近優先'], ['name', '依站名']]) { const option = make('option', label); option.value = id; sort.append(option); }
  const mapOpen = button('cargo-map-open', '地圖選站與順序預覽'), map = make('section'); map.id = 'cargo-map-panel'; map.hidden = true;
  const mapSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); mapSvg.id = 'cargo-map'; mapSvg.setAttribute('viewBox', '0 0 600 320'); mapSvg.setAttribute('aria-label', '配送站地圖；圓點可選站，編號為目前順序');
  const mapSelected = make('p'), mapAdd = button('cargo-map-add', '將選中站加入末站'), mapCancel = button('cargo-map-cancel', '關閉選站地圖'); mapSelected.id = 'cargo-map-selected';
  let pendingStop = '';
  map.append(make('h3', '選擇配送站'), make('p', '點選圓點查看站名，再確認加入。藍線是已選順序的真道路路線；虛線僅表示候選站，不會自動接單。'), mapSvg, mapSelected, mapAdd, mapCancel);
  const addStop = button('cargo-add-stop', '加入配送站'), stopList = make('ol'); stopList.id = 'cargo-stop-list';
  const cargoStart = button('cargo-start', '接下易碎貨物配送'), cargoResume = button('cargo-resume', '續接已保存的貨物'), cargoAbandon = button('cargo-abandon', '放棄保存的貨物');
  const cargoSaved = make('p'); cargoSaved.id = 'cargo-saved';
  const cargoQuote = make('p'); cargoQuote.id = 'cargo-quote';
  const lastResult = make('p'); lastResult.id = 'evolution-city-last-result'; lastResult.setAttribute('role', 'status');
  cargoSection.append(make('h2', '易碎貨物配送'), make('p', '自選3～5站並排序。各站同路層、時速低於4km/h停穩0.8秒交付。碰撞與超過6m/s²急減速會扣完整度；期限內送完且貨物未破損才一次收款。暫停／地圖／離線不扣時間，7日內可續接。期間不計自由甩尾、載客或追緝獎勵。'), search, sort, stopSelect, addStop, mapOpen, map, stopList, cargoQuote, cargoStart, cargoSaved, cargoResume, cargoAbandon);
  const back = button('evolution-city-back', '返回選單'); page.replaceChildren(make('h1', '城市挑戰'), routeSection, cargoSection, lastResult, status, back);
  const hud = o.hud, hudText = make('p'), nav = button('evolution-city-navigate', '導航下一目標'), stop = button('evolution-city-stop', '結束挑戰');
  hudText.id = 'evolution-city-hud-text'; hudText.setAttribute('role', 'status'); hud.append(hudText, nav, stop); hud.hidden = true;
  const calendarSelect = make('select'); calendarSelect.id = 'street-calendar-route';
  const calendarAdd = button('street-calendar-add', '加入賽曆'), calendarStart = button('street-calendar-start', '開始自訂系列'), calendarList = make('ol'), calendarStatus = make('p'); calendarList.id = 'street-calendar-list'; calendarStatus.setAttribute('role', 'status');
  o.calendar.replaceChildren(make('h3', '自訂3～5站賽曆'), make('p', '加入既有路線後可上下排序，不可重複；開賽時鎖定上方車款、難度、同級規則。每站結算自動保存；未完成的一站重新開始。'), calendarSelect, calendarAdd, calendarList, calendarStart, calendarStatus);
  function reorder(list: string[], index: number, delta: number) { const to = index + delta; if (to < 0 || to >= list.length) return; [list[index], list[to]] = [list[to], list[index]]; generation++; }
  function orderedList(host: HTMLOListElement, rows: string[], name: (id: string) => string, render: () => void) {
    host.replaceChildren(); rows.forEach((id, i) => {
      const row = make('li'), label = make('span', name(id)), up = button(`${host.id}-up-${i}`, '上移'), down = button(`${host.id}-down-${i}`, '下移'), remove = button(`${host.id}-remove-${i}`, '移除');
      up.setAttribute('aria-label', `上移 ${name(id)}`); down.setAttribute('aria-label', `下移 ${name(id)}`); remove.setAttribute('aria-label', `移除 ${name(id)}`);
      up.disabled = i === 0 || busy; down.disabled = i === rows.length - 1 || busy; remove.disabled = busy;
      up.onclick = () => { reorder(rows, i, -1); render(); }; down.onclick = () => { reorder(rows, i, 1); render(); }; remove.onclick = () => { generation++; rows.splice(i, 1); render(); };
      row.append(label, up, down, remove); host.append(row);
    });
  }
  function renderCalendar() {
    const routes = o.getRoutes(), prev = calendarSelect.value; calendarSelect.replaceChildren();
    for (const c of routes) { const option = make('option', c.def.title); option.value = c.def.id; calendarSelect.append(option); }
    if (routes.some(c => c.def.id === prev)) calendarSelect.value = prev;
    orderedList(calendarList, selectedRoutes, id => routes.find(c => c.def.id === id)?.def.title ?? id, renderCalendar);
    calendarStart.disabled = busy || selectedRoutes.length < 3 || selectedRoutes.length > 5; calendarAdd.disabled = busy || selectedRoutes.length >= 5;
  }
  calendarAdd.onclick = () => { generation++; const id = calendarSelect.value; if (id && !selectedRoutes.includes(id) && selectedRoutes.length < 5) selectedRoutes.push(id); else calendarStatus.textContent = '路線不可重複，最多五站。'; renderCalendar(); };
  calendarSelect.onchange = () => { generation++; };
  calendarStart.onclick = async () => {
    if (busy || selectedRoutes.length < 3 || selectedRoutes.length > 5 || o.calendar.getClientRects().length === 0) return;
    const token = ++generation, ids = [...selectedRoutes]; busy = true; renderCalendar();
    try { const ok = await o.startCalendar(ids, () => token === generation && o.calendar.getClientRects().length > 0); if (token === generation && !ok) calendarStatus.textContent = '目前無法開始，請先繼續或放棄原系列後重試。'; }
    catch { if (token === generation) calendarStatus.textContent = '無法開始賽曆，請重試。'; }
    finally { busy = false; renderCalendar(); }
  };
  function routeTemplate(): RouteDriftRoute | null {
    const c = o.getRoutes().find(r => r.def.id === routeSelect.value); if (!c) return null;
    return routeDriftRoute(c);
  }
  function renderRoute() {
    const route = routeTemplate(); preview.replaceChildren();
    if (!route) return;
    const xs = route.points.map(p => p.x), zs = route.points.map(p => p.z), minX = Math.min(...xs), minZ = Math.min(...zs), scale = Math.min(270 / Math.max(1, Math.max(...xs) - minX), 130 / Math.max(1, Math.max(...zs) - minZ));
    const line = document.createElementNS(preview.namespaceURI, 'polyline'); line.setAttribute('points', route.points.map(p => `${15 + (p.x - minX) * scale},${15 + (p.z - minZ) * scale}`).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#b18cff'); line.setAttribute('stroke-width', '3'); preview.append(line);
    for (const [i, p] of [route.points[0], route.points.at(-1)!].entries()) { const label = document.createElementNS(preview.namespaceURI, 'text'); label.setAttribute('x', String(15 + (p.x - minX) * scale)); label.setAttribute('y', String(15 + (p.z - minZ) * scale)); label.setAttribute('fill', i ? '#ffdf77' : '#80ffac'); label.textContent = i ? '終' : '起'; preview.append(label); }
    const key = `route-drift-v1:${encodeURIComponent(route.id)}:${encodeURIComponent(o.getCarId())}`, rec = o.save.routeDrift?.[key];
    routeRecord.textContent = `${route.points.length - 1}個順序評分門；9m道路走廊，彎道側距2～7m有效甩尾有貼彎加分。` + (rec ? ` 本車最佳 ${rec.score}分／完成${Math.round(rec.completion * 100)}%／${medal[rec.medal]}。` : ' 本車尚無紀錄。');
  }
  function buildCatalog() {
    if (catalog.length) return;
    const router = o.getRouter(); if (!router) return;
    const unique = new Set<string>();
    for (const l of [...o.getLandmarks()].sort((a, b) => a.nm.localeCompare(b.nm, 'zh-Hant'))) {
      if (unique.has(l.nm) || /捷運站|出口|廳舍|鍋爐|修理廠|Top Floor|觀景/u.test(l.nm)) continue;
      const route = router.route(l.x, l.z, l.x, l.z); if (!route) continue;
      unique.add(l.nm); catalog.push({ id: l.nm, name: l.nm, x: route.path[0][0], z: route.path[0][1], y: route.ys[0] + ROAD_Y }); if (catalog.length >= 80) break;
    }
  }
  function renderCargo() {
    buildCatalog(); const prev = stopSelect.value; stopSelect.replaceChildren();
    const filtered = visibleCargoStops(catalog, search.value, sort.value === 'nearby', o.car);
    for (const s of filtered) { const option = make('option', `${cargoLabel(s, catalog)} · ${explorationRegion(s)}／${cargoLayer(s, groundH)} · 直線${Math.round(Math.hypot(s.x-o.car.x,s.z-o.car.z))}m`); option.value = s.id; stopSelect.append(option); }
    if (catalog.some(s => s.id === prev)) stopSelect.value = prev;
    if (!stopSelect.value && filtered.length) stopSelect.value = filtered[0].id;
    orderedList(stopList, selectedStops, id => { const s = catalog.find(s => s.id === id); return s ? `${selectedStops.indexOf(id)+1}. ${cargoLabel(s, catalog)}（${cargoLayer(s, groundH)}）` : id; }, renderCargo);
    cargoStart.disabled = busy || selectedStops.length < 3 || !!o.save.cargoJob; addStop.disabled = busy || selectedStops.length >= 5 || !stopSelect.value;
    const cp = parseCargoCheckpoint(o.save.cargoJob); cargoResume.hidden = cargoAbandon.hidden = !o.save.cargoJob;
    cargoResume.disabled = busy || !cp; cargoSaved.textContent = cp ? `已保存：${cp.next}/${cp.stops.length}站、貨物${cp.integrity.toFixed(0)}%、剩${Math.ceil(cp.remaining)}秒。下一站${cargoLabel(cp.stops[cp.next], catalog)}，固定車款 ${cp.carId}；離線暫停計時。` : o.save.cargoJob ? '保存的配送已過期或無法驗證，請放棄後重新接單。' : '';
    const router = o.getRouter(); let from: CityPoint = o.car, length = 0, reachable = !!router;
    for (const id of selectedStops) { const s = catalog.find(s => s.id === id); if (!s || !router) { reachable = false; break; } const r = router.route(from.x, from.z, s.x, s.z, from.y, s.y - ROAD_Y); if (!r) { reachable = false; break; } length += r.length; from = s; }
    cargoQuote.textContent = selectedStops.length < 3 ? '加入至少三站後，顯示道路里程、期限和計酬。' : !reachable ? '有站點無法抵達，請換站或更換順序。' : `計畫道路 ${(length / 1000).toFixed(2)}km／期限 ${cargoTimeBudget(length, selectedStops.length)}秒。完整貨物基礎貨資 NT$${Math.floor(selectedStops.length * 100 + length * .06)}，貨損按完整度比例扣減；準時獎金0～120。全部完成才收款，失敗／放棄收入0。`;
    cargoStart.disabled ||= !reachable;
    if (!map.hidden) renderCargoMap();
  }
  function renderCargoMap() {
    mapSvg.replaceChildren(); if (!catalog.length) return;
    const points = [o.car, ...catalog], minX = Math.min(...points.map(p=>p.x)), maxX = Math.max(...points.map(p=>p.x)), minZ = Math.min(...points.map(p=>p.z)), maxZ = Math.max(...points.map(p=>p.z));
    const scale = Math.min(550/Math.max(1,maxX-minX),270/Math.max(1,maxZ-minZ)), xy = (p:{x:number;z:number}) => [25+(p.x-minX)*scale,25+(p.z-minZ)*scale];
    const svg = <K extends keyof SVGElementTagNameMap>(tag:K) => document.createElementNS('http://www.w3.org/2000/svg',tag);
    let from: CityPoint = o.car;
    for (const id of selectedStops) { const s=catalog.find(c=>c.id===id)!; const r=o.getRouter()?.route(from.x,from.z,s.x,s.z,from.y,s.y-ROAD_Y); if (r) { const line=svg('polyline'); line.setAttribute('points',r.path.map(([x,z])=>xy({x,z}).join(',')).join(' ')); line.setAttribute('fill','none'); line.setAttribute('stroke','#55ddff'); line.setAttribute('stroke-width','3'); mapSvg.append(line); } from=s; }
    const pending=catalog.find(s=>s.id===pendingStop);if(pending&&!selectedStops.includes(pending.id)){const r=o.getRouter()?.route(from.x,from.z,pending.x,pending.z,from.y,pending.y-ROAD_Y);if(r){const line=svg('polyline');line.setAttribute('points',r.path.map(([x,z])=>xy({x,z}).join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#ffdf77');line.setAttribute('stroke-dasharray','7 5');mapSvg.append(line);}}
    for (const s of visibleCargoStops(catalog, search.value, sort.value==='nearby',o.car)) {
      const [x,y]=xy(s), group=svg('g'), circle=svg('circle'), label=svg('text'), index=selectedStops.indexOf(s.id);
      circle.setAttribute('cx',String(x)); circle.setAttribute('cy',String(y)); circle.setAttribute('r',pendingStop===s.id?'8':'5'); circle.setAttribute('fill',index>=0?'#83ffb8':pendingStop===s.id?'#ffdd77':'#b297ff');
      group.setAttribute('tabindex','0'); group.setAttribute('role','button'); group.setAttribute('aria-label',cargoLabel(s,catalog)); group.dataset.stopId=s.id;
      const select=()=>{generation++;pendingStop=s.id;renderCargoMap();};group.addEventListener('click',select);group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
      const title=svg('title');title.textContent=cargoLabel(s,catalog);group.append(title,circle);
      if(index>=0){label.setAttribute('x',String(x+7));label.setAttribute('y',String(y-5));label.setAttribute('fill','white');label.textContent=String(index+1);group.append(label);}mapSvg.append(group);
    }
    const chosen = catalog.find(s=>s.id===pendingStop); mapSelected.textContent=chosen?`${cargoLabel(chosen,catalog)} · ${explorationRegion(chosen)}／${cargoLayer(chosen,groundH)}${selectedStops.includes(chosen.id)?'（已在順序中）':''}`:'尚未選站；可用Tab及Enter選擇圓點。';
    mapAdd.disabled=busy||!chosen||selectedStops.includes(pendingStop)||selectedStops.length>=5;
  }
  search.oninput=()=>{generation++;renderCargo();};sort.onchange=()=>{generation++;renderCargo();};
  mapOpen.onclick=()=>{generation++;map.hidden=false;pendingStop='';renderCargoMap();};
  mapCancel.onclick=()=>{generation++;map.hidden=true;pendingStop='';};
  mapAdd.onclick=()=>{generation++;if(catalog.some(s=>s.id===pendingStop)&&!selectedStops.includes(pendingStop)&&selectedStops.length<5)selectedStops.push(pendingStop);pendingStop='';renderCargo();};
  addStop.onclick = () => { generation++; const id = stopSelect.value; if (id && !selectedStops.includes(id) && selectedStops.length < 5) selectedStops.push(id); else status.textContent = '配送站不可重複，最多五站。'; renderCargo(); };
  stopSelect.onchange = () => { generation++; };
  routeSelect.onchange = () => { generation++; renderRoute(); };
  function current(token: number) { return token === generation && !stopped && page.getClientRects().length > 0 && !page.closest('.hidden') && o.canStart(); }
  async function launch(kind: 'drift' | 'cargo' | 'resume') {
    if (busy || !o.canStart()) return;
    const token = ++generation, route = routeTemplate(), stops = selectedStops.map(id => catalog.find(s => s.id === id)!).filter(Boolean), carId = o.getCarId();
    busy = true; renderCargo(); routeStart.disabled = true;
    try {
      if (!await o.prepare() || !current(token) || carId !== o.getCarId()) return;
      if (kind === 'drift') {
        if (!route) return; o.enter();
        const [a, b] = route.points; o.car.place(a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z), a.y);
        if (!routeDrift.start(route, carId)) { o.notify('路段目前無法使用'); return; }
      } else if (kind === 'cargo') {
        if (o.save.cargoJob || stops.length < 3 || stops.length > 5) return;
        const router = o.getRouter(); if (!router) return;
        let from: CityPoint = o.car, length = 0;
        for (const stop of stops) { const r = router.route(from.x, from.z, stop.x, stop.z, from.y, stop.y - ROAD_Y); if (!r) { status.textContent = '其中一站無法由目前位置抵達，請重新選站。'; return; } length += r.length; from = stop; }
        if (length < 50) return; o.enter(); if (!cargo.start(stops, carId, length, o.car)) return;
      } else {
        const cp = parseCargoCheckpoint(o.save.cargoJob); if (!cp) return;
        if (cp.carId !== carId) { status.textContent = `請先在車庫切回 ${cp.carId} 再續接配送。`; return; }
        o.enter(); if (!cargo.restore(cp, catalog, o.save.cargoSettled ?? [])) { status.textContent = '原配送的道路站點已變更，無法續接。'; return; }
        o.car.place(cp.position.x, cp.position.z, cp.position.h, cp.position.y);
      }
      page.closest('.overlay')?.classList.add('hidden'); generation++; shownTarget = ''; checkpoint(); o.persist(); refreshHud(); navigate();
      o.notify(kind === 'drift' ? '路段甩尾開始：依序通過評分門' : '貨物已裝車：平順駕駛、同路層停穩交付');
    } catch { if (current(token)) status.textContent = '暫時無法開始，請重試。'; }
    finally { busy = false; renderCargo(); routeStart.disabled = false; }
  }
  routeStart.onclick = () => { void launch('drift'); }; cargoStart.onclick = () => { void launch('cargo'); }; cargoResume.onclick = () => { void launch('resume'); };
  cargoAbandon.onclick = () => { generation++; cargo.cancel(); delete o.save.cargoJob; o.persist(); renderCargo(); refreshHud(); };
  back.onclick = () => { generation++; page.dispatchEvent(new Event('evolution-back', { bubbles: true })); };
  stop.onclick = () => { if (cargo.active) { checkpoint(); cargo.cancel(); o.persist(); o.notify('配送已保存，離線不扣時；可由城市挑戰續接或放棄。'); } if (routeDrift.active) { routeDrift.cancel(); o.notify('路段甩尾已結束，本場不結算。'); } refreshHud(); };
  function navigate() { const p = cargo.progress, target = p?.target ?? routeDrift.target; if (target) o.navigate(target, p ? `📦 ${cargoLabel(p.target,catalog)}` : `🌀 評分門 ${routeDrift.next}/${routeDrift.route!.points.length - 1}`); }
  nav.onclick = navigate;
  function checkpoint() { const cp = cargo.checkpoint(o.car); if (cp) o.save.cargoJob = cp; }
  function suspend() { generation++; if (cargo.active) { checkpoint(); cargo.cancel(); o.persist(); } if (routeDrift.active) routeDrift.cancel(); refreshHud(); }
  function refreshHud() {
    const p = cargo.progress; hud.hidden = !(p || routeDrift.active) || !o.visible();
    if (p) hudText.textContent = `📦 ${p.next}/${p.total}站 → ${cargoLabel(p.target,catalog)}｜貨物 ${p.integrity.toFixed(0)}%｜剩 ${Math.ceil(p.remaining)}s｜${p.wait ? `交付 ${(p.wait / .8 * 100).toFixed(0)}%` : '同層停穩0.8秒交付'}。急煞／撞擊扣貨損。`;
    else if (routeDrift.active) hudText.textContent = `🌀 ${routeDrift.route!.title}｜評分門 ${routeDrift.next}/${routeDrift.route!.points.length - 1}｜完成 ${(routeDrift.completion * 100).toFixed(0)}%｜${Math.round(routeDrift.score)}分＋連段 ${o.scorer.total}｜貼彎 ${Math.round(routeDrift.apexScore)}｜剩${Math.ceil(routeDrift.remaining)}s｜${routeDrift.inZone ? '評分區內' : '區外／倒行：不計分'}`;
    stop.textContent = p ? '保存並結束配送' : '結束路段甩尾';
  }
  function update(dt: number, impact: number) {
    const wasCargo = cargo.active, wasDrift = routeDrift.active;
    if (wasCargo) {
      const event = cargo.update(dt, o.car, impact);
      if (event.delivered) { checkpoint(); o.persist(); o.notify(`已交付第${event.delivered}站`); }
      if (event.finished) {
        const result = event.finished, ids = o.save.cargoSettled ?? [];
        delete o.save.cargoJob;
        if (!ids.includes(result.id)) {
          o.save.cargoSettled = [...ids, result.id].slice(-128);
          if (result.reward) o.earn(result.reward, '易碎貨物配送'); else o.persist();
        }
        lastResult.textContent = `本頁最近配送：${result.status === 'delivered' ? '完成' : result.status === 'timeout' ? '超時' : result.status === 'broken' ? '貨物破損' : '因位置跳躍取消'}，${result.delivered}/${result.total}站，完整度${result.integrity.toFixed(0)}%，收入NT$${result.reward}`;
        o.notify(lastResult.textContent);
      }
    } else if (wasDrift) {
      const event = routeDrift.update(dt, o.car, impact);
      if (event.finished) {
        const r = event.finished; o.save.routeDrift ??= {}; const old = o.save.routeDrift[r.key];
        if (r.reason !== 'invalid' && (!old || r.completion > old.completion || r.completion === old.completion && r.score > old.score)) o.save.routeDrift[r.key] = { score: r.score, completion: r.completion, medal: r.medal };
        if (r.reason === 'complete' && r.score >= 100) o.earn(Math.floor(r.score / 100), '路段甩尾'); else o.persist();
        lastResult.textContent = `本頁最近路段甩尾${r.reason === 'complete' ? '完成' : r.reason === 'timeout' ? '到時' : '因位置跳躍取消'}：${r.score}分／完成${Math.round(r.completion * 100)}%／${medal[r.medal]}，最大連段${r.maxChain}／貼彎加分${Math.round(r.apexScore)}`;
        o.notify(lastResult.textContent); o.pause();
      }
    }
    const p = cargo.progress, targetKey = p ? `cargo:${p.next}` : routeDrift.active ? `drift:${routeDrift.next}` : '';
    if (targetKey && targetKey !== shownTarget) { shownTarget = targetKey; navigate(); }
    refreshHud(); return wasCargo || wasDrift;
  }
  function refresh() {
    generation++; buildCatalog(); const prev = routeSelect.value; routeSelect.replaceChildren();
    for (const c of o.getRoutes()) { const option = make('option', c.def.title); option.value = c.def.id; routeSelect.append(option); }
    if (o.getRoutes().some(c => c.def.id === prev)) routeSelect.value = prev;
    renderRoute(); renderCargo(); renderCalendar(); refreshHud();
  }
  const invalidated = () => { generation++; }; addEventListener('blur', invalidated); addEventListener('pagehide', () => { stopped = true; invalidated(); checkpoint(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) invalidated(); });
  return { cargo, routeDrift, update, checkpoint, suspend, refresh, refreshHud, renderCalendar, get active() { return cargo.active || routeDrift.active; }, get pending() { return busy; }, invalidate: invalidated };
}
