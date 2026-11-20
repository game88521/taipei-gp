// Rex <game88521@gmail.com>. Full production regularity route, two cars, controls only after the normal start.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FrontierRallyService} from '../../server/frontier-rally-service.mjs';
import {FRONTIER_RALLY_VERSION as V,FRONTIER_RALLY_AVERAGES,parseRallyRoom} from '../../shared/frontier-rally.ts';
import {ConvoyRoadBot} from './frontier-convoy-bot.mjs';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),evidence=path.join(root,'tools/dev-tests',`frontier-rally-road-evidence-${Date.now()}`);await mkdir(evidence);
const report={status:'RUNNING',localOnly:true,externalRequests:0,browserUsed:false,networkTransportUsed:false,trueProductionService:true,trueFreeCar:true,trueCollider:true,controlsOnlyAfterNormalStart:true,cases:[],evidence,limitations:['Runs the actual FrontierRallyService receive(input)/tick and real full-city FreeCar/collider with deterministic server time. EventEmitter transport stands in for sockets, so this is complete-route road/authority evidence, not WebSocket delivery, internet, free-host performance, human balance or handset evidence. No pose, gate, progress, scoring, phase, simAt, startAt or deadline writes are made. The read-only guidance path extends the final road tangent by 20m to drive through the final production gate; the production route/gates are unchanged.'],...await startAudit(root,new URL(import.meta.url),['server/frontier-rally-service.mjs','server/summit-city-race-service.mjs','server/summit-city-physics.mjs','shared/frontier-rally.ts','shared/summit-city-race.ts','tools/dev-tests/frontier-convoy-bot.mjs','src/freecar.ts','src/router.ts','src/nexus-workshop.ts','public/data/city.json'])};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
class Socket extends EventEmitter{
 readyState=1;bufferedAmount=0;messages=0;maxEnvelopeBytes=0;
 send(raw){this.messages++;this.maxEnvelopeBytes=Math.max(this.maxEnvelopeBytes,Buffer.byteLength(raw));}
 close(){if(this.readyState!==1)return;this.readyState=3;this.emit('close');}
 terminate(){this.close();}ping(){}
}
async function drive(average){
 let now=1_800_000_000_000,service,details={average,status:'FAIL',trace:[],cars:[]};
 try{
  service=new FrontierRallyService({now:()=>now});const clients=[];
  for(let i=0;i<2;i++){const c=service.accept(new Socket());service.receive(c,i?{type:'join',v:V,name:'道路乙',code:clients[0].room.code}:{type:'create',v:V,name:'道路甲',average},now);clients.push(c);}
  const r=clients[0].room,command=(c,type,more={})=>service.receive(c,{type,revision:r.revision,matchId:r.matchId,map:r.definition.map,...more},now);
  assert.equal(r.players.size,2);assert.ok(parseRallyRoom(service.snapshot(r,now)));
  const routeHash=hash(r.route),definitionHash=hash(r.definition),timingHash=hash(r.timing),sameStart=clients.map(c=>({x:c.player.car.x,y:c.player.car.y,z:c.player.car.z,h:c.player.car.h}));assert.deepEqual(sameStart[0],sameStart[1]);
  for(const c of clients)command(c,'ready',{ready:true});command(clients[0],'start');now=r.startAt;service.tick(now);assert.equal(r.phase,'racing');
  const revision=r.revision,matchId=r.matchId,startAt=r.startAt,deadlineAt=r.deadlineAt,motion=clients.map(c=>c.player.motionRevision),seq=[0,0],stats=clients.map(()=>({next:0,gateChanges:[],maxStepM:0,maxSpeedKph:0,placeAfterStart:0,contacts:[],contactCount:0}));
  const end=r.route.path.at(-1),prior=r.route.path.at(-2),dx=end[0]-prior[0],dz=end[1]-prior[1],length=Math.hypot(dx,dz),guidance={...r.route,path:[...r.route.path,[end[0]+dx/length*20,end[1]+dz/length*20]],target:{x:end[0],z:end[1]}},bots=clients.map(()=>new ConvoyRoadBot({speed:average/3.6}));
  for(let i=0;i<2;i++){const car=clients[i].player.car,place=car.place.bind(car),update=car.update.bind(car);car.place=(...args)=>{stats[i].placeAfterStart++;return place(...args);};car.update=(...args)=>{const hit=update(...args);if(hit>0){stats[i].contactCount++;if(stats[i].contacts.length<30)stats[i].contacts.push({atMs:now-startAt,x:car.x,z:car.z,impact:hit});}return hit;};}
  let tick=0,parserChecks=0,lastProgressAt=0,best=0;
  for(;tick<600*60&&r.phase==='racing';tick++){
   const old=clients.map(c=>({x:c.player.car.x,y:c.player.car.y,z:c.player.car.z}));
   for(let i=0;i<2;i++){const c=clients[i],p=c.player;if(p.finishMs!==null||p.dnf)continue;const input=bots[i].input(p.car,guidance,p.next,now-startAt);service.receive(c,{type:'input',matchId:r.matchId,revision:r.revision,motionRevision:p.motionRevision,seq:++seq[i],...input},now);}
   now=startAt+(tick+1)*1000/60;service.tick(now);
   for(let i=0;i<2;i++){const p=clients[i].player,s=stats[i];s.maxStepM=Math.max(s.maxStepM,Math.hypot(p.car.x-old[i].x,p.car.z-old[i].z));s.maxSpeedKph=Math.max(s.maxSpeedKph,Math.hypot(p.car.vx,p.car.vz)*3.6);if(p.next!==s.next){assert.ok(p.next>s.next&&p.next<=s.next+3);for(let g=s.next;g<p.next;g++)s.gateChanges.push({gate:g,atMs:now-startAt});s.next=p.next;}assert.equal(p.motionRevision,motion[i]);}
   const progress=clients.reduce((sum,c)=>sum+c.player.next,0);if(progress>best){best=progress;lastProgressAt=tick;}
   if(tick%60===0||r.phase==='results'){const snap=service.snapshot(r,now);assert.ok(parseRallyRoom(snap),`strict parser at ${tick}`);parserChecks++;if(tick%600===0)details.trace.push({atMs:now-startAt,phase:r.phase,cars:clients.map((c,i)=>({x:c.player.car.x,y:c.player.car.y,z:c.player.car.z,h:c.player.car.h,next:c.player.next,speedKph:Math.hypot(c.player.car.vx,c.player.car.vz)*3.6,botProgress:bots[i].progress,pendingGate:r.route.gates[c.player.next]??null}))});}
   if(tick-lastProgressAt>120*60)throw Error('No ordered gate progress for 120 simulated seconds');
  }
  const snapshot=service.snapshot(r,now);details={...details,seconds:(now-startAt)/1000,phase:r.phase,reason:snapshot.reason,route:{length:r.route.length,gates:r.route.gates.length,pathPoints:r.route.path.length,start:r.route.start,end:r.route.gates.at(-1)},timing:r.timing,parserChecks,sameStart:true,normalStartOnly:true,routeUnchanged:routeHash===hash(r.route),definitionUnchanged:definitionHash===hash(r.definition),timingUnchanged:timingHash===hash(r.timing),revisionUnchanged:r.revision===revision,matchUnchanged:r.matchId===matchId,startDeadlineUnchanged:r.startAt===startAt&&r.deadlineAt===deadlineAt,guidanceEndpointExtrapolationM:20,maxEnvelopeBytes:Math.max(...clients.map(c=>c.ws.maxEnvelopeBytes)),inputMessages:seq.reduce((a,b)=>a+b,0),cars:clients.map((c,i)=>({slot:c.player.slot,...stats[i],finishMs:c.player.finishMs,dnf:c.player.dnf,arrivals:c.player.arrivals,timingPenaltyMs:Math.round(c.player.timingPenaltyMs),speedPenaltyMs:Math.round(c.player.speedPenaltyMs),final:{x:c.player.car.x,y:c.player.car.y,z:c.player.car.z,h:c.player.car.h},rank:snapshot.players.find(p=>p.id===c.player.id).rank})),snapshot};
  assert.equal(r.phase,'results');assert.equal(snapshot.reason,'complete');assert.ok(details.seconds<600);assert.equal(details.routeUnchanged,true);assert.equal(details.definitionUnchanged,true);assert.equal(details.timingUnchanged,true);assert.equal(details.revisionUnchanged,true);assert.equal(details.matchUnchanged,true);assert.equal(details.startDeadlineUnchanged,true);
  for(const car of details.cars){assert.equal(car.placeAfterStart,0);assert.equal(car.next,r.route.gates.length);assert.equal(car.gateChanges.length,r.route.gates.length);assert.equal(car.arrivals.length,4);assert.equal(car.dnf,null);assert.ok(car.finishMs>0&&car.finishMs<600000);assert.ok(car.maxStepM<1);assert.ok(car.maxSpeedKph<50);assert.equal(car.speedPenaltyMs,0);assert.equal(car.rank,1);}
  assert.deepEqual(details.cars[0].arrivals,details.cars[1].arrivals);details.status='PASS';
 }catch(e){details.error=String(e.stack);if(service){const r=[...service.rooms.values()][0];if(r)details.failureSnapshot=service.snapshot(r,now);}}
 finally{service?.close();details.cleanupComplete=!service||service.clients.size===0&&service.rooms.size===0;await writeFile(path.join(evidence,`average-${average}.json`),JSON.stringify(details,null,2)+'\n');}
 return details;
}
try{
 const selected=process.argv.find(a=>a.startsWith('--average=')),averages=selected?[Number(selected.slice(10))]:FRONTIER_RALLY_AVERAGES;assert.ok(averages.every(a=>FRONTIER_RALLY_AVERAGES.includes(a)));
 for(const average of averages){const result=await drive(average);report.cases.push(result);console.log(JSON.stringify({average,status:result.status,seconds:result.seconds,gates:result.route?.gates,finishMs:result.cars?.map(c=>c.finishMs),arrivals:result.cars?.map(c=>c.arrivals),contactCount:result.cars?.map(c=>c.contactCount),error:result.error,evidence}));}
}catch(e){report.fatal=String(e.stack);}
finally{await finishAudit(root,new URL(import.meta.url),report);report.cleanupComplete=report.cases.every(c=>c.cleanupComplete);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.fatal&&report.cases.length&&!report.summary.FAIL&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests&&report.cleanupComplete?'PASS':'FAIL';const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'result.json'),bytes);await writeFile(new URL('frontier-rally-road-node-result.json',import.meta.url),bytes);console.log(JSON.stringify({status:report.status,...report.summary,evidence}));if(report.status!=='PASS')process.exitCode=1;}
