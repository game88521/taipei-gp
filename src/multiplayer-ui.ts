import type { DnfReason, RoomPlayer, RoomSnapshot } from '../shared/multiplayer-protocol';

const DNF_LABELS: Record<DnfReason, string> = {
  'race-timeout': '超過比賽時間', 'finish-timeout': '超過完賽期限',
  'disconnect-expired': '斷線逾期', left: '主動退出', 'server-stall': '伺服器暫停過久',
};
export const dnfLabel = (reason: DnfReason | null | undefined) => reason ? DNF_LABELS[reason] : '未完成';

export function setText(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

export function deadlineText(room: RoomSnapshot | null | undefined, serverNow: number): string {
  if (room?.phase !== 'racing' || room.deadlineAt == null) return '';
  const seconds = Math.max(0, Math.ceil((room.deadlineAt - serverNow) / 1000));
  return `${room.deadlineReason === 'finish-timeout' ? '最後完賽' : '比賽剩餘'} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type Row = { root: HTMLLIElement; name: HTMLElement; detail: HTMLElement | null; status: HTMLElement; marker: HTMLElement };
type ListKind = 'lobby' | 'results' | 'board';
const raceTime = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

/** Differences use authoritative finish times; unfinished players have no final gap. */
export function finishGapText(room: RoomSnapshot, player: RoomPlayer): string {
  if (player.dnf || player.finishMs === null) return '';
  const finishes = room.players.filter(p => !p.dnf && p.finishMs !== null).map(p => p.finishMs!);
  if (!finishes.length) return '';
  const gap = Math.max(0, player.finishMs - Math.min(...finishes));
  return gap === 0 ? '冠軍' : `落後冠軍 +${(gap / 1000).toFixed(3)} 秒`;
}

export function lapSummaryText(room: RoomSnapshot | null | undefined, playerId: string | null | undefined): string {
  const player = room?.players.find(p => p.id === playerId);
  if (!player) return '';
  if (!player.lapTimesMs) return '伺服器未提供逐圈成績';
  if (!player.lapTimesMs.length) return '完成第一圈後顯示圈速';
  return `第 ${player.lapTimesMs.length} 圈 ${raceTime(player.lapTimesMs.at(-1)!)} · 最快 ${raceTime(player.bestLapMs!)}`;
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
      const fastest = ms === player.bestLapMs;
      if (row.root.dataset.fastest !== String(fastest)) row.root.dataset.fastest = String(fastest);
      setText(row.label, `第 ${lap + 1} 圈`); setText(row.time, raceTime(ms));
      const difference = lap === 0 ? '' : `${ms <= times[lap - 1] ? '較上圈快' : '較上圈慢'} ${(Math.abs(ms - times[lap - 1]) / 1000).toFixed(3)} 秒`;
      setText(row.detail, [fastest ? '最快圈' : '', difference].filter(Boolean).join(' · '));
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
        setText(row.marker, `P${player.rank}`); setText(row.name, player.name);
        setText(row.status, player.dnf ? 'DNF' : player.finishMs !== null ? '🏁' : !player.connected ? '失聯' : `${Math.min(room.laps, player.completedLaps + 1)}/${room.laps}`);
      } else {
        if (row.marker.dataset.color !== player.color) { row.marker.style.background = player.color; row.marker.dataset.color = player.color; }
        const results = this.kind === 'results';
        setText(row.name, `${results ? player.rank + '. ' : ''}${player.name}${player.id === selfId ? '（你）' : ''}`);
        setText(row.detail!, results ? [`${player.completedLaps} 圈`, player.bestLapMs == null ? '' : `最快 ${raceTime(player.bestLapMs)}`,
          player.dnf ? dnfLabel(player.dnfReason) : finishGapText(room, player)].filter(Boolean).join(' · ')
          : `${player.id === room.hostId ? '房主 · ' : ''}${player.connected ? '已連線' : '暫時失聯，等待重連'}`);
        setText(row.status, results ? player.finishMs !== null ? raceTime(player.finishMs) : 'DNF' : !player.connected ? '等待重連' : !player.loaded ? '載入地圖中' : player.ready ? '已準備' : '準備中');
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
