import type { RoomSnapshot } from '../shared/multiplayer-protocol';
import type { MultiplayerEventMode, ReleaseDelaySeconds } from '../shared/multiplayer-evolution';
import { MULTIPLAYER_TRACKS } from '../shared/multiplayer-tracks';
import type { MultiplayerClient } from './multiplayer-client';
import { setText } from './multiplayer-ui';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CHECKPOINT_KEY = 'taipei-gp-multiplayer-series-checkpoint-v1';
type Checkpoint = { token: string; expiresAt: number; persistent: boolean; endpoint: string };
export const modeLabel = (mode: string | undefined) => ({ race: '圈數競速', 'time-trial': '限時最快圈', pursuit: '讓秒追逐', teams: '四人 2 對 2', elimination: '定時末位淘汰',relay:'雙隊接力',items:'補給道具賽' }[mode ?? 'race'] ?? '圈數競速');
export function eventDescription(room: RoomSnapshot): string {
  const e = room.evolution;
  if (!e || e.mode === 'race') return '依伺服器記錄的實際完賽順序排名。';
  if (e.mode === 'time-trial') return `${e.durationSeconds / 60} 分鐘最快有效圈 · 固定無碰撞 · 時限後只允許完成當圈，最長寬限 ${room.roomRules?.finishGraceSeconds ?? 60} 秒 · 未完成有效圈為 DNF。`;
  if (e.mode === 'pursuit') return '依共同起跑時鐘的實際先完賽順序排名；放行前完全靜止。成績同列共同完賽時間與個人淨跑時間，淨跑時間不決定勝負。';
  return '固定四位、每隊兩位的系列賽 · 個人名次累計隊分，DNF 0 分 · 隊友仍碰撞。隊分同分依分站勝數、個人勝場、完賽數、總時間及紅隊先後決勝。';
}
export function releaseRemaining(room: RoomSnapshot | null | undefined, selfId: string | null | undefined, now: number): number {
  if (room?.evolution?.mode !== 'pursuit' || room.startAt === null || room.phase !== 'racing' || !selfId) return 0;
  return Math.max(0, room.startAt + (room.evolution.releaseDelays[selfId] ?? 0) * 1000 - now);
}

