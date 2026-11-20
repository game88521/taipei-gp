import {randomBytes,timingSafeEqual} from 'node:crypto';
import {FreeCar,ROAD_Y,streetContact} from './summit-city-physics.mjs';
import {realCityWorld} from './summit-city-race-service.mjs';
import {SOCIAL_VERSION,SOCIAL_MODES,SOCIAL_VEHICLES,SOCIAL_GRACE_MS,SOCIAL_MAX_WATCHERS,SOCIAL_WATCH_DELAY_MS,SOCIAL_WATCH_VERSION,SOCIAL_AUTO_RESUME_VERSION,socialCode,socialManageable,socialCooperative,captureEligible,tandemQuality} from '../shared/expedition-social.ts';
import {CONVOY_VERSION} from '../shared/frontier-convoy.ts';
import {createConvoy,resetConvoy,resetConvoyPlayer,convoySnapshot,stepConvoy} from './frontier-convoy-service.mjs';
import {CROWN_VERSION,CROWN_DURATION_MS} from '../shared/frontier-crown.ts';
import {createCrown,resetCrown,crownSnapshot,finishCrown,stepCrown} from './frontier-crown-service.mjs';
import {COOP_STATIONS} from '../shared/nexus-coop.ts';
import {CityReplayRecorder} from './frontier-city-replay-service.mjs';
import {CITY_REPLAY_VERSION} from '../shared/frontier-city-replay.ts';
const id=n=>randomBytes(n).toString('hex'),obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const idle=()=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
const seatError=(code,message)=>Object.assign(Error(message),{code});
const tokenMatches=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const seatExpires=p=>p.resumeGrant?.expiresAt??p.resumeExpiresAt??((p.disconnectedAt??-Infinity)+SOCIAL_GRACE_MS);
const angle=h=>Math.atan2(Math.sin(h),Math.cos(h));
const pose=c=>({x:c.x,z:c.z,y:c.y,h:angle(c.h),vx:c.vx,vz:c.vz,w:c.w,vy:c.vy,steer:c.steer,pitch:c.pitch,roll:c.roll});
export class ExpeditionSocialService {
  constructor(o={}){this.now=o.now??Date.now;this.worldFactory=o.worldFactory??realCityWorld;this.worldRef=null;this.rooms=new Map();this.clients=new Set();this.maxRooms=o.maxRooms??3;this.maxClients=o.maxClients??48;this.closed=false;}
  world(){return this.worldRef??=this.worldFactory();}
  send(c,m){try{if(c.ws.readyState===1&&c.ws.bufferedAmount<262144)c.ws.send(JSON.stringify(m));else if(c.ws.bufferedAmount>=262144)c.ws.close(1013,'城市社交連線過慢');}catch{c.ws.terminate?.();}}
  accept(ws){
    if(this.closed||this.clients.size>=this.maxClients){ws.close(1013,'城市社交連線已滿');return null;}
    const c={ws,room:null,player:null,observer:false,followSlot:0,lastWatchAt:-Infinity,alive:true,window:this.now(),count:0};this.clients.add(c);this.send(c,{type:'hello',v:SOCIAL_VERSION,capabilities:{cityWatchVersion:SOCIAL_WATCH_VERSION,cityReplayVersion:CITY_REPLAY_VERSION,autoResumeVersion:SOCIAL_AUTO_RESUME_VERSION,convoyVersion:CONVOY_VERSION,crownVersion:CROWN_VERSION}});
    ws.on('pong',()=>c.alive=true);
    ws.on('message',bytes=>{if(this.closed||!this.clients.has(c))return;const now=this.now();if(now-c.window>=1000){c.window=now;c.count=0;}if(++c.count>90||bytes.length>4096){ws.close(1008,'訊息超限');return;}
      let m;try{m=JSON.parse(String(bytes));if(!obj(m)||typeof m.type!=='string')throw Error('訊息格式無效');this.receive(c,m,now);}catch(e){this.send(c,{type:'error',message:String(e.message).slice(0,150),...e.code?{code:e.code}:{}});}
    });ws.on('close',()=>this.drop(c));ws.on('error',()=>this.drop(c));return c;
  }
  receive(c,m,now=this.now()){
    if(m.type==='ping'){this.send(c,{type:'pong',sentAt:m.sentAt,serverTime:now});return;}
    if(m.type==='watch'){
      if(c.room)throw Error('請先離開目前房間');if(m.v!==SOCIAL_VERSION||!socialCode(m.code)||Object.keys(m).some(k=>!['type','v','code'].includes(k)))throw Error('觀戰房間或版本無效');
      const r=this.rooms.get(m.code);if(!r)throw Error('觀戰房間不存在');if(r.locked)throw Error('房主已鎖定新加入，目前不開放新觀眾');if(r.observers.size>=SOCIAL_MAX_WATCHERS)throw Error('觀眾已滿，最多四位');
      c.observer=true;c.room=r;c.followSlot=[...r.players.values()].find(p=>p.client)?.slot??0;r.observers.add(c);this.send(c,{type:'watch-welcome',room:this.watchSnapshot(r,c,now),replay:r.recorder.descriptor()});return;
    }
    if(['create','join','resume'].includes(m.type)){
      if(c.room)throw Error('請先離開目前房間');if(m.v!==SOCIAL_VERSION)throw seatError('VERSION_MISMATCH','城市新玩法版本不相容，請更新前後端');
      let r,p;
      if(m.type==='resume'){
        r=this.rooms.get(m.code);if(!r)throw seatError('ROOM_GONE','原房間已結束，請重新加入');p=r.players.get(m.selfId);
        if(r.convoy&&m.convoyVersion!==CONVOY_VERSION)throw seatError('VERSION_MISMATCH','車隊巡遊需要同步更新前後端');
        if(r.crown&&m.crownVersion!==CROWN_VERSION)throw seatError('VERSION_MISMATCH','移動王冠需要同步更新前後端');
        if(!p||p.outcome==='left'||m.resumeKey!==undefined&&(typeof m.resumeKey!=='string'||!/^[a-f0-9]{24}$/.test(m.resumeKey))||Object.keys(m).some(k=>!['type','v','code','selfId','token','endpoint','resumeKey','convoyVersion','crownVersion'].includes(k)))throw seatError('SEAT_REJECTED','原席位憑證或續接要求無效');
        const grant=p.resumeGrant,grantRetry=!!grant&&m.resumeKey===grant.key&&(tokenMatches(m.token,grant.oldToken)||tokenMatches(m.token,grant.newToken));
        if(grant?!grantRetry&&!(!m.resumeKey&&tokenMatches(m.token,grant.newToken)):!tokenMatches(m.token,p.token))throw seatError('SEAT_REJECTED','原席位憑證或續接批次不符');
        if(p.client)throw seatError('SEAT_BUSY','原席位仍在另一條連線，請等候釋放');
        const expiresAt=grant?.expiresAt??p.resumeExpiresAt??((p.disconnectedAt??-Infinity)+SOCIAL_GRACE_MS);
        if(p.disconnectedAt===null||now>expiresAt)throw seatError('SEAT_EXPIRED','席位保留期已過，請重新加入');
        if(!grantRetry){const oldToken=p.token,newToken=id(32);p.token=newToken;p.epoch++;p.resumeGrant=m.resumeKey?{key:m.resumeKey,oldToken,newToken,expiresAt}:null;}
        p.resumeExpiresAt=p.resumeGrant?.expiresAt??null;r.revision++;if(r.phase==='lobby')for(const q of r.players.values())q.ready=false;
      }else{
        if(typeof m.name!=='string'||!m.name.trim()||m.name.trim().length>20||/[\x00-\x1f\x7f<>]/.test(m.name))throw Error('暱稱請填1～20字');
        if(!SOCIAL_VEHICLES.includes(m.vehicle))throw Error('車款無效');
        if(m.type==='create'){
          if(this.rooms.size>=this.maxRooms)throw Error('城市社交房已滿');if(!SOCIAL_MODES.includes(m.mode)||!['dry','rain','night'].includes(m.weather))throw Error('玩法或天候無效');
          let code;do{code=Array.from(randomBytes(6),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');}while(this.rooms.has(code));
          if(m.mode==='convoy'&&m.convoyVersion!==CONVOY_VERSION)throw seatError('VERSION_MISMATCH','車隊巡遊需要同步更新前後端');
          if(m.mode==='crown'&&m.crownVersion!==CROWN_VERSION)throw seatError('VERSION_MISMATCH','移動王冠需要同步更新前後端');
          const convoy=m.mode==='convoy'?createConvoy(this.world().roads,m.convoyRoute):null;
          r={code,hostId:'',mode:m.mode,weather:m.weather,phase:'lobby',revision:1,locked:false,runId:id(12),round:0,leg:0,startAt:null,endsAt:null,reason:'',players:new Map(),observers:new Set(),watchHistory:[],recorder:new CityReplayRecorder({source:'social',mode:m.mode}),marks:[],updatedAt:now,simAt:now,lastBroadcast:0,convoy,crown:m.mode==='crown'?createCrown():null};this.rooms.set(code,r);
        }else{if(!socialCode(m.code))throw Error('請填六碼房間碼');r=this.rooms.get(m.code);if(!r||r.phase!=='lobby'&&!(r.mode==='cruise'&&r.phase==='running'))throw Error('房間不存在或正在比賽');if(r.locked)throw Error('房主已鎖定新加入；原席位仍可續接');if(r.convoy&&m.convoyVersion!==CONVOY_VERSION)throw seatError('VERSION_MISMATCH','車隊巡遊需要同步更新前後端');if(r.crown&&m.crownVersion!==CROWN_VERSION)throw seatError('VERSION_MISMATCH','移動王冠需要同步更新前後端');}
        if(r.players.size>=(r.mode==='tandem'?2:4))throw Error('房間已滿');
        const slot=[0,1,2,3].find(s=>![...r.players.values()].some(q=>q.slot===s));
        p={id:id(10),token:id(32),resumeGrant:null,resumeExpiresAt:null,lastConfirmedResume:null,name:m.name.trim(),slot,vehicle:m.vehicle,client:null,ready:false,car:new FreeCar(),role:'driver',input:idle(),queue:[],received:0,ack:0,epoch:0,lastInputAt:now,disconnectedAt:null,points:0,combo:0,maxCombo:0,captureMs:0,outcome:'',contactUntil:0,lastMarkAt:-Infinity,recoverAt:-Infinity};
        resetConvoyPlayer(p);r.players.set(p.id,p);if(!r.hostId)r.hostId=p.id;this.place(r,p);r.revision++;if(r.phase==='lobby')for(const q of r.players.values())q.ready=false;
      }
      p.client=c;p.disconnectedAt=null;p.input=idle();p.queue=[];p.received=p.ack;c.player=p;c.room=r;r.updatedAt=now;
      if(r.phase==='running'){this.record(r,now);r.recorder.event(now,m.type==='resume'?'reconnect':'join',[p.id]);}
      this.send(c,{type:'welcome',selfId:p.id,token:p.token,room:this.snapshot(r,now),replay:r.recorder.descriptor()});this.broadcast(r,now);return;
    }
    if(m.type==='city-replay-chunk'){
      const r=c.room;if(!r||r.phase!=='finished'||!c.observer&&(!c.player||c.player.client!==c)||c.observer&&!r.observers.has(c))throw Error('本場結束後，房內車手與觀眾才可取得回放');
      if(Object.keys(m).length!==3||Object.keys(m).some(k=>!['type','key','offset'].includes(k)))throw Error('回放分塊要求無效');
      if(c.ws.bufferedAmount>=262144)throw Error('回放連線忙碌，請稍後手動重試');this.send(c,r.recorder.part(m.key,m.offset));return;
    }
    if(c.observer){const r=c.room;if(!r||!r.observers.has(c))throw Error('請先加入觀戰');
      if(m.type==='leave'){r.observers.delete(c);c.room=null;c.observer=false;this.send(c,{type:'left'});return;}
      if(m.type==='follow'){
        if(Object.keys(m).length!==4||Object.keys(m).some(k=>!['type','code','runId','slot'].includes(k))||m.code!==r.code||m.runId!==r.runId||!Number.isInteger(m.slot)||![...r.players.values()].some(p=>p.slot===m.slot))throw Error('跟車目標或場次已更新');
        if(!socialCooperative(r.mode)&&['countdown','running'].includes(r.phase))throw Error('競技倒數與進行中固定跟車，不能切換查找其他車手');
        c.followSlot=m.slot;this.send(c,{type:'watch-state',room:this.watchSnapshot(r,c,now),replay:r.recorder.descriptor()});return;
      }
      throw Error('觀眾只能跟車與離開，不能操控、準備或管理房間');
    }
    const r=c.room,p=c.player;if(!r||!p||p.client!==c)throw Error('請先加入城市房間');r.updatedAt=now;
    if(m.type==='leave'){this.remove(c);return;}
    if(m.type==='confirm-resume'){
      const previous=p.lastConfirmedResume,validKey=p.resumeGrant?m.resumeKey===p.resumeGrant.key:m.resumeKey===null||previous&&previous.key===m.resumeKey&&previous.runId===r.runId&&previous.epoch===p.epoch;
      if(Object.keys(m).length!==6||Object.keys(m).some(k=>!['type','code','selfId','resumeKey','runId','epoch'].includes(k))||m.code!==r.code||m.selfId!==p.id||m.runId!==r.runId||m.epoch!==p.epoch||!validKey)throw seatError('SEAT_REJECTED','續接場次已更新，請重新確認操控');
      p.lastConfirmedResume={key:m.resumeKey,runId:r.runId,epoch:p.epoch};p.resumeGrant=null;p.resumeExpiresAt=null;this.send(c,{type:'resume-confirmed',runId:r.runId,epoch:p.epoch});return;
    }
    if(m.type==='manage'){
      const fields=['type','code','revision','hostId','targetId','action',...m.action==='lock'?['locked']:[]];
      if(!['lock','remove'].includes(m.action)||Object.keys(m).length!==fields.length||Object.keys(m).some(k=>!fields.includes(k))||
        m.code!==r.code||m.revision!==r.revision||m.hostId!==r.hostId||p.id!==r.hostId||!r.players.has(m.targetId))throw Error('房間或房主已更新，請重新確認管理對象');
      if(!socialManageable(r))throw Error('只可在大廳或進行中的自由巡航管理房間');
      if(m.action==='lock'){
        if(m.targetId!==r.hostId||typeof m.locked!=='boolean')throw Error('鎖房設定無效');
        if(r.locked!==m.locked){r.locked=m.locked;r.revision++;}this.broadcast(r,now);return;
      }
      if(m.targetId===r.hostId)throw Error('不能移除自己；請使用離開房間');
      const target=r.players.get(m.targetId),connection=target.client;
      if(r.phase==='running')r.recorder.event(now,'leave',[target.id]);
      target.token='';target.resumeGrant=null;target.resumeExpiresAt=null;target.client=null;target.input=idle();target.queue=[];target.received=target.ack=0;target.epoch++;target.car.vx=target.car.vz=target.car.w=target.car.vy=0;
      r.players.delete(target.id);r.marks=r.marks.filter(mark=>mark.playerId!==target.id);r.revision++;
      if(r.phase==='lobby')for(const q of r.players.values())q.ready=false;
      if(connection){connection.room=connection.player=null;this.send(connection,{type:'removed',message:'房主已將你移出這次房間；原席位憑證已清除。'});}
      this.broadcast(r,now);return;
    }
    if(m.type==='configure'){
      if(r.mode!=='cruise'||!['lobby','running'].includes(r.phase)||Object.keys(m).some(k=>!['type','vehicle','weather'].includes(k)))throw Error('只有巡航可更換車款與天候');
      if(m.vehicle!==undefined&&!SOCIAL_VEHICLES.includes(m.vehicle)||m.weather!==undefined&&(!['dry','rain','night'].includes(m.weather)||p.id!==r.hostId))throw Error('車款無效，或非房主更改天候');
      if(m.vehicle!==undefined&&Math.hypot(p.car.vx,p.car.vz)>2)throw Error('請先低速停車再換車');
      if(m.weather!==undefined){if(m.weather!==r.weather)r.recorder.event(now,'weather');r.weather=m.weather;}
      if(m.vehicle!==undefined&&m.vehicle!==p.vehicle){p.vehicle=m.vehicle;this.place(r,p);}
      for(const q of r.players.values())q.car.spec=this.world().spec(q.vehicle,r.weather==='rain');
      this.broadcast(r,now);return;
    }
    if(m.type==='input'){
      if(r.phase!=='running'||p.outcome)return;
      const allowed=['type','runId','epoch','seq','steer','throttle','brake','handbrake','active'];
      if(Object.keys(m).some(k=>!allowed.includes(k))||typeof m.runId!=='string'||!/^[a-f0-9]{24}$/.test(m.runId)||!Number.isSafeInteger(m.epoch)||m.epoch<0||m.epoch>1e9||!Number.isSafeInteger(m.seq)||m.seq<1||m.seq>1e9||!Number.isFinite(m.steer)||Math.abs(m.steer)>1||!['throttle','brake','handbrake','active'].every(k=>typeof m[k]==='boolean'))throw Error('只接受本場有效操控，不接受位置或分數');
      // An authoritative relocation can overtake controls already in flight. They must never move the new car or become a false cheating error.
      if(m.runId!==r.runId||m.epoch<p.epoch)return;
      if(m.epoch!==p.epoch||m.seq<=p.received||m.seq>p.received+10000)throw Error('操控世代或序號不符，請等候房間同步後再操作');
      if(!m.active){p.input=idle();p.queue=[];}
      if(p.queue.length>=12)throw Error('操控佇列已滿');
      p.resumeGrant=null;p.resumeExpiresAt=null;p.queue.push({seq:m.seq,steer:m.steer,throttle:m.throttle,brake:m.brake,handbrake:m.handbrake,active:m.active});p.received=m.seq;p.lastInputAt=now;return;
    }
    if(m.type==='ready'){if(r.phase!=='lobby'||m.revision!==r.revision||typeof m.ready!=='boolean')throw Error('房間已更新，請重新準備');p.ready=m.ready;this.broadcast(r,now);return;}
    if(m.type==='start'){
      if(p.id!==r.hostId||r.phase!=='lobby'||m.revision!==r.revision||r.players.size<(r.mode==='cruise'?1:2)||![...r.players.values()].every(q=>q.client&&q.ready))throw Error('需由房主等待所有人準備後起跑');
      r.recorder.reset();r.recorder=new CityReplayRecorder({source:'social',mode:r.mode});r.round++;r.leg=0;r.runId=id(12);r.phase='countdown';r.startAt=now+3000;r.endsAt=r.startAt+(r.mode==='tandem'?60000:r.mode==='chase'||r.crown?CROWN_DURATION_MS:1800000);r.reason='';r.simAt=r.startAt;
      resetConvoy(r);resetCrown(r,true);this.assign(r);for(const q of r.players.values()){q.points=q.combo=q.maxCombo=q.captureMs=0;q.outcome='';this.place(r,q);}this.record(r,now);r.recorder.event(now,'round');if(r.crown)r.recorder.event(now,'crown',[[...r.players.values()].find(q=>q.slot===r.crown.holderSlot).id],'crown-start');this.broadcast(r,now);return;
    }
    if(m.type==='again'){if(p.id!==r.hostId||r.phase!=='finished')throw Error('結束後由房主再開一輪');r.recorder.reset();r.recorder=new CityReplayRecorder({source:'social',mode:r.mode});r.phase='lobby';r.runId=id(12);r.revision++;r.startAt=r.endsAt=null;r.reason='';r.leg=0;
      resetConvoy(r);resetCrown(r);for(const q of r.players.values()){q.ready=false;q.role='driver';q.points=q.combo=q.maxCombo=q.captureMs=0;q.outcome='';this.place(r,q);}this.broadcast(r,now);return;}
    if(m.type==='mark'){
      const station=COOP_STATIONS.find(s=>s.id===m.stationId);
      if(r.mode!=='cruise'||!station||now-p.lastMarkAt<2000)throw Error('集合標記需間隔兩秒且只限巡航');
      p.lastMarkAt=now;r.marks=r.marks.filter(x=>x.playerId!==p.id);r.marks.push({playerId:p.id,stationId:station.id,expiresAt:now+30000});this.broadcast(r,now);return;
    }
    if(m.type==='recover'){
      if(r.phase!=='running'||r.mode!=='cruise'||Math.hypot(p.car.vx,p.car.vz)>2||now-p.recoverAt<10000)throw Error('巡航低速時每十秒可返集合區一次');
      p.recoverAt=now;this.place(r,p);r.recorder.event(now,'recover',[p.id]);this.broadcast(r,now);return;
    }
    throw Error('不支援的城市指令');
  }
  assign(r){
    const players=[...r.players.values()].sort((a,b)=>a.slot-b.slot);
    if(r.mode==='tandem')players.forEach((p,i)=>{p.role=i===(r.round+r.leg)%2?'follower':'leader';p.vehicle='muscle';});
    else if(r.mode==='chase'){const shift=r.round%players.length;players.forEach((p,i)=>{p.role=(i+shift)%players.length<Math.floor(players.length/2)?'pursuer':'runner';p.vehicle=p.role==='pursuer'?'police':'sedan';});}
    else if(r.crown)for(const p of players){p.role='driver';p.vehicle='sedan';}
    else for(const p of players)p.role='driver';
  }
  place(r,p){
    const w=this.world(),s=r.convoy?r.convoy.legs[0].start:COOP_STATIONS[0];FreeCar.surface=w.surfaceAt;p.car.spec=w.spec(p.vehicle,r.weather==='rain');
    const tandem=r.mode==='tandem',back=tandem?(p.role==='follower'?15:0):Math.floor(p.slot/2)*7,side=tandem?0:(p.slot%2?1.7:-1.7);
    p.car.place(s.x+Math.cos(s.h)*side-Math.sin(s.h)*back,s.z-Math.sin(s.h)*side-Math.cos(s.h)*back,s.h,s.y+(r.convoy?0:ROAD_Y));
    p.input=idle();p.queue=[];p.epoch++;p.lastConfirmedResume=null;p.received=p.ack=0;p.lastInputAt=this.now();
  }
  snapshot(r,now=this.now()){return{v:SOCIAL_VERSION,code:r.code,hostId:r.hostId,mode:r.mode,weather:r.weather,phase:r.phase,revision:r.revision,locked:r.locked,runId:r.runId,round:r.round,leg:r.leg,serverTime:now,startAt:r.startAt,endsAt:r.endsAt,reason:r.reason,
    players:[...r.players.values()].map(p=>({id:p.id,name:p.name,slot:p.slot,vehicle:p.vehicle,connected:!!p.client,ready:p.ready,role:p.role,pose:pose(p.car),ack:p.ack,epoch:p.epoch,points:Math.round(p.points*10)/10,combo:Math.round(p.combo*10)/10,maxCombo:Math.round(p.maxCombo*10)/10,captureMs:Math.min(2000,Math.round(p.captureMs)),outcome:p.outcome})),marks:r.marks.filter(m=>m.expiresAt>now),...r.convoy?{convoy:convoySnapshot(r)}:{},...r.crown?{crown:crownSnapshot(r)}:{}};}
  watchSnapshot(r,c,now=this.now()){
    const delayed=!socialCooperative(r.mode)&&['countdown','running'].includes(r.phase),frame=delayed?[...r.watchHistory].reverse().find(frame=>frame.runId===r.runId&&frame.at<=now-SOCIAL_WATCH_DELAY_MS):null;
    const players=delayed?(frame?.players??[]):[...r.players.values()].map(p=>({name:p.name,slot:p.slot,vehicle:p.vehicle,connected:!!p.client,role:p.role,points:Math.round(p.points*10)/10,maxCombo:Math.round(p.maxCombo*10)/10,outcome:p.outcome,pose:pose(p.car)}));
    const publicPlayer=p=>({name:p.name,slot:p.slot,vehicle:p.vehicle,connected:p.connected,role:p.role,points:p.points,maxCombo:p.maxCombo,outcome:p.outcome});
    const followed=players.find(p=>p.slot===c.followSlot);
    const crown=r.crown?(delayed?frame?.crown??{holderSlot:null,protectedUntil:0}:{holderSlot:r.crown.holderSlot,protectedUntil:r.crown.protectedUntil}):null;
    return{v:SOCIAL_VERSION,watchVersion:SOCIAL_WATCH_VERSION,code:r.code,mode:r.mode,weather:r.weather,phase:r.phase,runId:r.runId,serverTime:now,delayMs:socialCooperative(r.mode)?0:SOCIAL_WATCH_DELAY_MS,round:r.round,leg:r.leg,reason:r.reason,roster:players.map(publicPlayer),followSlot:c.followSlot,follow:followed?{...publicPlayer(followed),pose:{...followed.pose}}:null,...crown?{crown}:{}};
  }
  record(r,now){r.recorder.sample(now,[...r.players.values()].map(p=>({key:p.id,slot:p.slot,vehicle:p.vehicle,pose:pose(p.car),epoch:p.epoch,connected:!!p.client,role:p.role,outcome:p.outcome})),{weather:r.weather});}
  closeObservers(r,message='最後一位車手已離房，觀戰已結束。'){for(const c of r.observers){c.room=null;c.observer=false;this.send(c,{type:'expired',message});}r.observers.clear();}
  broadcast(r,now=this.now()){
    for(const p of r.players.values())if(p.client)this.send(p.client,{type:'room',room:this.snapshot(r,now),replay:r.recorder.descriptor()});
    if(!r.watchHistory.length||now-r.watchHistory.at(-1).at>=250){r.watchHistory.push({at:now,runId:r.runId,players:[...r.players.values()].map(p=>({name:p.name,slot:p.slot,vehicle:p.vehicle,connected:!!p.client,role:p.role,points:Math.round(p.points*10)/10,maxCombo:Math.round(p.maxCombo*10)/10,outcome:p.outcome,pose:pose(p.car)})),...r.crown?{crown:{holderSlot:r.crown.holderSlot,protectedUntil:r.crown.protectedUntil}}:{}});while(r.watchHistory.length>24)r.watchHistory.shift();}
    for(const c of r.observers)if(now-c.lastWatchAt>=250){this.send(c,{type:'watch-state',room:this.watchSnapshot(r,c,now),replay:r.recorder.descriptor()});c.lastWatchAt=now;}r.lastBroadcast=now;
  }
  finish(r,reason,now){finishCrown(r,reason);this.record(r,now);r.recorder.event(now,'finish',[],reason);r.recorder.finish(now,reason);r.phase='finished';r.reason=reason;for(const p of r.players.values()){p.input=idle();p.queue=[];p.car.vx=p.car.vz=p.car.w=0;p.epoch++;}this.broadcast(r,now);}
  simulate(r,at){
    const w=this.world(),old=r.convoy?new Map([...r.players.values()].map(p=>[p.id,{x:p.car.x,y:p.car.y,z:p.car.z}])):null;FreeCar.surface=w.surfaceAt;
    for(const p of r.players.values()){
      if(p.outcome)continue;if(p.queue.length){p.input=p.queue.shift();p.ack=p.input.seq;}
      const fresh=p.client&&p.input.active&&at-p.lastInputAt<700,inp=fresh?p.input:idle();
      p.car.drift=!!(inp.handbrake&&Math.abs(p.car.v)>8);p.car.update(1/60,inp.steer,inp.throttle,inp.brake,w.collider);
      if(!fresh){p.queue=[];p.car.vx*=.8;p.car.vz*=.8;p.car.w*=.8;if(Math.hypot(p.car.vx,p.car.vz)<.2)p.car.vx=p.car.vz=p.car.w=0;}
      const v=pose(p.car);
      if(!Object.values(v).every(Number.isFinite)||Math.abs(v.x)>12000||Math.abs(v.z)>12000||v.y< -120||v.y>600||['vx','vz','w','vy','steer','pitch','roll'].some(k=>Math.abs(v[k])>200)){
        if(r.mode!=='cruise')p.outcome='left';this.place(r,p);
      }
    }
    const active=[...r.players.values()].filter(p=>p.client&&!p.outcome),contacts=[];if(r.crown)active.sort((a,b)=>a.slot-b.slot);
    if(!socialCooperative(r.mode)&&at>=r.startAt+3000)for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){const a=active[i],b=active[j],hit=streetContact(a.car,b.car);if(hit.touch){contacts.push([a.id,b.id]);r.recorder.event(at,'contact',[a.id,b.id]);a.combo=b.combo=0;a.contactUntil=b.contactUntil=at+1000;}}
    if(r.mode==='chase'&&at>=r.startAt+10000){
      for(const p of active.filter(p=>p.role==='runner')){const near=active.some(q=>q.role==='pursuer'&&captureEligible(pose(p.car),pose(q.car)));
        p.captureMs=near?Math.min(2000,p.captureMs+1000/60):0;if(p.captureMs>=2000){p.outcome='captured';r.recorder.event(at,'capture',[p.id]);p.car.vx=p.car.vz=p.car.w=0;p.input=idle();p.queue=[];}}
      const runners=[...r.players.values()].filter(p=>p.role==='runner');if(runners.every(p=>p.outcome))this.finish(r,runners.every(p=>p.outcome==='captured')?'captured':'left',at);
    }else if(r.mode==='tandem'){
      const leader=active.find(p=>p.role==='leader'),follower=active.find(p=>p.role==='follower');
      if(follower){const q=leader&&at>=follower.contactUntil&&at>=leader.contactUntil?tandemQuality(pose(leader.car),pose(follower.car)):0;
        follower.combo=q?Math.min(120,follower.combo+1/60):0;follower.maxCombo=Math.max(follower.maxCombo,follower.combo);
        if(q)follower.points+=q*(1+Math.min(3,follower.combo/5))*10/60;}
    }
    if(r.convoy)stepConvoy(r,old,at,(reason,time)=>this.finish(r,reason,time),(time,actors)=>r.recorder.event(time,'stage',actors));
    if(r.crown)stepCrown(r,contacts,at,(reason,time)=>this.finish(r,reason,time),(...args)=>r.recorder.event(...args));
    if(r.phase==='running')this.record(r,at);
  }
  tick(now=this.now()){
    for(const r of this.rooms.values()){
      r.marks=r.marks.filter(m=>m.expiresAt>now);
      for(const p of [...r.players.values()])if(!p.client&&p.disconnectedAt!==null&&now>seatExpires(p)){
        // Keep the completed convoy roster factual until the next lobby; expiry cannot rewrite who finished.
        if((r.convoy||r.crown)&&r.phase==='finished'){p.token='';p.resumeGrant=null;p.resumeExpiresAt=0;continue;}
        if(r.phase==='running'&&r.mode!=='cruise'){if(p.outcome!=='left'){p.outcome='left';p.token='';p.resumeGrant=null;p.resumeExpiresAt=0;r.revision++;}}
        else{p.token='';p.resumeGrant=null;r.players.delete(p.id);r.revision++;if(r.phase==='lobby')for(const q of r.players.values())q.ready=false;}
      }
      r.marks=r.marks.filter(m=>r.players.has(m.playerId));
      if(!r.players.size||[...r.players.values()].every(p=>!p.client&&p.disconnectedAt!==null&&now>seatExpires(p))){this.closeObservers(r);this.rooms.delete(r.code);continue;}
      if(!r.players.get(r.hostId)?.client){const next=[...r.players.values()].find(p=>p.client)?.id??r.players.keys().next().value;if(next!==r.hostId){r.hostId=next;r.revision++;}}
      if(r.phase==='countdown'&&![...r.players.values()].every(p=>p.client&&p.ready)){r.phase='lobby';r.startAt=r.endsAt=null;r.revision++;resetCrown(r);for(const p of r.players.values())p.ready=false;this.broadcast(r,now);}
      if(r.phase==='countdown'&&now>=r.startAt){r.phase='running';r.simAt=r.startAt;this.broadcast(r,now);}
      if(r.phase==='running'){
        if(r.mode==='tandem'&&[...r.players.values()].some(p=>!p.client)){this.finish(r,'left',now);continue;}
        if(r.mode==='chase'&&![...r.players.values()].some(p=>p.role==='pursuer'&&!p.outcome)){this.finish(r,'left',now);continue;}
        if(now-r.simAt>1000){this.finish(r,'server-stall',now);continue;}
        let n=0;while(n++<12&&r.simAt+1000/60<=Math.min(now,r.endsAt)+.0001&&r.phase==='running'){r.simAt+=1000/60;this.simulate(r,r.simAt);}
        // Crown scoring is authoritative dt: drain a sub-second backlog instead of dropping its final held time.
        if(r.phase==='running'&&(r.crown?r.simAt>=r.endsAt-.001:now>=r.endsAt)){
          if(r.mode==='tandem'&&r.leg===0){r.leg=1;r.phase='countdown';r.startAt=now+3000;r.endsAt=r.startAt+60000;r.simAt=r.startAt;this.assign(r);for(const p of r.players.values()){p.combo=0;this.place(r,p);}r.recorder.event(now,'round');this.record(r,now);this.broadcast(r,now);}
          else{if(r.mode==='chase')for(const p of r.players.values())if(p.role==='runner'&&!p.outcome)p.outcome='escaped';this.finish(r,r.mode==='tandem'||r.crown?'complete':'timeout',now);}
        }
      }
      if(now-r.lastBroadcast>=50)this.broadcast(r,now);
      if(now-r.updatedAt>35*60000){for(const p of r.players.values())if(p.client){this.send(p.client,{type:'expired',message:'城市房間已到期'});p.client.room=p.client.player=null;}this.closeObservers(r,'城市房間已到期，觀戰已結束。');this.rooms.delete(r.code);}
    }
  }
  remove(c){
    const r=c.room,p=c.player;if(!r||!p)return;if(r.phase==='running')r.recorder.event(this.now(),'leave',[p.id]);p.token='';p.resumeGrant=null;p.resumeExpiresAt=0;p.client=null;p.input=idle();p.queue=[];p.car.vx=p.car.vz=p.car.w=0;c.room=c.player=null;
    if(r.phase==='finished'&&(r.convoy||r.crown)){p.disconnectedAt=this.now()-SOCIAL_GRACE_MS-1;r.revision++;}
    else if(r.phase==='running'&&r.mode!=='cruise'){p.outcome='left';r.revision++;p.disconnectedAt=this.now()-SOCIAL_GRACE_MS-1;if(r.mode==='tandem')this.finish(r,'left',this.now());}
    else{r.players.delete(p.id);r.revision++;for(const q of r.players.values())q.ready=false;}
    r.marks=r.marks.filter(m=>m.playerId!==p.id);this.send(c,{type:'left'});this.tick();if(this.rooms.has(r.code))this.broadcast(r);
  }
  drop(c){this.clients.delete(c);if(c.observer){c.room?.observers.delete(c);c.room=null;c.observer=false;return;}if(c.player?.client===c){if(c.room?.phase==='running')c.room.recorder.event(this.now(),'disconnect',[c.player.id]);c.player.client=null;c.player.lastConfirmedResume=null;c.player.input=idle();c.player.queue=[];c.player.disconnectedAt=this.now();c.player.resumeExpiresAt=c.player.resumeGrant?.expiresAt??this.now()+SOCIAL_GRACE_MS;if(c.room){c.room.revision++;if(c.room.phase==='lobby')for(const q of c.room.players.values())q.ready=false;}}c.room=c.player=null;this.tick();}
  heartbeat(){for(const c of this.clients){if(!c.alive){c.ws.terminate();continue;}c.alive=false;c.ws.ping();}}
  close(){this.closed=true;for(const c of this.clients){c.room=c.player=null;c.ws.terminate();}this.clients.clear();this.rooms.clear();this.worldRef=null;}
}
