import { MultiplayerHistory } from './multiplayer-history';
import { getMultiplayerTrack } from '../shared/multiplayer-tracks';
import { roomRulesText } from '../shared/multiplayer-room-rules';
import { modeLabel } from './multiplayer-evolution-ui';

export class MultiplayerHistoryPanel {
  private key = '';
  constructor(readonly history: MultiplayerHistory, private list: HTMLElement, private status: HTMLElement) {}
  render() {
    const key = this.history.entries.map(e => e.id).join('|') + this.history.error;
    if (this.key === key) return; this.key = key; this.list.replaceChildren();
    this.status.textContent = this.history.error || (this.history.entries.length ? `已保存 ${this.history.entries.length} 筆；僅存在這個瀏覽器，不會恢復對戰房間。` : '尚無近期戰績。完賽結算後自動保存，離房仍可查看。');
    for (const e of this.history.entries) {
      const detail = document.createElement('details'), summary = document.createElement('summary'), rules = document.createElement('p');
      summary.textContent = `${e.summit?`${e.summit.stage==='qualifying'?'週末排位':e.summit.stage==='sprint'?'週末衝刺':e.summit.durationSeconds?`${e.summit.durationSeconds/60}分鐘耐久`:e.summit.weekend?'週末正賽':'圈數競速'}${e.summit.mixed?' · 含AI':''} · `:e.mode ? `${e.mode==='practice'?'自由練習':modeLabel(e.mode)} · ` : ''}${e.kind === 'series' ? `${e.rounds.length}站系列` : getMultiplayerTrack(e.rounds[0].trackId)!.name} · ${new Date(e.at).toLocaleString('zh-TW')}`;
      rules.textContent = roomRulesText(e.rules)+(e.atlas?` · AI ${({relaxed:'休閒',standard:'標準',competitive:'競技'})[e.atlas.aiLevel]}${e.atlas.damage?' · 輕度車損':''}${e.atlas.flags?' · 旗號提示':''}`:''); detail.append(summary, rules);
      if(e.voyager){const conditions=document.createElement('p');conditions.textContent=`天候：${({legacy:'原房規',clear:'晴天',rain:'固定雨', 'dry-rain':'乾轉雨'})[e.voyager.weather]}${e.voyager.vsc?' · 可啟用VSC（不自動加秒）':''}`;detail.append(conditions);}
      const total = document.createElement('p'); total.textContent = e.players.map(p => `${p.odyssey?.stopMissed&&!p.dnf?'—':p.rank+'.'} ${p.name}${p.odyssey?.stopMissed&&!p.dnf?' 房規未完成（不列名次）':''}${p.points !== null ? ` ${p.points}分` : ''}`).join('／'); detail.append(total);
      if(e.odyssey?.weekend){const w=e.odyssey.weekend,p=document.createElement('p');p.textContent='衝刺週末獨立積分：'+w.standings.map(r=>r.rank+'. '+(w.entrants.find(v=>v.id===r.id)?.name??'車手')+' '+r.points+'分').join(' / ');detail.append(p);}
      if (e.teamStandings) { const teams = document.createElement('p'); teams.textContent = e.teamStandings.map(t => `${t.rank}. ${t.team === 'red' ? '紅' : '藍'}隊 ${t.points}分`).join('／'); detail.append(teams); }
      for (const [i, r] of e.rounds.entries()) {
        const p = document.createElement('p'); p.textContent = `${e.kind === 'series' ? `第${i + 1}站 · ` : ''}${getMultiplayerTrack(r.trackId)!.name} · ${e.summit?.durationSeconds?`${e.summit.durationSeconds/60}分鐘${e.summit.stage==='qualifying'?'有效最快圈':'耐久'}`:e.mode==='practice'?`${(e.durationSeconds??600)/60}分鐘有效最快圈練習`:e.mode === 'elimination' ? '定時末位淘汰' : e.mode === 'time-trial' ? `${(e.durationSeconds ?? 180) / 60}分鐘最快圈` : `${r.laps}圈`}`;
        const list = document.createElement('ol'); list.style.listStyle='none';
        for (const row of r.players) { const li = document.createElement('li'); li.textContent = `${row.odyssey?.stopMissed&&!row.dnf?'—':row.rank+'.'} ${row.name}${row.ai?' [AI]':''}${row.team ? ` · ${row.team === 'red' ? '紅' : '藍'}隊` : ''} · ${row.eliminationWinner ? '淘汰賽勝出' : row.eliminated ? '已淘汰' : row.dnf ? 'DNF' : row.odyssey?.stopMissed?'房規未完成（不列名次）':row.finishMs === null ? '—' : `${e.mode === 'practice'||e.mode === 'time-trial'||e.summit?.stage==='qualifying' ? '最快 ' : e.mode === 'pursuit' ? '共同 ' : ''}${(row.finishMs / 1000).toFixed(3)}秒`}${row.netFinishMs == null ? '' : ` · 淨跑 ${(row.netFinishMs / 1000).toFixed(3)}秒 · 讓 ${row.releaseDelaySeconds ?? 0}秒`}${row.bestLapMs === null ? '' : ` · 最快 ${(row.bestLapMs / 1000).toFixed(3)}秒`}${row.practiceSectorsMs?` · 最佳分段 ${row.practiceSectorsMs.map(t=>t===null?'—':(t/1000).toFixed(3)).join('／')}`:''}${row.lapTimesMs.length ? ` · 逐圈 ${row.lapTimesMs.map(ms => (ms / 1000).toFixed(3)).join('／')}` : ''}`; list.append(li); }
        detail.append(p, list);
      }
      this.list.append(detail);
    }
  }
}
