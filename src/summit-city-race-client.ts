import { CITY_RACE_VERSION, CITY_RACE_KEY, parseCityRaceRoom, type CityRaceRoom, type CityRaceInput } from '../shared/summit-city-race';
import { coopEndpoint } from './nexus-coop-client';
type Seat = { endpoint:string; code:string; selfId:string; token:string };
export function cityRaceEndpoint(config:string,location:Pick<Location,'hostname'|'protocol'>){const value=coopEndpoint(config,location);if(!value)return '';const url=new URL(value);url.pathname='/city-race';return url.href;}
export class SummitCityRaceClient {
  room:CityRaceRoom|null=null;selfId='';status='idle';message='';
  private socket:WebSocket|null=null;private generation=0;private seat:Seat|null=null;private timer:ReturnType<typeof setTimeout>|null=null;private pendingCancel:(()=>void)|null=null;private seq=0;private offset=0;
  private retry:ReturnType<typeof setTimeout>|null=null;private retryUntil=0;private wanted=false;private retryAttempt=0;
  constructor(readonly endpoint:string,private changed:()=>void,private validate:(room:CityRaceRoom)=>void,private storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>|null){try{const v=JSON.parse(storage?.getItem(CITY_RACE_KEY)??'null') as Seat|null;if(v?.endpoint===endpoint&&/^[A-HJ-NP-Z2-9]{6}$/.test(v.code)&&/^[a-f0-9]{20}$/.test(v.selfId)&&/^[a-f0-9]{64}$/.test(v.token))this.seat=v;}catch{}}
  get resumable(){return !!this.seat&&this.status!=='connected'&&this.status!=='connecting'&&this.status!=='reconnecting';}
  get retryRemainingMs(){return this.retryUntil?Math.max(0,this.retryUntil-Date.now()):0;}
  serverNow(){return Date.now()+this.offset;}
  private send(m:unknown){if(this.socket?.readyState!==1||this.socket.bufferedAmount>32768)return false;this.socket.send(JSON.stringify(m));return true;}
  async enter(kind:'create'|'join'|'resume',name='',code='',challenge='',collisions=false):Promise<void>{
    if(this.status==='connecting'||this.room&&kind!=='resume')throw Error('請先離開目前城市競速房');if(!this.endpoint)throw Error('城市競速服務尚未設定');if(kind==='resume'&&!this.seat)throw Error('沒有可續接席位');
    this.wanted=true;return this.open(kind,name,code,challenge,collisions);
  }
  private open(kind:'create'|'join'|'resume',name='',code='',challenge='',collisions=false):Promise<void>{
    const generation=++this.generation;this.status=this.retryUntil?'reconnecting':'connecting';this.message=this.retryUntil?'正在自動續接原席位；賽事繼續，未連線時自車煞停。':'正在連線城市競速服務…';this.changed();
    return new Promise((resolve,reject)=>{let settled=false,opened=false,admitted=false;const socket=new WebSocket(this.endpoint);this.socket=socket;
      const finish=(error?:Error)=>{if(settled)return;settled=true;if(this.timer)clearTimeout(this.timer);this.timer=null;this.pendingCancel=null;error?reject(error):resolve();};this.pendingCancel=()=>finish(new Error('已取消城市競速連線'));
      const fail=(error:Error,terminal=false)=>{this.message=error.message;finish(error);if(terminal){this.wanted=false;this.stopRetry();this.room=null;this.status='closed';}socket.close();this.changed();};
      this.timer=setTimeout(()=>fail(new Error('城市競速服務尚未回應；可取消或稍後重試。')),Math.min(8000,this.retryUntil?Math.max(100,this.retryUntil-Date.now()):8000));
      socket.onmessage=event=>{if(this.socket!==socket||generation!==this.generation||typeof event.data!=='string'||event.data.length>2*1024*1024)return;let m:Record<string,unknown>;try{m=JSON.parse(event.data);if(!m||typeof m!=='object')return;}catch{return;}
        if(m.type==='hello'){if(opened)return;if(m.v!==CITY_RACE_VERSION){fail(new Error('城市競速版本不相容，請更新前後端後重新加入。'),true);return;}opened=true;this.send({type:kind,v:CITY_RACE_VERSION,name,code,challenge,collisions,...kind==='resume'?{code:this.seat!.code,selfId:this.seat!.selfId,token:this.seat!.token}:{}});}
        else if(opened&&!settled&&m.type==='welcome'){
          try{const room=parseCityRaceRoom(m.room);if(!room||typeof m.selfId!=='string'||!room.players.some(p=>p.id===m.selfId)||typeof m.token!=='string'||!/^[a-f0-9]{64}$/.test(m.token))throw Error('城市競速席位資料無效');this.validate(room);this.room=room;this.selfId=m.selfId;this.seq=room.players.find(p=>p.id===this.selfId)!.ack;this.offset=room.serverTime-Date.now();this.seat={endpoint:this.endpoint,code:room.code,selfId:this.selfId,token:m.token};try{this.storage?.setItem(CITY_RACE_KEY,JSON.stringify(this.seat));}catch{}admitted=true;this.stopRetry();this.status='connected';this.message=m.resumed?'已續接原城市競速席位。':'已確認真路網與相同路層；本房由伺服器計算車況及成績。';finish();this.changed();}catch(e){fail(e as Error,true);}
        }else if(opened&&(m.type==='room'||m.type==='state')){
          if(m.type==='state'&&(!m.room||typeof m.room!=='object'||'route' in m.room||'definition' in m.room||'v' in m.room))return;
          const raw=m.type==='state'&&this.room?{...this.room,...m.room as object}:m.room,room=parseCityRaceRoom(raw);if(!room||!this.room||room.code!==this.room.code||room.serverTime<this.room.serverTime||!room.players.some(p=>p.id===this.selfId)||m.type==='state'&&(room.revision!==this.room.revision||room.matchId!==this.room.matchId))return;
          try{if(m.type==='room')this.validate(room);if(room.matchId!==this.room.matchId||room.revision!==this.room.revision)this.seq=room.players.find(p=>p.id===this.selfId)!.ack;this.room=room;this.offset=room.serverTime-Date.now();this.changed();}catch{fail(new Error('城市競速路線版本不一致，已中止連線。'),true);}
        }else if(m.type==='error'){this.message=String(m.message??'城市競速指令失敗').slice(0,180);if(!admitted)fail(new Error(this.message),true);else this.changed();}
        else if(m.type==='left'||m.type==='expired'){this.leave();}
      };
      socket.onclose=()=>{if(this.socket!==socket||generation!==this.generation)return;finish(new Error('城市競速連線中斷'));this.socket=null;if(this.wanted&&this.seat&&(admitted||this.retryUntil)){if(!this.retryUntil)this.retryUntil=Date.now()+14500;this.status='reconnecting';this.scheduleRetry();}else if(this.status!=='closed')this.status='closed';this.changed();};
      socket.onerror=()=>{if(!admitted){this.message='無法連線城市競速服務；瀏覽器未提供原因，請確認服務狀態、網路與來源設定。';finish(new Error(this.message));socket.close();}};
    });
  }
  private scheduleRetry(){
    if(!this.wanted||!this.seat||this.retry)return;if(Date.now()>=this.retryUntil){this.wanted=false;this.stopRetry();this.room=null;this.status='closed';this.message='15秒原席保留期已結束，請重新加入房間。';this.changed();return;}
    this.message='連線中斷，正在自動續接（最多15秒）；賽事不暫停，可取消並離房。';const wait=Math.min(500+this.retryAttempt++*350,1500,this.retryUntil-Date.now());
    this.retry=setTimeout(()=>{this.retry=null;if(!this.wanted)return;if(Date.now()>=this.retryUntil){this.scheduleRetry();return;}void this.open('resume').catch(()=>{if(this.wanted){this.status='reconnecting';this.scheduleRetry();}});},wait);
  }
  private stopRetry(){if(this.retry)clearTimeout(this.retry);this.retry=null;this.retryUntil=0;this.retryAttempt=0;}
  command(type:'ready'|'start'|'again'|'recover',ready=true){const r=this.room;if(!r||this.status!=='connected')return false;return this.send({type,revision:r.revision,matchId:r.matchId,map:r.definition.map,ready});}
  input(input:CityRaceInput):number|null{const r=this.room,p=r?.players.find(p=>p.id===this.selfId);if(!r||!p||p.dnf||p.finishMs!==null||r.phase!=='racing'||this.status!=='connected')return null;const seq=this.seq+1;if(!this.send({type:'input',matchId:r.matchId,revision:r.revision,motionRevision:p.motionRevision,seq,...input}))return null;this.seq=seq;return seq;}
  leave(){this.send({type:'leave'});this.cancel(false);try{this.storage?.removeItem(CITY_RACE_KEY);}catch{}this.changed();}
  cancel(keepSeat=true){this.wanted=false;this.stopRetry();this.pendingCancel?.();this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=null;this.socket?.close();this.socket=null;this.room=null;this.selfId='';this.status='idle';if(!keepSeat)this.seat=null;this.changed();}
}
