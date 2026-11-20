import type { RoomSnapshot } from '../shared/multiplayer-protocol';
import { MULTIPLAYER_TRACKS, getMultiplayerTrack } from '../shared/multiplayer-tracks';

/** Rebuild standings/history only when the server series revision changes. */
export class MultiplayerSeriesPanel {
  private selects: HTMLSelectElement[] = [];
  private labels: HTMLLabelElement[] = [];
  private renderedKey = ''; private configKey = '';
  constructor() {
    const route = document.getElementById('mp-series-route')!;
    for (let index = 0; index < 5; index++) {
      const label = document.createElement('label'); label.className = 'mp-field'; label.textContent = `第 ${index + 1} 站`;
      const select = document.createElement('select'); select.id = `mp-series-track-${index}`; select.setAttribute('aria-label', `第 ${index + 1} 站地圖`);
      for (const track of MULTIPLAYER_TRACKS) { const option = document.createElement('option'); option.value = track.id; option.textContent = `${track.flag} ${track.name}`; select.appendChild(option); }
      select.value = MULTIPLAYER_TRACKS[index].id; label.appendChild(select); route.appendChild(label); this.selects.push(select); this.labels.push(label);
    }
    this.updateCount();
  }
  updateCount() { const count = Number((document.getElementById('mp-series-count') as HTMLSelectElement).value) || 3; this.labels.forEach((label, index) => { label.hidden = index >= count; }); }
  selectedTracks() { const count = Number((document.getElementById('mp-series-count') as HTMLSelectElement).value) || 3; return this.selects.slice(0, count).map(select => select.value); }
  render(room: RoomSnapshot | null, selfId: string | null, connected: boolean, busy: boolean) {
    const get = (id: string) => document.getElementById(id)!;
    const series = room?.series, host = !!room && room.hostId === selfId;
    const available = !!room?.capabilities?.championship;
    get('mp-series-setup').hidden = !available || !host || room?.phase !== 'lobby' || !!series?.locked;
    (get('mp-series-create') as HTMLButtonElement).disabled = !connected || busy;
    get('mp-series-summary').hidden = !available || !series;
    get('mp-series-end').hidden = !available || !series || !host || !['lobby', 'results'].includes(room?.phase ?? '');
    (get('mp-series-end') as HTMLButtonElement).disabled = !connected || busy;
    const configKey = `${room?.code ?? ''}:${series?.id ?? ''}`;
    if (configKey !== this.configKey) {
      this.configKey = configKey;
      const ids = series?.trackIds ?? [room?.trackId ?? MULTIPLAYER_TRACKS[0].id, ...MULTIPLAYER_TRACKS.filter(track => track.id !== room?.trackId).map(track => track.id)].slice(0, 5);
      const fullRoute = [...ids, ...MULTIPLAYER_TRACKS.filter(track => !ids.includes(track.id)).map(track => track.id)];
      (get('mp-series-count') as HTMLSelectElement).value = String(series?.trackIds.length ?? 3);
      this.selects.forEach((select, index) => { select.value = fullRoute[index]; }); this.updateCount();
    }
    const key = series ? `${room!.code}:${series.id}:${series.revision}` : '';
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    const standings = get('mp-series-standings'), history = get('mp-series-history');
    standings.replaceChildren(); history.replaceChildren();
    if (!series) return;
    get('mp-series-title').textContent = series.complete ? '系列賽總冠軍出爐' : `迷你錦標賽 · 第 ${series.roundIndex + 1} / ${series.trackIds.length} 站`;
    get('mp-series-route-text').textContent = series.trackIds.map((id, index) => `${index + 1}. ${getMultiplayerTrack(id)!.name}`).join(' → ');
    if (!series.locked) { const note = document.createElement('li'); note.textContent = '第一站起跑時鎖定目前車手名單。'; standings.appendChild(note); }
    if (room?.evolution?.mode === 'teams' && room.evolution.teamStandings) {
      for (const team of room.evolution.teamStandings) {
        const li = document.createElement('li'), name = document.createElement('strong'), points = document.createElement('b');
        li.dataset.team = team.team; name.textContent = `${team.rank}. ${team.team === 'red' ? '紅' : '藍'}隊`;
        points.textContent = `${team.points} 分 · ${team.roundWins} 站勝`; li.append(name, points); standings.append(li);
      }
    }
    for (const row of series.standings) {
      const li = document.createElement('li'), name = document.createElement('span'), points = document.createElement('b');
      const team = series.entrants.find(e => e.playerId === row.playerId)?.team;
      name.className = 'mp-player-name'; name.textContent = `${row.rank}. ${row.name}${row.playerId === selfId ? '（你）' : ''}${team ? ` · ${team === 'red' ? '紅' : '藍'}隊` : ''}`;
      points.textContent = `${row.points} 分 · ${row.wins} 勝`; li.append(name, points); standings.appendChild(li);
    }
    for (const [index, round] of series.rounds.entries()) {
      const section = document.createElement('section'), heading = document.createElement('h4'), list = document.createElement('ol');
      heading.textContent = `第 ${index + 1} 站 · ${getMultiplayerTrack(round.trackId)!.name} · ${round.mode === 'time-trial' ? '限時最快圈' : `${round.laps} 圈`}`;
      for (const result of round.results) { const li = document.createElement('li'); li.textContent = `${result.rank}. ${result.name} · ${result.dnf ? 'DNF' : `${(result.finishMs! / 1000).toFixed(3)} 秒`} · ${result.points} 分`; list.appendChild(li); }
      section.append(heading, list); history.appendChild(section);
    }
  }
}
