import type { Router } from './router';
import type { FreeCar } from './freecar';
import { buildDutyPlan } from './summit-city-duty';
import type {RallyResult} from './expedition-duty-records';
export {RALLY_KEY,parseRallyRecords,type RallyResult} from './expedition-duty-records';
export interface RallyGate{x:number;z:number;y:number;distance:number;due:number;timed:boolean}
export interface RallyPlan{name:string;path:[number,number][];ys:number[];start:{x:number;z:number;y:number;h:number};gates:RallyGate[];length:number;average:number;limit:number}
export function buildRally(router:Router,average:28|36|42=36):RallyPlan|null{
 const base=buildDutyPlan(router,'rescue','south-assist');if(!base)return null;
 const leg=base.legs[0],gates:RallyGate[]=[];let distance=0,next=20;
 for(let i=1;i<leg.path.length;i++){const a=leg.path[i-1],b=leg.path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.001)continue;
 while(next<=distance+length){const t=(next-distance)/length;gates.push({x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,y:leg.ys[i-1]+(leg.ys[i]-leg.ys[i-1])*t-.25,distance:next,due:next/(average/3.6),timed:false});next+=20;}distance+=length;}
 const target=leg.target;gates.push({x:target.x,z:target.z,y:target.y,distance,due:distance/(average/3.6),timed:true});
 for(const fraction of [.25,.5,.75])gates[Math.min(gates.length-1,Math.floor(gates.length*fraction))].timed=true;
 return{name:'信義—信安定速拉力 '+average+'km/h',path:leg.path,ys:leg.ys,start:base.start,gates,length:distance,average,limit:50};
}
/** Physical movement, same-level sequential gates and passage time; no reward in the original economy. */
export class RegularityRun{
 phase:'countdown'|'running'|'finished'|'failed'='countdown';countdown=3;elapsed=0;next=0;speedPenalty=0;penalty=0;reason='';
 arrivals:RallyResult['arrivals']=[];private previous:{x:number;z:number;y:number};private recorded=false;
 constructor(readonly plan:RallyPlan,readonly car:FreeCar){this.previous={...plan.start};}
 get finished(){return this.phase==='finished'||this.phase==='failed';}
 get target(){return this.plan.gates[this.next]??this.plan.gates.at(-1)!;}
 invalidate(reason='位置重設，本次拉力不計成績。'){this.phase='failed';this.reason=reason;}
 step(dt:number){if(this.finished||!Number.isFinite(dt)||dt<=0||dt>.1)return;
 if(this.phase==='countdown'){this.car.vx=this.car.vz=this.car.w=0;this.countdown=Math.max(0,this.countdown-dt);if(this.countdown<=0)this.phase='running';this.previous={x:this.car.x,z:this.car.z,y:this.car.y};return;}
 const c=this.car,old=this.previous,moved=Math.hypot(c.x-old.x,c.z-old.z);
 if(![c.x,c.z,c.y,c.vx,c.vz].every(Number.isFinite)||moved>100*dt+.35){this.invalidate();return;}
 const previousElapsed=this.elapsed;this.elapsed+=dt;if(this.elapsed>Math.max(600,this.plan.length/2)){this.invalidate('超過拉力時間上限。');return;}
 const kmh=Math.hypot(c.vx,c.vz)*3.6;this.speedPenalty+=Math.max(0,kmh-this.plan.limit)*dt*.2;
 for(let n=0;n<3&&this.next<this.plan.gates.length;n++){const g=this.target,prev=this.next?this.plan.gates[this.next-1]:this.plan.start;
 const nx=g.x-prev.x,nz=g.z-prev.z,len=Math.hypot(nx,nz),a=((old.x-g.x)*nx+(old.z-g.z)*nz)/(len||1),b=((c.x-g.x)*nx+(c.z-g.z)*nz)/(len||1);
 if(!(a<=.001&&b>=0&&b>a+1e-7))break;const t=Math.max(0,Math.min(1,-a/(b-a))),x=old.x+(c.x-old.x)*t,z=old.z+(c.z-old.z)*t,y=old.y+(c.y-old.y)*t;
 if(Math.hypot(x-g.x,z-g.z)>10||Math.abs(y-g.y)>1.5)break;
 if(g.timed){const actual=previousElapsed+dt*t,delta=actual-g.due;this.arrivals.push({gate:this.next,due:g.due,actual,delta});this.penalty+=Math.abs(delta);}this.next++;
 }
 this.previous={x:c.x,z:c.z,y:c.y};if(this.next===this.plan.gates.length){this.phase='finished';c.vx=c.vz=c.w=0;this.reason='完成：早到與晚到同樣計罰，總罰分越低越好。';}
 }
 result(at=Date.now()):RallyResult|null{if(this.phase!=='finished'||this.recorded)return null;this.recorded=true;return{id:'rally-'+at.toString(36),at,route:this.plan.name,seconds:this.elapsed,penalty:this.penalty+this.speedPenalty,speedPenalty:this.speedPenalty,arrivals:structuredClone(this.arrivals)};}
}
