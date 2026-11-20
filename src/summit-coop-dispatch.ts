import { BigMap } from './bigmap';
import type { RoadNet } from './citydata';
import type { Landmark } from './decor';
import { COOP_STATIONS, COOP_RELAY_STATION, coopStation, type CoopRoom } from '../shared/nexus-coop';
const colors = ['#59dbea', '#f8bd59', '#bb8dff', '#8ae77e'];
export function mountCoopDispatch(roads: () => RoadNet | null, landmarks: () => Landmark[], command: (type: 'ping' | 'cancel-ping', fields?: Record<string, unknown>) => void, navigate: (station: typeof COOP_STATIONS[number]) => void) {
  const root = document.createElement('section'); root.className = 'summit-coop-dispatch'; root.id = 'coop-dispatch';
  const title = document.createElement('b'); title.textContent = '合作調度地圖';
  const canvas = document.createElement('canvas'); canvas.id = 'coop-dispatch-map'; canvas.setAttribute('aria-label', '真城市道路與隊友位置；虛線為目的地方向，並非可駕路徑。集合點請用下方站點選單。');
  const info = document.createElement('p'); info.id = 'coop-dispatch-info'; info.setAttribute('aria-live', 'polite');
  const select = document.createElement('select'); select.id = 'coop-ping-station'; select.setAttribute('aria-label', '集合站點');
  for (const s of COOP_STATIONS) { const e = document.createElement('option'); e.value = s.id; e.textContent = s.name; select.append(e); }
  const tools = document.createElement('div'); tools.className = 'nexus-coop-actions';
  const add = (id: string, text: string, fn: () => void) => { const b = document.createElement('button'); b.id = id; b.textContent = text; b.onclick = fn; tools.append(b); return b; };
  add('coop-ping', '集合標記30秒', () => command('ping', { stationId: select.value }));
  add('coop-ping-cancel', '移除我的標記', () => command('cancel-ping'));
  add('coop-ping-nav', '導航選取站點', () => { const s = coopStation(select.value); if (s) navigate(s); });
  add('coop-dispatch-all', '顯示全區', () => map?.showAll());
  root.append(title, canvas, info, select, tools);
  let map: BigMap | null = null, room: CoopRoom | null = null, selfId = '', disposed = false;
  function update(value: CoopRoom | null, self: string) { room = value; selfId = self; root.hidden = !room; if (!room && map) { map.dispose(); map = null; } }
  function draw() {
    if (disposed || !room || !canvas.getClientRects().length) return;
    const net = roads(); if (!net) return;
    if (!map) { map = new BigMap(canvas, net, landmarks()); map.side = 0; map.showAll(); map.onPick = (x, z) => { const station = COOP_STATIONS.reduce((a, b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a); select.value = station.id; }; }
    const me = room.players.find(p => p.id === selfId); if (!me) return;
    map.draw(me.pose.x, me.pose.z, me.pose.h, null, null);
    const ctx = canvas.getContext('2d')!, point = (x: number, z: number) => [canvas.width / 2 + (x - map!.cx) * map!.zoom, canvas.height / 2 + (z - map!.cz) * map!.zoom];
    ctx.textAlign = 'left'; ctx.lineWidth = 1;
    const labels: string[] = [];
    room.players.forEach((p, i) => {
      const cargo = room!.cargo.find(c => c.id === p.cargo), reservation = room!.dispatch.reservations.find(r => r.playerId === p.id), target = cargo ? cargo.leg==='to-relay'?COOP_RELAY_STATION:coopStation(cargo.destination) : reservation ? COOP_STATIONS[0] : null;
      const [x, y] = point(p.pose.x, p.pose.z); ctx.strokeStyle = ctx.fillStyle = colors[i]; ctx.globalAlpha = p.connected ? 1 : .35;
      if (target) { const [tx, ty] = point(target.x, target.z); ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]); ctx.strokeRect(tx - 5, ty - 5, 10, 10); }
      ctx.beginPath(); ctx.arc(x, y, p.id === selfId ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.font = '12px sans-serif'; ctx.fillText(p.name.slice(0, 8), x + 9, y - 8);
      const reserved = reservation ? coopStation(room!.cargo.find(c => c.id === reservation.cargoId)!.destination) : null;
      labels.push(`${p.name}${p.connected ? '' : '（斷線）'}：${cargo ? target?.name : reserved ? `已預約${reserved.name}，先赴倉庫` : '尚未領貨'}`);
    }); ctx.globalAlpha = 1;
    for (const ping of room.dispatch.pings) { const s = coopStation(ping.stationId)!, [x, y] = point(s.x, s.z), who = room.players.find(p => p.id === ping.playerId)!; ctx.strokeStyle = '#fff26a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#fff26a'; ctx.fillText(`集合：${who.name.slice(0, 8)}`, x + 14, y + 5); }
    info.textContent = labels.join('；') + '。虛線僅指向目標；導航請按真道路規劃。';
  }
  return { root, update, draw, dispose() { disposed = true; map?.dispose(); root.remove(); map = null; room = null; canvas.width = canvas.height = 0; } };
}
