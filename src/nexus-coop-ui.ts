import * as THREE from 'three';
import { COOP_STATIONS, COOP_DWELL_MS, COOP_RELAY_STATION, coopStation, coopNear, validCoopCode, type CoopPose, type CoopRoom, type CoopStation, type CoopInput } from '../shared/nexus-coop';
import { NexusCoopClient, coopEndpoint, coopInvite } from './nexus-coop-client';
import { ENTRY_CANCELLED, MultiplayerEntryWait } from './multiplayer-entry';
import './nexus-coop.css';
import { mountCoopDispatch } from './summit-coop-dispatch';
import type { RoadNet } from './citydata';
import type { Landmark } from './decor';
import type { FreeCar } from './freecar';
import type { Collider } from './citydata';
import { AtlasCoopPrediction, COOP_STEP } from './atlas-coop-prediction';
import { vehicleById } from './vehicles';
import {parseCoopHistory,type CoopHistory} from './atlas-coop-history';
import {mountDiagnostics} from './odyssey-diagnostics';
import {mountCoopQuick} from './odyssey-coop-quick';

export interface NexusCoopOptions {
  scene: THREE.Scene; host: HTMLElement; isCity: boolean;car:FreeCar;collider():Collider|null;input():CoopInput;
  roads?(): RoadNet | null; landmarks?(): Landmark[];
  canEnter(): boolean; enter(depot: CoopStation, isCurrent: () => boolean): Promise<boolean>; open(): void; close(): void; left(): void;
  position(): CoopPose; vehicle(): string; relocate(pose: CoopPose): void; isDriving(): boolean; navigate(station: CoopStation): void; notify(text: string): void;
}
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const e = document.createElement(tag); e.textContent = text; return e; };
const button = (id: string, text: string, fn: () => void) => { const b = make('button', text); b.type = 'button'; b.id = id; b.className = 'ghost-btn'; b.onclick = fn; return b; };
const COLORS = ['#59dbea', '#f8bd59', '#bb8dff', '#8ae77e'];
const HISTORY_KEY = 'taipei-gp-city-coop-results-v1';
export function mountNexusCoop(o: NexusCoopOptions) {
  const launch = button('btn-nexus-coop', '📦 城市合作配送 · 2～4人分工', open); o.host.append(launch);
  const overlay = make('div'); overlay.id = 'nexus-coop-overlay'; overlay.className = 'overlay hidden'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'nexus-coop-title');
  const card = make('div'); card.className = 'card wide nexus-coop-card'; const title = make('h1', '城市合作配送'); title.id = 'nexus-coop-title';
  const lead = make('p', '20分鐘分工配送，每車一件、同層12公尺內停穩1.2秒取送。建房可選一般六件配送，或五件中繼接力：先到市民大道中繼站，交給另一位空車隊友確認，再送往目的地。車況與貨物均由伺服器計算。');
  const serviceHint = make('p', '特殊貨運：兩急件首次取貨後6分鐘內送達200分、超時100分；兩易碎貨依完整度給0～200分，真碰撞與急減速會扣完整度；兩一般貨各100分。退貨或返回倉庫不重設期限與貨況。朋友車穿透，背景車流與行人隱藏；獨立紀錄不增加單人金錢或正式圈速。'); serviceHint.className = 'sub';
  const entry = make('section'); entry.id = 'coop-entry';
  const nameLabel = make('label', '車手暱稱 '), name = make('input'); name.id = 'coop-name'; name.maxLength = 20; name.setAttribute('autocomplete', 'nickname'); name.value = '城市車手'; nameLabel.append(name);
  const codeLabel = make('label', '合作房間碼 '), code = make('input'); code.id = 'coop-code'; code.maxLength = 6; code.autocapitalize = 'characters'; code.autocomplete = 'off'; codeLabel.append(code);
  const modeLabel=make('label','建房任務 '),taskMode=make('select');taskMode.id='coop-task-mode';for(const[value,text]of[['direct','一般配送 · 六件'],['relay','中繼接力 · 五件'],['special','特殊貨運 · 急件／易碎／一般各兩件']]){const option=make('option',text);option.value=value;taskMode.append(option);}modeLabel.append(taskMode);
  const create = button('coop-create', '建立合作房', () => void enter('create'));
  const join = button('coop-join', '加入合作房', () => void enter('join'));
  const resume = button('coop-resume', '續接本分頁合作席位', () => void enter('resume'));
  const cancel = button('coop-cancel-entry', '取消準備／連線', cancelEntry);
  entry.append(nameLabel, codeLabel,modeLabel, create, join, resume);
  const info = make('p'); info.id = 'coop-status'; info.setAttribute('role', 'status');
  const clock = make('p'); clock.id = 'coop-clock';
  const board = make('section'); board.id = 'coop-board';
  const invite = make('input'); invite.id = 'coop-invite'; invite.readOnly = true; invite.setAttribute('aria-label', '合作邀請網址');
  const copy = button('coop-copy', '複製合作邀請', () => { const value = client.room && coopInvite(location.href, client.room.code); if (!value) return; invite.value = value; void navigator.clipboard?.writeText(value).then(() => setMessage('邀請網址已複製。'), () => { invite.focus(); invite.select(); setMessage('請手動複製已選取的網址。'); }); if (!navigator.clipboard) { invite.focus(); invite.select(); setMessage('請手動複製已選取的網址。'); } });
  const close = button('coop-close', '返回駕駛／選單', closePanel);
  const leave = button('coop-leave', '離開合作房', () => { leaveRoom(); setMessage('已離開合作房，未交付貨物退回待領。'); });
  const history = make('details'), historyTitle = make('summary', '最近20輪合作紀錄'), historyList = make('div'); history.id = 'coop-history'; history.append(historyTitle, historyList);
  card.append(title, lead, serviceHint, entry, cancel, info, clock, board, invite, copy, history, leave, close); overlay.append(card); document.body.append(overlay);
  const hud = make('details'); hud.id = 'coop-hud'; hud.className = 'hidden'; const summary = make('summary', '合作配送'); const hudText = make('p'); hudText.id = 'coop-hud-status';
  const hudAction = button('coop-hud-action', '取貨／交付', () => { const r = client.room, p = r?.players.find(p => p.id === client.selfId), c = r?.cargo.find(c => c.id === p?.cargo); if (c&&c.leg!=='to-relay') void action('deliver', { cargoId: c.id }); else open(); });
  const hudNav = button('coop-hud-nav', '導航我的目標', () => { const s = targetStation(); if (s) o.navigate(s); });
  const hudRoom = button('coop-hud-room', '貨單／房間', open); hud.append(summary, hudText, hudNav, hudAction, hudRoom); document.body.append(hud);
  const endpoint = coopEndpoint(String(import.meta.env.VITE_MULTIPLAYER_URL ?? ''), location);
  const diagnostics = mountDiagnostics(entry, endpoint, 'odyssey-coop-diagnostics');
  let storage: Storage | null = null; try { storage = sessionStorage; } catch {}
  const client = new NexusCoopClient(endpoint, render, pose => o.relocate(pose), storage);
  const prediction=new AtlasCoopPrediction(o.car,o.collider);let accumulator=0;
  const waiter = new MultiplayerEntryWait(render);
  const dispatch = mountCoopDispatch(() => o.roads?.() ?? null, () => o.landmarks?.() ?? [], (type, fields) => void action(type, fields), station => o.navigate(station));
  card.insertBefore(dispatch.root, board);
  const quick = mountCoopQuick(dispatch.root, (type, fields) => void action(type, fields));
  let busy = false, commandBusy = false, entered = false, previousActive = false, message = '', lastKey = '', lastHudAt = -Infinity, lastFocus: HTMLElement | null = null;
  let entryGeneration = 0;
  let results: CoopHistory[] = [], canWriteHistory = true;
  try { const raw = localStorage.getItem(HISTORY_KEY); if (raw) { const parsed=parseCoopHistory(JSON.parse(raw));if(parsed)results=parsed;else canWriteHistory=false; } } catch { canWriteHistory = false; }
  const graphics = new THREE.Group(); graphics.name = 'city-coop-only'; o.scene.add(graphics);
  const peers = new Map<string, { group: THREE.Group; sprite: THREE.Sprite; key: string; initialized: boolean }>();
  const ringGeometry = new THREE.RingGeometry(8.6, 9.3, 40).rotateX(-Math.PI / 2), ringMaterial = new THREE.MeshBasicMaterial({ color: '#61e6b3', transparent: true, opacity: .72, depthWrite: false, side: THREE.DoubleSide });
  const stations = COOP_STATIONS.map(s => { const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.position.set(s.x, s.y + .08, s.z); graphics.add(ring); return ring; });
  let disposed = false;
  function setMessage(text: string) { message = text; render(); }
  function isOpen() { return !overlay.classList.contains('hidden'); }
  function open() {
    if (!o.isCity) { location.search = '?coop=1'; return; }
    if (!o.canEnter() && !client.room) { o.notify('先結束目前挑戰，再進入城市合作配送。'); return; }
    lastFocus = document.activeElement as HTMLElement; o.open(); overlay.classList.remove('hidden'); render(); close.focus();
  }
  function closePanel() { if (busy) { setMessage('仍在連線；可先取消等待。'); return; } overlay.classList.add('hidden'); o.close(); lastFocus?.focus(); }
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); return; }
    if (event.key !== 'Tab') return;
    const list = [...card.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')].filter(e => e.getClientRects().length > 0), first = list[0], last = list.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  async function enter(kind: 'create' | 'join' | 'resume') {
    if (disposed || busy || waiter.active || client.room && kind !== 'resume') return;
    const nickname = name.value.trim(), roomCode = code.value.trim().toUpperCase();
    if (kind !== 'resume' && (!nickname || nickname.length > 20 || /[\x00-\x1f\x7f]/.test(nickname))) { setMessage('暱稱請填1～20字。'); return; }
    if (kind === 'join' && !validCoopCode(roomCode)) { setMessage('請輸入六碼合作房間碼。'); return; }
    if (!client.room && !o.canEnter()) { setMessage('先結束目前任務，再加入合作房。'); return; }
    const generation = ++entryGeneration, isCurrent = () => !disposed && generation === entryGeneration;
    busy = true; message = ''; render();
    try {
      if (!entered) {
        // Own restoration before awaiting city/permission work, so cancellation can release it once.
        entered = true;
        const ready = await o.enter(COOP_STATIONS[0], isCurrent);
        if (!isCurrent()) return;
        if (!ready) throw new Error('城市尚未就緒或目前任務無法中斷。');
      }
      if (!isCurrent()) return;
      await waiter.open(client);
      if (!isCurrent()) return;
      if (kind === 'resume') await client.resume(); else await client.enter(kind, nickname, o.vehicle(), roomCode,taskMode.value==='relay'?'relay':taskMode.value==='special'?'special':'direct');
      if (!isCurrent()) return;
      code.value = client.room?.code ?? roomCode;
    } catch (error) { if (!isCurrent()) return; message = error instanceof Error ? error.message : '無法加入合作房'; if (!client.room) { client.stopRetry(); releaseEntry(); } }
    finally { if (isCurrent()) { busy = false; render(); } }
  }
  async function action(type: Parameters<NexusCoopClient['command']>[0], fields: Record<string, unknown> = {}) {
    if (commandBusy || busy) return; commandBusy = true; render();
    try { await client.command(type, fields); message = ''; } catch (e) { message = e instanceof Error ? e.message : '合作指令未完成'; }
    finally { commandBusy = false; render(); }
  }
  function releaseEntry() {prediction.reset();accumulator=0; if (entered) { entered = false; o.left(); } }
  function cancelEntry() { entryGeneration++; busy = false; releaseEntry(); waiter.cancel(); client.disconnect(); message = ENTRY_CANCELLED; render(); }
  function leaveRoom() { entryGeneration++; busy = false; releaseEntry(); waiter.cancel(); client.leave(); message = ''; render(); }
  function targetStation() { const p = client.room?.players.find(p => p.id === client.selfId), c = client.room?.cargo.find(c => c.id === p?.cargo); return c ? c.leg==='to-relay'?COOP_RELAY_STATION:coopStation(c.destination) : COOP_STATIONS[0]; }
  function recordResult(room: CoopRoom) {
    if (room.phase !== 'finished' || results.some(r => r.id === room.runId)) return;
    results.unshift({ id: room.runId, completed: room.reason === 'complete', delivered: room.delivered, own: room.players.find(p => p.id === client.selfId)?.delivered ?? 0, at: room.serverTime,total:room.mode==='relay'?5:6,mode:room.mode,...room.mode==='special'?{points:room.points}:{} }); results = results.slice(0, 20);
    if (canWriteHistory) try { localStorage.setItem(HISTORY_KEY, JSON.stringify(results)); } catch { canWriteHistory = false; }
  }
  function render() {
    if (disposed) return;
    const room = client.room, active = !!room;
    dispatch.update(room, client.selfId);
    quick.update(room, client.selfId, client.status === 'connected', commandBusy || busy);
    if (previousActive && !active && entered) releaseEntry();
    previousActive = active;
    info.textContent = message || (waiter.active ? `正在等待合作服務（${waiter.state?.elapsedSeconds ?? 0}/45秒），可以取消。` : client.message || (!endpoint ? '合作服務尚未設定；需要和連線競速相同的伺服器網址，且後端已更新。' : '建立合作房，或輸入朋友的六碼合作房間碼。'));
    if(client.status==='reconnecting')info.textContent=`${client.message} · 自動續接剩約${Math.ceil(client.retryRemainingMs/1000)}秒，可停止後手動續接。`;
    entry.hidden = active; create.disabled = join.disabled = busy || !endpoint; name.disabled = code.disabled = taskMode.disabled=busy; cancel.hidden = !busy; resume.hidden = !client.resumable; resume.disabled = busy;
    leave.hidden = !active; leave.disabled = busy; invite.hidden = copy.hidden = !room; invite.value = room ? coopInvite(location.href, room.code) ?? '' : '';
    clock.textContent = room?.phase === 'running' && room.endsAt ? `剩餘 ${Math.max(0, Math.ceil((room.endsAt - client.serverNow()) / 1000))} 秒（看地圖／暫停時，朋友與合作時限繼續）` : '';
    const key = JSON.stringify([room?.code, room?.runId, room?.phase, room?.reason, room?.players.map(p => [p.id, p.name, p.ready, p.connected, p.cargo, p.delivered]), room?.cargo, room?.dispatch, client.status, commandBusy, results, canWriteHistory]);
    if (key === lastKey) return; lastKey = key;
    board.replaceChildren(); historyList.replaceChildren();
    if (room) {
      recordResult(room);
      board.append(make('h2', `房間 ${room.code} · ${room.mode==='relay'?'中繼接力':room.mode==='special'?'特殊貨運':'一般配送'} · ${room.phase === 'lobby' ? '等待朋友' : room.phase === 'running' ? '合作進行中' : room.reason === 'complete' ? '全部送達！' : '配送時間結束'} · ${room.delivered}/${room.cargo.length}件 · ${room.points}合作分`));
      for (const p of room.players) board.append(make('p', `${p.id === room.hostId ? '♛ ' : ''}${p.name}${p.id === client.selfId ? '（你）' : ''} · ${p.connected ? p.ready ? '已準備' : '已連線' : '斷線保留30秒'} · 已送${p.delivered}件${p.cargo ? ' · 載貨中' : ''}`));
      const me = room.players.find(p => p.id === client.selfId), controls = make('div'); controls.className = 'nexus-coop-actions';
      if(client.status==='reconnecting')controls.append(button('coop-stop-retry','停止自動續接',()=>client.stopRetry()));
      else if (client.status === 'closed') controls.append(button('coop-retry', '手動續接合作席位', () => void enter('resume')));
      else if (room.phase === 'lobby') {
        controls.append(button('coop-ready', me?.ready ? '取消準備' : '我已準備', () => void action('ready', { ready: !me?.ready })));
        if (room.hostId === client.selfId) controls.append(button('coop-start', '全員準備後開始配送', () => void action('start')));
      } else if (room.phase === 'finished' && room.hostId === client.selfId) controls.append(button('coop-again', '開新一輪（保留朋友）', () => void action('again')));
      controls.append(button('coop-return', '返回共同倉庫（貨物退回待領）', () => void action('return')));
      if(room.mode==='relay')controls.append(button('coop-relay-nav','導航市民大道中繼站',()=>{o.navigate(COOP_RELAY_STATION);closePanel();}));
      board.append(controls, make('p', `共同倉庫：${COOP_STATIONS[0].name}。朋友先各領不同貨單，完成後可返回領下一件。`));
      for (const cargo of room.cargo) {
        const destination = coopStation(cargo.destination)!, owner = room.players.find(p => p.id === cargo.owner), row = make('div'); row.className = 'nexus-coop-cargo'; row.dataset.cargo = cargo.id;
        row.append(make('b', destination.name), make('span', cargo.state === 'waiting' ? '待領取 · 共同倉庫' : cargo.state === 'delivered' ? `✓ 已送達${owner ? ` · ${owner.name}` : ''}` : `${owner?.name ?? '隊友'}運送中${cargo.leg==='to-relay'?' · 先赴市民大道中繼':cargo.leg==='to-destination'?' · 已交接，前往終點':''}`));
        if(room.mode==='special')row.append(make('span',`${cargo.kind==='urgent'?'急件':cargo.kind==='fragile'?'易碎貨':'一般貨'}${cargo.kind==='fragile'?` · 完整度${Math.floor(cargo.integrity??0)}%`:cargo.kind==='urgent'?cargo.deadlineAt?` · 期限${new Date(cargo.deadlineAt).toLocaleTimeString('zh-TW')}（首次取貨起6分鐘）`:' · 首次取貨後開始6分鐘計時':''}${cargo.score!==null?` · ${cargo.score}分`:''}`));
        const reservation = room.dispatch.reservations.find(r => r.cargoId === cargo.id), reservedBy = room.players.find(p => p.id === reservation?.playerId);
        if (reservation) row.append(make('span', `已預約：${reservedBy?.name ?? ''}（最多2分鐘，斷線即釋放）`));
        const nav = button('', cargo.state === 'waiting' ? '導航倉庫' : cargo.leg==='to-relay'?'導航中繼站':'導航目的地', () => { o.navigate(cargo.state === 'waiting' ? COOP_STATIONS[0] : cargo.leg==='to-relay'?COOP_RELAY_STATION:destination); closePanel(); }); row.append(nav);
        if (room.phase === 'running') {
          if (cargo.state === 'waiting' && !me?.cargo && (!reservation || reservation.playerId === client.selfId)) {
            row.append(button(`coop-pickup-${cargo.id}`, '停穩取貨', () => void action('pickup', { cargoId: cargo.id })));
            row.append(button(`coop-reserve-${cargo.id}`, reservation ? '取消我的預約' : '預約此貨物', () => void action(reservation ? 'cancel-reservation' : 'reserve', reservation ? {} : { cargoId: cargo.id })));
          }
          if (cargo.state === 'carried' && cargo.owner === client.selfId) {
            if(cargo.leg==='to-relay'){
              const receivers=room.players.filter(p=>p.id!==client.selfId&&p.connected&&!p.cargo);
              for(const receiver of receivers)row.append(button(`coop-offer-${cargo.id}-${receiver.id}`,`停穩後邀請${receiver.name}接貨`,()=>void action('offer-handoff',{cargoId:cargo.id,to:receiver.id})));
              if(!receivers.length)row.append(make('span','等待另一位在線空車隊友到中繼站。'));
              if(cargo.offer)row.append(button(`coop-cancel-offer-${cargo.id}`,'取消交接邀請',()=>void action('cancel-handoff',{cargoId:cargo.id})));
            }else row.append(button(`coop-deliver-${cargo.id}`, '停穩交付', () => void action('deliver', { cargoId: cargo.id })));
            row.append(button(`coop-release-${cargo.id}`, '退回待領', () => void action('release')));
          }
          if(cargo.offer?.to===client.selfId)row.append(button(`coop-accept-${cargo.id}`,`確認接貨（邀請10秒有效）`,()=>void action('accept-handoff',{cargoId:cargo.id})));
        }
        board.append(row);
      }
      for (const b of board.querySelectorAll<HTMLButtonElement>('button')) b.disabled = commandBusy || busy || client.status !== 'connected' && b.id !== 'coop-retry'&&b.id!=='coop-stop-retry';
    }
    for (const r of results) historyList.append(make('p', `${new Date(r.at).toLocaleString('zh-TW')} · ${r.mode==='relay'?'中繼接力 · ':r.mode==='special'?'特殊貨運 · ':''}${r.completed ? '合作完成' : '時間結束'} ${r.delivered}/${r.total??6}件 · 你送${r.own}件${r.points===undefined?'':` · ${r.points}分`}`));
    if (!results.length) historyList.append(make('p', '尚無合作結算。'));
    if (!canWriteHistory) historyList.append(make('p', '合作紀錄儲存不可用或格式無效；保留原資料，本次結果仍可在這頁查看。'));
  }
  function makeName(text: string, color: string) {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 64; const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#081421df'; ctx.fillRect(0, 0, 320, 64); ctx.fillStyle = color; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text.slice(0, 20), 160, 43, 310);
    const texture = new THREE.CanvasTexture(canvas), sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false })); sprite.scale.set(12, 2.4, 1); sprite.position.y = 4; return sprite;
  }
  function removePeer(id: string) { const p = peers.get(id); if (!p) return; p.group.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose(); } }); p.sprite.material.map?.dispose(); p.sprite.material.dispose(); graphics.remove(p.group); peers.delete(id); }
  function frame(now: number, dt: number) {
    if (disposed) return;
    const room = client.room, visible = !!room && o.isDriving(); graphics.visible = visible; hud.classList.toggle('hidden', !visible || isOpen());
    if (!room) {prediction.reset();accumulator=0; for (const id of peers.keys()) removePeer(id); return; }
    const self=room.players.find(p=>p.id===client.selfId);if(self){o.car.spec=vehicleById(self.vehicle).spec;prediction.reconcile(self,room.serverTime,`${room.runId}:${client.motionRevision}`,room.phase==='running');}
    if(client.status==='connected'){
      accumulator+=Math.min(.1,Math.max(0,dt));let steps=0;while(accumulator>=COOP_STEP&&steps++<4){accumulator-=COOP_STEP;const focused=!document.hidden&&document.hasFocus(),controls=o.isDriving()&&!isOpen()&&focused?o.input():{steer:0,throttle:false,brake:false,handbrake:false,active:(o.isDriving()||isOpen())&&focused};const seq=client.input(controls);if(seq!==null)prediction.advance(seq,controls,room.phase==='running');}
    }else{accumulator=0;o.car.vx=o.car.vz=o.car.w=0;}
    for (const id of peers.keys()) if (!room.players.some(p => p.id === id && p.id !== client.selfId)) removePeer(id);
    room.players.forEach((p, i) => {
      if (p.id === client.selfId) return;
      let model = peers.get(p.id); const key = `${p.name}:${p.vehicle}:${i}:${p.connected}`;
      if (model && model.key !== key) { removePeer(p.id); model = undefined; }
      if (!model) {
        const group = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(1.9, .85, 4.4), new THREE.MeshStandardMaterial({ color: COLORS[i], metalness: .25, roughness: .55 })); body.position.y = .72;
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.55, .6, 2.05), new THREE.MeshStandardMaterial({ color: '#244654', roughness: .3 })); top.position.set(0, 1.4, -.15); const sprite = makeName(`${p.name}${p.connected ? '' : ' · 斷線'}`, COLORS[i]); group.add(body, top, sprite); graphics.add(group); model = { group, sprite, key, initialized: false }; peers.set(p.id, model);
      }
      const q = model.group, blend = model.initialized ? Math.min(1, Math.max(0, dt) * 12) : 1; model.initialized = true;
      q.position.x += (p.pose.x - q.position.x) * blend; q.position.z += (p.pose.z - q.position.z) * blend; q.position.y += (p.pose.y - q.position.y) * blend;
      const angle = Math.atan2(Math.sin(p.pose.h - q.rotation.y), Math.cos(p.pose.h - q.rotation.y)); q.rotation.y += angle * blend; q.visible = p.connected;
    });
    const target = targetStation(); stations.forEach((ring, i) => { ring.visible = COOP_STATIONS[i].id === target?.id; });
    if (now - lastHudAt >= 250) {
      const host = isOpen() ? card : hud; if (dispatch.root.parentElement !== host) { if (isOpen()) card.insertBefore(dispatch.root, board); else hud.append(dispatch.root); }
      dispatch.draw();
      lastHudAt = now; const me = room.players.find(p => p.id === client.selfId), pose = o.position(), own = room.cargo.find(c => c.id === me?.cargo);
      summary.textContent = `📦 ${room.mode==='relay'?'接力':'合作'} ${room.delivered}/${room.cargo.length} · ${room.phase === 'lobby' ? '等待準備' : room.phase === 'finished' ? '已結算' : `剩${Math.max(0, Math.ceil(((room.endsAt ?? 0) - client.serverNow()) / 1000))}秒`}`;
      hudText.textContent = `${target?.name ?? ''} · ${target ? Math.round(Math.hypot(target.x - pose.x, target.z - pose.z)) : 0}公尺 · ${own ? '運送中' : '前往共同倉庫領貨'}${target && coopNear(pose, target) && pose.speed <= 1 ? ` · 請停穩${COOP_DWELL_MS / 1000}秒` : ''}${client.status !== 'connected' ? ' · 續接中，暫停取送' : ''}`;
      if(own?.kind==='urgent')hudText.textContent+=` · 急件${own.deadlineAt?Math.max(0,Math.ceil((own.deadlineAt-client.serverNow())/1000)):360}秒${own.deadlineAt&&client.serverNow()>own.deadlineAt?' · 已失去限時加成，仍可交付100分':''}`;if(own?.kind==='fragile')hudText.textContent+=` · 易碎完整度${Math.floor(own.integrity??0)}%`;
      hudAction.textContent = own ? own.leg==='to-relay'?'交接給隊友':'停穩交付' : '選擇貨單'; hudAction.disabled = commandBusy || client.status !== 'connected' || room.phase !== 'running';
      if (isOpen()) render();
    }
  }
  const params = new URLSearchParams(location.search), invitedCode = params.get('coop'); if (invitedCode && validCoopCode(invitedCode.toUpperCase())) code.value = invitedCode.toUpperCase(); else if (client.rememberedCode) code.value = client.rememberedCode;
  render();
  return { client, get active() { return !!client.room; }, get busy() { return busy; }, get opened() { return isOpen(); }, open, close: closePanel, frame, leave: leaveRoom,
    returnDepot() { if (client.room) void action('return'); },
    dispose() { leaveRoom(); disposed = true; quick.dispose(); diagnostics.dispose(); dispatch.dispose(); for (const id of peers.keys()) removePeer(id); ringGeometry.dispose(); ringMaterial.dispose(); o.scene.remove(graphics); overlay.remove(); hud.remove(); launch.remove(); },
  };
}
