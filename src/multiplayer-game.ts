import './multiplayer.css';
import {mountExpeditionPerformance} from './expedition-performance-ui';
import {mountExpeditionHud} from './expedition-hud-ui';
import {ExpeditionResolution} from './expedition-performance';
import {networkFeel,NETWORK_FEELS,NETWORK_FEEL_KEY} from './expedition-network';
import './voyager-platform.css';
import {mountVoyagerComfort} from './voyager-comfort';
import {mountResultCard} from './voyager-photo';
import {multiplayerResultCardData} from './voyager-result-data';
import {acquireAtlasPageLease} from './atlas-storage-lease';
import { MultiplayerClient } from './multiplayer-client';
import { MultiplayerScene } from './multiplayer-scene';
import { Input } from './input';
import { mountControlSettings } from './controls-ui';
import { mountControlHints } from './horizon-controls';
import './controls.css';
import { Sound } from './audio';
import { type MultiplayerLaps, type TrackSelection, validSeriesTracks } from '../shared/multiplayer-protocol';
import { MULTIPLAYER_TRACKS, DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack } from '../shared/multiplayer-tracks';
import { MultiplayerPlayerList, MultiplayerLapList, lapSummaryText, setText, dnfLabel, deadlineText } from './multiplayer-ui';
import { RenderPacer } from './frame-pacing';
import { parseMultiplayerInvite, buildMultiplayerInviteUrl, copyMultiplayerInvite, shareMultiplayerInvite } from './multiplayer-invite';
import { MultiplayerEntryWait, entryWaitText, ENTRY_CANCELLED } from './multiplayer-entry';
import { MultiplayerAutoQuality, MULTIPLAYER_QUALITY_KEY } from './multiplayer-quality';
import { MultiplayerSeriesPanel } from './multiplayer-series-ui';
import { spectatorTargets } from './multiplayer-spectator';
import { DEFAULT_ROOM_RULES, roomRulesText } from '../shared/multiplayer-room-rules';
import { MultiplayerAwareness } from './multiplayer-awareness';
import { MultiplayerHistory } from './multiplayer-history';
import { MultiplayerHistoryPanel } from './multiplayer-history-ui';
import { MultiplayerEvolutionPanel, modeLabel, releaseRemaining } from './multiplayer-evolution-ui';
import { MultiplayerHorizonPanel } from './multiplayer-horizon-ui';
import type { RoomPreset } from '../shared/multiplayer-horizon';
import { mountMultiplayerReplay } from './summit-lazy-replay';
import {MultiplayerArenaPanel} from './multiplayer-arena-ui';
import {MultiplayerArenaVisuals} from './multiplayer-arena-visuals';
import {SummitRacingPanel} from './summit-racing-ui';
import {mountDiagnostics} from './odyssey-diagnostics';
import {mountOdysseyGamepad} from './odyssey-gamepad';
import {FrontierCupPanel} from './frontier-cup-ui';
import {CUP_MATCH_LABELS} from '../shared/frontier-cup';

