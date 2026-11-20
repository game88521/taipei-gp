// Rex <game88521@gmail.com>. Read-only long-wheelbase road follower. No pose, gate or damage writes.
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x)),angle=x=>Math.atan2(Math.sin(x),Math.cos(x));
export class DutyRoadBot{
 constructor(leg,{speed=9,stopRadius=7}={}){this.leg=leg;this.speed=speed;this.stopRadius=stopRadius;this.progress=0;this.arc=[0];for(let i=1;i<leg.path.length;i++)this.arc.push(this.arc.at(-1)+Math.hypot(leg.path[i][0]-leg.path[i-1][0],leg.path[i][1]-leg.path[i-1][1]));}
 at(s){const p=this.leg.path,a=this.arc;s=clamp(s,0,a.at(-1));let i=1;while(i<a.length-1&&a[i]<s)i++;const t=(s-a[i-1])/(a[i]-a[i-1]||1);return{x:p[i-1][0]+(p[i][0]-p[i-1][0])*t,z:p[i-1][1]+(p[i][1]-p[i-1][1])*t};}
 input(car,next){
  const leg=this.leg,idle={steer:0,throttle:false,brake:false,handbrake:false,active:false};let best={distance:Infinity,s:this.progress};for(let i=1;i<leg.path.length;i++){if(this.arc[i]<this.progress-12||this.arc[i-1]>this.progress+80)continue;const[a,b]=[leg.path[i-1],leg.path[i]],dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((car.x-a[0])*dx+(car.z-a[1])*dz)/(dx*dx+dz*dz||1),0,1),distance=Math.hypot(a[0]+dx*t-car.x,a[1]+dz*t-car.z);if(distance<best.distance)best={distance,s:this.arc[i-1]+(this.arc[i]-this.arc[i-1])*t};}this.progress=Math.max(this.progress,best.s);
  const remaining=this.arc.at(-1)-this.progress,targetDistance=Math.hypot(car.x-leg.target.x,car.z-leg.target.z),speed=Math.hypot(car.vx,car.vz);if(next===leg.gates.length&&targetDistance<=this.stopRadius)return idle;
  const look=clamp(5.5+speed*.65,5.5,12),goal=this.at(this.progress+look),heading=Math.atan2(goal.x-car.x,goal.z-car.z),error=angle(heading-car.h-car.w*.12),maxSteer=.62/(1+Math.abs(car.v)/16),wheelbase=car.geometry?.wheelbase??2.7,steer=clamp(-Math.atan2(2*wheelbase*Math.sin(error),Math.max(2,Math.hypot(goal.x-car.x,goal.z-car.z)))/maxSteer,-1,1);
  const a=this.at(this.progress+2),b=this.at(this.progress+12),c=this.at(this.progress+25),turn=Math.abs(angle(Math.atan2(c.x-b.x,c.z-b.z)-Math.atan2(b.x-a.x,b.z-a.z))),curveSpeed=turn>.9?3:turn>.4?4.2:turn>.18?5.5:this.speed,target=Math.min(this.speed,curveSpeed,remaining<25?Math.sqrt(Math.max(1,(remaining-5)*5)):Infinity);return{steer,throttle:car.v<target-.25,brake:car.v>target+.45,handbrake:false,active:true};
 }
}
