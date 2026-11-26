import {parseConvoyState,type ConvoyState,CONVOY_MIN_PLAYERS,convoyDefinition} from './frontier-convoy.ts';
import {parseCrownState,validCrownWatch,crownZone,type CrownState,type CrownWatchState} from './frontier-crown.ts';
import {parsePartyState,type PartyState} from './aurora-social.ts';
import {parseRotation,type RotationState} from './meridian-social.ts';
import {parseCtfState,parseCtfSummary,ctfTeam,type CtfState} from './lantern-ctf.ts';
/** City social games have their own authority and never write official race progress. */
export const SOCIAL_VERSION = 'frontier-social-v2';
export const SOCIAL_MAX_PLAYERS = 4;
export const SOCIAL_STEP = 1 / 30;
export const SOCIAL_GRACE_MS = 15_000;
export const SOCIAL_MODES = ['cruise', 'chase', 'tandem','convoy','crown','ctf'] as const;
export type SocialMode = typeof SOCIAL_MODES[number];
export type SocialWeather = 'dry' | 'rain' | 'night';
export type SocialPhase = 'lobby' | 'countdown' | 'running' | 'finished';
export type SocialRole = 'driver' | 'pursuer' | 'runner' | 'leader' | 'follower';
export const SOCIAL_LABELS: Record<SocialMode, string> = { cruise: '城市多人自由巡航', chase: '多人警匪追逐', tandem: '雙人追走甩尾',convoy:'車隊巡遊任務',crown:'移動王冠爭奪戰',ctf:'2對2城市搶旗' };
export const SOCIAL_VEHICLES = ['sedan', 'taxi', 'muscle', 'f1', 'super', 'police', 'pickup'] as const;
export interface SocialInput { steer: number; throttle: boolean; brake: boolean; handbrake: boolean; active: boolean }
export interface SocialPose { x: number; z: number; y: number; h: number; vx: number; vz: number; w: number; vy: number; steer: number; pitch: number; roll: number }
export interface SocialPlayer {
  id: string; name: string; slot: number; connected: boolean; ready: boolean; vehicle: string;
  role: SocialRole; pose: SocialPose; ack: number; epoch: number; points: number; combo: number;
  maxCombo: number; captureMs: number; outcome: '' | 'captured' | 'escaped' | 'left';
}
export interface SocialMark { playerId: string; stationId: string; expiresAt: number }
export interface SocialRoom {
  v: typeof SOCIAL_VERSION; code: string; hostId: string; mode: SocialMode; weather: SocialWeather;
  phase: SocialPhase; revision: number; locked: boolean; runId: string; round: number; leg: number;
  serverTime: number; startAt: number | null; endsAt: number | null;
  reason: '' | 'timeout' | 'captured' | 'left' | 'complete' | 'server-stall';
  players: SocialPlayer[]; marks: SocialMark[];convoy?:ConvoyState;crown?:CrownState;party?:PartyState;rotation?:RotationState;ctf?:CtfState;
}
export const SOCIAL_MAX_WATCHERS=4;
export const SOCIAL_WATCH_DELAY_MS=5000;
export const SOCIAL_WATCH_VERSION='frontier-social-watch-v1';
export {CITY_AUTO_RESUME_VERSION as SOCIAL_AUTO_RESUME_VERSION} from './frontier-city-resume.ts';
export type SocialSeatErrorCode='SEAT_BUSY'|'SEAT_EXPIRED'|'SEAT_REJECTED'|'VERSION_MISMATCH'|'ROOM_GONE';
export type SocialWatchPlayer=Pick<SocialPlayer,'name'|'slot'|'vehicle'|'connected'|'role'|'points'|'maxCombo'|'outcome'>;
/** Observers receive one followed pose, never a second car position, marks, host/seat IDs or credentials. */
export interface SocialWatchRoom{
  v:typeof SOCIAL_VERSION;watchVersion:typeof SOCIAL_WATCH_VERSION;code:string;mode:SocialMode;weather:SocialWeather;phase:SocialPhase;runId:string;
  serverTime:number;delayMs:number;round:number;leg:number;reason:SocialRoom['reason'];
  roster:SocialWatchPlayer[];followSlot:number;follow:(SocialWatchPlayer&{pose:SocialPose})|null;crown?:CrownWatchState;ctf?:Pick<CtfState,'scores'|'winner'>;
}
/** Captured when a host opens a confirmation; never rebind an old action to a newer room. */
export type SocialManagement = {code:string;revision:number;hostId:string;targetId:string} &
  ({action:'lock';locked:boolean}|{action:'remove'});
