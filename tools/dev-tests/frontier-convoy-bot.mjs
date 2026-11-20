// Rex <game88521@gmail.com>. Read-only deterministic route controller: returns controls, never writes a car, gate or score.
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x)),angle=x=>Math.atan2(Math.sin(x),Math.cos(x));
export class ConvoyRoadBot{
 constructor({speed=8,delay=0}={}){this.speed=speed;this.delay=delay;this.leg=null;this.progress=0;this.arc=[];}
 reset(leg){this.leg=leg;this.progress=0;this.arc=[0];for(let i=1;i<leg.path.length;i++)this.arc.push(this.arc.at(-1)+Math.hypot(leg.path[i][0]-leg.path[i-1][0],leg.path[i][1]-leg.path[i-1][1]));}
 at(s){const p=this.leg.path,a=this.arc;s=clamp(s,0,a.at(-1));let i=1;while(i<a.length-1&&a[i]<s)i++;const t=(s-a[i-1])/(a[i]-a[i-1]||1);return{x:p[i-1][0]+(p[i][0]-p[i-1][0])*t,z:p[i-1][1]+(p[i][1]-p[i-1][1])*t};}
 input(car,leg,next,elapsed=Infinity){
  if(this.leg!==leg)this.reset(leg);const idle={steer:0,throttle:false,brake:false,handbrake:false,active:false};if(elapsed<this.delay)return idle;
  let best={distance:Infinity,s:this.progress};for(let i=1;i<leg.path.length;i++){if(this.arc[i]<this.progress-12||this.arc[i-1]>this.progress+90)continue;const[a,b]=[leg.path[i-1],leg.path[i]],dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((car.x-a[0])*dx+(car.z-a[1])*dz)/(dx*dx+dz*dz||1),0,1),distance=Math.hypot(a[0]+dx*t-car.x,a[1]+dz*t-car.z);if(distance<best.distance)best={distance,s:this.arc[i-1]+(this.arc[i]-this.arc[i-1])*t};}
  this.progress=Math.max(this.progress,best.s);const remaining=this.arc.at(-1)-this.progress,targetDistance=Math.hypot(car.x-leg.target.x,car.z-leg.target.z),speed=Math.hypot(car.vx,car.vz);
  if(next===leg.gates.length&&targetDistance<=8)return idle;
  const look=clamp(4+speed*.55,4,9),goal=this.at(this.progress+look),heading=Math.atan2(goal.x-car.x,goal.z-car.z),error=angle(heading-car.h-car.w*.12),maxSteer=.62/(1+Math.abs(car.v)/16),steer=clamp(-Math.atan2(2*2.7*Math.sin(error),Math.max(2,Math.hypot(goal.x-car.x,goal.z-car.z)))/maxSteer,-1,1);
  const a=this.at(this.progress+2),b=this.at(this.progress+10),c=this.at(this.progress+20),turn=Math.abs(angle(Math.atan2(c.x-b.x,c.z-b.z)-Math.atan2(b.x-a.x,b.z-a.z))),curveSpeed=turn>.9?3.8:turn>.4?5.2:turn>.18?6.5:this.speed;
  const target=Math.min(this.speed,curveSpeed,remaining<18?Math.sqrt(Math.max(1,(remaining-5)*8)):Infinity);return{steer,throttle:car.v<target-.3,brake:car.v>target+.6,handbrake:false,active:true};
 }
}
