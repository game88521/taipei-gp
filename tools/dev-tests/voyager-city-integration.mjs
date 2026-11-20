// Rex <game88521@gmail.com>. Local Node/WS; main timing bridge is extracted from the real animation callback AST.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAst} from 'rolldown/parseAst';
import {createMultiplayerServer} from '../../server/index.mjs';
import {encodeWorkshop} from '../../server/summit-city-physics.mjs';
import {CITY_RACE_VERSION} from '../../shared/summit-city-race.ts';
import {COOP_VERSION,COOP_CITY_STAMP,COOP_STATIONS,parseCoopRoom} from '../../shared/nexus-coop.ts';
import {WireClient,settle,ORIGIN} from './multiplayer-test-helpers.mjs';
import {pureUrl} from './pure-module-loader.mjs';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),evidence=path.join(root,'tools/dev-tests',`voyager-city-integration-evidence-${Date.now()}`);await mkdir(evidence);
const report={status:'FAIL',localOnly:true,externalRequests:0,cases:[],evidence:path.relative(root,evidence).replaceAll('\\','/'),
  limitations:['Actual local WS/server state; depot/fragile braking setups explicitly use server pose/control fixtures.',
    'Main timing test executes the actual AST-selected time declarations and city frame call, not the complete main/game or a Chrome session. Real-device stalls/comfort remain unverified.'],
  ...await startAudit(root,new URL(import.meta.url),['src/main.ts','src/voyager-city-prediction.ts','server/summit-city-race-service.mjs','server/nexus-coop-service.mjs','shared/summit-city-race.ts','shared/nexus-coop.ts'])};
