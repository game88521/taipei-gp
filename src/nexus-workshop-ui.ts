import * as THREE from 'three';
import { BigMap } from './bigmap';
import type { CityData, RoadNet } from './citydata';
import type { Landmark } from './decor';
import type { FreeCar } from './freecar';
import { ROAD_Y } from './surface';
import { WORKSHOP_CARS, WORKSHOP_WEATHER, WORKSHOP_VERSION, WORKSHOP_VERSION_2, WorkshopHistory, workshopClosed, WorkshopRoads, WorkshopRun, WorkshopLibrary, encodeWorkshop, decodeWorkshop, parseWorkshop, workshopInvite, workshopFromUrl, type WorkshopDefinition, type WorkshopRoute, type WorkshopCar, type WorkshopWeather, type WorkshopPoint } from './nexus-workshop';
import './nexus-workshop.css';
import './odyssey-workshop.css';
import { WorkshopGhostLibrary, WorkshopGhostRecorder, parseWorkshopGhost, ghostCompatible, workshopGhostAt, WORKSHOP_GHOST_FILE_MAX_BYTES, type WorkshopGhost } from './voyager-workshop-ghost';

interface WorkshopHooks {
  isCity: boolean;
  scene: THREE.Scene; car: FreeCar;
  prepare(): Promise<boolean>; city(): CityData | null; roads(): RoadNet | null; landmarks(): Landmark[];
  canEnter(): boolean; pause(): void; release(): void; notify(text: string): void;
  enter(definition: WorkshopDefinition, route: WorkshopRoute): void; leave(): void;
  drive(dt: number, definition: WorkshopDefinition): number;
  weather(): string; setWeather(value: WorkshopWeather | string): void;
  visible(): boolean; vmax(id: WorkshopCar): number;
  hints(): string;
  suggestions(): { name: string; path: [number, number][] }[];
  online?(definition: WorkshopDefinition): void;
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', id = '') => { const e = document.createElement(tag); if (text) e.textContent = text; if (id) e.id = id; return e; };
const button = (text: string, id = '') => { const e = node('button', text, id); e.type = 'button'; return e; };
const show = (e: HTMLElement, value: string) => { if (e.textContent !== value) e.textContent = value; };
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const names: Record<WorkshopCar, string> = { sedan: '白色轎車', taxi: '小黃', muscle: '紫電 GT', f1: '街道方程式', super: '雷霆 V12', police: '巡邏車', pickup: '發財車' };
const weatherNames: Record<WorkshopWeather, string> = { day: '白天', dusk: '黃昏', night: '夜晚', rain: '雨天', rainnight: '雨夜' };

export function mountNexusWorkshop(h: WorkshopHooks) {
  let storage: Storage | null = null; try { storage = localStorage; } catch { /* Memory-only library remains usable. */ }
  const library = new WorkshopLibrary(storage);
  const ghosts = new WorkshopGhostLibrary(storage);
  let ghostRecorder: WorkshopGhostRecorder | null = null, comparisonGhost: WorkshopGhost | null = null, friendGhost: WorkshopGhost | null = null, ghostVisual: THREE.Group | null = null;
  let book: WorkshopRoads | null = null, map: BigMap | null = null, mapRaf = 0, pending = 0, opening = false, open = false, previousFocus: HTMLElement | null = null;
  let anchors: number[] = [], currentRoute: WorkshopRoute | null = null, routeError = '', run: WorkshopRun | null = null, recorded = false;
  let restore: { point: WorkshopPoint & { h: number }; weather: string } | null = null;
  const launch = button('🛠 城市挑戰工坊：自訂賽道／分享挑戰', 'btn-nexus-workshop'); launch.className = 'ghost-btn';
  document.querySelector('.m-pane[data-pane="play"] .m-modes')?.after(launch);
  const overlay = node('section', '', 'nexus-workshop-page'); overlay.className = 'nexus-workshop-overlay'; overlay.hidden = true; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'nexus-workshop-title');
  const card = node('div'); card.className = 'nexus-workshop-card'; const header = node('header'); const title = node('h1', '城市挑戰工坊', 'nexus-workshop-title'); const close = button('關閉工坊', 'nexus-workshop-close'); header.append(title, close);
  const intro = node('p', '選起點、途經點和終點，沿現有道路建立挑戰。分享碼只包含路線與比賽條件；朋友匯入確認後才會起跑。');
  const status = node('p', '', 'nexus-workshop-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const columns = node('div'); columns.className = 'nexus-workshop-columns';
  const mapBox = node('div'); mapBox.className = 'nexus-workshop-map-box';
  const mapTools = node('div'); mapTools.className = 'nexus-workshop-actions';
  const zoomIn = button('放大', 'nexus-map-in'), zoomOut = button('縮小', 'nexus-map-out'), zoomAll = button('全圖', 'nexus-map-all'), nearby = button('目前位置', 'nexus-map-near');
  const layer = node('select', '', 'nexus-workshop-layer'); layer.setAttribute('aria-label', '選點路層'); for (const [value, text] of [['ground', '地面道路'], ['deck', '高架／隧道'], ['all', '所有路層']]) { const e = node('option', text); e.value = value; layer.append(e); }
  mapTools.append(zoomIn, zoomOut, zoomAll, nearby, layer);
  const canvas = node('canvas', '', 'nexus-workshop-map'); canvas.setAttribute('aria-label', '城市路線編輯地圖。點選新增路線點；也可使用右側地標選單與調整按鈕'); canvas.tabIndex = 0;
  const mapHelp = node('p', '點地圖依序新增路線點；拖曳平移，滾輪／雙指縮放。起點綠色、終點橘色，箭頭代表行進方向。最多 12 點、總長 100 公尺至 20 公里。'); mapHelp.className = 'sub'; mapBox.append(mapTools, canvas, mapHelp);
  const settings = node('div'); settings.className = 'nexus-workshop-settings';
  const label = <T extends HTMLElement>(text: string, input: T) => { const el = node('label', text); el.append(input); return el; };
  const routeName = node('input', '', 'nexus-workshop-name'); routeName.maxLength = 36; routeName.value = '我的城市挑戰';
  const car = node('select', '', 'nexus-workshop-car'); for (const id of WORKSHOP_CARS) { const e = node('option', names[id]); e.value = id; car.append(e); }
  const weather = node('select', '', 'nexus-workshop-weather'); for (const id of WORKSHOP_WEATHER) { const e = node('option', weatherNames[id]); e.value = id; weather.append(e); }
  const seconds = node('input', '', 'nexus-workshop-seconds'); seconds.type = 'number'; seconds.min = '15'; seconds.max = '1800'; seconds.step = '1'; seconds.value = '120';
  const hits = node('input', '', 'nexus-workshop-hits'); hits.type = 'number'; hits.min = '0'; hits.max = '20'; hits.step = '1'; hits.value = '3';
  const format = node('select', '', 'atlas-workshop-format'); for (const [value, text] of [['1', 'NG1 原版挑戰'], ['2', 'NG2 多圈／分段計時（單人／連線）']]) { const option = node('option', text); option.value = value; format.append(option); }
  const laps = node('select', '', 'atlas-workshop-laps'); for (const count of [1, 3, 5]) { const option = node('option', `${count}圈`); option.value = String(count); laps.append(option); }
  const sections = node('select', '', 'atlas-workshop-sections'); for (const count of [1, 2, 3]) { const option = node('option', `${count}段`); option.value = String(count); sections.append(option); } sections.value = '3';
  const search = node('input', '', 'nexus-workshop-search'); search.type = 'search'; search.placeholder = '搜尋地標或道路';
  const places = node('select', '', 'nexus-workshop-places'); places.setAttribute('aria-label', '可選地標或道路節點');
  const addPlace = button('加入選取地點', 'nexus-workshop-add-place'), addHere = button('加入目前位置', 'nexus-workshop-add-here'), undo = button('復原', 'nexus-workshop-undo'), redo = button('重做', 'nexus-workshop-redo'), closeLoop = button('沿道路接回起點', 'nexus-workshop-loop'), clear = button('清除路線', 'nexus-workshop-clear');
  type Edit = { nodes: number[]; name: string; car: string; weather: string; seconds: string; hits: string; format: string; laps: string; sections: string; splits: number[] | null };
  const history = new WorkshopHistory<Edit>();
  const snapshot = (): Edit => ({ nodes: [...anchors], name: routeName.value, car: car.value, weather: weather.value, seconds: seconds.value, hits: hits.value, format: format.value, laps: laps.value, sections: sections.value, splits: importedSplits && [...importedSplits] });
  let importedSplits: number[] | null = null, importedNodes = '';
  const restoreEdit = (edit: Edit | null) => { if (!edit) return; anchors = [...edit.nodes]; routeName.value = edit.name; car.value = edit.car; weather.value = edit.weather; seconds.value = edit.seconds; hits.value = edit.hits; format.value = edit.format; laps.value = edit.laps; sections.value = edit.sections; importedSplits = edit.splits && [...edit.splits]; importedNodes = JSON.stringify(anchors); refreshRoute(false); };
  history.record(snapshot());
  const routeList = node('ol', '', 'nexus-workshop-points');
  const summary = node('p', '', 'nexus-workshop-summary');
  const splitMode=node('select','','odyssey-workshop-split-mode'),splitOne=node('select','','odyssey-workshop-s1'),splitTwo=node('select','','odyssey-workshop-s2'),splitFields=node('div','','odyssey-workshop-splits');for(const[value,text]of [['auto','等距分段'],['manual','手動選擇S1／S2']]){const option=node('option',text);option.value=value;splitMode.append(option);}splitFields.append(label('分段配置',splitMode),label('S1檢查點／距離',splitOne),label('S2檢查點／距離',splitTwo));
  const routeTools = node('div'); routeTools.className = 'nexus-workshop-actions'; routeTools.append(addHere, undo, redo, closeLoop, clear);
  const example = node('select', '', 'nexus-workshop-example'); example.setAttribute('aria-label', '載入範例路線'); const exampleLoad = button('載入範例', 'nexus-workshop-load-example');
  settings.append(label('挑戰名稱', routeName), label('車款', car), label('時段與天氣', weather), label('挑戰格式', format), label('圈數（多圈須先閉合路線）', laps), label('計時分段（沿真道路等距配置）', sections), label('全場目標秒數（15～1800）', seconds), label('最多碰撞次數（0～20）', hits), label('地標／道路搜尋', search), places, addPlace, routeTools, example, exampleLoad, routeList, summary);
  settings.append(splitFields);columns.append(mapBox, settings);
  const actions = node('div'); actions.className = 'nexus-workshop-actions';
  const start = button('開始挑戰', 'nexus-workshop-start'), saveDraft = button('儲存草稿', 'nexus-workshop-save'), share = button('產生分享碼', 'nexus-workshop-share'), online = button('連線競速 · 2～4人', 'nexus-workshop-online'); start.className = 'primary'; actions.append(start, saveDraft, share, online); online.hidden = !h.online;
  const shareBox = node('textarea', '', 'nexus-workshop-code'); shareBox.rows = 3; shareBox.maxLength = 4096; shareBox.setAttribute('aria-label', '挑戰分享碼'); shareBox.placeholder = '貼上 NG1／NG2 分享碼，再按匯入；匯入不會自動開始。';
  const shareTools = node('div'); shareTools.className = 'nexus-workshop-actions'; const importButton = button('匯入挑戰', 'nexus-workshop-import'), copy = button('複製分享碼', 'nexus-workshop-copy'), copyLink = button('複製邀請連結', 'nexus-workshop-copy-link'); shareTools.append(importButton, copy, copyLink);
  const draftLabel = node('h2', '本機草稿與獨立成績'); const draftList = node('div', '', 'nexus-workshop-drafts');
  const note = node('p', '挑戰採封路計時，暫停時不扣時，雨天抓地力較低。必須依序通過所有檢查點；扶正／重置不計成績。工坊紀錄與一般最快圈、獎金及成就分開。'); note.className = 'sub';
  const ghostPanel = node('fieldset', '', 'voyager-workshop-ghost'), ghostLegend = node('legend', '工坊最佳幽靈與朋友比較'), ghostEnabled = node('input', '', 'voyager-ghost-enabled'), ghostSource = node('select', '', 'voyager-ghost-source'), ghostInfo = node('p', '', 'voyager-ghost-status'); ghostEnabled.type = 'checkbox'; ghostEnabled.checked = ghosts.enabled; ghostInfo.setAttribute('role', 'status');
  for (const [value, text] of [['best', '自己的最佳有效成績'], ['friend', '本頁匯入的朋友幽靈']]) { const option = node('option', text); option.value = value; ghostSource.append(option); }
  const ghostExport = button('下載目前路線最佳幽靈', 'voyager-ghost-export'), ghostRemove = button('刪除目前路線幽靈', 'voyager-ghost-remove'), ghostImport = node('input', '', 'voyager-ghost-import'), ghostApply = button('載入朋友路線設定', 'voyager-ghost-apply'); ghostImport.type = 'file'; ghostImport.accept = '.json,application/json';
  ghostPanel.append(ghostLegend, label('顯示幽靈（半透明，無碰撞）', ghostEnabled), label('比較來源', ghostSource), ghostInfo, node('p', '每條完整挑戰碼保留一條最佳有效軌跡，5Hz、最長5分鐘；最多12條。超時不截斷當成完整成績。朋友軌跡只在本頁，匯入不會開始挑戰或改寫自己的最佳。'), ghostExport, ghostRemove, label('匯入朋友幽靈 JSON（250KB內）', ghostImport), ghostApply);
  const ghostLibraryDetails = node('details'), ghostLibraryList = node('div'); ghostLibraryDetails.append(node('summary', '管理已保存的路線幽靈'), ghostLibraryList); ghostPanel.append(ghostLibraryDetails);
  card.append(header, intro, status, columns, note, actions, shareBox, shareTools, ghostPanel, draftLabel, draftList); overlay.append(card); document.body.append(overlay);
  const hud = node('section', '', 'nexus-workshop-hud'); hud.hidden = true; const hudTitle = node('b'), hudStatus = node('p', '', 'nexus-workshop-progress'), hudHelp = node('small');
  const hudActions = node('div'); hudActions.className = 'nexus-workshop-actions'; const retry = button('重新挑戰', 'nexus-workshop-retry'), exit = button('離開挑戰', 'nexus-workshop-exit'), ghostToggle = button('隱藏幽靈', 'voyager-ghost-toggle'); hudActions.append(retry, exit, ghostToggle); const lapDetails = node('details', '', 'atlas-workshop-times'), lapTable = node('ol', '', 'atlas-workshop-lap-times'); lapDetails.append(node('summary', '逐圈與分段成績'), lapTable); hud.append(hudTitle, hudStatus, lapDetails, hudHelp, hudActions); document.body.append(hud);
  const marker = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(6.5, 7, 32), beamGeo = new THREE.CylinderGeometry(.3, .3, 9, 8);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#51ffae', side: THREE.DoubleSide, depthWrite: false }), beamMat = new THREE.MeshBasicMaterial({ color: '#51ffae', transparent: true, opacity: .65, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat), beam = new THREE.Mesh(beamGeo, beamMat); ring.rotation.x = -Math.PI / 2; beam.position.y = 4.5; marker.add(ring, beam); marker.visible = false; h.scene.add(marker);
  function message(text: string) { show(status, text); }
  function refreshGhosts() { const def = definition(), own = def && ghosts.get(def); ghostEnabled.checked = ghosts.enabled; ghostExport.disabled = ghostRemove.disabled = !own || !!run; ghostImport.disabled = ghostSource.disabled = !!run; ghostApply.disabled = !friendGhost || !!run; ghostInfo.textContent = ghosts.error || `${own ? `個人最佳幽靈 ${(own.durationMs / 1000).toFixed(3)}秒` : '目前路線尚無5分鐘內的最佳有效幽靈'} · 已存${ghosts.count}/12條${friendGhost ? def && ghostCompatible(friendGhost, def) ? ' · 朋友軌跡相容' : ' · 朋友路線／車款／天候或規則不同，不顯示；可先載入朋友路線設定' : ''}`; ghostLibraryList.replaceChildren(); for (const item of ghosts.list()) { const d = decodeWorkshop(item.code), row = node('p', `${d.name} · ${names[d.car]} · ${(item.durationMs / 1000).toFixed(3)}秒 `), remove = button('刪除這條幽靈'); remove.disabled = !!run; remove.onclick = () => { if (confirm(`刪除「${d.name}」的幽靈？獨立成績保留。`)) { ghosts.forget(d); refreshGhosts(); } }; row.append(remove); ghostLibraryList.append(row); } }
  function clearGhostVisual() { if (!ghostVisual) return; ghostVisual.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } }); ghostVisual.removeFromParent(); ghostVisual = null; }
  function buildGhostVisual(id: WorkshopCar) { clearGhostVisual(); const group = new THREE.Group(); group.name = 'voyager-workshop-ghost-car'; group.userData.nonColliding = true; const material = new THREE.MeshBasicMaterial({ color: ghostSource.value === 'friend' ? '#ffcd86' : '#78e7ff', transparent: true, opacity: .32, depthWrite: false }); const add = (w: number, ht: number, l: number, y: number, z = 0) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, ht, l), material.clone()); mesh.position.set(0, y, z); group.add(mesh); }; add(id === 'f1' ? 1.9 : 1.8, .45, id === 'pickup' ? 5.2 : 4.5, .55); add(id === 'f1' ? .65 : 1.45, id === 'f1' ? .35 : .65, id === 'pickup' ? 1.5 : 1.9, 1.05, id === 'pickup' ? .9 : -.1); material.dispose(); group.visible = false; ghostVisual = group; h.scene.add(group); }
  function updateGhost() { const r = run, pose = r && comparisonGhost && ghosts.enabled && h.visible() && r.phase === 'running' ? workshopGhostAt(comparisonGhost, r.elapsed) : null; if (ghostVisual) { ghostVisual.visible = !!pose; if (pose) { ghostVisual.position.set(pose.x, pose.y + .05, pose.z); ghostVisual.rotation.y = pose.h; } } ghostToggle.textContent = ghosts.enabled ? '隱藏幽靈' : '顯示幽靈'; ghostToggle.setAttribute('aria-pressed', String(ghosts.enabled)); ghostToggle.disabled = !comparisonGhost; }
  function definition() { const base = { map: book?.stamp ?? '', name: routeName.value.trim(), nodes: anchors, car: car.value, weather: weather.value, seconds: Number(seconds.value), hits: Number(hits.value) }; const splits = importedSplits ?? Array.from({ length: Number(sections.value) - 1 }, (_, i) => Math.floor((currentRoute?.gates.length ?? 0) * (i + 1) / Number(sections.value))); return parseWorkshop(format.value === '2' ? { v: 2, physics: WORKSHOP_VERSION_2, ...base, laps: Number(laps.value), splits } : { v: 1, physics: WORKSHOP_VERSION, ...base }); }
  function refreshRoute(record = true) {
    if (importedNodes !== JSON.stringify(anchors)) { importedSplits = null; importedNodes = JSON.stringify(anchors); }
    const closed = workshopClosed(anchors); if (!closed) laps.value = '1'; laps.disabled = format.value !== '2' || !closed; sections.disabled = format.value !== '2'||importedSplits!==null; for (const option of laps.options) option.disabled = option.value !== '1' && !closed;
    if (record) history.record(snapshot()); undo.disabled = !history.canUndo; redo.disabled = !history.canRedo; closeLoop.disabled = anchors.length < 2 || anchors.length >= 12 || closed;
    currentRoute = null; routeError = '';
    try { if (book && anchors.length > 1) currentRoute = book.route(anchors); } catch (e) { routeError = (e as Error).message; }
    splitMode.value=importedSplits===null?'auto':'manual';splitFields.hidden=format.value!=='2';splitMode.disabled=!currentRoute;for(const [select,index]of [[splitOne,0],[splitTwo,1]]as const){select.replaceChildren();const empty=node('option',index===0?'不設定S1':'不設定S2');empty.value='';select.append(empty);let count=currentRoute?.gates.length??0;if(currentRoute&&count>1){const last=currentRoute.gates[count-1],before=currentRoute.gates[count-2];if(Math.hypot(last.x-before.x,last.z-before.z,last.y-before.y)<.001)count--;}for(let n=1;n<count;n++){const option=node('option',`檢查點${n} · ${n*30}公尺`);option.value=String(n);if(index===1&&n<=(importedSplits?.[0]??0))option.disabled=true;select.append(option);}select.value=String(importedSplits?.[index]??'');select.disabled=importedSplits===null||!currentRoute||index===1&&!importedSplits?.length;}
    const def = definition(); start.disabled = saveDraft.disabled = share.disabled = !currentRoute || !def || !!run; online.disabled = start.disabled || (def?.v === 2 && !closed); online.title = def?.v === 2 ? closed ? '以此閉合路線建立 NG2 多圈連線房。' : 'NG2連線需要閉合路線；請先接回起點。' : '';
    show(summary, routeError || (currentRoute ? `路線 ${(currentRoute.length / 1000).toFixed(2)} 公里 · ${currentRoute.gates.length} 個順序檢查點${def && library.best(def) ? ` · 個人最佳 ${fmt(library.best(def)!.best)}` : ''}` : '請新增至少兩個路線點。'));
    if (currentRoute) summary.append(document.createTextNode(`${workshopClosed(anchors) ? ' · 閉合路線（已沿單行路網接回起點）' : ' · 起終點不同'} · 路層提示：高架／隧道須循匝道換層；平面交疊不表示相通，檢查點須同層通過。`));
    if (def?.v === 2) summary.append(document.createTextNode(` · NG2 ${def.laps}圈／每圈${def.splits.length + 1}段${closed ? ' · 可單人或連線競速' : ' · 連線須先閉合路線'} · 全場${((currentRoute?.length ?? 0) * def.laps / 1000).toFixed(2)}公里 · 成績依圈數及分段規則獨立。`));
    if(format.value==='2'&&importedSplits!==null)summary.append(document.createTextNode(importedSplits.length?` · 手動分段：${importedSplits.map((n,i)=>`S${i+1} ${n*30}公尺`).join('／')}。${!def?'請讓S2位於S1之後，並位於終點之前。':''}`:' · 手動模式未選分段，整圈只計一段。'));
    routeList.replaceChildren(); anchors.forEach((id, i) => { const p = book!.nodes.get(id)!; const row = node('li'); row.append(node('span', `${i === 0 ? '起點' : i === anchors.length - 1 ? '終點' : `途經 ${i}`}：${p.name}（${p.elevated ? '高架／隧道' : '地面'}，${p.y.toFixed(1)}m）`));
      for (const [text, delta] of [['上移', -1], ['下移', 1]] as const) { const b = button(text); b.setAttribute('aria-label', `第 ${i + 1} 點${text}`); b.disabled = i + delta < 0 || i + delta >= anchors.length; b.onclick = () => { [anchors[i], anchors[i + delta]] = [anchors[i + delta], anchors[i]]; refreshRoute(); }; row.append(b); }
      const remove = button('移除'); remove.setAttribute('aria-label', `移除第 ${i + 1} 點`); remove.onclick = () => { anchors.splice(i, 1); refreshRoute(); }; row.append(remove); routeList.append(row); });
    refreshGhosts();
  }
  function apply(def: WorkshopDefinition) { if (!book) return; book.validate(def); anchors = [...def.nodes]; routeName.value = def.name; car.value = def.car; weather.value = def.weather; seconds.value = String(def.seconds); hits.value = String(def.hits); format.value = String(def.v); laps.value = String(def.v === 2 ? def.laps : 1); sections.value = String(def.v === 2 ? def.splits.length + 1 : 3); importedSplits = def.v === 2 ? [...def.splits] : null; importedNodes = JSON.stringify(anchors); refreshRoute(); message(`已載入「${def.name}」。請確認路線與條件，再按開始挑戰。`); }
  function addPoint(x: number, z: number) { if (!book) return; if (anchors.length >= 12) { message('最多 12 個路線點；可先移除不需要的點。'); return; } const hit = book.nearest(x, z, layer.value as 'ground' | 'deck' | 'all', 100); if (!hit) { message('附近找不到所選路層的主要道路，請放大地圖再選。'); return; } if (anchors.at(-1) === hit.id) { message('已經選取這個路線點。'); return; } anchors.push(hit.id); refreshRoute(); message(`已加入第 ${anchors.length} 點：${hit.point.name}`); }
  function renderPlaces() { if (!book) return; const query = search.value.trim().normalize('NFKC').toLocaleLowerCase(); places.replaceChildren(); const rows = h.landmarks().filter(l => !query || l.nm.normalize('NFKC').toLocaleLowerCase().includes(query)).slice(0, 100); const ids = new Set<number>();
    for (const l of rows) { const p = book.nearest(l.x, l.z, layer.value as 'ground' | 'deck' | 'all', 180); if (!p || ids.has(p.id)) continue; ids.add(p.id); const option = node('option', `${l.nm}附近 · ${p.point.name}`); option.value = String(p.id); places.append(option); }
    if (query) for (const [id, p] of book.nodes) { if (places.length >= 150) break; if (ids.has(id) || !p.name.normalize('NFKC').toLocaleLowerCase().includes(query) || (layer.value === 'ground' && p.elevated || layer.value === 'deck' && !p.elevated)) continue; ids.add(id); const option = node('option', `${p.name} · ${Math.round(p.x)}, ${Math.round(p.z)} · ${p.y.toFixed(1)}m`); option.value = String(id); places.append(option); }
    addPlace.disabled = !places.length;
  }
  function renderDrafts() { draftList.replaceChildren(); if (!library.drafts.length) draftList.append(node('p', '還沒有草稿。儲存後可在這裡重玩；最多保留最近 24 份。'));
    library.drafts.forEach((d, i) => { const row = node('div'); row.className = 'nexus-workshop-draft'; const best = library.best(d); const load = button(`${d.name} · ${names[d.car]}${best ? ` · 最佳 ${fmt(best.best)}／成功 ${best.wins} 次` : ''}`); load.disabled = d.map !== book?.stamp; load.onclick = () => { try { apply(d); } catch (e) { message((e as Error).message); } }; const remove = button('刪除'); remove.setAttribute('aria-label', `刪除草稿 ${d.name}`); remove.onclick = () => { library.remove(i); renderDrafts(); message(library.error || '草稿已刪除。'); }; const duplicate = button('複製草稿'); duplicate.setAttribute('aria-label', `複製草稿 ${d.name}`); duplicate.onclick = () => { try { const copied = library.duplicate(i); apply(copied); renderDrafts(); message(library.error || '已建立獨立副本；原草稿與原成績保留。'); } catch (e) { message((e as Error).message); } }; row.append(load, duplicate, remove); if (load.disabled) row.append(node('small', '地圖版本已不同，請重新建立路線')); draftList.append(row); }); }
  function drawMap() { if (!open || !map) return; const p = h.car; map.draw(p.x, p.z, p.h, null, currentRoute?.path ?? null); const g = canvas.getContext('2d')!;
    if(currentRoute&&format.value==='2')for(const[n,index]of (definition()?.v===2?(definition() as Extract<WorkshopDefinition,{v:2}>).splits:[]).map((n,i)=>[n,i]as const)){const gate=currentRoute.gates[n-1];if(!gate)continue;const x=canvas.width/2+(gate.x-map.cx)*map.zoom,y=canvas.height/2+(gate.z-map.cz)*map.zoom;g.fillStyle='#ff79db';g.beginPath();g.arc(x,y,12,0,Math.PI*2);g.fill();g.fillStyle='#07111d';g.font='bold 12px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(`S${index+1}`,x,y);}
    anchors.forEach((id, i) => { const p = book!.nodes.get(id)!; const x = canvas.width / 2 + (p.x - map!.cx) * map!.zoom, y = canvas.height / 2 + (p.z - map!.cz) * map!.zoom; g.fillStyle = i === 0 ? '#51ffae' : i === anchors.length - 1 ? '#ffad62' : '#8bdcff'; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill(); g.fillStyle = '#09131c'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y); });
    if (currentRoute) { const path = currentRoute.path; g.strokeStyle = '#d2fcff'; g.lineWidth = 2; for (let i = 6; i + 1 < path.length; i += Math.max(8, Math.floor(path.length / 16))) { const a = path[i], b = path[i + 1], angle = Math.atan2(b[1] - a[1], b[0] - a[0]), x = canvas.width / 2 + (a[0] - map.cx) * map.zoom, y = canvas.height / 2 + (a[1] - map.cz) * map.zoom; g.beginPath(); g.moveTo(x - Math.cos(angle - .6) * 8, y - Math.sin(angle - .6) * 8); g.lineTo(x, y); g.lineTo(x - Math.cos(angle + .6) * 8, y - Math.sin(angle + .6) * 8); g.stroke(); } }
    mapRaf = requestAnimationFrame(drawMap);
  }
  function closeEditor() { if (!open && !opening) return false; pending++; opening = false; open = false; overlay.hidden = true; cancelAnimationFrame(mapRaf); h.release(); previousFocus?.focus(); return true; }
  async function openEditor() {
    if (opening || open) return; if (!h.canEnter() || run) { h.notify('請先完成或離開目前的任務，再開啟城市挑戰工坊。'); return; }
    const token = ++pending; opening = true; launch.disabled = true;
    try { if (!await h.prepare() || pending !== token || !h.canEnter()) return; const data = h.city(), net = h.roads(); if (!data || !net) throw Error('城市路網尚未就緒，請稍後再試'); if (!book) book = new WorkshopRoads(data);
      previousFocus = document.activeElement as HTMLElement; h.pause(); h.release(); overlay.hidden = false; open = true;
      if (!map) { map = new BigMap(canvas, net, h.landmarks()); map.onPick = addPoint; }
      map.showAll(); renderPlaces(); example.replaceChildren(); h.suggestions().forEach((r, i) => { const e = node('option', r.name); e.value = String(i); example.append(e); });
      refreshRoute(); renderDrafts(); message(library.error || '先載入範例，或在地圖點選起終點；也可貼上朋友的分享碼。');
      try { const shared = workshopFromUrl(location.href); if (shared) { apply(shared); shareBox.value = encodeWorkshop(shared); } } catch (e) { message((e as Error).message); }
      close.focus(); drawMap();
    } catch (e) { h.notify((e as Error).message); } finally { if (token === pending) { opening = false; launch.disabled = false; } else launch.disabled = false; }
  }
  async function startRun() {
    if (run || !book || !h.canEnter()) { message('請先離開目前任務。'); return; } const def = definition(); if (!def) { message('請檢查名稱、車款、天氣與整數目標範圍。'); return; }
    try { const route = book.validate(def); restore = { point: { x: h.car.x, z: h.car.z, y: h.car.y, h: h.car.h }, weather: h.weather() }; h.enter(def, route); h.setWeather(def.weather); h.car.place(route.start.x, route.start.z, route.start.h, route.start.y + ROAD_Y); h.car.spec = { ...h.car.spec }; run = new WorkshopRun(def, route, h.car, h.vmax(def.car), library.best(def)?.segments); ghostRecorder = new WorkshopGhostRecorder(def, h.car); comparisonGhost = ghostSource.value === 'friend' ? friendGhost && ghostCompatible(friendGhost, def) ? friendGhost : null : ghosts.get(def); if (comparisonGhost) buildGhostVisual(def.car); else clearGhostVisual(); recorded = false; closeEditor(); hud.hidden = false; updateHud(); }
    catch (e) {
      run = null; ghostRecorder = null; comparisonGhost = null; clearGhostVisual(); marker.visible = false; hud.hidden = true;
      if (restore) { const original = restore; restore = null; try { h.car.place(original.point.x, original.point.z, original.point.h, original.point.y); h.setWeather(original.weather); } finally { h.leave(); h.pause(); } }
      message((e as Error).message);
    }
  }
  function updateHud() { const r = run; if (!r) { hud.hidden = true; marker.visible = false; return; } hud.hidden = !h.visible(); show(hudTitle, r.definition.name); show(hudHelp, `${h.hints()} · 可用遊戲暫停選單暫停`);
    updateGhost();
    show(hudStatus, r.result ? `${r.result.success ? '挑戰成功' : '挑戰結束'} · ${fmt(r.elapsed)} · 碰撞 ${r.hits}/${r.definition.hits} · ${r.result.reason}${r.result.success && library.best(r.definition) ? ` · 最佳 ${fmt(library.best(r.definition)!.best)}` : ''}` : r.phase === 'countdown' ? `${Math.ceil(r.countdown)} · 準備起跑` : `${fmt(r.elapsed)}／${fmt(r.definition.seconds)} · 檢查點 ${r.next}/${r.route.gates.length} · 碰撞 ${r.hits}/${r.definition.hits}`);
    lapDetails.hidden = r.definition.v !== 2;
    if (r.result?.success && r.elapsed > 300) hudStatus.append(document.createTextNode(' · 本場超過5分鐘，成績保留但不保存幽靈。'));
    if (r.result?.success && ghosts.error) hudStatus.append(document.createTextNode(` · ${ghosts.error}`));
    if (r.definition.v === 2) { hudStatus.append(document.createTextNode(` · 第${r.currentLap}/${r.totalLaps}圈${r.currentLap === r.totalLaps && r.phase === 'running' ? ' · 最後一圈' : ''}${r.lastSegmentDelta === null ? '' : ` · 最近分段 ${r.lastSegmentDelta >= 0 ? '+' : ''}${r.lastSegmentDelta.toFixed(2)}秒`}`)); const key = JSON.stringify(r.lapTimes); if (lapTable.dataset.times !== key) { lapTable.dataset.times = key; lapTable.replaceChildren(); r.lapTimes.forEach((time, i) => lapTable.append(node('li', `第${i + 1}圈 ${fmt(time)} · ${r.segments[i].map((s, j) => `S${j + 1} ${fmt(s)}`).join('／')}`))); } } else lapTable.replaceChildren();
    const gate = r.route.gates[r.next]; marker.visible = !!gate && r.phase !== 'done' && h.visible(); if (gate) marker.position.set(gate.x, gate.y + ROAD_Y + .2, gate.z);
  }
  function stop() { if (!run) return false; run = null; ghostRecorder = null; comparisonGhost = null; clearGhostVisual(); recorded = false; marker.visible = false; hud.hidden = true; h.release(); if (restore) { h.car.place(restore.point.x, restore.point.z, restore.point.h, restore.point.y); h.setWeather(restore.weather); } restore = null; h.leave(); return true; }
  if (!h.isCity) launch.textContent = '🛠 回台北城市挑戰工坊';
  launch.onclick = () => { if (!h.isCity) { location.href = '/?workshop=1'; return; } void openEditor(); }; close.onclick = closeEditor;
  zoomIn.onclick = () => map?.setZoom(map.zoom * 1.6); zoomOut.onclick = () => map?.setZoom(map.zoom / 1.6); zoomAll.onclick = () => map?.showAll(); nearby.onclick = () => { map?.setZoom(.45); map?.focus(h.car.x, h.car.z); };
  addPlace.onclick = () => { const p = book?.nodes.get(Number(places.value)); if (p) addPoint(p.x, p.z); }; addHere.onclick = () => addPoint(h.car.x, h.car.z);
  undo.onclick = () => restoreEdit(history.undo()); redo.onclick = () => restoreEdit(history.redo()); clear.onclick = () => { anchors = []; refreshRoute(); message('路線已清除；可按復原找回，已儲存的草稿仍保留。'); };
  closeLoop.onclick = () => { if (!book || anchors.length < 2 || anchors.length >= 12 || workshopClosed(anchors)) return; try { const closed = [...anchors, anchors[0]]; book.route(closed); anchors = closed; refreshRoute(); message('已沿真實單行路網接回起點；閉合末段也包含順序檢查點。'); } catch (e) { message((e as Error).message); } };
  online.onclick = () => { const def = definition(); if (!def || !book || !h.online) return; try { book.validate(def); closeEditor(); h.online(def); } catch (e) { message((e as Error).message); } };
  layer.onchange = renderPlaces; search.oninput = renderPlaces;
  for (const e of [routeName, car, weather, seconds, hits, format, laps, sections]) e.addEventListener('input', () => { if (e === sections) importedSplits = null; refreshRoute(); });
  splitMode.onchange=()=>{importedSplits=splitMode.value==='manual'?[]:null;refreshRoute();};const chooseSplits=()=>{importedSplits=splitOne.value?[Number(splitOne.value),...(splitTwo.value?[Number(splitTwo.value)]:[])]:[];refreshRoute();};splitOne.onchange=splitTwo.onchange=chooseSplits;
  exampleLoad.onclick = () => { const row = h.suggestions()[Number(example.value)]; if (!book || !row) return; const a = book.nearest(row.path[0][0], row.path[0][1], 'ground', 180), b = book.nearest(row.path.at(-1)![0], row.path.at(-1)![1], 'ground', 180); if (!a || !b) { message('範例端點無法連到目前道路，請手動選點。'); return; } anchors = [a.id, b.id]; routeName.value = row.name.slice(0, 36); refreshRoute(); if (currentRoute) seconds.value = String(Math.max(30, Math.min(1800, Math.ceil(currentRoute.length / 12 + 30)))); refreshRoute(); map?.showAll(); message(routeError || '範例已載入，可以調整路線、車款與目標。'); };
  start.onclick = () => void startRun(); saveDraft.onclick = () => { const def = definition(); if (!def || !book) return; try { book.validate(def); library.save(def); renderDrafts(); message(library.error || '草稿已儲存；不會變更一般成績或錢包。'); } catch (e) { message((e as Error).message); } };
  share.onclick = () => { const def = definition(); if (!def || !book) return; try { book.validate(def); shareBox.value = encodeWorkshop(def); message('分享碼已產生。可複製給朋友，或儲存作為草稿備份。'); } catch (e) { message((e as Error).message); } };
  importButton.onclick = () => { try { apply(decodeWorkshop(shareBox.value)); } catch (e) { message((e as Error).message); } };
  ghostEnabled.onchange = () => { ghosts.setEnabled(ghostEnabled.checked); refreshGhosts(); updateGhost(); };
  ghostToggle.onclick = () => { ghosts.setEnabled(!ghosts.enabled); refreshGhosts(); updateGhost(); h.release(); };
  ghostSource.onchange = refreshGhosts;
  ghostExport.onclick = () => { const def = definition(), value = def && ghosts.get(def); if (!value) return; const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' })), a = node('a'); a.href = url; a.download = 'taipei-workshop-ghost.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('已送出幽靈下載；檔案只含挑戰碼與軌跡，不含主存檔或房間憑證。'); };
  ghostRemove.onclick = () => { const def = definition(); if (def && confirm('刪除這條路線的本機最佳幽靈？工坊成績與已下載檔案保留。')) { ghosts.forget(def); refreshGhosts(); } };
  ghostImport.onchange = async () => { const file = ghostImport.files?.[0], token = pending; ghostImport.value = ''; if (!file || run) return; try { if (file.size > WORKSHOP_GHOST_FILE_MAX_BYTES) throw Error('幽靈檔超過250KB。'); const value = parseWorkshopGhost(JSON.parse(await file.text())); if (token !== pending || run || !open) return; if (!value) throw Error('幽靈格式、時間或軌跡無效，原最佳完整保留。'); friendGhost = value; ghostSource.value = 'friend'; refreshGhosts(); } catch (e) { if (token === pending) message(e instanceof Error ? e.message : '幽靈無法匯入。'); } };
  ghostApply.onclick = () => { if (!friendGhost || run) return; try { apply(decodeWorkshop(friendGhost.code)); } catch (e) { message((e as Error).message); } };
  async function copyText(value: string) { try { await navigator.clipboard.writeText(value); message('已複製。'); } catch { shareBox.value = value; shareBox.focus(); shareBox.select(); message('無法自動複製，已選取文字，請長按或按 Ctrl+C 複製。'); } }
  copy.onclick = () => { try { void copyText(encodeWorkshop(decodeWorkshop(shareBox.value))); } catch (e) { message((e as Error).message); } };
  copyLink.onclick = () => { try { const def = decodeWorkshop(shareBox.value); void copyText(workshopInvite(def, location.href)); } catch (e) { message((e as Error).message); } };
  retry.onclick = () => { if (!run) return; h.release(); h.car.place(run.route.start.x, run.route.start.z, run.route.start.h, run.route.start.y + ROAD_Y); run = new WorkshopRun(run.definition, run.route, h.car, h.vmax(run.definition.car), library.best(run.definition)?.segments); ghostRecorder = new WorkshopGhostRecorder(run.definition, h.car); comparisonGhost = ghostSource.value === 'friend' ? friendGhost && ghostCompatible(friendGhost, run.definition) ? friendGhost : null : ghosts.get(run.definition); if (comparisonGhost) buildGhostVisual(run.definition.car); else clearGhostVisual(); recorded = false; updateHud(); };
  exit.onclick = () => { stop(); h.notify('已離開城市挑戰，回到原來的位置與天氣。'); };
  overlay.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName) && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreEdit(e.shiftKey ? history.redo() : history.undo()); return; } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEditor(); } if (e.key !== 'Tab') return; const focusable = [...overlay.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter(e => e.getClientRects().length); const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } });
  return {
    get ownsDriving() { return run !== null; }, get busy() { return opening || open || !!run; }, get visible() { return open; }, get run() { return run; }, get library() { return library; }, get roads() { return book; }, get history() { return history; },
    get ghostLibrary() { return ghosts; }, reloadGhosts() { if (run) return false; const ok = ghosts.reload(); refreshGhosts(); return ok; },
    get vehicleId() { return run?.definition.car; }, get route() { return run?.route ?? null; },
    open: openEditor, close: closeEditor, stop, refreshHud: updateHud,
    invalidate(reason = '使用扶正或重置，本次挑戰不計成績') { if (run) { run.fail(reason); updateHud(); } },
    step(dt: number) { if (!run) return; if (!Number.isFinite(dt) || dt <= 0 || dt > .1) { run.fail('模擬中斷，請重新挑戰'); updateHud(); return; } const running = run.phase === 'running', impact = running ? h.drive(dt, run.definition) : 0; if (!running) h.car.vx = h.car.vz = h.car.w = 0; const result = run.step(dt, h.car, impact); if (running) ghostRecorder?.step(run.elapsed, h.car); if (result && !recorded) { recorded = true; if (result.success) { library.record(run.definition, result); const ghost = ghostRecorder?.finish(result); if (ghost) ghosts.record(ghost); } h.release(); h.car.vx = h.car.vz = h.car.w = 0; } updateHud(); },
    navInfo() { if (!run || run.phase === 'done') return null; const p = run.route.gates[run.next]; return { path: run.route.path, ys: run.route.ys, next: p ? [p.x, p.z] as [number, number] : null }; },
  };
}
