/** Rex <game88521@gmail.com>. A bounded reconnection episode. Never stores credentials, resends gameplay commands, or restores control without confirmation. */
export {CITY_AUTO_RESUME_VERSION} from '../shared/frontier-city-resume';
export const CITY_AUTO_RESUME_ATTEMPTS=3;
export const CITY_AUTO_RESUME_WINDOW_MS=15_000;
export const CITY_AUTO_RESUME_ATTEMPT_MS=4_000;
const DELAYS=[0,500,1500] as const;
// A stale server socket can take a heartbeat cycle to disappear. Give typed
// busy replies time to clear while retaining the same three-attempt deadline.
const BUSY_DELAYS=[0,3000,5000] as const;
export type CityResumePhase='idle'|'waiting'|'connecting'|'confirm'|'failed'|'cancelled';
export interface CityResumeContext{readonly episode:number;readonly attempt:number;readonly deadline:number}
export interface CityResumeState{readonly phase:CityResumePhase;readonly episode:number;readonly attempts:number;readonly deadline:number|null;readonly remainingMs:number;readonly nextAt:number|null;readonly reason:string}
export interface CityResumeTimers{setTimeout(fn:()=>void,ms:number):unknown;clearTimeout(handle:unknown):void}
export interface CityAutoResumeOptions{
 resume(signal:AbortSignal,context:CityResumeContext):Promise<void>;
 abortTransport():void;eligible():boolean;changed():void;
 visible?():boolean;now?():number;timers?:CityResumeTimers;
}
export class CityResumeError extends Error{
 readonly fatal:boolean;
 constructor(message:string,readonly kind:'fatal'|'retryable'='retryable',readonly code=''){super(message);this.name='CityResumeError';this.fatal=kind==='fatal';}
}
const reason=(error:unknown,fallback:string)=>{const text=error instanceof Error?error.message:typeof error==='string'?error:'';return text.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,180)||fallback;};
/** Call start only after an unexpected loss of an established player seat. Watchers and explicit exits never start an episode. */
export class CityAutoResume{
 private phase:CityResumePhase='idle';private episode=0;private attempts=0;private deadline:number|null=null;private nextAt:number|null=null;private message='';
 private generation=0;private disposed=false;private lastNow=-Infinity;private timer:unknown=null;private controller:AbortController|null=null;private attemptEndsAt=0;
 private readonly timers:CityResumeTimers;private readonly visibility=()=>this.wake();
 constructor(private readonly options:CityAutoResumeOptions){this.timers=options.timers??{setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};if(typeof document!=='undefined')document.addEventListener('visibilitychange',this.visibility);}
 private now(){const value=this.options.now?.()??(typeof performance==='undefined'?Date.now():performance.now());if(Number.isFinite(value))this.lastNow=Math.max(this.lastNow,value);return Number.isFinite(this.lastNow)?this.lastNow:0;}
 private visible(){return this.options.visible?.()??(typeof document==='undefined'||document.visibilityState!=='hidden');}
 get gated(){return this.phase!=='idle';}
 get state():Readonly<CityResumeState>{return{phase:this.phase,episode:this.episode,attempts:this.attempts,deadline:this.deadline,remainingMs:this.deadline===null?0:Math.max(0,this.deadline-this.now()),nextAt:this.nextAt,reason:this.message};}
 private notify(){this.options.changed();}
 private clearTimer(){if(this.timer!==null){this.timers.clearTimeout(this.timer);this.timer=null;}}
 private invalidate(abort:boolean){const generation=++this.generation;this.clearTimer();const controller=this.controller;this.controller=null;if(abort&&controller){controller.abort();try{this.options.abortTransport();}catch{/* An adapter cleanup failure must not revive a cancelled episode. */}}return generation;}
 private schedule(){
  this.clearTimer();if(this.disposed||!['waiting','connecting'].includes(this.phase)||this.deadline===null)return;
  const now=this.now(),edge=this.phase==='connecting'?Math.min(this.deadline,this.attemptEndsAt):this.visible()?Math.min(this.deadline,this.nextAt??this.deadline):this.deadline,wait=Math.max(0,Math.min(250,edge-now)),generation=this.generation;
  this.timer=this.timers.setTimeout(()=>{this.timer=null;if(!this.disposed&&generation===this.generation)this.tick();},wait);
 }
 private fail(text:string){const generation=this.invalidate(true);if(this.disposed||generation!==this.generation)return;this.phase='failed';this.nextAt=null;this.message=text;this.notify();}
 private tick(){
  if(this.disposed||!['waiting','connecting'].includes(this.phase)||this.deadline===null)return;
  const now=this.now();if(now>=this.deadline){this.fail('15秒續接期限已過，車輛保持停止；請離房後重新加入。');return;}
  if(!this.options.eligible()){this.fail('原席位已失效或已離開，已停止自動續接。');return;}
  if(this.phase==='connecting'&&now>=this.attemptEndsAt){this.attemptFailed(this.controller!,new CityResumeError('本次續接超過4秒，連線已停止。'));return;}
  if(this.phase==='waiting'&&this.visible()&&now>=(this.nextAt??now)){this.attempt();return;}
  const generation=this.generation;this.notify();if(generation===this.generation)this.schedule();
 }
 private attempt(){
  if(this.disposed||this.phase!=='waiting'||this.deadline===null)return;
  if(this.attempts>=CITY_AUTO_RESUME_ATTEMPTS){this.fail('已嘗試3次，沒有自動重送任何操控或作業；可離房後重新加入。');return;}
  const controller=new AbortController();this.controller=controller;this.phase='connecting';this.attempts++;this.nextAt=null;this.attemptEndsAt=Math.min(this.deadline,this.now()+CITY_AUTO_RESUME_ATTEMPT_MS);this.message='正在續接原席位（'+this.attempts+'/3），操控保持停止。';
  const generation=this.generation,context=Object.freeze({episode:this.episode,attempt:this.attempts,deadline:this.deadline});this.notify();
  if(this.disposed||generation!==this.generation||controller!==this.controller)return;
  this.schedule();
  Promise.resolve().then(()=>{if(this.disposed||generation!==this.generation||controller!==this.controller||controller.signal.aborted)return;return this.options.resume(controller.signal,context);}).then(()=>{
   if(this.disposed||generation!==this.generation||controller!==this.controller||controller.signal.aborted)return;
   if(this.deadline===null||this.now()>=this.deadline){this.fail('15秒續接期限已過，晚到的連線已取消。');return;}
   if(this.now()>=this.attemptEndsAt){this.attemptFailed(controller,new CityResumeError('本次續接超過4秒，晚到的連線已取消。'));return;}
   this.controller=null;this.invalidate(false);this.phase='confirm';this.nextAt=null;this.message='已連線，請先確認恢復操控；尚未重送油門、方向或作業。';this.notify();
  },error=>{if(!this.disposed&&generation===this.generation&&controller===this.controller)this.attemptFailed(controller,error);});
 }
 private attemptFailed(controller:AbortController,error:unknown){
  if(controller!==this.controller||this.phase!=='connecting')return;const invalidated=this.invalidate(true);if(this.disposed||invalidated!==this.generation)return;
  if(error&&typeof error==='object'&&(error as {fatal?:unknown}).fatal===true){this.phase='failed';this.nextAt=null;this.message=reason(error,'原席位無法續接，請重新加入。');this.notify();return;}
  if(this.deadline===null||this.now()>=this.deadline){this.fail('15秒續接期限已過，已停止嘗試。');return;}
  if(this.attempts>=CITY_AUTO_RESUME_ATTEMPTS){this.phase='failed';this.nextAt=null;this.message='已嘗試3次：'+reason(error,'未能接回服務。');this.notify();return;}
  const busy=error&&typeof error==='object'&&(error as {code?:unknown}).code==='SEAT_BUSY';
  this.phase='waiting';this.nextAt=Math.min(this.deadline,this.now()+(busy?BUSY_DELAYS:DELAYS)[this.attempts]);this.message=reason(error,'連線尚未恢復。')+' 將在期限內再次嘗試。';const generation=this.generation;this.notify();if(generation===this.generation)this.schedule();
 }
 start():boolean{
  if(this.disposed||!['idle','confirm'].includes(this.phase)||!this.options.eligible())return false;
  const continuation=this.phase==='confirm';this.invalidate(false);const now=this.now();
  if(!continuation){this.episode++;this.attempts=0;this.deadline=now+CITY_AUTO_RESUME_WINDOW_MS;}
  if(this.deadline===null||now>=this.deadline){this.fail('原續接期限已過，未重新開始15秒倒數。');return false;}
  if(this.attempts>=CITY_AUTO_RESUME_ATTEMPTS){this.fail('本輪已嘗試3次，未重新計次。');return false;}
  this.phase='waiting';this.nextAt=now+(continuation?DELAYS[this.attempts]:DELAYS[0]);this.message=this.visible()?'連線中斷，將在15秒內續接原席位。':'頁面在背景，返回後將在原期限內續接。';const generation=this.generation;this.notify();if(generation===this.generation)this.schedule();return true;
 }
 wake(){if(this.disposed)return;if(['waiting','connecting'].includes(this.phase)){this.clearTimer();this.tick();}}
 cancel(text='已取消自動續接；沒有重送操控或作業。'){if(this.disposed||this.phase==='idle')return;const generation=this.invalidate(true);if(this.disposed||generation!==this.generation)return;this.phase='cancelled';this.nextAt=null;this.message=reason(text,'已取消自動續接。');this.notify();}
 /** A manually completed resume uses the same consent gate. It never grants a fresh automatic retry window. */
 restored():boolean{if(this.disposed||!this.options.eligible()||!['idle','failed','cancelled','confirm'].includes(this.phase))return false;if(this.phase==='confirm')return true;this.invalidate(false);if(this.deadline===null){this.episode++;this.deadline=this.now();}this.phase='confirm';this.nextAt=null;this.message='已手動續接，請確認恢復操控；尚未重送操控或作業。';this.notify();return true;}
 confirm():boolean{if(this.disposed||this.phase!=='confirm')return false;this.reset();return true;}
 reset(){if(this.disposed)return;const changed=this.phase!=='idle'||this.deadline!==null||this.attempts!==0;this.invalidate(true);this.phase='idle';this.attempts=0;this.deadline=null;this.nextAt=null;this.message='';if(changed)this.notify();}
 dispose(){if(this.disposed)return;this.invalidate(true);this.disposed=true;this.phase='idle';this.deadline=null;this.nextAt=null;this.attempts=0;if(typeof document!=='undefined')document.removeEventListener('visibilitychange',this.visibility);}
}
