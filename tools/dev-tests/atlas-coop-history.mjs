import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'vite';
import {parseAst} from 'rolldown/parseAst';
import {createMultiplayerServer} from '../../server/index.mjs';
import {COOP_VERSION,COOP_CITY_STAMP,COOP_SESSION_MS,COOP_STATIONS,parseCoopRoom} from '../../shared/nexus-coop.ts';
import {WireClient,ORIGIN} from './multiplayer-test-helpers.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex'),evidence=path.join(root,'tools/dev-tests',`atlas-coop-history-evidence-${Date.now()}`);await mkdir(evidence);
const files=['src/atlas-coop-history.ts','src/atlas-backup-validators.ts','src/nexus-coop-ui.ts','server/nexus-coop-service.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(path.join(root,f)))])));
const report={status:'FAIL',localOnly:true,cases:[],sourceHashes:await hashes(),scriptSha256:sha(await readFile(new URL(import.meta.url))),evidence:path.relative(root,evidence).replaceAll('\\','/'),limitations:['真WS起房/時限結算＋真UI recordResult callback；DOM/Storage是隔離fixture，未冒稱真人全城完成送貨。']};
async function bundle(file){const result=await build({root,configFile:false,logLevel:'silent',build:{write:false,copyPublicDir:false,emptyOutDir:false,minify:false,lib:{entry:path.join(root,file),formats:['es']}}}),output=Array.isArray(result)?result[0].output:result.output;return import('data:text/javascript;base64,'+Buffer.from(output.find(o=>o.type==='chunk'&&o.isEntry).code).toString('base64'));}
function walk(node,test){if(!node||typeof node!=='object')return null;if(test(node))return node;for(const value of Object.values(node))for(const child of Array.isArray(value)?value:[value]){const found=walk(child,test);if(found)return found;}return null;}
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:e.stack});}console.log(JSON.stringify(report.cases.at(-1)));}
let app,now=1000000;const peers=[];
try{
const {parseCoopHistory}=await bundle('src/atlas-coop-history.ts'),{validateAtlasBackup}=await bundle('src/atlas-backup-validators.ts');
const ui=stripTypeScriptTypes(await readFile(path.join(root,'src/nexus-coop-ui.ts'),'utf8'),{mode:'transform'}),ast=parseAst(ui),mount=walk(ast,n=>n.type==='FunctionDeclaration'&&n.id?.name==='mountNexusCoop'),record=mount.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id?.name==='recordResult');assert.ok(record);
function writer(selfId){const writes=[],context=vm.createContext({results:[],canWriteHistory:true,client:{selfId},HISTORY_KEY:'taipei-gp-city-coop-results-v1',localStorage:{setItem:(key,raw)=>writes.push({key,raw})}});vm.runInContext(ui.slice(record.start,record.end),context);return{context,writes,write:room=>context.recordResult(room),get rows(){return JSON.parse(writes.at(-1).raw);}};}
const validate=rows=>validateAtlasBackup({slots:[{key:'taipei-gp-city-coop-results-v1',raw:JSON.stringify(rows)}],replays:[]},()=>({ok:true}));
app=createMultiplayerServer({autoTick:false,now:()=>now,allowedOrigins:[ORIGIN]});await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));const endpoint=`ws://127.0.0.1:${app.httpServer.address().port}/coop`;
async function open(){const c=await new WireClient(endpoint).open();await c.until(m=>m.type==='hello');peers.push(c);c.request=0;return c;}
async function cmd(c,type,fields={},expected='ack'){const mark=c.mark(),request=++c.request;c.send({...fields,type,request});return c.until(m=>m.type===expected&&(expected==='welcome'||m.request===request),mark);}
const actual=[];
for(const mode of['direct','relay','special'])await check(`2/10真WS ${mode}時限結算→真recordResult產物可由UI與backup共同解析`,async()=>{
  const a=await open(),wa=await cmd(a,'create',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,name:'歷史甲',vehicle:'sedan',mode},'welcome'),b=await open();await cmd(b,'join',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,name:'歷史乙',vehicle:'pickup',code:wa.room.code},'welcome');await cmd(a,'ready',{ready:true});await cmd(b,'ready',{ready:true});await cmd(a,'start');const room=app.coopService.rooms.get(wa.room.code);now+=COOP_SESSION_MS+1;app.coopService.finishIfDue(room);const snapshot=app.coopService.snapshot(room);assert.equal(snapshot.phase,'finished');assert.equal(snapshot.reason,'timeout');const w=writer(wa.selfId);w.write(snapshot);const rows=w.rows;assert.equal(rows[0].mode,mode);assert.equal(rows[0].total,mode==='relay'?5:6);assert.ok(parseCoopHistory(rows));assert.doesNotThrow(()=>validate(rows));actual.push(rows[0]);return{mode,total:rows[0].total,record:rows[0],realServerTimeout:true};
});
await check('2/10舊六件紀錄缺新欄位仍可還原，沒有改寫傳入物件',()=>{const old={...actual[0]};delete old.mode;delete old.total;const before=JSON.stringify(old),parsed=parseCoopHistory([old]);assert.equal(parsed[0].mode,'direct');assert.equal(parsed[0].total,6);assert.equal(JSON.stringify(old),before);assert.doesNotThrow(()=>validate([old]));});
await check('2/10 total與mode壞值／錯配由UI和backup一致拒絕',()=>{for(const change of[r=>r.total=4,r=>r.total='5',r=>r.total=null,r=>r.mode='bad',r=>r.mode=null,r=>r.total=6,r=>delete r.total]){const r={...actual[1]};change(r);assert.equal(parseCoopHistory([r]),null);assert.throws(()=>validate([r]),/無效/);}for(const change of[r=>r.total=5,r=>r.mode='relay']){const r={...actual[0]};change(r);assert.equal(parseCoopHistory([r]),null);assert.throws(()=>validate([r]),/無效/);}});
await check('2/10 own超過共同送達數、假完成、負時間及重複id拒絕',()=>{for(const change of[r=>r.own=1,r=>r.completed=true,r=>r.delivered=6,r=>r.at=-1,r=>r.at=Infinity]){const r={...actual[1]};change(r);assert.equal(parseCoopHistory([r]),null);assert.throws(()=>validate([r]),/無效/);}assert.equal(parseCoopHistory([actual[0],actual[0]]),null);assert.throws(()=>validate([actual[0],actual[0]]),/無效/);});
await check('2/10真recordResult同輪去重且保留20輪上限，每筆產物契約一致',()=>{const self='a'.repeat(20),w=writer(self),fixture={phase:'finished',reason:'timeout',runId:'f'.repeat(24),delivered:0,serverTime:now,cargo:Array(5).fill({}),mode:'relay',players:[{id:self,delivered:0}]};w.write(fixture);w.write(fixture);assert.equal(w.writes.length,1);for(let i=0;i<25;i++)w.write({...fixture,runId:i.toString(16).padStart(24,'0')});assert.equal(w.rows.length,20);assert.ok(parseCoopHistory(w.rows));assert.doesNotThrow(()=>validate(w.rows));});
await check('8 special六單真server結算1000分→真UI歷史→backup共同接受（明示停站fixture）',async()=>{
  now=Math.round(now);const a=await open(),wa=await cmd(a,'create',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,name:'特殊貨運歷史',vehicle:'sedan',mode:'special'},'welcome'),b=await open();
  await cmd(b,'join',{v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,name:'隊友',vehicle:'pickup',code:wa.room.code},'welcome');await cmd(a,'ready',{ready:true});await cmd(b,'ready',{ready:true});await cmd(a,'start');
  const svc=app.coopService,r=svc.rooms.get(wa.room.code),p=r.players.get(wa.selfId);
  function stoppedFixture(station){svc.place(p,station);for(let i=0;i<40;i++){now+=1000/30;p.input={steer:0,throttle:false,brake:false,handbrake:false,active:true};p.lastInputAt=now;svc.simulate(r,now);}}
  for(const cargo of r.cargo){stoppedFixture(COOP_STATIONS[0]);await cmd(a,'pickup',{cargoId:cargo.id});stoppedFixture(COOP_STATIONS.find(s=>s.id===cargo.destination));await cmd(a,'deliver',{cargoId:cargo.id});}
  const snapshot=svc.snapshot(r);assert.equal(r.phase,'finished');assert.equal(snapshot.reason,'complete');assert.equal(snapshot.points,1000);assert.ok(parseCoopRoom(snapshot));
  const w=writer(wa.selfId);w.write(snapshot);w.write(snapshot);const row=w.rows[0];assert.equal(w.writes.length,1);assert.equal(row.mode,'special');assert.equal(row.total,6);assert.equal(row.delivered,6);assert.equal(row.completed,true);assert.equal(row.points,1000);assert.ok(parseCoopHistory(w.rows));assert.doesNotThrow(()=>validate(w.rows));
  for(const change of[r=>delete r.points,r=>r.points=-1,r=>r.points=1001,r=>r.points=1.1,r=>r.points='1000',r=>r.total=5,r=>{r.delivered=1;r.own=1;r.completed=false;r.points=201;}]){const bad={...row};change(bad);assert.equal(parseCoopHistory([bad]),null);assert.throws(()=>validate([bad]),/無效/);}
  return{record:row,score:snapshot.points,duplicateWrites:w.writes.length,poseFixture:true,humanFullCityDriving:false};
});
}catch(e){report.fatal=e.stack;}finally{for(const p of peers)await p.close().catch(()=>{});await app?.close();report.cleanupComplete=!app?.httpServer.listening&&!app?.coopService.clients.size;report.sourceUnchanged=JSON.stringify(await hashes())===JSON.stringify(report.sourceHashes);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.fatal&&report.summary.FAIL===0&&report.sourceUnchanged&&report.cleanupComplete?'PASS':'FAIL';const json=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'report.json'),json);await writeFile(path.join(root,'tools/dev-tests/atlas-coop-history-result.json'),json);console.log(JSON.stringify({status:report.status,summary:report.summary,fatal:report.fatal,cleanup:report.cleanupComplete}));if(report.status!=='PASS')process.exitCode=1;}
