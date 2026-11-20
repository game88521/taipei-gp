// Rex <game88521@gmail.com>. Real loopback WebSocket authority and client; no external host, browser, or physics replacement.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {WebSocket as Socket,WebSocketServer} from '../../server/node_modules/ws/wrapper.mjs';
import {ExpeditionSocialService} from '../../server/expedition-social-service.mjs';
import {SOCIAL_VERSION,parseSocialRoom} from '../../shared/expedition-social.ts';
import {COOP_STATIONS} from '../../shared/nexus-coop.ts';
import {WireClient,settle} from './multiplayer-test-helpers.mjs';
import {pureUrl} from './pure-module-loader.mjs';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const C=await import(await pureUrl(root,'expedition-social-client.ts'));
const originalWebSocket=globalThis.WebSocket;
const report={status:'FAIL',localOnly:true,externalRequests:0,realLoopbackWebSocket:true,trueFreeCar:true,browserUsed:false,cases:[],limitations:['Server phase time is advanced deterministically through the real service tick; this does not establish external-network stability, phone layout, or human game balancing. No server pose or scoring fixture is used.'],...await startAudit(root,new URL(import.meta.url),['shared/expedition-social.ts','server/expedition-social-service.mjs','src/expedition-social-client.ts','src/expedition-social-ui.ts','src/expedition-social.css','server/odyssey-diagnostics.mjs','src/odyssey-diagnostics.ts','src/car.ts','src/track.ts','src/rivals.ts','src/pitlane.ts'])};
let now=1e6;
const service=new ExpeditionSocialService({now:()=>now,maxRooms:8,maxClients:48}),http=createServer(),wss=new WebSocketServer({server:http,maxPayload:4096});
const sockets=new Set(),peers=[],clients=[];
wss.on('connection',ws=>{sockets.add(ws);ws.on('close',()=>sockets.delete(ws));service.accept(ws);});
await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
const endpoint='ws://127.0.0.1:'+http.address().port+'/city-social';
globalThis.WebSocket=class extends Socket{constructor(url){assert.equal(url,endpoint);super(url);}};
const input={steer:.2,throttle:true,brake:false,handbrake:false,active:true};
const memory=()=>{const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};};
async function until(condition){const end=Date.now()+2500;while(!condition()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(condition(),'expected local condition within 2500ms');}
async function wire(){const c=await new WireClient(endpoint).open();peers.push(c);const hello=await c.until(m=>m.type==='hello');assert.equal(hello.v,SOCIAL_VERSION);return c;}
async function command(c,type,fields={},expected='room'){
 const mark=c.mark(),connection=[...service.clients].find(s=>s.ws._socket?.remotePort===c.ws._socket?.localPort),count=connection?.count,window=connection?.window;
 c.send({type,...fields});
 // A preceding join also broadcasts a room. Wait for this actual loopback message to be consumed, then match current authority rather than accepting a stale earlier broadcast.
 if(connection)await until(()=>!service.clients.has(connection)||connection.window!==window||connection.count>count);
 return c.until(m=>m.type===expected&&(expected!=='room'||JSON.stringify(m.room)===snapshot(service.rooms.get(m.room?.code))),mark);
}
async function create(mode='cruise'){const a=await wire(),wa=await command(a,'create',{v:SOCIAL_VERSION,name:'房主甲',vehicle:'sedan',mode,weather:'dry'},'welcome');return{a,wa,r:service.rooms.get(wa.room.code)};}
async function join(r,name='好友乙'){const c=await wire(),w=await command(c,'join',{v:SOCIAL_VERSION,name,vehicle:'muscle',code:r.code},'welcome');return{c,w};}
const manage=(r,action,targetId=r.hostId,extra={})=>({code:r.code,revision:r.revision,hostId:r.hostId,targetId,action,...extra});
const snapshot=r=>JSON.stringify(service.snapshot(r,now));
const carState=p=>JSON.stringify({pose:{x:p.car.x,y:p.car.y,z:p.car.z,h:p.car.h,vx:p.car.vx,vz:p.car.vz,w:p.car.w,vy:p.car.vy},vehicle:p.vehicle,epoch:p.epoch,ack:p.ack,points:p.points});
async function advance(ms){const end=now+ms;let n=0;while(now+1000/60<end+.001){now+=1000/60;service.tick(now);if(++n%12===0)await yieldIO();}now=end;service.tick(now);await settle();}
async function start(q,others=[]){for(const c of[q.a,...others])await command(c,'ready',{revision:q.r.revision,ready:true});await command(q.a,'start',{revision:q.r.revision});assert.equal(q.r.phase,'countdown');}
async function rejected(c,r,fields){const before=snapshot(r),error=await command(c,'manage',fields,'error');assert.equal(snapshot(r),before,'rejected management must not change public room state');assert.equal(typeof error.message,'string');return error;}
async function clean(){
 for(const c of clients.splice(0))c.disconnect();
 for(const c of peers.splice(0))await c.close();
 await settle();now+=16001;service.tick(now);await settle();
 assert.equal(service.rooms.size,0,'case cleanup must release all rooms');
 assert.equal(service.clients.size,0,'case cleanup must release all service clients');
}
async function test(name,fn){try{await clean();report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack).slice(0,5000)});}console.log(JSON.stringify(report.cases.at(-1)));}

