import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FreeCar,ROAD_Y,createCityRaceWorld,decodeWorkshop,streetContact} from './summit-city-physics.mjs';
import {CITY_RACE_VERSION,cityRaceCode,cityRaceLaps} from '../shared/summit-city-race.ts';
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v),finite=v=>typeof v==='number'&&Number.isFinite(v);
const id=n=>randomBytes(n).toString('hex'),idle=()=>({steer:0,throttle:false,brake:false,handbrake:false,active:false});
let cachedWorld;
export function realCityWorld(){if(cachedWorld)return cachedWorld;const base=new URL('../public/data/',import.meta.url),raw=JSON.parse(readFileSync(new URL('city.json',base),'utf8')),tiles=(raw.tiles?.list??[]).map(([x,z])=>{if(!Number.isSafeInteger(x)||!Number.isSafeInteger(z))throw Error('Invalid city tile index');return JSON.parse(readFileSync(new URL(`tiles/${x}_${z}.json`,base),'utf8'));});return cachedWorld=createCityRaceWorld(raw,tiles);}
const pose=c=>({x:c.x,z:c.z,y:c.y,h:Math.atan2(Math.sin(c.h),Math.cos(c.h)),vx:c.vx,vz:c.vz,steer:c.steer,pitch:c.pitch,roll:c.roll});
export class SummitCityRaceService {
  constructor(options={}){this.now=options.now??Date.now;this.worldFactory=options.worldFactory??realCityWorld;this.rooms=new Map();this.clients=new Set();this.maxClients=options.maxClients??48;this.maxRooms=options.maxRooms??12;this.worldRef=null;}
  world(){return this.worldRef??=this.worldFactory();}
  send(c,m){if(c.ws.readyState===1&&c.ws.bufferedAmount<1024*1024)c.ws.send(JSON.stringify(m));else if(c.ws.bufferedAmount>=1024*1024)c.ws.close(1013,'城市競速連線過慢');}
  error(c,text,request){this.send(c,{type:'error',message:text,request});}
  accept(ws){const c={ws,room:null,player:null,window:this.now(),count:0,lastSeen:this.now(),alive:true};this.clients.add(c);this.send(c,{type:'hello',v:CITY_RACE_VERSION});ws.on('pong',()=>c.alive=true);ws.on('message',raw=>{const now=this.now();if(now-c.window>=1000){c.window=now;c.count=0;}if(++c.count>90||raw.length>8192){ws.close(1008,'城市競速訊息超限');return;}let m;try{m=JSON.parse(String(raw));}catch{return this.error(c,'訊息格式無效');}if(!obj(m)||typeof m.type!=='string')return this.error(c,'訊息格式無效');c.lastSeen=now;try{this.receive(c,m,now);}catch(e){this.error(c,e.message,m.request);}});ws.on('close',()=>this.drop(c));return c;}
  receive(c,m,now){
    if(m.type==='ping'){this.send(c,{type:'pong',sentAt:m.sentAt,serverTime:now});return;}
    if(['create','join','resume'].includes(m.type)){
      if(c.room)throw Error('請先離開目前城市競速房');if(m.v!==CITY_RACE_VERSION)throw Error('城市競速版本不相容，請更新前後端');
      let room,p;
      if(m.type==='resume'){
        room=this.rooms.get(m.code);p=room?.players.get(m.selfId);if(!p||typeof m.token!=='string'||!/^[a-f0-9]{64}$/.test(m.token)||!p.token||!timingSafeEqual(Buffer.from(m.token),Buffer.from(p.token))||p.client||!p.disconnectedAt||now-p.disconnectedAt>15000)throw Error('城市競速席位無法續接');
      }else{
        if(typeof m.name!=='string'||!m.name.trim()||m.name.trim().length>20||/[\x00-\x1f\x7f<>]/.test(m.name))throw Error('暱稱請填1～20字');
        if(m.type==='create'){
          if(this.rooms.size>=this.maxRooms)throw Error('城市競速房已滿，請稍後再試');if(typeof m.challenge!=='string')throw Error('請貼上工坊NG1分享碼');
          const definition=decodeWorkshop(m.challenge);if(definition.v===2&&definition.nodes[0]!==definition.nodes.at(-1))throw Error('線上NG2必須是閉合路線');if(m.collisions!==undefined&&typeof m.collisions!=='boolean')throw Error('碰撞房規無效');const route=this.world().roads.validate(definition);if(route.gates.length>700)throw Error('城市路線過長');
          let code;do{code=Array.from(randomBytes(6),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');}while(this.rooms.has(code));
          room={code,hostId:'',revision:1,phase:'lobby',matchId:null,startAt:null,deadlineAt:null,collisions:m.collisions===true,definition,route,players:new Map(),updatedAt:now,simAt:now,lastBroadcast:0};this.rooms.set(code,room);
        }else{if(!cityRaceCode(m.code))throw Error('請輸入六碼城市競速房間碼');room=this.rooms.get(m.code);if(!room||room.phase!=='lobby')throw Error('房間不存在或已起跑');if(room.players.size>=4)throw Error('城市競速房已滿');}
        const slot=[0,1,2,3].find(s=>![...room.players.values()].some(p=>p.slot===s));p={id:id(10),token:id(32),name:m.name.trim(),slot,client:null,ready:false,next:0,distance:0,finishMs:null,dnf:null,ack:0,received:0,input:idle(),queue:[],motionRevision:0,completedLaps:0,lapTimes:[],lastLapAt:0,lastInputAt:now,disconnectedAt:0,ghostUntil:0,contactCount:0,lastContactAt:-Infinity,blockedAt:0,recoverAt:-Infinity,car:new FreeCar()};room.players.set(p.id,p);if(!room.hostId)room.hostId=p.id;this.place(room,p);room.revision++;for(const q of room.players.values())q.ready=false;
      }
      if(m.type==='resume'){p.token=id(32);p.motionRevision++;}p.client=c;p.disconnectedAt=0;p.input=idle();p.queue=[];p.lastInputAt=now;p.received=p.ack;c.player=p;c.room=room;room.updatedAt=now;this.send(c,{type:'welcome',selfId:p.id,token:p.token,resumed:m.type==='resume',room:this.snapshot(room,now)});this.broadcast(room,now);return;
    }
    const r=c.room,p=c.player;if(!r||!p)throw Error('請先加入城市競速房');r.updatedAt=now;
    if(m.type==='leave'){this.remove(c);return;}
    if(m.type==='recover'){
      if(r.phase!=='racing'||m.matchId!==r.matchId||m.revision!==r.revision||p.finishMs!==null||p.dnf||now-p.recoverAt<10000||Math.hypot(p.car.vx,p.car.vz)>2)throw Error('脫困須低於7.2km/h，每10秒一次，且僅限目前場次');
      this.recover(r,p,now);this.broadcast(r,now);return;
    }
    if(m.type==='input'){
      if(r.phase!=='racing'||p.finishMs!==null||p.dnf)return;if(m.matchId!==r.matchId||m.revision!==r.revision||m.motionRevision!==p.motionRevision||!Number.isSafeInteger(m.seq)||m.seq<=p.received||m.seq>p.received+10000||!finite(m.steer)||Math.abs(m.steer)>1||typeof m.throttle!=='boolean'||typeof m.brake!=='boolean'||typeof m.handbrake!=='boolean')throw Error('駕駛輸入或場次無效');
      if(Object.keys(m).some(k=>!['type','matchId','revision','motionRevision','seq','steer','throttle','brake','handbrake','active'].includes(k))||m.active!==undefined&&typeof m.active!=='boolean')throw Error('競速只接受操控輸入，不接受車況或位置');const input={seq:m.seq,steer:m.steer,throttle:m.throttle,brake:m.brake,handbrake:m.handbrake,active:m.active!==false};if(!input.active){p.queue=[];p.input=idle();}if(p.queue.length>=12)throw Error('城市操控佇列已滿');p.queue.push(input);p.received=m.seq;p.lastInputAt=now;return;
    }
    if(m.type==='ready'){
      if(r.phase!=='lobby'||m.revision!==r.revision||m.map!==r.definition.map||typeof m.ready!=='boolean')throw Error('路線設定已更新，請重新確認並準備');p.ready=m.ready;this.broadcast(r,now);return;
    }
    if(m.type==='start'){
      if(p.id!==r.hostId||r.phase!=='lobby'||m.revision!==r.revision||r.players.size<2||![...r.players.values()].every(q=>q.client&&q.ready))throw Error('需要房主及2～4位已確認路線的車手準備');
      r.phase='countdown';r.matchId=id(12);r.startAt=now+3000;r.deadlineAt=r.startAt+Math.min(600,r.definition.seconds)*1000;r.simAt=r.startAt;
      for(const q of r.players.values()){q.next=0;q.distance=0;q.finishMs=q.dnf=null;q.input=idle();q.queue=[];q.motionRevision++;q.completedLaps=0;q.lapTimes=[];q.lastLapAt=r.startAt;q.received=q.ack=0;q.ghostUntil=r.startAt+1500;q.contactCount=0;q.blockedAt=0;q.recoverAt=-Infinity;this.place(r,q);}this.broadcast(r,now);return;
    }
    if(m.type==='again'){
      if(p.id!==r.hostId||r.phase!=='results')throw Error('只有房主能在結算後再戰');r.phase='lobby';r.revision++;r.matchId=r.startAt=r.deadlineAt=null;for(const q of r.players.values()){q.ready=false;q.next=0;q.distance=0;q.finishMs=q.dnf=null;q.input=idle();q.queue=[];q.completedLaps=0;q.lapTimes=[];q.motionRevision++;this.place(r,q);}this.broadcast(r,now);return;
    }
    throw Error('不支援的城市競速指令');
  }
  place(r,p){const w=this.world();FreeCar.surface=w.surfaceAt;p.car.spec=w.spec(r.definition.car,['rain','rainnight'].includes(r.definition.weather));const s=r.route.start,lat=p.slot%2===0?-1.2:1.2,back=Math.floor(p.slot/2)*5;p.car.place(s.x+Math.cos(s.h)*lat-Math.sin(s.h)*back,s.z-Math.sin(s.h)*lat-Math.cos(s.h)*back,s.h,s.y+ROAD_Y);}
  snapshot(r,now=this.now()){return{v:CITY_RACE_VERSION,code:r.code,hostId:r.hostId,revision:r.revision,phase:r.phase,matchId:r.matchId,startAt:r.startAt,deadlineAt:r.deadlineAt,serverTime:now,collisions:r.collisions,definition:r.definition,route:r.route,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,slot:p.slot,connected:!!p.client,ready:p.ready,next:p.next,distance:p.distance,finishMs:p.finishMs,dnf:p.dnf,ack:p.ack,ghostUntil:p.ghostUntil,contactCount:p.contactCount,pose:pose(p.car),physics:{w:p.car.w,vy:p.car.vy},motionRevision:p.motionRevision,completedLaps:p.completedLaps,lapTimes:[...p.lapTimes]})).sort((a,b)=>(a.dnf?1:0)-(b.dnf?1:0)||(a.finishMs??Infinity)-(b.finishMs??Infinity)||(r.definition.v===2?b.completedLaps-a.completedLaps:0)||b.distance-a.distance||a.slot-b.slot)};}
  recover(r,p,now){const previous=p.next?r.route.gates[p.next-1]:r.route.start,next=r.route.gates[p.next]??previous,h=previous===r.route.start?previous.h:Math.atan2(next.x-previous.x,next.z-previous.z);FreeCar.surface=this.world().surfaceAt;p.car.place(previous.x-Math.sin(h)*3,previous.z-Math.cos(h)*3,h,previous.y+ROAD_Y);p.input=idle();p.queue=[];p.motionRevision++;p.lastInputAt=now;p.recoverAt=now;p.ghostUntil=now+3000;p.blockedAt=0;}
  broadcast(r,now=this.now(),state=false){const room=this.snapshot(r,now);if(state){delete room.route;delete room.definition;delete room.v;}for(const p of r.players.values())if(p.client)this.send(p.client,{type:state?'state':'room',room});r.lastBroadcast=now;}
  progress(r,p,old,at){
    const gate=r.route.gates[p.next];if(gate){const dx=p.car.x-old.x,dz=p.car.z-old.z;let t=Math.max(0,Math.min(1,((gate.x-old.x)*dx+(gate.z-old.z)*dz)/(dx*dx+dz*dz||1))),crossing=true;
      if(r.definition.v===2){const before=p.next?r.route.gates[p.next-1]:r.route.start,nx=gate.x-before.x,nz=gate.z-before.z,norm=Math.hypot(nx,nz),a=((old.x-gate.x)*nx+(old.z-gate.z)*nz)/norm,b=((p.car.x-gate.x)*nx+(p.car.z-gate.z)*nz)/norm;crossing=norm>1e-6&&a<=.0001&&b>=0&&b>a+.000001;if(crossing)t=Math.max(0,Math.min(1,-a/(b-a)));}
      const x=old.x+dx*t,z=old.z+dz*t,y=old.y+(p.car.y-old.y)*t-ROAD_Y;
      if(crossing&&Math.hypot(x-gate.x,z-gate.z)<(p.next===r.route.gates.length-1?8:12)&&Math.abs(y-gate.y)<2.2){p.next++;if(p.next===r.route.gates.length){const crossed=at-1000/60+t*1000/60;p.completedLaps++;p.lapTimes.push(Math.max(.001,crossed-p.lastLapAt));p.lastLapAt=crossed;if(p.completedLaps===cityRaceLaps(r.definition)){p.finishMs=p.lapTimes.reduce((a,b)=>a+b,0);p.input=idle();p.queue=[];p.car.vx=p.car.vz=p.car.w=0;}else p.next=0;}}
    }
    const next=r.route.gates[p.next];p.distance=p.completedLaps*r.route.length+(p.finishMs===null?Math.min(r.route.length,p.next*30+(next?Math.max(0,30-Math.hypot(p.car.x-next.x,p.car.z-next.z)):0)):0);
  }
  simulate(r,at){const w=this.world(),origins=new Map();FreeCar.surface=w.surfaceAt;for(const p of r.players.values()){
    // 收包時間由伺服器蓋章，可能比正在追趕的固定 simAt 新幾毫秒；這仍是有效輸入。
    if(p.dnf||p.finishMs!==null)continue;if(p.queue?.length){p.input=p.queue.shift();p.ack=p.input.seq;}const old={x:p.car.x,z:p.car.z,y:p.car.y},fresh=p.client&&at-p.lastInputAt<700&&p.input.active!==false,inp=fresh?p.input:idle();p.car.drift=inp.handbrake&&Math.abs(p.car.v)>8;p.car.update(1/60,inp.steer,inp.throttle,inp.brake,w.collider);if(!fresh){p.queue=[];p.car.vx*=.8;p.car.vz*=.8;p.car.w*=.8;if(Math.hypot(p.car.vx,p.car.vz)<.2)p.car.vx=p.car.vz=p.car.w=0;}
    if(![p.car.x,p.car.z,p.car.y,p.car.vx,p.car.vz].every(finite)){p.dnf='物理狀態無效';this.place(r,p);continue;}
    if(r.definition.v===2)origins.set(p,old);else this.progress(r,p,old,at);
  }
    if(r.collisions){const active=[...r.players.values()].filter(p=>!p.dnf&&p.finishMs===null&&p.client&&at>=p.ghostUntil);for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){const a=active[i],b=active[j],hit=streetContact(a.car,b.car);if(!hit.touch)continue;for(const p of[a,b]){if(at-p.lastContactAt>400){p.contactCount++;p.lastContactAt=at;}const slow=Math.hypot(p.car.vx,p.car.vz)<2;if(slow){p.blockedAt||=at;if(at-p.blockedAt>=4000){p.ghostUntil=at+3000;p.blockedAt=0;}}else p.blockedAt=0;}}
      for(const p of active)if(p.blockedAt&&at-p.lastContactAt>500)p.blockedAt=0;
    }
    // NG2裁定涵蓋本tick真車接觸的分離位移；NG1保留既有裁定順序。
    for(const [p,old]of origins)this.progress(r,p,old,at);
  }
  tick(now=this.now()){
    for(const r of this.rooms.values()){
      for(const p of [...r.players.values()])if(!p.client&&p.disconnectedAt&&now-p.disconnectedAt>15000){if(r.phase==='racing'||r.phase==='results'&&r.matchId){if(p.finishMs===null)p.dnf??='斷線超過15秒';}else{r.players.delete(p.id);r.revision++;for(const q of r.players.values())q.ready=false;}}
      if(!r.players.size){this.rooms.delete(r.code);continue;}if(!r.players.has(r.hostId)||!r.players.get(r.hostId).client)r.hostId=[...r.players.values()].find(p=>p.client)?.id??r.players.keys().next().value;
      // Retain disconnected results while another racer is present, but release
      // abandoned rooms once every remaining seat has exhausted its resume window.
      if([...r.players.values()].every(p=>!p.client&&p.disconnectedAt&&now-p.disconnectedAt>15000)){this.rooms.delete(r.code);continue;}
      if(r.phase==='countdown'&&(r.players.size<2||![...r.players.values()].every(p=>p.client&&p.ready))){r.phase='lobby';r.matchId=r.startAt=r.deadlineAt=null;r.revision++;for(const p of r.players.values())p.ready=false;this.broadcast(r,now);}
      if(r.phase==='countdown'&&now>=r.startAt){r.phase='racing';r.simAt=r.startAt;this.broadcast(r,now);}
      if(r.phase==='racing'){
        if(now-r.simAt>1000){for(const p of r.players.values())if(p.finishMs===null)p.dnf??='伺服器模擬中斷';}
        else {let steps=0;while(steps++<12&&r.simAt+1000/60<=Math.min(now,r.deadlineAt)+.0001){r.simAt+=1000/60;this.simulate(r,r.simAt);}}
        if(now>=r.deadlineAt)for(const p of r.players.values())if(p.finishMs===null)p.dnf??='比賽時間已到';
        if([...r.players.values()].every(p=>p.dnf||p.finishMs!==null)){r.phase='results';this.broadcast(r,now);}
      }
      if(now-r.lastBroadcast>=50)this.broadcast(r,now,true);
      if(now-r.updatedAt>30*60000){for(const p of r.players.values())if(p.client){p.client.room=p.client.player=null;this.send(p.client,{type:'expired',message:'城市競速房已到期'});}this.rooms.delete(r.code);}
    }
  }
  remove(c){const r=c.room,p=c.player;if(!r||!p)return;p.client=null;p.queue=[];if(r.phase==='racing'||r.phase==='countdown'){p.dnf??='主動離房';p.input=idle();p.disconnectedAt=this.now()-15001;}else{r.players.delete(p.id);r.revision++;for(const q of r.players.values())q.ready=false;}c.room=c.player=null;this.send(c,{type:'left'});this.tick(this.now());if(this.rooms.has(r.code))this.broadcast(r);}
  drop(c){this.clients.delete(c);if(c.player&&c.player.client===c){c.player.client=null;c.player.disconnectedAt=this.now();c.player.input=idle();c.player.queue=[];}c.room=c.player=null;this.tick(this.now());}
  heartbeat(){for(const c of this.clients){if(!c.alive){c.ws.terminate();continue;}c.alive=false;c.ws.ping();}}
  close(){for(const c of this.clients){if(c.player)c.player.client=null;c.room=c.player=null;c.ws.terminate();}this.clients.clear();this.rooms.clear();this.worldRef=null;}
}
