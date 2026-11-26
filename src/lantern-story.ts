/** Rex <game88521@gmail.com>. NG4 is an acyclic data graph, isolated from NG3 and its multiplayer protocol. */
import {decodeWorkshop,encodeWorkshop,workshopHash,type WorkshopDefinition,type WorkshopRoads,type WorkshopRoute} from './nexus-workshop';
import {ROAD_Y} from './surface';
export const LANTERN_STORY_KEY='taipei-gp-lantern-story-v1';
export interface BranchChoice{label:string;next:number|null}
export interface BranchStage{label:string;action:'arrival'|'parking'|'cargo';dwell:number;limit:number;next:number|null;timeout:number|null;choices:BranchChoice[];ending:string}
export interface BranchDefinition{v:1;physics:'city-branch-v1';route:string;stages:BranchStage[]}
export interface BranchPose{x:number;y:number;z:number;h:number;vx:number;vz:number}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,s:string)=>Object.keys(v).sort().join(',')===s;
const n=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
const text=(v:unknown,max=60):v is string=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
export function parseBranch(raw:unknown):BranchDefinition|null{try{
 if(!obj(raw)||!keys(raw,'physics,route,stages,v')||raw.v!==1||raw.physics!=='city-branch-v1'||typeof raw.route!=='string'||!Array.isArray(raw.stages)||raw.stages.length<1||raw.stages.length>11)return null;
 const count=raw.stages.length;const def=decodeWorkshop(raw.route);if(def.v!==1||def.nodes.length!==raw.stages.length+1)return null;const stages:BranchStage[]=[];
 for(const [i,s]of raw.stages.entries()){const edge=(v:unknown)=>v===null||Number.isInteger(v)&&n(v,i+1,count-1);
  if(!obj(s)||!keys(s,'action,choices,dwell,ending,label,limit,next,timeout')||!text(s.label,40)||!text(s.ending)||!['arrival','parking','cargo'].includes(String(s.action))||!Number.isInteger(s.dwell)||!n(s.dwell,0,30)||(s.action==='arrival'?s.dwell!==0:s.dwell<2)||!Number.isInteger(s.limit)||!n(s.limit,10,600)||!edge(s.next)||!edge(s.timeout)||!Array.isArray(s.choices)||![0,2].includes(s.choices.length))return null;
  const choices:BranchChoice[]=[];for(const c of s.choices){if(!obj(c)||!keys(c,'label,next')||!text(c.label,32)||!edge(c.next))return null;choices.push({label:c.label,next:c.next as number|null});}if(choices.length===2&&(choices[0].next===choices[1].next||choices[0].label===choices[1].label))return null;
  stages.push({label:s.label,ending:s.ending,action:s.action as BranchStage['action'],dwell:s.dwell,limit:s.limit,next:s.next as number|null,timeout:s.timeout as number|null,choices});
 }
 return{v:1,physics:'city-branch-v1',route:encodeWorkshop(def),stages};
 }catch{return null;}}
