// Rex <game88521@gmail.com>. Real loopback HTTP and WS; failure fixtures use a separately identified local service.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket as Socket,WebSocketServer} from '../../server/node_modules/ws/wrapper.mjs';
import {createMultiplayerServer} from '../../server/index.mjs';
import {SOCIAL_VERSION} from '../../shared/expedition-social.ts';
import {EXPEDITION_DUTY_VERSION} from '../../shared/expedition-duty.ts';
import {pureSource,moduleUrl} from './pure-module-loader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),origin='http://127.0.0.1:4317',files=['src/odyssey-diagnostics.ts','server/odyssey-diagnostics.mjs','server/index.mjs','shared/expedition-social.ts','shared/expedition-duty.ts','server/expedition-social-service.mjs','server/expedition-duty-service.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')])));
const report={status:'FAIL',localOnly:true,externalRequests:0,cases:[],sourceHashes:await hashes(),failureFixtures:'Separate loopback HTTP/WS fixture advertises selected capability/version or omits hello; actual mode PASS uses real integrated server.'};
const originalFetch=globalThis.fetch,originalWs=globalThis.WebSocket;
let app,fixture,wss,sockets=new Set(),fixtureMode='valid',requested=[];
async function test(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack)});}console.log(JSON.stringify(report.cases.at(-1)));}
try{
 const D=await import(moduleUrl((await pureSource(root,'odyssey-diagnostics.ts')).replace(/import\s+['"]\.\/odyssey-network\.css['"];?/,'')));
 globalThis.fetch=(url,init)=>{assert.equal(new URL(url).hostname,'127.0.0.1');return originalFetch(url,{...init,headers:{Origin:origin}});};
 globalThis.WebSocket=class extends Socket{constructor(url){assert.equal(new URL(url).hostname,'127.0.0.1');requested.push(new URL(url).pathname);super(url,{origin});}};
 app=createMultiplayerServer({allowedOrigins:[origin],prewarmCityRace:false});await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));const base='ws://127.0.0.1:'+app.httpServer.address().port;
 const diagnostic=await(await originalFetch(base.replace('ws:','http:')+'/diagnostics',{headers:{Origin:origin}})).json();
 await test('新capabilities公開字串，舊protocol仍精確5欄',()=>{assert.equal(Object.keys(diagnostic.protocol).length,5);assert.equal(diagnostic.capabilities.socialVersion,SOCIAL_VERSION);assert.equal(diagnostic.capabilities.dutyVersion,EXPEDITION_DUTY_VERSION);});
 await test('固定白名單保留各模式路徑；拒絕錯路徑/帳密/query/fragment/混合內容',()=>{for(const p of['/ws','/coop','/city-race','/city-social','/city-duty'])assert.equal(new URL(D.diagnosticEndpoints('wss://game.invalid'+p,true).ws).pathname,p);for(const u of['wss://game.invalid/','wss://game.invalid/unknown','wss://u:p@game.invalid/city-social','wss://game.invalid/city-social?token=x','wss://game.invalid/city-social#x','ws://game.invalid/city-duty'])assert.equal(D.diagnosticEndpoints(u,true),null);});
 for(const p of['/ws','/coop','/city-race','/city-social','/city-duty'])await test('真整合服務診斷'+p+'，核對正確endpoint且不建立房間',async()=>{const r=await D.runDiagnostic(base+p,origin,new AbortController().signal);assert.equal(r.code,'PASS');assert.equal(r.endpointPath,p);assert.equal(requested.at(-1),p);for(const key of['service','coopService','cityRaceService','socialService','dutyService'])if(app[key])assert.equal(app[key].rooms.size,0);return{path:p,code:r.code};});
 fixture=createServer((req,res)=>{const body=structuredClone(diagnostic);if(fixtureMode==='missing-capability')delete body.capabilities.socialVersion;if(fixtureMode==='wrong-capability')body.capabilities.socialVersion='old';if(fixtureMode==='unsupported'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));});
 wss=new WebSocketServer({server:fixture});wss.on('connection',ws=>{sockets.add(ws);ws.on('close',()=>sockets.delete(ws));if(!['no-hello','pending'].includes(fixtureMode))ws.send(JSON.stringify({type:'hello',v:fixtureMode==='wrong-hello'?'old':SOCIAL_VERSION}));if(fixtureMode==='no-hello')ws.send(JSON.stringify({type:'pong',sentAt:0,serverTime:Date.now()}));ws.on('message',raw=>{const m=JSON.parse(String(raw));ws.send(JSON.stringify({type:'pong',sentAt:m.sentAt,serverTime:Date.now()}));});});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const fake='ws://127.0.0.1:'+fixture.address().port+'/city-social';
 await test('舊後端缺capability或版本不符不可借舊/ws宣稱支援新玩法',async()=>{for(const mode of['missing-capability','wrong-capability']){fixtureMode=mode;const before=requested.length;assert.equal((await D.runDiagnostic(fake,origin,new AbortController().signal)).code,'VERSION_MISMATCH');assert.equal(requested.length,before);}});
 await test('診斷404明確SERVICE_HTTP；錯hello不可PASS',async()=>{fixtureMode='unsupported';assert.equal((await D.runDiagnostic(fake,origin,new AbortController().signal)).code,'SERVICE_HTTP');fixtureMode='wrong-hello';assert.equal((await D.runDiagnostic(fake,origin,new AbortController().signal)).code,'WS_UNCONFIRMED');});
 await test('假pong缺hello不可PASS；玩家取消會關閉待驗socket且不重試',async()=>{fixtureMode='no-hello';assert.equal((await D.runDiagnostic(fake,origin,new AbortController().signal)).code,'WS_UNCONFIRMED');fixtureMode='pending';const c=new AbortController(),before=requested.length,p=D.runDiagnostic(fake,origin,c.signal);setTimeout(()=>c.abort(),100);assert.equal((await p).code,'CANCELLED');assert.equal(requested.length,before+1);});
 await test('已取消不發HTTP，診斷匯出不含伺服器額外秘密欄位',async()=>{const c=new AbortController();c.abort();const before=requested.length;assert.equal((await D.runDiagnostic(fake,origin,c.signal)).code,'CANCELLED');assert.equal(requested.length,before);const body=structuredClone(diagnostic);body.token='SECRET';body.capabilities.token='SECRET';assert.ok(!JSON.stringify(D.parseDiagnostic(body)).includes('SECRET'));});
}catch(e){report.fatal=String(e.stack);}finally{
 globalThis.fetch=originalFetch;globalThis.WebSocket=originalWs;for(const s of sockets)s.terminate();if(wss)await new Promise(r=>wss.close(r));if(fixture)await new Promise(r=>fixture.close(r));await app?.close();report.cleanupComplete=!app?.httpServer.listening&&!fixture?.listening&&sockets.size===0;report.sourceUnchanged=JSON.stringify(report.sourceHashes)===JSON.stringify(await hashes());report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};report.status=!report.fatal&&!report.summary.FAIL&&report.cleanupComplete&&report.sourceUnchanged?'PASS':'FAIL';await writeFile(new URL('expedition-diagnostics-node-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,...report.summary,fatal:report.fatal}));if(report.status!=='PASS')process.exitCode=1;
}
