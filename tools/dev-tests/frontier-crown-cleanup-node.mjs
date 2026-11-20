// Rex <game88521@gmail.com>. Real WS plus explicit deferred server-close fixture; no load-cause claim.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {setImmediate as yieldIO} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket as NodeSocket} from '../../server/node_modules/ws/wrapper.mjs';
import {createMultiplayerServer} from '../../server/index.mjs';
import {SOCIAL_GRACE_MS} from '../../shared/expedition-social.ts';
import {ORIGIN,settle} from './multiplayer-test-helpers.mjs';
import {pureUrl} from './pure-module-loader.mjs';
import {waitForServerClose} from './frontier-server-close-barrier.mjs';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),evidence=path.join(root,'tools/dev-tests',`frontier-crown-cleanup-evidence-${Date.now()}`);await mkdir(evidence);
const report={status:'RUNNING',localOnly:true,externalRequests:0,realLoopbackWebSocket:true,explicitDeferredServerDropFixture:true,evidence,cases:[],limitations:['Only the server close callback is deliberately deferred. This deterministically checks cleanup ordering and does not prove why the OS/event loop delayed the original run. No game product or physics is changed.'],...await startAudit(root,new URL(import.meta.url),['server/expedition-social-service.mjs','src/expedition-social-client.ts','tools/dev-tests/frontier-server-close-barrier.mjs'])};
const C=await import(await pureUrl(root,'expedition-social-client.ts')),original=globalThis.WebSocket;globalThis.WebSocket=class extends NodeSocket{constructor(url){super(url,{origin:ORIGIN});}};
async function until(fn){const end=performance.now()+4000;while(!fn()&&performance.now()<end)await yieldIO();assert.ok(fn(),'explicit close callback arrived');}
async function fixture(fixed){
 let now=2_000_000,app,client;
 try{
  app=createMultiplayerServer({autoTick:false,prewarmCityRace:false,allowedOrigins:[ORIGIN],now:()=>now});await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));const service=app.socialService,endpoint=`ws://127.0.0.1:${app.httpServer.address().port}/city-social`;
  client=new C.ExpeditionSocialClient(endpoint,()=>{},null);await client.enter('create','清理次序','sedan','cruise','dry');assert.equal(service.rooms.size,1);assert.equal(service.clients.size,1);
  const delayed=[],drop=service.drop.bind(service);service.drop=c=>delayed.push(c);client.dispose();await until(()=>delayed.length>0);await settle();const before=now;
  if(fixed){let finished=false;const barrier=waitForServerClose(service).then(()=>finished=true);await yieldIO();assert.equal(finished,false,'must wait for authority, not client close');assert.equal(now,before);for(const c of delayed.splice(0))drop(c);await barrier;assert.equal(service.clients.size,0);now+=SOCIAL_GRACE_MS+1;service.tick(now);}
  else{now+=SOCIAL_GRACE_MS+1;service.tick(now);for(const c of delayed.splice(0))drop(c);await settle();}
  const state={rooms:service.rooms.size,clients:service.clients.size,clockAdvanceMs:now-before,disconnectedAt:[...service.rooms.values()].flatMap(r=>[...r.players.values()].map(p=>p.disconnectedAt)),now,waitedForServerSideClose:fixed};
  // Release the explicit fixture for the final production shutdown.
  service.drop=drop;return state;
 }finally{client?.dispose();await app?.close();}
}
async function test(name,fn){const c={name,status:'PASS'};try{c.details=await fn();}catch(e){c.status='FAIL';c.error=String(e.stack);}report.cases.push(c);console.log(JSON.stringify(c));}
try{
 if(process.argv.includes('--repro'))await test('原固定settle清理不應留下房間（明示延後server drop）',async()=>{const state=await fixture(false);assert.equal(state.rooms,0,JSON.stringify(state));return state;});
 else{
  await test('明示延後真server drop，舊cleanup在新時鐘才記斷線而留下完整15秒房間',async()=>{const state=await fixture(false);assert.equal(state.rooms,1);assert.equal(state.clients,0);assert.equal(state.disconnectedAt[0],state.now);return state;});
  await test('真authority-close barrier先等server drop再跳grace，房間與連線皆完整清空',async()=>{const state=await fixture(true);assert.equal(state.rooms,0);assert.equal(state.clients,0);assert.equal(state.clockAdvanceMs,SOCIAL_GRACE_MS+1);return state;});
 }
}catch(e){report.fatal=String(e.stack);}
finally{globalThis.WebSocket=original;await finishAudit(root,new URL(import.meta.url),report);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.fatal&&!report.summary.FAIL&&report.sourceUnchangedDuringTests&&report.scriptUnchangedDuringTests?'PASS':'FAIL';const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'result.json'),bytes);await writeFile(new URL('frontier-crown-cleanup-node-result.json',import.meta.url),bytes);console.log(JSON.stringify({status:report.status,...report.summary,evidence}));if(report.status!=='PASS')process.exitCode=1;}
