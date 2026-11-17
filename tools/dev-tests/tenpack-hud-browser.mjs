// Local before/after layout proof. The warning is a DOM fixture inside the real GP HUD.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { CdpConnection } from './multiplayer-ui-cdp.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)), own=path.resolve(here,'../..');
const project=path.resolve(process.env.TENPACK_HUD_PROJECT??own),before=process.env.TENPACK_EXPECT_BEFORE==='1';
const origin='http://127.0.0.1:4338',sha=b=>createHash('sha256').update(b).digest('hex');
const evidence=path.join(here,`tenpack-hud-browser-${before?'before':'after'}-${Date.now()}`);
const report={status:'FAIL',startedAt:new Date().toISOString(),project,before,localOnly:true,cases:[],layouts:[],exceptions:[],externalRequests:[],sourceHashes:{}};
const files=['src/main.ts','src/style.css','index.html'];if(!before)files.push('src/hud-notices.ts');
const getHashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(path.join(project,p)))])));
let web,browser,page,context;
const check=async(name,fn)=>{try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:e.stack});throw e;}finally{console.log(JSON.stringify(report.cases.at(-1)));}};
try{
 await mkdir(evidence);report.sourceHashes=await getHashes();report.scriptSha256=sha(await readFile(fileURLToPath(import.meta.url)));
 const sw=await readFile(path.join(project,'dist/sw.js'),'utf8');report.build=sw.match(/const VERSION = '([^']+)'/)?.[1];assert.ok(report.build);report.swSha256=sha(sw);
 if(before){assert.equal(report.build,'c220d98a7f5c');for(const p of files)assert.equal(sha(await readFile(path.resolve(own,'../taipei-gp-tenpack-before-c220d98a7f5c',p))),report.sourceHashes[p]);}
 web=await preview({root:project,preview:{host:'127.0.0.1',port:4338,strictPort:true},logLevel:'error'});assert.equal(await(await fetch(origin+'/sw.js')).text(),sw);
 const cdp=`http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT??9334}`,version=await(await fetch(cdp+'/json/version')).json();browser=new CdpConnection(version.webSocketDebuggerUrl,'browser',report);context=(await browser.send('Target.createBrowserContext')).browserContextId;
 const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});const t=(await(await fetch(cdp+'/json')).json()).find(t=>t.id===targetId);page=new CdpConnection(t.webSocketDebuggerUrl,'hud',report);
 page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails));page.on('Page.javascriptDialogOpening',()=>page.send('Page.handleJavaScriptDialog',{accept:false}));
 page.on('Fetch.requestPaused',async({requestId,request})=>{const u=new URL(request.url),ok=u.origin===origin||['blob:','data:','about:'].includes(u.protocol);if(!ok)report.externalRequests.push(request.url);await page.send(ok?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...ok?{}:{errorReason:'BlockedByClient'}});});
 for(const m of['Page.enable','Runtime.enable','Network.enable'])await page.send(m);await page.send('Network.setBypassServiceWorker',{bypass:true});await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await page.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 const seed={schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{sound:false,quali:false},taxi:{money:1000,trips:0},quality:'low',touch:'on',steer:'buttons',tutDone:true};
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)})localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))})`});
 await page.send('Page.navigate',{url:origin+'/?circuit=australia&q=low&notraffic'});await page.until(`!!window.__gp&&!document.getElementById('btn-gp').disabled`,180000);
 await page.evaluate(`__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false);document.getElementById('opt-quali').checked=false;document.getElementById('opt-quali').dispatchEvent(new Event('change'));document.getElementById('btn-gp').click();document.querySelector('.cp-go:not(:disabled)').click()`);
 await page.until(`__gp.state==='countdown'||__gp.state==='race'`,30000);await page.evaluate(`document.getElementById('gp-strategy').open=true`);
 await page.until(`document.getElementById('strategy-detail').textContent.length>50&&document.getElementById('board').children.length===22`,30000);
 await page.evaluate(`__gp.renderer.setAnimationLoop(null);document.getElementById('warn').textContent='提早煞車';document.getElementById('warn').classList.add('show')`);
 for(const[width,height]of[[844,220],[844,390],[390,844]])await check(`${width}x${height}_warning_layout`,async()=>{
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await page.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  const layout=await page.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height}},warn=document.getElementById('warn'),a=rect(warn),els=[...document.querySelectorAll('#gp-strategy,#rotate,#steer-btns,#pad,#brake,#drs,#pit,.tl,.tc,.tr,.gp-panel,.speedo,#minimap,#tyre,#batt,#radio,#pit-tyre,#drs-ind')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width&&r.height});return{width:innerWidth,height:innerHeight,warning:a,panels:els.map(e=>({id:e.id||e.className,...rect(e)})),overlaps:els.filter(e=>{const b=rect(e);return a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top}).map(e=>e.id||e.className)}})()`);
  report.layouts.push(layout);assert.ok(layout.warning.width>20&&layout.warning.height>20);
  if(before&&height===220)assert.ok(layout.overlaps.includes('gp-strategy'),'Old warning must reproduce actual strategy overlap');
  if(!before){if(height===220){const p=layout.panels.find(p=>p.id==='gp-panel');assert.ok(p);for(const id of ['brake','drs','pit']){const b=layout.panels.find(p=>p.id===id);assert.ok(!b||p.left>=b.left+b.width||p.left+p.width<=b.left||p.top>=b.top+b.height||p.top+p.height<=b.top,'Compact standings overlap '+id)}}assert.deepEqual(layout.overlaps,[]);if(width<height)assert.ok(!layout.panels.some(p=>p.id==='rotate'),'Orientation advice belongs to the menu, leaving driving instruments clear');const r=layout.warning;assert.ok(r.left>=0&&r.top>=0&&r.left+r.width<=width+1&&r.top+r.height<=height+1);}
  const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,`${width}x${height}.png`),Buffer.from(shot.data,'base64'));return layout;
 });
 if(!before)await check('leaving_gp_removes_notice_position_override',async()=>{await page.evaluate(`document.getElementById('hud').dataset.kind='tt'`);await page.until(`document.getElementById('warn').style.position===''`,10000);return{reset:true};});
 assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);assert.deepEqual(await getHashes(),report.sourceHashes);assert.equal(await readFile(path.join(project,'dist/sw.js'),'utf8'),sw);report.status='PASS';
}catch(e){report.error=e.stack??String(e);console.error(report.error);process.exitCode=1;}
finally{page?.close();if(browser&&context)await browser.send('Target.disposeBrowserContext',{browserContextId:context}).catch(e=>{report.cleanupError=String(e);report.status='FAIL';process.exitCode=1;});browser?.close();if(web)await new Promise(r=>web.httpServer.close(r));report.completedAt=new Date().toISOString();report.evidence=path.relative(own,evidence).split(path.sep).join('/');report.limitations=['Real GP HUD with a warning DOM fixture; no braking-distance, framerate, phone-device or pinch-zoom claim.'];await writeFile(path.join(evidence,'summary.json'),JSON.stringify(report,null,2));await writeFile(path.join(here,`tenpack-hud-browser-${before?'before':'after'}-result.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,build:report.build,before,cases:report.cases.length}));}
