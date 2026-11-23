import {randomBytes,timingSafeEqual} from 'node:crypto';
import {FreeCar,ROAD_Y} from './summit-city-physics.mjs';
import {realCityWorld} from './summit-city-race-service.mjs';
import {EXPEDITION_DUTY_VERSION,CREW_DEPOT,CREW_INCIDENT,DUTY_CREW_GRACE,CREW_MAX_VIEWERS,crewCode} from '../shared/expedition-duty.ts';
import {CityReplayRecorder} from './frontier-city-replay-service.mjs';
import {CITY_REPLAY_VERSION} from '../shared/frontier-city-replay.ts';
import {CITY_AUTO_RESUME_VERSION} from '../shared/frontier-city-resume.ts';
import {DUTY_MISSIONS_VERSION,DUTY_INCIDENTS,DUTY_DIFFICULTIES,defaultDutyMissionSettings,parseDutyMissionSettings,newDutyMission} from '../shared/frontier-duty-missions.ts';
import {COOP_STATIONS} from '../shared/nexus-coop.ts';
import {CREW_TEAM_VERSION,TEAM_ROLES} from '../shared/aurora-duty.ts';
import {newCrewTeam,resetTeamCase,resetTeamRoster,hasRole,crewConnected,teamSafetyReady,teamBriefed,teamDepotClear,teamWork,stepCrewTeam,handleCrewTeam} from './aurora-duty-service.mjs';
const idle=()=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v),finite=v=>typeof v==='number'&&Number.isFinite(v);
const token=n=>randomBytes(n).toString('hex'),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const spec=loaded=>({engine:loaded?3.1:4.4,vmax:loaded?20:25,brake:loaded?7.8:10,grip:loaded?6.8:8,mass:loaded?7.2:4.5});
const geometry=()=>({wheelbase:4.5,inertia:7.5,radius:1.18,offsets:[2.7,1.35,0,-1.35,-2.7],halfWidth:1.05,surfaceSpan:2.25});
const seatError=(code,message)=>Object.assign(Error(message),{code});
const equalToken=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class ExpeditionDutyService{
 constructor(o={}){this.now=o.now??Date.now;this.worldFactory=o.worldFactory??realCityWorld;this.maxRooms=o.maxRooms??3;this.maxClients=o.maxClients??16;this.rooms=new Map();this.clients=new Set();this.worldRef=null;this.closed=false;}
 world(){return this.worldRef??=this.worldFactory();}
 route(a,b,via=[]){const roads=this.world().roads,nodes=[a,...via,b].map(p=>roads.nearest(p.x,p.z,'ground',150));if(nodes.some(n=>!n))throw Error('救援路線無法連接道路');const r=roads.route(nodes.map(n=>n.id)),last=r.path.at(-1),prev=r.path.at(-2);
 return{path:r.path,ys:r.ys,length:r.length,start:{...r.start,y:r.start.y+ROAD_Y,name:a.name},target:{x:last[0],z:last[1],y:r.ys.at(-1)+ROAD_Y,h:Math.atan2(last[0]-prev[0],last[1]-prev[1]),name:b.name},gates:r.gates.map(g=>({...g,y:g.y+ROAD_Y}))};}
 plans(settings){return settings.incidents.map(id=>{const incident=DUTY_INCIDENTS.find(row=>row.id===id),outbound=this.route(CREW_DEPOT,incident,id==='civic'?[COOP_STATIONS[5]]:[]),homebound=this.route(incident,CREW_DEPOT,id==='xinan'?[{x:-468.9,z:1274.2,y:0}]:[]);outbound.target.h=wrap(outbound.target.h+incident.angle);return{outbound,homebound};});}
 selectCase(r,index){const plan=r.plans[index];r.outbound=plan.outbound;r.homebound=plan.homebound;r.route=r.outbound;r.mission.caseIndex=index;r.next=0;r.dwell=r.operation=0;r.winch={along:0,lateral:.85,blocked:false};r.stage='approach';r.car.spec=spec(false);r.input=idle();r.heldAt=-Infinity;resetTeamCase(r);}
 send(c,m){if(c.ws.readyState!==1)return false;try{const text=JSON.stringify(m);if(c.ws.bufferedAmount+Buffer.byteLength(text)>256*1024){c.ws.close(1013,'救援連線過慢');return false;}c.ws.send(text);return true;}catch{c.ws.terminate?.();return false;}}
 envelope(r){return{watch:{count:r.viewers.size,max:CREW_MAX_VIEWERS},replay:r.replay?.descriptor()??null};}
 record(r,now){
  if(!r.replay)return;const c=r.car,loaded=['returning','unloading','complete'].includes(r.stage),working=['winch','securing'].includes(r.stage),base=working?c:r.outbound.target,along=-7+(working?r.winch.along:0);
  r.replay.sample(now,[{key:'truck',slot:0,vehicle:'rescue',role:'truck',connected:crewConnected(r),pose:{x:c.x,y:c.y,z:c.z,h:wrap(c.h),vx:c.vx,vz:c.vz,steer:c.steer,pitch:c.pitch,roll:c.roll}}],{duty:{stage:r.stage,integrity:r.integrity,operation:r.operation,dwell:r.dwell,next:r.next,winch:{...r.winch},loaded,incident:loaded?null:{x:base.x+Math.sin(base.h)*along+Math.cos(base.h)*r.winch.lateral,y:base.y+(working?r.winch.along/4.2:0),z:base.z+Math.cos(base.h)*along-Math.sin(base.h)*r.winch.lateral,h:wrap(base.h)}}});
  if(r.recordedStage!==r.stage){r.replay.event(now,'stage',['truck'],r.stage);r.recordedStage=r.stage;}
  if(r.phase==='finished'&&!r.replay.descriptor().ready){r.replay.event(now,'finish',['truck']);const reason=r.stage==='complete'?'complete':r.integrity===0?'integrity':r.elapsed>1800?'timeout':'invalid-state';r.replay.finish(now,reason);}
 }
 error(c,message,request,code){this.send(c,{type:'error',message,request,...code?{code}:{}});}
 accept(ws){if(this.closed||this.clients.size>=this.maxClients){ws.close(1013,'救援服務連線已滿');return null;}const c={ws,room:null,player:null,viewer:null,alive:true,window:this.now(),count:0,lastSeen:this.now()};this.clients.add(c);this.send(c,{type:'hello',v:EXPEDITION_DUTY_VERSION,features:{cityWatch:1,cityReplay:1,cityReplayVersion:CITY_REPLAY_VERSION,autoResumeVersion:CITY_AUTO_RESUME_VERSION,dutyMissionsVersion:DUTY_MISSIONS_VERSION,crewTeamVersion:CREW_TEAM_VERSION}});ws.on('pong',()=>c.alive=true);
 ws.on('message',raw=>{const now=this.now();if(now-c.window>=1000){c.window=now;c.count=0;}if(++c.count>80||raw.length>4096){ws.close(1008,'救援指令超限');return;}let m;try{m=JSON.parse(String(raw));}catch{return this.error(c,'救援指令格式錯誤');}if(!obj(m)||typeof m.type!=='string')return this.error(c,'救援指令格式錯誤');c.lastSeen=now;try{this.receive(c,m,now);}catch(e){this.error(c,e.message,m.request,e.code);}});ws.on('close',()=>this.drop(c));ws.on('error',()=>this.drop(c));return c;}
 receive(c,m,now){
  if(!this.clients.has(c)||this.closed)throw Error('救援連線已結束');
  if(m.type==='ping'){this.send(c,{type:'pong',sentAt:m.sentAt,serverTime:this.now()});return;}
  if(m.type==='watch'){
   if(c.room||m.v!==EXPEDITION_DUTY_VERSION||!crewCode(m.code)||Object.keys(m).some(k=>!['type','v','code','crewTeamVersion'].includes(k)))throw Error('請先離開原房，再填六碼房間觀戰');
   const r=this.rooms.get(m.code);if(!r||!r.players.size)throw Error('找不到可觀戰的救援房');if(r.team&&m.crewTeamVersion!==CREW_TEAM_VERSION)throw seatError('VERSION_MISMATCH','請更新後再觀戰2～4人救援隊');if(r.viewers.size>=CREW_MAX_VIEWERS)throw Error('觀眾已滿，最多四位');
   c.room=r;c.viewer=token(10);r.viewers.set(c.viewer,c);this.send(c,{type:'watching',v:EXPEDITION_DUTY_VERSION,viewerId:c.viewer,room:this.snapshot(r,now),...this.envelope(r)});this.broadcast(r,now);return;
  }
  if(m.type==='city-replay-chunk'){
   const r=c.room;if(!r||r.phase!=='finished'||!r.replay||Object.keys(m).length!==3||Object.keys(m).some(k=>!['type','key','offset'].includes(k))||typeof m.key!=='string'||m.key.length>80||!Number.isSafeInteger(m.offset)||m.offset<0)throw Error('匿名回放只可於本房勤務結束後逐塊取得');
   this.send(c,r.replay.part(m.key,m.offset));return;
  }
  if(c.viewer){if(m.type==='watch-leave'||m.type==='leave'){this.removeViewer(c);return;}throw Error('觀眾只能觀戰、離開及取得賽後匿名回放');}
  if(['create','join','resume'].includes(m.type)){
   if(c.room)throw Error('請先離開目前救援房');if(m.v!==EXPEDITION_DUTY_VERSION)throw seatError('VERSION_MISMATCH','合作救援版本不相容');
   let r,p;
   if(m.type==='resume'){
    if(!crewCode(m.code)||typeof m.selfId!=='string'||!/^[a-f0-9]{20}$/.test(m.selfId)||Object.keys(m).some(k=>!['type','v','code','selfId','token','resumeKey','name','endpoint','crewTeamVersion'].includes(k))||m.resumeKey!==undefined&&(typeof m.resumeKey!=='string'||!/^[a-f0-9]{24}$/.test(m.resumeKey)))throw seatError('SEAT_REJECTED','救援續接資料無效');
    r=this.rooms.get(m.code);if(!r)throw seatError('ROOM_GONE','原救援房間已結束');p=r.players.get(m.selfId);if(!p)throw seatError('SEAT_EXPIRED','原救援席位已釋放');
    if(r.team&&m.crewTeamVersion!==CREW_TEAM_VERSION)throw seatError('VERSION_MISMATCH','多人救援隊需要同步更新前後端');
    const grant=p.resumeGrant,same=grant&&m.resumeKey===grant.key&&(equalToken(m.token,grant.oldToken)||equalToken(m.token,grant.newToken)),current=equalToken(m.token,p.token);
    if(!same&&!current)throw seatError('SEAT_REJECTED','救援席位憑證已失效');
    if(p.client)throw seatError('SEAT_BUSY','原席位仍有連線，正在等待釋放');
    const expiresAt=p.resumeExpiresAt||p.disconnectedAt+DUTY_CREW_GRACE;if(!p.disconnectedAt||now>=expiresAt)throw seatError('SEAT_EXPIRED','救援席位保留已超過15秒');
    if(same){if(now>=grant.expiresAt||grant.runId!==r.runId||grant.revision!==r.revision)throw seatError('SEAT_EXPIRED','本次救援續接已到期');}
    else{const oldToken=p.token;p.token=token(32);p.resumeGrant=m.resumeKey?{key:m.resumeKey,oldToken,newToken:p.token,expiresAt,runId:r.runId,revision:r.revision}:null;}
    p.resumeKey=m.resumeKey??'';p.resumeExpiresAt=m.resumeKey?expiresAt:0;
   }
   else{if(typeof m.name!=='string'||!m.name.trim()||m.name.trim().length>20||/[\x00-\x1f\x7f<>]/.test(m.name))throw Error('暱稱請填1～20字');
    if(m.type==='create'){if(this.rooms.size>=this.maxRooms)throw Error('救援房間已滿');let code;do{code=Array.from(randomBytes(6),b=>alphabet[b%32]).join('');}while(this.rooms.has(code));
     const settings=defaultDutyMissionSettings(),plans=this.plans(settings),{outbound,homebound}=plans[0];r={code,hostId:'',players:new Map(),viewers:new Map(),outbound,homebound,route:outbound,plans,mission:newDutyMission(settings),revision:1,runId:token(10),phase:'lobby',stage:'approach',startedAt:null,elapsed:0,car:new FreeCar(),input:idle(),received:0,ack:0,lastInputAt:now,simAt:now,lastBroadcast:0,operation:0,held:{kind:'',pull:0,side:0},heldAt:-Infinity,next:0,dwell:0,integrity:100,winch:{along:0,lateral:.85,blocked:false},reason:'',...m.crewTeamVersion===CREW_TEAM_VERSION?{team:newCrewTeam()}:{}};this.rooms.set(code,r);this.place(r);}
    else{if(!crewCode(m.code))throw Error('請填六碼救援房間碼');r=this.rooms.get(m.code);if(!r||r.phase!=='lobby'||r.players.size>=(r.team?4:2))throw Error('房間不存在、已開始或已滿');if(r.team&&m.crewTeamVersion!==CREW_TEAM_VERSION)throw seatError('VERSION_MISMATCH','多人救援隊需要同步更新前後端');}
    const role=(r.team?TEAM_ROLES:['driver','technician']).find(role=>![...r.players.values()].some(q=>q.role===role));p={id:token(10),token:token(32),name:m.name.trim(),role,ready:false,client:null,disconnectedAt:0,resumeGrant:null,resumeKey:'',resumeExpiresAt:0};r.players.set(p.id,p);if(!r.hostId)r.hostId=p.id;r.revision++;resetTeamRoster(r);for(const q of r.players.values())q.ready=false;
   }
   p.client=c;p.disconnectedAt=0;c.room=r;c.player=p;r.input=idle();r.received=r.ack;r.heldAt=-Infinity;if(m.type==='resume'){if(r.team){r.team.covers=r.team.covers.filter(row=>row.role!==p.role);r.safetyHeld=null;}r.replay?.event(now,'reconnect',['truck']);this.record(r,now);}this.send(c,{type:'welcome',selfId:p.id,token:p.token,room:this.snapshot(r,now),...this.envelope(r)});this.broadcast(r,now);return;
  }
  const r=c.room,p=c.player;if(!r||!p)throw Error('請先加入救援房');
  if(m.type==='leave'){this.remove(c);return;}
  if(m.revision!==r.revision||m.runId!==r.runId)throw Error('救援場次已更新，請確認後重試');
  if(handleCrewTeam(this,r,p,m,now))return;
  if(m.type==='confirm-resume'){
   const confirmed=p.lastConfirmed,same=confirmed&&confirmed.client===c&&confirmed.key===m.resumeKey&&confirmed.runId===r.runId&&confirmed.revision===r.revision;
   if(typeof m.resumeKey!=='string'||!/^[a-f0-9]{24}$/.test(m.resumeKey)||!same&&(!p.resumeKey||m.resumeKey!==p.resumeKey)||Object.keys(m).some(k=>!['type','revision','runId','resumeKey'].includes(k)))throw seatError('SEAT_REJECTED','救援續接確認已失效');
   this.clearResume(p);p.lastConfirmed={key:m.resumeKey,runId:r.runId,revision:r.revision,client:c};this.send(c,{type:'resume-confirmed',resumeKey:m.resumeKey,runId:r.runId,revision:r.revision});return;
  }
  if(m.type==='ready'){if(r.phase!=='lobby'||typeof m.ready!=='boolean')throw Error('目前無法準備');p.ready=m.ready;this.broadcast(r,now);return;}
  if(m.type==='mission-settings'){
   const settings=parseDutyMissionSettings(m.settings);if(p.id!==r.hostId||r.phase!=='lobby'||[...r.players.values()].some(q=>!q.client||q.resumeKey)||!settings||Object.keys(m).length!==4||Object.keys(m).some(k=>!['type','revision','runId','settings'].includes(k)))throw Error('僅房主可在大廳、所有隊員連線確認後選擇1～3個不同事故及難度');
   const plans=this.plans(settings);r.plans=plans;r.mission=newDutyMission(settings);this.selectCase(r,0);r.revision++;this.place(r);r.received=r.ack=0;for(const q of r.players.values()){q.ready=false;this.clearResume(q);}this.broadcast(r,now);return;
  }
  if(m.type==='swap-roles'){
   if(p.id!==r.hostId||r.phase!=='lobby'||r.players.size<2||[...r.players.values()].some(q=>!q.client||q.resumeKey)||Object.keys(m).length!==3)throw Error('房主可在下場大廳、隊員在線確認後輪換職責');
   const players=[...r.players.values()],roles=players.map(q=>q.role);players.forEach((q,i)=>{q.role=roles[(i+1)%roles.length];q.ready=false;this.clearResume(q);q.lastConfirmed=null;});resetTeamRoster(r);r.revision++;r.received=r.ack=0;r.input=idle();r.heldAt=-Infinity;r.car.vx=r.car.vz=r.car.w=0;this.broadcast(r,now);return;
  }
  if(m.type==='start'){if(r.hostId!==p.id||r.phase!=='lobby'||!crewConnected(r)||![...r.players.values()].every(q=>q.client&&q.ready))throw Error('需要2～4位不同職責隊員都準備');r.phase='running';r.startedAt=now;r.simAt=now;r.replay=new CityReplayRecorder({source:'duty',mode:'rescue'});r.recordedStage='';r.recordedOperation='';this.record(r,now);this.broadcast(r,now);return;}
  if(m.type==='again'||m.type==='cancel'){if(r.hostId!==p.id||m.type==='again'&&r.phase!=='finished')throw Error('請由房主重開或取消');this.reset(r,now);this.broadcast(r,now);return;}
  if(r.phase!=='running'||!crewConnected(r)||r.team&&p.resumeKey)throw Error('隊員未齊、續接未確認或勤務尚未開始');
  if(m.type==='input'){
   if(!hasRole(r,p,'driver')||!Number.isSafeInteger(m.seq)||m.seq<=r.received||m.seq>r.received+1000||!finite(m.steer)||Math.abs(m.steer)>1||!['throttle','brake','handbrake','active'].every(k=>typeof m[k]==='boolean')||Object.keys(m).some(k=>!['type','revision','runId','seq','steer','throttle','brake','handbrake','active'].includes(k)))throw Error('只有司機可傳送有效操控，不接受位置或成績');
   this.clearResume(p);r.received=r.ack=m.seq;r.input={steer:m.steer,throttle:m.throttle,brake:m.brake,handbrake:m.handbrake,active:m.active};r.lastInputAt=now;return;
  }
  if(m.type==='operate'){
   if(!hasRole(r,p,'technician')||!['warning','winch','unload','stop'].includes(m.kind)||!finite(m.pull)||Math.abs(m.pull)>1||!finite(m.side)||Math.abs(m.side)>1||Object.keys(m).some(k=>!['type','revision','runId','kind','pull','side'].includes(k)))throw Error('只有協助者可操作警示／絞盤／卸載');
   this.clearResume(p);r.held={kind:m.kind,pull:m.pull,side:m.side};r.heldAt=now;const action=m.kind==='winch'?(m.pull>0?'wind':m.pull<0?'unwind':'technician'):m.kind==='stop'?'':m.kind;if(action!==r.recordedOperation){r.replay?.event(now,'operation',['truck'],action);r.recordedOperation=action;}return;
  }
  if(m.type==='action'){
   if(!hasRole(r,p,'driver')||!this.docked(r))throw Error('司機須沿順序路線同層對準，停穩1.5秒');
   if(!teamBriefed(r)||!teamSafetyReady(r,now,r.stage==='securing'))throw Error('請等待調度事故簡報、前後警示與警戒淨空確認');
   if(r.stage==='positioning'){r.replay?.event(now,'operation',['truck'],'position');r.stage='winch';r.operation=0;}
   else if(r.stage==='securing'&&r.winch.along>=4.19&&Math.abs(r.winch.lateral)<=.35){r.replay?.event(now,'operation',['truck'],'secure');r.stage='returning';r.route=r.homebound;r.next=0;r.dwell=0;r.operation=0;r.car.spec=spec(true);}
   else throw Error('目前沒有可由司機確認的作業');
   teamWork(r,'driver');this.record(r,now);this.broadcast(r,now);return;
  }
  throw Error('不支援的救援指令');
 }
 clearResume(p){p.resumeGrant=null;p.resumeKey='';p.resumeExpiresAt=0;}
 place(r){const s=r.route.start;FreeCar.surface=this.world().surfaceAt;r.car.spec=spec(false);r.car.geometry=geometry();r.car.place(s.x,s.z,s.h,s.y);r.car.y=s.y;}
 reset(r,now){r.replay?.reset();r.replay=null;r.recordedStage='';r.recordedOperation='';r.revision++;r.runId=token(10);r.phase='lobby';r.mission=newDutyMission(r.mission.settings);this.selectCase(r,0);r.startedAt=null;r.elapsed=0;r.integrity=100;r.reason='';r.ack=r.received=0;r.simAt=now;this.place(r);if(r.team){const players=[...r.players.values()];for(const role of ['driver','technician'])if(!players.some(p=>p.role===role)){const next=players.find(p=>!['driver','technician'].includes(p.role));if(next)next.role=role;}if(players.length===1)players[0].role='driver';resetTeamRoster(r);}for(const p of r.players.values()){p.ready=false;p.resumeGrant=null;p.lastConfirmed=null;if(p.client&&!p.resumeKey)p.resumeExpiresAt=0;}}
 aligned(r){const c=r.car,t=r.route.target,d=DUTY_DIFFICULTIES[r.mission.settings.difficulty];return r.next===r.route.gates.length&&Math.hypot(c.x-t.x,c.z-t.z)<d.radius&&Math.abs(c.y-t.y)<d.height&&Math.abs(wrap(c.h-t.h))<d.angle&&Math.hypot(c.vx,c.vz)<d.speed;}
 docked(r){return this.aligned(r)&&r.dwell>=DUTY_DIFFICULTIES[r.mission.settings.difficulty].dwell;}
 step(r,at){const c=r.car,world=this.world(),connected=crewConnected(r);if(!connected){c.vx=c.vz=c.w=0;r.input=idle();r.heldAt=-Infinity;return;}
  r.elapsed+=1/30;if(r.elapsed-r.mission.caseStartedElapsed>1800){r.phase='finished';r.reason='本件事故勤務超過30分鐘';return;}
  FreeCar.surface=world.surfaceAt;const driving=['approach','positioning','returning'].includes(r.stage),fresh=at-r.lastInputAt<600&&r.input.active;
  const input=driving&&fresh?r.input:idle(),old={x:c.x,z:c.z,y:c.y};const impact=c.update(1/30,input.steer,input.throttle,input.brake||input.handbrake,world.collider);
  if(impact>2)r.replay?.event(at,'contact',['truck']);
  if(!driving||!fresh){c.vx*=.65;c.vz*=.65;c.w*=.65;if(Math.hypot(c.vx,c.vz)<.2)c.vx=c.vz=c.w=0;}
  if(![c.x,c.z,c.y,c.vx,c.vz].every(finite)){r.phase='finished';r.reason='車況異常，請重新接班';this.place(r);return;}
  if(r.stage==='returning'&&impact>2){r.integrity=Math.max(0,r.integrity-impact*2*DUTY_DIFFICULTIES[r.mission.settings.difficulty].damage);if(r.integrity===0){r.phase='finished';r.reason='故障車完整度耗盡';return;}}
  if(['approach','returning'].includes(r.stage)){const g=r.route.gates[r.next];if(g){const dx=c.x-old.x,dz=c.z-old.z,t=Math.max(0,Math.min(1,((g.x-old.x)*dx+(g.z-old.z)*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(old.x+dx*t-g.x,old.z+dz*t-g.z)<10&&Math.abs(old.y+(c.y-old.y)*t-g.y)<1.8)r.next++;}}
  const aligned=this.aligned(r);
  stepCrewTeam(r,at,1/30);
  r.dwell=aligned?Math.min(2,r.dwell+1/30):0;
  if(this.docked(r)&&r.stage==='approach')r.stage='warning';
  if(this.docked(r)&&r.stage==='returning')r.stage='unloading';
  const held=at-r.heldAt<450?r.held:{kind:'stop',pull:0,side:0};
  if(r.stage==='warning'||r.stage==='unloading'){
   const expected=r.stage==='warning'?'warning':'unload';r.operation=this.docked(r)&&held.kind===expected&&(r.stage!=='unloading'||teamDepotClear(r))?Math.min(5,r.operation+1/30):0;
   if(r.operation>=(r.stage==='warning'?2:3)){teamWork(r,'technician');r.operation=0;if(r.stage==='warning')r.stage='positioning';else{
    r.mission.completed.push({incidentId:r.mission.settings.incidents[r.mission.caseIndex],seconds:r.elapsed-r.mission.caseStartedElapsed,integrity:r.integrity});c.vx=c.vz=c.w=0;
    if(r.mission.caseIndex+1<r.mission.settings.incidents.length){r.mission.caseStartedElapsed=r.elapsed;this.selectCase(r,r.mission.caseIndex+1);this.broadcast(r,at);}
    else{r.stage='complete';r.phase='finished';r.reason=r.players.size+'人合作完成全部'+r.mission.settings.incidents.length+'件救援';}
   }}
  }else if(r.stage==='winch'&&this.docked(r)&&held.kind==='winch'&&teamSafetyReady(r,at,true)){
   const w=r.winch;w.lateral=Math.max(-1.4,Math.min(1.4,w.lateral+held.side*.32/30));w.blocked=held.pull>0&&Math.abs(w.lateral)>.35;if(!w.blocked)w.along=Math.max(0,Math.min(4.2,w.along+held.pull*.48/30));if(w.along>=4.19&&Math.abs(w.lateral)<=.35){teamWork(r,'technician');r.stage='securing';}
  }
 }
 snapshot(r,now=this.now()){const c=r.car;return{v:EXPEDITION_DUTY_VERSION,code:r.code,hostId:r.hostId,revision:r.revision,runId:r.runId,phase:r.phase,stage:r.stage,serverTime:now,startedAt:r.startedAt,elapsed:r.elapsed,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,role:p.role,ready:p.ready,connected:!!p.client})),pose:{x:c.x,z:c.z,y:c.y,h:wrap(c.h),vx:c.vx,vz:c.vz,steer:c.steer,pitch:c.pitch,roll:c.roll},ack:r.ack,next:r.next,dwell:r.dwell,integrity:r.integrity,winch:{...r.winch},operation:r.operation,paused:!crewConnected(r),reason:r.reason,route:r.route,outbound:r.outbound,homebound:r.homebound,mission:structuredClone(r.mission),...r.team?{team:structuredClone(r.team)}:{}};}
 broadcast(r,now=this.now(),light=false){const room=this.snapshot(r,now);if(light){delete room.route;delete room.outbound;delete room.homebound;}const message={type:light?'state':'room',room,...this.envelope(r)};for(const p of r.players.values())if(p.client)this.send(p.client,message);for(const c of r.viewers.values())this.send(c,message);r.lastBroadcast=now;}
 tick(now=this.now()){for(const r of this.rooms.values()){
  for(const p of [...r.players.values()]){if(p.resumeGrant&&now>=p.resumeGrant.expiresAt)p.resumeGrant=null;if(!p.client&&p.disconnectedAt&&now>=(p.resumeExpiresAt||p.disconnectedAt+DUTY_CREW_GRACE)){this.clearResume(p);r.players.delete(p.id);if(r.team)r.team.covers=r.team.covers.filter(row=>row.playerId!==p.id);if(r.players.size){const remain=[...r.players.values()].find(p=>p.client)??[...r.players.values()][0];if(!r.players.has(r.hostId))r.hostId=remain.id;if(r.team&&r.phase==='running'){r.revision++;r.input=idle();r.heldAt=-Infinity;}else{if(!r.team)remain.role='driver';this.reset(r,now);}}}}
  if(!r.players.size){r.replay?.reset();this.endViewers(r,'房間隊員已離開');this.rooms.delete(r.code);continue;}
  if(r.phase==='running'){const steps=Math.min(6,Math.floor((now-r.simAt)/(1000/30)));for(let i=0;i<steps&&r.phase==='running';i++){r.simAt+=1000/30;this.step(r,r.simAt);this.record(r,r.simAt);}if(now-r.simAt>250)r.simAt=now;}
  if(now-r.lastBroadcast>=100)this.broadcast(r,now,true);
 }}
 removeViewer(c,notify=true){const r=c.room;if(r&&c.viewer)r.viewers.delete(c.viewer);c.room=c.player=c.viewer=null;if(notify)this.send(c,{type:'left'});if(r&&this.rooms.has(r.code))this.broadcast(r);}
 endViewers(r,reason){for(const c of r.viewers.values()){c.room=c.player=c.viewer=null;this.send(c,{type:'watch-ended',reason});c.ws.close(1000,'救援觀戰結束');}r.viewers.clear();}
 drop(c){this.clients.delete(c);if(c.viewer){this.removeViewer(c,false);return;}if(c.room&&c.player&&c.player.client===c){const r=c.room,p=c.player;p.client=null;p.lastConfirmed=null;p.disconnectedAt=this.now()||1;p.resumeExpiresAt||=p.disconnectedAt+DUTY_CREW_GRACE;r.input=idle();r.heldAt=-Infinity;if(r.team){r.team.covers=r.team.covers.filter(row=>row.playerId!==p.id);r.safetyHeld=null;if(r.hostId===p.id){const next=[...r.players.values()].find(q=>q.client);if(next){r.hostId=next.id;r.revision++;}}}r.car.vx=r.car.vz=r.car.w=0;r.replay?.event(this.now(),'disconnect',['truck']);this.record(r,this.now());this.broadcast(r);}c.room=c.player=c.viewer=null;}
 remove(c){if(c.viewer){this.removeViewer(c);return;}const r=c.room,p=c.player;if(!r||!p)return;this.clearResume(p);p.token='';r.players.delete(p.id);if(r.team)r.team.covers=r.team.covers.filter(row=>row.playerId!==p.id);c.room=c.player=null;this.send(c,{type:'left'});if(!r.players.size){r.replay?.reset();this.endViewers(r,'房間隊員已離開');this.rooms.delete(r.code);return;}const remain=[...r.players.values()].find(q=>q.client)??[...r.players.values()][0];if(!r.players.has(r.hostId))r.hostId=remain.id;if(r.team&&r.phase==='running'){r.revision++;r.input=idle();r.heldAt=-Infinity;r.safetyHeld=null;r.car.vx=r.car.vz=r.car.w=0;r.replay?.event(this.now(),'leave',['truck']);}else{if(!r.team)remain.role='driver';this.reset(r,this.now());}this.broadcast(r);}
 heartbeat(){for(const c of this.clients){if(!c.alive||this.now()-c.lastSeen>45000){c.ws.terminate?.();this.drop(c);continue;}c.alive=false;c.ws.ping?.();}}
 close(){this.closed=true;for(const c of this.clients)c.ws.close(1001,'救援服務關閉');for(const r of this.rooms.values()){r.replay?.reset();for(const p of r.players.values())this.clearResume(p);}this.clients.clear();this.rooms.clear();}
}