/** Opaque checkpoints stay outside snapshots, telemetry and recent-race exports. */
export class MultiplayerEvolutionPanel {
  private configKey = ''; private voteKey = ''; private seatsKey = '';
  private checkpoint: Checkpoint | null = null; private downloadUrl = '';
  private importGeneration = 0; private busy = false; private pageActive = true;
  private delaySelects = new Map<string, HTMLSelectElement>();
  constructor(private client: () => MultiplayerClient | null, private notice: (text: string) => void,
    private resume: (token: string) => void, private claim: (playerId: string) => void) {
    for (const track of MULTIPLAYER_TRACKS) { const o = document.createElement('option'); o.value = track.id; o.textContent = `${track.flag} ${track.name}`; $('mp-vote-track').append(o); }
    $('mp-event-mode').addEventListener('change', () => this.toggleFields());
    $('mp-event-apply').addEventListener('click', () => {
      const delays: Record<string, ReleaseDelaySeconds> = {};
      this.delaySelects.forEach((s, id) => { delays[id] = Number(s.value) as ReleaseDelaySeconds; });
      if (this.client()?.configureEvent($<HTMLSelectElement>('mp-event-mode').value as MultiplayerEventMode,
        Number($<HTMLSelectElement>('mp-event-duration').value) as 180 | 300, delays)) this.notice('已送出玩法設定，全員需要重新準備。');
    });
    for (const team of ['red', 'blue'] as const) $(`mp-team-${team}`).addEventListener('click', () => this.client()?.selectTeam(team));
    $('mp-vote-submit').addEventListener('click', () => this.client()?.voteTrack($<HTMLSelectElement>('mp-vote-track').value));
    $('mp-vote-resolve').addEventListener('click', () => this.client()?.resolveVote());
    $('mp-series-random').addEventListener('click', () => this.client()?.randomSeries(Number($<HTMLSelectElement>('mp-series-count').value) as 3 | 4 | 5));
    $('mp-series-checkpoint-save').addEventListener('click', () => {
      if (this.client()?.checkpointSeries()) setText($('mp-series-checkpoint-status'), '正在向伺服器取得已結算的簽名續賽檔…');
    });
    $('mp-series-checkpoint-download').addEventListener('click', () => this.download());
    $('mp-series-resume-saved').addEventListener('click', () => { this.cancelImport(); const cp = this.readCheckpoint(); if (cp) this.resume(cp.token); });
    $('mp-series-resume-paste').addEventListener('click', () => {
      this.cancelImport();
      const input = $<HTMLInputElement>('mp-series-resume-token'), token = input.value.trim();
      if (!token) { setText($('mp-series-resume-status'), '請選擇續賽檔或貼上原房主保存的憑證。'); return; }
      input.value = ''; this.resume(token);
    });
    $('mp-series-resume-file').addEventListener('change', () => void this.importFile());
    $('mp-series-seat-claim').addEventListener('click', () => { this.cancelImport(); this.claim($<HTMLSelectElement>('mp-series-seat').value); });
    $('mp-series-import-cancel').addEventListener('click', () => { this.cancelImport(); setText($('mp-series-resume-status'), '已取消讀取續賽檔。'); });
    for (const id of ['mp-create', 'mp-join', 'mp-restore', 'mp-entry-retry', 'mp-cancel-connect', 'mp-home']) {
      $(id)?.addEventListener('click', () => this.cancelImport());
    }
    for (const id of ['mp-code', 'mp-name', 'mp-series-resume-token', 'mp-series-seat']) {
      $(id)?.addEventListener('input', () => this.cancelImport());
    }
    if (typeof addEventListener === 'function') {
      addEventListener('pagehide', () => { this.pageActive = false; this.cancelImport(); this.revokeDownload(); });
      addEventListener('pageshow', () => { this.pageActive = true; this.cancelImport(); });
    }
  }
  private cancelImport() { this.importGeneration++; $('mp-series-import-cancel').hidden = true; }
  private revokeDownload() { if (this.downloadUrl) { URL.revokeObjectURL(this.downloadUrl); this.downloadUrl = ''; } }
  private toggleFields() {
    const mode = $<HTMLSelectElement>('mp-event-mode').value;
    $('mp-event-duration-field').hidden = mode !== 'time-trial'; $('mp-event-delays').hidden = mode !== 'pursuit';
  }
  receiveCheckpoint(value: { token: string; expiresAt: number; persistent: boolean }) {
    const client = this.client(); if (!client || client.room?.hostId !== client.selfId) return;
    this.checkpoint = { ...value, endpoint: client.url };
    let stored = true; try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(this.checkpoint)); } catch { stored = false; }
    setText($('mp-series-checkpoint-status'), `${stored ? '已保存到本機。' : '本機儲存不可用，請下載續賽檔。'}有效至 ${new Date(value.expiresAt).toLocaleString('zh-TW')}。${value.persistent ? '同一簽名金鑰的伺服器重啟後仍可驗證。' : '伺服器尚未設定固定簽名金鑰；重啟後此檔案會失效。'}`);
    $('mp-series-checkpoint-download').hidden = false;
  }
  private readCheckpoint() {
    const client = this.client(); if (!client) return null;
    if (this.checkpoint && this.checkpoint.endpoint === client.url && this.checkpoint.expiresAt > Date.now()) return this.checkpoint;
    try {
      const raw = localStorage.getItem(CHECKPOINT_KEY); if (!raw || raw.length > 70000) return null;
      const v = JSON.parse(raw) as Partial<Checkpoint>;
      if (v.endpoint !== client.url || typeof v.token !== 'string' || v.token.length < 16 || v.token.length > 65536
        || typeof v.expiresAt !== 'number' || !Number.isFinite(v.expiresAt) || v.expiresAt <= Date.now() || typeof v.persistent !== 'boolean') return null;
      this.checkpoint = v as Checkpoint; return this.checkpoint;
    } catch { return null; }
  }
  private download() {
    const cp = this.readCheckpoint(); if (!cp) return;
    try {
      this.revokeDownload();
      this.downloadUrl = URL.createObjectURL(new Blob([JSON.stringify({ v: 1, token: cp.token, expiresAt: cp.expiresAt, persistent: cp.persistent })], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = this.downloadUrl; a.download = 'taipei-gp-series-checkpoint.json'; document.body.append(a); a.click(); a.remove();
      setText($('mp-series-checkpoint-status'), '已要求下載續賽檔。檔案可代表原房主建立續賽房，請妥善保管。');
    } catch { setText($('mp-series-checkpoint-status'), '無法下載；若本機保存成功，可在此瀏覽器使用已保存續賽檔。'); }
  }
  private async importFile() {
    const input = $<HTMLInputElement>('mp-series-resume-file'), file = input.files?.[0]; input.value = '';
    this.cancelImport();
    const client = this.client();
    if (!file || !client || client.room || this.busy || !this.pageActive) return;
    const generation = this.importGeneration, endpoint = client.url, connectionGeneration = client.connectionGeneration;
    const current = () => generation === this.importGeneration && this.pageActive && !this.busy
      && client === this.client() && client.url === endpoint && !client.room && client.connectionGeneration === connectionGeneration;
    if (file.size > 70000) { setText($('mp-series-resume-status'), '續賽檔案過大，請選擇原始下載檔。'); return; }
    $('mp-series-import-cancel').hidden = false; setText($('mp-series-resume-status'), '正在讀取續賽檔…可取消。');
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!current()) return;
      if (!value || typeof value !== 'object' || !('token' in value) || typeof value.token !== 'string' || value.token.length > 65536) throw Error('invalid');
      this.cancelImport(); this.resume(value.token);
    } catch { if (current()) setText($('mp-series-resume-status'), '無法讀取續賽檔，請選擇原始下載的 JSON 檔案。'); }
    finally { if (generation === this.importGeneration) $('mp-series-import-cancel').hidden = true; }
  }
  render(room: RoomSnapshot | null, selfId: string | null, connected: boolean, busy: boolean) {
    this.busy = busy; if (busy || room) this.cancelImport();
    const e = room?.evolution, host = room?.hostId === selfId, supported = !!room?.capabilities?.evolution;
    $('mp-evolution').hidden = !supported; $('mp-event-host').hidden = !host;
    $('mp-series-random').hidden = !supported;
    for (const id of ['mp-event-apply', 'mp-series-random']) $<HTMLButtonElement>(id).disabled = !connected || busy || !!room?.series?.locked;
    const cpAvailable = !!room?.capabilities?.seriesResume && host && room.phase === 'results' && !!room.series && !room.series.complete
      && (!room.series.originalHostId || room.series.originalHostId === selfId);
    $('mp-series-checkpoint').hidden = !cpAvailable;
    $<HTMLButtonElement>('mp-series-checkpoint-save').disabled = !connected || busy;
    const persistent = room?.capabilities?.seriesResume?.persistent;
    setText($('mp-series-checkpoint-help'), persistent
      ? '保存本輪結算後，原房主可在有效期內開新房接續下一站；車手、積分、路線、房規及隊伍會保留。'
      : '此伺服器未設定固定 SERIES_RESUME_SECRET；續賽檔僅在目前伺服器程序存活期間可用。需由伺服器管理者設定固定金鑰，才能跨重啟續賽。');
    const checkpoint = this.readCheckpoint();
    $('mp-series-resume-saved').hidden = !checkpoint;
    $<HTMLButtonElement>('mp-series-resume-saved').disabled = busy || !!room;
    for (const id of ['mp-series-resume-paste', 'mp-series-resume-file', 'mp-series-resume-token']) $<HTMLInputElement>(id).disabled = busy || !!room;
    const seats = this.client()?.savedSeriesSeats ?? [], seatsKey = JSON.stringify(seats);
    if (seatsKey !== this.seatsKey) {
      this.seatsKey = seatsKey; const select = $<HTMLSelectElement>('mp-series-seat'), previous = select.value; select.replaceChildren();
      for (const seat of seats) { const option = document.createElement('option'); option.value = seat.key ?? seat.playerId; option.textContent = `${seat.name}${seat.seriesId ? ` · 系列 ${seat.seriesId.slice(0, 8)}` : ''}`; select.append(option); }
      if (seats.some(s => (s.key ?? s.playerId) === previous)) select.value = previous;
    }
    for (const id of ['mp-series-seat-field', 'mp-series-seat-claim']) $(id).hidden = !seats.length;
    $<HTMLButtonElement>('mp-series-seat-claim').disabled = busy || !!room;
    if (!room || !e) return;
    const description = `${modeLabel(e.mode)} · ${eventDescription(room)}`;
    setText($('mp-event-description'), description); setText($('mp-result-event'), description);
    const key = JSON.stringify([room.code, room.hostManagement?.lobbyRevision, room.players.map(p => [p.id, p.name]), e.mode, e.durationSeconds, e.releaseDelays]);
    if (key !== this.configKey) {
      this.configKey = key; $<HTMLSelectElement>('mp-event-mode').value = e.mode; $<HTMLSelectElement>('mp-event-duration').value = String(e.durationSeconds);
      this.delaySelects.clear(); $('mp-event-delays').replaceChildren();
      for (const p of room.players) {
        const label = document.createElement('label'); label.className = 'mp-field'; label.textContent = `${p.name} 的延後放行`;
        const select = document.createElement('select'); select.setAttribute('aria-label', `${p.name} 延後放行秒數`);
        for (const seconds of [0, 3, 5, 10]) { const o = document.createElement('option'); o.value = String(seconds); o.textContent = `${seconds} 秒`; select.append(o); }
        select.value = String(e.releaseDelays[p.id] ?? 0); select.disabled = !connected || busy || !!room.series?.locked;
        label.append(select); $('mp-event-delays').append(label); this.delaySelects.set(p.id, select);
      }
      this.toggleFields();
    }
    for (const id of ['mp-event-mode', 'mp-event-duration']) $<HTMLSelectElement>(id).disabled = !connected || busy || !!room.series?.locked;
    $('mp-event-team-controls').hidden = e.mode !== 'teams';
    const counts = (team: 'red' | 'blue') => room.players.filter(p => e.teams[p.id] === team).length;
    const team = e.teams[selfId ?? ''];
    setText($('mp-team-count'), `紅隊 ${counts('red')} / 2 · 藍隊 ${counts('blue')} / 2${team ? ` · 你在${team === 'red' ? '紅' : '藍'}隊` : ' · 請選擇隊伍'}`);
    for (const t of ['red', 'blue'] as const) { $<HTMLButtonElement>(`mp-team-${t}`).disabled = !connected || busy || !!room.series?.locked; $(`mp-team-${t}`).setAttribute('aria-pressed', String(team === t)); }
    $('mp-voting').hidden = !!room.series;
    const voteKey = JSON.stringify([room.code, e.vote.revision, e.vote.ballots]);
    if (voteKey !== this.voteKey) {
      this.voteKey = voteKey; $('mp-vote-tally').replaceChildren();
      const tally = new Map<string, number>(); Object.values(e.vote.ballots).forEach(id => tally.set(id, (tally.get(id) ?? 0) + 1));
      for (const track of MULTIPLAYER_TRACKS) if (tally.has(track.id)) { const li = document.createElement('li'); li.textContent = `${track.name} · ${tally.get(track.id)} 票${e.vote.ballots[selfId ?? ''] === track.id ? '（你已投票）' : ''}`; $('mp-vote-tally').append(li); }
      if (!tally.size) { const li = document.createElement('li'); li.textContent = '尚無投票'; $('mp-vote-tally').append(li); }
      if (e.vote.ballots[selfId ?? '']) $<HTMLSelectElement>('mp-vote-track').value = e.vote.ballots[selfId ?? ''];
    }
    $('mp-vote-resolve').hidden = !host;
    for (const id of ['mp-vote-track', 'mp-vote-submit', 'mp-vote-resolve']) $<HTMLButtonElement>(id).disabled = !connected || busy || !!room.series;
  }
}
