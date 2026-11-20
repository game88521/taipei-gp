import type { FreeCar } from './freecar';
import type { Collider } from './citydata';
import type { CoopInput, CoopPlayer } from '../shared/nexus-coop';
export const COOP_STEP=1/30;
/** Bounded input history; welcome/relocation generations always discard old commands. */
export class AtlasCoopPrediction {
  private pending:{seq:number;input:CoopInput}[]=[];
  private generation='';private snapshotAt=-Infinity;
  constructor(readonly car:FreeCar,private collider:()=>Collider|null){}
  get queued(){return this.pending.length;}
  reset(){this.pending=[];this.generation='';this.snapshotAt=-Infinity;}
  private integrate(input:CoopInput,running:boolean){const active=input.active&&running;
    this.car.drift=active&&input.handbrake&&Math.abs(this.car.v)>8;
    this.car.update(COOP_STEP,active?input.steer:0,active&&input.throttle,active&&input.brake,this.collider());
    if(!active){this.car.vx*=.65;this.car.vz*=.65;this.car.w*=.65;if(Math.hypot(this.car.vx,this.car.vz)<.2)this.car.vx=this.car.vz=this.car.w=0;}
  }
  advance(seq:number,input:CoopInput,running:boolean){if(this.pending.length>=90){this.pending=[];return;}this.pending.push({seq,input:{...input}});this.integrate(input,running);}
  reconcile(player:CoopPlayer,serverTime:number,generation:string,running:boolean){
    const changed=this.generation!==generation;if(!changed&&serverTime<=this.snapshotAt)return false;
    if(changed){this.pending=[];this.generation=generation;}this.snapshotAt=serverTime;
    this.pending=this.pending.filter(p=>p.seq>player.ack);
    const p=player.pose,c=this.car;c.place(p.x,p.z,p.h,p.y);c.y=p.y;Object.assign(c,player.physics);
    for(const queued of this.pending)this.integrate(queued.input,running);
    return true;
  }
}
