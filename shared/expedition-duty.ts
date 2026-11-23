/** Expedition crew: the server owns the shared truck and every rescue operation. */
import {parseDutyMission,type DutyMission} from './frontier-duty-missions.ts';
import {parseCrewTeam,crewPaused,TEAM_ROLES,type TeamRole,type CrewTeamState} from './aurora-duty.ts';
export const EXPEDITION_DUTY_VERSION = 'city-duty-v2';
export const DUTY_CREW_GRACE = 15000;
export const CREW_MAX_VIEWERS = 4;
export const CREW_RESUME_ERRORS=['SEAT_BUSY','SEAT_EXPIRED','SEAT_REJECTED','VERSION_MISMATCH','ROOM_GONE'] as const;
export type CrewResumeError=typeof CREW_RESUME_ERRORS[number];
export interface CrewWatchState{count:number;max:typeof CREW_MAX_VIEWERS}
export function parseCrewWatchState(v:unknown):CrewWatchState|null{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['count','max'].includes(k))&&Number.isSafeInteger((v as CrewWatchState).count)&&(v as CrewWatchState).count>=0&&(v as CrewWatchState).count<=CREW_MAX_VIEWERS&&(v as CrewWatchState).max===CREW_MAX_VIEWERS?{count:(v as CrewWatchState).count,max:CREW_MAX_VIEWERS}:null;}
export const CREW_DEPOT = { x: 467.12, z: 515.8, y: -.25, h: 0, name: '信義勤務站' };
export const CREW_INCIDENT = { x: -153.99, z: 1283.8, y: -.25, h: 0, name: '信安街救援現場' };
export type CrewRole = TeamRole;
export type CrewStage = 'approach' | 'warning' | 'positioning' | 'winch' | 'securing' | 'returning' | 'unloading' | 'complete';
export const CREW_STAGE_LABEL: Record<CrewStage, string> = { approach:'前往現場',warning:'協助者設置警示',positioning:'司機確認平台定位',winch:'協助者操作絞盤',securing:'司機確認固定',returning:'滿載返回',unloading:'協助者卸載',complete:'救援完成' };
export interface CrewPose { x:number;z:number;y:number;h:number;vx:number;vz:number;steer:number;pitch:number;roll:number }
export interface CrewPoint { x:number;z:number;y:number;h:number;name:string }
export interface CrewInput { steer:number;throttle:boolean;brake:boolean;handbrake:boolean;active:boolean }
export interface CrewRoute { path:[number,number][];ys:number[];gates:{x:number;z:number;y:number}[];start:CrewPoint;target:CrewPoint;length:number }
export interface CrewPlayer { id:string;name:string;role:CrewRole;connected:boolean;ready:boolean }
export interface CrewRoom {
 v:typeof EXPEDITION_DUTY_VERSION;code:string;hostId:string;revision:number;runId:string;
 phase:'lobby'|'running'|'finished';stage:CrewStage;serverTime:number;startedAt:number|null;elapsed:number;
 players:CrewPlayer[];pose:CrewPose;ack:number;next:number;dwell:number;integrity:number;
 winch:{along:number;lateral:number;blocked:boolean};operation:number;paused:boolean;reason:string;
 route:CrewRoute;outbound:CrewRoute;homebound:CrewRoute;mission:DutyMission;team?:CrewTeamState;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const num=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const only=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
const label=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{20}$/.test(v);
export const crewCode=(v:unknown):v is string=>typeof v==='string'&&/^[A-HJ-NP-Z2-9]{6}$/.test(v);
const point=(p:unknown):p is CrewPoint=>object(p)&&only(p,['x','z','y','h','name'])&&num(p.x,-12000,12000)&&num(p.z,-12000,12000)&&num(p.y,-80,500)&&num(p.h,-Math.PI*2,Math.PI*2)&&label(p.name,80);
function route(v:unknown):v is CrewRoute{return object(v)&&only(v,['path','ys','gates','start','target','length'])&&point(v.start)&&point(v.target)&&num(v.length,1,20000)&&Array.isArray(v.path)&&v.path.length>=2&&v.path.length<=20000&&Array.isArray(v.ys)&&v.ys.length===v.path.length&&v.path.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>num(n,-12000,12000)))&&v.ys.every(y=>num(y,-80,500))&&Array.isArray(v.gates)&&v.gates.length>0&&v.gates.length<=1000&&v.gates.every(g=>object(g)&&only(g,['x','z','y'])&&num(g.x,-12000,12000)&&num(g.z,-12000,12000)&&num(g.y,-80,500));}
export function parseCrewRoom(v:unknown):CrewRoom|null{
 if(!object(v)||!only(v,['v','code','hostId','revision','runId','phase','stage','serverTime','startedAt','elapsed','players','pose','ack','next','dwell','integrity','winch','operation','paused','reason','route','outbound','homebound','mission','team'])||v.v!==EXPEDITION_DUTY_VERSION||!crewCode(v.code)||!id(v.hostId)||!id(v.runId)||!num(v.revision,1,1e9)||!Number.isSafeInteger(v.revision)||!['lobby','running','finished'].includes(String(v.phase))||!Object.hasOwn(CREW_STAGE_LABEL,String(v.stage))||!num(v.serverTime,0,1e16)||!(v.startedAt===null||num(v.startedAt,0,1e16))||!num(v.elapsed,0,5401)||!num(v.integrity,0,100)||!num(v.dwell,0,2)||!num(v.operation,0,5)||!num(v.ack,0,1e9)||!Number.isSafeInteger(v.ack)||!num(v.next,0,1000)||!Number.isSafeInteger(v.next)||typeof v.paused!=='boolean'||typeof v.reason!=='string'||v.reason.length>200)return null;
 if(!Array.isArray(v.players)||v.players.length<1||v.players.length>(v.team?4:2))return null;
 const ids=new Set(),roles=new Set();for(const p of v.players){if(!object(p)||!only(p,['id','name','role','connected','ready'])||!id(p.id)||ids.has(p.id)||!label(p.name,20)||!(v.team?TEAM_ROLES:['driver','technician']).includes(String(p.role) as TeamRole)||roles.has(p.role)||typeof p.connected!=='boolean'||typeof p.ready!=='boolean')return null;ids.add(p.id);roles.add(p.role);}
 const players=v.players as unknown as CrewPlayer[],team=v.team===undefined?undefined:parseCrewTeam(v.team,players);if(v.team!==undefined&&!team)return null;
 if(!ids.has(v.hostId)||!team&&!roles.has('driver')||!object(v.pose)||!only(v.pose,['x','z','y','h','vx','vz','steer','pitch','roll'])||!num(v.pose.x,-12000,12000)||!num(v.pose.z,-12000,12000)||!num(v.pose.y,-80,500)||!num(v.pose.h,-Math.PI-1e-6,Math.PI+1e-6)||!num(v.pose.vx,-120,120)||!num(v.pose.vz,-120,120)||!num(v.pose.steer,-1,1)||!num(v.pose.pitch,-Math.PI,Math.PI)||!num(v.pose.roll,-Math.PI,Math.PI))return null;
 if(!object(v.winch)||!only(v.winch,['along','lateral','blocked'])||!num(v.winch.along,0,4.2)||!num(v.winch.lateral,-1.4,1.4)||typeof v.winch.blocked!=='boolean'||!route(v.route)||!route(v.outbound)||!route(v.homebound)||v.next>v.route.gates.length)return null;
 if(v.paused!==crewPaused(players,team??undefined))return null;
 if(v.phase==='running'&&(v.startedAt===null||!team&&v.players.length!==2)||v.stage==='complete'&&v.phase!=='finished')return null;
 const mission=parseDutyMission(v.mission);if(!mission||mission.caseStartedElapsed>v.elapsed+1e-6||v.elapsed-mission.caseStartedElapsed>1801||v.elapsed>mission.settings.incidents.length*1800+1||v.stage==='complete'&&mission.completed.length!==mission.settings.incidents.length||v.stage!=='complete'&&mission.completed.length!==mission.caseIndex)return null;
 return structuredClone(v) as unknown as CrewRoom;
}
