/** Rex <game88521@gmail.com>. One CAS commit clears a checkpoint and records its unique settlement. */
import {parseBusCheckpoint,parseDutyRecords,type BusCheckpoint,type DutyRecord} from './summit-city-duty';
import {decodeStory,encodeStory,parseStoryCheckpoint,type StoryCheckpoint} from './aurora-story';
import {workshopHash} from './nexus-workshop';
export const MERIDIAN_RESUME_KEY='taipei-gp-meridian-city-resume-v1';
export const MERIDIAN_RESUME_PHYSICS='meridian-city-resume-v1';
export interface ResumePose{x:number;y:number;z:number;h:number}
export interface BusResumeData {kind:'bus';route:string;continuous:boolean;dispatch:'regular'|'short'|'extra';accessible:boolean;road:boolean;planStamp:string;pose:ResumePose;run:BusCheckpoint;boarding:{leg:number;count:number}[]}
export interface StoryResumeData {kind:'story';code:string;include:boolean;planStamp:string;pose:ResumePose;run:StoryCheckpoint}
export type CityResumeData=BusResumeData|StoryResumeData;
export interface CityPending {id:string;at:number;updatedAt:number;physics:typeof MERIDIAN_RESUME_PHYSICS;data:CityResumeData}
export interface StoryReceipt {code:string;at:number;seconds:number;score:number;optional:boolean}
export interface CitySettlement {id:string;at:number;kind:'bus'|'story';result:DutyRecord|StoryReceipt;continuous:boolean;dispatch:'regular'|'short'|'extra';boarding:{leg:number;count:number}[]}
export interface MeridianResumeSave {v:1;bus:CityPending|null;story:CityPending|null;settled:CitySettlement[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,names:string)=>Object.keys(v).sort().join(',')===names;
const n=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
const ident=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const pose=(v:unknown):v is ResumePose=>obj(v)&&keys(v,'h,x,y,z')&&n(v.x,-40000,40000)&&n(v.z,-40000,40000)&&n(v.y,-1000,5000)&&n(v.h,-10000,10000);
function boarding(v:unknown):v is BusResumeData['boarding']{return Array.isArray(v)&&v.length<=10&&v.every((e,i)=>obj(e)&&keys(e,'count,leg')&&e.leg===i&&Number.isInteger(e.count)&&n(e.count,0,32));}
export function resumePlanStamp(plan:unknown){return workshopHash(JSON.stringify(plan));}
export function parseCityPending(raw:unknown):CityPending|null {try{
 if(!obj(raw)||!keys(raw,'at,data,id,physics,updatedAt')||!ident(raw.id)||!n(raw.at,0,8.64e15)||!n(raw.updatedAt,raw.at,8.64e15)||raw.physics!==MERIDIAN_RESUME_PHYSICS||!obj(raw.data))return null;
 const d=raw.data;if(!pose(d.pose)||typeof d.planStamp!=='string'||!/^[0-9a-f]{8}$/.test(d.planStamp))return null;
 if(d.kind==='story'){if(!keys(d,'code,include,kind,planStamp,pose,run')||typeof d.code!=='string'||typeof d.include!=='boolean'||!parseStoryCheckpoint(d.run))return null;encodeStory(decodeStory(d.code));}
 else if(d.kind==='bus'){if(!keys(d,'accessible,boarding,continuous,dispatch,kind,planStamp,pose,road,route,run')||!['practice','south','north','loop'].includes(String(d.route))||typeof d.continuous!=='boolean'||typeof d.accessible!=='boolean'||typeof d.road!=='boolean'||!['regular','short','extra'].includes(String(d.dispatch))||!boarding(d.boarding)||!parseBusCheckpoint(d.run)||d.road&&(d.route!=='south'||d.continuous)||d.accessible&&d.route!=='south')return null;}
 else return null;
 return structuredClone(raw) as unknown as CityPending;
 }catch{return null;}}
function settlement(raw:unknown):CitySettlement|null {try{
 if(!obj(raw)||!keys(raw,'at,boarding,continuous,dispatch,id,kind,result')||!ident(raw.id)||!n(raw.at,0,8.64e15)||!['bus','story'].includes(String(raw.kind))||typeof raw.continuous!=='boolean'||!['regular','short','extra'].includes(String(raw.dispatch))||!boarding(raw.boarding))return null;
 if(raw.kind==='bus'){if(!parseDutyRecords([raw.result])||!obj(raw.result)||raw.result.kind!=='bus')return null;}
 else{const r=raw.result;if(!obj(r)||!keys(r,'at,code,optional,score,seconds')||typeof r.code!=='string'||!n(r.at,0,8.64e15)||!n(r.seconds,.000001,1800)||!Number.isInteger(r.score)||!n(r.score,0,100)||typeof r.optional!=='boolean')return null;decodeStory(r.code);}
 return structuredClone(raw) as unknown as CitySettlement;
 }catch{return null;}}
export function parseMeridianResumeSave(raw:unknown):MeridianResumeSave|null {
 if(!obj(raw)||!keys(raw,'bus,settled,story,v')||raw.v!==1||!Array.isArray(raw.settled)||raw.settled.length>60)return null;
 const bus=raw.bus===null?null:parseCityPending(raw.bus),story=raw.story===null?null:parseCityPending(raw.story);if(raw.bus!==null&&(!bus||bus.data.kind!=='bus')||raw.story!==null&&(!story||story.data.kind!=='story'))return null;
 const settled=raw.settled.map(settlement);if(settled.some(x=>!x)||new Set(settled.map(x=>x!.id)).size!==settled.length||settled.some(r=>r!.id===bus?.id||r!.id===story?.id))return null;
 return{v:1,bus,story,settled:settled as CitySettlement[]};
}
export class MeridianResumeStore {
 value:MeridianResumeSave={v:1,bus:null,story:null,settled:[]};error='';blocked=false;private raw:string|null=null;
 constructor(private storage:Pick<Storage,'getItem'|'setItem'>|null,private canWrite:()=>boolean=()=>true){try{this.raw=storage?.getItem(MERIDIAN_RESUME_KEY)??null;if(this.raw!==null){if(this.raw.length>1000000)throw Error();const value=parseMeridianResumeSave(JSON.parse(this.raw));if(!value)throw Error();this.value=value;}}catch{this.blocked=true;this.error='續玩資料損壞或無法讀取，保留原文；請先備份。';}}
 private commit(next:MeridianResumeSave){if(this.blocked||!this.storage||!this.canWrite()){this.error='目前沒有存檔寫入權限；續玩資料未覆寫。';return false;}try{if(this.storage.getItem(MERIDIAN_RESUME_KEY)!==this.raw){this.blocked=true;throw Error('另一頁或還原已變更續玩資料，請重載。');}const clean=parseMeridianResumeSave(next);if(!clean)throw Error('續玩狀態無效，原文保留。');const raw=JSON.stringify(clean);if(raw.length>1000000)throw Error('續玩資料超過1MB，原文保留。');this.storage.setItem(MERIDIAN_RESUME_KEY,raw);if(this.storage.getItem(MERIDIAN_RESUME_KEY)!==raw){this.blocked=true;throw Error('續玩資料寫入後已變更。');}this.raw=raw;this.value=clean;this.error='';return true;}catch(e){this.error=e instanceof Error?e.message:'續玩儲存失敗，原文保留。';return false;}}
 checkpoint(value:CityPending){const next=structuredClone(this.value);if(!parseCityPending(value)||next.settled.some(r=>r.id===value.id))return false;next[value.data.kind]=value;return this.commit(next);}
 complete(value:CitySettlement){if(this.value.settled.some(r=>r.id===value.id))return false;const next=structuredClone(this.value);if(next[value.kind]?.id!==value.id)return false;next[value.kind]=null;next.settled=[value,...next.settled].slice(0,60);return this.commit(next);}
 abandon(kind:'bus'|'story',id:string){if(this.value[kind]?.id!==id)return false;const next=structuredClone(this.value);next[kind]=null;return this.commit(next);}
 original(){try{return this.storage?.getItem(MERIDIAN_RESUME_KEY)??this.raw??JSON.stringify(this.value);}catch{return this.raw??JSON.stringify(this.value);}}
}
const pageStores=new WeakMap<object,MeridianResumeStore>();
export function meridianResumeStore(storage:Pick<Storage,'getItem'|'setItem'>|null,canWrite:()=>boolean){if(!storage)return new MeridianResumeStore(null,canWrite);let store=pageStores.get(storage);if(!store){store=new MeridianResumeStore(storage,canWrite);pageStores.set(storage,store);}return store;}
