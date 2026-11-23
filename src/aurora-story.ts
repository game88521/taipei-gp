/** Rex <game88521@gmail.com>. Shared stories are data only; the existing FreeCar drives them. */
import { decodeWorkshop, encodeWorkshop, workshopHash, WorkshopRoads, type WorkshopDefinition, type WorkshopPoint, type WorkshopRoute } from './nexus-workshop';
import { ROAD_Y } from './surface';
export const AURORA_STORY_STORAGE='taipei-gp-aurora-story-v1';
export type StoryAction='arrival'|'parking'|'cargo';
export interface StoryStage { label:string; action:StoryAction; dwell:number; optional:boolean }
export interface StoryDefinition { v:1; physics:'city-story-v1'; route:string; stages:StoryStage[] }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseStory(raw:unknown):StoryDefinition|null {try{
 if(!object(raw)||Object.keys(raw).sort().join(',')!=='physics,route,stages,v'||raw.v!==1||raw.physics!=='city-story-v1'||typeof raw.route!=='string')return null;
 const def=decodeWorkshop(raw.route);if(def.v!==1||!Array.isArray(raw.stages)||raw.stages.length!==def.nodes.length-1)return null;
 const stages:StoryStage[]=[];for(const s of raw.stages){if(!object(s)||Object.keys(s).sort().join(',')!=='action,dwell,label,optional'||typeof s.label!=='string'||s.label.trim()!==s.label||s.label.length<1||s.label.length>40||/[\x00-\x1f\x7f<>]/.test(s.label)||!['arrival','parking','cargo'].includes(String(s.action))||!Number.isInteger(s.dwell)||Number(s.dwell)<0||Number(s.dwell)>30||s.action==='arrival'&&s.dwell!==0||s.action!=='arrival'&&Number(s.dwell)<2||typeof s.optional!=='boolean')return null;stages.push({label:s.label,action:s.action as StoryAction,dwell:Number(s.dwell),optional:s.optional});}
 if(stages.at(-1)?.optional)return null;return{v:1,physics:'city-story-v1',route:encodeWorkshop(def),stages};
 }catch{return null;}}
