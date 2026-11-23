/** Rex <game88521@gmail.com>. One authoritative regularity contract; milliseconds are the scoring unit. */
import {CITY_RACE_VERSION,parseCityRaceRoom,type CityRaceRoom,type CityRacePlayer,type CityRaceInput} from './summit-city-race.ts';
import type {WorkshopRoute} from '../src/nexus-workshop.ts';
import {parseNavigator,type NavigatorState} from './meridian-navigator.ts';
export const FRONTIER_RALLY_VERSION='frontier-rally-v1';
export const FRONTIER_RALLY_SEAT_KEY='taipei-gp-frontier-rally-seat-v1';
export const FRONTIER_RALLY_GRACE_MS=15_000;
export const FRONTIER_RALLY_AVERAGES=[28,36,42] as const;
export const FRONTIER_RALLY_SPEED_LIMIT=50;
export type RallyAverage=typeof FRONTIER_RALLY_AVERAGES[number];
export const AURORA_RALLY_VERSION='aurora-rally-v1';
export const RALLY_COURSES=[{id:'xinyi-songshan',name:'信義—松山分段拉力',from:0,to:2},{id:'xinyi-xinan',name:'信義—信安分段拉力',from:0,to:6},{id:'civic-songshan',name:'市民—松山分段拉力',from:3,to:2}] as const;
export interface RallyPlan{version:typeof AURORA_RALLY_VERSION;courseId:typeof RALLY_COURSES[number]['id'];averages:[RallyAverage,RallyAverage,RallyAverage,RallyAverage]}
export type RallyInput=CityRaceInput;
export interface RallyTiming{gate:number;distanceM:number;dueMs:number}
export interface RallyArrival{gate:number;dueMs:number;actualMs:number;deltaMs:number}
export interface RallyPlayer extends CityRacePlayer{arrivals:RallyArrival[];timingPenaltyMs:number;speedPenaltyMs:number;penaltyMs:number;rank:number|null;needsConfirm:boolean}
export interface RallyRoom extends Omit<CityRaceRoom,'v'|'players'>{v:typeof FRONTIER_RALLY_VERSION;average:RallyAverage;limit:50;timing:RallyTiming[];reason:''|'complete'|'timeout'|'server-stall'|'crew-disconnected';players:RallyPlayer[];coursePlan?:RallyPlan;navigator?:NavigatorState}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const num=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const int=(v:unknown,min:number,max:number):v is number=>Number.isSafeInteger(v)&&num(v,min,max);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
export const rallyCode=(v:unknown):v is string=>typeof v==='string'&&/^[A-HJ-NP-Z2-9]{6}$/.test(v);
export function parseRallyPlan(v:unknown):RallyPlan|null{return obj(v)&&exact(v,['version','courseId','averages'])&&v.version===AURORA_RALLY_VERSION&&RALLY_COURSES.some(c=>c.id===v.courseId)&&Array.isArray(v.averages)&&v.averages.length===4&&v.averages.every(a=>FRONTIER_RALLY_AVERAGES.includes(a))?structuredClone(v) as unknown as RallyPlan:null;}
/** WorkshopRoads produces a gate every 30 travelled metres, followed by its exact endpoint. */
export function rallyTiming(route:Pick<WorkshopRoute,'gates'|'length'>,average:RallyAverage,plan?:RallyPlan):RallyTiming[]{
 if(!FRONTIER_RALLY_AVERAGES.includes(average)||route.gates.length<8||route.gates.length>700||!num(route.length,200,20000))throw Error('定速拉力路線無效');
 if(!plan){const count=route.gates.length;return[.25,.5,.75,1].map(f=>{const gate=Math.ceil(count*f)-1,distanceM=gate===count-1?route.length:Math.min(route.length,(gate+1)*30);return{gate,distanceM,dueMs:Math.round(distanceM/(average/3.6)*1000)};});}
 if(plan&&!parseRallyPlan(plan))throw Error('分段拉力計畫無效');let elapsed=0,priorDistance=0;
 const count=route.gates.length;return[.25,.5,.75,1].map((f,index)=>{const gate=Math.ceil(count*f)-1,distanceM=gate===count-1?route.length:Math.min(route.length,(gate+1)*30);elapsed+=(distanceM-priorDistance)/((plan?.averages[index]??average)/3.6)*1000;priorDistance=distanceM;return{gate,distanceM,dueMs:Math.round(elapsed)};});
}
export function rallyRoadbook(route:Pick<WorkshopRoute,'path'>,distance:number){let at=0;const rows:{distance:number;turn:string}[]=[];for(let i=1;i<route.path.length-1;i++){const[a,b,c]=[route.path[i-1],route.path[i],route.path[i+1]];at+=Math.hypot(b[0]-a[0],b[1]-a[1]);const delta=Math.atan2(Math.sin(Math.atan2(c[0]-b[0],c[1]-b[1])-Math.atan2(b[0]-a[0],b[1]-a[1])),Math.cos(Math.atan2(c[0]-b[0],c[1]-b[1])-Math.atan2(b[0]-a[0],b[1]-a[1])));if(Math.abs(delta)>.35&&at>=distance-5)rows.push({distance:Math.max(0,Math.round(at-distance)),turn:Math.abs(delta)>2.5?'迴轉':delta>0?'右彎':'左彎'});}return rows.slice(0,3);}
export function parseRallyRoom(raw:unknown):RallyRoom|null{
 if(!obj(raw)||!exact(raw,['v','code','hostId','revision','phase','matchId','startAt','deadlineAt','serverTime','collisions','definition','route','players','average','limit','timing','reason',...('coursePlan'in raw?['coursePlan']:[]),...('navigator'in raw?['navigator']:[])])||'coursePlan'in raw&&!parseRallyPlan(raw.coursePlan)||raw.v!==FRONTIER_RALLY_VERSION||!FRONTIER_RALLY_AVERAGES.includes(raw.average as RallyAverage)||raw.limit!==50||raw.collisions!==false||!['','complete','timeout','server-stall','crew-disconnected'].includes(String(raw.reason)))return null;
 const base=parseCityRaceRoom({...raw,v:CITY_RACE_VERSION});if(!base||base.definition.v!==1||base.definition.car!=='sedan'||base.definition.weather!=='day'||base.definition.hits!==20||!num(base.serverTime,0,1e16)||!int(base.revision,1,1e9)||!(base.matchId===null||/^[a-f0-9]{24}$/.test(base.matchId)))return null;
 if(!obj(raw.route)||!exact(raw.route,['path','ys','length','anchors','gates','start'])||!Array.isArray(raw.route.anchors)||raw.route.anchors.length<2||raw.route.anchors.length>12||!raw.route.anchors.every(p=>obj(p)&&exact(p,['x','z','y'])&&['x','z','y'].every(k=>num(p[k],-12000,12000)))||!exact(base.route.start as unknown as Record<string,unknown>,['x','z','y','h'])||!base.route.path.every(p=>p.every(n=>Math.abs(n)<=12000))||!base.route.ys.every(y=>num(y,-120,600))||!base.route.gates.every(p=>exact(p as unknown as Record<string,unknown>,['x','z','y'])&&num(p.x,-12000,12000)&&num(p.z,-12000,12000)&&num(p.y,-120,600)))return null;
 let timing:RallyTiming[];try{timing=rallyTiming(base.route,raw.average as RallyAverage,raw.coursePlan as RallyPlan|undefined);}catch{return null;}
 if(!Array.isArray(raw.timing)||raw.timing.length!==4||!raw.timing.every((t,i)=>obj(t)&&exact(t,['gate','distanceM','dueMs'])&&t.gate===timing[i].gate&&t.distanceM===timing[i].distanceM&&t.dueMs===timing[i].dueMs))return null;
 const phases=base.phase==='lobby'?base.matchId===null&&base.startAt===null&&base.deadlineAt===null&&raw.reason==='':base.matchId!==null&&num(base.startAt,0,1e16)&&num(base.deadlineAt,Number(base.startAt)+1,Number(base.startAt)+600000)&&(base.phase==='results'?raw.reason!=='':raw.reason==='');if(!phases)return null;
 for(const rawPlayer of raw.players as unknown[]){
  if(!obj(rawPlayer)||!exact(rawPlayer,['id','name','slot','connected','ready','next','distance','finishMs','dnf','ack','ghostUntil','contactCount','pose','physics','motionRevision','completedLaps','lapTimes','arrivals','timingPenaltyMs','speedPenaltyMs','penaltyMs','rank','needsConfirm'])||!exact(rawPlayer.pose as Record<string,unknown>,['x','z','y','h','vx','vz','steer','pitch','roll'])||!exact(rawPlayer.physics as Record<string,unknown>,['w','vy'])||!num(rawPlayer.distance,0,20000)||!int(rawPlayer.ack,0,1e9)||!int(rawPlayer.motionRevision,0,1e9)||rawPlayer.contactCount!==0||rawPlayer.ghostUntil!==0||typeof rawPlayer.needsConfirm!=='boolean'||!int(rawPlayer.timingPenaltyMs,0,1e8)||!int(rawPlayer.speedPenaltyMs,0,1e8)||!int(rawPlayer.penaltyMs,0,2e8)||rawPlayer.penaltyMs!==Number(rawPlayer.timingPenaltyMs)+Number(rawPlayer.speedPenaltyMs)||!(rawPlayer.rank===null||int(rawPlayer.rank,1,4))||!Array.isArray(rawPlayer.arrivals)||rawPlayer.arrivals.length>4)return null;
  let sum=0,prior=-1;for(let i=0;i<rawPlayer.arrivals.length;i++){const a=rawPlayer.arrivals[i],t=timing[i];if(!obj(a)||!exact(a,['gate','dueMs','actualMs','deltaMs'])||a.gate!==t.gate||a.dueMs!==t.dueMs||!int(a.actualMs,0,600000)||a.actualMs<prior||!int(a.deltaMs,-600000,600000)||a.deltaMs!==a.actualMs-t.dueMs||Number(rawPlayer.next)<=t.gate)return null;prior=a.actualMs;sum+=Math.abs(a.deltaMs);}
  if(sum!==rawPlayer.timingPenaltyMs||rawPlayer.finishMs!==null&&rawPlayer.arrivals.length!==4||rawPlayer.rank!==null&&(base.phase!=='results'||rawPlayer.finishMs===null||rawPlayer.dnf!==null||raw.reason==='server-stall')||rawPlayer.dnf!==null&&(typeof rawPlayer.dnf!=='string'||rawPlayer.dnf.length>60))return null;
 }
 const players=raw.players as unknown as RallyPlayer[];for(const p of players){const expected=base.phase==='results'&&raw.reason!=='server-stall'&&p.finishMs!==null&&!p.dnf?1+players.filter(q=>q.finishMs!==null&&!q.dnf&&q.penaltyMs<p.penaltyMs).length:null;if(p.rank!==expected)return null;}
 if('navigator'in raw){const nav=parseNavigator(raw.navigator);if(!nav||players.length>2||players.some(p=>![nav.driverSlot,nav.navigatorSlot].includes(p.slot))||base.phase!=='lobby'&&players.length!==2||nav.lastCall&&nav.lastCall.at>base.serverTime||nav.paused&& !['countdown','racing'].includes(base.phase))return null;if(base.phase!=='lobby'&&players.length===2){const[d,n]=[players.find(p=>p.slot===nav.driverSlot)!,players.find(p=>p.slot===nav.navigatorSlot)!];for(const key of ['next','distance','finishMs','dnf','timingPenaltyMs','speedPenaltyMs','penaltyMs','rank','completedLaps','pose','arrivals','lapTimes','physics'] as const)if(JSON.stringify(d[key])!==JSON.stringify(n[key]))return null;}}else if(raw.reason==='crew-disconnected')return null;
 return structuredClone(raw) as unknown as RallyRoom;
}