await acquireAtlasPageLease();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const time = (ms: number) => {
  const value = Math.max(0, ms), minutes = Math.floor(value / 60000);
  return `${minutes}:${((value % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
};
const localHost = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname);
const endpoint = String(import.meta.env.VITE_MULTIPLAYER_URL ?? '').trim() || (localHost && location.protocol === 'http:' ? `ws://${location.hostname}:4320/ws` : '');
const diagnostics = mountDiagnostics($('mp-entry'), endpoint, 'odyssey-mp-diagnostics');
let client: MultiplayerClient | null = null;
let scene: MultiplayerScene | null = null;
let graphicsReady = false, busy = false, notice = '', soundEnabled = false;
type EntryAction = 'create' | 'join' | 'restore' | 'resume-series' | 'claim-series' | 'watch' | 'preset';
let pendingRoomPreset: RoomPreset | null = null;
let pendingSeriesToken = '', pendingSeriesSeat = '';
let entryRetryKind: EntryAction | null = null, entryFeedback = '', hostTargetKey = '';
const entryWait = new MultiplayerEntryWait(() => renderUi());
let mapContextKey = '', mapLoadToken = 0, mapLoading = false, mapError = '', mapProgress = '', loadedAckKey = '';
let focused = document.hasFocus();
let previousPhase = '';
const playerLists = {
  lobby: new MultiplayerPlayerList($('mp-players'), 'lobby'),
  results: new MultiplayerPlayerList($('mp-results-list'), 'results'),
  board: new MultiplayerPlayerList($('mp-board'), 'board'),
};
const lapList = new MultiplayerLapList($('mp-laps-list'));
const seriesPanel = new MultiplayerSeriesPanel();
const evolutionPanel = new MultiplayerEvolutionPanel(() => client, text => { notice = text; renderUi(); },
  token => { pendingSeriesToken = token; enterRoom('resume-series'); },
  playerId => { pendingSeriesSeat = playerId; enterRoom('claim-series'); });
const awareness = new MultiplayerAwareness($('mp-track-mini'), $('mp-car-gaps'), $('mp-nearby'));
let historyStorage: Storage | null = null; try { historyStorage = localStorage; } catch { /* Private mode may deny storage. */ }
const recentHistory = new MultiplayerHistory(historyStorage);
const historyPanel = new MultiplayerHistoryPanel(recentHistory, $('mp-history-list'), $('mp-history-status'));
const autoQuality = new MultiplayerAutoQuality();
const expeditionResolution=new ExpeditionResolution();
let spectatorKey = '';
const horizonPanel = new MultiplayerHorizonPanel(() => client, fn => action(async () => { await fn(); }), () => enterRoom('watch'), preset => { pendingRoomPreset=preset; enterRoom('preset'); });
try { autoQuality.setMode(localStorage.getItem(MULTIPLAYER_QUALITY_KEY)); } catch { /* 本次仍可手動選擇 */ }
$<HTMLSelectElement>('mp-quality').value = autoQuality.mode;
function applyQuality() {
  scene?.setQuality(autoQuality.level);
  setText($('mp-quality-status'), `${autoQuality.mode === 'auto' ? '自動 · ' : ''}${autoQuality.level === 'economy' ? '省電畫質' : '標準畫質'}`);
}
$('mp-quality').addEventListener('change', () => {
  autoQuality.setMode($<HTMLSelectElement>('mp-quality').value);
  try { localStorage.setItem(MULTIPLAYER_QUALITY_KEY, autoQuality.mode); } catch { /* 本次設定仍有效 */ }
  expeditionResolution.reset();scene?.setRenderScale(performanceScale??1);applyQuality();
});
$('mp-series-count').addEventListener('change', () => seriesPanel.updateCount());
let lapDriverId: string | null = null, lapDriversKey = '';
const invitation = parseMultiplayerInvite(location.href);
if (invitation.status === 'valid') {
  $<HTMLInputElement>('mp-code').value = invitation.code;
  setText($('mp-invite-hint'), '已帶入朋友的房間碼。確認車手暱稱後，按「加入房間」。');
} else if (invitation.status === 'invalid') setText($('mp-invite-hint'), invitation.message);
const renderPacer = new RenderPacer();
const FPS_KEY = 'taipei-gp-multiplayer-fps-v1';
let renderLimit = 60, renderElapsed = 0;
try { if (localStorage.getItem(FPS_KEY) === '30') renderLimit = 30; } catch { /* 儲存不可用仍能調整本次畫面 */ }
$<HTMLSelectElement>('mp-fps').value = String(renderLimit);
$('mp-fps').addEventListener('change', () => {
  renderLimit = $<HTMLSelectElement>('mp-fps').value === '30' ? 30 : 60;
  try { localStorage.setItem(FPS_KEY, String(renderLimit)); } catch { /* 本次設定仍有效 */ }
  renderPacer.reset();
});
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
const arenaPanel=new MultiplayerArenaPanel(()=>client,input);
const arenaVisuals=new MultiplayerArenaVisuals();
const summitPanel=new SummitRacingPanel(()=>client);
const cupPanel=new FrontierCupPanel(()=>client);
mountControlSettings($('mp-control-settings'), input);
mountOdysseyGamepad({host:$('mp-control-settings'),input});
const voyagerComfortHost=document.createElement('div');$('mp-control-settings').after(voyagerComfortHost);mountVoyagerComfort(voyagerComfortHost);
let performanceScale:number|null=null;
const expeditionPerformance=mountExpeditionPerformance(voyagerComfortHost,'multiplayer',{
  context:()=>({
    mode:client?.room?[client.room.arena?.mode&&client.room.arena.mode!=='off'?'arena-'+client.room.arena.mode:client.room.evolution?.mode??'race',client.room.summit?.stage??'single',client.room.summit?.settings.endurance?'endurance':'',client.room.horizon?.elimination?'elimination':'',client.room.series?'series':''].filter(Boolean).join(':'):'lobby',track:client?.room?.trackId??$<HTMLSelectElement>('mp-track').value,
    quality:scene?.performanceContext.quality??autoQuality.level,fpsCap:renderLimit,
    viewportWidth:innerWidth,viewportHeight:innerHeight,dpr:devicePixelRatio,
    bufferWidth:scene?.renderer.domElement.width??0,bufferHeight:scene?.renderer.domElement.height??0,
    effectiveScale:scene?.performanceContext.effectiveScale??1,players:client?.room?.players.length??0,
    streamLoaded:scene?.performanceContext.streamLoaded??0,streamPending:scene?.performanceContext.streamPending??0,
  }),
  onScale:scale=>{performanceScale=scale;scene?.setRenderScale(scale??expeditionResolution.scale);},
});
const expeditionHud=mountExpeditionHud(voyagerComfortHost,'multiplayer',[
 {id:'speed',label:'時速',selector:'.mp-speed'},
 {id:'timing',label:'圈數與計時',selector:'.mp-race-stats'},
 {id:'board',label:'名次',selector:'#mp-board'},
 {id:'map',label:'近車與賽道',selector:'#mp-awareness'},
]);
const feelLabel=document.createElement('label');feelLabel.textContent='連線畫面平順度 ';
const feelSelect=document.createElement('select');feelSelect.id='expedition-network-feel';
for(const [value,text]of Object.entries(NETWORK_FEELS)){const option=document.createElement('option');option.value=value;option.textContent=text;feelSelect.append(option);}
try{feelSelect.value=networkFeel(localStorage.getItem(NETWORK_FEEL_KEY));}catch{feelSelect.value='balanced';}
const feelNote=document.createElement('p');feelNote.className='sub';feelNote.textContent='平順優先會增加畫面延遲；反應優先較易看見抖動。只調整呈現，碰撞和成績仍由伺服器決定。';
feelSelect.onchange=()=>{const mode=networkFeel(feelSelect.value);scene?.network.setMode(mode);try{localStorage.setItem(NETWORK_FEEL_KEY,mode);}catch{}};
feelLabel.append(feelSelect);voyagerComfortHost.append(feelLabel,feelNote);
mountResultCard($('mp-results'),()=>multiplayerResultCardData(client?.room,client?.room?getMultiplayerTrack(client.room.trackId)?.name:undefined),'voyager-mp-result-card');
mountControlHints(input, { multiplayer: true, steering: () => 'drag' });
const sound = new Sound();
const canDrive = () => !!client && client.status === 'connected' && client.room?.phase === 'racing' && releaseRemaining(client.room, client.selfId, client.serverNow()) === 0 && graphicsReady && !!scene?.matchesMap(client.room) && !!client.room.players.find(p => p.id === client?.selfId && p.loaded && !p.dnf && !p.timeTrialDone && !p.eliminated && !p.eliminationWinner && !p.block?.ghost && !(p.summit?.pitUntil&&p.summit.pitUntil>client!.serverNow()) && p.arena?.active!==false && p.cup?.active!==false && p.finishMs === null) && focused && !document.hidden && expeditionHud.editor.hidden && !scene.contextLost;
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
  scene?.network.reset();
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

function renderUi() {
  if (!canDrive()) input.release();
  if (!client?.room?.cup&&recentHistory.capture(client?.room ?? null, client?.selfId ?? null)) historyPanel.render();
  historyPanel.render();
  const room = client?.room, me = room?.players.find(p => p.id === client?.selfId);
  const phase = room?.phase ?? '', active = phase === 'countdown' || phase === 'racing';
  const connected = client?.status === 'connected';
  const localMapReady = graphicsReady && !!room && !!scene?.matchesMap(room) && (!!me?.loaded || !!client?.isSpectator);
  seriesPanel.render(room ?? null, client?.selfId ?? null, connected, busy);
  evolutionPanel.render(room ?? null, client?.selfId ?? null, connected, busy);
  arenaPanel.render(room??null,client?.selfId??null,connected,busy,client?.serverNow()??Date.now());
  const targets = spectatorTargets(room ?? null, client?.selfId ?? null);
  const watching = targets.length > 0 && localMapReady;
  $('mp-spectator-field').hidden = !watching;
  $('mp-controls').hidden = !!me && (me.dnf || me.finishMs !== null || !!me.timeTrialDone || me.arena?.active===false || me.cup?.active===false);
  const targetKey = JSON.stringify([room?.code, room?.matchId, targets.map(player => [player.id, player.name])]);
  if (targetKey !== spectatorKey) {
    spectatorKey = targetKey; const select = $<HTMLSelectElement>('mp-spectator'); select.replaceChildren();
    for (const target of targets) { const option = document.createElement('option'); option.value = target.id; option.textContent = target.name; select.appendChild(option); }
  }
  if (watching) { scene?.setSpectatorTarget(scene.spectatorId); $<HTMLSelectElement>('mp-spectator').value = scene?.spectatorId ?? targets[0].id; }
  const connectionLabels = { idle: '尚未連線', connecting: '正在連線…', connected: '已連線', reconnecting: '正在重新連線…', disconnected: '連線已中斷' };
  setText($('mp-connection'), client ? `${connectionLabels[client.status]}${connected && client.rttMs !== null ? ` · ${Math.round(client.rttMs)} ms` : ''}` : '連線對戰尚未開放');
  setText($('mp-message'), mapError || entryFeedback || (!entryWait.active ? client?.error : '') || notice);
  $('mp-entry-wait').hidden = !entryWait.active || !!room;
  setText($('mp-entry-progress'), entryWaitText(entryWait.state));
  $('mp-entry-retry').hidden = !entryRetryKind || !!room || entryWait.active;
  $<HTMLButtonElement>('mp-entry-retry').disabled = busy || !client || !scene || scene.contextLost;
  setText($('mp-loading'), room && !connected ? '重新連線後會確認目前的比賽地圖。' : mapProgress || '正在準備賽道…');
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
  for (const id of ['mp-name', 'mp-code', 'mp-laps']) $<HTMLInputElement | HTMLSelectElement>(id).disabled = busy;
  $('mp-restore').hidden = !!room || !client?.hasSavedSession;
  $<HTMLButtonElement>('mp-restore').disabled = !scene || scene.contextLost || busy;
  if (room) {
    const descriptor = getMultiplayerTrack(room.trackId)!;
    const trackLabel = `${descriptor.flag} ${descriptor.name}`;
    setText($('mp-room-code'), room.code);
    setText($('mp-room-description'), `${trackLabel} · ${modeLabel(room.evolution?.mode)} · ${room.evolution?.mode === 'time-trial' ? `${room.evolution.durationSeconds / 60} 分鐘` : `${room.laps} 圈`} · ${room.players.length} / 4 人`);
    $<HTMLSelectElement>('mp-room-track').value = room.trackId;
    $<HTMLSelectElement>('mp-room-track').disabled = !connected || room.hostId !== client?.selfId || phase !== 'lobby' || !!room.series;
    $('mp-room-laps-field').hidden = !room.capabilities?.lobbyOptions;
    const rules = room.roomRules ?? DEFAULT_ROOM_RULES;
    const canSetRules = !!room.capabilities?.roomRules && room.hostId === client?.selfId && room.phase === 'lobby' && !room.series?.locked;
    $('mp-room-rules').hidden = !room.capabilities?.roomRules;
    $<HTMLSelectElement>('mp-collisions').value = rules.collisions ? 'on' : 'off';
    $<HTMLSelectElement>('mp-finish-grace').value = String(rules.finishGraceSeconds);
    for (const id of ['mp-collisions', 'mp-finish-grace']) $<HTMLSelectElement>(id).disabled = !connected || busy || !canSetRules || id === 'mp-collisions' && ['time-trial', 'teams'].includes(room.evolution?.mode ?? '');
    setText($('mp-rules-description'), roomRulesText(rules) + (room.capabilities?.roomRules ? '' : '（舊版預設）'));
    setText($('mp-race-rules'), `${rules.collisions ? '一般碰撞' : '無碰撞練習'} · 寬限${rules.finishGraceSeconds}秒`); setText($('mp-result-rules'), roomRulesText(rules));
    $<HTMLSelectElement>('mp-room-laps').value = String(room.laps);
    $<HTMLSelectElement>('mp-room-laps').disabled = !connected || busy || room.hostId !== client?.selfId || phase !== 'lobby';
    setText($('mp-map-policy'), room.series ? '系列賽依設定路線前進；結束系列後可恢復自由換圖。' : '只有房主能在大廳換地圖；換圖後所有人需要重新準備。');
    setText($('mp-map-status'), !connected ? '等待重新連線以確認地圖。' : mapError ? '載入失敗，可重試或由房主更換地圖。' : !localMapReady ? mapLoading ? mapProgress : '正在確認地圖載入狀態…' : room.players.some(p => !p.loaded) ? '你的地圖已就緒，等待其他車手載入。' : '所有車手地圖已就緒，準備好即可開始。');
    $('mp-map-status').dataset.loading = String(!localMapReady);
    if (phase === 'lobby') playerLists.lobby.update(room, client?.selfId);
    const hostControls = phase === 'lobby' && room.hostId === client?.selfId && !!room.hostManagement;
    $('mp-host-controls').hidden = !hostControls;
    if (hostControls) syncHostTargets(room, client?.selfId ?? null);
    const target = room.players.find(player => player.id === $<HTMLSelectElement>('mp-host-target').value && player.id !== client?.selfId);
    $<HTMLSelectElement>('mp-host-target').disabled = !connected || busy || !target;
    $<HTMLButtonElement>('mp-host-kick').disabled = !connected || busy || !target;
    $<HTMLButtonElement>('mp-host-transfer').disabled = !connected || busy || !target?.connected;
    setText($('mp-ready'), me?.ready ? '取消準備' : '我準備好了');
    $<HTMLButtonElement>('mp-ready').disabled = !connected || !localMapReady;
    $('mp-start').hidden = room.hostId !== client?.selfId || !!room.cup;
    const teamsReady = room.evolution?.mode !== 'teams' || room.players.length === 4 && !!room.series && ['red', 'blue'].every(team => room.players.filter(p => room.evolution?.teams[p.id] === team).length === 2);
    $<HTMLButtonElement>('mp-start').disabled = !connected || !localMapReady || room.players.length < 2 || !teamsReady || room.players.some(p => !p.ready || !p.connected || !p.loaded);
    setText($('mp-start'), !teamsReady ? '需要四人、每隊兩人與系列路線' : room.players.length < 2 ? '等待朋友加入' : room.players.some(p => !p.loaded) ? '等待地圖載入' : room.players.some(p => !p.ready || !p.connected) ? '等待全員準備' : '開始倒數');
    setText($('mp-result-track'), `${trackLabel} · ${modeLabel(room.evolution?.mode)} · ${room.evolution?.mode === 'time-trial' ? `${room.evolution.durationSeconds / 60} 分鐘` : `${room.laps} 圈`}`);
    setText($('mp-race-track'), room.cup ? `${CUP_MATCH_LABELS[room.cup.matches[room.cup.index].key]} · ${trackLabel}` : room.series ? `系列 ${room.series.roundIndex + 1}/${room.series.trackIds.length} · ${trackLabel}` : trackLabel);
    if (phase === 'results') playerLists.results.update(room, client?.selfId);
    if (phase === 'results') {
      syncLapDriver(room, client?.selfId ?? null);
      lapList.update(room, lapDriverId);
      setText($('mp-laps-summary'), lapSummaryText(room, lapDriverId));
    } else { lapList.clear(); lapDriverId = null; lapDriversKey = ''; }
    const invitationUrl = buildMultiplayerInviteUrl(location.href, room.code) ?? '';
    if ($<HTMLInputElement>('mp-invite-url').value !== invitationUrl) $<HTMLInputElement>('mp-invite-url').value = invitationUrl;
    $<HTMLButtonElement>('mp-copy-link').disabled = !invitationUrl;
    $<HTMLButtonElement>('mp-share-link').disabled = !invitationUrl;
    $('mp-rematch').hidden = room.hostId !== client?.selfId || !!room.cup;
    $<HTMLButtonElement>('mp-rematch').disabled = !connected || !!room.series?.complete;
    setText($('mp-rematch'), room.series ? room.series.complete ? '系列賽已完成' : '前往下一站' : '再來一場');
    setText($('mp-results-note'), room.series?.complete ? '系列賽已完成，可查看總積分與歷場成績；房主結束系列後可再開新賽事。' : room.hostId === client?.selfId ? '下一場會回到大廳，請所有人重新準備。' : '等房主開啟下一場，或離開房間。');
    if (active && !mapError) playerLists.board.update(room, client?.selfId);
    if (me) {
      setText($('mp-position'), me.cup?.active===false?'觀戰':`P${me.rank}`);
      setText($('mp-lap'), me.cup?.active===false?'原席候場':room.evolution?.mode === 'time-trial' ? `已完成 ${me.completedLaps} 圈` : `${Math.min(room.laps, me.completedLaps + 1)} / ${room.laps} 圈`);
      setText($('mp-last-lap'), me.cup?.active===false?'本場原席觀戰，不列圈速':me.bestLapMs != null ? `最快圈 ${time(me.bestLapMs)}` : me.lapTimesMs === undefined ? '' : '尚未完成單圈');
    }
    setText($('mp-race-message'), !connected ? '連線中斷，自車已煞停；正在重連，其他車手繼續比賽。'
      : !localMapReady ? '正在載入並確認比賽地圖，自車保持煞車。'
      : me?.cup?.active===false ? `你留在原席觀戰，本場不列 DNF。${watching?`正在追看 ${targets.find(player=>player.id===scene?.spectatorId)?.name??targets[0].name}`:'等待兩位出賽車手'}。`
      : me?.dnf ? `本場未完成：${dnfLabel(me.dnfReason)}；${watching ? `觀戰 ${targets.find(player => player.id === scene?.spectatorId)?.name ?? targets[0].name}` : '等待其他車手完賽'}。`
      : me?.timeTrialDone && phase !== 'results' ? `末圈完成，等待結算${watching ? ` · 觀戰 ${targets.find(player => player.id === scene?.spectatorId)?.name ?? targets[0].name}` : ''}。`
      : me?.finishMs !== null && me?.finishMs !== undefined ? `🏁 你已完賽：${time(me.finishMs)}，${watching ? `觀戰 ${targets.find(player => player.id === scene?.spectatorId)?.name ?? targets[0].name}` : '等待其他車手'}。`
      : phase === 'countdown' ? '同步起跑準備中' : '');
  } else {
    $('mp-room-laps-field').hidden = true;
    $('mp-host-controls').hidden = true; hostTargetKey = '';
    for (const list of Object.values(playerLists)) list.clear();
    lapList.clear(); lapDriverId = null; lapDriversKey = '';
    $<HTMLInputElement>('mp-invite-url').value = '';
    setText($('mp-last-lap'), ''); setText($('mp-laps-summary'), '');
  }
  if (phase !== previousPhase) {
    if (active && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (phase === 'results') sound.engine(0, 0, false);
    previousPhase = phase;
  }
  horizonPanel.render(busy);
  summitPanel.render(room??null,client?.selfId??null,connected,busy,client?.serverNow()??Date.now());
  cupPanel.render(room??null,client?.selfId??null,connected,busy);
}

function syncHostTargets(room: NonNullable<MultiplayerClient['room']>, selfId: string | null) {
  const select = $<HTMLSelectElement>('mp-host-target');
  const targets = room.players.filter(player => player.id !== selfId);
  const key = JSON.stringify([room.code, selfId, targets.map(player => [player.id, player.name, player.connected])]);
  if (hostTargetKey !== key) {
    const previous = select.value; select.replaceChildren();
    for (const player of targets) {
      const option = document.createElement('option'); option.value = player.id;
      option.textContent = `${player.name}${player.connected ? '' : '（暫時離線）'}`; select.appendChild(option);
    }
    select.value = targets.some(player => player.id === previous) ? previous : targets[0]?.id ?? '';
    hostTargetKey = key;
  }
}

function syncLapDriver(room: NonNullable<MultiplayerClient['room']>, selfId: string | null) {
  const select = $<HTMLSelectElement>('mp-lap-driver');
  const players=room.players.filter(player=>player.cup?.active!==false);
  const key = JSON.stringify(players.map(player => [player.id, player.name, player.id === selfId]));
  if (key !== lapDriversKey) {
    select.replaceChildren();
    for (const player of players) {
      const option = document.createElement('option'); option.value = player.id;
      option.textContent = `${player.name}${player.id === selfId ? '（你）' : ''}`; select.appendChild(option);
    }
    lapDriversKey = key;
  }
  if (!players.some(player => player.id === lapDriverId)) lapDriverId = selfId && players.some(player => player.id === selfId) ? selfId : players[0]?.id ?? null;
  select.value = lapDriverId ?? '';
}

async function action(run: () => void | Promise<unknown>) {
  if (busy) return;
  busy = true; notice = ''; entryFeedback = ''; renderUi();
  try { await run(); }
  catch (error) { notice = error instanceof Error ? error.message : '操作失敗，請再試一次。'; if (!client?.room) entryFeedback = notice; }
  finally { busy = false; renderUi(); }
}

function enterRoom(kind: EntryAction) {
  void action(async () => {
    const connection = client; if (!connection) return;
    entryRetryKind = null;
    const name = $<HTMLInputElement>('mp-name').value;
    const code = $<HTMLInputElement>('mp-code').value;
    const laps = Number($<HTMLSelectElement>('mp-laps').value) as MultiplayerLaps;
    const trackId = $<HTMLSelectElement>('mp-track').value;
    if (kind !== 'restore') {
      const clean = name.trim().replace(/[\u0000-\u001f\u007f]/g, '');
      if (!clean || [...clean].length > 16) throw new Error('請輸入 1～16 個字的車手名稱。');
      if ((kind === 'join' || kind === 'claim-series') && !/^[A-HJ-NP-Z2-9]{6}$/.test(code.trim().toUpperCase())) throw new Error('請輸入正確的 6 碼房間碼。');
      if (kind === 'create' && !graphicsReady) throw new Error('請等賽道準備完成後再建立房間。');
    } else if (!connection.hasSavedSession) { notice = '目前沒有可以恢復的房間。'; return; }
    try {
      await entryWait.open(connection);
      // Only the handshake is retried. Each room request is sent once.
      if (kind === 'create') await connection.create(name, laps, trackId);
      else if (kind === 'join') await connection.join(code, name);
      else if (kind === 'watch') await connection.watch(code, name);
      else if (kind === 'preset') { if(!pendingRoomPreset)throw Error('請先選擇房間範本。'); await connection.createConfigured(name,pendingRoomPreset); pendingRoomPreset=null; }
      else if (kind === 'resume-series') { await connection.resumeSeries(pendingSeriesToken, name); pendingSeriesToken = ''; }
      else if (kind === 'claim-series') await connection.claimSeriesSeat(code, pendingSeriesSeat);
      else if (!await connection.restore()) notice = '目前沒有可以恢復的房間。';
    } catch (error) {
      entryFeedback = error instanceof Error ? error.message : '無法加入房間。';
      if (entryFeedback !== ENTRY_CANCELLED) entryRetryKind = kind;
      throw error;
    }
  });
}

function managePlayer(kind: 'kick' | 'transfer') {
  const room = client?.room, selfId = client?.selfId;
  const target = room?.players.find(player => player.id === $<HTMLSelectElement>('mp-host-target').value && player.id !== selfId);
  if (busy || !client || client.status !== 'connected' || room?.phase !== 'lobby' || room.hostId !== selfId || !room.hostManagement || !target || (kind === 'transfer' && !target.connected)) return;
  const code = room.code, revision = room.hostManagement.lobbyRevision;
  if (!confirm(kind === 'kick' ? `將「${target.name}」移出大廳？對方仍可重新輸入房碼加入。` : `將房主交給「${target.name}」？你仍會留在房間。`)) return;
  const current = client.room;
  if (client.status !== 'connected' || client.selfId !== selfId || current?.code !== code || current.phase !== 'lobby' || current.hostId !== selfId || current.hostManagement?.lobbyRevision !== revision || !current.players.some(player => player.id === target.id && (kind !== 'transfer' || player.connected))) {
    notice = '大廳狀態已變更，請重新選擇車手。'; renderUi(); return;
  }
  const sent = kind === 'kick' ? client.kickPlayer(target.id) : client.transferHost(target.id);
  if (sent) notice = kind === 'kick' ? '已送出移出請求，等待大廳更新。' : '已送出交棒請求，等待大廳更新。';
  renderUi();
}

try { if (endpoint) client = new MultiplayerClient(endpoint); }
catch (error) { notice = error instanceof Error ? error.message : '連線設定無法使用。'; }
if (!endpoint) notice = '連線服務尚未開放，請稍後再來；你可以先回主選單遊玩其他模式。';

$('mp-create').addEventListener('click', () => enterRoom('create'));
$('mp-track').addEventListener('change', () => { synchronizeMap(); renderUi(); });
$('mp-room-track').addEventListener('change', () => { client?.selectTrack($<HTMLSelectElement>('mp-room-track').value); renderUi(); });
$('mp-room-laps').addEventListener('change', () => { client?.setLaps(Number($<HTMLSelectElement>('mp-room-laps').value) as MultiplayerLaps); renderUi(); });
for (const id of ['mp-collisions', 'mp-finish-grace']) $(id).addEventListener('change', () => {
  client?.setRoomRules({ collisions: $<HTMLSelectElement>('mp-collisions').value === 'on', finishGraceSeconds: Number($<HTMLSelectElement>('mp-finish-grace').value) as 30 | 60 | 120 }); renderUi();
});
$('mp-history-export').addEventListener('click', () => {
  try { const blob = new Blob([recentHistory.export()], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'taipei-gp-multiplayer-history.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('mp-history-status').textContent = '已匯出近期戰績；檔案包含對手暱稱，分享前請先確認。';
  } catch { $('mp-history-status').textContent = '無法下載，請確認瀏覽器允許下載後再試。'; }
});
$('mp-history-clear').addEventListener('click', () => { if (confirm('清除這個瀏覽器的近期多人戰績？已下載的檔案需自行刪除。')) { recentHistory.clear(); historyPanel.render(); } });
$('mp-series-create').addEventListener('click', () => {
  const tracks = seriesPanel.selectedTracks();
  if (!validSeriesTracks(tracks)) { notice = '請選擇三至五張不重複的地圖。'; renderUi(); return; }
  if (client?.configureSeries(tracks)) notice = '已送出系列路線設定，全員需要重新準備。'; renderUi();
});
$('mp-series-end').addEventListener('click', () => {
  const room = client?.room, selfId = client?.selfId;
  if (!room?.series || room.hostId !== selfId || !room.capabilities?.championship || !room.hostManagement || !['lobby', 'results'].includes(room.phase)) return;
  const code = room.code, revision = room.hostManagement.lobbyRevision, seriesId = room.series.id;
  if (!confirm('結束目前系列賽？總積分與歷場成績將清除，改回單場模式。')) return;
  const current = client?.room;
  if (client?.status !== 'connected' || current?.code !== code || current.hostId !== selfId || current.hostManagement?.lobbyRevision !== revision || current.series?.id !== seriesId) { notice = '房間狀態已更新，請確認後重試。'; renderUi(); return; }
  client.endSeries(); renderUi();
});
$('mp-spectator').addEventListener('change', () => { scene?.setSpectatorTarget($<HTMLSelectElement>('mp-spectator').value); renderUi(); });
$('mp-map-retry').addEventListener('click', () => { synchronizeMap(true); renderUi(); });
$('mp-join').addEventListener('click', () => enterRoom('join'));
$('mp-code').addEventListener('input', () => { const field = $<HTMLInputElement>('mp-code'); field.value = field.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6); });
$('mp-restore').addEventListener('click', () => enterRoom('restore'));
$('mp-cancel-connect').addEventListener('click', () => { if (entryWait.cancel()) { entryRetryKind = null; entryFeedback = ENTRY_CANCELLED; renderUi(); } });
$('mp-entry-retry').addEventListener('click', () => { if (entryRetryKind) enterRoom(entryRetryKind); });
$('mp-host-target').addEventListener('change', () => renderUi());
$('mp-host-kick').addEventListener('click', () => managePlayer('kick'));
$('mp-host-transfer').addEventListener('click', () => managePlayer('transfer'));
$('mp-ready').addEventListener('click', () => { const me = client?.room?.players.find(p => p.id === client?.selfId); client?.ready(!me?.ready); });
$('mp-start').addEventListener('click', () => client?.start());
$('mp-rematch').addEventListener('click', () => client?.room?.series ? client.nextSeries() : client?.reset());
$('mp-lap-driver').addEventListener('change', () => { lapDriverId = $<HTMLSelectElement>('mp-lap-driver').value; renderUi(); });
function leave() { client?.leave(); notice = ''; sound.engine(0, 0, false); renderUi(); }
for (const id of ['mp-leave', 'mp-result-leave']) $(id).addEventListener('click', leave);
$('mp-race-leave').addEventListener('click', () => {
  const me = client?.room?.players.find(player => player.id === client?.selfId);
  const message = me?.finishMs != null ? '離開觀戰？已完成的成績會保留，其他車手繼續比賽。' : me?.dnf ? '離開觀戰？其他車手會繼續比賽。' : '離開這場比賽？這場會記為未完成，其他車手繼續比賽。';
  if (confirm(message)) leave(); $('mp-race-leave').blur();
});
$('mp-home').addEventListener('click', e => {
  if (client?.room && ['racing', 'countdown'].includes(client.room.phase) && !confirm('返回主選單會離開這場連線比賽，確定返回？')) { e.preventDefault(); $('mp-home').blur(); return; }
  client?.leave();
});
$('mp-copy').addEventListener('click', () => void action(async () => {
  const code = client?.room?.code; if (!code) return;
  try { await navigator.clipboard.writeText(code); notice = '房間碼已複製，傳給朋友即可加入。'; }
  catch { notice = `房間碼：${code}。長按或選取上方房間碼複製。`; }
}));
for (const id of ['mp-copy-link', 'mp-share-link']) $(id).addEventListener('click', () => void action(async () => {
  const code = client?.room?.code; if (!code) return;
  const url = buildMultiplayerInviteUrl(location.href, code); if (!url) { notice = '邀請連結尚未就緒，請傳送六碼房間碼。'; return; }
  const result = id === 'mp-copy-link'
    ? await copyMultiplayerInvite(url, navigator.clipboard?.writeText ? text => navigator.clipboard.writeText(text) : undefined)
    : await shareMultiplayerInvite(url, navigator.share ? data => navigator.share(data) : undefined);
  if (client?.room?.code === code) notice = result.message;
}));
$('mp-invite-url').addEventListener('click', () => $<HTMLInputElement>('mp-invite-url').select());
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
  renderPacer.reset(); renderElapsed = 0; autoQuality.reset();if(performanceScale===null)expeditionResolution.reset();scene?.setRenderScale(performanceScale??expeditionResolution.scale);
  if (document.hidden) { client?.sendInput(0, true); sound.engine(0, 0, false); }
  else if (soundEnabled) sound.unlock();
});
addEventListener('blur', () => { focused = false; client?.sendInput(0, true); sound.engine(0, 0, false); });
addEventListener('focus', () => { focused = true; });
addEventListener('pagehide', () => { diagnostics.cancel(); entryWait.cancel(); client?.disconnect(); });
addEventListener('pageshow', event => {
  focused = document.hasFocus();
  if (event.persisted && client && (client.room || client.hasSavedSession)) {
    busy = false;
    void action(() => client!.restore());
  }
});
client?.subscribe(() => { synchronizeMap(); renderUi(); });
client?.onSeriesCheckpoint(value => evolutionPanel.receiveCheckpoint(value));
client?.onSnapshot(room => { if (graphicsReady && scene?.matchesMap(room) && client?.selfId) scene.accept(room, client.selfId, client.serverNow()); });
renderUi();