export function encodeStory(value:StoryDefinition){const parsed=parseStory(value);if(!parsed)throw Error('劇本條件無效');let binary='';for(const n of new TextEncoder().encode(JSON.stringify(parsed)))binary+=String.fromCharCode(n);const payload=btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');return`NG3.${payload}.${workshopHash(payload)}`;}
export function decodeStory(text:string){if(text.length>12000)throw Error('劇本分享碼過長');const match=/^NG3\.([A-Za-z0-9_-]{10,11000})\.([0-9a-f]{8})$/.exec(text.trim());if(!match||workshopHash(match[1])!==match[2])throw Error('劇本分享碼已損壞');try{const binary=atob(match[1].replaceAll('-','+').replaceAll('_','/')),raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))),parsed=parseStory(raw);if(parsed)return parsed;}catch{/* concise validation */}throw Error('劇本版本或階段不支援');}
export interface StoryTarget extends StoryStage,WorkshopPoint { h:number; gateEnd:number; source:number }
export interface StoryPlan { definition:WorkshopDefinition; route:WorkshopRoute; targets:StoryTarget[]; skipped:number }
export function buildStoryPlan(book:WorkshopRoads,story:StoryDefinition,includeOptional:boolean):StoryPlan {
 const clean=parseStory(story);if(!clean)throw Error('劇本無效');const original=decodeWorkshop(clean.route);book.validate(original);
 if(includeOptional&&clean.stages.some(s=>s.optional))buildStoryPlan(book,clean,false);
 const selected=clean.stages.map((s,i)=>({...s,node:original.nodes[i+1],source:i})).filter(s=>includeOptional||!s.optional),definition={...original,nodes:[original.nodes[0],...selected.map(s=>s.node)]},route=book.validate(definition);
 let cursor=0,distance=0;const targets:StoryTarget[]=[];
 for(let i=0;i<selected.length;i++){const anchor=route.anchors[i+1];let found=-1;for(let j=cursor+1;j<route.path.length;j++)if(Math.hypot(route.path[j][0]-anchor.x,route.path[j][1]-anchor.z)<4&&Math.abs(route.ys[j]-anchor.y)<2){found=j;break;}if(found<0)throw Error('劇本停靠點不在重建道路');for(let j=cursor+1;j<=found;j++)distance+=Math.hypot(route.path[j][0]-route.path[j-1][0],route.path[j][1]-route.path[j-1][1]);cursor=found;const before=route.path[Math.max(0,cursor-1)];targets.push({...selected[i],...anchor,h:Math.atan2(anchor.x-before[0],anchor.z-before[1]),gateEnd:i===selected.length-1?route.gates.length:Math.min(route.gates.length,Math.floor(distance/30))});}
 return{definition,route,targets,skipped:clean.stages.length-selected.length};
}
interface StoryPose extends WorkshopPoint { h:number; vx:number; vz:number }
export interface StoryResult { success:boolean; elapsed:number; hits:number; score:number; stages:number; optional:number; reason:string }
export interface StoryCheckpoint {v:1;phase:'countdown'|'running';countdown:number;elapsed:number;index:number;gate:number;dwell:number;hits:number;lastHit:number}
export function parseStoryCheckpoint(value:unknown):StoryCheckpoint|null {
 if(!object(value)||Object.keys(value).sort().join(',')!=='countdown,dwell,elapsed,gate,hits,index,lastHit,phase,v'||value.v!==1||!['countdown','running'].includes(String(value.phase)))return null;
 const range=(k:string,a:number,b:number,integer=false)=>typeof value[k]==='number'&&Number.isFinite(value[k])&&Number(value[k])>=a&&Number(value[k])<=b&&(!integer||Number.isInteger(value[k]));
 if(!range('countdown',0,3)||!range('elapsed',0,1800)||!range('index',0,10,true)||!range('gate',0,700,true)||!range('dwell',0,30)||!range('hits',0,20,true)||!range('lastHit',-100,1800)||value.phase==='countdown'&&(value.elapsed!==0||value.index!==0||value.gate!==0||value.dwell!==0)||value.phase==='running'&&value.countdown!==0)return null;
 return structuredClone(value) as unknown as StoryCheckpoint;
}
export class StoryRun {
 phase:'countdown'|'running'|'done'='countdown';countdown=3;elapsed=0;index=0;gate=0;dwell=0;hits=0;result:StoryResult|null=null;private last:WorkshopPoint;private lastHit=-100;
 constructor(readonly story:StoryDefinition,readonly plan:StoryPlan,initial:StoryPose,readonly vmax:number){this.last={...initial};}
 checkpoint():StoryCheckpoint|null{return this.phase==='done'?null:{v:1,phase:this.phase,countdown:this.countdown,elapsed:this.elapsed,index:this.index,gate:this.gate,dwell:this.dwell,hits:this.hits,lastHit:this.lastHit};}
 restoreCheckpoint(raw:unknown,car:StoryPose){const s=parseStoryCheckpoint(raw);if(!s||s.index>=this.plan.targets.length||s.gate>this.plan.targets[s.index].gateEnd||s.index>0&&s.gate<this.plan.targets[s.index-1].gateEnd||s.elapsed>this.plan.definition.seconds||s.hits>this.plan.definition.hits||s.dwell>this.plan.targets[s.index].dwell||s.lastHit>s.elapsed)throw Error('續玩階段或路線進度無效，原存檔保留');Object.assign(this,s);this.last={x:car.x,y:car.y,z:car.z};this.result=null;}
 get target(){return this.plan.targets[this.index];}
 get next(){return this.gate<this.target.gateEnd?this.plan.route.gates[this.gate]:this.target;}
 get ready(){return this.phase==='running'&&this.target?.action==='cargo'&&this.dwell>=this.target.dwell;}
 fail(reason:string){if(this.result)return this.result;return this.finish(false,reason);}
 private finish(success:boolean,reason:string){this.phase='done';return this.result={success,elapsed:this.elapsed,hits:this.hits,score:success?Math.max(0,Math.round(100-this.hits*10-Math.max(0,this.elapsed-this.plan.definition.seconds*.8)*.03)):0,stages:this.index,optional:this.plan.targets.filter(t=>t.optional).length,reason};}
 confirm(){if(this.phase!=='running'||!this.ready)return false;this.advance();return true;}
 private advance(){this.index++;this.dwell=0;if(this.index>=this.plan.targets.length)this.finish(true,'所有必做階段已完成；裝卸與支線依選擇結算。');}
 step(dt:number,car:StoryPose,impact=0){
  if(this.phase==='done')return this.result;if(!Number.isFinite(dt)||dt<=0||dt>.1||![car.x,car.y,car.z,car.h,car.vx,car.vz,impact].every(Number.isFinite))return this.fail('模擬時間或車輛資料中斷');
  if(Math.hypot(car.x-this.last.x,car.z-this.last.z)>this.vmax*dt*1.8+2||Math.abs(car.y-this.last.y)>8)return this.fail('使用扶正或位置跳躍，本次不計成績');
  this.last={...car};if(this.phase==='countdown'){this.countdown=Math.max(0,this.countdown-dt);if(this.countdown===0)this.phase='running';return null;}
  this.elapsed+=dt;if(this.elapsed>this.plan.definition.seconds)return this.fail('劇本超過總時限');if(impact>6&&this.elapsed-this.lastHit>.75){this.hits++;this.lastHit=this.elapsed;}if(this.hits>this.plan.definition.hits)return this.fail('碰撞超過劇本上限');
  const stage=this.target,g=this.plan.route.gates[this.gate];if(this.gate<stage.gateEnd&&g&&Math.hypot(car.x-g.x,car.z-g.z)<12&&Math.abs(car.y-ROAD_Y-g.y)<2.2)this.gate++;
  const near=this.gate>=stage.gateEnd&&Math.hypot(car.x-stage.x,car.z-stage.z)<(stage.action==='arrival'?9:3)&&Math.abs(car.y-ROAD_Y-stage.y)<1.2;
  if(stage.action==='arrival'){if(near)this.advance();}else{const angle=Math.abs(Math.atan2(Math.sin(car.h-stage.h),Math.cos(car.h-stage.h))),aligned=near&&angle<.3&&Math.hypot(car.vx,car.vz)<.3;this.dwell=aligned?Math.min(stage.dwell,this.dwell+dt):0;if(stage.action==='parking'&&this.dwell>=stage.dwell)this.advance();}
  return this.result;
 }
}
export interface StorySave {v:1;drafts:string[];records:{code:string;at:number;seconds:number;score:number;optional:boolean}[]}
export function parseStorySave(value:unknown):StorySave|null{try{if(!object(value)||Object.keys(value).sort().join(',')!=='drafts,records,v'||value.v!==1||!Array.isArray(value.drafts)||value.drafts.length>12||!Array.isArray(value.records)||value.records.length>40)return null;const drafts=value.drafts.map(c=>{if(typeof c!=='string')throw Error();return encodeStory(decodeStory(c));}),records=value.records.map(r=>{if(!object(r)||Object.keys(r).sort().join(',')!=='at,code,optional,score,seconds'||typeof r.code!=='string'||![r.at,r.seconds,r.score].every(n=>typeof n==='number'&&Number.isFinite(n))||Number(r.at)<0||Number(r.seconds)<=0||Number(r.seconds)>1800||!Number.isInteger(r.score)||Number(r.score)<0||Number(r.score)>100||typeof r.optional!=='boolean')throw Error();return{code:encodeStory(decodeStory(r.code)),at:Number(r.at),seconds:Number(r.seconds),score:Number(r.score),optional:r.optional};});return{v:1,drafts,records};}catch{return null;}}
