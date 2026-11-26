/** Rex <game88521@gmail.com>. Anonymous city playback data; never carries a player ID, name, room code, or seat token. */
import {COOP_CITY_STAMP} from './nexus-coop.ts';

export const CITY_REPLAY_VERSION='frontier-city-replay-v1';
export const CITY_REPLAY_STEP_MS=200;
export const CITY_REPLAY_MAX_MS=12*60_000;
export const CITY_REPLAY_MAX_FRAMES=CITY_REPLAY_MAX_MS/CITY_REPLAY_STEP_MS+2;
export const CITY_REPLAY_MAX_ACTORS=16;
export const CITY_REPLAY_MAX_EVENTS=512;
export const CITY_REPLAY_MAX_CHARS=8*1024*1024;
export const CITY_REPLAY_CHUNK_CHARS=24*1024;
export const CITY_REPLAY_MODES=['cruise','chase','tandem','convoy','crown','ctf','rescue','rally'] as const;
export const CITY_REPLAY_VEHICLES=['sedan','taxi','muscle','f1','super','police','pickup','rescue'] as const;
export const CITY_REPLAY_ROLES=['driver','pursuer','runner','leader','follower','truck'] as const;
export const CITY_REPLAY_EVENTS=['contact','capture','stage','operation','disconnect','reconnect','finish','round','weather','recover','join','leave','crown'] as const;
export const CITY_REPLAY_DETAILS=['','approach','warning','positioning','winch','securing','returning','unloading','complete','position','wind','unwind','secure','unload','stop','driver','technician','dry','rain','night','first','second','captured','escaped','left','timeout','server-stall','removed','crown-start','crown-transfer','crown-return','safety-front','safety-rear','safety-clear','dispatch-brief','dispatch-depot','crew-cover'] as const;
export const CITY_REPLAY_REASONS=['complete','timeout','captured','left','server-stall','stopped','invalid-state','integrity'] as const;
export type CityReplayMode=typeof CITY_REPLAY_MODES[number];
export type CityReplayEventType=typeof CITY_REPLAY_EVENTS[number];
export type CityReplayVehicle=typeof CITY_REPLAY_VEHICLES[number];
export type CityReplayRole=typeof CITY_REPLAY_ROLES[number];
export type CityReplayReason=typeof CITY_REPLAY_REASONS[number];
export type CityReplayWeather='dry'|'rain'|'night';
export interface CityReplayDescriptor{key:string;ready:boolean;frames:number;durationMs:number;recordedMs:number;truncated:boolean}
export interface CityReplayPart{type:'city-replay-part';key:string;offset:number;totalChars:number;text:string}
export interface CityReplayPose{actor:number;vehicle:CityReplayVehicle;x:number;y:number;z:number;h:number;vx:number;vz:number;steer:number;pitch:number;roll:number;epoch:number;visible:boolean;role:CityReplayRole;outcome:''|'captured'|'escaped'|'left'}
export interface CityReplayDuty{stage:'approach'|'warning'|'positioning'|'winch'|'securing'|'returning'|'unloading'|'complete';integrity:number;operation:number;dwell:number;next:number;winch:{along:number;lateral:number;blocked:boolean};loaded:boolean;incident:{x:number;y:number;z:number;h:number}|null}
export interface CityReplayFrame{at:number;weather:CityReplayWeather;cars:CityReplayPose[];duty:CityReplayDuty|null}
export interface CityReplayEvent{at:number;type:CityReplayEventType;actors:number[];detail:typeof CITY_REPLAY_DETAILS[number]}
export interface CityReplayArchive{schema:1;version:typeof CITY_REPLAY_VERSION;cityStamp:string;source:'social'|'duty';mode:CityReplayMode;weather:CityReplayWeather;durationMs:number;recordedMs:number;truncated:boolean;reason:CityReplayReason;actors:{slot:number}[];frames:CityReplayFrame[];events:CityReplayEvent[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const number=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const integer=(v:unknown,lo:number,hi:number):v is number=>number(v,lo,hi)&&Number.isSafeInteger(v);
const includes=(list:readonly string[],v:unknown)=>typeof v==='string'&&list.includes(v);
export function parseCityReplayDescriptor(value:unknown):CityReplayDescriptor|null{
 if(!object(value)||!exact(value,['key','ready','frames','durationMs','recordedMs','truncated'])||typeof value.key!=='string'||!/^[a-f0-9]{24}$/.test(value.key)||typeof value.ready!=='boolean'||!integer(value.frames,0,CITY_REPLAY_MAX_FRAMES)||!number(value.durationMs,0,86_400_000)||!number(value.recordedMs,0,CITY_REPLAY_MAX_MS)||value.recordedMs>value.durationMs||typeof value.truncated!=='boolean'||value.ready&&value.frames<1)return null;
 return{key:value.key,ready:value.ready,frames:value.frames,durationMs:value.durationMs,recordedMs:value.recordedMs,truncated:value.truncated};
}
function point(v:unknown):boolean{return object(v)&&exact(v,['x','y','z','h'])&&number(v.x,-15000,15000)&&number(v.z,-15000,15000)&&number(v.y,-150,800)&&number(v.h,-Math.PI,Math.PI);}
export function validCityReplayDuty(v:unknown):v is CityReplayDuty{
 if(!object(v)||!exact(v,['stage','integrity','operation','dwell','next','winch','loaded','incident'])||!includes(['approach','warning','positioning','winch','securing','returning','unloading','complete'],v.stage)||!number(v.integrity,0,100)||!number(v.operation,0,1000)||!number(v.dwell,0,10)||!integer(v.next,0,1000)||typeof v.loaded!=='boolean'||v.incident!==null&&!point(v.incident)||!object(v.winch))return false;
 return exact(v.winch,['along','lateral','blocked'])&&number(v.winch.along,0,4.2)&&number(v.winch.lateral,-1.4,1.4)&&typeof v.winch.blocked==='boolean';
}
export function parseCityReplay(value:unknown):CityReplayArchive|null{
 if(!object(value)||!exact(value,['schema','version','cityStamp','source','mode','weather','durationMs','recordedMs','truncated','reason','actors','frames','events'])||value.schema!==1||value.version!==CITY_REPLAY_VERSION||value.cityStamp!==COOP_CITY_STAMP||!includes(['social','duty'],value.source)||!includes(CITY_REPLAY_MODES,value.mode)||!includes(['dry','rain','night'],value.weather)||value.source==='social'&&includes(['rescue','rally'],value.mode)||value.source==='duty'&&!includes(['rescue','rally'],value.mode)||!number(value.durationMs,0,86_400_000)||!number(value.recordedMs,0,CITY_REPLAY_MAX_MS)||value.recordedMs>value.durationMs||typeof value.truncated!=='boolean'||!value.truncated&&Math.abs(value.recordedMs-value.durationMs)>.01||!includes(CITY_REPLAY_REASONS,value.reason)||!Array.isArray(value.actors)||value.actors.length<1||value.actors.length>CITY_REPLAY_MAX_ACTORS||!Array.isArray(value.frames)||value.frames.length<1||value.frames.length>CITY_REPLAY_MAX_FRAMES||!Array.isArray(value.events)||value.events.length>CITY_REPLAY_MAX_EVENTS)return null;
 for(const actor of value.actors)if(!object(actor)||!exact(actor,['slot'])||!integer(actor.slot,0,3))return null;
 const count=value.actors.length,seenActors=new Set<number>();let prior=-1;
 for(const frame of value.frames){
  if(!object(frame)||!exact(frame,['at','weather','cars','duty'])||!number(frame.at,0,value.recordedMs)||frame.at<=prior||!includes(['dry','rain','night'],frame.weather)||!Array.isArray(frame.cars)||frame.cars.length<1||frame.cars.length>(value.source==='duty'?1:4)||frame.duty!==null&&(value.source!=='duty'||!validCityReplayDuty(frame.duty))||value.source==='duty'&&value.mode==='rescue'&&frame.duty===null)return null;
  prior=frame.at;const frameActors=new Set<number>(),frameSlots=new Set<number>();
  for(const p of frame.cars){
   if(!object(p)||!exact(p,['actor','vehicle','x','y','z','h','vx','vz','steer','pitch','roll','epoch','visible','role','outcome'])||!integer(p.actor,0,count-1)||frameActors.has(p.actor)||frameSlots.has(value.actors[p.actor].slot)||!includes(CITY_REPLAY_VEHICLES,p.vehicle)||!number(p.x,-15000,15000)||!number(p.z,-15000,15000)||!number(p.y,-150,800)||!number(p.h,-Math.PI,Math.PI)||!number(p.vx,-200,200)||!number(p.vz,-200,200)||!number(p.steer,-2,2)||!number(p.pitch,-200,200)||!number(p.roll,-200,200)||!integer(p.epoch,0,1e9)||typeof p.visible!=='boolean'||!includes(CITY_REPLAY_ROLES,p.role)||!includes(['','captured','escaped','left'],p.outcome)||value.source==='social'&&(p.vehicle==='rescue'||p.role==='truck')||value.source==='duty'&&value.mode==='rescue'&&(p.vehicle!=='rescue'||p.role!=='truck'))return null;
   frameActors.add(p.actor);frameSlots.add(value.actors[p.actor].slot);seenActors.add(p.actor);
  }
 }
 if(value.frames[0].at!==0||value.frames[0].weather!==value.weather||Math.abs(prior-value.recordedMs)>.01||seenActors.size!==count)return null;
 prior=-1;
 for(const e of value.events){if(!object(e)||!exact(e,['at','type','actors','detail'])||!number(e.at,0,value.recordedMs)||e.at<prior||!includes(CITY_REPLAY_EVENTS,e.type)||!includes(CITY_REPLAY_DETAILS,e.detail)||!Array.isArray(e.actors)||e.actors.length>4||new Set(e.actors).size!==e.actors.length||e.actors.some(a=>!integer(a,0,count-1)))return null;if(e.type==='crown'&&(value.source!=='social'||value.mode!=='crown'||!includes(['crown-start','crown-transfer','crown-return'],e.detail)||e.actors.length!==(e.detail==='crown-transfer'?2:1))||String(e.detail).startsWith('crown-')&&e.type!=='crown')return null;prior=e.at;}
 return structuredClone(value) as unknown as CityReplayArchive;
}
export function decodeCityReplay(text:string):CityReplayArchive{
 if(typeof text!=='string'||text.length>CITY_REPLAY_MAX_CHARS)throw Error('城市回放檔太大，上限為8 MB文字。');
 let value:unknown;try{value=JSON.parse(text);}catch{throw Error('城市回放檔不是有效JSON。');}
 const archive=parseCityReplay(value);if(!archive)throw Error('城市回放內容、地圖或版本不相容。');return archive;
}
const mix=(a:number,b:number,f:number)=>a+(b-a)*f;
/** Anonymous owner presentation follows recorded authority events, never visual proximity. */
export function cityReplayCrownAt(replay:CityReplayArchive,at:number):number|null{if(replay.mode!=='crown'||!Number.isFinite(at))return null;const event=[...replay.events].reverse().find(e=>e.type==='crown'&&e.at<=Math.max(0,Math.min(replay.recordedMs,at)));return event?.actors.at(-1)??null;}
/** Presentation only: never invokes FreeCar, scores a contact, or interpolates an authoritative relocation. */
export function cityReplayFrameAt(replay:CityReplayArchive,at:number):CityReplayFrame{
 const t=Math.max(0,Math.min(replay.recordedMs,Number.isFinite(at)?at:0));let lo=0,hi=replay.frames.length-1;
 while(lo<hi){const mid=(lo+hi+1)>>1;if(replay.frames[mid].at<=t)lo=mid;else hi=mid-1;}
 const a=replay.frames[lo],b=replay.frames[Math.min(lo+1,replay.frames.length-1)],f=(t-a.at)/(b.at-a.at||1);
 if(t===b.at)return structuredClone(b);
 return{at:t,weather:a.weather,duty:structuredClone(a.duty),cars:a.cars.map(p=>{const next=b.cars.find(c=>c.actor===p.actor),out={...p};if(!next||!p.visible||!next.visible||p.epoch!==next.epoch||p.vehicle!==next.vehicle||Math.hypot(next.x-p.x,next.z-p.z)>50||Math.abs(next.y-p.y)>4)return out;for(const key of['x','y','z','vx','vz','steer','pitch','roll'] as const)out[key]=mix(p[key],next[key],f);out.h=p.h+Math.atan2(Math.sin(next.h-p.h),Math.cos(next.h-p.h))*f;return out;})};
}
