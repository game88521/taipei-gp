import assert from 'node:assert/strict';
import {readFile,writeFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {WebSocket} from '../../server/node_modules/ws/wrapper.mjs';
import {createMultiplayerServer} from '../../server/index.mjs';
import {realCityWorld} from '../../server/summit-city-race-service.mjs';
import {PROTOCOL_VERSION} from '../../shared/multiplayer-protocol.ts';
import {COOP_VERSION} from '../../shared/nexus-coop.ts';
import {CITY_RACE_VERSION} from '../../shared/summit-city-race.ts';
import {SOCIAL_VERSION} from '../../shared/expedition-social.ts';
import {EXPEDITION_DUTY_VERSION} from '../../shared/expedition-duty.ts';
const root=fileURLToPath(new URL('../../',import.meta.url)),origin='http://127.0.0.1:4317';
const paths=['/ws','/coop','/city-race','/city-social','/city-duty'],versions=[PROTOCOL_VERSION,COOP_VERSION,CITY_RACE_VERSION,SOCIAL_VERSION,EXPEDITION_DUTY_VERSION];
const report={status:'RUNNING',localOnly:true,externalRequests:0,cases:[],sourceHashes:{},limitations:['Docker COPY 的實際遞迴 runtime import 與資料資產閉包已驗證，未執行 Docker image build 或雲端部署。']};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const auditFiles=['server/Dockerfile',...(await readdir(path.join(root,'server'))).filter(f=>f.endsWith('.mjs')).map(f=>'server/'+f),...(await readdir(path.join(root,'shared'))).filter(f=>/\.(ts|json)$/.test(f)).map(f=>'shared/'+f)];
for(const name of auditFiles)report.sourceHashes[name]=sha(await readFile(path.join(root,name)));
report.scriptSha256=sha(await readFile(new URL(import.meta.url)));
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack).slice(0,3000)});process.exitCode=1;}console.log(JSON.stringify(report.cases.at(-1)));}
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(test){for(let n=0;n<300;n++){const value=test();if(value)return value;await pause();}throw Error('本機等待逾時');}
async function start(options={}){const app=createMultiplayerServer({allowedOrigins:[origin],autoTick:false,...options});await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));return{...app,base:'http://127.0.0.1:'+app.httpServer.address().port};}
async function connect(app,route,from=origin){const ws=new WebSocket(app.base.replace('http:','ws:')+route,{origin:from}),messages=[];ws.on('message',raw=>messages.push(JSON.parse(String(raw))));ws.on('error',()=>{});await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});if(route==='/ws')ws.send(JSON.stringify({type:'ping',sentAt:123}));return{ws,messages,hello:await until(()=>messages.find(m=>m.type===(route==='/ws'?'pong':'hello')))};}
async function rejection(app,route,from=origin){return new Promise((resolve,reject)=>{const ws=new WebSocket(app.base.replace('http:','ws:')+route,{origin:from});const timer=setTimeout(()=>{ws.terminate();reject(Error('拒絕回應逾時'));},3000);ws.on('error',()=>{});ws.on('unexpected-response',(_req,res)=>{clearTimeout(timer);const code=res.statusCode;res.resume();ws.terminate();resolve(code);});ws.once('open',()=>{clearTimeout(timer);ws.terminate();reject(Error('不應接受此連線'));});});}
const total=app=>[app.service,app.coopService,app.cityRaceService,app.socialService,app.dutyService].reduce((n,s)=>n+s.clients.size,0);
let worldCalls=0;
const app=await start({cityRaceOptions:{worldFactory:()=>{worldCalls++;return realCityWorld();}}}),clients=[];
try{
 await check('五個實際 loopback 路徑握手，新玩法各自對應版本',async()=>{for(let i=0;i<paths.length;i++){const c=await connect(app,paths[i]);clients.push(c.ws);if(i===0){assert.equal(c.hello.sentAt,123);assert.ok(Number.isFinite(c.hello.serverTime));}else assert.equal(c.hello.v,versions[i]);}return{paths,connections:total(app),gpHandshake:'既有ping/pong，GP協定沒有hello'};});
 await check('四個城市服務共用同一份真實184圖塊世界',()=>{const world=app.cityRaceService.world();assert.equal(app.coopService.world(),world);assert.equal(app.socialService.world(),world);assert.equal(app.dutyService.world(),world);assert.equal(worldCalls,1);return{worldFactoryCalls:worldCalls,shared:true};});
 await check('health 包含新服務版本容量與跨玩法總連線',async()=>{const res=await fetch(app.base+'/health'),body=await res.json();assert.equal(res.status,200);assert.equal(body.totalConnections,5);assert.equal(body.citySocial.version,SOCIAL_VERSION);assert.equal(body.cityDuty.version,EXPEDITION_DUTY_VERSION);assert.equal(body.citySocial.connections,1);assert.equal(body.cityDuty.connections,1);assert.equal(body.capacity.socialRooms,2);assert.equal(body.capacity.dutyRooms,2);return{total:body.totalConnections,social:body.citySocial,duty:body.cityDuty};});
 await check('所有玩法只接受 exact Origin，未知路徑與查詢皆拒絕',async()=>{for(const route of paths){assert.equal(await rejection(app,route,origin+'.evil.example'),403);assert.equal(await rejection(app,route,origin+'/'),403);}assert.equal(await rejection(app,'/unknown'),404);assert.equal(await rejection(app,'/city-duty?token=untrusted'),404);assert.equal(total(app),5);});
 await check('新路徑診斷 echo 時戳，未建立房間也不洩漏憑證',async()=>{for(const index of [3,4]){const c=clients[index],sentAt=123456;let pong;const listener=raw=>{const m=JSON.parse(String(raw));if(m.type==='pong')pong=m;};c.on('message',listener);c.send(JSON.stringify({type:'ping',sentAt}));await until(()=>pong);assert.equal(pong.sentAt,sentAt);assert.ok(Number.isFinite(pong.serverTime));assert.equal('token' in pong,false);c.off('message',listener);}});
}finally{for(const ws of clients)ws.terminate();await app.close();await app.close();}
await check('close 冪等並清空五種服務的所有連線與房間',()=>{for(const service of [app.service,app.coopService,app.cityRaceService,app.socialService,app.dutyService]){assert.equal(service.clients.size,0);assert.equal(service.rooms.size,0);}assert.equal(app.httpServer.listening,false);});
await check('跨五種玩法合計容量，任一新路徑不能繞過全域限制',async()=>{
 const a=await start({capacityEnv:{ATLAS_MAX_CONNECTIONS:'5'}}),opened=[];
 try{for(const route of paths)opened.push((await connect(a,route)).ws);assert.equal(total(a),5);for(const route of paths)assert.equal(await rejection(a,route),503);opened.shift().terminate();await until(()=>total(a)===4);opened.push((await connect(a,'/city-duty')).ws);assert.equal(total(a),5);return{globalLimit:5,perMode:[1,1,1,1,1]};}finally{for(const ws of opened)ws.terminate();await a.close();}
});
await check('每位址16條上限跨路徑共用，離線後確實釋放',async()=>{
 const a=await start(),opened=[];try{for(let n=0;n<16;n++)opened.push((await connect(a,paths[n%5])).ws);assert.equal(await rejection(a,'/city-duty'),503);opened.shift().terminate();await until(()=>total(a)===15);opened.push((await connect(a,'/city-social')).ws);assert.equal(total(a),16);return{perAddressLimit:16};}finally{for(const ws of opened)ws.terminate();await a.close();}
});
await check('Docker 白名單涵蓋所有遞迴 runtime import 與24賽道及城市圖塊',async()=>{
 const docker=await readFile(path.join(root,'server/Dockerfile'),'utf8'),copies=[];
 for(const line of docker.split(/\r?\n/)){if(!line.startsWith('COPY '))continue;const parts=line.slice(5).trim().split(/\s+/),dest=parts.pop();for(const source of parts)copies.push({source,dest});}
 const covered=relative=>copies.some(({source,dest})=>{const pattern=new RegExp('^'+source.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','[^/]*')+(source.endsWith('/')?'.*':'')+'$');if(!pattern.test(relative))return false;const expected='/app/'+relative;const base=dest==='./'?'/app/server/':dest;const actual=path.posix.join(base,source.endsWith('/')?relative.slice(source.length):path.posix.basename(relative));return expected===actual;});
 const visited=new Set();async function visit(relative){if(visited.has(relative))return;visited.add(relative);assert.ok(covered(relative),'Docker未複製runtime依賴:'+relative);const src=await readFile(path.join(root,relative),'utf8');if(relative.endsWith('.json'))return;
  const js=relative.endsWith('.ts')?stripTypeScriptTypes(src):src,imports=[];
  for(const match of js.matchAll(/(?:^|\n)\s*(?:import\s*(?:[^'";]*?\s+from\s*)?|export\s*[^'";]*?\s+from\s*)['"](\.[^'"]+)['"]/g))imports.push(match[1]);
  for(const match of js.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g))imports.push(match[1]);
  for(const item of imports.filter(p=>p.startsWith('.')))await visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative),item)));
 }
 await visit('server/index.mjs');const catalog=JSON.parse(await readFile(path.join(root,'shared/multiplayer-catalog.json'),'utf8')),city=JSON.parse(await readFile(path.join(root,'public/data/city.json'),'utf8')),assets=[...catalog.tracks.map(t=>t.source),'public/data/city.json',...city.tiles.list.map(([x,z])=>'public/data/tiles/'+x+'_'+z+'.json')];
 for(const name of assets){assert.ok(covered(name),'Docker缺少資產:'+name);assert.ok((await stat(path.join(root,name))).isFile());}assert.ok(visited.size>30);return{runtimeFiles:visited.size,trackFiles:catalog.tracks.length,tiles:city.tiles.list.length,dockerBuilt:false};
});
report.sourceUnchanged=true;for(const[name,hash]of Object.entries(report.sourceHashes))if(sha(await readFile(path.join(root,name)))!==hash)report.sourceUnchanged=false;
report.scriptUnchanged=sha(await readFile(new URL(import.meta.url)))===report.scriptSha256;
report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=report.summary.FAIL||!report.sourceUnchanged||!report.scriptUnchanged?'FAIL':'PASS';if(report.status==='FAIL')process.exitCode=1;
await writeFile(new URL('./expedition-server-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary}));
