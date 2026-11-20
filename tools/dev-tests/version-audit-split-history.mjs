// Rex <game88521@gmail.com>. Real browser history/BFCache, isolated local preview.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {CdpConnection} from './multiplayer-ui-cdp.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const origin='http://127.0.0.1:4436',port=process.env.GP_CDP_PORT??9334;
const report={status:'FAIL',localOnly:true,exceptions:[],events:[],cases:[],notRestored:[],limitations:['Standard gamepad is an explicit navigator fixture; no real controller claim.','Actual browser history and BFCache are exercised; no deployed game requests.']};
let web,browser,page,context;
try{
 web=await preview({root,logLevel:'error',preview:{host:'127.0.0.1',port:4436,strictPort:true}});
 report.build=(await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
 const meta=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();browser=new CdpConnection(meta.webSocketDebuggerUrl,'split-history',report);context=(await browser.send('Target.createBrowserContext')).browserContextId;
 const t=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context}),target=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.id===t.targetId);page=new CdpConnection(target.webSocketDebuggerUrl,'split-history-page',report);
 for(const method of['Page.enable','Runtime.enable','Network.enable'])await page.send(method);
 await page.send('Network.setBypassServiceWorker',{bypass:true});
 page.on('Runtime.bindingCalled',e=>report.events.push(JSON.parse(e.payload)));page.on('Page.backForwardCacheNotUsed',e=>report.notRestored.push(e));page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e));
 await page.send('Runtime.addBinding',{name:'auditHistoryEvent'});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)}){window.__auditHistoryNonce=crypto.randomUUID();for(const type of ['pageshow','pagehide'])addEventListener(type,e=>auditHistoryEvent(JSON.stringify({type,persisted:e.persisted,nonce:__auditHistoryNonce})));Object.defineProperty(navigator,'getGamepads',{value:()=>[{index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0,touched:false}))}]});}`});
 await page.send('Page.navigate',{url:origin+'/splitscreen.html'});await page.until('!!window.__split',60000);const before=await page.evaluate('__auditHistoryNonce');
 const history=await page.send('Page.getNavigationHistory'),entry=history.entries[history.currentIndex];
 await page.send('Page.navigate',{url:'about:blank#away'});await page.until('location.href==="about:blank#away"');
 await page.send('Page.navigateToHistoryEntry',{entryId:entry.id});
 await page.until(`!!window.__split&&window.__auditHistoryNonce!==${JSON.stringify(before)}`,30000);
 const restored=report.events.some(e=>e.type==='pageshow'&&e.persisted&&e.nonce===before);
 assert.equal(restored,true,'Browser must actually restore from BFCache; a normal new navigation cannot prove the fix.');
 assert.equal(await page.evaluate('performance.getEntriesByType("navigation")[0].type'),'reload');
 report.cases.push({name:'Real BFCache history return reloads disposed entry through initialization',status:'PASS'});
 await page.evaluate(`document.getElementById('split-device1').value='keyboard';document.getElementById('split-device2').value='0';document.getElementById('split-map').value='japan';document.getElementById('split-form').requestSubmit();`);
 await page.until('!!__split.race&&!__split.loading',90000);
 assert.equal(await page.evaluate('__split.scenes'),1);
 assert.ok(await page.evaluate('!!__split.resources&&!!document.querySelector("#split-stage canvas")'));
 report.cases.push({name:'Keyboard and standard gamepad can start a real rendered race after return',status:'PASS'});
 assert.equal(report.exceptions.length,0);report.status='PASS';
}catch(e){report.error=String(e.stack);report.status='FAIL';}
finally{
 if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context}).catch(e=>{report.status='FAIL';report.cleanupError=String(e);});page?.close();browser?.close();
 if(web)await new Promise((resolve,reject)=>web.httpServer.close(e=>e?reject(e):resolve()));
 report.completedAt=new Date().toISOString();await writeFile(new URL('version-audit-split-history-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases,error:report.error,build:report.build}));if(report.status!=='PASS')process.exitCode=1;
}
