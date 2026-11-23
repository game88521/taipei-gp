/** Rex <game88521@gmail.com>. The server accepts controls only; seat storage is session-only and excluded from backups. */
import {FRONTIER_RALLY_VERSION,FRONTIER_RALLY_SEAT_KEY,rallyCode,parseRallyRoom,AURORA_RALLY_VERSION,parseRallyPlan,type RallyPlan,type RallyRoom,type RallyAverage,type RallyInput} from '../shared/frontier-rally';
import {coopEndpoint} from './nexus-coop-client';
import {CityAutoResume,CityResumeError} from './frontier-city-reconnect';
import {MERIDIAN_NAVIGATOR_VERSION,type NavigatorCall} from '../shared/meridian-navigator';
interface Seat{endpoint:string;code:string;selfId:string;token:string;resumeKey:string|null}
const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');
export function rallyEndpoint(config:string,where:Pick<Location,'hostname'|'protocol'>){const value=coopEndpoint(config,where);if(!value)return '';const url=new URL(value);if(where.protocol==='https:'&&url.protocol!=='wss:')return '';url.pathname='/city-rally';return url.href;}
export class FrontierRallyClient{
 room:RallyRoom|null=null;selfId='';status:'idle'|'connecting'|'connected'|'closed'='idle';message='';
 private socket:WebSocket|null=null;private generation=0;private seat:Seat|null=null;private seq=0;private motion=-1;private offset=0;private lastStateAt=0;private consent=false;private disposed=false;private aurora=false;private navigatorSupported=false;
 private connecting:Promise<void>|null=null;private cancelOpen:(()=>void)|null=null;private joining:{resolve():void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}|null=null;private joinKind='';
 private readonly auto:CityAutoResume;private confirmation:ReturnType<typeof setTimeout>|null=null;
 constructor(readonly endpoint:string,private changed:()=>void,private validate:(room:RallyRoom)=>void,private storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>|null=null){
  try{const raw=storage?.getItem(FRONTIER_RALLY_SEAT_KEY);if(raw&&raw.length<2000){const s=JSON.parse(raw);if(s&&Object.keys(s).sort().join(',')==='code,endpoint,resumeKey,selfId,token'&&s.endpoint===endpoint&&rallyCode(s.code)&&typeof s.selfId==='string'&&/^[a-f0-9]{20}$/.test(s.selfId)&&typeof s.token==='string'&&/^[a-f0-9]{64}$/.test(s.token)&&(s.resumeKey===null||typeof s.resumeKey==='string'&&/^[a-f0-9]{24}$/.test(s.resumeKey)))this.seat=s;}}catch{}
  this.auto=new CityAutoResume({resume:async(signal)=>{if(!this.seat||signal.aborted)throw new CityResumeError('原席位已取消','fatal','SEAT_REJECTED');this.ensureKey();const seat={...this.seat},abort=()=>this.abortTransport();signal.addEventListener('abort',abort,{once:true});try{await this.connect();if(signal.aborted)throw Error('續接已取消');const generation=this.generation;this.joinKind='resume';this.consent=true;await this.request({type:'resume',code:seat.code,selfId:seat.selfId,token:seat.token,resumeKey:seat.resumeKey});if(signal.aborted||generation!==this.generation||!this.room||this.selfId!==seat.selfId)throw Error('續接回應已失效');}finally{signal.removeEventListener('abort',abort);}},abortTransport:()=>this.abortTransport(),eligible:()=>!!this.seat&&!this.disposed,changed:()=>this.changed(),visible:()=>typeof document==='undefined'||!document.hidden});
 }
 get reconnectState(){return this.auto.state;}
 get controlGated(){return this.consent||this.auto.gated;}
 get confirmPending(){return this.confirmation!==null;}
 get resumable(){return!!this.seat&&!this.room&&this.status!=='connecting';}
 get rememberedCode(){return this.seat?.code??'';}
 serverNow(){return Date.now()+this.offset;}
 private save(){try{if(this.seat)this.storage?.setItem(FRONTIER_RALLY_SEAT_KEY,JSON.stringify(this.seat));else this.storage?.removeItem(FRONTIER_RALLY_SEAT_KEY);}catch{}}
 private ensureKey(){if(this.seat&&!this.seat.resumeKey){this.seat.resumeKey=nonce();this.save();}}
 private clearConfirm(){if(this.confirmation)clearTimeout(this.confirmation);this.confirmation=null;}
 private send(value:unknown){if(this.socket?.readyState!==1||this.socket.bufferedAmount>32768)return false;this.socket.send(JSON.stringify(value));return true;}
 private rejectJoin(message:string,error:Error=Error(message)){if(this.joining){clearTimeout(this.joining.timer);this.joining.reject(error);this.joining=null;}}
 private abortTransport(){this.generation++;this.cancelOpen?.();this.cancelOpen=null;this.connecting=null;this.rejectJoin('連線已取消');this.clearConfirm();const s=this.socket;this.socket=null;try{s?.close();}catch{}this.room=null;this.selfId='';this.status='closed';this.seq=0;this.motion=-1;this.changed();}
 private connect():Promise<void>{
  if(this.status==='connected'&&this.socket?.readyState===1)return Promise.resolve();if(this.connecting)return this.connecting;if(!this.endpoint||this.disposed)return Promise.reject(Error('定速拉力服務尚未設定'));const generation=++this.generation;this.status='connecting';this.changed();
  this.connecting=new Promise((resolve,reject)=>{let opened=false,settled=false;const socket=new WebSocket(this.endpoint);this.socket=socket;const finish=(e?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(this.generation===generation){this.connecting=null;this.cancelOpen=null;}e?reject(e):resolve();},timer=setTimeout(()=>{finish(Error('拉力服務連線逾時'));socket.close();},10000);this.cancelOpen=()=>finish(Error('已取消拉力連線'));
   socket.onmessage=event=>{if(this.socket!==socket||this.generation!==generation||typeof event.data!=='string'||event.data.length>2*1024*1024)return;let m:Record<string,unknown>;try{m=JSON.parse(event.data);if(!m||typeof m!=='object'||Array.isArray(m))return;}catch{return;}
    if(m.type==='hello'){if(opened)return;const f=m.features as Record<string,unknown>|undefined;if(m.v!==FRONTIER_RALLY_VERSION||f?.confirmation!==true||f.resumeGraceMs!==15000){finish(new CityResumeError('定速拉力版本不相容，請更新前後端','fatal','VERSION_MISMATCH'));socket.close();return;}this.aurora=f.coursePlan===AURORA_RALLY_VERSION;this.navigatorSupported=f.navigator===MERIDIAN_NAVIGATOR_VERSION;opened=true;this.status='connected';finish();this.changed();}else if(opened)this.receive(m);
   };
   socket.onclose=()=>{if(this.socket!==socket||generation!==this.generation)return;const established=!!this.room&&!!this.selfId;this.socket=null;this.status='closed';finish(Error('定速拉力連線中斷'));this.rejectJoin('連線中斷，可於原15秒內續接');this.clearConfirm();this.room=null;this.selfId='';if(established){this.consent=true;this.message='連線中斷，自車停止；比賽計時繼續。';this.auto.start();}this.changed();};
   socket.onerror=()=>{if(!opened){finish(Error('無法連線定速拉力服務，請確認網路與來源設定'));socket.close();}};
  });return this.connecting;
 }
 private receive(m:Record<string,unknown>){
  if(['welcome','room','state'].includes(String(m.type))){
   if(m.type==='state'&&(!this.room||!m.room||typeof m.room!=='object'||['v','definition','route'].some(k=>k in (m.room as object))))return;
   const raw=m.type==='state'?{...this.room,...m.room as object}:m.room,room=parseRallyRoom(raw);if(!room||room.navigator&&!this.navigatorSupported){if(m.type==='welcome'){this.rejectJoin('伺服器拉力資料驗證失敗');this.abortTransport();}return;}
   if(m.type!=='welcome'&&(!this.room||room.code!==this.room.code||room.serverTime<this.room.serverTime||m.type==='state'&&(room.revision!==this.room.revision||room.matchId!==this.room.matchId)))return;
   if(m.type==='welcome'&&(typeof m.selfId!=='string'||!room.players.some(p=>p.id===m.selfId)||typeof m.token!=='string'||!/^[a-f0-9]{64}$/.test(m.token))){this.rejectJoin('拉力私席資料無效');this.abortTransport();return;}
   try{if(m.type!=='state')this.validate(room);}catch(e){this.rejectJoin((e as Error).message);this.message=(e as Error).message;this.abortTransport();return;}
   if(m.type==='welcome'){this.selfId=String(m.selfId);this.seat={endpoint:this.endpoint,code:room.code,selfId:this.selfId,token:String(m.token),resumeKey:this.joinKind==='resume'?this.seat?.resumeKey??null:null};this.save();if(this.joinKind==='resume')this.consent=true;}
   const self=room.players.find(p=>p.id===this.selfId);if(!self){this.message='原席位已釋放';this.disconnect(false);return;}this.room=room;this.lastStateAt=Date.now();this.offset=room.serverTime-Date.now();if(this.motion!==self.motionRevision){this.motion=self.motionRevision;this.seq=self.ack;}
   if(m.type==='welcome'&&this.joining){clearTimeout(this.joining.timer);this.joining.resolve();this.joining=null;}this.changed();
  }else if(m.type==='resume-confirmed'){
   const r=this.room,p=r?.players.find(p=>p.id===this.selfId);if(Object.keys(m).length===5&&m.matchId===r?.matchId&&m.revision===r?.revision&&m.motionRevision===p?.motionRevision&&m.resumeKey===this.seat?.resumeKey){this.clearConfirm();this.consent=false;if(this.seat){this.seat.resumeKey=null;this.save();}if(!this.auto.confirm())this.auto.reset();this.message='已確認恢復操控；未重送舊油門或煞車。';this.changed();}
  }else if(m.type==='error'){this.message=typeof m.message==='string'?m.message.slice(0,150):'拉力指令未完成';const code=typeof m.code==='string'?m.code:'';this.rejectJoin(this.message,code?new CityResumeError(this.message,code==='SEAT_BUSY'?'retryable':'fatal',code):Error(this.message));this.changed();}
  else if(m.type==='left'||m.type==='expired'){this.message=typeof m.message==='string'?m.message.slice(0,150):'已離開拉力房';this.disconnect(false);}
 }
 private request(fields:Record<string,unknown>){return new Promise<void>((resolve,reject)=>{if(this.joining){reject(Error('正在進入拉力房'));return;}const timer=setTimeout(()=>{this.joining=null;reject(Error('進房逾時，請取消後再手動續接'));},8000);this.joining={resolve,reject,timer};if(!this.send({...fields,v:FRONTIER_RALLY_VERSION,...(this.aurora?{auroraRally:AURORA_RALLY_VERSION}:{}),...(this.navigatorSupported?{navigatorVersion:MERIDIAN_NAVIGATOR_VERSION}:{})}))this.rejectJoin('拉力連線尚未就緒');});}
 async enter(kind:'create'|'join'|'resume',name='',code='',average:RallyAverage=36,coursePlan?:RallyPlan,navigator=false){
  if(this.room||this.status==='connecting')throw Error('請先離開目前拉力房');if(kind==='resume'){if(!this.seat)throw Error('沒有原拉力席位');this.auto.cancel('改為手動續接');this.consent=true;this.ensureKey();const seat={...this.seat};this.joinKind='resume';await this.connect();const generation=this.generation;try{await this.request({type:'resume',code:seat.code,selfId:seat.selfId,token:seat.token,resumeKey:seat.resumeKey});if(generation!==this.generation||!this.room||this.selfId!==seat.selfId)throw Error('手動續接已取消');this.auto.restored();}catch(e){if(generation===this.generation)this.abortTransport();throw e;}return;}
  if(coursePlan&&!parseRallyPlan(coursePlan))throw Error('分段均速或路線無效');this.auto.reset();this.consent=false;this.joinKind=kind;await this.connect();if(navigator&&!this.navigatorSupported)throw Error('伺服器尚未支援雙人領航');await this.request(kind==='create'?{type:kind,name,average,...(navigator?{navigator:true}:{}),...(coursePlan?{coursePlan}:{} )}:{type:kind,name,code});this.message=(this.room as RallyRoom|null)?.navigator?'雙人領航拉力：司機負責共用車，領航員使用路書傳送指示；共同完賽與罰分。':'全員使用同車、晴天與相同起點；友車穿透，依序通過四個計時點。';
 }
 command(type:'ready'|'start'|'again',ready=true){const r=this.room;if(this.controlGated||!r||this.status!=='connected')return false;return this.send({type,revision:r.revision,matchId:r.matchId,map:r.definition.map,...type==='ready'?{ready}:{}});}
 navigatorCall(code:NavigatorCall){const r=this.room,p=r?.players.find(p=>p.id===this.selfId);return !!r?.navigator&&p?.slot===r.navigator.navigatorSlot&&!r.navigator.paused&&!this.controlGated&&r.phase==='racing'&&this.send({type:'navigator-call',matchId:r.matchId,revision:r.revision,seq:r.navigator.calls+1,code,navigatorVersion:MERIDIAN_NAVIGATOR_VERSION});}
 input(value:RallyInput):number|null{const r=this.room,p=r?.players.find(p=>p.id===this.selfId);if(this.controlGated||!r||!p||r.navigator&&(r.navigator.paused||p.slot!==r.navigator.driverSlot)||p.dnf||p.finishMs!==null||r.phase!=='racing'||this.status!=='connected')return null;const seq=this.seq+1;if(!this.send({type:'input',matchId:r.matchId,revision:r.revision,motionRevision:p.motionRevision,seq,steer:value.steer,throttle:value.throttle,brake:value.brake,handbrake:value.handbrake,active:value.active!==false}))return null;this.seq=seq;return seq;}
 checkConnection(){if(typeof document!=='undefined'&&document.hidden||this.status!=='connected'||!this.room||Date.now()-this.lastStateAt<=3500)return;this.consent=true;this.message='權威快照已停更，停止操控並續接原席位。';this.abortTransport();this.auto.start();}
 confirmReconnect(){const r=this.room,p=r?.players.find(p=>p.id===this.selfId);if(!this.controlGated||!r||!p||!this.seat?.resumeKey||this.confirmation||this.status!=='connected')return false;const sent=this.send({type:'confirm-resume',code:r.code,selfId:this.selfId,matchId:r.matchId,revision:r.revision,motionRevision:p.motionRevision,resumeKey:this.seat.resumeKey});if(sent){this.confirmation=setTimeout(()=>{this.confirmation=null;this.message='尚未收到確認回覆，可手動再按確認；操控仍停止。';this.changed();},2000);this.changed();}return false;}
 cancelReconnect(){this.auto.cancel('已取消自動續接；原期限內仍可手動續接。');}
 leave(){this.send({type:'leave'});this.disconnect(false);}
 disconnect(keepSeat=true){this.abortTransport();this.auto.reset();this.consent=false;this.status='idle';if(!keepSeat){this.seat=null;this.save();}this.changed();}
 dispose(){if(this.disposed)return;this.disconnect();this.disposed=true;this.auto.dispose();}
}