try {
  scene = new MultiplayerScene($('mp-scene'));
  scene.network.setMode(networkFeel(feelSelect.value));
  applyQuality();
  scene.onContextLost = () => { expeditionPerformance.stop();graphicsReady = false; mapLoadToken++; client?.sendInput(0, true); client?.disconnect(); sound.engine(0, 0, false); $('mp-graphics-error').hidden = false; };
  let previousAt = performance.now();
  scene.renderer.setAnimationLoop(() => {
    const at = performance.now(),rawDelta=(at-previousAt)/1000,dt=Math.min(.1,rawDelta);previousAt=at;
    const drive = canDrive(), control = drive ? input.read() : { steer: 0, brake: true };
    const now = client?.serverNow() ?? Date.now();
    const room = client?.room;
    arenaPanel.sample('handbrake'in control&&!!control.handbrake,drive);
    const active = room?.phase === 'countdown' || room?.phase === 'racing';
    if (performanceScale===null&&autoQuality.sample(dt, !!active && graphicsReady && focused && !document.hidden)) applyQuality();
    if(performanceScale===null&&expeditionResolution.sample(rawDelta,autoQuality.mode==='auto'&&!!active&&graphicsReady&&focused&&!document.hidden))scene?.setRenderScale(expeditionResolution.scale);
    const draw = !document.hidden && renderPacer.due(at, active ? renderLimit : 10);
    renderElapsed += dt;
    // 預測、碰撞校正每次動畫回呼都推進；只節流繪圖及HUD。
    scene?.frame(dt, now, control.steer, control.brake, drive, draw, renderElapsed);
    if (draw) {
      arenaPanel.render(room??null,client?.selfId??null,client?.status==='connected',busy,now);
      summitPanel.render(room??null,client?.selfId??null,client?.status==='connected',busy,now);
      cupPanel.render(room??null,client?.selfId??null,client?.status==='connected',busy);
      if(scene&&graphicsReady)arenaVisuals.update(scene.scene,scene.track,room??null,now);
      renderElapsed = 0;
      setText($('mp-countdown'), room?.phase === 'countdown' && room.startAt ? String(Math.max(1, Math.ceil((room.startAt - now) / 1000))) : '');
      const me = room?.players.find(p => p.id === client?.selfId);
      const releaseMs = releaseRemaining(room, client?.selfId, now);
      setText($('mp-release'), releaseMs > 0 ? `你的放行倒數 ${(releaseMs / 1000).toFixed(1)} 秒` : room?.evolution?.mode === 'pursuit' && room.phase === 'racing' ? '已放行 · 共同時鐘計名次' : '');
      if (room?.startAt && room.phase !== 'countdown') setText($('mp-time'), time(me?.finishMs ?? now - room.startAt));
      setText($('mp-deadline'), deadlineText(room, now));
      setText($('mp-network-warning'), room?.phase === 'racing' ? scene?.network.warning(at) ?? '' : '');
      if (($('mp-awareness') as HTMLDetailsElement).open) awareness.update(graphicsReady ? scene?.track ?? null : null, room ?? null, scene?.spectatorId ?? client?.selfId ?? null, at);
      setText($('mp-speed'), String(Math.round((scene?.spectatorId ? scene.viewSpeed : scene?.car.v ?? 0) * 3.6)));
    }
    if(scene)expeditionPerformance.sample(rawDelta,scene.lastRenderCpuMs!==null,document.hidden?'hidden':!active?'menu':!graphicsReady||!focused||scene.contextLost?'inactive':true,scene.renderer.info,scene.lastRenderCpuMs===null?{}:{renderCpuMs:scene.lastRenderCpuMs});
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
const replayPanel=mountMultiplayerReplay(()=>client);
(window as unknown as { __mp: unknown }).__mp = { client, get scene() { return scene; }, get ready() { return graphicsReady; }, input, replay:replayPanel,expeditionHud,expeditionPerformance,expeditionResolution };