export const socialManageable=(room:Pick<SocialRoom,'phase'|'mode'>)=>room.phase==='lobby'||room.phase==='running'&&room.mode==='cruise';
export const socialCooperative=(mode:SocialMode)=>mode==='cruise'||mode==='convoy';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const number = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const integer = (v: unknown, lo: number, hi: number): v is number => number(v, lo, hi) && Number.isSafeInteger(v);
const text = (v: unknown, size: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= size && !/[\x00-\x1f\x7f<>]/.test(v);
export const socialCode = (v: unknown): v is string => typeof v === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(v);
export function parseSocialRoom(raw: unknown): SocialRoom | null {
  if (!object(raw) || !exact(raw,['v','code','hostId','mode','weather','phase','revision','locked','runId','round','leg','serverTime','startAt','endsAt','reason','players','marks',...raw.mode==='convoy'?['convoy']:[],...raw.mode==='crown'?['crown']:[],...raw.mode==='ctf'?['ctf']:[],...raw.party!==undefined?['party']:[],...raw.rotation!==undefined?['rotation']:[]]) || raw.v !== SOCIAL_VERSION || !socialCode(raw.code) || !text(raw.hostId, 40) || typeof raw.locked!=='boolean' ||
    !SOCIAL_MODES.includes(raw.mode as SocialMode) || !['dry','rain','night'].includes(String(raw.weather)) ||
    !['lobby','countdown','running','finished'].includes(String(raw.phase)) || !integer(raw.revision,1,1e9) ||
    !text(raw.runId,40) || !integer(raw.round,0,1e6) || !integer(raw.leg,0,1) || !number(raw.serverTime,0,1e16) ||
    ![raw.startAt,raw.endsAt].every(v=>v===null||number(v,0,1e16)) ||
    !['','timeout','captured','left','complete','server-stall'].includes(String(raw.reason)) ||
    !Array.isArray(raw.players) || raw.players.length<1 || raw.players.length>4 || !Array.isArray(raw.marks) || raw.marks.length>4) return null;
  if (raw.phase==='lobby' ? raw.startAt!==null||raw.endsAt!==null||raw.reason!=='' :
    raw.startAt===null||raw.endsAt===null||Number(raw.endsAt)<=Number(raw.startAt)||raw.phase==='finished'&&raw.reason===''||raw.phase!=='finished'&&raw.reason!=='') return null;
  if (raw.mode==='tandem'&&raw.players.length>2&&!raw.rotation || raw.mode!=='tandem'&&raw.leg!==0) return null;
  const ids=new Set<string>(),slots=new Set<number>(),players:SocialPlayer[]=[];
  for (const value of raw.players) {
    if (!object(value)||!exact(value,['id','name','slot','vehicle','connected','ready','role','pose','ack','epoch','points','combo','maxCombo','captureMs','outcome'])||!text(value.id,40)||ids.has(value.id)||!text(value.name,20)||!integer(value.slot,0,3)||slots.has(value.slot)||
      typeof value.connected!=='boolean'||typeof value.ready!=='boolean'||!SOCIAL_VEHICLES.includes(value.vehicle as typeof SOCIAL_VEHICLES[number])||
      !['driver','pursuer','runner','leader','follower'].includes(String(value.role))||!object(value.pose)||
      !integer(value.ack,0,1e9)||!integer(value.epoch,0,1e9)||!number(value.points,0,1e8)||!number(value.combo,0,120)||
      !number(value.maxCombo,0,120)||!number(value.captureMs,0,2000)||!['','captured','escaped','left'].includes(String(value.outcome))) return null;
    const p=value.pose;
    if (!exact(p,['x','z','y','h','vx','vz','w','vy','steer','pitch','roll'])||!number(p.x,-15000,15000)||!number(p.z,-15000,15000)||!number(p.y,-150,800)||!number(p.h,-Math.PI,Math.PI)||
      !['vx','vz','w','vy','steer','pitch','roll'].every(k=>number(p[k],-200,200))) return null;
    ids.add(value.id);slots.add(value.slot);
    players.push({...value,pose:{...p}} as unknown as SocialPlayer);
  }
  if (!ids.has(raw.hostId)) return null;
  if(raw.rotation!==undefined){const rot=parseRotation(raw.rotation,players.map(p=>p.slot),String(raw.phase));if(raw.mode!=='tandem'||!rot)return null;if(raw.phase!=='lobby'){const heat=rot.heats[rot.cursor];if(players.some(p=>p.role!==(p.slot===heat.leaderSlot?'leader':p.slot===heat.followerSlot?'follower':'driver')||p.vehicle!=='muscle'))return null;}}
  if(raw.party!==undefined&&(!parsePartyState(raw.party,players.map(p=>p.slot))||!['cruise','convoy','crown','chase'].includes(String(raw.mode))))return null;
  const marks:SocialMark[]=[],markPlayers=new Set();
  for (const value of raw.marks) {
    if (!object(value)||!exact(value,['playerId','stationId','expiresAt'])||typeof value.playerId!=='string'||!ids.has(value.playerId)||markPlayers.has(value.playerId)||
      !text(value.stationId,50)||!number(value.expiresAt,raw.serverTime,Number(raw.serverTime)+30_000)) return null;
    markPlayers.add(value.playerId);marks.push(value as unknown as SocialMark);
  }
  if(raw.mode==='convoy'){
    const c=parseConvoyState(raw.convoy);if(!c||c.participants.length!==players.length||c.participants.some(p=>!players.some(q=>q.slot===p.slot)||p.withdrawn!==players.some(q=>q.slot===p.slot&&q.outcome==='left')))return null;
    if(raw.phase==='lobby'&&(c.completed!==0||c.participants.some(p=>p.next||p.arrived||p.dwellMs||p.withdrawn))||raw.phase==='finished'&&raw.reason==='complete'&&(c.completed!==convoyDefinition(c.routeId)!.stations.length||c.participants.filter(p=>!p.withdrawn&&p.arrived).length<CONVOY_MIN_PLAYERS)||raw.phase!=='finished'&&c.completed===convoyDefinition(c.routeId)!.stations.length)return null;
  }
  if(raw.mode==='crown'){
    const c=parseCrownState(raw.crown),finished=raw.phase==='finished'&&raw.reason==='complete';if(!c||c.members.length!==players.length||c.holderSlot!==null&&!players.some(p=>p.slot===c.holderSlot)||players.some(p=>p.role!=='driver'||p.points>180)||players.reduce((s,p)=>s+p.points,0)>180.201||c.members.some(m=>{const p=players.find(p=>p.slot===m.slot);return !p||m.zone!==(p.outcome==='left'?'left':!p.connected?'offline':crownZone(p.pose));}))return null;
    if(raw.phase==='lobby'&&(c.lastChange!=='none'||players.some(p=>p.points))||raw.phase!=='lobby'&&c.lastChange==='none'||finished!==(c.winnerPoints!==null)||finished&&(c.winnerPoints!==Math.max(0,...players.filter(p=>!p.outcome).map(p=>p.points))||players.filter(p=>!p.outcome).length<2)||raw.phase!=='lobby'&&Number(raw.endsAt)-Number(raw.startAt)!==180000||c.protectedUntil>(Number(raw.startAt??raw.serverTime)+183000))return null;
  }
  if(raw.mode==='ctf'){const c=parseCtfState(raw.ctf);if(!c||raw.party!==undefined||raw.rotation!==undefined||players.some(p=>p.role!=='driver'||!Number.isInteger(p.points))||['red','blue'].some(t=>players.filter(p=>ctfTeam(p.slot)===t).reduce((sum,p)=>sum+p.points,0)!==c.scores[t as 'red'|'blue'])||raw.phase!=='lobby'&&players.length!==4||raw.phase!=='lobby'&&Number(raw.endsAt)-Number(raw.startAt)!==180000||(raw.phase==='finished'&&raw.reason==='complete')!==(c.winner!==null)||c.flags.some(f=>f.carrierSlot!==null&&!players.some(p=>p.slot===f.carrierSlot&&p.connected&&!p.outcome&&ctfTeam(p.slot)!==f.team))||raw.phase==='lobby'&&(c.scores.red!==0||c.scores.blue!==0))return null;}
  return {...raw,players,marks} as unknown as SocialRoom;
}
export function parseSocialWatch(raw:unknown):SocialWatchRoom|null{
  if(!object(raw)||!exact(raw,['v','watchVersion','code','mode','weather','phase','runId','serverTime','delayMs','round','leg','reason','roster','followSlot','follow',...raw.mode==='crown'?['crown']:[],...raw.mode==='ctf'?['ctf']:[]])||raw.v!==SOCIAL_VERSION||raw.watchVersion!==SOCIAL_WATCH_VERSION||!socialCode(raw.code)||
    !SOCIAL_MODES.includes(raw.mode as SocialMode)||!['dry','rain','night'].includes(String(raw.weather))||!['lobby','countdown','running','finished'].includes(String(raw.phase))||
    !text(raw.runId,40)||!number(raw.serverTime,0,1e16)||!integer(raw.delayMs,0,SOCIAL_WATCH_DELAY_MS)||!integer(raw.round,0,1e6)||!integer(raw.leg,0,1)||!integer(raw.followSlot,0,3)||
    !['','timeout','captured','left','complete','server-stall'].includes(String(raw.reason))||!Array.isArray(raw.roster)||raw.roster.length>4)return null;
  const slots=new Set<number>();const validPlayer=(p:Record<string,unknown>)=>text(p.name,20)&&integer(p.slot,0,3)&&SOCIAL_VEHICLES.includes(p.vehicle as typeof SOCIAL_VEHICLES[number])&&typeof p.connected==='boolean'&&
    ['driver','pursuer','runner','leader','follower'].includes(String(p.role))&&number(p.points,0,1e8)&&number(p.maxCombo,0,120)&&['','captured','escaped','left'].includes(String(p.outcome));
  const keys=['name','slot','vehicle','connected','role','points','maxCombo','outcome'];
  for(const p of raw.roster){if(!object(p)||!exact(p,keys)||!validPlayer(p)||slots.has(p.slot as number))return null;slots.add(p.slot as number);}
  if(raw.follow!==null){const p=raw.follow;if(!object(p)||!exact(p,[...keys,'pose'])||!validPlayer(p)||p.slot!==raw.followSlot||!slots.has(p.slot as number)||!object(p.pose))return null;
    const v=p.pose;if(!exact(v,['x','z','y','h','vx','vz','w','vy','steer','pitch','roll'])||!number(v.x,-15000,15000)||!number(v.z,-15000,15000)||!number(v.y,-150,800)||!number(v.h,-Math.PI,Math.PI)||!['vx','vz','w','vy','steer','pitch','roll'].every(k=>number(v[k],-200,200)))return null;}
  if(socialCooperative(raw.mode as SocialMode)?raw.delayMs!==0:raw.delayMs!==SOCIAL_WATCH_DELAY_MS)return null;
  if(raw.mode==='crown'&&(!validCrownWatch(raw.crown)||raw.crown.holderSlot!==null&&!slots.has(raw.crown.holderSlot)))return null;
  if(raw.mode==='ctf'&&!parseCtfSummary(raw.ctf))return null;
  return structuredClone(raw) as unknown as SocialWatchRoom;
}
/** Only actual poses from authority are used by these scoring predicates. */
export function captureEligible(runner:SocialPose,pursuer:SocialPose) {
  return Math.hypot(runner.x-pursuer.x,runner.z-pursuer.z)<=6&&Math.abs(runner.y-pursuer.y)<1.8&&
    Math.hypot(runner.vx,runner.vz)<5&&Math.hypot(pursuer.vx,pursuer.vz)<8&&
    Math.hypot(runner.vx-pursuer.vx,runner.vz-pursuer.vz)<6;
}
export function tandemQuality(leader:SocialPose,follower:SocialPose) {
  const dx=leader.x-follower.x,dz=leader.z-follower.z;
  const gap=dx*Math.sin(leader.h)+dz*Math.cos(leader.h),side=Math.abs(dx*Math.cos(leader.h)-dz*Math.sin(leader.h));
  const heading=Math.abs(Math.atan2(Math.sin(leader.h-follower.h),Math.cos(leader.h-follower.h)));
  const forward=follower.vx*Math.sin(follower.h)+follower.vz*Math.cos(follower.h);
  const lateral=follower.vx*Math.cos(follower.h)-follower.vz*Math.sin(follower.h);
  const slip=Math.abs(Math.atan2(lateral,forward));
  if (gap<3||gap>25||side>8||Math.abs(leader.y-follower.y)>1.8||heading>.7||
    Math.hypot(leader.vx,leader.vz)<7||Math.hypot(follower.vx,follower.vz)<7||forward<3||slip<.14||slip>1.05) return 0;
  return (1-Math.abs(gap-12)/22)*Math.min(1,slip/.5)*(1-side/12);
}
