// Rex <game88521@gmail.com>. Authoritative mission/photograph objectives over real FreeCar and the real city graph.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {SummitCityRaceService} from './summit-city-race-service.mjs';
import * as physics from './summit-city-physics.mjs';
import {CITY_RACE_VERSION} from '../shared/summit-city-race.ts';
import {MERIDIAN_CITY_VERSION} from '../shared/meridian-city.ts';
const id=n=>randomBytes(n).toString('hex'),idle=()=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v),exact=(v,keys)=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const tokenEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const err=(code,message)=>Object.assign(Error(message),{code});
export class MeridianCityService extends SummitCityRaceService {
 constructor(options={}){super({...options,maxRooms:options.maxRooms??2,maxClients:options.maxClients??12});this.models=options.models??physics;this.closed=false;this.creating=null;}
 send(c,m){try{if(c.ws.readyState!==1)return;const raw=JSON.stringify(m);if(c.ws.bufferedAmount+Buffer.byteLength(raw)>512*1024){c.ws.close(1013,'城市任務連線過慢');return;}c.ws.send(raw);}catch{c.ws.terminate?.();}}
 accept(ws){if(this.closed||this.clients.size>=this.maxClients){ws.close(1013,'城市任務連線已滿');return null;}const c={ws,room:null,player:null,window:this.now(),count:0,lastSeen:this.now(),alive:true};this.clients.add(c);this.send(c,{type:'hello',v:MERIDIAN_CITY_VERSION,resumeGraceMs:15000});ws.on('pong',()=>c.alive=true);ws.on('message',bytes=>{if(this.closed||!this.clients.has(c))return;const now=this.now();if(now-c.window>=1000){c.window=now;c.count=0;}if(++c.count>90||bytes.length>18000){ws.close(1008,'城市任務指令超限');return;}try{const m=JSON.parse(String(bytes));if(!obj(m)||typeof m.type!=='string')throw Error('指令格式無效');c.lastSeen=now;this.receive(c,m,now);}catch(e){this.send(c,{type:'error',message:String(e.message).slice(0,180),code:e.code??'COMMAND_REJECTED'});}});ws.on('close',()=>this.drop(c));ws.on('error',()=>this.drop(c));return c;}
 place(r,p){if(!Object.hasOwn(r,'mode')){if(!this.creating)throw Error('任務設定尚未建立');Object.assign(r,this.creating);r.mission=null;r.capture=null;}super.place(r,p);p.needsConfirm=false;p.held=false;p.actionSeq=0;p.actionAt=0;}
 snapshot(r,now=this.now()){const base=super.snapshot(r,now);return{...base,missionVersion:MERIDIAN_CITY_VERSION,mode:r.mode,storyCode:r.storyCode,includeOptional:r.includeOptional,mission:r.mission?.snapshot()??null,players:base.players.sort((a,b)=>a.slot-b.slot).map(p=>({...p,needsConfirm:!!r.players.get(p.id).needsConfirm}))};}
 context(r,p,m){return m.revision===r.revision&&m.matchId===r.matchId&&m.motionRevision===p.motionRevision;}
 receive(c,m,now=this.now()){
  if(this.closed||!this.clients.has(c))throw Error('城市任務服務已關閉');
  if(m.type==='ping'){if(!exact(m,['type','sentAt'])||!Number.isFinite(m.sentAt))throw Error('心跳格式無效');this.send(c,{type:'pong',sentAt:m.sentAt,serverTime:now});return;}
  if(['create','join','resume'].includes(m.type)){
   if(c.room)throw Error('請先離開目前任務');if(m.v!==MERIDIAN_CITY_VERSION)throw err('VERSION_MISMATCH','城市任務前後端版本不同');if(m.type==='resume')return this.resume(c,m,now);
   if(m.type==='create'){
    if(!exact(m,['type','v','name','mode','storyCode','includeOptional'])||!['story','hunt'].includes(m.mode)||typeof m.includeOptional!=='boolean'||typeof m.storyCode!=='string'||m.storyCode.length>12000)throw Error('任務建立格式無效');
    const w=this.world(),hunt=m.mode==='hunt'?this.models.buildPhotoHunt(w.roads):null,story=hunt?.story??this.models.decodeStory(m.storyCode),plan=hunt?.plan??this.models.buildStoryPlan(w.roads,story,m.includeOptional);if(plan.route.gates.length>700)throw Error('任務道路過長');
    this.creating={mode:m.mode,storyCode:this.models.encodeStory(story),includeOptional:m.mode==='hunt'?true:m.includeOptional,story,plan};try{super.receive(c,{type:'create',v:CITY_RACE_VERSION,name:m.name,challenge:physics.encodeWorkshop(plan.definition),collisions:false},now);}finally{this.creating=null;}return;
   }
   if(!exact(m,['type','v','name','code']))throw Error('入房格式無效');super.receive(c,{type:'join',v:CITY_RACE_VERSION,name:m.name,code:m.code},now);return;
  }
  const r=c.room,p=c.player;if(!r||!p||p.client!==c)throw Error('請先加入城市任務房');r.updatedAt=now;
  if(m.type==='leave'){if(!exact(m,['type']))throw Error('離房格式無效');this.remove(c);return;}
  if(m.type==='confirm-resume'){if(!exact(m,['type','revision','matchId','motionRevision'])||!this.context(r,p,m))throw Error('續接確認已過期');p.needsConfirm=false;p.held=false;p.input=idle();p.queue=[];this.broadcast(r,now);return;}
  if(p.needsConfirm)throw err('CONFIRM_REQUIRED','原席已連線，請先確認恢復操控');
  if(m.type==='input'){if(!exact(m,['type','revision','matchId','motionRevision','seq','steer','throttle','brake','handbrake','active']))throw Error('任務只接受操控，不接受位置');super.receive(c,m,now);return;}
  if(m.type==='operate'){
   if(!exact(m,['type','revision','matchId','motionRevision','stage','seq','action','held'])||!this.context(r,p,m)||r.phase!=='racing'||m.stage!==r.mission?.index||!Number.isSafeInteger(m.seq)||m.seq<=p.actionSeq||m.seq>p.actionSeq+10000||!['work','capture'].includes(m.action)||typeof m.held!=='boolean')throw Error('作業階段、世代或指令無效');p.actionSeq=m.seq;
   if(m.action==='capture'){if(r.mode!=='hunt'||!m.held)throw Error('只有尋寶可送出拍照確認');r.capture={id:p.id,stage:m.stage,at:now};}else{if(r.mode!=='story')throw Error('照片任務請按拍照');p.held=m.held;p.actionAt=now;}return;
  }
  if(m.type==='ready'){if(!exact(m,['type','revision','matchId','motionRevision','map','ready'])||!this.context(r,p,m))throw Error('任務版本已更新');super.receive(c,m,now);return;}
  if(m.type==='start'){
   const min=r.mode==='hunt'?1:2;if(!exact(m,['type','revision','matchId','motionRevision'])||!this.context(r,p,m)||p.id!==r.hostId||r.phase!=='lobby'||r.players.size<min||![...r.players.values()].every(q=>q.client&&q.ready&&!q.needsConfirm))throw Error(`需要房主與${min}～4人確認任務後準備`);
   r.phase='countdown';r.matchId=id(12);r.startAt=now+3000;r.deadlineAt=r.startAt+r.definition.seconds*1000;r.simAt=r.startAt;r.mission=new this.models.CityMissionRun(r.mode,r.story,r.plan);r.capture=null;
   for(const q of r.players.values()){this.place(r,q);q.finishMs=q.dnf=null;q.motionRevision++;q.input=idle();q.queue=[];q.received=q.ack=0;q.next=0;q.completedLaps=0;q.lapTimes=[];}this.broadcast(r,now);return;
  }
  if(m.type==='again'){
   if(!exact(m,['type','revision','matchId','motionRevision'])||!this.context(r,p,m)||r.phase!=='results'||p.id!==r.hostId)throw Error('只有房主可在結算後重新準備');r.phase='lobby';r.revision++;r.matchId=r.startAt=r.deadlineAt=null;r.mission=null;r.capture=null;for(const q of r.players.values()){q.ready=false;q.finishMs=q.dnf=null;q.next=0;q.completedLaps=0;q.lapTimes=[];q.motionRevision++;this.place(r,q);}this.broadcast(r,now);return;
  }
  throw Error('不支援的任務指令');
 }
 resume(c,m,now){
  if(!exact(m,['type','v','code','selfId','token','resumeKey'])||typeof m.selfId!=='string'||!/^[a-f0-9]{20}$/.test(m.selfId)||typeof m.resumeKey!=='string'||!/^[a-f0-9]{24}$/.test(m.resumeKey))throw err('SEAT_REJECTED','續接憑證無效');const r=this.rooms.get(m.code),p=r?.players.get(m.selfId),grant=p?.resumeGrant,same=grant&&grant.key===m.resumeKey&&(tokenEqual(m.token,grant.oldToken)||tokenEqual(m.token,grant.newToken));
  if(!p||p.client||!p.disconnectedAt||now-p.disconnectedAt>=15000||!same&&!tokenEqual(m.token,p.token))throw err('SEAT_EXPIRED','原席位不存在、仍在線或已超過15秒');
  if(!same){const oldToken=p.token;p.token=id(32);p.motionRevision++;p.resumeGrant={key:m.resumeKey,oldToken,newToken:p.token};}p.client=c;p.disconnectedAt=0;p.input=idle();p.queue=[];p.held=false;p.needsConfirm=true;p.lastInputAt=now;p.received=p.ack;p.actionSeq=0;c.room=r;c.player=p;this.send(c,{type:'welcome',selfId:p.id,token:p.token,resumed:true,room:this.snapshot(r,now)});this.broadcast(r,now);
 }
 simulate(r,at){const w=this.world();physics.FreeCar.surface=w.surfaceAt;let impact=0;
  for(const p of r.players.values()){
   if(p.queue.length){p.input=p.queue.shift();p.ack=p.input.seq;}const active=!!p.client&&!p.needsConfirm&&at-p.lastInputAt<700&&p.input.active!==false,inp=active?p.input:idle();p.car.drift=inp.handbrake&&Math.abs(p.car.v)>8;impact=Math.max(impact,p.car.update(1/60,inp.steer,inp.throttle,inp.brake,w.collider));if(!active){p.queue=[];p.car.vx*=.8;p.car.vz*=.8;p.car.w*=.8;if(Math.hypot(p.car.vx,p.car.vz)<.2)p.car.vx=p.car.vz=p.car.w=0;}if(![p.car.x,p.car.y,p.car.z,p.car.vx,p.car.vz].every(Number.isFinite)){r.mission.fail('車輛物理狀態中斷');this.place(r,p);}
  }
  const actors=[...r.players.values()].sort((a,b)=>a.slot-b.slot).map(p=>({id:p.id,slot:p.slot,connected:!!p.client&&!p.needsConfirm,pose:p.car,held:!!p.client&&!p.needsConfirm&&p.held&&at-p.actionAt<700}));const capture=r.capture&&r.capture.stage===r.mission.index&&at-r.capture.at<1000?r.capture.id:undefined;r.capture=null;r.mission.step(1/60,actors,capture,impact);
  for(const p of r.players.values())p.next=Math.min(r.route.gates.length,r.mission.gate);
 }
 finish(r,now){if(r.phase==='results')return;r.phase='results';for(const p of r.players.values()){p.held=false;p.input=idle();p.queue=[];p.car.vx=p.car.vz=p.car.w=0;if(r.mission.success){p.finishMs=Math.max(.001,r.mission.elapsed*1000);p.completedLaps=1;p.lapTimes=[p.finishMs];}else p.dnf=r.mission.reason;}this.broadcast(r,now);}
 tick(now=this.now()){
  if(this.closed)return;for(const r of this.rooms.values()){
   let changed=false;for(const p of [...r.players.values()])if(!p.client&&p.disconnectedAt&&now-p.disconnectedAt>=15000){r.players.delete(p.id);p.token='';changed=true;}
   if(!r.players.size){this.rooms.delete(r.code);continue;}if(changed){r.revision++;for(const p of r.players.values()){p.input=idle();p.queue=[];p.held=false;p.actionSeq=0;p.motionRevision++;if(r.phase==='lobby'||r.phase==='countdown')p.ready=false;}}
   if(!r.players.get(r.hostId)?.client)r.hostId=[...r.players.values()].find(p=>p.client)?.id??r.players.keys().next().value;
   const enough=r.players.size>=(r.mode==='hunt'?1:2);if(r.phase==='countdown'&&(!enough||![...r.players.values()].every(p=>p.client&&p.ready&&!p.needsConfirm))){r.phase='lobby';r.matchId=r.startAt=r.deadlineAt=null;r.mission=null;r.revision++;for(const p of r.players.values())p.ready=false;this.broadcast(r,now);}
   if(r.phase==='countdown'&&now>=r.startAt){r.phase='racing';r.simAt=r.startAt;this.broadcast(r,now);}
   if(r.phase==='racing'){
    if(!enough)r.mission.fail('隊伍人數不足，未產生成績');else if(now-r.simAt>1000)r.mission.fail('伺服器模擬中斷，本場取消');
    else{let steps=0;while(!r.mission.done&&steps++<12&&r.simAt+1000/60<=Math.min(now,r.deadlineAt)+.0001){r.simAt+=1000/60;this.simulate(r,r.simAt);}}
    if(now>=r.deadlineAt&&!r.mission.done)r.mission.fail('任務時間已到');if(r.mission.done)this.finish(r,now);
   }
   if(now-r.lastBroadcast>=50||changed)this.broadcast(r,now,true);
   if(now-r.updatedAt>35*60000){for(const p of r.players.values())if(p.client){p.client.room=p.client.player=null;this.send(p.client,{type:'expired',message:'城市任務房已到期'});}this.rooms.delete(r.code);}
  }
 }
 remove(c){const r=c.room,p=c.player;if(!r||!p)return;r.players.delete(p.id);p.token='';p.held=false;p.input=idle();c.room=c.player=null;r.revision++;for(const q of r.players.values()){q.motionRevision++;q.input=idle();q.queue=[];q.held=false;q.actionSeq=0;if(r.phase==='lobby'||r.phase==='countdown')q.ready=false;}this.send(c,{type:'left'});this.tick(this.now());if(this.rooms.has(r.code))this.broadcast(r);}
 drop(c){if(!this.clients.has(c))return;this.clients.delete(c);if(c.player?.client===c){c.player.client=null;c.player.disconnectedAt=this.now();c.player.input=idle();c.player.queue=[];c.player.held=false;}c.room=c.player=null;if(!this.closed)this.tick(this.now());}
 close(){this.closed=true;super.close();}
}
