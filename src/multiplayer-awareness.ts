import type { RoomPlayer, RoomSnapshot } from '../shared/multiplayer-protocol';
import type { Track } from './track';

export function opponentRadar(room: RoomSnapshot, viewer: RoomPlayer, track: Pick<Track, 'py' | 'bank'>) {
  const height = (p: RoomPlayer) => track.py[p.car.pos.i] + Math.max(-7, Math.min(7, p.car.pos.lat)) * track.bank[p.car.pos.i];
  return room.players.filter(p => p.id !== viewer.id && p.cup?.active!==false && p.connected && p.loaded && !p.dnf && p.finishMs === null)
    .map(p => { const dx = p.car.x - viewer.car.x, dz = p.car.z - viewer.car.z;
      const forward = dx * Math.sin(viewer.car.h) + dz * Math.cos(viewer.car.h), right = dx * Math.cos(viewer.car.h) - dz * Math.sin(viewer.car.h);
      return { name: p.name, forward, right, distance: Math.hypot(dx, dz), sameLevel: Math.abs(height(p) - height(viewer)) < 3 };
    }).filter(p => p.sameLevel && p.distance <= 35).sort((a, b) => a.distance - b.distance).slice(0, 3);
}
export function raceGaps(room: RoomSnapshot, viewer: RoomPlayer) {
  const peers = room.players.filter(p => p.id !== viewer.id && p.cup?.active!==false && !p.dnf && p.connected && p.loaded);
  const label = (p: RoomPlayer, delta: number) => `${p.name} ${Math.round(Math.abs(delta))} m${Math.abs(delta) >= room.trackLength ? '（套圈）' : ''}`;
  const ahead = peers.filter(p => p.progress >= viewer.progress).sort((a, b) => a.progress - b.progress)[0];
  const behind = peers.filter(p => p.progress < viewer.progress).sort((a, b) => b.progress - a.progress)[0];
  return `${ahead ? `前：${label(ahead, ahead.progress - viewer.progress)}` : '前方無車'} · ${behind ? `後：${label(behind, behind.progress - viewer.progress)}` : '後方無車'}`;
}
export function trackProjection(track: Pick<Track, 'px' | 'pz' | 'N'>) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]); minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]); }
  const scale = Math.min(144 / Math.max(1, maxX - minX), 94 / Math.max(1, maxZ - minZ));
  const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
  return (px: number, pz: number) => ({ x: 80 + (px - x) * scale, y: 55 + (pz - z) * scale });
}
/** SVG path is rebuilt only when track changes. Positions use authority, at most 10Hz. */
export class MultiplayerAwareness {
  private track: Track | null = null;
  private project: ((x: number, z: number) => { x: number; y: number }) | null = null;
  private at = -Infinity;
  private markers = new Map<string, SVGCircleElement>();
  private path: SVGPolylineElement;
  private svg: SVGSVGElement;
  private gaps: HTMLElement;
  private radar: HTMLElement;
  constructor(host: HTMLElement, gaps: HTMLElement, radar: HTMLElement) {
    this.gaps = gaps; this.radar = radar;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.setAttribute('viewBox', '0 0 160 110'); this.svg.setAttribute('role', 'img'); this.svg.setAttribute('aria-label', '目前真實賽道與車手位置');
    this.path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); this.path.setAttribute('fill', 'none'); this.path.setAttribute('stroke', '#91a8bd'); this.path.setAttribute('stroke-width', '3'); this.svg.append(this.path); host.append(this.svg);
  }
  update(track: Track | null, room: RoomSnapshot | null, viewerId: string | null, now: number) {
    if (now - this.at < 100) return; this.at = now;
    const viewer = room?.players.find(p => p.id === viewerId);
    if (!track || !room || !viewer) { this.gaps.textContent = ''; this.radar.textContent = ''; this.svg.style.display = 'none'; return; }
    this.svg.style.display = '';
    if (track !== this.track) {
      this.track = track; this.project = trackProjection(track);
      const points = []; for (let i = 0; i < track.N; i += Math.max(1, Math.ceil(track.N / 512))) { const p = this.project(track.px[i], track.pz[i]); points.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`); }
      points.push(points[0]); this.path.setAttribute('points', points.join(' '));
    }
    const activePlayers=room.players.filter(p=>p.cup?.active!==false);
    const ids = new Set(activePlayers.map(p => p.id)); for (const [id, marker] of this.markers) if (!ids.has(id)) { marker.remove(); this.markers.delete(id); }
    for (const p of activePlayers) {
      let marker = this.markers.get(p.id); if (!marker) { marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); this.svg.append(marker); this.markers.set(p.id, marker); }
      const pos = this.project!(p.car.x, p.car.z); marker.setAttribute('cx', String(pos.x)); marker.setAttribute('cy', String(pos.y)); marker.setAttribute('r', p.id === viewerId ? '4' : '3'); marker.setAttribute('fill', p.color); marker.setAttribute('stroke', p.id === viewerId ? '#fff' : '#071321'); marker.style.opacity = p.connected && !p.dnf ? '1' : '.3';
    }
    this.gaps.textContent = raceGaps(room, viewer);
    const nearby = opponentRadar(room, viewer, track);
    this.radar.textContent = nearby.length ? nearby.map(p => `${p.name}：${Math.abs(p.right) < 1 ? '' : p.right > 0 ? '右' : '左'}${Math.abs(p.forward) < 2 ? '側' : p.forward > 0 ? '前' : '後'} ${Math.round(p.distance)} m`).join('／') : '附近35 m內無同層對手';
  }
}
