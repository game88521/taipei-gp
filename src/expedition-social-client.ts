import {SOCIAL_VERSION,SOCIAL_WATCH_VERSION,SOCIAL_AUTO_RESUME_VERSION,parseSocialRoom,parseSocialWatch,socialCode,type SocialRoom,type SocialWatchRoom,type SocialMode,type SocialWeather,type SocialInput,type SocialManagement} from '../shared/expedition-social';
import {CITY_REPLAY_VERSION,parseCityReplayDescriptor,type CityReplayDescriptor} from '../shared/frontier-city-replay';
import {CityReplayDownload} from './frontier-city-replay-client';
import {CityAutoResume,CityResumeError} from './frontier-city-reconnect';
import {CONVOY_VERSION,type ConvoyRouteId} from '../shared/frontier-convoy';
import {CROWN_VERSION} from '../shared/frontier-crown';
import {PARTY_VERSION} from '../shared/aurora-social';
import {MeridianCheckpointClient} from './meridian-checkpoint-client';
import {MERIDIAN_ROTATION_VERSION} from '../shared/meridian-social';
import {MERIDIAN_CHECKPOINT_VERSION} from '../shared/meridian-checkpoints';
export const SOCIAL_SEAT_KEY='taipei-gp-expedition-social-seat-v1';
interface Seat {endpoint:string;code:string;selfId:string;token:string}
export function socialEndpoint(config:string,location:Pick<Location,'hostname'|'protocol'>) {
  try{
    if(config.trim()){const u=new URL(config.trim());if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||location.protocol==='https:'&&u.protocol!=='wss:')return '';u.pathname='/city-social';return u.href;}
    if(location.protocol==='http:'&&/^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname))return 'ws://'+location.hostname+':4320/city-social';
  }catch{}
  return '';
}
export class ExpeditionSocialClient {
  room:SocialRoom|null=null;watchRoom:SocialWatchRoom|null=null;selfId='';status:'idle'|'connecting'|'connected'|'closed'='idle';message='';lastExit:''|'removed'|'expired'='';
  replay:CityReplayDescriptor|null=null;private replayDownload=new CityReplayDownload(m=>this.send(m),()=>this.changed());
  readonly checkpoints:MeridianCheckpointClient;rotationSupported=false;checkpointSupported=false;
  capabilitiesKnown=false;watchSupported=false;replaySupported=false;autoResumeSupported=false;convoySupported=false;crownSupported=false;partySupported=false;
  private ws:WebSocket|null=null;private generation=0;private seq=0;private epoch=-1;private offset=0;private seat:Seat|null=null;
  private connecting:Promise<void>|null=null;private cancelOpen:(()=>void)|null=null;private watcherSession=false;
  private autoResume:CityAutoResume;private resumeEpisode=0;private resumeKey:string|null=null;private manualConsent=false;private joinKind='';
  private lastStateAt=0;
  private joining:{resolve():void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}|null=null;
  constructor(readonly endpoint:string,private changed:()=>void,private storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>|null=null){
    this.checkpoints=new MeridianCheckpointClient(endpoint,m=>this.send(m),()=>this.changed());
    try{const raw=storage?.getItem(SOCIAL_SEAT_KEY);if(raw&&raw.length<1500){const v=JSON.parse(raw);if(v.endpoint===endpoint&&socialCode(v.code)&&/^[a-f0-9]{20}$/.test(v.selfId)&&/^[a-f0-9]{64}$/.test(v.token))this.seat=v;}}catch{}
    this.autoResume=new CityAutoResume({resume:(signal,context)=>this.autoResumeAttempt(signal,context),abortTransport:()=>this.abortTransport(),eligible:()=>!!this.seat&&!this.watcherSession&&!this.lastExit,changed:()=>this.changed(),visible:()=>typeof document==='undefined'||!document.hidden});
  }
  get reconnectState(){return this.autoResume.state;}
  get controlGated(){return this.manualConsent||this.autoResume.gated;}
  wakeReconnect(){this.autoResume.wake();}
  /** Called by the existing render loop; no polling timer and no new attempts while hidden. */
  checkConnection(){if(typeof document!=='undefined'&&document.hidden||this.status!=='connected'||!(this.room||this.watchRoom)||Date.now()-this.lastStateAt<=3500)return;const watching=this.watching,canAuto=this.autoResumeSupported;if(watching){this.lastExit='expired';this.message='觀戰資料已停更，已停止跟車；可重新觀戰。';this.disconnect(false);return;}this.manualConsent=true;this.message='房間資料已停更，已停止操控並確認原席位連線。';this.abortTransport();if(canAuto)this.autoResume.start();this.changed();}
  cancelReconnect(){this.autoResume.cancel('已取消自動續接；原席位可在剩餘期限內手動續接。');}
  confirmReconnect(){const r=this.room,p=r?.players.find(p=>p.id===this.selfId);if(!this.controlGated||!r||!p||this.status!=='connected')return false;if(!this.autoResumeSupported){this.manualConsent=false;this.autoResume.reset();this.resumeKey=null;this.changed();return true;}return this.send({type:'confirm-resume',code:r.code,selfId:p.id,resumeKey:this.resumeKey,runId:r.runId,epoch:p.epoch});}
  private async autoResumeAttempt(signal:AbortSignal,context:{episode:number;attempt:number;deadline:number}){
    if(context.episode!==this.resumeEpisode||!this.resumeKey){const bytes=new Uint8Array(12);globalThis.crypto.getRandomValues(bytes);this.resumeKey=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');this.resumeEpisode=context.episode;}
    if(!this.seat||signal.aborted)throw new CityResumeError('原席位已取消。','fatal','SEAT_REJECTED');const seat={...this.seat};
    const abort=()=>this.abortTransport();signal.addEventListener('abort',abort,{once:true});
    try{await this.connect();if(!this.autoResumeSupported)throw new CityResumeError('伺服器尚未宣告安全自動續接，請更新後端或手動續接。','fatal','VERSION_MISMATCH');if(signal.aborted)throw Error('本次續接已取消');const generation=this.generation;this.joinKind='resume';this.manualConsent=true;await this.join({type:'resume',code:seat.code,selfId:seat.selfId,token:seat.token,resumeKey:this.resumeKey});if(signal.aborted||generation!==this.generation||this.status!=='connected'||!this.room||this.selfId!==seat.selfId)throw Error('本次續接回應已失效或連線已中斷。');}
    finally{signal.removeEventListener('abort',abort);}
  }
  /** A retry abort invalidates transport generations but keeps the episode key and original private seat. */
  private abortTransport(){++this.generation;this.cancelOpen?.();this.cancelOpen=null;this.connecting=null;this.rejectJoin('本次續接連線已停止');const ws=this.ws;this.ws=null;try{ws?.close();}catch{}this.room=null;this.watchRoom=null;this.replay=null;this.selfId='';this.status='closed';this.seq=0;this.epoch=-1;this.replayDownload.cancel('連線停止，已取消城市回放下載。');this.changed();}
  get resumable(){return !!this.seat&&!this.room&&!this.watchRoom&&!this.watcherSession;}
  get watching(){return !!this.watchRoom;}
  get replayBusy(){return this.replayDownload.busy;}
  downloadReplay(){if(!this.replaySupported)return Promise.reject(Error('伺服器尚未宣告城市回放能力，請更新後端。'));if((this.room??this.watchRoom)?.phase!=='finished'||!this.replay)return Promise.reject(Error('本場結束後才可下載城市回放。'));return this.replayDownload.start(this.replay);}
  cancelReplay(){this.replayDownload.cancel();}
  serverNow(){return Date.now()+this.offset;}
  private save(){try{if(this.seat)this.storage?.setItem(SOCIAL_SEAT_KEY,JSON.stringify(this.seat));else this.storage?.removeItem(SOCIAL_SEAT_KEY);}catch{}}
  connect():Promise<void>{
    if(this.status==='connected'&&this.ws?.readyState===1)return Promise.resolve();
    if(this.connecting)return this.connecting;
    if(!this.endpoint)return Promise.reject(Error('城市新玩法服務尚未設定。'));
    const generation=++this.generation;this.lastExit='';this.capabilitiesKnown=false;this.rotationSupported=this.checkpointSupported=false;this.watchSupported=this.replaySupported=this.autoResumeSupported=this.convoySupported=this.crownSupported=this.partySupported=false;this.status='connecting';this.changed();
    this.connecting=new Promise((resolve,reject)=>{
      const socket=new WebSocket(this.endpoint);this.ws=socket;let opened=false,settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(this.generation===generation){this.connecting=null;this.cancelOpen=null;}if(error)reject(error);else resolve();};
      const timer=setTimeout(()=>{finish(Error('城市服務連線逾時，請稍後再試。'));socket.close();},12000);
      this.cancelOpen=()=>finish(Error('已取消城市連線'));
      socket.addEventListener('message',event=>{
        if(this.ws!==socket||generation!==this.generation||typeof event.data!=='string'||event.data.length>64*1024)return;
        let m:Record<string,unknown>;try{m=JSON.parse(event.data);if(!m||typeof m!=='object'||Array.isArray(m))return;}catch{return;}
        if(m.type!=='city-replay-part'&&event.data.length>32*1024)return;
        if(m.type==='hello'){if(m.v!==SOCIAL_VERSION){finish(new CityResumeError('城市新玩法需要配套更新伺服器。','fatal','VERSION_MISMATCH'));socket.close();return;}const caps=m.capabilities as Record<string,unknown>|undefined;this.capabilitiesKnown=true;this.watchSupported=caps?.cityWatchVersion===SOCIAL_WATCH_VERSION;this.replaySupported=caps?.cityReplayVersion===CITY_REPLAY_VERSION;this.autoResumeSupported=caps?.autoResumeVersion===SOCIAL_AUTO_RESUME_VERSION;this.convoySupported=caps?.convoyVersion===CONVOY_VERSION;this.crownSupported=caps?.crownVersion===CROWN_VERSION;this.partySupported=caps?.partyVersion===PARTY_VERSION;this.rotationSupported=caps?.rotationVersion===MERIDIAN_ROTATION_VERSION;this.checkpointSupported=caps?.checkpointVersion===MERIDIAN_CHECKPOINT_VERSION;opened=true;this.status='connected';finish();this.changed();}
        else if(opened)this.receive(m);
      });
      socket.addEventListener('close',()=>{if(this.ws!==socket||generation!==this.generation)return;const watching=this.watching,driver=!!this.room&&!!this.selfId,canAuto=this.autoResumeSupported;this.ws=null;this.status='closed';finish(Error('城市連線已中斷'));this.rejectJoin(watching?'觀戰連線已中斷，請重新觀戰。':'城市連線已中斷，可於15秒內續接原席位。');this.message=watching?'觀戰連線已中斷，請重新觀戰。':canAuto?'連線中斷，已停止輸入；將在15秒期限內嘗試恢復原席。':'連線中斷；此後端尚未宣告安全自動續接，可手動續接並確認操控。';this.room=null;this.watchRoom=null;this.replay=null;this.watcherSession=false;if(watching)this.lastExit='expired';if(driver)this.manualConsent=true;this.replayDownload.cancel('連線中斷，已取消城市回放下載。');if(driver&&canAuto&&!watching&&!this.lastExit)this.autoResume.start();this.changed();});
      socket.addEventListener('error',()=>{if(!opened){finish(Error('無法連到城市新玩法服務，請確認服務版本與來源設定。'));socket.close();}});
    });return this.connecting;
  }
  private rejectJoin(text:string,error:Error=Error(text)){if(this.joining){clearTimeout(this.joining.timer);this.joining.reject(error);this.joining=null;}}
  private receive(m:Record<string,unknown>){
    if(this.checkpoints.receive(m)||this.replayDownload.receive(m))return;
    if(m.type==='watch-welcome'||m.type==='watch-state'){
      const room=parseSocialWatch(m.room);if(!room||room.mode==='convoy'&&!this.convoySupported||room.mode==='crown'&&!this.crownSupported||m.type==='watch-state'&&(!this.watchRoom||this.watchRoom.code!==room.code||room.serverTime<this.watchRoom.serverTime)){if(m.type==='watch-welcome'){this.message='觀戰資料無效，已停止連線。';this.disconnect();}return;}
      if(m.type==='watch-welcome'){this.lastExit='';this.selfId='';this.room=null;if(this.joining){clearTimeout(this.joining.timer);this.joining.resolve();this.joining=null;}}
      this.watchRoom=room;this.lastStateAt=Date.now();this.replay=parseCityReplayDescriptor(m.replay);this.replayDownload.observe(this.replay);this.offset=room.serverTime-Date.now();this.changed();
    }else if(m.type==='welcome'||m.type==='room'){
      const room=parseSocialRoom(m.room);
      if(!room||room.mode==='convoy'&&!this.convoySupported||room.mode==='crown'&&!this.crownSupported||m.type==='welcome'&&(typeof m.selfId!=='string'||!room.players.some(p=>p.id===m.selfId)||typeof m.token!=='string'||!/^[a-f0-9]{64}$/.test(m.token))){this.disconnect(false);this.message='城市服務回傳無效資料，已停止連線。';this.changed();return;}
      if(m.type==='welcome'){this.lastExit='';this.message='';if(this.joinKind==='resume')this.manualConsent=true;this.selfId=String(m.selfId);this.seat={endpoint:this.endpoint,code:room.code,selfId:this.selfId,token:String(m.token)};this.save();this.seq=0;this.epoch=-1;}
      else if(!this.room||this.room.code!==room.code||room.serverTime<this.room.serverTime)return;
      if(!room.players.some(p=>p.id===this.selfId)){this.disconnect();this.message='原席位已釋放，請重新加入。';this.changed();return;}
      this.room=room;this.lastStateAt=Date.now();this.replay=parseCityReplayDescriptor(m.replay);this.replayDownload.observe(this.replay);this.offset=room.serverTime-Date.now();const self=room.players.find(p=>p.id===this.selfId)!;
      if(this.epoch!==self.epoch){this.epoch=self.epoch;this.seq=self.ack;}
      if(m.type==='welcome'&&this.joining){clearTimeout(this.joining.timer);this.joining.resolve();this.joining=null;}
      this.changed();
    }else if(m.type==='resume-confirmed'){const p=this.room?.players.find(p=>p.id===this.selfId);if(Object.keys(m).length===3&&m.runId===this.room?.runId&&m.epoch===p?.epoch){this.manualConsent=false;this.resumeKey=null;this.message='已確認恢復操控。';if(!this.autoResume.confirm())this.autoResume.reset();this.changed();}}
    else if(m.type==='error'){this.message=typeof m.message==='string'?m.message.slice(0,150):'城市指令未完成';const code=typeof m.code==='string'?m.code:'';this.rejectJoin(this.message,code?new CityResumeError(this.message,code==='SEAT_BUSY'?'retryable':'fatal',code):Error(this.message));this.replayDownload.cancel(this.message);this.changed();}
    else if(m.type==='removed'||m.type==='expired'||m.type==='left'){this.lastExit=m.type==='left'?'':m.type;this.message=typeof m.message==='string'&&m.message.trim()?m.message.slice(0,150):m.type==='removed'?'房主已將你移出這次房間；原席位已清除。':m.type==='expired'?'城市房間已到期；原席位已清除。':'已離開城市房間';this.disconnect();}
  }
  private send(m:unknown){if(this.ws?.readyState!==1||this.ws.bufferedAmount>32768)return false;this.ws.send(JSON.stringify(m));return true;}
  private join(fields:Record<string,unknown>){return new Promise<void>((resolve,reject)=>{if(this.joining){reject(Error('正在加入房間'));return;}const timer=setTimeout(()=>{this.joining=null;reject(Error('進房逾時，請取消後手動續接，避免重複建房。'));},10000);this.joining={resolve,reject,timer};if(!this.send({...fields,v:SOCIAL_VERSION,...this.convoySupported&&fields.type!=='watch'?{convoyVersion:CONVOY_VERSION}:{},...this.crownSupported&&fields.type!=='watch'?{crownVersion:CROWN_VERSION}:{},...this.partySupported&&fields.type!=='watch'?{partyVersion:PARTY_VERSION}:{},...this.rotationSupported&&fields.type!=='watch'?{rotationVersion:MERIDIAN_ROTATION_VERSION}:{}})){this.rejectJoin('城市連線未就緒');}});}
  async enter(type:'create'|'join',name:string,vehicle:string,mode:SocialMode,weather:SocialWeather,code='',convoyRoute:ConvoyRouteId='south-loop',rotation=false){if(this.room||this.watchRoom)throw Error('請先離開目前房間');this.autoResume.reset();this.manualConsent=false;this.resumeKey=null;this.joinKind=type;this.watcherSession=false;await this.connect();if(type==='create'&&mode==='convoy'&&!this.convoySupported)throw Error('伺服器尚未宣告車隊巡遊能力，請更新後端。');if(type==='create'&&mode==='crown'&&!this.crownSupported)throw Error('伺服器尚未宣告移動王冠能力，請更新後端。');if(type==='create'&&rotation&&!this.rotationSupported)throw Error('伺服器尚未支援三四人輪賽');await this.join({type,name,vehicle,mode,weather,code,...type==='create'&&rotation?{rotation:true}:{},...type==='create'&&mode==='convoy'?{convoyRoute}:{}});}
  exportCheckpoint(){const r=this.room;return !!r&&this.checkpointSupported&&!this.controlGated&&this.send({type:'checkpoint-export',revision:r.revision,runId:r.runId});}
  async restoreCheckpoint(ticket:string){if(this.room||this.watchRoom)throw Error('請先離開目前房間');const proof=this.checkpoints.proof(ticket,'party');if(!proof)throw Error(this.checkpoints.message);this.autoResume.reset();this.manualConsent=false;this.joinKind='checkpoint';this.watcherSession=false;await this.connect();if(!this.checkpointSupported)throw Error('伺服器尚未支援站間續局');await this.join({type:'checkpoint-restore',...proof});}
  async watch(code:string){if(this.room||this.watchRoom)throw Error('請先離開目前房間');this.autoResume.reset();this.manualConsent=false;this.joinKind='watch';this.watcherSession=true;await this.connect();if(!this.watchSupported)throw Error('伺服器尚未宣告觀戰能力，請更新後端。');await this.join({type:'watch',code});}
  follow(slot:number){const r=this.watchRoom;return !!r&&this.send({type:'follow',code:r.code,runId:r.runId,slot});}
  async resume(){if(!this.seat)throw Error('沒有可續接的席位');this.autoResume.cancel('改由手動續接，先前自動嘗試已停止。');this.manualConsent=true;this.joinKind='resume';this.watcherSession=false;const seat={...this.seat},connection=this.connect(),generation=this.generation;try{await connection;await this.join({type:'resume',code:seat.code,selfId:seat.selfId,token:seat.token,...this.resumeKey?{resumeKey:this.resumeKey}:{}});if(generation!==this.generation||!this.room||this.selfId!==seat.selfId)throw Error('手動續接已取消或席位已更新。');this.autoResume.restored();}catch(error){if(generation===this.generation){this.manualConsent=true;this.abortTransport();this.message=error instanceof Error?error.message:'手動續接未成功；原期限內可再試或離房。';this.changed();}throw error;}}
  command(type:'ready'|'start'|'again'|'mark'|'recover'|'configure',fields:Record<string,unknown>={}){if(this.controlGated||!this.room||this.status!=='connected')return false;return this.send({...fields,type,...type==='configure'?{}:{revision:this.room.revision}});}
  party(type:'party-enable'|'party-vote'|'party-next'|'party-end'|'party-finish',fields:Record<string,unknown>={}){const r=this.room;if(!this.partySupported||this.controlGated||!r||this.status!=='connected')return false;return this.send({...fields,type,revision:r.revision,runId:r.runId});}
  /** Send the captured intent unchanged. A changed host/roster must require a fresh confirmation. */
  manage(intent:SocialManagement){if(this.controlGated||!this.room||this.status!=='connected')return false;return this.send({...intent,type:'manage'});}
  input(value:SocialInput){const p=this.room?.players.find(p=>p.id===this.selfId);if(this.controlGated||!p||this.room?.rotation&&(this.room.rotation.paused||p.role==='driver')||this.room?.phase!=='running'||this.status!=='connected')return null;
    const seq=this.seq+1;if(!this.send({...value,type:'input',seq,epoch:p.epoch,runId:this.room.runId}))return null;this.seq=seq;return seq;}
  leave(){this.lastExit='';if(this.room||this.watchRoom)this.send({type:'leave'});this.disconnect();}
  disconnect(clearSeat=true){
    ++this.generation;this.cancelOpen?.();this.cancelOpen=null;this.connecting=null;this.rejectJoin('已取消城市進房');const ws=this.ws;this.ws=null;try{ws?.close();}catch{}
    // Reset may synchronously abort an in-flight resume. Finish owner cleanup afterwards,
    // so a late welcome or abort callback cannot replace this explicit idle state.
    this.autoResume.reset();const preserveSeat=this.watcherSession;this.watcherSession=false;this.room=null;this.watchRoom=null;this.replay=null;this.selfId='';this.status='idle';this.seq=0;this.epoch=-1;this.manualConsent=false;if(clearSeat&&!preserveSeat){this.seat=null;this.resumeKey=null;this.save();}this.replayDownload.cancel('已離開房間，城市回放下載已取消。');this.changed();
  }
  dispose(){this.disconnect();this.autoResume.dispose();}
}
