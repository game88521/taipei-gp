// Rex <game88521@gmail.com>. Fixed real-road regularity, authoritative FreeCar; no inter-car contact path.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {SummitCityRaceService} from './summit-city-race-service.mjs';
import {FreeCar,ROAD_Y,encodeWorkshop} from './summit-city-physics.mjs';
import {CITY_RACE_VERSION} from '../shared/summit-city-race.ts';
import {COOP_STATIONS} from '../shared/nexus-coop.ts';
import {FRONTIER_RALLY_VERSION,FRONTIER_RALLY_AVERAGES,FRONTIER_RALLY_GRACE_MS,rallyTiming,rallyCode,AURORA_RALLY_VERSION,RALLY_COURSES,parseRallyPlan} from '../shared/frontier-rally.ts';
import {MERIDIAN_NAVIGATOR_VERSION} from '../shared/meridian-navigator.ts';
import {createNavigator,navigatorSnapshot,navigatorSync,navigatorCommand,navigatorSimulate,navigatorTick,navigatorLeave} from './meridian-navigator-service.mjs';
const id=n=>randomBytes(n).toString('hex'),idle=()=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v),exact=(v,keys)=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const error=(code,message)=>Object.assign(Error(message),{code});
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class FrontierRallyService extends SummitCityRaceService{
 constructor(o={}){super({...o,maxRooms:o.maxRooms??2,maxClients:o.maxClients??24});this.closed=false;this.pendingAverage=36;this.routeDefinition=null;}
 send(c,m){try{if(c.ws.readyState!==1)return;const raw=JSON.stringify(m);if(c.ws.bufferedAmount+Buffer.byteLength(raw)>256*1024){c.ws.close(1013,'拉力連線過慢');return;}c.ws.send(raw);}catch{c.ws.terminate?.();}}
 accept(ws){
  if(this.closed||this.clients.size>=this.maxClients){ws.close(1013,'定速拉力連線已滿');return null;}
  const c={ws,room:null,player:null,window:this.now(),count:0,lastSeen:this.now(),alive:true};this.clients.add(c);this.send(c,{type:'hello',v:FRONTIER_RALLY_VERSION,features:{confirmation:true,resumeGraceMs:15000,watch:false,replay:false,coursePlan:AURORA_RALLY_VERSION,navigator:MERIDIAN_NAVIGATOR_VERSION}});
  ws.on('pong',()=>c.alive=true);ws.on('message',bytes=>{if(this.closed||!this.clients.has(c))return;const now=this.now();if(now-c.window>=1000){c.window=now;c.count=0;}if(++c.count>90||bytes.length>4096){ws.close(1008,'拉力指令超限');return;}let m;try{m=JSON.parse(String(bytes));if(!obj(m)||typeof m.type!=='string')throw Error('指令格式無效');c.lastSeen=now;this.receive(c,m,now);}catch(e){this.send(c,{type:'error',message:String(e.message).slice(0,150),...e.code?{code:e.code}:{}});}});
  ws.on('close',()=>this.drop(c));ws.on('error',()=>this.drop(c));return c;
 }
 definition(average,plan){
  if(plan){const roads=this.world().roads,course=RALLY_COURSES.find(c=>c.id===plan.courseId),start=COOP_STATIONS[course.from],end=COOP_STATIONS[course.to],a=roads.nearest(start.x,start.z,'ground',150),b=roads.nearest(end.x,end.z,'ground',150);if(!a||!b)throw Error('分段拉力道路無法連接');const route=roads.route([a.id,b.id]);if(route.length<200||route.length>4000)throw Error('分段拉力道路長度不符');return{v:1,physics:'city-workshop-v1',map:roads.stamp,name:course.name,nodes:[a.id,b.id],car:'sedan',weather:'day',seconds:600,hits:20};}
  const roads=this.world().roads;if(!this.routeDefinition){const start=COOP_STATIONS[0],end=COOP_STATIONS[2],a=roads.nearest(start.x,start.z,'ground',150),b=roads.nearest(end.x,end.z,'ground',150);if(!a||!b)throw Error('拉力路線無法連接真實道路');const route=roads.route([a.id,b.id]);if(route.length<200||route.length>4000)throw Error('拉力路線長度不符');this.routeDefinition={v:1,physics:'city-workshop-v1',map:roads.stamp,name:'信義—松山好友定速拉力',nodes:[a.id,b.id],car:'sedan',weather:'day',seconds:600,hits:20};}
  return{...this.routeDefinition,nodes:[...this.routeDefinition.nodes]};
 }
 resetScores(p,privateSeat=false){p.arrivals=[];p.timingPenaltyMs=0;p.speedPenaltyMs=0;if(privateSeat){p.needsConfirm=false;p.resumeGrant=null;p.resumeExpiresAt=null;p.lastConfirmed=null;}}
 receive(c,m,now=this.now()){
  if(this.closed||!this.clients.has(c))throw Error('拉力連線已結束');
  if(m.type==='ping'){if(!exact(m,['type','sentAt'])||typeof m.sentAt!=='number'||!Number.isFinite(m.sentAt))throw Error('心跳格式無效');this.send(c,{type:'pong',sentAt:m.sentAt,serverTime:now});return;}
  if(['create','join','resume'].includes(m.type)){
   if(c.room)throw Error('請先離開目前拉力房');if(m.v!==FRONTIER_RALLY_VERSION)throw error('VERSION_MISMATCH','定速拉力版本不相容，請更新前後端');
   if(m.type==='resume')return this.resume(c,m,now);
   const keys=m.type==='create'?['type','v','name','average',...('coursePlan'in m?['coursePlan']:[]),...('navigator'in m?['navigator']:[])]:['type','v','name','code'];if(!exact(m,[...keys,...('auroraRally'in m?['auroraRally']:[]),...('navigatorVersion'in m?['navigatorVersion']:[])])||m.type==='create'&&!FRONTIER_RALLY_AVERAGES.includes(m.average))throw Error('只接受暱稱、房碼或28／36／42目標均速');
   const plan=m.type==='create'&&'coursePlan'in m?parseRallyPlan(m.coursePlan):null;if('coursePlan'in m&&!plan||plan&&m.auroraRally!==AURORA_RALLY_VERSION||m.type==='join'&&this.rooms.get(m.code)?.coursePlan&&m.auroraRally!==AURORA_RALLY_VERSION)throw error('VERSION_MISMATCH','分段拉力需要新版前後端與有效路線計畫');
   if(m.type==='create'&&m.navigator!==undefined&&(m.navigator!==true||m.navigatorVersion!==MERIDIAN_NAVIGATOR_VERSION))throw error('VERSION_MISMATCH','領航拉力需要配套版本');const joiningRoom=m.type==='join'?this.rooms.get(m.code):null;if(joiningRoom?.navigator&&(m.navigatorVersion!==MERIDIAN_NAVIGATOR_VERSION||joiningRoom.players.size>=2))throw Error('領航拉力限定兩名新版原席');
   this.pendingAverage=m.type==='create'?m.average:36;
   const translated=m.type==='create'?{type:'create',v:CITY_RACE_VERSION,name:m.name,challenge:encodeWorkshop(this.definition(m.average,plan)),collisions:false}:{type:'join',v:CITY_RACE_VERSION,name:m.name,code:m.code};
   this.creatingNavigator=m.type==='create'&&m.navigator===true;this.creatingPlan=plan;try{super.receive(c,translated,now);}finally{this.creatingPlan=null;this.creatingNavigator=false;}const r=c.room;if(m.type==='create'){r.average=m.average;r.timing=rallyTiming(r.route,r.average,r.coursePlan??undefined);r.reason='';}this.resetScores(c.player,true);this.broadcast(r,now);return;
  }
  const r=c.room,p=c.player;if(!r||!p||p.client!==c)throw Error('請先加入定速拉力房');
  if(navigatorCommand(this,c,m,now))return;
  if(m.type==='leave'){if(!exact(m,['type']))throw Error('離房格式無效');navigatorLeave(this,r,now);if(r.navigator&&r.phase==='results'){p.token='';p.resumeGrant=null;p.resumeExpiresAt=0;p.client=null;p.input=idle();p.queue=[];p.disconnectedAt=now-15001;c.room=c.player=null;this.send(c,{type:'left'});this.tick(now);if(this.rooms.has(r.code))this.broadcast(r,now);return;}p.token='';p.resumeGrant=null;p.resumeExpiresAt=null;super.remove(c);return;}
  if(m.type==='confirm-resume'){
   if(!exact(m,['type','code','selfId','matchId','revision','motionRevision','resumeKey'])||m.code!==r.code||m.selfId!==p.id||m.matchId!==r.matchId||m.revision!==r.revision||m.motionRevision!==p.motionRevision||!p.resumeGrant&&!(p.lastConfirmed?.key===m.resumeKey&&p.lastConfirmed.client===c)||p.resumeGrant&&p.resumeGrant.key!==m.resumeKey)throw error('SEAT_REJECTED','續接確認已過期，請重新確認目前場次');
   p.needsConfirm=false;p.lastConfirmed={key:m.resumeKey,client:c};p.resumeGrant=null;p.resumeExpiresAt=null;this.send(c,{type:'resume-confirmed',matchId:r.matchId,revision:r.revision,motionRevision:p.motionRevision,resumeKey:m.resumeKey});this.broadcast(r,now);return;
  }
  if(p.needsConfirm)throw error('CONFIRM_REQUIRED','原席已連線，請先確認恢復操控');
  if(['ready','start','again'].includes(m.type)){
   if(!exact(m,['type','revision','matchId','map',...m.type==='ready'?['ready']:[]])||m.revision!==r.revision||m.matchId!==r.matchId||m.map!==r.definition.map)throw Error('拉力場次或道路版本已更新');
   if(m.type==='start'&&r.phase==='lobby'&&r.hostId===p.id&&r.revision===m.revision&&r.players.size>=2&&[...r.players.values()].every(q=>q.client&&q.ready&&!q.needsConfirm)){for(const q of r.players.values())this.resetScores(q,true);if(r.navigator){r.navigator={...createNavigator(),driverSlot:r.navigator.driverSlot,navigatorSlot:r.navigator.navigatorSlot};}r.reason='';}
   if(m.type==='again'&&r.phase==='results'&&r.hostId===p.id){for(const q of r.players.values())this.resetScores(q);if(r.navigator)r.navigator={...createNavigator(),driverSlot:r.navigator.driverSlot,navigatorSlot:r.navigator.navigatorSlot};r.reason='';}
   super.receive(c,m,now);return;
  }
  if(m.type==='input'){if(!exact(m,['type','matchId','revision','motionRevision','seq','steer','throttle','brake','handbrake','active']))throw Error('拉力只接受操控，不接受位置、通關或罰分');super.receive(c,m,now);return;}
  throw Error('定速拉力只提供準備、起跑、操控、續接確認與離房；不提供傳送或脫困加進度');
 }
 resume(c,m,now){
  if(!exact(m,['type','v','code','selfId','token','resumeKey',...('auroraRally'in m?['auroraRally']:[]),...('navigatorVersion'in m?['navigatorVersion']:[])])||!rallyCode(m.code)||typeof m.selfId!=='string'||!/^[a-f0-9]{20}$/.test(m.selfId)||typeof m.resumeKey!=='string'||!/^[a-f0-9]{24}$/.test(m.resumeKey))throw error('SEAT_REJECTED','續接憑證格式無效');
  const r=this.rooms.get(m.code);if(!r)throw error('ROOM_GONE','原拉力房已結束');if(r.navigator&&m.navigatorVersion!==MERIDIAN_NAVIGATOR_VERSION)throw error('VERSION_MISMATCH','領航拉力需要新版續接');if(r.coursePlan&&m.auroraRally!==AURORA_RALLY_VERSION)throw error('VERSION_MISMATCH','分段拉力需新版續接');const p=r.players.get(m.selfId);if(!p||p.dnf)throw error('SEAT_EXPIRED','原拉力席位已結束');
  const grant=p.resumeGrant,same=grant&&grant.key===m.resumeKey&&(equal(m.token,grant.oldToken)||equal(m.token,grant.newToken));if(!same&&!equal(m.token,p.token))throw error('SEAT_REJECTED','拉力續接憑證已失效');if(p.client)throw error('SEAT_BUSY','原席位仍在另一條連線，請稍候');
  const expires=p.resumeExpiresAt??p.disconnectedAt+FRONTIER_RALLY_GRACE_MS;if(!p.disconnectedAt||now>=expires)throw error('SEAT_EXPIRED','拉力原席保留已超過15秒');
  if(!same){const oldToken=p.token;p.token=id(32);p.motionRevision++;p.resumeGrant={key:m.resumeKey,oldToken,newToken:p.token,expiresAt:expires};}
  p.resumeExpiresAt=expires;p.needsConfirm=true;p.client=c;p.disconnectedAt=0;p.input=idle();p.queue=[];p.received=p.ack;p.lastInputAt=now;c.room=r;c.player=p;r.updatedAt=now;
  this.send(c,{type:'welcome',selfId:p.id,token:p.token,resumed:true,room:this.snapshot(r,now)});this.broadcast(r,now);
 }
 place(r,p){if(this.creatingNavigator&&!r.navigator)r.navigator=createNavigator();if(!Object.hasOwn(r,'coursePlan'))r.coursePlan=this.creatingPlan?structuredClone(this.creatingPlan):null;const w=this.world();FreeCar.surface=w.surfaceAt;p.car.spec=w.spec('sedan',false);const s=r.route.start;p.car.place(s.x,s.z,s.h,s.y+ROAD_Y);}
 snapshot(r,now=this.now()){
  const base=super.snapshot(r,now),average=r.average??this.pendingAverage,timing=r.timing??rallyTiming(r.route,average,r.coursePlan??undefined),reason=base.phase==='results'?(r.reason||(now>=r.deadlineAt?'timeout':'complete')):'';
  // All players share an identical start pose because friend cars never collide.
  const players=base.players.map(value=>{const p=r.players.get(value.id),timingPenaltyMs=Math.round(p.timingPenaltyMs??0),speedPenaltyMs=Math.round(p.speedPenaltyMs??0);return{...value,ghostUntil:0,contactCount:0,arrivals:structuredClone(p.arrivals??[]),timingPenaltyMs,speedPenaltyMs,penaltyMs:timingPenaltyMs+speedPenaltyMs,rank:null,needsConfirm:!!p.needsConfirm};});
  if(base.phase==='results'&&reason!=='server-stall')for(const p of players)if(p.finishMs!==null&&!p.dnf)p.rank=1+players.filter(q=>q.finishMs!==null&&!q.dnf&&q.penaltyMs<p.penaltyMs).length;
  players.sort((a,b)=>(a.dnf?1:0)-(b.dnf?1:0)||(base.phase==='results'?a.penaltyMs-b.penaltyMs:b.next-a.next)||a.slot-b.slot);
  return{...base,...navigatorSnapshot(r),v:FRONTIER_RALLY_VERSION,average,limit:50,timing,reason,players,...(r.coursePlan?{coursePlan:structuredClone(r.coursePlan)}:{})};
 }
 progress(r,p,old,at){
  if(p.finishMs!==null||p.dnf)return;const speedKph=Math.hypot(p.car.vx,p.car.vz)*3.6;p.speedPenaltyMs=(p.speedPenaltyMs??0)+Math.max(0,speedKph-50)*(1/60)*200;
  let crossedAt=at;for(let n=0;n<3&&p.next<r.route.gates.length;n++){
   const gate=r.route.gates[p.next],previous=p.next?r.route.gates[p.next-1]:r.route.start,nx=gate.x-previous.x,nz=gate.z-previous.z,norm=Math.hypot(nx,nz);if(norm<1e-6){if(!p.next||Math.hypot(p.car.x-gate.x,p.car.z-gate.z)>8)break;}else{
    const a=((old.x-gate.x)*nx+(old.z-gate.z)*nz)/norm,b=((p.car.x-gate.x)*nx+(p.car.z-gate.z)*nz)/norm;if(!(a<=.0001&&b>=0&&b>a+.000001))break;
    const t=Math.max(0,Math.min(1,-a/(b-a))),x=old.x+(p.car.x-old.x)*t,z=old.z+(p.car.z-old.z)*t,y=old.y+(p.car.y-old.y)*t-ROAD_Y;if(Math.hypot(x-gate.x,z-gate.z)>10||Math.abs(y-gate.y)>1.5)break;crossedAt=at-1000/60+t*1000/60;
   }
   const timing=r.timing.find(t=>t.gate===p.next);if(timing){const actualMs=Math.max(0,Math.round(crossedAt-r.startAt)),deltaMs=actualMs-timing.dueMs;p.arrivals.push({gate:p.next,dueMs:timing.dueMs,actualMs,deltaMs});p.timingPenaltyMs+=Math.abs(deltaMs);}p.next++;
   if(p.next===r.route.gates.length){p.finishMs=Math.max(.001,crossedAt-r.startAt);p.completedLaps=1;p.lapTimes=[p.finishMs];p.input=idle();p.queue=[];p.car.vx=p.car.vz=p.car.w=0;}
  }
  p.distance=p.next===r.route.gates.length?r.route.length:Math.min(r.route.length,p.next*30);
 }
 skipBaseTick(r){return !!r.navigator;}
 simulate(r,at){if(r.navigator)navigatorSimulate(this,r,at);else super.simulate(r,at);}
 tick(now=this.now()){
  if(this.closed)return;for(const r of this.rooms.values()){
   if(r.navigator){navigatorTick(this,r,now);continue;}
   for(const p of [...r.players.values()])if(!p.client&&p.disconnectedAt&&now>=(p.resumeExpiresAt??p.disconnectedAt+15000)){p.token='';p.resumeGrant=null;if(['racing','results'].includes(r.phase)){if(p.finishMs===null)p.dnf??='斷線超過15秒';}else{r.players.delete(p.id);r.revision++;for(const q of r.players.values())q.ready=false;}}
   const active=r.phase==='racing'||r.phase==='countdown'&&now>=r.startAt&&r.players.size>=2&&[...r.players.values()].every(p=>p.client&&p.ready);
   if(active&&now-r.simAt>1000){r.reason='server-stall';r.phase='results';for(const p of r.players.values()){p.dnf='伺服器模擬中斷，本場取消';p.input=idle();p.queue=[];p.car.vx=p.car.vz=p.car.w=0;}this.broadcast(r,now);}
  }super.tick(now);
 }
 drop(c){if(!this.clients.has(c))return;this.clients.delete(c);const p=c.player;if(p&&p.client===c){p.client=null;p.disconnectedAt=this.now();p.resumeExpiresAt??=p.disconnectedAt+15000;p.input=idle();p.queue=[];}c.room=c.player=null;if(!this.closed)this.tick(this.now());}
 close(){this.closed=true;super.close();this.routeDefinition=null;}
}
