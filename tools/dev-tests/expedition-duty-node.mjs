import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {WebSocketServer,WebSocket} from '../../server/node_modules/ws/wrapper.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ExpeditionDutyService} from '../../server/expedition-duty-service.mjs';
import {FreeCar} from '../../server/summit-city-physics.mjs';
import {realCityWorld} from '../../server/summit-city-race-service.mjs';
import {EXPEDITION_DUTY_VERSION,parseCrewRoom} from '../../shared/expedition-duty.ts';
import {voyagerModule} from './voyager-module-loader.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {RegularityRun,buildRally,parseRallyRecords}=await voyagerModule(root,'expedition-duty-rally.ts');
const {parseCrewRecords,writeDutyRecords,CREW_RECORDS}=await voyagerModule(root,'expedition-duty-records.ts');
const {ExpeditionDutyClient,dutyEndpoint}=await voyagerModule(root,'expedition-duty-client.ts');
const report={status:'RUNNING',localOnly:true,externalRequests:0,cases:[],sourceHashes:{},limitations:['完整合作流程使用明示停靠/gate位置fixture；車輛/路網/服務與絞盤是真產品，不代表真人跑完全長路線。','拉力評分使用受控連續移動fixture；未模擬手機或實體手把。']};
const inputs=['shared/expedition-duty.ts','server/expedition-duty-service.mjs','src/expedition-duty-client.ts','src/expedition-duty-rally.ts','src/expedition-duty-records.ts','src/expedition-duty-ui.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const p of inputs)report.sourceHashes[p]=sha(await readFile(new URL('../../'+p,import.meta.url)));
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[真TS模組]').slice(0,3000)});process.exitCode=1;}console.log(JSON.stringify(report.cases.at(-1)));}
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages=[];send(raw){this.messages.push(JSON.parse(raw));}close(){this.readyState=3;this.emit('close');}terminate(){this.close();}ping(){this.emit('pong');}}
let now=100000;
const service=new ExpeditionDutyService({now:()=>now,worldFactory:realCityWorld});
const A=service.accept(new Socket()),B=service.accept(new Socket());
const send=(c,m)=>service.receive(c,m,now),command=(c,type,fields={})=>send(c,{type,revision:c.room.revision,runId:c.room.runId,...fields});
send(A,{type:'create',v:EXPEDITION_DUTY_VERSION,name:'司機'});
send(B,{type:'join',v:EXPEDITION_DUTY_VERSION,name:'協助者',code:A.room.code});
const room=A.room;
function advance(seconds,held){const steps=Math.round(seconds*30);for(let i=0;i<steps;i++){now+=1000/30;if(held&&room.phase==='running')command(B,'operate',held);service.tick(now);}}
function dock(){const p=room.route.target;room.car.place(p.x,p.z,p.h,p.y);room.car.y=p.y;room.next=room.route.gates.length;room.dwell=2;room.input={steer:0,throttle:false,brake:false,handbrake:false,active:false};}
await check('真城市解碼路網建立雙向救援路線及嚴格快照',()=>{
 assert.ok(room.outbound.length>500);assert.ok(room.homebound.length>500);assert.ok(room.outbound.gates.length>20);
 assert.equal(room.players.size,2);assert.equal(A.player.role,'driver');assert.equal(B.player.role,'technician');assert.ok(parseCrewRoom(service.snapshot(room)));
 const bad=service.snapshot(room);bad.pose.x=NaN;assert.equal(parseCrewRoom(bad),null);
 for(const corrupt of [r=>r.pose.place='覆寫方法',r=>r.pose.update=0,r=>Object.defineProperty(r.pose,'__proto__',{value:{injected:true},enumerable:true}),r=>r.players[0].role='admin',r=>r.players[0].token='不應公開',r=>r.winch.injected=true,r=>r.route.gates[0].injected=true,r=>r.token='不應公開']){const input=structuredClone(service.snapshot(room));corrupt(input);assert.equal(parseCrewRoom(input),null);}
 return{outbound:room.outbound.length,homebound:room.homebound.length,gates:room.outbound.gates.length};
});
await check('房主、準備、兩人與容量門檻，拒絕第三席',()=>{
 assert.throws(()=>command(A,'start'));command(A,'ready',{ready:true});assert.throws(()=>command(A,'start'));command(B,'ready',{ready:true});assert.throws(()=>command(B,'start'));
 const c=service.accept(new Socket());assert.throws(()=>send(c,{type:'join',v:EXPEDITION_DUTY_VERSION,name:'第三位',code:room.code}));c.ws.close();command(A,'start');assert.equal(room.phase,'running');
});
await check('只收司機合法輸入，不接受位置／結果／重複序號／越權絞盤',()=>{
 const input={seq:1,steer:0,throttle:true,brake:false,handbrake:false,active:true};
 assert.throws(()=>command(B,'input',input));assert.throws(()=>command(A,'input',{...input,x:9999}));assert.throws(()=>command(A,'input',{...input,seq:NaN}));assert.throws(()=>command(A,'operate',{kind:'winch',pull:1,side:0}));
 command(A,'input',input);assert.equal(room.ack,1);assert.throws(()=>command(A,'input',input));
 const before={x:room.car.x,z:room.car.z};advance(.3);assert.ok(Math.hypot(room.car.x-before.x,room.car.z-before.z)>.01);return{trueFreeCarDistance:Math.hypot(room.car.x-before.x,room.car.z-before.z)};
});
await check('未訪問檢查點、錯層或未對準不能跳過救援作業',()=>{
 assert.throws(()=>command(A,'action'));command(B,'operate',{kind:'warning',pull:0,side:0});advance(1);
 assert.equal(room.stage,'approach');const p=room.route.target;room.car.place(p.x,p.z,p.h,p.y+8);room.next=room.route.gates.length;advance(.1);assert.equal(room.stage,'approach');
});
await check('雙人分工完整閉環：警示、定位、側修收盤、固定、返回卸載',()=>{
 dock();advance(.1);assert.equal(room.stage,'warning');
 advance(2.2,{kind:'warning',pull:0,side:0});assert.equal(room.stage,'positioning');assert.throws(()=>command(B,'action'));
 command(A,'action');assert.equal(room.stage,'winch');
 advance(.5,{kind:'winch',pull:1,side:0});assert.equal(room.winch.along,0);assert.equal(room.winch.blocked,true);
 advance(2,{kind:'winch',pull:0,side:-1});assert.ok(Math.abs(room.winch.lateral)<.35);
 const stopped=room.winch.along;command(B,'operate',{kind:'stop',pull:0,side:0});advance(.7);assert.equal(room.winch.along,stopped);
 advance(9,{kind:'winch',pull:1,side:0});assert.equal(room.stage,'securing');command(A,'action');assert.equal(room.stage,'returning');assert.equal(room.route,room.homebound);assert.equal(room.next,0);assert.equal(room.car.spec.mass,7.2);
 dock();advance(.1);assert.equal(room.stage,'unloading');advance(3.2,{kind:'unload',pull:0,side:0});assert.equal(room.stage,'complete');assert.equal(room.phase,'finished');assert.ok(parseCrewRoom(service.snapshot(room)));
 return{explicitDockFixture:true,seconds:room.elapsed,integrity:room.integrity};
});
await check('重開世代與斷線立即停車，原席token輪替且快照不含憑證',()=>{
 command(A,'again');command(A,'ready',{ready:true});command(B,'ready',{ready:true});command(A,'start');
 const oldRun=room.runId,oldToken=B.player.token,playerId=B.player.id;room.car.vx=10;B.ws.close();assert.equal(room.car.vx,0);assert.equal(room.heldAt,-Infinity);
 const e=room.elapsed;advance(1);assert.equal(room.elapsed,e);
 const b2=service.accept(new Socket());send(b2,{type:'resume',v:EXPEDITION_DUTY_VERSION,code:room.code,selfId:playerId,token:oldToken});assert.notEqual(b2.player.token,oldToken);
 assert.equal(JSON.stringify(service.snapshot(room)).includes(oldToken),false);
 b2.ws.close();const stale=service.accept(new Socket());assert.throws(()=>send(stale,{type:'resume',v:EXPEDITION_DUTY_VERSION,code:room.code,selfId:playerId,token:oldToken}));stale.ws.close();
 now+=16000;service.tick(now);assert.equal(room.phase,'lobby');assert.equal(room.players.size,1);assert.notEqual(room.runId,oldRun);
 assert.throws(()=>send(A,{type:'input',revision:room.revision,runId:oldRun,seq:99,steer:0,throttle:true,brake:false,handbrake:false,active:true}));
});
await check('房主退出後協助者成新司機，空房與連線清理',()=>{
 const temp=new ExpeditionDutyService({now:()=>now,worldFactory:realCityWorld}),a=temp.accept(new Socket()),b=temp.accept(new Socket());
 temp.receive(a,{type:'create',v:EXPEDITION_DUTY_VERSION,name:'甲'},now);temp.receive(b,{type:'join',v:EXPEDITION_DUTY_VERSION,name:'乙',code:a.room.code},now);const r=a.room;
 temp.remove(a);assert.equal(r.hostId,b.player.id);assert.equal(b.player.role,'driver');assert.equal(r.phase,'lobby');temp.remove(b);assert.equal(temp.rooms.size,0);a.ws.close();b.ws.close();assert.equal(temp.clients.size,0);temp.close();
});
await check('真loopback WebSocket握手、兩人準備出勤與離房無外網',async()=>{
 const temp=new ExpeditionDutyService({worldFactory:realCityWorld}),http=createServer(),wss=new WebSocketServer({server:http});wss.on('connection',ws=>temp.accept(ws));
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const url='ws://127.0.0.1:'+http.address().port,clients=[];
 const connect=async()=>{const ws=new WebSocket(url),messages=[];ws.on('message',raw=>messages.push(JSON.parse(String(raw))));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});clients.push(ws);return{ws,messages};};
 const wait=async(c,test)=>{for(let n=0;n<150;n++){const m=c.messages.find(test);if(m)return m;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('loopback等待逾時');};
 try{const a=await connect(),b=await connect();await wait(a,m=>m.type==='hello');await wait(b,m=>m.type==='hello');a.ws.send(JSON.stringify({type:'create',v:EXPEDITION_DUTY_VERSION,name:'真網路司機'}));const welcome=await wait(a,m=>m.type==='welcome');b.ws.send(JSON.stringify({type:'join',v:EXPEDITION_DUTY_VERSION,name:'真網路協助者',code:welcome.room.code}));await wait(b,m=>m.type==='welcome');
 await wait(a,m=>m.type==='room'&&m.room.players.length===2);const r=[...temp.rooms.values()][0];for(const c of[a,b])c.ws.send(JSON.stringify({type:'ready',runId:r.runId,revision:r.revision,ready:true}));await wait(a,m=>m.type==='room'&&m.room.players.every(p=>p.ready));a.ws.send(JSON.stringify({type:'start',runId:r.runId,revision:r.revision}));const started=await wait(b,m=>m.type==='room'&&m.room.phase==='running');assert.ok(parseCrewRoom(started.room));
 }finally{for(const ws of clients)ws.terminate();temp.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>http.close(resolve));}return{realLoopback:true};
});
await check('真產品client用loopback建房、續接同席與token輪替，離開釋放心跳',async()=>{
 const temp=new ExpeditionDutyService({worldFactory:realCityWorld}),http=createServer(),wss=new WebSocketServer({server:http});wss.on('connection',ws=>temp.accept(ws));await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const endpoint='ws://127.0.0.1:'+http.address().port+'/city-duty',saved=new Map(),storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},clients=[];
 const wait=async(test)=>{for(let i=0;i<200;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('真client等待逾時');};
 try{const a=new ExpeditionDutyClient(endpoint,()=>{},storage);clients.push(a);await a.join('create','產品司機','');const id=a.selfId,r=temp.rooms.get(a.room.code),oldToken=r.players.get(id).token;assert.ok(a.room);a.disconnect();await wait(()=>!r.players.get(id).client);const b=new ExpeditionDutyClient(endpoint,()=>{},storage);clients.push(b);assert.equal(b.resumable,true);await b.join('resume','','');assert.equal(b.selfId,id);assert.notEqual(r.players.get(id).token,oldToken);assert.equal(r.players.size,1);b.leave();await wait(()=>temp.rooms.size===0);assert.equal(saved.size,0);assert.equal(b.room,null);assert.equal(b.status,'idle');
 assert.equal(dutyEndpoint('wss://example.invalid/ws',{hostname:'game.invalid',protocol:'https:'}),'wss://example.invalid/city-duty');assert.equal(dutyEndpoint('wss://name:secret@example.invalid/ws',{hostname:'game.invalid',protocol:'https:'}),'');
 }finally{for(const c of clients)c.disconnect();temp.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>http.close(resolve));}return{productClient:true,realLoopback:true,sessionCredentialNotExported:true};
});
const {Router}=await voyagerModule(root,'router.ts'),{decodeCity}=await voyagerModule(root,'citydata.ts');
await check('定速拉力以真單行路網產生四個計時點與沿路門',async()=>{
 const city=decodeCity(JSON.parse(await readFile(new URL('../../public/data/city.json',import.meta.url),'utf8'))),plan=buildRally(new Router(city),36);
 assert.ok(plan);assert.ok(plan.length>500);assert.equal(plan.gates.filter(g=>g.timed).length,4);assert.ok(plan.gates.every((g,i)=>i===0||g.distance>=plan.gates[i-1].distance));return{length:plan.length,gates:plan.gates.length};
});
const straight={name:'明示160m模型路線',path:[[0,0],[160,0]],ys:[0,0],start:{x:0,z:0,y:-.25,h:Math.PI/2},gates:[40,80,120,160].map(distance=>({x:distance,z:0,y:-.25,distance,due:distance/10,timed:true})),length:160,average:36,limit:50};
function runRally(speed=10){const c=new FreeCar();c.place(0,0,Math.PI/2,-.25);c.y=-.25;const r=new RegularityRun(straight,c);while(r.phase==='countdown')r.step(.05);for(let n=0;n<1000&&!r.finished;n++){c.x+=speed*.05;c.vx=speed;c.vz=0;r.step(.05);}return r;}
await check('定速拉力準時低罰分，早到及超速都不能以搶快獲勝',()=>{
 const ontime=runRally(),fast=runRally(20);assert.equal(ontime.phase,'finished');assert.ok(ontime.penalty<1e-6);assert.equal(ontime.speedPenalty,0);assert.ok(fast.penalty>10);assert.ok(fast.speedPenalty>0);const saved=ontime.result(123);assert.ok(parseRallyRecords([saved]));assert.equal(ontime.result(124),null);return{onTime:ontime.penalty,fast:fast.penalty+fast.speedPenalty};
});
await check('定速拉力拒絕傳送、錯層與倒行，失敗不產生紀錄',()=>{
 const c=new FreeCar();c.place(0,0,Math.PI/2,-.25);c.y=-.25;const r=new RegularityRun(straight,c);while(r.phase==='countdown')r.step(.05);c.x=100;r.step(.02);assert.equal(r.phase,'failed');assert.equal(r.result(),null);
 const high=new FreeCar();high.place(39,0,Math.PI/2,9);high.y=9;const q=new RegularityRun({...straight,start:{x:39,z:0,y:9,h:Math.PI/2}},high);while(q.phase==='countdown')q.step(.05);high.x=41;q.step(.05);assert.equal(q.next,0);
 assert.equal(parseRallyRecords([{id:'fake',at:1,seconds:1,penalty:0,speedPenalty:0,route:'fake',arrivals:[]}]),null);
});
await check('備份共用紀錄解析器拒絕竄改罰分、倒序、重複識別與額外敏感欄位',()=>{
 const valid=runRally().result(1000);assert.ok(parseRallyRecords([valid]));
 for(const change of [r=>r.penalty=100,r=>r.arrivals[1].gate=r.arrivals[0].gate,r=>r.arrivals[1].actual=-1,r=>r.arrivals[0].delta=8,r=>r.token='不應保存的憑證',r=>r.id='控制\n字元']){const row=structuredClone(valid);change(row);assert.equal(parseRallyRecords([row]),null);}
 assert.equal(parseRallyRecords([valid,valid]),null);const crew={id:'crew-1',at:1000,seconds:20,integrity:90,crew:['甲 · 司機','乙 · 協助者']};assert.ok(parseCrewRecords([crew]));assert.equal(parseCrewRecords([{...crew,crew:['只有一人']}]),null);assert.equal(parseCrewRecords([{...crew,seconds:Infinity}]),null);assert.equal(parseCrewRecords([{...crew,token:'secret'}]),null);assert.equal(parseCrewRecords([crew,crew]),null);
});
await check('紀錄寫入先比對原文，保留另一頁或匯入的新資料與寫入失敗原文',()=>{
 const old={id:'crew-a',at:100,seconds:25,integrity:90,crew:['甲 · 司機','乙 · 協助者']},next={...old,id:'crew-b'},foreign=JSON.stringify([{...old,id:'foreign'}]),data=new Map(),store={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 const first=writeDutyRecords(store,CREW_RECORDS,null,[old],parseCrewRecords);assert.equal(first.ok,true);assert.equal(data.get(CREW_RECORDS),first.raw);data.set(CREW_RECORDS,foreign);
 assert.deepEqual(writeDutyRecords(store,CREW_RECORDS,first.raw,[next,old],parseCrewRecords),{ok:false,reason:'changed'});assert.equal(data.get(CREW_RECORDS),foreign);
 assert.deepEqual(writeDutyRecords(store,CREW_RECORDS,foreign,[{...old,token:'secret'}],parseCrewRecords),{ok:false,reason:'invalid'});assert.equal(data.get(CREW_RECORDS),foreign);
 const denied={getItem:()=>foreign,setItem:()=>{throw Error('儲存配額拒絕');}};assert.deepEqual(writeDutyRecords(denied,CREW_RECORDS,foreign,[next],parseCrewRecords),{ok:false,reason:'unavailable'});assert.equal(data.get(CREW_RECORDS),foreign);return{foreignImportPreserved:true,failedWritePreserved:true};
});
service.close();
for(const p of inputs)assert.equal(sha(await readFile(new URL('../../'+p,import.meta.url))),report.sourceHashes[p],p);
report.sourceUnchanged=true;report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=report.summary.FAIL?'FAIL':'PASS';
await writeFile(new URL('./expedition-duty-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));
