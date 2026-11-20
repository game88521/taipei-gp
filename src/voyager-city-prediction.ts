import { FreeCar } from './freecar';
import type { Collider } from './citydata';
import type { CityRaceInput, CityRacePlayer } from '../shared/summit-city-race';
export const CITY_STEP=1/60;
export class VoyagerCityClock {
  private remaining=0;
  reset(){this.remaining=0;}
  advance(dt:number,step:()=>void){if(!Number.isFinite(dt)||dt<0||dt>.1){this.reset();return false;}this.remaining+=dt;let steps=0;while(this.remaining+1e-9>=CITY_STEP&&steps++<6){this.remaining-=CITY_STEP;step();}return true;}
}
const idle=():CityRaceInput=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
/** Physics and the rendered car are separate. Corrections never feed back into simulation. */
export class VoyagerCityPrediction {
  readonly simulated=new FreeCar();private pending:{seq:number;input:CityRaceInput}[]=[];private generation='';private snapshotAt=-Infinity;
  private correction={x:0,y:0,z:0,h:0};private blocked=false;
  constructor(readonly car:FreeCar,private collider:()=>Collider|null){}
  get queued(){return this.pending.length;}
  get latestSnapshot(){return this.snapshotAt;}
  reset(){this.pending=[];this.generation='';this.snapshotAt=-Infinity;this.correction={x:0,y:0,z:0,h:0};this.blocked=false;}
  suspend(){this.pending=[];this.blocked=true;this.simulated.vx=this.simulated.vz=this.simulated.w=0;this.car.vx=this.car.vz=this.car.w=0;this.correction={x:0,y:0,z:0,h:0};}
  private integrate(input:CityRaceInput){const c=this.simulated,active=input.active!==false;c.spec=this.car.spec;c.drift=active&&input.handbrake&&Math.abs(c.v)>8;c.update(CITY_STEP,active?input.steer:0,active&&input.throttle,active&&input.brake,this.collider());if(!active){c.vx*=.8;c.vz*=.8;c.w*=.8;if(Math.hypot(c.vx,c.vz)<.2)c.vx=c.vz=c.w=0;}}
  advance(seq:number,input:CityRaceInput){if(this.blocked||!Number.isSafeInteger(seq)||seq<1||this.pending.length>=120)return false;this.pending.push({seq,input:{...input}});this.integrate(input);return true;}
  reconcile(p:CityRacePlayer,at:number,generation:string,running:boolean){const changed=this.generation!==generation;if(!changed&&at<=this.snapshotAt)return false;
    const before={x:this.car.x,y:this.car.y,z:this.car.z,h:this.car.h};if(changed||!running||this.blocked)this.pending=[];this.generation=generation;this.snapshotAt=at;this.blocked=!running;this.pending=this.pending.filter(q=>q.seq>p.ack);
    const c=this.simulated,s=p.pose;c.spec=this.car.spec;c.place(s.x,s.z,s.h,s.y);c.y=s.y;Object.assign(c,{vx:s.vx,vz:s.vz,w:p.physics.w,vy:p.physics.vy,steer:s.steer,pitch:s.pitch,roll:s.roll});
    if(running)for(const q of this.pending)this.integrate(q.input);
    const distance=Math.hypot(before.x-c.x,before.z-c.z);this.correction=!changed&&running&&distance<12?{x:before.x-c.x,y:before.y-c.y,z:before.z-c.z,h:Math.atan2(Math.sin(before.h-c.h),Math.cos(before.h-c.h))}:{x:0,y:0,z:0,h:0};this.render(0);return true;
  }
  render(dt:number){const c=this.simulated,o=this.correction,k=Math.exp(-Math.max(0,dt)*14);o.x*=k;o.y*=k;o.z*=k;o.h*=k;const t=this.car;t.place(c.x+o.x,c.z+o.z,c.h+o.h,c.y+o.y);t.y=c.y+o.y;Object.assign(t,{vx:c.vx,vz:c.vz,w:c.w,vy:c.vy,steer:c.steer,pitch:c.pitch,roll:c.roll});}
  idle(){this.integrate(idle());}
}
