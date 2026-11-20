/** Rex <game88521@gmail.com>. Offline recorded lead car; no simulated network opponent or legacy race results. */
export const TANDEM_GHOST_KEY='taipei-gp-frontier-tandem-ghost-v1',TANDEM_RESULTS_KEY='taipei-gp-frontier-tandem-results-v1';
export const TANDEM_MAX_MS=120000,TANDEM_MIN_MS=10000,TANDEM_GHOST_BYTES=1000000;
export type PracticeFrame=[number,number,number,number,number,number,number,number,number]; // at,x,z,y,h,vx,vz,pitch,roll
export interface PracticeGhost{v:1;id:string;at:number;vehicle:'muscle';weather:'dry';durationMs:number;distanceM:number;frames:PracticeFrame[]}
export interface PracticePose{x:number;z:number;y:number;h:number;vx:number;vz:number;pitch:number;roll:number}
export const PRACTICE_REASONS={good:'有效追走',contact:'接觸後保護',height:'不同道路樓層',ahead:'超前領跑車',near:'距離過近',far:'落後過遠',side:'橫向偏離',heading:'車頭方向差過大',slow:'速度不足',lowSlip:'滑角不足',highSlip:'滑角過大',invalid:'資料異常'}as const;
export type PracticeReason=keyof typeof PRACTICE_REASONS;
export interface PracticeReadout{quality:number;reason:PracticeReason;gap:number;side:number;distance:number;slipDeg:number;headingDeg:number}
export interface PracticeResult{id:string;at:number;ghostId:string;seconds:number;score:number;goodSeconds:number;maxCombo:number;reasons:Record<PracticeReason,number>}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const num=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const ident=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{24}$/.test(v);
const angle=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
export const practiceId=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');
function validPose(c:PracticePose){return !!c&&num(c.x,-12000,12000)&&num(c.z,-12000,12000)&&num(c.y,-80,500)&&num(c.h,-1e6,1e6)&&num(c.vx,-100,100)&&num(c.vz,-100,100)&&num(c.pitch,-Math.PI,Math.PI)&&num(c.roll,-Math.PI,Math.PI);}
const poseFrame=(at:number,c:PracticePose):PracticeFrame=>[at,c.x,c.z,c.y,angle(c.h),c.vx,c.vz,c.pitch,c.roll];
export function parsePracticeGhost(v:unknown):PracticeGhost|null{
 if(!object(v)||!exact(v,['v','id','at','vehicle','weather','durationMs','distanceM','frames'])||v.v!==1||!ident(v.id)||!num(v.at,0,8.64e15)||v.vehicle!=='muscle'||v.weather!=='dry'||!num(v.durationMs,TANDEM_MIN_MS,TANDEM_MAX_MS)||!num(v.distanceM,50,15000)||!Array.isArray(v.frames)||v.frames.length<51||v.frames.length>2402)return null;
 let before:PracticeFrame|undefined,distance=0;for(const f of v.frames){if(!Array.isArray(f)||f.length!==9||!num(f[0],0,v.durationMs)||!num(f[1],-12000,12000)||!num(f[2],-12000,12000)||!num(f[3],-80,500)||!num(f[4],-Math.PI-1e-6,Math.PI+1e-6)||!num(f[5],-100,100)||!num(f[6],-100,100)||!num(f[7],-Math.PI,Math.PI)||!num(f[8],-Math.PI,Math.PI))return null;
  if(before){const dt=f[0]-before[0],d=Math.hypot(f[1]-before[1],f[2]-before[2]);if(dt<1||dt>200.0001||d>100*dt/1000+.5||Math.abs(f[3]-before[3])>Math.max(3,25*dt/1000))return null;distance+=d;}else if(f[0]!==0)return null;before=f as PracticeFrame;
 }if(Math.abs(before![0]-v.durationMs)>.01||Math.abs(distance-v.distanceM)>1e-5)return null;return structuredClone(v) as unknown as PracticeGhost;
}
export function practiceGhostAt(ghost:PracticeGhost,at:number):PracticePose{
 const t=Math.max(0,Math.min(ghost.durationMs,at));let lo=0,hi=ghost.frames.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(ghost.frames[mid][0]<=t)lo=mid;else hi=mid-1;}const a=ghost.frames[lo],b=ghost.frames[Math.min(lo+1,ghost.frames.length-1)],u=(t-a[0])/(b[0]-a[0]||1),lerp=(index:number)=>a[index]+(b[index]-a[index])*u;
 return{x:lerp(1),z:lerp(2),y:lerp(3),h:angle(a[4]+angle(b[4]-a[4])*u),vx:lerp(5),vz:lerp(6),pitch:lerp(7),roll:lerp(8)};
}
export function practiceQuality(lead:PracticePose,follow:PracticePose,contact=false):PracticeReadout{
 const output:PracticeReadout={quality:0,reason:'invalid',gap:0,side:0,distance:0,slipDeg:0,headingDeg:0};if(!validPose(lead)||!validPose(follow))return output;
 const dx=lead.x-follow.x,dz=lead.z-follow.z,gap=dx*Math.sin(lead.h)+dz*Math.cos(lead.h),side=Math.abs(dx*Math.cos(lead.h)-dz*Math.sin(lead.h)),heading=Math.abs(angle(lead.h-follow.h)),forward=follow.vx*Math.sin(follow.h)+follow.vz*Math.cos(follow.h),lateral=follow.vx*Math.cos(follow.h)-follow.vz*Math.sin(follow.h),slip=Math.abs(Math.atan2(lateral,forward));
 Object.assign(output,{gap,side,distance:Math.hypot(dx,dz),slipDeg:slip*180/Math.PI,headingDeg:heading*180/Math.PI});
 output.reason=contact?'contact':Math.abs(lead.y-follow.y)>=1.8?'height':gap<0?'ahead':gap<3?'near':gap>25?'far':side>8?'side':heading>.7?'heading':Math.hypot(lead.vx,lead.vz)<7||Math.hypot(follow.vx,follow.vz)<7||forward<3?'slow':slip<.14?'lowSlip':slip>1.05?'highSlip':'good';
 if(output.reason==='good')output.quality=Math.max(0,Math.min(1,(1-Math.abs(gap-12)/22)*Math.min(1,slip/.5)*(1-side/12)));return output;
}
export class PracticeRecorder{
 elapsed=0;reason='';private frames:PracticeFrame[]=[];private last:PracticePose;private stopped=false;
 constructor(start:PracticePose,readonly id=practiceId(),readonly at=Date.now()){this.last={...start};if(validPose(start))this.frames.push(poseFrame(0,start));else{this.stopped=true;this.reason='起點資料無效，沒有錄製。';}}
 get full(){return this.elapsed>=TANDEM_MAX_MS;}
 get failed(){return this.stopped&&!!this.reason;}
 step(dt:number,c:PracticePose){if(this.stopped||this.full)return;if(!num(dt,0.000001,.100001)||!validPose(c)){this.stopped=true;this.reason='錄製資料中斷，未取代原鬼車。';return;}this.elapsed=Math.min(TANDEM_MAX_MS,this.elapsed+dt*1000);this.last={...c};if(this.elapsed-this.frames.at(-1)![0]>=50-.00001)this.frames.push(poseFrame(this.elapsed,c));}
 finish():PracticeGhost|null{
  if(this.stopped)return null;this.stopped=true;if(this.frames.at(-1)![0]<this.elapsed-.01)this.frames.push(poseFrame(this.elapsed,this.last));let distance=0;for(let i=1;i<this.frames.length;i++)distance+=Math.hypot(this.frames[i][1]-this.frames[i-1][1],this.frames[i][2]-this.frames[i-1][2]);
  const value=parsePracticeGhost({v:1,id:this.id,at:this.at,vehicle:'muscle',weather:'dry',durationMs:this.elapsed,distanceM:distance,frames:this.frames});if(!value)this.reason='請至少錄製10秒、行駛50公尺；資料須連續且最多120秒。原鬼車未更換。';return value;
 }
}
export class PracticeFollower{
 elapsed=0;score=0;goodSeconds=0;combo=0;maxCombo=0;finished=false;readout:PracticeReadout|null=null;
 readonly reasons=Object.fromEntries(Object.keys(PRACTICE_REASONS).map(key=>[key,0])) as Record<PracticeReason,number>;
 private contactUntil=0;private invalid=false;private emitted=false;
 constructor(readonly ghost:PracticeGhost,readonly id=practiceId()){}
 step(dt:number,c:PracticePose,hit=0){if(this.finished)return;if(!num(dt,.000001,.100001)||!validPose(c)){this.invalid=true;this.finished=true;return;}const used=Math.min(dt,(this.ghost.durationMs-this.elapsed)/1000);this.elapsed=Math.min(this.ghost.durationMs,this.elapsed+used*1000);if(hit>2)this.contactUntil=this.elapsed+1000;const read=this.readout=practiceQuality(practiceGhostAt(this.ghost,this.elapsed),c,this.elapsed<this.contactUntil);this.reasons[read.reason]+=used;this.score+=read.quality*used*100;if(read.quality>0){this.goodSeconds+=used;this.combo+=used;this.maxCombo=Math.max(this.maxCombo,this.combo);}else this.combo=0;if(this.elapsed>=this.ghost.durationMs-.001)this.finished=true;}
 invalidate(){this.invalid=true;this.finished=true;}
 result(at=Date.now()):PracticeResult|null{if(!this.finished||this.invalid||this.emitted)return null;const result={id:this.id,at,ghostId:this.ghost.id,seconds:this.elapsed/1000,score:this.score,goodSeconds:this.goodSeconds,maxCombo:this.maxCombo,reasons:{...this.reasons}};if(!parsePracticeResults([result]))return null;this.emitted=true;return result;}
}
export function parsePracticeResults(v:unknown):PracticeResult[]|null{
 if(!Array.isArray(v)||v.length>30)return null;const ids=new Set();for(const r of v){if(!object(r)||!exact(r,['id','at','ghostId','seconds','score','goodSeconds','maxCombo','reasons'])||!ident(r.id)||ids.has(r.id)||!ident(r.ghostId)||!num(r.at,0,8.64e15)||!num(r.seconds,10,120)||!num(r.score,0,Number(r.goodSeconds)*100+.0001)||!num(r.goodSeconds,0,r.seconds+.0001)||!num(r.maxCombo,0,r.goodSeconds+.0001)||!object(r.reasons)||!exact(r.reasons,Object.keys(PRACTICE_REASONS))||!Object.values(r.reasons).every(n=>num(n,0,Number(r.seconds)+.0001)))return null;const reasons=r.reasons as Record<PracticeReason,number>;if(reasons.invalid!==0||Math.abs(Object.values(reasons).reduce((a,b)=>a+b,0)-r.seconds)>.0001||Math.abs(reasons.good-r.goodSeconds)>.0001)return null;ids.add(r.id);}return structuredClone(v) as PracticeResult[];
}
export class PracticeGhostStore{
 private value:PracticeGhost|null=null;error='';blocked=false;private raw:string|null=null;
 get ghost(){return this.value?structuredClone(this.value):null;}
 constructor(private storage:Pick<Storage,'getItem'|'setItem'>|null){try{if(!storage)throw Error();this.raw=storage.getItem(TANDEM_GHOST_KEY);if(this.raw!==null){if(new TextEncoder().encode(this.raw).length>TANDEM_GHOST_BYTES)throw Error();this.value=parsePracticeGhost(JSON.parse(this.raw));if(!this.value)throw Error();}}catch{this.blocked=true;this.error='原鬼車資料無法讀取，已保留原文；新錄製仍可在本頁使用及下載。';}}
 save(ghost:PracticeGhost){const value=parsePracticeGhost(ghost);if(!value){this.error='鬼車驗證未通過，未寫入。';return false;}if(!this.storage||this.blocked)return false;const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).length>TANDEM_GHOST_BYTES){this.error='鬼車超過1MB，未寫入。';return false;}try{if(this.storage.getItem(TANDEM_GHOST_KEY)!==this.raw){this.blocked=true;this.error='其他頁面已變更鬼車，停止寫回以保留原文。';return false;}this.storage.setItem(TANDEM_GHOST_KEY,raw);if(this.storage.getItem(TANDEM_GHOST_KEY)!==raw){this.blocked=true;this.error='鬼車寫入後已變更，停止寫回。';return false;}this.raw=raw;this.value=structuredClone(value);this.error='';return true;}catch{this.error='鬼車儲存失敗；本頁新錄製仍可下載。';return false;}}
}
