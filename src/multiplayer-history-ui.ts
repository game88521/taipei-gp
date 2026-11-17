import { MultiplayerHistory } from './multiplayer-history';
import { getMultiplayerTrack } from '../shared/multiplayer-tracks';
import { roomRulesText } from '../shared/multiplayer-room-rules';

export class MultiplayerHistoryPanel {
  private key = '';
  constructor(readonly history: MultiplayerHistory, private list: HTMLElement, private status: HTMLElement) {}
  render() {
    const key = this.history.entries.map(e => e.id).join('|') + this.history.error;
    if (this.key === key) return; this.key = key; this.list.replaceChildren();
    this.status.textContent = this.history.error || (this.history.entries.length ? `已保存 ${this.history.entries.length} 筆；僅存在這個瀏覽器，不會恢復對戰房間。` : '尚無近期戰績。完賽結算後自動保存，離房仍可查看。');
    for (const e of this.history.entries) {
      const detail = document.createElement('details'), summary = document.createElement('summary'), rules = document.createElement('p');
      summary.textContent = `${e.kind === 'series' ? `${e.rounds.length}站系列` : getMultiplayerTrack(e.rounds[0].trackId)!.name} · ${new Date(e.at).toLocaleString('zh-TW')}`;
      rules.textContent = roomRulesText(e.rules); detail.append(summary, rules);
      const total = document.createElement('p'); total.textContent = e.players.map(p => `${p.rank}. ${p.name}${p.points !== null ? ` ${p.points}分` : ''}`).join('／'); detail.append(total);
      for (const [i, r] of e.rounds.entries()) {
        const p = document.createElement('p'); p.textContent = `${e.kind === 'series' ? `第${i + 1}站 · ` : ''}${getMultiplayerTrack(r.trackId)!.name} · ${r.laps}圈`;
        const list = document.createElement('ol');
        for (const row of r.players) { const li = document.createElement('li'); li.textContent = `${row.rank}. ${row.name} · ${row.dnf ? 'DNF' : row.finishMs === null ? '—' : `${(row.finishMs / 1000).toFixed(3)}秒`}${row.bestLapMs === null ? '' : ` · 最快 ${(row.bestLapMs / 1000).toFixed(3)}秒`}${row.lapTimesMs.length ? ` · 逐圈 ${row.lapTimesMs.map(ms => (ms / 1000).toFixed(3)).join('／')}` : ''}`; list.append(li); }
        detail.append(p, list);
      }
      this.list.append(detail);
    }
  }
}
