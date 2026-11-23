import {EXPEDITION_DUTY_VERSION,parseCrewRoom,parseCrewWatchState,crewCode,CREW_RESUME_ERRORS,type CrewRoom,type CrewInput} from '../shared/expedition-duty';
import {CITY_REPLAY_VERSION,parseCityReplayDescriptor,type CityReplayArchive,type CityReplayDescriptor} from '../shared/frontier-city-replay';
import {CITY_AUTO_RESUME_VERSION,CityAutoResume,CityResumeError} from './frontier-city-reconnect';
import {CityReplayDownload} from './frontier-city-replay-client';
import {CREW_TEAM_VERSION,crewRolesFor,type TeamRole} from '../shared/aurora-duty';
const SEAT='taipei-gp-expedition-duty-seat-v1';
interface Seat{endpoint:string;code:string;selfId:string;token:string}
type JoinKind='create'|'join'|'resume'|'watch'|'auto-resume';
const newResumeKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
export function dutyEndpoint(config:string,at:Pick<Location,'hostname'|'protocol'>){
 try{if(config.trim()){const u=new URL(config.trim());if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)return '';u.pathname='/city-duty';return u.href;}
 if(at.protocol==='http:'&&/^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(at.hostname))return 'ws://'+at.hostname+':4320/city-duty';}catch{}return '';
}
/** Rex <game88521@gmail.com>. Retries only the original private seat; never replays driving or duty commands. */
export class ExpeditionDutyClient{
 room:CrewRoom|null=null;selfId='';status:'idle'|'connecting'|'connected'|'closed'='idle';message='';
 spectating=false;viewerId='';watchCount=0;watchEnded=false;supportsWatching=false;supportsReplay=false;supportsAutoResume=false;supportsTeam=false;capabilitiesKnown=false;
 replay:CityReplayDescriptor|null=null;readonly autoResume:CityAutoResume;private replayPull:CityReplayDownload;
 private socket:WebSocket|null=null;private generation=0;private seq=0;private run='';private seat:Seat|null=null;
 private opening:Promise<void>|null=null;private cancelOpening:(()=>void)|null=null;
 private heartbeat:ReturnType<typeof setInterval>|null=null;
 private watchdog:ReturnType<typeof setInterval>|null=null;private lastInbound=0;
 private joining:{kind:JoinKind;resolve():void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}|null=null;
 private session:'player'|'watch'|null=null;private autoEligible=false;private consent=false;private resumeKey='';private keyEpisode=-1;
 confirmPending=false;private confirmTimer:ReturnType<typeof setTimeout>|null=null;
 constructor(readonly endpoint:string,private changed:()=>void,private storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>|null=null){
  this.replayPull=new CityReplayDownload(m=>this.send(m),()=>this.changed());
  this.autoResume=new CityAutoResume({resume:(signal,ctx)=>this.resumeAutomatically(signal,ctx),abortTransport:()=>this.abortTransport(),eligible:()=>this.session==='player'&&!!this.seat,changed:()=>this.changed(),visible:()=>typeof document==='undefined'||!document.hidden});
  try{const raw=storage?.getItem(SEAT);if(raw&&raw.length<1500){const s=JSON.parse(raw);if(s.endpoint===endpoint&&crewCode(s.code)&&/^[a-f0-9]{20}$/.test(s.selfId)&&/^[a-f0-9]{64}$/.test(s.token))this.seat=s;}}catch{}
 }
 get resumable(){return !!this.seat&&this.status!=='connecting'&&!this.room;}
 get rememberedCode(){return this.seat?.code??'';}
 get replayBusy(){return this.replayPull.busy;}
 get reconnectState(){return this.autoResume.state;}
 get controlGated(){return this.consent||this.autoResume.gated;}
 get roles():TeamRole[]{const r=this.room;return r&&!this.spectating?crewRolesFor(r.players,r.team,this.selfId):[];}
 async downloadReplay():Promise<CityReplayArchive>{if(!this.supportsReplay||this.room?.phase!=='finished'||!this.replay?.ready)throw Error('本場匿名城市回放尚未完成。');const archive=await this.replayPull.start(this.replay);if(archive.source!=='duty'||archive.mode!=='rescue')throw Error('回放來源與本場合作救援不符。');return archive;}
 cancelReplay(reason?:string){this.replayPull.cancel(reason);}
 cancelReconnect(){this.autoEligible=false;this.autoResume.cancel('已取消自動續接；原保留期限內仍可手動續接。');this.abortTransport();this.message='已取消自動續接；可手動續接或結束還車。';this.changed();}
 wakeReconnect(){this.autoResume.wake();}
 confirmReconnect(){
  if(!this.room||this.status!=='connected'||this.spectating||!this.consent)return false;
  const phase=this.autoResume.state.phase;if(phase==='waiting'||phase==='connecting')return false;
  if(this.resumeKey&&this.supportsAutoResume){if(this.confirmPending)return false;this.confirmPending=true;this.confirmTimer=setTimeout(()=>{this.confirmPending=false;this.confirmTimer=null;this.message='尚未收到確認，可再按一次恢復操控。';this.changed();},1500);if(!this.send({type:'confirm-resume',revision:this.room.revision,runId:this.room.runId,resumeKey:this.resumeKey})){this.clearConfirm();return false;}this.changed();return false;}
  return this.finishConsent();
 }
 private finishConsent(){
  const phase=this.autoResume.state.phase;this.clearConfirm();this.consent=false;
  if(phase==='confirm'&&!this.autoResume.confirm())return false;
  if(phase==='cancelled'||phase==='failed')this.autoResume.reset();
  this.consent=false;this.resumeKey='';this.keyEpisode=-1;this.autoEligible=this.supportsAutoResume;this.message='席位已恢復，請重新按下操控或絞盤按鈕。';this.changed();return true;
 }
 private clearConfirm(){if(this.confirmTimer)clearTimeout(this.confirmTimer);this.confirmTimer=null;this.confirmPending=false;}
 private remember(){try{if(this.seat)this.storage?.setItem(SEAT,JSON.stringify(this.seat));else this.storage?.removeItem(SEAT);}catch{this.message='本次可遊玩，但瀏覽器未保存續接席位。';}}
 connect():Promise<void>{
  if(this.status==='connected'&&this.socket?.readyState===1)return Promise.resolve();if(this.opening)return this.opening;if(!this.endpoint)return Promise.reject(Error('合作救援服務尚未設定。'));
  const gen=++this.generation;this.status='connecting';this.message='';this.supportsWatching=this.supportsReplay=this.supportsAutoResume=this.supportsTeam=this.capabilitiesKnown=false;this.watchEnded=false;this.changed();
  this.opening=new Promise((resolve,reject)=>{let done=false,opened=false;const ws=new WebSocket(this.endpoint);this.socket=ws;
   const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timeout);if(gen===this.generation){this.opening=null;this.cancelOpening=null;}if(error)reject(error);else resolve();};
   this.cancelOpening=()=>finish(Error('已取消救援連線'));const timeout=setTimeout(()=>{finish(Error('救援服務尚未回應，請稍後重試。'));ws.close();},12000);
   ws.addEventListener('message',e=>{if(gen!==this.generation||ws!==this.socket||typeof e.data!=='string'||e.data.length>300000)return;let m;try{m=JSON.parse(e.data);}catch{return;}if(!m||typeof m!=='object'||Array.isArray(m))return;
    if(m.type==='hello'){
     if(m.v!==EXPEDITION_DUTY_VERSION){this.autoEligible=false;finish(new CityResumeError('合作救援前後端版本不相容。','fatal','VERSION_MISMATCH'));ws.close();return;}
     const features=m.features as Record<string,unknown>|undefined;this.capabilitiesKnown=true;this.supportsWatching=features?.cityWatch===1;this.supportsReplay=features?.cityReplay===1&&features?.cityReplayVersion===CITY_REPLAY_VERSION;this.supportsAutoResume=features?.autoResumeVersion===CITY_AUTO_RESUME_VERSION;this.supportsTeam=features?.crewTeamVersion===CREW_TEAM_VERSION;this.status='connected';opened=true;
     this.lastInbound=Date.now();if(this.watchdog)clearInterval(this.watchdog);this.watchdog=setInterval(()=>{if(gen!==this.generation||ws!==this.socket||!this.room||this.status!=='connected'||typeof document!=='undefined'&&document.hidden||Date.now()-this.lastInbound<4000)return;const watcher=this.session==='watch';this.abortTransport();this.status='closed';if(watcher){this.watchEnded=true;this.message='觀戰狀態逾時，已結束跟車。';}else if(this.session==='player'){this.consent=true;this.message='救援狀態超過4秒未更新，已停止操控並嘗試續接。';if(this.autoEligible)this.autoResume.start();}this.changed();},500);
     if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>this.send({type:'ping',sentAt:Date.now()}),10000);finish();this.changed();
    }else if(opened){if(m.type==='city-replay-part'&&e.data.length>65536){this.replayPull.cancel('城市回放分塊超過連線上限。');return;}this.receive(m);}
   });
   ws.addEventListener('close',()=>{
    if(gen!==this.generation||ws!==this.socket)return;const watcher=this.session==='watch'||this.spectating,wasPlayer=this.session==='player'&&!!this.seat;
    if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;if(this.watchdog)clearInterval(this.watchdog);this.watchdog=null;this.clearConfirm();this.socket=null;this.status='closed';this.replay=null;this.replayPull.cancel('救援連線中斷，已清除未完成回放。');finish(Error('救援連線中斷'));this.rejectJoin('救援連線中斷，沒有自動重送作業。');this.room=null;
    if(watcher){this.message='觀戰連線已中斷，未保留觀眾席位。';this.watchEnded=true;}
    else if(wasPlayer){this.consent=true;this.message=this.autoEligible?'連線中斷，正在期限內續接原席位；沒有重送任何操控。':'連線中斷，可於15秒內手動續接；服務需更新才能自動續接。';if(this.autoEligible)this.autoResume.start();}
    this.changed();
   });
   ws.addEventListener('error',()=>{finish(Error('無法連線至合作救援，請檢查服務與來源設定。'));ws.close();});
  });return this.opening;
 }
 private receive(m:Record<string,unknown>){
  if(this.replayPull.receive(m))return;
  if(m.type==='pong')return;
  if(m.type==='resume-confirmed'){if(this.consent&&this.confirmPending&&this.room&&m.resumeKey===this.resumeKey&&m.runId===this.room.runId&&m.revision===this.room.revision)this.finishConsent();return;}
  if(m.type==='error'){
   this.message=typeof m.message==='string'?m.message:'救援指令被拒絕';const code=typeof m.code==='string'&&CREW_RESUME_ERRORS.includes(m.code as typeof CREW_RESUME_ERRORS[number])?m.code:'';
   this.replayPull.cancel(this.message);this.rejectJoin(this.message,code);this.changed();return;
  }
  if(m.type==='left'||m.type==='removed'||m.type==='expired'||m.type==='watch-ended'){
   const watcher=this.session==='watch'||this.spectating;this.room=null;this.replay=null;this.replayPull.observe(null);this.autoEligible=false;this.session=null;this.consent=false;this.resumeKey='';this.autoResume.reset();
   if(!watcher){this.seat=null;this.remember();}if(m.type==='watch-ended'){this.watchEnded=true;this.message='救援房間已結束觀戰。';}this.spectating=false;this.viewerId='';this.abortTransport();this.changed();return;
  }
  if(!['welcome','watching','room','state'].includes(String(m.type)))return;
  let raw=m.room;if(m.type==='state'){
   if(!this.room||!raw||typeof raw!=='object')return;const light=raw as Record<string,unknown>;if(light.code!==this.room.code||light.revision!==this.room.revision||light.runId!==this.room.runId)return;
   if(!light.mission||typeof light.mission!=='object'||(light.mission as {caseIndex?:unknown}).caseIndex!==this.room.mission.caseIndex)return;
   const home=['returning','unloading','complete'].includes(String(light.stage));raw={...light,outbound:this.room.outbound,homebound:this.room.homebound,route:home?this.room.homebound:this.room.outbound};
  }
  const room=parseCrewRoom(raw);if(!room){this.autoEligible=false;this.message='救援狀態格式不相容，已停止續接；請離房後重新連線。';this.rejectJoin(this.message,'SEAT_REJECTED');this.abortTransport();this.changed();return;}
  if(m.type==='room'&&(!this.room||room.code!==this.room.code||room.serverTime<this.room.serverTime))return;
  const watch=m.watch===undefined?null:parseCrewWatchState(m.watch);if(m.watch!==undefined&&!watch)return;
  const replay=m.replay===undefined||m.replay===null?null:parseCityReplayDescriptor(m.replay);if(m.replay!==undefined&&m.replay!==null&&!replay)return;
  if(m.type==='welcome'){
   const kind=this.joining?.kind;if(!kind||kind==='watch'||typeof m.selfId!=='string'||typeof m.token!=='string'||!/^[a-f0-9]{64}$/.test(m.token)||!room.players.some(p=>p.id===m.selfId)||((kind==='resume'||kind==='auto-resume')&&m.selfId!==this.seat?.selfId))return;
   this.spectating=false;this.viewerId='';this.session='player';this.selfId=m.selfId;this.seat={endpoint:this.endpoint,code:room.code,selfId:m.selfId,token:m.token};this.remember();this.seq=room.ack;this.autoEligible=this.supportsAutoResume;this.consent=kind==='resume'||kind==='auto-resume';
  }
  if(m.type==='watching'){if(this.joining?.kind!=='watch'||typeof m.viewerId!=='string'||!/^[a-f0-9]{20}$/.test(m.viewerId)||'token'in m||'selfId'in m||!watch)return;this.session='watch';this.autoEligible=false;this.spectating=true;this.viewerId=m.viewerId;this.selfId='';this.watchEnded=false;}
  if(m.type==='room'&&this.session==='player'&&!room.players.some(p=>p.id===this.selfId)){this.autoEligible=false;this.seat=null;this.remember();this.abortTransport();this.message='原救援席位已釋放，請重新加入。';this.changed();return;}
  const key=room.runId+':'+room.revision;if(key!==this.run){this.seq=room.ack;this.run=key;}
  this.room=room;this.lastInbound=Date.now();if(watch)this.watchCount=watch.count;this.replay=replay;this.replayPull.observe(replay);
  if((m.type==='welcome'||m.type==='watching')&&this.joining){clearTimeout(this.joining.timer);this.joining.resolve();this.joining=null;}this.changed();
 }
 private rejectJoin(text:string,code=''){if(this.joining){clearTimeout(this.joining.timer);const resume=this.joining.kind==='resume'||this.joining.kind==='auto-resume';this.joining.reject(resume&&code?new CityResumeError(text,code==='SEAT_BUSY'?'retryable':'fatal',code):Error(text));this.joining=null;}}
 private request(kind:JoinKind,name='',code='',resumeKey=''){
  if(this.joining||this.room)return Promise.reject(Error('仍在加入房間或尚未離房'));
  return new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.joining=null;reject(Error('加入救援房逾時。'));},8000);this.joining={kind,resolve,reject,timer};
   const message=kind==='watch'?{type:'watch',v:EXPEDITION_DUTY_VERSION,code}:kind==='resume'||kind==='auto-resume'?{type:'resume',v:EXPEDITION_DUTY_VERSION,code:this.seat?.code,selfId:this.seat?.selfId,token:this.seat?.token,...resumeKey?{resumeKey}:{}}:{type:kind,v:EXPEDITION_DUTY_VERSION,name,code};
   if(!this.send({...message,...this.supportsTeam?{crewTeamVersion:CREW_TEAM_VERSION}:{}}))this.rejectJoin('救援連線未就緒');
  });
 }
 async join(kind:'create'|'join'|'resume'|'watch',name:string,code:string){
  if(this.joining||this.room)throw Error('仍在加入房間或尚未離房');if(kind==='resume'&&!this.seat)throw Error('沒有可續接席位');
  const expected=kind==='resume'?this.seat?.selfId:null;this.autoEligible=false;if(kind==='resume')this.autoResume.cancel('改為手動續接原席位。');else this.autoResume.reset();this.consent=kind==='resume';if(kind==='watch')this.session='watch';if(kind!=='resume'){this.resumeKey='';this.keyEpisode=-1;}await this.connect();const gen=this.generation;
  if(kind==='watch'&&!this.supportsWatching)throw Error('此救援服務尚不支援觀戰，請更新伺服器');
  if(kind==='resume'&&this.supportsAutoResume&&!this.resumeKey)this.resumeKey=newResumeKey();
  await this.request(kind,name,code,kind==='resume'&&this.supportsAutoResume?this.resumeKey:'');if(gen!==this.generation||this.status!=='connected'||!this.room||expected&&this.selfId!==expected)throw Error('續接已取消或席位再次中斷。');if(kind==='resume')this.autoResume.restored();
 }
 private async resumeAutomatically(signal:AbortSignal,ctx:{episode:number;attempt:number;deadline:number}){
  if(ctx.episode!==this.keyEpisode){this.resumeKey=newResumeKey();this.keyEpisode=ctx.episode;}
  const abort=()=>this.abortTransport();signal.addEventListener('abort',abort,{once:true});
  const expected=this.seat?.selfId;
  try{if(signal.aborted)throw Error('已取消續接');await this.connect();const gen=this.generation;if(signal.aborted)throw Error('已取消續接');if(!this.supportsAutoResume)throw new CityResumeError('救援服務尚未宣告自動續接能力，請更新後端。','fatal','VERSION_MISMATCH');await this.request('auto-resume','','',this.resumeKey);if(signal.aborted||gen!==this.generation||this.status!=='connected'||!this.room||this.selfId!==expected||!this.room.players.some(p=>p.id===expected))throw Error('續接已取消或席位再次中斷。');}
  finally{signal.removeEventListener('abort',abort);}
 }
 watch(code:string){return this.join('watch','',code);}
 private send(message:unknown){if(this.socket?.readyState!==1||this.socket.bufferedAmount>32768)return false;try{this.socket.send(JSON.stringify(message));return true;}catch{return false;}}
 command(type:string,fields:Record<string,unknown>={}){if(!this.room||this.status!=='connected'||this.spectating&&!['leave','watch-leave'].includes(type)||this.controlGated&&!['leave','watch-leave'].includes(type))return false;return this.send({type,revision:this.room.revision,runId:this.room.runId,...fields});}
 input(input:CrewInput){if(this.controlGated||!this.room||this.room.phase!=='running'||this.room.paused||!this.roles.includes('driver'))return;const next=this.seq+1;if(this.command('input',{seq:next,...input}))this.seq=next;}
 operate(kind:string,pull=0,side=0){if(!this.controlGated&&this.room?.phase==='running'&&!this.room.paused&&this.roles.includes('technician'))this.command('operate',{kind,pull,side});}
 safety(action:'front'|'rear'|'clear'|'stop'){if(this.supportsTeam&&this.roles.includes('safety'))return this.command('safety',{action});return false;}
 dispatch(action:'brief'|'depot'){const r=this.room;if(this.supportsTeam&&r&&this.roles.includes('dispatcher'))return this.command('dispatch',{action,incidentId:r.mission.settings.incidents[r.mission.caseIndex]});return false;}
 leave(){const viewer=this.spectating||this.watchEnded||!!this.viewerId||this.session==='watch';this.command(viewer?'watch-leave':'leave');this.autoEligible=false;this.session=null;this.autoResume.reset();this.consent=false;this.resumeKey='';this.keyEpisode=-1;if(!viewer){this.seat=null;this.remember();}this.abortTransport();this.changed();}
 disconnect(){this.autoEligible=false;this.autoResume.cancel('已手動中斷連線。');this.abortTransport();this.changed();}
 dispose(){this.leave();this.autoResume.dispose();}
 private abortTransport(){
  const socket=this.socket;this.generation++;this.socket=null;this.clearConfirm();if(this.watchdog)clearInterval(this.watchdog);this.watchdog=null;if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;this.cancelOpening?.();this.cancelOpening=null;this.opening=null;this.rejectJoin('已取消加入救援房');this.room=null;this.replay=null;this.replayPull.cancel('救援連線已停止，取消回放下載。');this.spectating=false;this.viewerId='';this.watchCount=0;this.status='idle';socket?.close();
 }
}