try{
 await test('v2真握手與locked嚴格解析，舊版本及缺欄快照明確拒絕',async()=>{
  assert.equal(SOCIAL_VERSION,'frontier-social-v2');const q=await create(),good=service.snapshot(q.r);assert.equal(good.locked,false);assert.ok(parseSocialRoom(good));
  for(const change of[r=>delete r.locked,r=>r.locked=1,r=>r.locked='false',r=>r.unknown=true,r=>r.v='expedition-social-v1']){const r=structuredClone(good);change(r);assert.equal(parseSocialRoom(r),null);}
  const c=await wire();await command(c,'join',{v:'expedition-social-v1',name:'舊客戶端',vehicle:'sedan',code:q.r.code},'error');assert.equal(q.r.players.size,1);
 });
 await test('大廳房主可鎖新加入，拒絕加入不建立席位；解鎖後可加入',async()=>{
  const q=await create(),rev=q.r.revision;await command(q.a,'manage',manage(q.r,'lock',q.r.hostId,{locked:true}));assert.equal(q.r.locked,true);assert.ok(q.r.revision>rev);
  const c=await wire();await command(c,'join',{v:SOCIAL_VERSION,name:'等候好友',vehicle:'sedan',code:q.r.code},'error');assert.equal(q.r.players.size,1);
  await command(q.a,'manage',manage(q.r,'lock',q.r.hostId,{locked:false}));const b=await command(c,'join',{v:SOCIAL_VERSION,name:'等候好友',vehicle:'sedan',code:q.r.code},'welcome');assert.ok(q.r.players.has(b.selfId));assert.equal(q.r.locked,false);
 });
 await test('鎖房仍允許15秒內原席續接，旋轉token且名單連線變化更新revision',async()=>{
  const q=await create(),b=await join(q.r);await command(q.a,'manage',manage(q.r,'lock',q.r.hostId,{locked:true}));const rev=q.r.revision;
  await b.c.close();await until(()=>!q.r.players.get(b.w.selfId).client);assert.ok(q.r.revision>rev);const disconnectRev=q.r.revision,c=await wire();
  const w=await command(c,'resume',{v:SOCIAL_VERSION,code:q.r.code,selfId:b.w.selfId,token:b.w.token},'welcome');assert.equal(w.selfId,b.w.selfId);assert.notEqual(w.token,b.w.token);assert.equal(q.r.players.size,2);assert.equal(q.r.locked,true);assert.ok(q.r.revision>disconnectRev);
 });
 await test('非房主無法管理，房碼/房主/目標必須綁目前房間',async()=>{
  const q=await create(),b=await join(q.r);await rejected(b.c,q.r,manage(q.r,'lock',q.r.hostId,{locked:true}));
  for(const extra of[{code:'ZZZZZZ'},{hostId:b.w.selfId},{targetId:b.w.selfId}])await rejected(q.a,q.r,manage(q.r,'lock',q.r.hostId,{locked:true,...extra}));
  assert.equal(q.r.locked,false);assert.equal(q.r.players.size,2);
 });
 await test('名單加入使已擷取revision失效，過期移除不作用到新席位',async()=>{
  const q=await create(),b=await join(q.r),old=manage(q.r,'remove',b.w.selfId),rev=q.r.revision;await join(q.r,'好友丙');assert.ok(q.r.revision>rev);await rejected(q.a,q.r,old);assert.ok(q.r.players.has(b.w.selfId));
 });
 await test('管理指令精確白名單拒絕缺欄/錯型別/多餘欄/自我移除/無效目標',async()=>{
  const q=await create(),b=await join(q.r),base=manage(q.r,'lock',q.r.hostId,{locked:true});
  const bad=[{...base,unknown:1},{...base,locked:'true'},{...base,locked:undefined},{...base,action:'ban'},{...base,revision:NaN},{...base,revision:q.r.revision+.5},{...base,code:undefined},{...base,hostId:undefined},{...base,targetId:undefined},manage(q.r,'remove',q.r.hostId),manage(q.r,'remove','f'.repeat(20)),manage(q.r,'remove',b.w.selfId,{locked:false})];
  for(const fields of bad)await rejected(q.a,q.r,fields);assert.equal(q.r.players.size,2);assert.equal(q.r.locked,false);
 });
 await test('房主斷線即移交並更新revision，舊房主權限不能藉續接復活',async()=>{
  const q=await create(),b=await join(q.r),stale=manage(q.r,'remove',b.w.selfId),rev=q.r.revision;await q.a.close();await until(()=>q.r.hostId===b.w.selfId);assert.ok(q.r.revision>rev);
  const c=await wire();await command(c,'resume',{v:SOCIAL_VERSION,code:q.r.code,selfId:q.wa.selfId,token:q.wa.token},'welcome');await rejected(c,q.r,stale);assert.equal(q.r.hostId,b.w.selfId);
  await command(b.c,'manage',manage(q.r,'lock',q.r.hostId,{locked:true}));assert.equal(q.r.locked,true);
 });
 await test('大廳移除清token/輸入/綁定/速度與標記，其他車狀態不變',async()=>{
  const q=await create(),b=await join(q.r),target=q.r.players.get(b.w.selfId),host=q.r.players.get(q.wa.selfId),before=carState(host),targetClient=target.client,rev=q.r.revision;
  await command(b.c,'mark',{stationId:COOP_STATIONS[1].id});assert.ok(q.r.marks.some(m=>m.playerId===b.w.selfId));
  const mark=b.c.mark();await command(q.a,'manage',manage(q.r,'remove',b.w.selfId));const removed=await b.c.until(m=>m.type==='removed',mark);
  assert.equal(typeof removed.message,'string');assert.equal(q.r.players.has(b.w.selfId),false);assert.ok(!target.token);assert.equal(target.client,null);assert.equal(targetClient.room,null);assert.equal(targetClient.player,null);assert.equal(target.input.active,false);assert.equal(target.input.throttle,false);assert.deepEqual(target.queue,[]);assert.equal(target.car.vx,0);assert.equal(target.car.vz,0);assert.equal(target.car.w,0);assert.equal(carState(host),before);assert.ok(q.r.revision>rev);assert.ok(!q.r.marks.some(m=>m.playerId===b.w.selfId));
 });
 await test('移除後舊token無法續接，但解鎖可用新席重加入並非永久封鎖',async()=>{
  const q=await create(),b=await join(q.r);await command(q.a,'manage',manage(q.r,'lock',q.r.hostId,{locked:true}));await command(q.a,'manage',manage(q.r,'remove',b.w.selfId));
  await command(b.c,'resume',{v:SOCIAL_VERSION,code:q.r.code,selfId:b.w.selfId,token:b.w.token},'error');assert.equal(q.r.players.size,1);
  await command(q.a,'manage',manage(q.r,'lock',q.r.hostId,{locked:false}));const fresh=await command(b.c,'join',{v:SOCIAL_VERSION,name:'再次加入',vehicle:'sedan',code:q.r.code},'welcome');assert.notEqual(fresh.selfId,b.w.selfId);assert.notEqual(fresh.token,b.w.token);assert.equal(q.r.players.size,2);
 });
 await test('巡航進行中可鎖房及移除，真在途控制立刻失效且其餘車不中止',async()=>{
  const q=await create(),b=await join(q.r);await start(q,[b.c]);await advance(3010);assert.equal(q.r.phase,'running');const p=q.r.players.get(b.w.selfId),mark=b.c.mark();
  b.c.send({type:'input',runId:q.r.runId,epoch:p.epoch,seq:1,...input});await until(()=>p.queue.length===1);await advance(34);assert.equal(p.input.active,true);assert.ok(Math.hypot(p.car.vx,p.car.vz)>0,'real FreeCar must be moving before removal');
  b.c.send({type:'input',runId:q.r.runId,epoch:p.epoch,seq:2,...input});await until(()=>p.queue.length===1);assert.equal(p.queue[0].active,true);const other=carState(q.r.players.get(q.wa.selfId));
  await command(q.a,'manage',manage(q.r,'lock',q.r.hostId,{locked:true}));await command(q.a,'manage',manage(q.r,'remove',b.w.selfId));await b.c.until(m=>m.type==='removed',mark);assert.equal(p.queue.length,0);assert.equal(p.input.active,false);assert.equal(p.car.vx,0);assert.equal(p.car.vz,0);assert.equal(carState(q.r.players.get(q.wa.selfId)),other);assert.equal(q.r.phase,'running');
  await command(b.c,'input',{type:'input',runId:q.r.runId,epoch:p.epoch,seq:3,...input},'error');assert.equal(p.queue.length,0);assert.equal(q.r.players.size,1);
 });
 await test('三種玩法倒數中均拒絕管理，不能移除已準備玩家或改鎖',async()=>{
  for(const mode of['cruise','chase','tandem']){const q=await create(mode),b=await join(q.r);await start(q,[b.c]);await rejected(q.a,q.r,manage(q.r,'remove',b.w.selfId));await rejected(q.a,q.r,manage(q.r,'lock',q.r.hostId,{locked:true}));assert.equal(q.r.phase,'countdown');await clean();}
 });
 await test('警匪及追走進行中拒絕移除與改鎖，不改權威場次或分數',async()=>{
  for(const mode of['chase','tandem']){const q=await create(mode),b=await join(q.r);await start(q,[b.c]);await advance(3010);assert.equal(q.r.phase,'running');await rejected(q.a,q.r,manage(q.r,'remove',b.w.selfId));await rejected(q.a,q.r,manage(q.r,'lock',q.r.hostId,{locked:true}));assert.equal(q.r.players.size,2);await clean();}
 });
 await test('結束階段拒絕管理，須先回大廳再操作',async()=>{
  const q=await create();await start(q);await advance(3010);await advance(1100);assert.equal(q.r.phase,'running');
  // A real service stall transitions the room; this is a deterministic time fixture, not an injected phase or pose.
  now+=1100;service.tick(now);await settle();assert.equal(q.r.phase,'finished');await rejected(q.a,q.r,manage(q.r,'lock',q.r.hostId,{locked:true}));
  await command(q.a,'again');assert.equal(q.r.phase,'lobby');await command(q.a,'manage',manage(q.r,'lock',q.r.hostId,{locked:true}));assert.equal(q.r.locked,true);
 });
 await test('大廳加入/離開/斷線/續接更新revision並取消過期準備',async()=>{
  const q=await create();await command(q.a,'ready',{revision:q.r.revision,ready:true});let rev=q.r.revision;const b=await join(q.r);assert.ok(q.r.revision>rev);assert.ok([...q.r.players.values()].every(p=>!p.ready));
  for(const c of[q.a,b.c])await command(c,'ready',{revision:q.r.revision,ready:true});rev=q.r.revision;await b.c.close();await until(()=>!q.r.players.get(b.w.selfId).client);assert.ok(q.r.revision>rev);assert.ok([...q.r.players.values()].every(p=>!p.ready));
  const c=await wire();rev=q.r.revision;await command(c,'resume',{v:SOCIAL_VERSION,code:q.r.code,selfId:b.w.selfId,token:b.w.token},'welcome');assert.ok(q.r.revision>rev);await command(q.a,'ready',{revision:q.r.revision,ready:true});rev=q.r.revision;await command(c,'leave',{},'left');assert.ok(q.r.revision>rev);assert.equal(q.r.players.get(q.wa.selfId).ready,false);
 });
 await test('房主也可移除離線保留席，舊憑證永久失效至本房結束',async()=>{
  const q=await create(),b=await join(q.r),p=q.r.players.get(b.w.selfId);await b.c.close();await until(()=>!p.client);await command(q.a,'manage',manage(q.r,'remove',b.w.selfId));assert.equal(q.r.players.has(b.w.selfId),false);assert.ok(!p.token);const c=await wire();await command(c,'resume',{v:SOCIAL_VERSION,code:q.r.code,selfId:b.w.selfId,token:b.w.token},'error');assert.equal(q.r.players.size,1);
 });
 await test('跨房相同席號不能誤刪：房碼與目標ID同時驗證且快照不含私席',async()=>{
  const q=await create(),b=await join(q.r),other=await create(),d=await join(other.r,'另一房好友');assert.equal(q.r.players.get(b.w.selfId).slot,other.r.players.get(d.w.selfId).slot);
  await rejected(q.a,q.r,manage(q.r,'remove',d.w.selfId));await rejected(q.a,q.r,manage(q.r,'remove',b.w.selfId,{code:other.r.code}));assert.equal(q.r.players.size,2);assert.equal(other.r.players.size,2);
  for(const r of[q.r,other.r]){const raw=JSON.stringify(service.snapshot(r));assert.ok(parseSocialRoom(JSON.parse(raw)));for(const p of r.players.values())assert.ok(!raw.includes(p.token));assert.ok(!raw.includes('disconnectedAt'));assert.ok(!raw.includes('queue'));}
 });
 await test('真UI客戶端收到移除立即清session席位並停止input，不自動重連',async()=>{
  const q=await create(),store=memory(),observed=[];let changed=0,c;c=new C.ExpeditionSocialClient(endpoint,()=>{changed++;if(c?.lastExit)observed.push({exit:c.lastExit,message:c.message,room:c.room,selfId:c.selfId,stored:store.getItem(C.SOCIAL_SEAT_KEY),status:c.status,resumable:c.resumable});},store);clients.push(c);await c.enter('join','真客戶端乙','sedan','cruise','dry',q.r.code);const selfId=c.selfId,seat=JSON.parse(store.getItem(C.SOCIAL_SEAT_KEY));assert.ok(seat.token);const initialChanged=changed;
  await command(q.a,'manage',manage(q.r,'remove',selfId));await until(()=>c.room===null&&c.selfId==='');assert.equal(c.resumable,false);assert.equal(store.getItem(C.SOCIAL_SEAT_KEY),null);assert.equal(c.status,'idle');assert.equal(c.input(input),null);assert.ok(changed>initialChanged);assert.equal(c.lastExit,'removed');assert.match(c.message,/移出|移除/);assert.ok(observed.length>0);for(const value of observed)assert.deepEqual(value,{exit:'removed',message:c.message,room:null,selfId:'',stored:null,status:'idle',resumable:false});assert.equal(q.r.players.has(selfId),false);await settle();assert.equal(q.r.players.size,1);return{clearedSeat:true,inputStopped:true,noAutomaticRejoin:true,exit:c.lastExit,observerSeesAtomicExit:true};
 });
 await test('真client.manage保留確認時intent，名單變更後不得自動換成最新revision',async()=>{
  const host=new C.ExpeditionSocialClient(endpoint,()=>{},memory());clients.push(host);await host.enter('create','真房主','sedan','cruise','dry');const r=service.rooms.get(host.room.code),b=await join(r);await until(()=>host.room?.revision===r.revision);
  const captured=manage(r,'remove',b.w.selfId);await join(r,'變更名單好友');await until(()=>host.room?.revision>captured.revision);const before=snapshot(r);assert.equal(host.manage(captured),true);await until(()=>host.message.length>0);assert.match(host.message,/更新|確認/);assert.equal(snapshot(r),before);assert.ok(r.players.has(b.w.selfId));
  assert.equal(host.manage(manage(r,'remove',b.w.selfId)),true);await until(()=>!r.players.has(b.w.selfId));assert.equal(r.players.size,2);assert.equal(host.selfId,r.hostId);assert.equal(host.lastExit,'');return{capturedRevision:captured.revision,currentRevision:r.revision,staleIntentRejected:true,freshIntentAccepted:true};
 });
 await test('真服務35分鐘到期原子清席並保留expired原因，不自動重新加入',async()=>{
  const store=memory(),observed=[];let c;c=new C.ExpeditionSocialClient(endpoint,()=>{if(c?.lastExit)observed.push({exit:c.lastExit,message:c.message,room:c.room,selfId:c.selfId,stored:store.getItem(C.SOCIAL_SEAT_KEY),status:c.status,resumable:c.resumable});},store);clients.push(c);await c.enter('create','到期房主','sedan','cruise','dry');const code=c.room.code;assert.ok(store.getItem(C.SOCIAL_SEAT_KEY));assert.equal(c.lastExit,'');
  // Advance the service clock past its actual idle-room TTL; do not inject an expired wire message or a phase.
  now+=35*60*1000+1;service.tick(now);await until(()=>c.lastExit==='expired'&&c.room===null);assert.equal(c.selfId,'');assert.equal(c.status,'idle');assert.equal(c.resumable,false);assert.equal(store.getItem(C.SOCIAL_SEAT_KEY),null);assert.equal(c.input(input),null);assert.match(c.message,/到期/);assert.ok(observed.length>0);for(const value of observed)assert.deepEqual(value,{exit:'expired',message:c.message,room:null,selfId:'',stored:null,status:'idle',resumable:false});assert.equal(service.rooms.has(code),false);await settle();assert.equal(service.rooms.size,0);assert.equal(c.room,null);return{actualTtlMs:35*60*1000,exit:c.lastExit,observerSeesAtomicExit:true,clearedSeat:true,noAutomaticRejoin:true};
 });
}catch(e){report.fatal=String(e.stack);}
finally{
 try{await clean();}catch(e){report.cleanupError=String(e.stack);}
 service.close();for(const ws of sockets)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>http.close(resolve));globalThis.WebSocket=originalWebSocket;
 report.cleanupComplete=!http.listening&&service.rooms.size===0&&service.clients.size===0&&sockets.size===0;
 await finishAudit(root,new URL(import.meta.url),report);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.fatal&&!report.cleanupError&&!report.summary.FAIL&&report.cleanupComplete&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests?'PASS':'FAIL';await writeFile(new URL('frontier-room-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary,cleanupComplete:report.cleanupComplete,fatal:report.fatal}));if(report.status!=='PASS')process.exitCode=1;
}
