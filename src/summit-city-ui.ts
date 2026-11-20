import * as THREE from 'three';
import { buildDutyPlan, CityDutyRun, BUS_ROUTES, BUS_SPEC, BUS_GEOMETRY, RESCUE_CASES, RESCUE_SPEC, RESCUE_GEOMETRY, DUTY_STORAGE_KEY, DUTY_ROAD_STORAGE_KEY, DUTY_IMPORT_MAX_BYTES, parseDutyRecords, exportDutyRecords, importDutyRecords, type DutyKind, type DutyRecord } from './summit-city-duty';
import { buildDutyVehicle } from './summit-duty-vehicle';
import type { FreeCar, CarSpec, FreeCarGeometry } from './freecar';
import type { Router } from './router';
import './summit-city.css';
import { appendDutyDetails, mountDutyInstruments } from './odyssey-city-ui';
import { RoadDutyTraffic } from './odyssey-city-road';
import type { CityData, Collider } from './citydata';

export function mountSummitDuty(o: { host: HTMLElement; scene: THREE.Scene; car: FreeCar; isCity: boolean; router(): Router | null; city(): CityData | null; collider(): Collider | null; controls(): { steer: number; throttle: boolean; brake: boolean }; focusDriving(): void; canEnter(): boolean; prepare(): Promise<boolean>; enter(): void; leave(): void; panel(open: boolean): void; driving(): boolean; release(): void; notify(text: string): void; drive(dt: number): number; bell?(): void }) {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const el = document.createElement(tag); el.textContent = text; return el; };
  const btn = (id: string, text: string, fn: () => void) => { const e = make('button', text); e.id = id; e.type = 'button'; e.className = 'ghost-btn'; e.onclick = fn; return e; };
  const launch = btn('btn-summit-duty', '🚌 公車勤務／平板道路救援', open); o.host.append(launch);
  const overlay = make('div'); overlay.id = 'summit-duty-overlay'; overlay.className = 'overlay hidden'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'summit-duty-title');
  const card = make('div'); card.className = 'card wide'; const title = make('h1', '城市勤務'); title.id = 'summit-duty-title';
  const description = make('p', '長軸公車：真實站序、方向靠站、開關門、準點與平順評分。道路救援：精準停靠、平板裝載、保持故障車完整並送回。皆為單人勤務，使用獨立紀錄。');
  const limitation = make('p', '封路練習隱藏車流；南城一般道路另有8輛AI車與號誌、寬鬆班表及獨立成績。兩種皆保留路層與建築碰撞、不含行人。公車11.5公尺／軸距6.1公尺，平板8公尺／軸距4.5公尺。地圖、暫停與背景分頁不扣勤務時間。');
  const info = make('p'); info.id = 'summit-duty-status'; info.setAttribute('role', 'status');
  const bus = btn('duty-start-bus', '接公車勤務', () => void start('bus')), rescue = btn('duty-start-rescue', '接道路救援', () => void start('rescue'));
  const routeSelect = make('select'); routeSelect.id = 'atlas-duty-route'; const practice = make('option', '原版封路練習（無乘客需求）'); practice.value = 'practice'; routeSelect.append(practice); for (const route of BUS_ROUTES) { const option = make('option', `${route.name} · ${route.stops.length - 1}站／32人座`); option.value = route.id; routeSelect.append(option); } const routeLabel = make('label', '公車路線'); routeLabel.append(routeSelect);
  const routeInfo = make('p'); routeInfo.id = 'atlas-duty-route-info'; const timetable = make('ol'); timetable.id = 'atlas-duty-timetable';
  const environment = make('select'); environment.id = 'odyssey-duty-environment'; for (const [value, name] of [['closed', '封路練習'], ['road', '南城一般道路挑戰（8輛車流／號誌）']]) { const option = make('option', name); option.value = value; environment.append(option); } const environmentLabel = make('label', '公車勤務環境 '); environmentLabel.append(environment);
  const accessible = make('input'); accessible.type = 'checkbox'; accessible.id = 'voyager-duty-accessible'; const accessibleLabel = make('label', '南城接駁線：下車鈴字幕與輪椅坡板服務 '); accessibleLabel.append(accessible);
  const rescueCards = make('section'); rescueCards.id = 'voyager-rescue-cases'; rescueCards.setAttribute('aria-label', '道路救援案件');
  let selectedRescue: string = RESCUE_CASES[0].id, casePreviewReady = false;
  const winchEnabled = make('input'); winchEnabled.type = 'checkbox'; winchEnabled.checked = true; winchEnabled.id = 'odyssey-duty-winch-enabled'; const winchLabel = make('label', '信安街案件：絞盤遙控裝載（需左右對準、低速收放與確認固定） '); winchLabel.append(winchEnabled);
  const caseButtons = RESCUE_CASES.map(item => { const button = btn(`voyager-rescue-${item.id}`, item.name, () => { selectedRescue = item.id; previewRoute(); render(); }); rescueCards.append(button); return { item, button }; });
  const recordsBox = make('details'), recordsTitle = make('summary', '最近30次獨立勤務紀錄'), recordsList = make('div'); recordsBox.append(recordsTitle, recordsList);
  const historyEnvironment = make('select'); historyEnvironment.id = 'odyssey-duty-history-environment'; historyEnvironment.setAttribute('aria-label', '勤務紀錄類別'); for (const [value, name] of [['closed', '封路公車／道路救援紀錄（最多30趟）'], ['road', '南城一般道路紀錄（獨立最多30趟）']]) { const option = make('option', name); option.value = value; historyEnvironment.append(option); } recordsBox.insertBefore(historyEnvironment, recordsList);
  const exportButton = btn('duty-export', '匯出目前類別紀錄', () => { const blob = new Blob([exportDutyRecords(selectedRecords())], { type: 'application/json' }), url = URL.createObjectURL(blob), a = make('a'); a.href = url; a.download = historyEnvironment.value === 'road' ? 'taipei-road-duty-records.json' : 'taipei-duty-records.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0); });
  const importInput = make('input'); importInput.type = 'file'; importInput.accept = 'application/json,.json'; importInput.id = 'duty-import'; const importLabel = make('label', '匯入並取代勤務紀錄（僅這份獨立紀錄）'); importLabel.append(importInput);
  const close = btn('duty-close', '返回', closePanel);
  card.append(title, description, limitation, info, environmentLabel, routeLabel, accessibleLabel, routeInfo, timetable, bus, make('h2', '單趟道路救援案件'), rescueCards, winchLabel, rescue, recordsBox, exportButton, importLabel, close); overlay.append(card); document.body.append(overlay);
  const hud = make('section'); hud.id = 'summit-duty-hud'; hud.hidden = true; const line = make('p'); line.id = 'duty-hud-status'; line.setAttribute('role', 'status');
  const action = btn('duty-action', '開門／裝卸', () => { o.release(); run?.action(); render(); o.focusDriving(); });
  const bellCaption = make('p'); bellCaption.id = 'voyager-bus-bell'; bellCaption.setAttribute('role', 'status'); bellCaption.setAttribute('aria-live', 'polite');
  const exit = btn('duty-exit', '結束勤務／還車', () => stop()), inspect = btn('duty-records', '勤務說明／紀錄', open); hud.append(line, bellCaption, action, inspect, exit); document.body.append(hud);
  let run: CityDutyRun | null = null, vehicle: ReturnType<typeof buildDutyVehicle> | null = null, disabledCar: THREE.Group | null = null;
  let roadTraffic: RoadDutyTraffic | null = null;
  const instruments = mountDutyInstruments(hud, () => run);
  let restore: { x: number; z: number; y: number; h: number; spec: CarSpec; geometry?: FreeCarGeometry } | null = null;
  let busy = false, generation = 0, records: DutyRecord[] = [], roadRecords: DutyRecord[] = [], writable = true, roadWritable = true, message = '', previousFocus: HTMLElement | null = null, disposed = false, recordsKey = '', hudAt = -Infinity, heardBell = 0;
  try { const raw = localStorage.getItem(DUTY_STORAGE_KEY); if (raw) { const parsed = parseDutyRecords(JSON.parse(raw)); if (parsed) records = parsed; else writable = false; } } catch { writable = false; }
  try { const raw = localStorage.getItem(DUTY_ROAD_STORAGE_KEY); if (raw) { const parsed = parseDutyRecords(JSON.parse(raw)); if (parsed && parsed.every(record => record.details?.environment === 'road')) roadRecords = parsed; else roadWritable = false; } } catch { roadWritable = false; }
  function selectedRecords() { return historyEnvironment.value === 'road' ? roadRecords : records; }
  function canWriteSelected() { return historyEnvironment.value === 'road' ? roadWritable : writable; }
  function persist(road = false) { if (road ? roadWritable : writable) try { localStorage.setItem(road ? DUTY_ROAD_STORAGE_KEY : DUTY_STORAGE_KEY, JSON.stringify(road ? roadRecords : records)); } catch { if (road) roadWritable = false; else writable = false; } }
  function render() {
    if (!casePreviewReady && o.router()) { previewCases(); casePreviewReady = true; }
    bus.disabled = rescue.disabled = busy || !!run; importInput.disabled = routeSelect.disabled = environment.disabled = busy || !!run; routeSelect.disabled ||= environment.value === 'road';
    winchEnabled.disabled = busy || !!run || selectedRescue !== 'south-assist';
    accessible.disabled = busy || !!run; caseButtons.forEach(({ button, item }) => { button.disabled = busy || !!run; button.setAttribute('aria-pressed', String(item.id === selectedRescue)); });
    info.textContent = message || (busy ? '正在準備真實城市路線…' : !canWriteSelected() ? '此類勤務紀錄格式損壞或儲存不可用：保留原資料，可先匯出本頁紀錄；明確匯入後才取代。' : '路程與估時列於下方；公車依班表服務，救援須完成警示、定位、固定與載回。一般道路進入紅燈路口每次扣8分，與封路紀錄分開。');
    const shown = selectedRecords(), key = JSON.stringify([historyEnvironment.value, shown]); if (key !== recordsKey) { recordsKey = key; recordsList.replaceChildren(); for (const r of shown) { const detail = make('details'), summary = make('summary', `${new Date(r.at).toLocaleString('zh-TW')} · ${r.name} · ${Math.round(r.seconds)}秒 · ${r.score}分 · 碰撞${r.impacts}${r.kind === 'rescue' ? ` · 完整度${Math.round(r.integrity)}%` : ''}${r.service ? ` · 服務${r.service.boarded}人／滿載候車${r.service.leftBehind}人` : ''}`); detail.append(summary); appendDutyDetails(detail, r); recordsList.append(detail); } if (!shown.length) recordsList.append(make('p', '尚無此類勤務紀錄。')); }
    instruments.render();
    if (!run) return; const r = run, target = r.leg.target;
    line.textContent = `${r.plan.name} · ${Math.floor(r.elapsed / 60)}:${String(Math.floor(r.elapsed % 60)).padStart(2, '0')}\n${r.finished ? r.message : `${r.legIndex + 1}/${r.plan.legs.length}：${target.name} · ${r.ready ? '已對準並停穩' : '沿箭頭到站／對準方向停穩'}${r.plan.kind === 'bus' ? ` · 準點目標 ${Math.round(r.due)}秒` : ` · ${r.loaded ? '已裝車' : '空載'} 完整度${Math.round(r.integrity)}%`}`}\n平順 ${Math.round(r.comfort)}分${r.plan.kind === 'bus' ? ` · 準點 ${Math.round(r.punctuality)}分` : ''}${r.plan.passengers ? ` · 車內${r.onboard}/${r.plan.passengers.capacity}人${r.stopDemand && !r.finished ? ` · 本站候車${r.stopDemand.board}人` : ''}` : ''}${!r.finished && r.message ? `\n${r.message}` : ''}`;
    bellCaption.textContent = r.bellText; bellCaption.hidden = !r.plan.accessibility;
    if (r.plan.environment === 'road') line.textContent += `\n一般道路 · AI ${roadTraffic?.traffic.count ?? 0}/8 · 紅燈${r.roadRules.redLights}次／道路分扣${r.roadRules.penalty}`;
    action.textContent = r.plan.kind === 'bus' ? !r.doorOpen ? '停穩後開門' : r.ramp === 'deploying' ? '坡板展開中…' : r.ramp === 'retracting' ? '坡板收回中…' : r.rampRequired && r.ramp === 'stowed' && r.operationTime === 0 ? '展開輪椅坡板' : r.ramp === 'deployed' ? `收回坡板（服務${Math.floor(r.operationTime)}/${Math.ceil(r.operationRequired + 6)}秒）` : `關門（${Math.floor(r.operationTime)}/${Math.ceil(r.operationRequired)}秒）` : r.phase === 'loading' ? `作業中 ${Math.floor(r.operationTime)}/${r.rescueOperationSeconds}秒` : r.loaded ? '停穩卸車／結算' : r.plan.rescue ? ({ approach: '設置事故警示', warning: '重新設置警示', positioning: '確認平台定位', winch: '確認入台位置／固定故障車', securing: '固定故障車', returning: '返回勤務站', unloading: '停穩卸車' }[r.rescueStage]) : '停穩裝載故障車'; action.disabled = r.finished || r.phase === 'loading' || r.ramp === 'deploying' || r.ramp === 'retracting';
    hud.hidden = !o.driving();
  }
  function previewRoute() {
    const router = o.router(), plan = run?.plan ?? (router ? buildDutyPlan(router, 'bus', routeSelect.value, accessible.checked, { road: environment.value === 'road' }) : null); timetable.replaceChildren();
    routeInfo.textContent = plan ? `${plan.name} · ${(plan.length / 1000).toFixed(2)}公里 · 估計${Math.ceil(plan.estimatedSeconds / 60)}分鐘${plan.passengers ? ' · 出站12人，32人容量；依乘客數決定停站時間。' : ' · 原版練習保留，不含乘客需求。'}${plan.accessibility ? ' · 每站含輪椅坡板10秒服務；下車鈴有字幕。' : ''}` : '請選擇路線；接班時會沿目前真實路網確認。乘客採人數模型，不含行人動畫或背景車流。';
    if (plan) for (const [i, leg] of plan.legs.entries()) { const demand = plan.passengers?.requests[i], access = plan.accessibility?.[i]; timetable.append(make('li', `${i + 1}. ${leg.target.name} · ${(leg.length / 1000).toFixed(2)}公里${leg.dueSeconds ? ` · 發車後${leg.dueSeconds}秒到站` : ''}${demand ? ` · 候車${demand.board}人／${i === plan.legs.length - 1 ? '全部下車' : `預定下車${demand.alight}人`}` : ''}${access ? ` · 輪椅上${access.wheelchairBoard}／下${access.wheelchairAlight}人（含於總人數）` : ''}`)); }
    if (plan?.environment === 'road') routeInfo.textContent += ' · 含號誌等待緩衝；8輛獨立AI車流，紅燈每次扣8分。';
  }
  function previewCases() { const router = o.router(); for (const { item, button } of caseButtons) { const p = router ? buildDutyPlan(router, 'rescue', item.id) : null; button.textContent = `${item.name}\n${item.difficulty}\n${p ? `真道路往返 ${(p.length / 1000).toFixed(2)}公里 · 約${Math.ceil(p.estimatedSeconds / 60)}分鐘` : '路網準備後確認路程'}\n警示→定位→固定→載回`; } }
  const originalPreviewRoute = previewRoute;
  function previewAll() { originalPreviewRoute(); previewCases(); }
  routeSelect.onchange = () => { if (routeSelect.value !== 'south') accessible.checked = false; message = ''; previewAll(); render(); };
  environment.onchange = () => { if (environment.value === 'road') routeSelect.value = 'south'; historyEnvironment.value = environment.value; message = ''; previewAll(); render(); };
  historyEnvironment.onchange = () => { message = ''; render(); };
  accessible.onchange = () => { if (accessible.checked) routeSelect.value = 'south'; previewAll(); render(); };
  function open() {
    if (!o.isCity) { location.search = '?duty=1'; return; }
    if (busy) return;
    if (!run && !o.canEnter()) { o.notify('先結束目前模式，再接城市勤務。'); return; }
    previousFocus = document.activeElement as HTMLElement; instruments.clear(); o.release(); o.panel(true); overlay.classList.remove('hidden');
    if (!run && !o.router()) {
      const token = ++generation; busy = true; message = ''; previewRoute(); render(); close.focus();
      void (async () => {
        try {
          const ready = await o.prepare();
          if (token !== generation || disposed || overlay.classList.contains('hidden')) return;
          if (!ready || !o.router()) message = '城市路網尚未就緒，請關閉後重新開啟勤務。';
          else previewRoute();
        } catch (error) { if (token === generation) message = error instanceof Error ? error.message : '無法準備勤務路線。'; }
        finally { if (token === generation) { busy = false; render(); } }
      })();
      return;
    }
    previewRoute(); render(); close.focus();
  }
  function closePanel() { if (busy) { generation++; busy = false; } overlay.classList.add('hidden'); o.release(); o.panel(false); if (run) o.focusDriving(); else previousFocus?.focus(); }
  async function start(kind: DutyKind) {
    if (busy || run || !o.canEnter()) return; busy = true; const token = ++generation; message = ''; render();
    try {
      if (!await o.prepare() || token !== generation || !o.canEnter()) return;
      const router = o.router(), plan = router && buildDutyPlan(router, kind, kind === 'bus' ? routeSelect.value : selectedRescue, kind === 'bus' && accessible.checked, { road: kind === 'bus' && environment.value === 'road', winch: kind === 'rescue' && selectedRescue === 'south-assist' && winchEnabled.checked }); if (!plan) { message = '目前城市路網沒有完整可達勤務路線。'; return; }
      const city = o.city(); if (plan.environment === 'road' && !city) { message = '城市車流資料尚未就緒，請重新接班。'; return; }
      const c = o.car; restore = { x: c.x, z: c.z, y: c.y, h: c.h, spec: c.spec, geometry: c.geometry };
      o.enter(); c.spec = kind === 'bus' ? BUS_SPEC : RESCUE_SPEC; c.geometry = kind === 'bus' ? BUS_GEOMETRY : RESCUE_GEOMETRY; c.drift = false; c.place(plan.start.x, plan.start.z, plan.start.h, plan.start.y);
      run = new CityDutyRun(plan, c); heardBell = 0; vehicle = buildDutyVehicle(kind); o.scene.add(vehicle.root, vehicle.marker);
      if (plan.environment === 'road') roadTraffic = new RoadDutyTraffic(o.scene, city!, o.collider());
      historyEnvironment.value = plan.environment ?? 'closed';
      if (kind === 'rescue') { disabledCar = new THREE.Group(); disabledCar.name = 'duty-disabled-car'; const m = new THREE.Mesh(new THREE.BoxGeometry(1.75, .8, 3.75), new THREE.MeshStandardMaterial({ color: '#a76066' })); m.position.y = .7; disabledCar.add(m); const t = plan.legs[0].target; disabledCar.position.set(t.x - Math.sin(t.h) * 1.4, t.y + .5, t.z - Math.cos(t.h) * 1.4); disabledCar.rotation.y = t.h; o.scene.add(disabledCar); }
      if (disabledCar) { const warning = new THREE.Mesh(new THREE.ConeGeometry(.55, .9, 3), new THREE.MeshBasicMaterial({ color: '#ffba55', wireframe: true })); warning.name = 'voyager-duty-warning'; warning.position.set(1.9, .1, -3); warning.visible = false; disabledCar.add(warning); }
      overlay.classList.add('hidden'); o.panel(false); instruments.clear(); o.focusDriving(); message = `${plan.name} · ${(plan.length / 1000).toFixed(2)}公里，估計${Math.ceil(plan.estimatedSeconds / 60)}分鐘。`; o.notify(message);
    } catch (e) { message = e instanceof Error ? e.message : '無法準備勤務'; stop(); }
    finally { if (token === generation) busy = false; render(); }
  }
  function stop() { generation++; busy = false; instruments.clear(); roadTraffic?.dispose(); roadTraffic = null; if (run || restore) { run = null; if (restore) { const c = o.car, p = restore; c.spec = p.spec; c.geometry = p.geometry; c.drift = false; c.place(p.x, p.z, p.h, p.y); restore = null; } vehicle?.dispose(); vehicle = null; if (disabledCar) { disabledCar.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose(); } }); disabledCar.removeFromParent(); disabledCar = null; } o.release(); o.leave(); } hud.hidden = true; render(); }
  importInput.onchange = async () => { const file = importInput.files?.[0]; if (!file || run || busy) return; if (file.size > DUTY_IMPORT_MAX_BYTES) { message = '檔案超過1MB，未改動任何紀錄。'; render(); return; } const token = generation, category = historyEnvironment.value, text = await file.text(); if (token !== generation || run || busy || category !== historyEnvironment.value) return; const parsed = importDutyRecords(text), road = category === 'road'; if (!parsed || !parsed.every(record => (record.details?.environment === 'road') === road)) message = '勤務備份格式或紀錄類別無效，原紀錄完整保留。'; else { if (road) { roadRecords = parsed; roadWritable = true; } else { records = parsed; writable = true; } persist(road); message = '已匯入此類勤務紀錄，其他紀錄與單人存檔未變更。'; } importInput.value = ''; render(); };
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); } else if (e.key === 'Tab') { const items = [...card.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')].filter(el => el.getClientRects().length), first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } });
  render();
  return { get active() { return !!run; }, get busy() { return busy; }, get opened() { return !overlay.classList.contains('hidden'); }, get run() { return run; }, get kind() { return run?.plan.kind; }, get roadTraffic() { return roadTraffic; }, get roadActive() { return !!run && run.plan.environment === 'road'; }, open, close() { if (overlay.classList.contains('hidden')) return false; closePanel(); return true; }, stop, invalidate() { run?.fail('已重設車輛，本次勤務不計成績。'); render(); },
    navInfo() { return run && !run.finished ? { path: run.leg.path, ys: run.leg.ys, next: [run.next.x, run.next.z] as [number, number] } : null; },
    step(dt: number) { if (!run || disposed) return; const c = o.car; let impact = 0; if (run.locked) c.vx = c.vz = c.w = 0; else impact = o.drive(dt); if (run.rescueStage === 'winch') { const held = instruments.read(), control = o.controls(); run.operateWinch(dt, Math.max(-1, Math.min(1, held.pull || (control.throttle ? 1 : 0) - (control.brake ? 1 : 0))), Math.max(-1, Math.min(1, held.side || control.steer))); } if (roadTraffic && !run.finished) { impact = Math.max(impact, roadTraffic.step(dt, c)); run.roadSample(roadTraffic.signal(c)); } run.update(dt, impact); const warning = disabledCar?.getObjectByName('voyager-duty-warning'); if (warning) warning.visible = !!run.plan.rescue && !['approach', 'warning'].includes(run.rescueStage); if (run.bellSequence > heardBell) { heardBell = run.bellSequence; o.bell?.(); } const result = run.result(); if (result) { const road = result.details?.environment === 'road'; if (road) { roadRecords.unshift(result); roadRecords = roadRecords.slice(0, 30); } else { records.unshift(result); records = records.slice(0, 30); } persist(road); o.notify(`勤務完成 · ${result.score}分 · ${Math.round(result.seconds)}秒`); } },
    frame(dt: number) { if (!run || !vehicle || disposed) return; const c = o.car; vehicle.root.visible = o.driving(); vehicle.root.position.set(c.x, c.y, c.z); vehicle.root.rotation.set(-c.pitch, c.h, c.roll, 'YXZ'); vehicle.frame(dt, c.v, c.steer, run.doorOpen, run.ramp !== 'stowed'); vehicle.load.visible = run.loaded; const t = run.leg.target; vehicle.marker.visible = o.driving() && !run.finished; vehicle.marker.position.set(t.x, t.y + 3.2, t.z); vehicle.marker.rotation.y = t.h; if (disabledCar) { disabledCar.visible = o.driving() && !run.loaded && !run.finished; if (run.winch) { const along = -6 + run.winch.along, side = run.winch.lateral; disabledCar.position.set(c.x + Math.sin(c.h) * along + Math.cos(c.h) * side, c.y + .5 + run.winch.along / run.winch.length * .5, c.z + Math.cos(c.h) * along - Math.sin(c.h) * side); disabledCar.rotation.y = c.h; } } roadTraffic?.frame(dt, o.driving()); hud.hidden = !o.driving(); const now = performance.now(); if (now - hudAt >= 150) { hudAt = now; render(); } },
    dispose() { stop(); disposed = true; instruments.dispose(); overlay.remove(); hud.remove(); launch.remove(); },
  };
}