const sha=b=>createHash('sha256').update(b).digest('hex');
let now=1000000,app;const peers=[];
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:e.stack});}console.log(JSON.stringify(report.cases.at(-1)));}
function walk(n,predicate){if(!n||typeof n!=='object')return null;if(predicate(n))return n;for(const v of Object.values(n))for(const child of Array.isArray(v)?v:[v]){const found=walk(child,predicate);if(found)return found;}return null;}
function timingBridge(source,delta){
  const js=stripTypeScriptTypes(source,{mode:'transform'}),ast=parseAst(js);
  const animation=walk(ast,n=>n.type==='CallExpression'&&js.slice(n.callee.start,n.callee.end)==='renderer.setAnimationLoop');assert.ok(animation);
  const body=animation.arguments[0].body.body;
  const selected=body.filter(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>['rawDelta','dt','renderNow'].includes(d.id?.name))||n.type==='ExpressionStatement'&&js.slice(n.start,n.end).trim().startsWith('summitCityRace?.frame('));
  assert.ok(selected.length>=3);let calls=0,captured;const context=vm.createContext({clock:{getDelta(){calls++;return delta;}},performance:{now:()=>12345},summitCityRace:{frame(at,dt){captured={at,dt};}}});
  vm.runInContext(selected.map(n=>js.slice(n.start,n.end)).join('\n')+'\nglobalThis.simulationDt=dt;',context);
  assert.equal(calls,1);assert.equal(captured.at,12345);return{cityDt:captured.dt,singleplayerDt:context.simulationDt,fragments:selected.map(n=>js.slice(n.start,n.end))};
}
try{
  await check('1 真main時間邊界before/after：500ms停頓不再被夾成100ms後重播六筆油門，單人上限保留',async()=>{
    const file=path.join(root,'../taipei-gp-atlas-work/src/main.ts'),beforeSource=await readFile(file,'utf8'),beforeHash=sha(beforeSource),before=timingBridge(beforeSource,.5),after=timingBridge(await readFile(path.join(root,'src/main.ts'),'utf8'),.5);
    const {VoyagerCityClock}=await import(await pureUrl(root,'voyager-city-prediction.ts'));let oldSteps=0,newSteps=0;
    const beforeAccepted=new VoyagerCityClock().advance(before.cityDt,()=>oldSteps++),afterAccepted=new VoyagerCityClock().advance(after.cityDt,()=>newSteps++);
    assert.equal(before.singleplayerDt,.1);assert.equal(after.singleplayerDt,.1);assert.equal(before.cityDt,.1);assert.equal(after.cityDt,.5);assert.equal(beforeAccepted,true);assert.equal(oldSteps,6);assert.equal(afterAccepted,false);assert.equal(newSteps,0);assert.equal(sha(await readFile(file)),beforeHash);
    for(const dt of[1/15,1/30,1/60,1/120]){const live=timingBridge(await readFile(path.join(root,'src/main.ts'),'utf8'),dt);assert.equal(live.cityDt,dt);assert.equal(live.singleplayerDt,dt);}
    return{before,after,oldSteps,newSteps,beforeSourceSha256:beforeHash};
  });
  app=createMultiplayerServer({autoTick:false,now:()=>now,allowedOrigins:[ORIGIN]});await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));
  const svc=app.cityRaceService,coop=app.coopService,world=svc.world(),base=`ws://127.0.0.1:${app.httpServer.address().port}`;
  const def={v:2,physics:'city-workshop-v2',map:world.roads.stamp,name:'倒數離房回歸',nodes:[199,200,199],car:'sedan',weather:'day',seconds:600,hits:20,laps:3,splits:[]};
  async function open(endpoint){const c=await new WireClient(base+endpoint).open();peers.push(c);await c.until(m=>m.type==='hello');c.request=0;return c;}
  for(const count of[2,3,4])await check(`4 NG2 ${count}人倒數主動離房回大廳，原起跑時刻不偷跑，重新確認才可再起跑`,async()=>{
    now=Math.round(now);const sockets=[],welcomes=[];
    for(let i=0;i<count;i++){const c=await open('/city-race');sockets.push(c);c.send(i?{type:'join',v:CITY_RACE_VERSION,name:`車${i}`,code:welcomes[0].room.code}:{type:'create',v:CITY_RACE_VERSION,name:'車0',challenge:encodeWorkshop(def)});welcomes.push(await c.until(m=>m.type==='welcome'));}
    const r=svc.rooms.get(welcomes[0].room.code);for(const c of sockets)c.send({type:'ready',revision:r.revision,map:def.map,ready:true});await sockets[0].until(m=>m.type==='room'&&m.room.players.every(p=>p.ready));sockets[0].send({type:'start',revision:r.revision});await sockets[0].until(m=>m.type==='room'&&m.room.phase==='countdown');const originalStart=r.startAt,oldMatch=r.matchId;
    const leaveIndex=count===4?0:count-1,leaver=sockets[leaveIndex],leaveMark=leaver.mark();leaver.send({type:'leave'});await leaver.until(m=>m.type==='left',leaveMark);await settle();assert.equal(r.phase,'lobby');assert.equal(r.players.size,count-1);assert.equal(r.startAt,null);assert.equal(r.deadlineAt,null);assert.equal(r.matchId,null);assert.ok([...r.players.values()].every(p=>!p.ready&&p.queue.length===0));
    now=originalStart;svc.tick(now);assert.equal(r.phase,'lobby');const remaining=sockets.filter((_,i)=>i!==leaveIndex);if(remaining.length<2){const c=await open('/city-race');c.send({type:'join',v:CITY_RACE_VERSION,name:'新車手',code:r.code});await c.until(m=>m.type==='welcome');remaining.push(c);}
    const host=remaining.find(c=>c.messages.some(m=>m.type==='welcome'&&m.selfId===r.hostId));assert.ok(host);const mark=host.mark();for(const c of remaining)c.send({type:'ready',revision:r.revision,map:def.map,ready:true});await host.until(m=>m.type==='room'&&m.room.players.every(p=>p.ready),mark);host.send({type:'start',revision:r.revision});await host.until(m=>m.type==='room'&&m.room.phase==='countdown',mark);assert.notEqual(r.matchId,oldMatch);assert.equal(r.startAt,now+3000);assert.ok(r.players.size>=2);
    for(const c of [...sockets,...remaining])await c.close();await settle();now+=15001;svc.tick(now);assert.equal(svc.rooms.size,0);return{players:count,leaver:leaveIndex===0?'host':'guest',cancelled:true,restartedWithPlayers:remaining.length};
  });
  await check('4 NG2圈界同distance依已完成圈數排名，NG1維持Atlas排序（明示server pose fixture）',async()=>{
    now=Math.round(now);const a=await open('/city-race'),b=await open('/city-race');a.send({type:'create',v:CITY_RACE_VERSION,name:'尚未過線',challenge:encodeWorkshop(def)});const wa=await a.until(m=>m.type==='welcome'),r=svc.rooms.get(wa.room.code);b.send({type:'join',v:CITY_RACE_VERSION,name:'已完成一圈',code:r.code});const wb=await b.until(m=>m.type==='welcome');
    for(const c of[a,b])c.send({type:'ready',revision:r.revision,map:def.map,ready:true});await a.until(m=>m.type==='room'&&m.room.players.every(p=>p.ready));a.send({type:'start',revision:r.revision});await a.until(m=>m.type==='room'&&m.room.phase==='countdown');now=r.startAt;svc.tick(now);now+=40000;r.simAt=now;
    const follower=r.players.get(wa.selfId),leader=r.players.get(wb.selfId),g=r.route.gates.at(-1),previous=r.route.gates.at(-2),norm=Math.hypot(g.x-previous.x,g.z-previous.z),nx=(g.x-previous.x)/norm,nz=(g.z-previous.z)/norm,h=Math.atan2(nx,nz);
    follower.next=r.route.gates.length-1;follower.completedLaps=0;follower.lapTimes=[];follower.car.place(g.x-nx*5,g.z-nz*5,h,g.y-.25);leader.next=0;leader.completedLaps=1;leader.lapTimes=[40000];leader.lastLapAt=now;leader.car.place(g.x+nx*.1,g.z+nz*.1,h,g.y-.25);
    for(const p of[follower,leader])svc.progress(r,p,{x:p.car.x,z:p.car.z,y:p.car.y},now);assert.equal(follower.distance,leader.distance);const advanced=svc.snapshot(r);assert.equal(advanced.players[0].id,leader.id);assert.equal(advanced.players[0].completedLaps,1);
    const beforeFile=path.join(root,'../taipei-gp-atlas-work/server/summit-city-race-service.mjs'),beforeHash=sha(await readFile(beforeFile)),{SummitCityRaceService:Before}=await import('../../../taipei-gp-atlas-work/server/summit-city-race-service.mjs'),before=new Before({worldFactory:()=>world});
    const {laps,splits,...legacy}=r.definition;r.definition={...legacy,v:1,physics:'city-workshop-v1'};const legacyBefore=before.snapshot(r,now).players.map(p=>p.id),legacyAfter=svc.snapshot(r,now).players.map(p=>p.id);assert.deepEqual(legacyAfter,legacyBefore);assert.equal(legacyAfter[0],follower.id);assert.equal(sha(await readFile(beforeFile)),beforeHash);r.definition=def;before.close();
    for(const c of[a,b])await c.close();await settle();now+=15001;svc.tick(now);assert.equal(svc.rooms.size,0);return{distance:follower.distance,ng2LeaderCompletedLaps:1,ng1OrderUnchanged:true,beforeSourceSha256:beforeHash};
  });
  await check('8 真WS特殊貨運跨兩次續接保留急件期限/載貨/易碎完整度，token輪替且舊憑證拒絕',async()=>{
    now=Math.round(now);async function command(c,type,fields={},expected='ack'){const request=++c.request,mark=c.mark();c.send({...fields,type,request});return c.until(m=>m.type===expected&&(expected==='welcome'||m.request===request),mark);}
    const a=await open('/coop'),wa=await command(a,'create',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,name:'特殊甲',vehicle:'sedan',mode:'special'},'welcome'),b=await open('/coop');await command(b,'join',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,name:'特殊乙',vehicle:'pickup',code:wa.room.code},'welcome');for(const c of[a,b])await command(c,'ready',{ready:true});await command(a,'start');const r=coop.rooms.get(wa.room.code),p=r.players.get(wa.selfId),urgent=r.cargo[0],fragile=r.cargo[2];
    function stoppedFixture(station){coop.place(p,station);p.pose.driving=true;p.poseAt=now;p.dwellStation=station.id;p.dwellAt=now-1300;}
    stoppedFixture(COOP_STATIONS[0]);await command(a,'pickup',{cargoId:urgent.id});const deadline=urgent.deadlineAt;await a.close();await settle();now+=10000;const c=await open('/coop'),wc=await command(c,'resume',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,code:r.code,selfId:p.id,token:wa.token},'welcome');assert.equal(p.cargo,urgent.id);assert.equal(urgent.deadlineAt,deadline);assert.notEqual(wc.token,wa.token);
    await command(c,'release');stoppedFixture(COOP_STATIONS[0]);await command(c,'pickup',{cargoId:urgent.id});assert.equal(urgent.deadlineAt,deadline);await command(c,'release');stoppedFixture(COOP_STATIONS[0]);await command(c,'pickup',{cargoId:fragile.id});p.queue=[];p.car.vx=0;p.car.vz=15;p.car.h=0;p.input={steer:0,throttle:false,brake:true,handbrake:false,active:true};p.lastInputAt=now;coop.simulate(r,now+1000/30);const integrity=fragile.integrity;assert.ok(integrity<100);
    await c.close();await settle();now+=10000;const d=await open('/coop'),wd=await command(d,'resume',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,code:r.code,selfId:p.id,token:wc.token},'welcome');assert.equal(p.cargo,fragile.id);assert.equal(fragile.integrity,integrity);assert.equal(urgent.deadlineAt,deadline);assert.notEqual(wd.token,wc.token);assert.ok(parseCoopRoom(wd.room));
    const stale=await open('/coop');const error=await command(stale,'resume',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,code:r.code,selfId:p.id,token:wc.token},'error');assert.match(error.message,/失效/);assert.equal(p.connection.ws.readyState,1);
    return{remainingUrgentMs:deadline-now,integrity,tokenRotated:true,oldTokenRejected:true};
  });
}catch(e){report.fatal=e.stack;}
finally{
  for(const c of peers)await c.close().catch(()=>{});await app?.close();report.cleanupComplete=!app?.httpServer.listening&&!app?.wss.clients.size;
  await finishAudit(root,new URL(import.meta.url),report);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.fatal&&!report.summary.FAIL&&report.cleanupComplete&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests?'PASS':'FAIL';
  const json=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'report.json'),json);await writeFile(new URL('voyager-city-integration-result.json',import.meta.url),json);console.log(JSON.stringify({status:report.status,summary:report.summary,error:report.fatal}));if(report.status!=='PASS')process.exitCode=1;
}
