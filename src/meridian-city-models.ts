/** Rex <game88521@gmail.com>. Mission rules consume real car poses; never move a car or trust a client result. */
import {buildStoryPlan,encodeStory,type StoryDefinition,type StoryPlan} from './aurora-story';
import {encodeWorkshop,WORKSHOP_VERSION,type WorkshopRoads} from './nexus-workshop';
import {ROAD_Y} from './surface';
import type {CityMissionMode,CityMissionActor,CityMissionState,CityMissionTask} from '../shared/meridian-city';
const wrap=(h:number)=>Math.atan2(Math.sin(h),Math.cos(h));
export function buildPhotoHunt(book:WorkshopRoads):{story:StoryDefinition;plan:StoryPlan;code:string}{
 const start=book.nearest(467.12,515.8,'ground',250)??[...book.nodes].filter(([,p])=>!p.elevated).map(([id,point])=>({id,point}))[0];if(!start)throw Error('城市沒有可用尋寶道路');
 const nodes=[start.id],names:string[]=[],used=new Set<string>();let origin=start.point;
 for(let stage=0;stage<3;stage++){
  const candidates=[...book.nodes].filter(([id,p])=>!p.elevated&&!nodes.includes(id)&&p.name!=='道路節點'&&!used.has(p.name)&&Math.hypot(p.x-origin.x,p.z-origin.z)>140&&Math.hypot(p.x-origin.x,p.z-origin.z)<1000).sort((a,b)=>Math.hypot(a[1].x-origin.x,a[1].z-origin.z)-Math.hypot(b[1].x-origin.x,b[1].z-origin.z)||a[0]-b[0]);
  let found=false;for(const [id,p]of candidates.slice(0,120)){try{const route=book.route([...nodes,id]);if(route.length>6000)continue;nodes.push(id);used.add(p.name);names.push(p.name);origin=p;found=true;break;}catch{/* select only reachable, level-correct city roads */}}
  if(!found)throw Error('目前城市無法組成三站可識別路牌尋寶');
 }
 const route={v:1 as const,physics:WORKSHOP_VERSION as typeof WORKSHOP_VERSION,map:book.stamp,name:'城市路牌照片尋寶',nodes,car:'sedan' as const,weather:'day' as const,seconds:1800,hits:20},story:StoryDefinition={v:1,physics:'city-story-v1',route:encodeWorkshop(route),stages:names.map(name=>({label:`尋找「${name}」路牌附近`.slice(0,40),action:'arrival',dwell:0,optional:false}))},plan=buildStoryPlan(book,story,true);return{story,plan,code:encodeStory(story)};
}
export class CityMissionRun {
 index=0;gate=0;elapsed=0;dwell=0;hits=0;done=false;success=false;reason='';tasks:CityMissionTask[]=[];photos:CityMissionState['photos']=[];private lastHit=-100;private current='';
 constructor(readonly mode:CityMissionMode,readonly story:StoryDefinition,readonly plan:StoryPlan){}
 get target(){return this.plan.targets[this.index];}
 fail(reason:string){if(!this.done){this.done=true;this.success=false;this.reason=reason;}}
 private role(slot:number){return['司機：對準停穩','裝卸員：長按作業','領航員：實地核對路牌','警戒員：確認周邊淨空'][slot]??'隊員';}
 private setup(actors:CityMissionActor[]){const key=this.index+':'+actors.map(a=>a.id).join(',');if(key===this.current)return;this.current=key;const target=this.target;this.tasks=actors.map((p,i)=>({id:p.id,role:this.mode==='hunt'?'攝影隊員':this.role(i),seconds:0,required:this.mode==='hunt'?0:i===0?Math.max(.5,target.action==='arrival'?.5:target.dwell):target.action==='cargo'&&i===1?Math.max(2,target.dwell):i===2?1.5:2,done:this.mode==='hunt'}));}
 capture(actors:CityMissionActor[],by:string){if(this.done||this.mode!=='hunt')return false;const p=actors.find(p=>p.id===by),t=this.target;if(!p?.connected||Math.hypot(p.pose.x-t.x,p.pose.z-t.z)>=12||Math.abs(p.pose.y-ROAD_Y-t.y)>=1.2||Math.hypot(p.pose.vx,p.pose.vz)>=.5||![p.pose.x,p.pose.y,p.pose.z,p.pose.vx,p.pose.vz].every(Number.isFinite))return false;this.photos.push({stage:this.index,by,seconds:this.elapsed});this.advance();return true;}
 step(dt:number,actors:CityMissionActor[],captureBy?:string,impacts=0){
  if(this.done)return;if(!Number.isFinite(dt)||dt<=0||dt>.1||!actors.length||actors.length>4)return this.fail('任務模擬或隊伍無效');
  this.elapsed+=dt;if(this.elapsed>this.plan.definition.seconds){this.fail('任務時間已到');return;}if(impacts>6&&this.elapsed-this.lastHit>.75){this.hits++;this.lastHit=this.elapsed;}if(this.hits>this.plan.definition.hits){this.fail('碰撞超過劇本上限');return;}
  this.setup(actors);const t=this.target,leader=actors[0],c=leader.pose,gate=this.plan.route.gates[this.gate];
  if(this.mode==='story'&&this.gate<t.gateEnd&&gate&&Math.hypot(c.x-gate.x,c.z-gate.z)<12&&Math.abs(c.y-ROAD_Y-gate.y)<2.2)this.gate++;
  const near=(p:CityMissionActor,radius:number)=>p.connected&&Math.hypot(p.pose.x-t.x,p.pose.z-t.z)<radius&&Math.abs(p.pose.y-ROAD_Y-t.y)<1.2&&Math.hypot(p.pose.vx,p.pose.vz)<.5;
  if(this.mode==='hunt'){
   if(captureBy)this.capture(actors,captureBy);return;
  }
  const aligned=this.gate>=t.gateEnd&&near(leader,t.action==='arrival'?9:3)&&(t.action==='arrival'||Math.abs(wrap(c.h-t.h))<.3);this.dwell=aligned?Math.min(t.dwell||.5,this.dwell+dt):0;
  for(const [i,task]of this.tasks.entries()){
   const actor=actors[i],allowed=aligned&&near(actor,i===0?9:18)&&(i===0?(t.action!=='cargo'||actor.held):actor.held);
   task.seconds=allowed?Math.min(task.required,task.seconds+dt):0;task.done=task.seconds>=task.required;
  }
  if(this.tasks.every(task=>task.done))this.advance();
 }
 private advance(){this.index++;this.dwell=0;this.current='';this.tasks=[];if(this.index===this.plan.targets.length){this.done=this.success=true;this.reason=this.mode==='hunt'?'全隊已依序找到並拍攝所有線索。':'全隊已完成所有分工階段。';}}
 snapshot():CityMissionState {return{mode:this.mode,index:this.index,total:this.plan.targets.length,elapsed:this.elapsed,dwell:this.dwell,hits:this.hits,gate:this.gate,done:this.done,success:this.success,reason:this.reason,clue:this.target?.label??this.reason,tasks:structuredClone(this.tasks),photos:structuredClone(this.photos)};}
}
