import {VOYAGER_RACING_VERSION,voyagerSettings,voyagerVscValid,voyagerWet,type VoyagerSettings,type VoyagerVsc} from './voyager-racing.ts';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP, type RoomSnapshot, type CarState } from './multiplayer-protocol.ts';
import { getMultiplayerTrack } from './multiplayer-tracks.ts';
import {ATLAS_RACING_VERSION,ATLAS_PIT_SERVICES,atlasSettings,type AtlasState,type AtlasPitService} from './atlas-racing.ts';
import {summitSettings,SUMMIT_TYRES,type SummitSettings,type SummitTyre,type SummitState} from './summit-racing.ts';
import {parseOdysseyState,odysseyStopWindow,type OdysseyState} from './odyssey-racing.ts';

export const REPLAY_SCHEMA = 1;
export const REPLAY_STEP_MS = 200;
export const REPLAY_MAX_MS = 12 * 60_000;
export const REPLAY_MAX_FRAMES = REPLAY_MAX_MS / REPLAY_STEP_MS + 2;
export const REPLAY_MAX_CHARS = 8 * 1024 * 1024;
export const REPLAY_CHUNK_CHARS = 24 * 1024;
export interface ReplayDescriptor { id: string; ready: boolean; frames: number; durationMs: number; recordedMs: number; truncated: boolean }
export interface ReplayDriver { id: string; name: string; color: string;ai?:boolean }
/** x,z,heading,speed,steer,trackIndex,latitude,trackS,progress,laps,rank,finishMs,dnf,active. */
export type ReplayPose = [number, number, number, number, number, number, number, number, number, number, number, number | null, boolean, boolean];
export type ReplayStrategy=[SummitTyre,number,number,number,boolean,SummitTyre,boolean];
export type ReplayAtlas=[number,AtlasPitService,number,boolean,boolean,boolean,number];
export type ReplayEventType='damage'|'flag'|'boundary'|'collision'|'wall'|'overtake'|'handoff'|'item'|'pit'|'weather'|'lap'|'finish'|'session';
export interface ReplayEvent {at:number;type:ReplayEventType;actors:string[];detail:string}
export interface ReplayFrame { at: number; cars: ReplayPose[];wet?:number;strategy?:ReplayStrategy[];atlas?:ReplayAtlas[];vsc?:VoyagerVsc;odyssey?:[number|null,number|null,boolean][] }
export interface MultiplayerReplay {
  schema: 1|2|3|4|5; version: number; physics: string; catalogStamp: string;
  id: string; createdAt: number; trackId: string; trackStamp: string;
  trackLength: number; laps: 1 | 3 | 5; mode: string;
  durationMs: number; recordedMs: number; truncated: boolean;
  drivers: ReplayDriver[]; frames: ReplayFrame[];
  voyager?:{settings:VoyagerSettings};atlas?:AtlasState;events?:ReplayEvent[];summit?:{settings:SummitSettings;stage:SummitState['stage']}|null;
  odyssey?:OdysseyState;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const int = (v: unknown, min: number, max: number): v is number => finite(v, min, max) && Number.isInteger(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const ident = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export function validReplayDescriptor(v: unknown): v is ReplayDescriptor {
  return object(v) && exact(v,['id','ready','frames','durationMs','recordedMs','truncated']) && ident(v.id)
    && typeof v.ready === 'boolean' && int(v.frames,0,REPLAY_MAX_FRAMES) && finite(v.durationMs,0,86_400_000)
    && finite(v.recordedMs,0,REPLAY_MAX_MS) && v.recordedMs <= v.durationMs && typeof v.truncated === 'boolean';
}
export function parseMultiplayerReplay(value: unknown): MultiplayerReplay | null {
  if (!object(value) || ![1,2,3,4,5].includes(Number(value.schema))||!exact(value,['schema','version','physics','catalogStamp','id','createdAt','trackId','trackStamp','trackLength','laps','mode','durationMs','recordedMs','truncated','drivers','frames',...(Number(value.schema)>=2?['events','summit']:[]),...(Number(value.schema)>=3?['atlas']:[]),...(Number(value.schema)>=4?['voyager']:[]),...(value.schema===5?['odyssey']:[])])
    || typeof value.schema!=='number' || value.version!==PROTOCOL_VERSION || value.physics!==PHYSICS_VERSION || value.catalogStamp!==CATALOG_STAMP || !ident(value.id)
    || !finite(value.createdAt,0,8.64e15) || typeof value.trackId!=='string' || typeof value.trackStamp!=='string'
    || getMultiplayerTrack(value.trackId)?.trackStamp!==value.trackStamp || !finite(value.trackLength,100,1e6)
    || ![1,3,5].includes(Number(value.laps)) || typeof value.laps!=='number' || typeof value.mode!=='string' || !/^[a-z-]{1,32}$/.test(value.mode)
    || !finite(value.durationMs,0,86_400_000) || !finite(value.recordedMs,0,REPLAY_MAX_MS) || value.recordedMs>value.durationMs
    || typeof value.truncated!=='boolean' || (!value.truncated && Math.abs(value.durationMs-value.recordedMs)>.01)
    || !Array.isArray(value.drivers) || value.drivers.length<1 || value.drivers.length>4 || !Array.isArray(value.frames) || value.frames.length<1 || value.frames.length>REPLAY_MAX_FRAMES) return null;
  const ids = new Set();
  for(const d of value.drivers) {
    if(!object(d)||!exact(d,['id','name','color',...(Number(value.schema)>=2?['ai']:[])])||Number(value.schema)>=2&&typeof d.ai!=='boolean'||!ident(d.id)||ids.has(d.id)||typeof d.name!=='string'||!d.name.trim()||d.name.length>32||/[\u0000-\u001f\u007f<>]/.test(d.name)||typeof d.color!=='string'||!/^#[0-9a-f]{6}$/i.test(d.color))return null;
    ids.add(d.id);
  }
  if(Number(value.schema)>=2){
    const s=value.summit;if(s!==null&&(!object(s)||!exact(s,['settings','stage'])||!summitSettings(s.settings)||!['single','qualifying','race',...(value.schema===5?['sprint']:[])].includes(String(s.stage))||(summitSettings(s.settings)!.weekend?s.stage==='single':s.stage!=='single')))return null;
    if(!Array.isArray(value.events)||value.events.length>512)return null;let last=-1;
    for(const e of value.events){if(!object(e)||!exact(e,['at','type','actors','detail'])||!finite(e.at,0,value.recordedMs)||e.at<last||!['collision','wall','overtake','handoff','item','pit','weather','lap','finish','session',...(Number(value.schema)>=3?['damage','flag','boundary']:[])].includes(String(e.type))||!Array.isArray(e.actors)||e.actors.length>2||new Set(e.actors).size!==e.actors.length||e.actors.some(id=>!ids.has(id))||typeof e.detail!=='string'||e.detail.length>80||/[\u0000-\u001f\u007f<>]/.test(e.detail))return null;last=e.at;}
  }
  if(Number(value.schema)>=3){const a=value.atlas;if(!object(a)||!exact(a,['version','settings'])||a.version!==ATLAS_RACING_VERSION||!atlasSettings(a.settings))return null;}
  if(Number(value.schema)>=4){const v=value.voyager;if(!object(v)||!exact(v,['settings'])||!voyagerSettings(v.settings)||voyagerSettings(v.settings)!.practiceSeconds)return null;}
  if(value.schema===5){
    const o=parseOdysseyState(value.odyssey),s=value.summit as MultiplayerReplay['summit'],v=(value.voyager as {settings:VoyagerSettings}).settings;
    if(!o||!s||s.settings.ai||value.drivers.length<2||(value.drivers as ReplayDriver[]).some(d=>d.ai)||v.practiceSeconds||v.weather!=='legacy'||v.vsc)return null;
    if(o.settings.sprintWeekend){const w=o.weekend;if(!w||!w.locked||!getMultiplayerTrack(value.trackId)?.circuit||!s.settings.weekend||s.settings.endurance||w.trackId!==value.trackId||JSON.stringify(w.entrants.map(e=>e.id).sort())!==JSON.stringify([...ids].sort())||value.laps!==(s.stage==='sprint'?1:w.raceLaps)||value.mode!==(s.stage==='qualifying'?'qualifying':'race')||s.stage==='qualifying'&&(w.sprint.length||w.race.length)||s.stage==='sprint'&&w.race.length||s.stage==='race'&&!w.sprint.length)return null;}
    else if(s.settings.weekend||![480,600].includes(s.settings.endurance)||s.stage!=='single'||value.mode!=='endurance')return null;
  }
  let prior=-1;
  for(const frame of value.frames) {
    if(!object(frame)||!exact(frame,['at','cars',...(Number(value.schema)>=2?['wet','strategy']:[]),...(Number(value.schema)>=3?['atlas']:[]),...(Number(value.schema)>=4?['vsc']:[]),...(value.schema===5?['odyssey']:[])])||!finite(frame.at,0,value.recordedMs)||frame.at<=prior||!Array.isArray(frame.cars)||frame.cars.length!==value.drivers.length)return null;
    if(Number(value.schema)>=2&&(!finite(frame.wet,0,1)||!Array.isArray(frame.strategy)||frame.strategy.length!==value.drivers.length||frame.strategy.some(s=>!Array.isArray(s)||s.length!==7||!SUMMIT_TYRES.includes(s[0])||!finite(s[1],0,1)||!finite(s[2],0,REPLAY_MAX_MS+(Number(value.schema)>=3?16000:6000))||!int(s[3],0,100)||typeof s[4]!=='boolean'||!SUMMIT_TYRES.includes(s[5])||typeof s[6]!=='boolean')))return null;
    if(Number(value.schema)>=3&&(!Array.isArray(frame.atlas)||frame.atlas.length!==value.drivers.length||frame.atlas.some(a=>!Array.isArray(a)||a.length!==7||!finite(a[0],0,1)||!ATLAS_PIT_SERVICES.includes(a[1])||!int(a[2],0,16000)||typeof a[3]!=='boolean'||typeof a[4]!=='boolean'||typeof a[5]!=='boolean'||!int(a[6],0,999))))return null;
    if(Number(value.schema)>=4&&(!voyagerVscValid(frame.vsc,frame.at)||!(value.voyager as {settings:VoyagerSettings}).settings.vsc&&(frame.vsc as VoyagerVsc).phase!=='off'||(value.voyager as {settings:VoyagerSettings}).settings.weather!=='legacy'&&Math.abs(Number(frame.wet)-voyagerWet((value.voyager as {settings:VoyagerSettings}).settings.weather,frame.at))>.02))return null;
    if(value.schema===5){const o=value.odyssey as unknown as OdysseyState,w=odysseyStopWindow((value.summit as MultiplayerReplay['summit'])!.settings.endurance),frameAt=Number(frame.at);if(!Array.isArray(frame.odyssey)||frame.odyssey.length!==value.drivers.length||frame.odyssey.some(p=>!Array.isArray(p)||p.length!==3||typeof p[2]!=='boolean'||p[0]!==null&&!finite(p[0],0,frameAt)||p[1]!==null&&(!finite(p[1],w.openMs,Math.min(w.closeMs,frameAt))||p[0]===null||p[0]<w.openMs||p[0]>p[1]||p[2])||!o.settings.mandatoryStop&&(p[0]!==null||p[1]!==null||p[2])))return null;}
    prior=frame.at;
    for(const c of frame.cars)if(!Array.isArray(c)||c.length!==14||!finite(c[0],-1e6,1e6)||!finite(c[1],-1e6,1e6)||!finite(c[2],-1e5,1e5)
      ||!finite(c[3],-200,500)||!finite(c[4],-2,2)||!int(c[5],0,100000)||!finite(c[6],-1000,1000)||!finite(c[7],0,value.trackLength+10)
      ||!finite(c[8],0,1e9)||!int(c[9],0,128)||!int(c[10],1,value.drivers.length)||(c[11]!==null&&!finite(c[11],0,value.durationMs+1))||typeof c[12]!=='boolean'||typeof c[13]!=='boolean')return null;
  }
  if(value.frames[0].at!==0 || Math.abs(prior-value.recordedMs)>.01)return null;
  return structuredClone(value) as unknown as MultiplayerReplay;
}
export function decodeMultiplayerReplay(text: string): MultiplayerReplay {
  if(typeof text!=='string'||text.length>REPLAY_MAX_CHARS)throw Error('回放檔太大，上限為 8 MB 文字。');
  let value: unknown;try{value=JSON.parse(text);}catch{throw Error('回放檔不是有效的 JSON。');}
  const replay=parseMultiplayerReplay(value);if(!replay)throw Error('回放內容、地圖或遊戲版本不相容，無法播放。');return replay;
}
const lerp=(a:number,b:number,f:number)=>a+(b-a)*f;
export function replayFrameAt(replay: MultiplayerReplay, at: number): ReplayFrame {
  const t=Math.max(0,Math.min(replay.recordedMs,Number.isFinite(at)?at:0));
  let lo=0,hi=replay.frames.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(replay.frames[mid].at<=t)lo=mid;else hi=mid-1;}
  const a=replay.frames[lo],b=replay.frames[Math.min(lo+1,replay.frames.length-1)],f=(t-a.at)/(b.at-a.at||1);
  return{at:t,...(replay.schema>=2?{wet:lerp(a.wet??0,b.wet??0,f),strategy:structuredClone(a.strategy)}:{}),...(replay.schema>=3?{atlas:structuredClone(a.atlas)}:{}),...(replay.schema>=4?{vsc:structuredClone(a.vsc)}:{}),...(replay.schema===5?{odyssey:structuredClone(a.odyssey)}:{}),cars:a.cars.map((car,i)=>{const next=b.cars[i],out=[...car] as ReplayPose;for(const key of[0,1,3,4,8])out[key]=lerp(car[key] as number,next[key] as number,f) as never;
    out[2]=car[2]+Math.atan2(Math.sin(next[2]-car[2]),Math.cos(next[2]-car[2]))*f;
    // Track index/height belongs to a real sample; never interpolate over a track seam.
    if(f>=.5){out[5]=next[5];out[6]=next[6];out[7]=next[7];}return out;})};
}
export function replayRoomAt(replay: MultiplayerReplay, at: number): RoomSnapshot {
  const frame=replayFrameAt(replay,at);
  return{version:replay.version,physics:replay.physics,catalogStamp:replay.catalogStamp,trackId:replay.trackId,trackStamp:replay.trackStamp,trackRevision:0,
    code:'REPLAY',hostId:'replay-viewer',phase:'results',matchId:replay.id,startAt:0,laps:replay.laps,serverTime:frame.at,trackLength:replay.trackLength,
    ...(replay.schema>=2&&replay.summit?{summit:{...replay.summit,weather:frame.wet??0,durationSeconds:replay.summit.stage==='qualifying'?180:replay.summit.settings.endurance||null,qualifying:[],mixed:replay.drivers.some(d=>d.ai),revision:1}}:{}),...(replay.schema>=3?{atlas:structuredClone(replay.atlas)}:{}),...(replay.schema>=4?{voyager:{version:VOYAGER_RACING_VERSION,settings:structuredClone(replay.voyager!.settings),wet:frame.wet??0,vsc:structuredClone(frame.vsc!),events:[]}}:{}),...(replay.schema===5?{odyssey:structuredClone(replay.odyssey)}:{}),roomRules:{collisions:false,finishGraceSeconds:60},spectators:[{id:'replay-viewer',name:'回放',loaded:true}],
    players:replay.drivers.map((d,i)=>{const c=frame.cars[i];const car:CarState={x:c[0],z:c[1],h:c[2],v:c[3],steer:c[4],pos:{i:c[5],lat:c[6],s:c[7]},power:1,boost:0,drs:false,gripMul:1,r26:false,aeroZone:false,ovt:false,energy:1,speedCap:null,touch:false,hitCool:0};
      const a=frame.atlas?.[i],s=frame.strategy?.[i],o=frame.odyssey?.[i];return{id:d.id,name:d.name,color:d.color,ready:false,loaded:true,connected:true,car,ackSeq:0,completedLaps:c[9],progress:c[8],rank:c[10],finishMs:c[11],dnf:c[12],...(o?{odyssey:{pitStartedMs:o[0],qualifiedStopMs:o[1],stopMissed:o[2]}}:{}),...(a?{atlas:{damage:a[0],pitService:a[1],pitDurationMs:a[2],yellow:a[3],blue:a[4],boundary:a[5],warnings:a[6]}}:{}),...(s?{summit:{ai:!!d.ai,compound:s[0],wear:s[1],pitUntil:s[2],pitStops:s[3],pitArmed:s[4],nextCompound:s[5],lapValid:s[6],validLaps:[]}}:{}),block:{ghost:!c[13],reason:null,warningAt:null,recoveryAt:null}};})};
}
