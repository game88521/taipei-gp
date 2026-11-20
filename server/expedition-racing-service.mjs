import { EXPEDITION_RACING_VERSION, expeditionSettings, expeditionPenaltyMs } from '../shared/expedition-racing.ts';
import { summitEvent } from './summit-events-service.mjs';
export const expeditionEnabled = r => !!r.expedition && (r.expedition.settings.boundary || r.expedition.settings.vsc);
const compatible = r => !r.series && r.evolution.mode === 'race' && !Object.values(r.horizon).some(Boolean) && (r.arena?.mode ?? 'off') === 'off' && !r.summit?.settings.weekend && !r.summit?.settings.endurance && !r.voyager?.settings.practiceSeconds && !r.odyssey?.settings.sprintWeekend && !r.odyssey?.settings.mandatoryStop;
export function expeditionReset(p) { p.expedition = { warnings: 0, vscPasses: 0, penaltyMs: 0, adjustedFinishMs: null, lastReason: null, lastAt: null }; p.expeditionOutside = null; p.expeditionRecorded = false; p.expeditionOnTrack = null; }
export const expeditionPlayer = p => ({ ...p.expedition, adjustedFinishMs: p.finishMs === null ? null : Math.round((p.finishMs + p.expedition.penaltyMs) * 1000) / 1000 });
export const expeditionJoinError = (r, m) => expeditionEnabled(r) && m.clientCapabilities?.expeditionRacing !== true ? '此房啟用正式賽規，請更新遊戲後加入。' : '';
export function expeditionReceive(s, c, m, now) {
  const r = c.room, p = c.player, fail = text => { s.send(c, { type: 'error', code: 'EXPEDITION_RULE', message: text, requestId: m.requestId }); return true; };
  if (expeditionEnabled(r ?? {}) && (['configure-series', 'random-series', 'configure-event', 'set-horizon', 'set-arena', 'set-odyssey'].includes(m.type) || m.type === 'set-summit' && (m.settings?.weekend || m.settings?.endurance))) return fail('請先關閉正式賽規，再切換系列或特殊玩法。');
  if (expeditionEnabled(r ?? {}) && m.type === 'set-voyager' && m.settings?.practiceSeconds) return fail('正式賽規不能套用自由練習。');
  if (m.type !== 'set-expedition') return false;
  const settings = expeditionSettings(m.settings);
  if (!r || !p || c.viewer || !p.supportsExpedition || p.id !== r.hostId || r.phase !== 'lobby' || m.roomCode !== r.code || m.expectedLobbyRevision !== r.lobbyRevision || !settings || Object.keys(m).some(k => !['type', 'roomCode', 'expectedLobbyRevision', 'settings', 'requestId'].includes(k))) return fail('只有新版房主能在最新大廳設定正式賽規。');
  if ((settings.boundary || settings.vsc) && (!compatible(r) || [...r.players.values()].some(q => !q.isAi && !q.supportsExpedition) || [...r.spectators.values()].some(q => !q.supportsExpedition))) return fail('正式賽規限一般圈數單場，所有玩家與觀眾需使用新版。');
  r.expedition = { version: EXPEDITION_RACING_VERSION, settings }; r.expeditionOrder = null; for (const q of r.players.values()) expeditionReset(q);
  s.invalidateEvolutionLobby(r, now); s.broadcast(r, 'room', now); return true;
}
function infraction(r, p, at, kind) {
  const a = p.expedition; if (kind === 'boundary') a.warnings = Math.min(999, a.warnings + 1); else a.vscPasses = Math.min(999, a.vscPasses + 1);
  a.penaltyMs = expeditionPenaltyMs(a.warnings, a.vscPasses); a.lastReason = kind; a.lastAt = Math.max(0, Math.round(at - r.startAt));
  summitEvent(r, at, kind === 'boundary' ? 'boundary' : 'flag', [p.id], `${kind === 'boundary' ? '持續越界' : 'VSC進度超車'}；界線${a.warnings}次／VSC${a.vscPasses}次，累積罰${a.penaltyMs / 1000}秒`);
}
export function expeditionTick(r, at) {
  if (!expeditionEnabled(r)) return;
  const active = [...r.players.values()].filter(p => !p.dnf && p.finishMs === null && p.connected && p.loaded && !p.block?.ghost && !(p.summit?.pitUntil > at));
  for(const p of r.players.values())if(!active.includes(p)){p.expeditionOutside=null;p.expeditionOnTrack=null;}
  for (const p of active) {
    p.expedition ??= (expeditionReset(p), p.expedition);
    const outside = Math.abs(p.car.pos.lat) > 6.2 && Math.abs(p.car.v) > 5;
    if (r.expedition.settings.boundary && outside) { p.expeditionOnTrack = null; p.expeditionOutside ??= at;
      if (!p.expeditionRecorded && at - p.expeditionOutside >= 1000) { p.expeditionRecorded = true; infraction(r, p, at, 'boundary'); }
    } else { p.expeditionOutside = null; p.expeditionOnTrack ??= at; if (at - p.expeditionOnTrack >= 1000) p.expeditionRecorded = false; }
  }
  const vsc = r.voyager?.vsc?.phase;
  if (!r.expedition.settings.vsc || !(vsc==='active'||vsc==='resuming'&&at<r.voyager.vsc.resumeAt) || at - r.startAt < 3000) { r.expeditionOrder = null; return; }
  const eligible = active.filter(p => Math.abs(p.car.v) > 3 && Math.abs(p.car.pos.lat) < 6.2).sort((a,b)=>a.id.localeCompare(b.id));
  const old = r.expeditionOrder ?? new Map(), next = new Map();
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i], b = eligible[j], key = `${a.id}:${b.id}`, gap = a.distance - b.distance, prior = old.get(key);
    if(Math.abs(gap)>80)continue;
    if(Math.abs(gap)<=.5){if(prior!==undefined)next.set(key,prior);continue;}
    const ahead=gap>0?a.id:b.id;next.set(key,ahead);
    if(prior!==undefined&&prior!==ahead&&at-(r.expeditionPassCooldown?.get(key)??-Infinity)>3000){
      (r.expeditionPassCooldown??=new Map()).set(key,at);infraction(r,ahead===a.id?a:b,at,'vsc');
    }
  }
  r.expeditionOrder = next;
}
