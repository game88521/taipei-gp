// Author: Rex <game88521@gmail.com>. Root schedules Chrome runs sequentially.
// Poses/time are explicit recorder fixtures, not evidence of a naturally driven race.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {preview} from 'vite';
import {RoomService} from '../../server/room-service.mjs';
import {Car} from '../../server/physics.mjs';
import {observeReplay} from '../../server/nexus-replay-service.mjs';
import {decodeMultiplayerReplay} from '../../shared/nexus-replay.ts';
import {CdpConnection,click,focus} from './multiplayer-ui-cdp.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const port=Number(process.env.GP_VOYAGER_PHOTO_REPLAY_BROWSER_PORT??4427);
const cdp=`http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT??9334}`,origin=`http://127.0.0.1:${port}`;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence=path.join(root,'tools/dev-tests',`voyager-photo-replay-browser-evidence-${Date.now()}-${randomUUID().slice(0,8)}`);
await mkdir(evidence);
const sources=['src/nexus-replay-ui.ts','src/nexus-replay-library.ts','src/nexus-replay.css','src/summit-lazy-replay.ts','src/multiplayer-scene.ts','src/multiplayer-game.ts','src/voyager-photo.ts','src/voyager-platform.css','shared/nexus-replay.ts','server/nexus-replay-service.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async f=>[f,sha(await readFile(path.join(root,f)))])));
const report={status:'FAIL',localOnly:true,explicitRecorderPoseFixture:true,sourceHashes:await hashes(),scriptSha256:sha(await readFile(new URL(import.meta.url))),cases:[],exceptions:[],externalRequests:[],screenshots:[],cleanup:{},evidence:path.relative(root,evidence).replaceAll('\\','/'),limitations:['車手位置與30秒時序是明示fixture，透過真權威observeReplay產生；沒有宣稱自然駕駛、外網或完整賽事。','PNG由真Chrome下載事件及磁碟檔案確認；非真手機測試。']};
let web,browser,page,context;
const downloads=new Map(),completed=new Set();
const run=expression=>page.evaluate(expression);
async function test(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack)});throw e;}finally{console.log(JSON.stringify(report.cases.at(-1)));}}
async function shot(name){const r=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,name),Buffer.from(r.data,'base64'));report.screenshots.push(name);}
async function clickLibrarySummary(){
  await run('document.querySelector("#mp-replay-library > summary").scrollIntoView({block:"center",inline:"nearest"})');
  const point=await run('(()=>{const e=document.querySelector("#mp-replay-library > summary"),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,width:r.width,height:r.height,reachable:document.elementFromPoint(x,y)?.closest("summary")===e};})()');
  assert.ok(point.width>0&&point.height>0&&point.reachable,'Production replay summary must be visible and reachable');
  for(const type of['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
}
async function openLibrary(){
  // __mp.replay is initially the lazy facade; the file input only exists after
  // the real library summary is opened and its production module finishes loading.
  if(!await run('document.getElementById("mp-replay-library")?.open')){
    await clickLibrarySummary();
  }
  await page.until('!!document.querySelector("#mp-replay-library input[type=file]")&&!!document.getElementById("mp-replay-import")&&!document.getElementById("mp-replay-import").disabled',45000);
}
async function upload(file){await openLibrary();await page.send('DOM.enable');const {root:doc}=await page.send('DOM.getDocument'),{nodeId}=await page.send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#mp-replay-library input[type=file]'});assert.ok(nodeId,'Loaded production replay library must expose its real file input');await page.send('DOM.setFileInputFiles',{nodeId,files:[file]});}
async function set(id,value){await run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(e.type==='range'?'input':'change',{bubbles:true}));})()`);}
const ready=()=>page.until('!!window.__mp?.replay&&!!__mp.scene&&document.getElementById("mp-track").options.length===24',180000);
const observation='({at:__mp.replay.at,frames:__photoReplayFrames,target:__photoReplayTarget,positions:[...__photoReplayScene.cars.values()].map(v=>({x:v.model.root.position.x,y:v.model.root.position.y,z:v.model.root.position.z})),camera:{position:__photoReplayScene.camera.position.toArray(),quaternion:__photoReplayScene.camera.quaternion.toArray(),fov:__photoReplayScene.camera.fov},inputs:__photoReplayWire.length,sockets:__photoReplaySocketAttempts.length})';
async function frames(count){const previous=await run('__photoReplayFrames');await page.until(`__photoReplayFrames>=${previous+count}`,45000);}
async function installObservation(){await run(`(()=>{window.__photoReplayFrames=0;window.__photoReplayDisposed=0;const proto=Object.getPrototypeOf(__mp.scene),present=proto.presentReplay,dispose=proto.dispose;proto.presentReplay=function(room,target,dt){const result=present.call(this,room,target,dt);window.__photoReplayScene=this;window.__photoReplayTarget=target;window.__photoReplayFrames++;return result;};proto.dispose=function(){if(this===window.__photoReplayScene)window.__photoReplayDisposed++;return dispose.call(this);};})()`);}
async function pngDownload(name){
  let found=false;for(let i=0;i<150;i++){if(completed.has(name)&&(await readdir(evidence)).includes(name)){found=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(found,'Chrome completed real PNG download: '+name);
  const bytes=await readFile(path.join(evidence,name));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(bytes.length>1000);
  const pixels=await run(`(async()=>{const image=new Image();image.src='data:image/png;base64,${bytes.toString('base64')}';await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d');c.drawImage(image,0,0,64,64);const data=c.getImageData(0,0,64,64).data,colors=new Set();let opaque=0,lit=0;for(let i=0;i<data.length;i+=4){colors.add(data[i]+','+data[i+1]+','+data[i+2]);if(data[i+3]>200)opaque++;if(Math.max(data[i],data[i+1],data[i+2])>12)lit++;}return{colors:colors.size,opaque,lit,samples:4096};})()`);
  assert.ok(pixels.colors>10,'PNG has multiple rendered colors');assert.ok(pixels.opaque>4000,'PNG is opaque');assert.ok(pixels.lit>100,'PNG is not black');
  return{filename:name,sha256:sha(bytes),bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),pixels};
}
function replayFixture(){
  const service=new RoomService();try{
    const selected=service.trackFor('japan'),track=selected.track,startAt=1_000_000;
    const players=new Map([0,1].map(i=>{const id=`private-fixture-${i}`,car=new Car();car.placeAt(track,20+i*3);return[id,{id,slot:i,name:i?'照片乙':'照片甲',color:i?'#42a5f5':'#ef5350',car,distance:0,completedLaps:0,finishMs:null,dnf:false}];}));
    const room={code:'ABC234',matchId:'private-photo-replay-fixture',phase:'countdown',startAt,trackId:'japan',trackStamp:selected.descriptor.trackStamp,track,laps:3,players,horizon:{elimination:false},evolution:{mode:'race'}};
    observeReplay(room,startAt-3000);room.phase='racing';
    for(let frame=1;frame<=150;frame++){for(const p of players.values()){p.car.placeAt(track,(20+frame+p.slot*3)%track.N);p.car.v=20;p.distance=frame*3;}if(frame===150)room.phase='results';observeReplay(room,startAt+frame*200);}
    const replay=decodeMultiplayerReplay(room.replayRecording.text);
    assert.equal(replay.frames.length,151);assert.equal(replay.recordedMs,30000);assert.equal(replay.trackLength,track.length);
    for(const secret of[room.code,room.matchId,...players.keys()])assert.equal(JSON.stringify(replay).includes(secret),false);
    return replay;
  }finally{service.close();}
}

try{
  report.build=(await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([^']+)'/)[1];
  const fixture=replayFixture(),fixtureBytes=JSON.stringify(fixture),fixturePath=path.join(evidence,'authoritative-pose-fixture.json');await writeFile(fixturePath,fixtureBytes);report.fixture={schema:fixture.schema,trackId:fixture.trackId,frames:fixture.frames.length,recordedMs:fixture.recordedMs,sha256:sha(fixtureBytes)};
  web=await preview({configFile:false,root,logLevel:'error',preview:{host:'127.0.0.1',port,strictPort:true}});
  const metadata=await(await fetch(cdp+'/json/version')).json();browser=new CdpConnection(metadata.webSocketDebuggerUrl,'voyager-photo-replay-browser',report);context=(await browser.send('Target.createBrowserContext')).browserContextId;
  browser.on('Browser.downloadWillBegin',e=>downloads.set(e.guid,e.suggestedFilename));browser.on('Browser.downloadProgress',e=>{if(e.state==='completed')completed.add(downloads.get(e.guid));});
  await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:evidence,browserContextId:context,eventsEnabled:true});
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context}),target=(await(await fetch(cdp+'/json')).json()).find(t=>t.id===targetId);page=new CdpConnection(target.webSocketDebuggerUrl,'voyager-photo-replay',report);
  page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e));page.on('Network.webSocketCreated',e=>report.externalRequests.push(e.url));
  page.on('Fetch.requestPaused',async({requestId,request})=>{const u=new URL(request.url),allowed=u.origin===origin||['about:','data:','blob:'].includes(u.protocol);if(!allowed)report.externalRequests.push(request.url);try{await page.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...allowed?{}:{errorReason:'BlockedByClient'}});}catch(e){if(!String(e).includes('Invalid InterceptionId'))throw e;}});
  for(const method of['Page.enable','Runtime.enable','Network.enable'])await page.send(method);
  await page.send('Network.setBypassServiceWorker',{bypass:true});await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{if(location.origin!==${JSON.stringify(origin)})return;window.__photoReplayWire=[];window.__photoReplaySocketAttempts=[];const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){try{const m=JSON.parse(data);if(m.type==='input')window.__photoReplayWire.push(m);}catch{}return send.call(this,data);};window.WebSocket=class extends WebSocket{constructor(url){window.__photoReplaySocketAttempts.push(String(url));throw Error('離線回放測試禁止開啟任何WebSocket');}};if(!sessionStorage.getItem('voyager-photo-replay-seeded')){sessionStorage.setItem('voyager-photo-replay-seeded','1');localStorage.setItem('taipei-gp-v2',JSON.stringify({schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{sound:false},taxi:{money:12345,trips:0},quality:'low',touch:'off',tutDone:true}));}window.__photoReplayMainSave=localStorage.getItem('taipei-gp-v2');})()`});
  await page.send('Page.navigate',{url:origin+'/multiplayer.html'});await ready();await focus(page);

  await test('12 真檔案匯入權威recorder fixture，保存至IndexedDB回放庫',async()=>{
    await upload(fixturePath);await page.until('__mp.replay.current?.id==='+JSON.stringify(fixture.id)+'&&document.getElementById("mp-replay-status").textContent.includes("驗證通過")');
    await click(page,'mp-replay-save');await page.until('document.getElementById("mp-replay-status").textContent.includes("已保存")&&document.querySelectorAll("#mp-replay-list li button").length===3');
    assert.equal(await run('localStorage.getItem("taipei-gp-v2")===__photoReplayMainSave'),true);return report.fixture;
  });
  await test('12 真重新載入已保存回放，獨立viewer載入相符賽道與兩位車手',async()=>{
    await page.send('Page.reload',{});await ready();await focus(page);await installObservation();
    await openLibrary();await page.until('document.querySelectorAll("#mp-replay-list li button").length===3');
    await run('document.querySelector("#mp-replay-list li button").id="voyager-photo-library-play"');await click(page,'voyager-photo-library-play');
    await page.until('__mp.replay.ready&&__photoReplayFrames>0&&!!document.getElementById("voyager-mp-replay-photo")',180000);
    assert.equal(await run('__mp.replay.current.id'),fixture.id);assert.equal(await run('__photoReplayScene.cars.size'),2);assert.equal(await run('__mp.replay.at'),0);return{drivers:await run('document.getElementById("mp-replay-driver").options.length')};
  });
  let frozen;
  await test('12 播放時開照片會凍結回放時間與車位；調構圖後持續影格保留鏡頭',async()=>{
    await click(page,'mp-replay-toggle');await page.until('__mp.replay.at>250');const before=await run(observation);
    await click(page,'voyager-mp-replay-photo');await page.until('!!document.getElementById("voyager-photo")');
    await set('voyager-photo-yaw',85);await set('voyager-photo-distance',18);await set('voyager-photo-pitch',22);await set('voyager-photo-fov',44);await frames(3);
    frozen=await run(observation);assert.notDeepEqual(frozen.camera,before.camera);assert.equal(frozen.camera.fov,44);assert.equal(await run('getComputedStyle(document.querySelector("#mp-replay-viewer .nexus-replay-controls")).visibility'),'hidden');
    await frames(6);const later=await run(observation);assert.equal(later.at,frozen.at);assert.deepEqual(later.positions,frozen.positions);assert.deepEqual(later.camera,frozen.camera);assert.equal(later.inputs,0);assert.equal(later.sockets,0);await shot('replay-photo-composition.png');return{at:frozen.at,observedFrames:later.frames-frozen.frames,camera:frozen.camera};
  });
  await test('12 真PNG下載完成、磁碟簽章與非全黑像素，下載不推進回放或送駕駛input',async()=>{
    await click(page,'voyager-photo-save');report.png=await pngDownload('taipei-gp-photo.png');await frames(3);const later=await run(observation);assert.equal(later.at,frozen.at);assert.deepEqual(later.positions,frozen.positions);assert.equal(later.inputs,0);assert.equal(later.sockets,0);return report.png;
  });
  await test('12 關照片恢復先前播放；暫停後可切另一車手且照片關閉仍暫停',async()=>{
    await click(page,'voyager-photo-close');await page.until('__mp.replay.at>'+String(frozen.at+150)+'&&document.getElementById("mp-replay-toggle").textContent==="暫停"');
    assert.equal(await run('document.body.classList.contains("voyager-photo-open")'),false);await click(page,'mp-replay-toggle');const paused=await run('__mp.replay.at');
    await set('mp-replay-driver','driver-2');await page.until('__photoReplayTarget==="driver-2"');await frames(3);assert.equal(await run('__mp.replay.at'),paused);
    await click(page,'voyager-mp-replay-photo');await frames(2);await click(page,'voyager-photo-close');await frames(3);assert.equal(await run('__mp.replay.at'),paused);assert.equal(await run('document.getElementById("mp-replay-toggle").textContent'),'播放');return{paused,target:await run('__photoReplayTarget')};
  });
  await test('12 關閉viewer移除照片與canvas、停止專用動畫並釋放scene',async()=>{
    await click(page,'mp-replay-close');await page.until('!__mp.replay.active&&!document.getElementById("mp-replay-viewer")');
    const at=await run('__photoReplayFrames');await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');assert.equal(await run('__photoReplayFrames'),at);
    assert.equal(await run('__photoReplayDisposed'),1);assert.equal(await run('__photoReplayScene.renderer.domElement.isConnected'),false);assert.equal(await run('!!document.getElementById("voyager-photo")||document.body.classList.contains("voyager-photo-open")'),false);
    assert.equal(await run('localStorage.getItem("taipei-gp-v2")===__photoReplayMainSave'),true);assert.equal(await run('__photoReplayWire.length'),0);assert.equal(await run('__photoReplaySocketAttempts.length'),0);return{disposed:1,finalFrames:at};
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
}catch(e){report.error=String(e.stack);console.error(report.error);}finally{
  try{if(page)await run('document.getElementById("voyager-photo-close")?.click();document.getElementById("mp-replay-close")?.click();window.__mp?.client?.disconnect()');report.cleanup.viewer=true;}catch(e){report.cleanup.viewer=String(e);}
  try{if(browser&&context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});report.cleanup.browserContext=true;}catch(e){report.cleanup.browserContext=String(e);}
  page?.close();browser?.close();try{if(web)await new Promise(resolve=>web.httpServer.close(resolve));report.cleanup.preview=true;}catch(e){report.cleanup.preview=String(e);}
  report.sourceUnchangedDuringTests=JSON.stringify(report.sourceHashes)===JSON.stringify(await hashes());report.scriptUnchangedDuringTests=report.scriptSha256===sha(await readFile(new URL(import.meta.url)));report.cleanupComplete=Object.values(report.cleanup).every(v=>v===true)&&!web?.httpServer.listening;
  if(!report.sourceUnchangedDuringTests||!report.scriptUnchangedDuringTests||!report.cleanupComplete)report.status='FAIL';report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};
  const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'report.json'),bytes);await writeFile(path.join(root,'tools/dev-tests/voyager-photo-replay-browser-result.json'),bytes);console.log(JSON.stringify({status:report.status,...report.summary,error:report.error,evidence:report.evidence}));if(report.status!=='PASS')process.exitCode=1;
}
