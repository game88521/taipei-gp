// Rex <game88521@gmail.com>. Local-only diagnostic; does not change the running browser test.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CdpConnection,focus} from './multiplayer-ui-cdp.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),origin='http://127.0.0.1:4317';
const dir=path.join(root,'tools/dev-tests','beacon-mobile-network-diagnostic-evidence-'+Date.now());
await mkdir(dir);
const started=Date.now(),pending=new Map(),paused=new Map();
const report={status:'RUNNING',startedAt:new Date().toISOString(),localOnly:true,diagnosticOnly:true,realPhoneUsed:false,exceptions:[],loadingFailures:[],externalRequests:[],stages:[],network:[]};
const elapsed=()=>Date.now()-started;
const event=(kind,data={})=>{report.network.push({atMs:elapsed(),kind,...data});};
const snapshot=()=>({pending:[...pending].map(([id,r])=>({id,...r,ageMs:elapsed()-r.atMs})),paused:[...paused].map(([id,r])=>({id,...r,ageMs:elapsed()-r.atMs}))});
async function stage(name){const value={atMs:elapsed(),name,...snapshot()};if(page){try{value.page=await page.evaluate(`({ready:document.readyState,stream:window.__gp?.stream?{loaded:__gp.stream.loaded,pending:__gp.stream.pending}:null,resources:performance.getEntriesByType('resource').map(e=>({name:e.name,initiatorType:e.initiatorType,startTime:e.startTime,responseEnd:e.responseEnd,duration:e.duration,transferSize:e.transferSize}))})`);}catch(e){value.pageSnapshotError=String(e);}}if(browser){try{value.workers=(await browser.send('Target.getTargets')).targetInfos.filter(t=>t.browserContextId===context&&t.type.includes('worker')).map(t=>({targetId:t.targetId,type:t.type,url:t.url,attached:t.attached}));}catch(e){value.workerSnapshotError=String(e);}}report.stages.push(value);console.log(JSON.stringify({phase:name,pending:value.pending,paused:value.paused,workers:value.workers,stream:value.page?.stream}));await writeFile(path.join(dir,'progress.json'),JSON.stringify(report,null,2)+'\n');}
let browser,page,context,error;
try{
 const cdp='http://127.0.0.1:'+(process.env.GP_MULTIPLAYER_CDP_PORT??9334),meta=await(await fetch(cdp+'/json/version')).json();
 browser=new CdpConnection(meta.webSocketDebuggerUrl,'beacon-mobile-network-diagnostic',report);
 context=(await browser.send('Target.createBrowserContext')).browserContextId;
 const target=(await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context})).targetId;
 const entry=(await(await fetch(cdp+'/json')).json()).find(t=>t.id===target);assert.ok(entry);
 page=new CdpConnection(entry.webSocketDebuggerUrl,'beacon-mobile-network-diagnostic-page',report);
 for(const method of['Page.enable','Runtime.enable','Network.enable'])await page.send(method);
 page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails));
 page.on('Network.requestWillBeSent',e=>{if(/^https?:/.test(e.request.url)){const r={url:e.request.url,type:e.type,initiator:e.initiator?.type,initiatorUrl:e.initiator?.url??e.initiator?.stack?.callFrames?.[0]?.url,workerUrl:/tileworker|worker[-.]/i.test(e.request.url),atMs:elapsed()};pending.set(e.requestId,r);event('request',{id:e.requestId,...r,redirect:e.redirectResponse?{status:e.redirectResponse.status,url:e.redirectResponse.url}:null});}});
 page.on('Network.requestServedFromCache',e=>{const r=pending.get(e.requestId);if(r)r.cacheEvent=true;event('cache',{id:e.requestId});});
 page.on('Network.responseReceived',e=>{const value={status:e.response.status,fromDiskCache:e.response.fromDiskCache??false,fromServiceWorker:e.response.fromServiceWorker??false,mime:e.response.mimeType,protocol:e.response.protocol};const r=pending.get(e.requestId);if(r)r.response=value;event('response',{id:e.requestId,url:e.response.url,...value});});
 page.on('Network.loadingFinished',e=>{const r=pending.get(e.requestId);event('finished',{id:e.requestId,url:r?.url,encodedDataLength:e.encodedDataLength});pending.delete(e.requestId);});
 page.on('Network.loadingFailed',e=>{const r=pending.get(e.requestId),failure={id:e.requestId,url:r?.url,errorText:e.errorText,canceled:e.canceled??false,blockedReason:e.blockedReason};event('failed',failure);report.loadingFailures.push(failure);pending.delete(e.requestId);});
 page.on('Fetch.requestPaused',async e=>{const r={url:e.request.url,networkId:e.networkId,resourceType:e.resourceType,atMs:elapsed()};paused.set(e.requestId,r);event('paused',{id:e.requestId,...r});try{const u=new URL(e.request.url),allowed=u.origin===origin||['about:','data:','blob:'].includes(u.protocol);if(!allowed)report.externalRequests.push(e.request.url);await page.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:e.requestId,...allowed?{}:{errorReason:'BlockedByClient'}});event('continued',{id:e.requestId,allowed});}finally{paused.delete(e.requestId);}});
 await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await page.send('Network.setBypassServiceWorker',{bypass:true});
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)})localStorage.setItem('taipei-gp-v2',JSON.stringify({schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{sound:false,quali:false},taxi:{money:1,trips:0},quality:'low',touch:'off',tutDone:true,car:'sedan'}));`});
 await stage('before-navigation');await page.send('Page.navigate',{url:origin+'/?q=low&notraffic'});await focus(page);
 await page.until('!!window.__gp&&!!__gp.stream&&!document.getElementById("boot")',180000);await stage('game-ready');
 await page.until('!!__gp.stream&&__gp.stream.pending===0',180000);await stage('stream-pending-zero');
 const deadline=Date.now()+90000;let quietSince=Date.now(),nextLog=Date.now()+10000;
 while(Date.now()-quietSince<400){if(pending.size||paused.size)quietSince=Date.now();if(Date.now()>=nextLog){await stage('waiting-for-network-quiet');nextLog=Date.now()+10000;}if(Date.now()>deadline)throw Error('Network remained pending for 90 seconds after stream.pending reached zero');await new Promise(r=>setTimeout(r,80));}
 await stage('network-quiet');
 report.page=await page.evaluate('({url:location.href,ready:document.readyState,loaded:__gp.stream.loaded,pending:__gp.stream.pending})');
}catch(e){error=e;report.error=String(e.stack);await stage('diagnostic-failed');}
finally{
 report.pendingAtCleanup=snapshot();
 report.cleanupErrors=[];
 try{if(page)await page.send('Fetch.disable');report.fetchDisabled=true;}catch(e){report.cleanupErrors.push({step:'disable-fetch',error:String(e)});}
 try{if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});report.contextDisposed=true;}catch(e){report.cleanupErrors.push({step:'dispose-context',error:String(e)});}
 report.cleanupComplete=report.contextDisposed===true&&report.cleanupErrors.length===0;
 page?.close();browser?.close();report.finishedAt=new Date().toISOString();
 report.status=error||report.exceptions.length||report.loadingFailures.length||report.externalRequests.length||!report.cleanupComplete?'FAIL':'PASS';
 report.evidence=path.relative(root,dir).replaceAll('\\','/');
 await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,diagnosticOnly:true,evidence:report.evidence,error:report.error,pendingAtCleanup:report.pendingAtCleanup}));
 if(report.status!=='PASS')process.exitCode=1;
}
