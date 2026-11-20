import type { RoomSnapshot } from '../shared/multiplayer-protocol';
import type { ResultCardData } from './voyager-photo';

const time = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
const teamName = (team: 'red' | 'blue') => team === 'red' ? '紅隊' : '藍隊';

/** Presentation only: the server's classification always owns position. */
export function multiplayerResultCardData(room: RoomSnapshot | null | undefined, mapName?: string): ResultCardData | null {
  if (room?.phase !== 'results') return null;
  const practice = !!room.voyager?.settings.practiceSeconds;
  const arena = room.arena?.mode ?? 'off';
  const mode = arena !== 'off' ? arena : room.horizon?.elimination ? 'elimination' : room.evolution?.mode ?? 'race';
  const qualifying = room.summit?.stage === 'qualifying';
  const fastest = practice || qualifying || mode === 'time-trial';
  const title = room.summit?.stage==='sprint'?'多人衝刺賽成績':practice ? '自由練習成績' : qualifying ? '多人排位成績'
    : mode === 'time-trial' ? '限時最快圈成績' : mode === 'pursuit' ? '追逐賽成績'
    : mode === 'elimination' ? '淘汰賽成績' : mode === 'teams' ? '紅藍團隊賽成績'
    : mode === 'relay' ? '接力賽成績' : mode === 'items' ? '道具競速成績'
    : room.summit?.settings.endurance ? '多人耐久賽成績' : '多人競速成績';
  const lines: string[] = [];
  if (mode === 'teams' && room.evolution?.teamStandings) {
    const teams = [...room.evolution.teamStandings].sort((a, b) => a.rank - b.rank);
    lines.push('隊伍積分：' + teams.map(t => `P${t.rank} ${teamName(t.team)} ${t.points}分`).join('／'));
  }
  for (const p of [...room.players].sort((a, b) => a.rank - b.rank).slice(0, 8 - lines.length)) {
    const team = mode === 'relay' ? room.arena?.teams[p.id] : mode === 'teams' ? room.evolution?.teams[p.id] : null;
    const missed=!!room.odyssey?.settings.mandatoryStop&&!p.dnf&&!!p.odyssey?.stopMissed;
    const label = `${missed?'—':'P'+p.rank} ${p.name}${p.summit?.ai ? ' [AI]' : ''}${team ? ` · ${teamName(team)}` : ''}`;
    let result: string;
    if (p.eliminationWinner) result = '淘汰賽勝出';
    else if (p.eliminated) result = `已淘汰 · 第${p.eliminationRank ?? p.rank}名`;
    else if (p.dnf) result = '未完成';
    else if(missed)result='房規未完成（不列有效名次）';
    else if (fastest) {
      const best = p.bestLapMs ?? p.finishMs;
      result = best === null ? '尚無有效圈' : `有效最快 ${time(best)}`;
    } else result = p.finishMs === null ? '未完成' : `${mode === 'pursuit' ? '共同' : '完賽'} ${time(p.finishMs)}`;
    if (mode === 'pursuit' && p.netFinishMs != null) {
      result = `淨跑${time(p.netFinishMs)}／${result}／讓${room.evolution?.releaseDelays[p.id] ?? p.releaseDelaySeconds ?? 0}秒`;
    } else if (!fastest && p.bestLapMs != null) result += ` · 最佳圈 ${time(p.bestLapMs)}`;
    if (mode === 'relay') result += ` · 已交棒${p.arena?.handoffs ?? 0}次`;
    lines.push(`${label} · ${result}`);
  }
  if(room.odyssey?.weekend){const w=room.odyssey.weekend;lines.push('週末總積分：'+w.standings.map(r=>(w.entrants.find(e=>e.id===r.id)?.name??'車手')+' '+r.points+'分').join(' / '));}
  return { title, map: mapName ?? room.trackId, lines };
}
