import './multiplayer.css';
import { MultiplayerClient } from './multiplayer-client';
import { MultiplayerScene } from './multiplayer-scene';
import { Input } from './input';
import { Sound } from './audio';
import type { RoomPlayer, MultiplayerLaps, TrackSelection } from '../shared/multiplayer-protocol';
import { MULTIPLAYER_TRACKS, DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack } from '../shared/multiplayer-tracks';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const time = (ms: number) => {
  const value = Math.max(0, ms), minutes = Math.floor(value / 60000);
  return `${minutes}:${((value % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
};
const localHost = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname);
const endpoint = String(import.meta.env.VITE_MULTIPLAYER_URL ?? '').trim() || (localHost && location.protocol === 'http:' ? `ws://${location.hostname}:4320/ws` : '');
let client: MultiplayerClient | null = null;
let scene: MultiplayerScene | null = null;
let graphicsReady = false, busy = false, notice = '', soundEnabled = false;
let mapContextKey = '', mapLoadToken = 0, mapLoading = false, mapError = '', mapProgress = '', loadedAckKey = '';
let focused = document.hasFocus();
let previousPhase = '';
for (const id of ['mp-track', 'mp-room-track']) {
  const select = $<HTMLSelectElement>(id);
  for (const descriptor of MULTIPLAYER_TRACKS) {
    const option = document.createElement('option'); option.value = descriptor.id;
    option.textContent = `${descriptor.flag} ${descriptor.name} · ${descriptor.place}`;
    select.appendChild(option);
  }
  select.value = DEFAULT_MULTIPLAYER_TRACK_ID;
}
const input = new Input($('mp-pad'), $('mp-pad-dot'), $('mp-brake'), $('mp-gas'), $('mp-left'), $('mp-right'));
const sound = new Sound();
const canDrive = () => !!client && client.status === 'connected' && client.room?.phase === 'racing' && graphicsReady && !!scene?.matchesMap(client.room) && !!client.room.players.find(p => p.id === client?.selfId && p.loaded && !p.dnf && p.finishMs === null) && focused && !document.hidden && !scene.contextLost;
input.isDriving = canDrive;

function desiredMap() {
  if (!scene || scene.contextLost) return null;
  const room = client?.room;
  if (room) {
    if (client?.status !== 'connected' || !client.selfId) return null;
    const selection: TrackSelection = { trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision };
    return { selection, key: `${room.code}:${client.selfId}:${client.connectionGeneration}:${selection.trackId}:${selection.trackStamp}:${selection.trackRevision}`, generation: client.connectionGeneration, inRoom: true };
  }
  const descriptor = getMultiplayerTrack($<HTMLSelectElement>('mp-track').value)!;
  const selection: TrackSelection = { trackId: descriptor.id, trackStamp: descriptor.trackStamp, trackRevision: 0 };
  return { selection, key: `preview:${selection.trackId}:${selection.trackStamp}`, generation: -1, inRoom: false };
}

/** 房間、地圖版本、續接世代都要相符，才接受非同步完成並確認載入。 */
function synchronizeMap(force = false) {
  const desired = desiredMap();
  if (!desired) {
    if (mapContextKey) { mapLoadToken++; mapContextKey = ''; loadedAckKey = ''; }
    graphicsReady = false; mapLoading = false; return;
  }
  if (!force && desired.key === mapContextKey) return;
  mapContextKey = desired.key;
  const token = ++mapLoadToken, mapScene = scene!;
  const current = () => token === mapLoadToken && desiredMap()?.key === desired.key;
  graphicsReady = false; mapLoading = true; mapError = ''; loadedAckKey = '';
  mapProgress = '正在準備所選賽道…';
  sound.engine(0, 0, false);
  void mapScene.prepareMap(desired.selection, text => {
    if (!current()) return;
    mapProgress = text; renderUi();
  }).then(prepared => {
    if (!current()) return;
    if (!prepared || !mapScene.matchesMap(desired.selection)) throw new Error('地圖尚未就緒，請重試載入。');
    graphicsReady = true; mapLoading = false;
    mapProgress = '賽道已就緒，邀請朋友一起比賽。';
    const room = client?.room;
    if (desired.inRoom && room && client?.selfId && client.status === 'connected') {
      mapScene.accept(room, client.selfId, client.serverNow());
      // command 會同步通知訂閱者；先記錄確認鍵，避免重複傳送。
      if (loadedAckKey !== desired.key) {
        loadedAckKey = desired.key;
        if (!client.trackLoaded(desired.selection, desired.generation)) loadedAckKey = '';
      }
    }
    renderUi();
  }).catch(error => {
    if (!current()) return;
    graphicsReady = false; mapLoading = false;
    mapError = error instanceof Error ? error.message : '地圖載入失敗，請再試一次。';
    mapProgress = '地圖載入未完成。'; renderUi();
  });
}

function playerItem(player: RoomPlayer, results = false) {
  const li = document.createElement('li');
  const color = document.createElement('span'); color.className = 'mp-player-color'; color.style.background = player.color;
  const name = document.createElement('span'); name.className = 'mp-player-name';
  name.textContent = `${results ? player.rank + '. ' : ''}${player.name}${player.id === client?.selfId ? '（你）' : ''}`;
  const small = document.createElement('small');
  small.textContent = results ? `${player.completedLaps} 圈${player.dnf ? ' · 未完成' : ''}` : `${player.id === client?.room?.hostId ? '房主 · ' : ''}${player.connected ? '已連線' : '暫時失聯，等待重連'}`;
  name.appendChild(small);
  const status = document.createElement('b'); status.textContent = results ? player.finishMs !== null ? time(player.finishMs) : 'DNF' : !player.connected ? '等待重連' : !player.loaded ? '載入地圖中' : player.ready ? '已準備' : '準備中';
  li.append(color, name, status); return li;
}

function renderUi() {
  const room = client?.room, me = room?.players.find(p => p.id === client?.selfId);
  const phase = room?.phase ?? '', active = phase === 'countdown' || phase === 'racing';
  const connected = client?.status === 'connected';
  const localMapReady = graphicsReady && !!room && !!scene?.matchesMap(room) && !!me?.loaded;
  const connectionLabels = { idle: '尚未連線', connecting: '正在連線…', connected: '已連線', reconnecting: '正在重新連線…', disconnected: '連線已中斷' };
  $('mp-connection').textContent = client ? `${connectionLabels[client.status]}${connected && client.rttMs !== null ? ` · ${Math.round(client.rttMs)} ms` : ''}` : '連線對戰尚未開放';
  $('mp-message').textContent = mapError || client?.error || notice;
  $('mp-loading').textContent = room && !connected ? '重新連線後會確認目前的比賽地圖。' : mapProgress || '正在準備賽道…';
  $('mp-map-retry').hidden = !mapError;
  $<HTMLButtonElement>('mp-map-retry').disabled = mapLoading || (!!room && !connected);
  $('mp-panel').hidden = active && !mapError;
  $('mp-hud').hidden = !active || !!mapError;
  $('mp-entry').hidden = !!room;
  $('mp-room').hidden = phase !== 'lobby';
  $('mp-results').hidden = phase !== 'results';
  $<HTMLButtonElement>('mp-create').disabled = !client || !graphicsReady || busy;
  $<HTMLButtonElement>('mp-join').disabled = !client || !scene || scene.contextLost || busy;
  $<HTMLSelectElement>('mp-track').disabled = busy;
  $('mp-restore').hidden = !!room || !client?.hasSavedSession;
  $<HTMLButtonElement>('mp-restore').disabled = !scene || scene.contextLost || busy;
  if (room) {
    const descriptor = getMultiplayerTrack(room.trackId)!;
    const trackLabel = `${descriptor.flag} ${descriptor.name}`;
    $('mp-room-code').textContent = room.code;
    $('mp-room-description').textContent = `${trackLabel} · ${room.laps} 圈 · ${room.players.length} / 4 人`;
    $<HTMLSelectElement>('mp-room-track').value = room.trackId;
    $<HTMLSelectElement>('mp-room-track').disabled = !connected || room.hostId !== client?.selfId || phase !== 'lobby';
    $('mp-map-status').textContent = !connected ? '等待重新連線以確認地圖。' : mapError ? '載入失敗，可重試或由房主更換地圖。' : !localMapReady ? mapLoading ? mapProgress : '正在確認地圖載入狀態…' : room.players.some(p => !p.loaded) ? '你的地圖已就緒，等待其他車手載入。' : '所有車手地圖已就緒，準備好即可開始。';
    $('mp-map-status').dataset.loading = String(!localMapReady);
    $('mp-players').replaceChildren(...room.players.map(p => playerItem(p)));
    $('mp-ready').textContent = me?.ready ? '取消準備' : '我準備好了';
    $<HTMLButtonElement>('mp-ready').disabled = !connected || !localMapReady;
    $('mp-start').hidden = room.hostId !== client?.selfId;
    $<HTMLButtonElement>('mp-start').disabled = !connected || !localMapReady || room.players.length < 2 || room.players.some(p => !p.ready || !p.connected || !p.loaded);
    $('mp-start').textContent = room.players.length < 2 ? '等待朋友加入' : room.players.some(p => !p.loaded) ? '等待地圖載入' : room.players.some(p => !p.ready || !p.connected) ? '等待全員準備' : '開始倒數';
    $('mp-result-track').textContent = `${trackLabel} · ${room.laps} 圈`;
    $('mp-race-track').textContent = trackLabel;
    $('mp-results-list').replaceChildren(...room.players.map(p => playerItem(p, true)));
    $('mp-rematch').hidden = room.hostId !== client?.selfId;
    $<HTMLButtonElement>('mp-rematch').disabled = !connected;
    $('mp-results-note').textContent = room.hostId === client?.selfId ? '再來一場會回到大廳，請所有人重新準備。' : '等房主開啟下一場，或離開房間。';
    $('mp-board').replaceChildren(...room.players.map(p => {
      const li = document.createElement('li'); li.dataset.self = String(p.id === client?.selfId);
      const rank = document.createElement('b'); rank.textContent = `P${p.rank}`;
      const name = document.createElement('span'); name.textContent = p.name;
      const status = document.createElement('small'); status.textContent = p.dnf ? 'DNF' : p.finishMs !== null ? '🏁' : !p.connected ? '失聯' : `${Math.min(room.laps, p.completedLaps + 1)}/${room.laps}`;
      li.append(rank, name, status); return li;
    }));
    if (me) {
      $('mp-position').textContent = `P${me.rank}`;
      $('mp-lap').textContent = `${Math.min(room.laps, me.completedLaps + 1)} / ${room.laps} 圈`;
    }
    $('mp-race-message').textContent = !connected ? '連線中斷，自車已煞停；正在重連，其他車手繼續比賽。'
      : !localMapReady ? '正在載入並確認比賽地圖，自車保持煞車。'
      : me?.dnf ? '本場未完成；等待其他車手完賽。'
      : me?.finishMs !== null && me?.finishMs !== undefined ? `🏁 你已完賽：${time(me.finishMs)}，等待其他車手。`
      : phase === 'countdown' ? '同步起跑準備中' : '';
  }
  if (phase !== previousPhase) {
    if (active && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (phase === 'results') sound.engine(0, 0, false);
    previousPhase = phase;
  }
}

async function action(run: () => void | Promise<unknown>) {
  if (busy) return;
  busy = true; notice = ''; renderUi();
  try { await run(); }
  catch (error) { notice = error instanceof Error ? error.message : '操作失敗，請再試一次。'; }
  finally { busy = false; renderUi(); }
}

try { if (endpoint) client = new MultiplayerClient(endpoint); }
catch (error) { notice = error instanceof Error ? error.message : '連線設定無法使用。'; }
if (!endpoint) notice = '連線服務尚未開放，請稍後再來；你可以先回主選單遊玩其他模式。';

$('mp-create').addEventListener('click', () => void action(async () => { await client?.create($<HTMLInputElement>('mp-name').value, Number($<HTMLSelectElement>('mp-laps').value) as MultiplayerLaps, $<HTMLSelectElement>('mp-track').value); }));
$('mp-track').addEventListener('change', () => { synchronizeMap(); renderUi(); });
$('mp-room-track').addEventListener('change', () => { client?.selectTrack($<HTMLSelectElement>('mp-room-track').value); renderUi(); });
$('mp-map-retry').addEventListener('click', () => { synchronizeMap(true); renderUi(); });
$('mp-join').addEventListener('click', () => void action(async () => { await client?.join($<HTMLInputElement>('mp-code').value, $<HTMLInputElement>('mp-name').value); }));
$('mp-code').addEventListener('input', () => { const field = $<HTMLInputElement>('mp-code'); field.value = field.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6); });
$('mp-restore').addEventListener('click', () => void action(async () => { if (!await client?.restore()) notice = '目前沒有可以恢復的房間。'; }));
$('mp-ready').addEventListener('click', () => { const me = client?.room?.players.find(p => p.id === client?.selfId); client?.ready(!me?.ready); });
$('mp-start').addEventListener('click', () => client?.start());
$('mp-rematch').addEventListener('click', () => client?.reset());
function leave() { client?.leave(); notice = ''; sound.engine(0, 0, false); renderUi(); }
for (const id of ['mp-leave', 'mp-result-leave']) $(id).addEventListener('click', leave);
$('mp-race-leave').addEventListener('click', () => { if (confirm('離開這場比賽？這場會記為未完成，其他車手繼續比賽。')) leave(); $('mp-race-leave').blur(); });
$('mp-home').addEventListener('click', e => {
  if (client?.room && ['racing', 'countdown'].includes(client.room.phase) && !confirm('返回主選單會離開這場連線比賽，確定返回？')) { e.preventDefault(); $('mp-home').blur(); return; }
  client?.leave();
});
$('mp-copy').addEventListener('click', () => void action(async () => {
  const code = client?.room?.code; if (!code) return;
  try { await navigator.clipboard.writeText(code); notice = '房間碼已複製，傳給朋友即可加入。'; }
  catch { notice = `房間碼：${code}。長按或選取上方房間碼複製。`; }
}));
$('mp-camera').addEventListener('click', () => { scene?.toggleCamera(); $('mp-camera').blur(); });
$('mp-sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  if (soundEnabled) { soundEnabled = sound.start(); sound.setEngine('f1'); }
  if (!soundEnabled) sound.engine(0, 0, false);
  $('mp-sound').textContent = soundEnabled ? '關閉音效' : '開啟音效'; $('mp-sound').setAttribute('aria-pressed', String(soundEnabled));
  $('mp-sound').blur();
});
$('mp-reload').addEventListener('click', () => location.reload());
addEventListener('keydown', e => { if (e.code === 'Escape' && client?.room?.phase === 'racing') { $('mp-race-message').textContent = '連線比賽持續進行；需要離開時，請點「離開比賽」。'; } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { client?.sendInput(0, true); sound.engine(0, 0, false); }
  else if (soundEnabled) sound.unlock();
});
addEventListener('blur', () => { focused = false; client?.sendInput(0, true); sound.engine(0, 0, false); });
addEventListener('focus', () => { focused = true; });
addEventListener('pagehide', () => client?.disconnect());
addEventListener('pageshow', event => {
  focused = document.hasFocus();
  if (event.persisted && client && (client.room || client.hasSavedSession)) {
    busy = false;
    void action(() => client!.restore());
  }
});
client?.subscribe(() => { synchronizeMap(); renderUi(); });
client?.onSnapshot(room => { if (graphicsReady && scene?.matchesMap(room) && client?.selfId) scene.accept(room, client.selfId, client.serverNow()); });
renderUi();