export function encodeBranch(value:BranchDefinition){const clean=parseBranch(value);if(!clean)throw Error('NG4階段無效；分支只能前往後續站點，不可循環');let binary='';for(const b of new TextEncoder().encode(JSON.stringify(clean)))binary+=String.fromCharCode(b);const body=btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');return `NG4.${body}.${workshopHash(body)}`;}
export function decodeBranch(code:string):BranchDefinition{if(typeof code!=='string'||code.length>22000)throw Error('NG4分享碼超過22KB');const m=/^NG4\.([A-Za-z0-9_-]{10,21000})\.([a-f0-9]{8})$/.exec(code.trim());if(!m||workshopHash(m[1])!==m[2])throw Error('NG4分享碼損壞');try{const binary=atob(m[1].replaceAll('-','+').replaceAll('_','/')),v=parseBranch(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))));if(v)return v;}catch{}throw Error('不支援的NG4劇本');}
export interface BranchPlan{definition:WorkshopDefinition;routes:Map<string,WorkshopRoute>;stamp:string}
const routeKey=(from:number,to:number)=>`${from}:${to}`;
export function buildBranchPlan(book:WorkshopRoads,story:BranchDefinition):BranchPlan{
 const clean=parseBranch(story);if(!clean)throw Error('分支圖無效');const base=decodeWorkshop(clean.route),routes=new Map<string,WorkshopRoute>();book.validate(base);
 let totalLength=0,totalPoints=0;const add=(from:number,to:number)=>{const key=routeKey(from,to);if(!routes.has(key)){const r=book.validate({...base,nodes:[base.nodes[from+1],base.nodes[to+1]]});totalLength+=r.length;totalPoints+=r.path.length;if(totalLength>60000||totalPoints>50000)throw Error('分支道路總量超過60公里或50000點，請減少分支');routes.set(key,r);}};add(-1,0);
 for(const [i,s]of clean.stages.entries())for(const next of [s.next,s.timeout,...s.choices.map(c=>c.next)])if(next!==null)add(i,next);
 return{definition:base,routes,stamp:workshopHash(JSON.stringify([...routes]))};
}
export interface BranchCheckpoint{phase:'countdown'|'running'|'choice';countdown:number;index:number;from:number;gate:number;elapsed:number;stageTime:number;dwell:number;hits:number;lastHit:number;path:number[];timedOut:number[]}
export function parseBranchCheckpoint(raw:unknown):BranchCheckpoint|null{
 if(!obj(raw)||!keys(raw,'countdown,dwell,elapsed,from,gate,hits,index,lastHit,path,phase,stageTime,timedOut')||!['countdown','running','choice'].includes(String(raw.phase))||!n(raw.countdown,0,3)||!Number.isInteger(raw.index)||!n(raw.index,0,10)||!Number.isInteger(raw.from)||!n(raw.from,-1,9)||!Number.isInteger(raw.gate)||!n(raw.gate,0,700)||!n(raw.elapsed,0,1800)||!n(raw.stageTime,0,600)||!n(raw.dwell,0,30)||!Number.isInteger(raw.hits)||!n(raw.hits,0,20)||!n(raw.lastHit,-100,1800)||!Array.isArray(raw.path)||raw.path.length>11||!Array.isArray(raw.timedOut)||raw.timedOut.length>11||raw.path.some((x,i,a)=>!Number.isInteger(x)||!n(x,0,10)||i>0&&x<=a[i-1])||raw.timedOut.some((x,i,a)=>!(raw.path as unknown[]).includes(x)||i>0&&x<=a[i-1]))return null;
 return structuredClone(raw)as unknown as BranchCheckpoint;
}
export class BranchRun{
 phase:'countdown'|'running'|'choice'|'done'='countdown';countdown=3;index=0;from=-1;gate=0;elapsed=0;stageTime=0;dwell=0;hits=0;lastHit=-100;path:number[]=[];timedOut:number[]=[];result:{success:boolean;ending:string;seconds:number;score:number;path:number[];timedOut:number[]}|null=null;
 private last:BranchPose;
 constructor(readonly story:BranchDefinition,readonly plan:BranchPlan,car:BranchPose,readonly vmax:number){this.last={...car};}
 get route(){return this.plan.routes.get(routeKey(this.from,this.index))!;}
 get stage(){return this.story.stages[this.index];}
 get target(){const r=this.route,p=r.path.at(-1)!,b=r.path.at(-2)!;return{x:p[0],z:p[1],y:r.ys.at(-1)!,h:Math.atan2(p[0]-b[0],p[1]-b[1])};}
 get next(){return this.route.gates[this.gate]??this.target;}
 get ready(){return this.phase==='running'&&this.stage.action==='cargo'&&this.dwell>=this.stage.dwell;}
 private finish(success:boolean,ending:string){if(this.result)return;this.phase='done';this.result={success,ending,seconds:this.elapsed,score:success?Math.max(0,100-this.hits*10-this.timedOut.length*15):0,path:[...this.path],timedOut:[...this.timedOut]};}
 fail(reason:string){this.finish(false,reason);}
 private advance(next:number|null,success=true){if(!this.path.includes(this.index))this.path.push(this.index);if(next===null){this.finish(success,success?this.stage.ending:'本階段逾時，任務未完成');return;}this.from=this.index;this.index=next;this.gate=this.dwell=this.stageTime=0;this.phase='running';}
 private complete(){if(this.stage.choices.length){this.phase='choice';return;}this.advance(this.stage.next);}
 confirm(){if(!this.ready)return false;this.complete();return true;}
 choose(index:number){if(this.phase!=='choice'||!Number.isInteger(index)||index<0||index>=this.stage.choices.length)return false;this.advance(this.stage.choices[index].next);return true;}
 checkpoint():BranchCheckpoint|null{if(this.phase==='done')return null;return{phase:this.phase,countdown:this.countdown,index:this.index,from:this.from,gate:this.gate,elapsed:this.elapsed,stageTime:this.stageTime,dwell:this.dwell,hits:this.hits,lastHit:this.lastHit,path:[...this.path],timedOut:[...this.timedOut]};}
 restore(raw:unknown,car:BranchPose){const c=parseBranchCheckpoint(raw);if(!c||c.index>=this.story.stages.length||c.from>=c.index||!this.plan.routes.has(routeKey(c.from,c.index))||c.gate>this.plan.routes.get(routeKey(c.from,c.index))!.gates.length||c.hits>this.plan.definition.hits||c.elapsed>this.plan.definition.seconds||c.lastHit>c.elapsed||c.dwell>this.story.stages[c.index].dwell||c.path.length>0&&c.path.at(-1)!>=c.index||c.path.length>0&&c.path[0]!==0||c.from!==(c.path.at(-1)??-1)||c.phase==='choice'&&(!this.story.stages[c.index].choices.length||c.gate!==this.plan.routes.get(routeKey(c.from,c.index))!.gates.length)||c.phase==='countdown'&&(c.index!==0||c.from!==-1||c.elapsed!==0)||c.phase!=='countdown'&&c.countdown!==0)throw Error('NG4續玩階段與劇本不符，原資料保留');
  // Verify each recorded graph edge, including time-limit alternatives; no skipped branch can be injected.
  if(c.stageTime>this.story.stages[c.index].limit||c.phase==='countdown'&&(c.gate!==0||c.dwell!==0||c.stageTime!==0||c.path.length!==0||c.timedOut.length!==0)||c.phase==='choice'&&this.story.stages[c.index].action!=='arrival'&&c.dwell<this.story.stages[c.index].dwell)throw Error('NG4續玩作業進度不符');
  for(let i=0;i<c.path.length;i++){const a=c.path[i];if(a>=this.story.stages.length)throw Error('NG4續玩分支不符');const s=this.story.stages[a],next=c.path[i+1]??c.index,edges=c.timedOut.includes(a)?[s.timeout]:s.choices.length?s.choices.map(x=>x.next):[s.next];if(!edges.includes(next))throw Error('NG4續玩分支不符');}
  Object.assign(this,c);this.last={...car};}
 step(dt:number,car:BranchPose,impact=0){if(this.phase==='done')return;if(!n(dt,.000001,.1)||![car.x,car.y,car.z,car.h,car.vx,car.vz,impact].every(Number.isFinite)){this.fail('模擬資料中斷');return;}if(Math.hypot(car.x-this.last.x,car.z-this.last.z)>this.vmax*dt*1.8+2||Math.abs(car.y-this.last.y)>8){this.fail('扶正或位置跳躍，本次不計成績');return;}this.last={...car};if(this.phase==='countdown'){this.countdown=Math.max(0,this.countdown-dt);if(!this.countdown)this.phase='running';return;}if(this.phase==='choice')return;
  this.elapsed+=dt;if(this.elapsed>this.plan.definition.seconds){this.fail('劇本超過總時限');return;}if(impact>6&&this.elapsed-this.lastHit>.75){this.hits++;this.lastHit=this.elapsed;}if(this.hits>this.plan.definition.hits){this.fail('碰撞超過劇本上限');return;}
  const s=this.stage,g=this.route.gates[this.gate];if(g&&Math.hypot(car.x-g.x,car.z-g.z)<12&&Math.abs(car.y-ROAD_Y-g.y)<1.2)this.gate++;
  const t=this.target,near=this.gate>=this.route.gates.length&&Math.hypot(car.x-t.x,car.z-t.z)<(s.action==='arrival'?9:3)&&Math.abs(car.y-ROAD_Y-t.y)<1.2,aligned=near&&Math.abs(Math.atan2(Math.sin(car.h-t.h),Math.cos(car.h-t.h)))<.3&&Math.hypot(car.vx,car.vz)<.3;
  // The stage deadline governs its on-site operation after reaching the destination. No timeout teleports or replans a moving vehicle.
  if(near||this.stageTime>0)this.stageTime+=dt;if(this.stageTime>=s.limit){this.timedOut.push(this.index);this.advance(s.timeout,false);return;}
  if(!near){this.dwell=0;return;}if(s.action==='arrival'){this.complete();return;}this.dwell=aligned?Math.min(s.dwell,this.dwell+dt):0;if(this.dwell>=s.dwell&&s.action==='parking'){this.complete();return;}if(this.stageTime>=s.limit){this.timedOut.push(this.index);this.advance(s.timeout,false);}
 }
}
