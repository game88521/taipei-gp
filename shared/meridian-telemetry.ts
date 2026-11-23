/** Actual driving commands. The classic car accelerates automatically unless braking. */
export interface MeridianTelemetryContext {
  circuit:string; stamp:string; physics:string; rules:'classic'|'2026'; car:string;
  assist:boolean; length:number; throttleModel:'auto-on-unless-braking';
}
export interface MeridianTelemetryPoint { time:number;s:number;x:number;z:number;h:number;speed:number;throttle:0|1;brake:boolean;steer:number;wheelSteer?:number }
export interface MeridianTelemetryLap { type:'taipei-gp-operation-telemetry';v:1;context:MeridianTelemetryContext;seconds:number;points:MeridianTelemetryPoint[] }
export const MERIDIAN_TELEMETRY_MAX_BYTES=2000000;
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[],optional:string[]=[])=>keys.every(k=>k in v)&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k));
const num=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function parseMeridianTelemetryContext(v:unknown):MeridianTelemetryContext|null {
  if(!obj(v)||!exact(v,['circuit','stamp','physics','rules','car','assist','length','throttleModel'])||!['circuit','stamp','physics','car'].every(k=>typeof v[k]==='string'&&String(v[k]).length>0&&String(v[k]).length<=160&&!/[\u0000-\u001f<>]/.test(String(v[k])))||!['classic','2026'].includes(String(v.rules))||typeof v.assist!=='boolean'||!num(v.length,100,30000)||v.throttleModel!=='auto-on-unless-braking')return null;
  return {circuit:v.circuit as string,stamp:v.stamp as string,physics:v.physics as string,rules:v.rules as 'classic'|'2026',car:v.car as string,assist:v.assist,length:v.length,throttleModel:v.throttleModel};
}
export const sameMeridianTelemetryContext=(a:MeridianTelemetryContext,b:MeridianTelemetryContext)=>(['circuit','stamp','physics','rules','car','assist','length','throttleModel'] as const).every(k=>a[k]===b[k]);
/** Parsing validates shape and continuity, never certifies another driver's honesty. */
export function parseMeridianTelemetry(v:unknown,expected?:MeridianTelemetryContext):MeridianTelemetryLap|null {
  if(!obj(v)||!exact(v,['type','v','context','seconds','points'])||v.type!=='taipei-gp-operation-telemetry'||v.v!==1||!num(v.seconds,8,720)||!Array.isArray(v.points)||v.points.length<40||v.points.length>8000)return null;
  const context=parseMeridianTelemetryContext(v.context);if(!context||expected&&!sameMeridianTelemetryContext(context,expected))return null;
  const points:MeridianTelemetryPoint[]=[];
  for(const raw of v.points){
    if(!obj(raw)||!exact(raw,['time','s','x','z','h','speed','throttle','brake','steer'],['wheelSteer'])||!num(raw.time,0,v.seconds+.25)||!num(raw.s,-1,context.length+80)||!num(raw.x,-100000,100000)||!num(raw.z,-100000,100000)||!num(raw.h,-1e6,1e6)||!num(raw.speed,0,160)||typeof raw.brake!=='boolean'||raw.throttle!==(raw.brake?0:1)||!num(raw.steer,-1,1)||raw.wheelSteer!==undefined&&!num(raw.wheelSteer,-1.5,1.5))return null;
    const p=raw as unknown as MeridianTelemetryPoint,prev=points.at(-1);
    if(prev){const dt=p.time-prev.time,ds=p.s-prev.s,metres=Math.hypot(p.x-prev.x,p.z-prev.z);if(dt<=0||dt>1.2||ds<-.5||ds>160*dt+8||metres>160*dt+8||Math.abs(Math.atan2(Math.sin(p.h-prev.h),Math.cos(p.h-prev.h)))>Math.min(Math.PI,dt*8+.4))return null;}
    points.push({...p});
  }
  const first=points[0],last=points.at(-1)!;
  if(first.time>.6||first.s>80||last.s<context.length-80||Math.abs(last.time-v.seconds)>.7||context.length/v.seconds>150)return null;
  return {type:v.type,v:1,context,seconds:v.seconds,points};
}
export function meridianTelemetryAt(lap:MeridianTelemetryLap,s:number){
  const points=lap.points;if(s<points[0].s||s>points.at(-1)!.s)return null;
  let low=0,high=points.length-1;while(low+1<high){const i=(low+high)>>1;if(points[i].s<=s)low=i;else high=i;}
  const a=points[low],b=points[high],f=b.s>a.s?(s-a.s)/(b.s-a.s):0;
  return {...a,s,time:a.time+(b.time-a.time)*f,speed:a.speed+(b.speed-a.speed)*f};
}
