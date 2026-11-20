// Rex <game88521@gmail.com>. Real local service/WS, with explicit docking fixtures for duty stages.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {WebSocketServer,WebSocket} from '../../server/node_modules/ws/wrapper.mjs';
import {ExpeditionDutyService} from '../../server/expedition-duty-service.mjs';
import {EXPEDITION_DUTY_VERSION,CREW_MAX_VIEWERS,parseCrewWatchState} from '../../shared/expedition-duty.ts';
import {voyagerModule} from './voyager-module-loader.mjs';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const report={status:'RUNNING',cases:[],localOnly:true,externalRequests:0,limitations:['完整作業使用明示停靠/gate fixture，沒有真人駛完全路線。'],...await startAudit(root,new URL(import.meta.url),['shared/expedition-duty.ts','server/expedition-duty-service.mjs','src/expedition-duty-client.ts','src/expedition-duty-ui.ts'])};
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[產品TS模組]').slice(0,4000)});process.exitCode=1;}console.log(JSON.stringify(report.cases.at(-1)));}
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages=[];code=null;send(text){this.messages.push(JSON.parse(text));}close(code){this.code=code;this.readyState=3;this.emit('close');}terminate(){this.close(1006);}ping(){this.emit('pong');}}
let now=100000;
function pair(options={}){const service=new ExpeditionDutyService({now:()=>now,...options}),a=service.accept(new Socket()),b=service.accept(new Socket());service.receive(a,{type:'create',v:EXPEDITION_DUTY_VERSION,name:'隊員甲'},now);service.receive(b,{type:'join',v:EXPEDITION_DUTY_VERSION,name:'隊員乙',code:a.room.code},now);return{service,a,b,room:a.room};}
function observe(service,room){const c=service.accept(new Socket());service.receive(c,{type:'watch',v:EXPEDITION_DUTY_VERSION,code:room.code},now);return c;}
const command=(s,c,type,fields={})=>s.receive(c,{type,revision:c.room.revision,runId:c.room.runId,...fields},now);
await check('觀眾四個獨立席位，不占兩位隊員、不改revision準備及房主',()=>{
 const {service,a,b,room}=pair(),before={revision:room.revision,run:room.runId,host:room.hostId};command(service,a,'ready',{ready:true});const viewers=[];
 for(let n=0;n<CREW_MAX_VIEWERS;n++)viewers.push(observe(service,room));assert.equal(room.viewers.size,4);assert.equal(room.players.size,2);assert.equal(a.player.ready,true);assert.equal(b.player.ready,false);assert.deepEqual({revision:room.revision,run:room.runId,host:room.hostId},before);
 const extra=service.accept(new Socket());assert.throws(()=>service.receive(extra,{type:'watch',v:EXPEDITION_DUTY_VERSION,code:room.code},now));extra.ws.close();
 for(const v of viewers){const welcome=v.ws.messages.find(m=>m.type==='watching');assert.ok(welcome);assert.equal('token'in welcome,false);assert.equal('selfId'in welcome,false);assert.equal(v.player,null);assert.match(welcome.viewerId,/^[a-f0-9]{20}$/);assert.ok(parseCrewWatchState(welcome.watch));}assert.equal(parseCrewWatchState({count:5,max:4}),null);assert.equal(parseCrewWatchState({count:1,max:4,token:'secret'}),null);service.close();
});
await check('觀眾原始wire越權也拒絕ready/start/取消/重開/輸入/作業及冒用席位',()=>{
 const {service,a,b,room}=pair(),v=observe(service,room);command(service,a,'ready',{ready:true});command(service,b,'ready',{ready:true});command(service,a,'start');const before=JSON.stringify(service.snapshot(room,now));
 for(const type of ['ready','start','cancel','again','input','operate','action','join','resume','create'])assert.throws(()=>service.receive(v,{type,revision:room.revision,runId:room.runId,ready:true,seq:1,steer:0,throttle:true,brake:false,handbrake:false,active:true,kind:'winch',pull:1,side:0,selfId:a.player.id,token:a.player.token},now));
 assert.equal(JSON.stringify(service.snapshot(room,now)),before);service.close();
});
await check('觀眾離線/慢連線只清自己，不停車、不重設勤務、不改隊員',()=>{
 const {service,a,b,room}=pair(),v=observe(service,room),w=observe(service,room);command(service,a,'ready',{ready:true});command(service,b,'ready',{ready:true});command(service,a,'start');room.car.vx=3;const revision=room.revision,run=room.runId;
 v.ws.close();assert.equal(room.car.vx,3);assert.equal(room.phase,'running');assert.equal(room.viewers.size,1);assert.equal(room.revision,revision);assert.equal(room.runId,run);
 w.ws.bufferedAmount=256*1024-8;assert.equal(service.send(w,{type:'pong',sentAt:123,serverTime:now}),false);assert.equal(w.ws.code,1013);assert.equal(room.car.vx,3);assert.equal(room.viewers.size,0);assert.equal(room.players.size,2);service.close();
});
await check('觀眾也計入服務總連線容量，結束房間及關閉服務無殘留',()=>{
 const {service,a,b,room}=pair({maxClients:3}),v=observe(service,room),extra=new Socket();assert.equal(service.clients.size,3);assert.equal(service.accept(extra),null);assert.equal(extra.code,1013);
 service.remove(a);assert.equal(room.viewers.size,1);service.remove(b);assert.equal(service.rooms.size,0);assert.equal(room.viewers.size,0);assert.equal(v.ws.readyState,3);assert.ok(v.ws.messages.some(m=>m.type==='watch-ended'));assert.equal(v.room,null);service.close();assert.equal(service.clients.size,0);
});
await check('兩隊員掉線保留期間觀眾可見暫停，過期一併結束觀戰',()=>{
 const {service,a,b,room}=pair(),v=observe(service,room);a.ws.close();b.ws.close();assert.equal(room.viewers.size,1);assert.equal(service.snapshot(room,now).paused,true);now+=16000;service.tick(now);assert.equal(service.rooms.size,0);assert.equal(v.ws.readyState,3);assert.equal(room.viewers.size,0);service.close();
});
const {ExpeditionDutyClient}=await voyagerModule(root,'expedition-duty-client.ts');
await check('產品client真WS觀戰：無token、不送操控、保留原私人席位，房間結束可退出',async()=>{
 const {service,a,b,room}=pair(),http=createServer(),wss=new WebSocketServer({server:http}),wire=[];wss.on('connection',ws=>{service.accept(ws);ws.on('message',data=>wire.push(JSON.parse(String(data))));});await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const endpoint='ws://127.0.0.1:'+http.address().port+'/city-duty',seat=JSON.stringify({endpoint,code:room.code,selfId:a.player.id,token:a.player.token}),store=new Map([['taipei-gp-expedition-duty-seat-v1',seat]]),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},client=new ExpeditionDutyClient(endpoint,()=>{},storage);
 const wait=async(test)=>{for(let n=0;n<200;n++){if(test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('真觀戰client等待逾時');};
 try{await client.watch(room.code);assert.equal(client.spectating,true);assert.equal(client.selfId,'');assert.match(client.viewerId,/^[a-f0-9]{20}$/);assert.equal(client.watchCount,1);assert.equal(store.get('taipei-gp-expedition-duty-seat-v1'),seat);client.command('ready',{ready:true});client.command('action');client.input({steer:1,throttle:true,brake:false,handbrake:false,active:true});client.operate('winch',1,1);await new Promise(resolve=>setTimeout(resolve,25));assert.equal(wire.some(m=>['input','operate','ready','action'].includes(m.type)),false);client.leave();await wait(()=>room.viewers.size===0);assert.equal(store.get('taipei-gp-expedition-duty-seat-v1'),seat);
 await client.watch(room.code);service.remove(a);service.remove(b);await wait(()=>client.watchEnded&&client.room===null);client.leave();assert.equal(store.get('taipei-gp-expedition-duty-seat-v1'),seat);
 }finally{client.disconnect();service.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>http.close(resolve));}return{realLoopback:true,privateSeatUnchanged:true};
});
report.cleanupComplete=true;await finishAudit(root,new URL(import.meta.url),report);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=report.summary.FAIL||!report.sourceUnchangedDuringTests||!report.scriptUnchangedDuringTests?'FAIL':'PASS';await writeFile(new URL('frontier-duty-watch-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));if(report.status!=='PASS')process.exitCode=1;
