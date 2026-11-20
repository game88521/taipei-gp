import type { DnfReason, RoomPlayer, RoomSnapshot } from '../shared/multiplayer-protocol';

const DNF_LABELS: Record<DnfReason, string> = {
  'race-timeout': '超過比賽時間', 'finish-timeout': '超過完賽期限',
  'disconnect-expired': '斷線逾期', left: '主動退出', 'server-stall': '伺服器暫停過久',
  'time-trial-grace': '限時單圈寬限結束', 'time-trial-no-lap': '沒有有效完圈',
};
export const dnfLabel = (reason: DnfReason | null | undefined) => reason ? DNF_LABELS[reason] : '未完成';

export function setText(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

export function deadlineText(room: RoomSnapshot | null | undefined, serverNow: number): string {
  if (room?.phase !== 'racing' || room.deadlineAt == null) return '';
  if(room.voyager?.settings.practiceSeconds){const seconds=Math.max(0,Math.ceil((room.deadlineAt-serverNow)/1000));return`練習剩餘 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
  if(room.summit?.durationSeconds&&room.startAt!==null){const cutoff=room.startAt+room.summit.durationSeconds*1000,qual=room.summit.stage==='qualifying',left=Math.max(0,Math.ceil(((qual||serverNow>=cutoff?room.deadlineAt:cutoff)-serverNow)/1000));return`${qual?'排位剩餘':serverNow>=cutoff?'完成這圈，最長寬限':'耐久剩餘'} ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;}
  if (room.evolution?.mode === 'time-trial' && room.startAt !== null) {
    const cutoff = room.startAt + room.evolution.durationSeconds * 1000;
    const inGrace = serverNow >= cutoff, seconds = Math.max(0, Math.ceil(((inGrace ? room.deadlineAt : cutoff) - serverNow) / 1000));
    return `${inGrace ? '最後有效圈寬限' : '最快圈賽剩餘'} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const seconds = Math.max(0, Math.ceil((room.deadlineAt - serverNow) / 1000));
  return `${room.deadlineReason === 'finish-timeout' ? '最後完賽' : '比賽剩餘'} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type Row = { root: HTMLLIElement; name: HTMLElement; detail: HTMLElement | null; status: HTMLElement; marker: HTMLElement };
type ListKind = 'lobby' | 'results' | 'board';
const raceTime = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

/** Differences use authoritative finish times; unfinished players have no final gap. */
export const odysseyRuleUnclassified=(room:RoomSnapshot,player:RoomPlayer)=>room.phase==='results'&&!!room.odyssey?.settings.mandatoryStop&&!player.dnf&&!!player.odyssey?.stopMissed;
export function finishGapText(room: RoomSnapshot, player: RoomPlayer): string {
  if (player.dnf || player.finishMs === null || odysseyRuleUnclassified(room,player)) return '';
  const finishes = room.players.filter(p => !p.dnf && p.finishMs !== null && !odysseyRuleUnclassified(room,p)).map(p => p.finishMs!);
  if (!finishes.length) return '';
  const gap = Math.max(0, player.finishMs - Math.min(...finishes));
  return gap === 0 ? room.voyager?.settings.practiceSeconds?'練習最快':room.summit?.stage==='qualifying'?'桿位':'冠軍' : `${room.voyager?.settings.practiceSeconds||room.evolution?.mode === 'time-trial'||room.summit?.stage==='qualifying' ? '最快圈差' : '落後冠軍'} +${(gap / 1000).toFixed(3)} 秒`;
}

export function lapSummaryText(room: RoomSnapshot | null | undefined, playerId: string | null | undefined): string {
  const player = room?.players.find(p => p.id === playerId);
  if (!player) return '';
  if (!player.lapTimesMs) return '伺服器未提供逐圈成績';
  if (!player.lapTimesMs.length) return '完成第一圈後顯示圈速';
  return `第 ${player.lapTimesMs.length} 圈 ${raceTime(player.lapTimesMs.at(-1)!)} · ${player.bestLapMs==null?'尚無有效圈':`最快 ${raceTime(player.bestLapMs)}`}`;
}

type LapRow = { root: HTMLLIElement; label: HTMLElement; time: HTMLElement; detail: HTMLElement };

/** Up to five keyed rows; changing the viewed driver updates existing text. */
export class MultiplayerLapList {
  private rows = new Map<number, LapRow>();
  constructor(private element: HTMLElement) {}

  update(room: RoomSnapshot | null | undefined, playerId: string | null | undefined) {
    const player = room?.players.find(p => p.id === playerId), times = player?.lapTimesMs;
    if (!room || !player || !times || !['racing', 'results'].includes(room.phase)) { this.clear(); return; }
    for (const [lap, row] of this.rows) if (lap >= times.length) { row.root.remove(); this.rows.delete(lap); }
    times.forEach((ms, lap) => {
      let row = this.rows.get(lap);
      if (!row) {
        const root = document.createElement('li'), label = document.createElement('span'), time = document.createElement('b'), detail = document.createElement('small');
        root.append(label, time, detail); row = { root, label, time, detail }; this.rows.set(lap, row);
        this.element.append(root);
      }
      const valid=room.voyager?.settings.practiceSeconds?player.voyager?.validLaps.includes(ms):room.summit?.stage!=='qualifying'||player.summit?.validLaps.includes(ms),fastest = valid&&ms === player.bestLapMs;
      if (row.root.dataset.fastest !== String(fastest)) row.root.dataset.fastest = String(fastest);
      setText(row.label, `第 ${lap + 1} 圈`); setText(row.time, raceTime(ms));
      const difference = lap === 0 ? '' : `${ms <= times[lap - 1] ? '較上圈快' : '較上圈慢'} ${(Math.abs(ms - times[lap - 1]) / 1000).toFixed(3)} 秒`;
      setText(row.detail, [!valid?'無效圈':fastest ? '最快圈' : '', difference].filter(Boolean).join(' · '));
    });
  }

  clear() {
    for (const row of this.rows.values()) row.root.remove();
    this.rows.clear();
  }
}

/** 只由可見面板呼叫；同一玩家保留節點，排名改變時才移動既有列。 */
export class MultiplayerPlayerList {
  private rows = new Map<string, Row>();
  constructor(private element: HTMLElement, private kind: ListKind) {}

  private createRow(): Row {
    const root = document.createElement('li'), marker = document.createElement(this.kind === 'board' ? 'b' : 'span');
    const name = document.createElement('span'), status = document.createElement(this.kind === 'board' ? 'small' : 'b');
    let detail: HTMLElement | null = null;
    if (this.kind !== 'board') {
      marker.className = 'mp-player-color';
      const nameGroup = document.createElement('span'); nameGroup.className = 'mp-player-name';
      detail = document.createElement('small'); nameGroup.append(name, detail); root.append(marker, nameGroup, status);
    } else root.append(marker, name, status);
    return { root, name, detail, status, marker };
  }

  update(room: RoomSnapshot, selfId: string | null | undefined) {
    const ids = new Set(room.players.map(player => player.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.root.remove(); this.rows.delete(id); }
    room.players.forEach((player: RoomPlayer, index: number) => {
      let row = this.rows.get(player.id);
      if (!row) { row = this.createRow(); this.rows.set(player.id, row); }
      const self = String(player.id === selfId);
      if (row.root.dataset.self !== self) row.root.dataset.self = self;
      if (this.kind === 'board') {
        setText(row.marker, odysseyRuleUnclassified(room,player)?'—':`P${player.rank}`); setText(row.name, player.name+(player.summit?.ai?' [AI]':''));
        setText(row.status, player.eliminated ? `淘汰 P${player.eliminationRank}` : player.eliminationWinner ? '勝出' : player.block?.ghost ? '保護凍結' : player.dnf ? 'DNF' : room.voyager?.settings.practiceSeconds||room.evolution?.mode === 'time-trial'||room.summit?.stage==='qualifying' ? player.bestLapMs != null ? raceTime(player.bestLapMs) : '尚無有效圈' : player.finishMs !== null ? '🏁' : !player.connected ? '失聯' : room.summit?.settings.endurance?`${player.completedLaps}圈`:`${Math.min(room.laps, player.completedLaps + 1)}/${room.laps}`);
      } else {
        if (row.marker.dataset.color !== player.color) { row.marker.style.background = player.color; row.marker.dataset.color = player.color; }
        const results = this.kind === 'results';
        const team = room.evolution?.teams[player.id], teamLabel = team ? ` · ${team === 'red' ? '紅' : '藍'}隊` : '';
        setText(row.name, `${results&&!odysseyRuleUnclassified(room,player) ? player.rank + '. ' : ''}${player.name}${player.summit?.ai?' [AI]':''}${player.id === selfId ? '（你）' : ''}${teamLabel}`);
        setText(row.detail!, results ? [`${player.completedLaps} 圈`, player.bestLapMs == null ? '' : `最快 ${raceTime(player.bestLapMs)}`,
          room.evolution?.mode === 'pursuit' && player.netFinishMs != null ? `淨跑 ${raceTime(player.netFinishMs)} · 讓 ${room.evolution.releaseDelays[player.id] ?? 0} 秒` : '',
          player.dnf ? dnfLabel(player.dnfReason) : finishGapText(room, player)].filter(Boolean).join(' · ')
          : `${player.id === room.hostId ? '房主 · ' : ''}${player.summit?.ai?'伺服器AI':player.connected ? '已連線' : '暫時失聯，等待重連'}${room.summit?.settings.weekend&&['race','sprint'].includes(room.summit.stage)?` · 發車P${(player.gridIndex??0)+1}`:''}${room.evolution?.mode === 'pursuit' ? ` · 延後 ${room.evolution.releaseDelays[player.id] ?? 0} 秒放行` : ''}`);
        setText(row.status, results ? odysseyRuleUnclassified(room,player) ? '房規未完成（不列名次）' : player.eliminationWinner ? '淘汰賽勝出' : player.eliminated ? `淘汰 · 第${player.eliminationRank}名` : player.finishMs !== null ? `${room.voyager?.settings.practiceSeconds||room.evolution?.mode === 'time-trial'||room.summit?.stage==='qualifying' ? '最快 ' : room.evolution?.mode === 'pursuit' ? '共同 ' : ''}${raceTime(player.finishMs)}` : 'DNF' : !player.connected ? '等待重連' : !player.loaded ? '載入地圖中' : player.ready ? '已準備' : '準備中');
      }
      const atIndex = this.element.children[index] ?? null;
      if (atIndex !== row.root) this.element.insertBefore(row.root, atIndex);
    });
  }

  clear() {
    if (!this.rows.size) return;
    for (const row of this.rows.values()) row.root.remove();
    this.rows.clear();
  }
}