try {
  scene = new MultiplayerScene($('mp-scene'));
  scene.onContextLost = () => { graphicsReady = false; mapLoadToken++; client?.sendInput(0, true); client?.disconnect(); sound.engine(0, 0, false); $('mp-graphics-error').hidden = false; };
  let previousAt = performance.now();
  scene.renderer.setAnimationLoop(() => {
    const at = performance.now(), dt = Math.min(.1, (at - previousAt) / 1000); previousAt = at;
    const drive = canDrive(), control = drive ? input.read() : { steer: 0, brake: true };
    const now = client?.serverNow() ?? Date.now();
    scene?.frame(dt, now, control.steer, control.brake, drive);
    const room = client?.room;
    if (room?.phase === 'countdown' && room.startAt) $('mp-countdown').textContent = String(Math.max(1, Math.ceil((room.startAt - now) / 1000)));
    else $('mp-countdown').textContent = '';
    const me = room?.players.find(p => p.id === client?.selfId);
    if (room?.startAt && room.phase !== 'countdown') $('mp-time').textContent = time(me?.finishMs ?? now - room.startAt);
    $('mp-speed').textContent = String(Math.round((scene?.car.v ?? 0) * 3.6));
    if (soundEnabled) sound.engine(.15 + .7 * Math.min(1, (scene?.car.v ?? 0) / 85), control.brake ? .1 : 1, drive);
  });
  synchronizeMap();
  renderUi();
  // 使用獨立時鐘傳輸，背景分頁停rAF時仍會先煞車；伺服器也另有輸入逾時保護。
  setInterval(() => {
    const control = canDrive() ? input.read() : { steer: 0, brake: true };
    if (client?.sendInput(control.steer, control.brake)) scene?.recordInput(client.serverNow(), control.steer, control.brake);
  }, 34);
} catch (error) {
  console.error('多人場景啟動失敗', error);
  $('mp-graphics-error').hidden = false;
  client?.disconnect();
}

// 本機隔離瀏覽器測試可讀真實client／物理狀態，沒有新增伺服器作弊操作。
(window as unknown as { __mp: unknown }).__mp = { client, get scene() { return scene; }, get ready() { return graphicsReady; }, input };
