// Rex <game88521@gmail.com>. Run serially against local Chrome; never a public game/service.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {preview} from 'vite';
import {createMultiplayerServer} from '../../server/index.mjs';
import {encodeWorkshop} from '../../server/summit-city-physics.mjs';
import {CITY_RACE_VERSION} from '../../shared/summit-city-race.ts';
import {COOP_VERSION,COOP_CITY_STAMP,COOP_STATIONS} from '../../shared/nexus-coop.ts';
import {WireClient,settle} from './multiplayer-test-helpers.mjs';
import {CdpConnection,click as cdpClick,focus} from './multiplayer-ui-cdp.mjs';
import {startAudit,finishAudit} from './summit-workshop-audit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const port=Number(process.env.GP_VOYAGER_CITY_PORT??4421),origin=`http://127.0.0.1:${port}`,cdp=Number(process.env.GP_CDP_PORT??9334);
const evidence=path.join(root,'tools/dev-tests',`voyager-city-browser-evidence-${Date.now()}`);await mkdir(evidence);
const report={status:'FAIL',cases:[],exceptions:[],externalRequests:[],screenshots:[],localOnly:true,realPhoneUsed:false,
  evidence:path.relative(root,evidence).replaceAll('\\','/'),
  limitations:['One actual local Chrome plus real WS peer. Product frame callbacks use explicit fixed clocks with RAF held during prediction checks; this is not a measured real-device FPS test.',
    'NG2 lap UI and special pickup/dropoff use explicitly named server pose/control fixtures. Full 1/3/5 laps with real controls are verified by voyager-city-server, not claimed here.',
    'No public service, external network, two physical devices, real mobile input or subjective driving comfort was tested.'],
  ...await startAudit(root,new URL(import.meta.url),['src/main.ts','src/summit-city-race-ui.ts','src/summit-city-race-client.ts','src/voyager-city-prediction.ts','shared/summit-city-race.ts','shared/nexus-coop.ts','server/summit-city-race-service.mjs','server/nexus-coop-service.mjs','src/nexus-coop-ui.ts','src/atlas-coop-history.ts'])};
report.build=(await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let now=Date.now(),app,web,browser,page,context,cityPeer,coopPeer,r,cr,self,cp;
const protectedState='JSON.stringify({best:__gp.save.best,gpBest:__gp.save.gpBest,records:__gp.save.records,taxi:__gp.save.taxi,stats:__gp.save.stats,damage:__gp.save.damage,progress:__gp.save.progress})';
const ev=s=>page.evaluate(s);
const set=(id,value)=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const frame=async(count=1,dt=1/60)=>ev(`(()=>{for(let i=0;i<${count};i++)__gp.summitCityRace.frame(performance.now()+i*${dt*1000},${dt});})()`);
// Advance only the HUD clock while RAF is held; no input or physics step is added.
const refreshCityHud=()=>ev('__gp.summitCityRace.frame(window.__voyagerCityHudAt=Math.max(performance.now(),window.__voyagerCityHudAt??0)+250,0)');
const cityState=()=>ev('({phase:__gp.summitCityRace.client.room?.phase,status:__gp.summitCityRace.client.status,self:__gp.summitCityRace.client.selfId,players:__gp.summitCityRace.client.room?.players,queued:__gp.summitCityRace.prediction.queued,focus:document.activeElement===__gp.renderer.domElement})');
async function wait(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(40);}throw Error('Controlled browser condition timed out');}
async function click(page,id){await page.until(`(()=>{const e=document.getElementById(${JSON.stringify(id)});return !!e&&!e.disabled&&!e.hidden&&e.getClientRects().length>0;})()`);await cdpClick(page,id);}
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){let state;try{state=await cityState();}catch{}report.cases.push({name,status:'FAIL',error:e.stack,state});throw e;}finally{console.log(JSON.stringify(report.cases.at(-1)));}}
async function shot(name){const result=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));report.screenshots.push(name+'.png');}
async function key(down){await page.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});}
try{
  app=createMultiplayerServer({autoTick:false,now:()=>now,allowedOrigins:[origin]});await new Promise(resolve=>app.httpServer.listen(0,'127.0.0.1',resolve));
  const wsBase=`ws://127.0.0.1:${app.httpServer.address().port}`,world=app.cityRaceService.world();
  const def={v:2,physics:'city-workshop-v2',map:world.roads.stamp,name:'Voyager閉合三圈',nodes:[199,200,199],car:'sedan',weather:'day',seconds:600,hits:20,laps:3,splits:[]};world.roads.validate(def);
  web=await preview({root,preview:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});
  const meta=await(await fetch(`http://127.0.0.1:${cdp}/json/version`)).json();browser=new CdpConnection(meta.webSocketDebuggerUrl,'voyager-city-browser',report);
  context=(await browser.send('Target.createBrowserContext')).browserContextId;
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});
  const target=(await(await fetch(`http://127.0.0.1:${cdp}/json`)).json()).find(t=>t.id===targetId);page=new CdpConnection(target.webSocketDebuggerUrl,'voyager-city',report);
  page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails));
  page.on('Fetch.requestPaused',async({requestId,request})=>{const u=new URL(request.url),ok=u.origin===origin||['data:','blob:','about:'].includes(u.protocol);if(!ok)report.externalRequests.push(request.url);await page.send(ok?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...ok?{}:{errorReason:'BlockedByClient'}});});
  page.on('Network.webSocketCreated',({url})=>{if(!url.startsWith(wsBase+'/'))report.externalRequests.push(url);});
  for(const method of['Page.enable','Runtime.enable','Network.enable'])await page.send(method);
  await page.send('Network.setBypassServiceWorker',{bypass:true});await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{if(location.origin!==${JSON.stringify(origin)})return;
    localStorage.setItem('taipei-gp-v2',JSON.stringify({schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{sound:false,quali:false},taxi:{money:12345,trips:0},quality:'low',touch:'off',tutDone:true,car:'sedan'}));
    const Native=WebSocket;window.__voyagerWire=[];window.WebSocket=class extends Native{constructor(url,protocols){const u=new URL(String(url));if(!['/city-race','/coop'].includes(u.pathname))throw Error('Only local city/coop WS permitted');super(${JSON.stringify(wsBase)}+u.pathname,protocols);const send=this.send.bind(this);this.send=value=>{try{__voyagerWire.push(JSON.parse(value));}catch{}return send(value);};}};
    const raf=requestAnimationFrame.bind(window),held=[];window.__voyagerHoldFrames=false;window.requestAnimationFrame=cb=>raf(t=>{if(window.__voyagerHoldFrames)held.push(cb);else cb(t);});window.__voyagerResumeFrames=()=>{window.__voyagerHoldFrames=false;for(const cb of held.splice(0))raf(cb);};
  })()`});
  await page.send('Page.navigate',{url:origin+'/?q=low&notraffic'});
  await page.until('!!window.__gp?.summitCityRace&&!!__gp.nexusCoop&&!document.getElementById("btn-start").disabled',180000);
  await ev('__gp.renderer.setPixelRatio(.25);__gp.renderer.setSize(320,200,false)');await focus(page);

  await check('4 真UI接受NG2閉合三圈、建立碰撞私人房並顯示完整房規',async()=>{
    await click(page,'btn-summit-city-race');await set('city-race-challenge',encodeWorkshop(def));
    assert.ok(await ev('document.getElementById("city-race-route").textContent.includes("NG2 3圈")'));
    await set('city-race-name','Voyager瀏覽器甲');await set('city-race-collisions','on');await click(page,'city-race-create');
    await page.until('__gp.summitCityRace.client.room?.phase==="lobby"',180000);
    self=await ev('__gp.summitCityRace.client.selfId');const code=await ev('__gp.summitCityRace.client.room.code');r=app.cityRaceService.rooms.get(code);
    assert.equal(r.definition.v,2);assert.equal(r.definition.laps,3);assert.equal(r.collisions,true);assert.ok(await ev('document.getElementById("city-race-route").textContent.includes("3圈")'));
    await ev('window.__voyagerProtected='+protectedState);await shot('01-ng2-room');return{code,laps:r.definition.laps};
  });
  await check('4 真WS朋友加入、確認同路線與雙人起跑；關面板回到真畫布焦點',async()=>{
    cityPeer=await new WireClient(wsBase+'/city-race',origin).open();cityPeer.send({type:'join',v:CITY_RACE_VERSION,name:'Voyager乙',code:r.code});await cityPeer.until(m=>m.type==='welcome');
    await page.until('__gp.summitCityRace.client.room.players.length===2');cityPeer.send({type:'ready',revision:r.revision,map:def.map,ready:true});await click(page,'city-race-ready');await page.until('!document.getElementById("city-race-start").disabled');
    await click(page,'city-race-start');await wait(()=>r.phase==='countdown'&&Number.isFinite(r.startAt));now=r.startAt;app.cityRaceService.tick(now);await page.until('__gp.summitCityRace.client.room.phase==="racing"');
    await ev('window.__voyagerHoldFrames=true');await delay(150);await ev('__gp.summitCityRace.open()');await click(page,'city-race-close');assert.equal((await cityState()).focus,true);await frame();
  });
  await check('1 真鍵盤與產品frame在尚無權威tick/ack時立即預測，server仍未移動且封包不含pose',async()=>{
    const p=r.players.get(self);p.queue=[];const start={x:p.car.x,z:p.car.z},ack=p.ack;
    await key(true);try{await frame(6);}finally{await key(false);}await settle();
    const predicted=await ev('({x:__gp.fcar.x,z:__gp.fcar.z,queued:__gp.summitCityRace.prediction.queued})');
    assert.ok(Math.hypot(predicted.x-start.x,predicted.z-start.z)>.02,JSON.stringify(predicted));assert.ok(predicted.queued>=6);assert.equal(p.ack,ack);assert.equal(p.car.x,start.x);assert.equal(p.car.z,start.z);
    assert.equal(await ev('__voyagerWire.some(m=>m.pose||m.type==="position")'),false);
    for(let i=0;i<6;i++){now+=1000/60;app.cityRaceService.simulate(r,now);}app.cityRaceService.broadcast(r,now);
    await wait(async()=>await ev('__gp.summitCityRace.client.room.players.find(p=>p.id===__gp.summitCityRace.client.selfId).ack')===p.ack);await frame();
    assert.ok(p.ack>ack);return{predictedMeters:Math.hypot(predicted.x-start.x,predicted.z-start.z),beforeAck:ack,afterAck:p.ack,controlledFrames:6};
  });
  await check('1 房間面板清pending/送neutral，脫困及真斷線續接皆輪替motion世代',async()=>{
    await ev('__gp.summitCityRace.open()');await frame();await settle();assert.equal(await ev('__gp.summitCityRace.prediction.queued'),0);assert.equal(r.players.get(self).input.active,false);
    await click(page,'city-race-close');await frame();await refreshCityHud();const p=r.players.get(self),generation=p.motionRevision;p.car.vx=p.car.vz=0;
    await click(page,'city-race-recover');await wait(()=>p.motionRevision===generation+1);await page.until(`__gp.summitCityRace.client.room.players.find(p=>p.id===__gp.summitCityRace.client.selfId).motionRevision===${generation+1}`);await frame(1,0);assert.equal(await ev('__gp.summitCityRace.prediction.queued'),0);
    const token=p.token;p.client.ws.terminate();await page.until('__gp.summitCityRace.client.status==="reconnecting"',5000);await page.until('__gp.summitCityRace.client.status==="connected"',15000);
    assert.notEqual(p.token,token);assert.equal(p.motionRevision,generation+2);await page.until(`__gp.summitCityRace.client.room.players.find(p=>p.id===__gp.summitCityRace.client.selfId).motionRevision===${generation+2}`);await frame(1,0);assert.equal(await ev('__gp.summitCityRace.prediction.queued'),0);
  });
  await check('4 NG2正向過線後UI顯示第2/3圈與單圈時間，單人錢包/PB隔離（明示server fixture）',async()=>{
    const p=r.players.get(self),g=r.route.gates.at(-1),b=r.route.gates.at(-2),n=Math.hypot(g.x-b.x,g.z-b.z),nx=(g.x-b.x)/n,nz=(g.z-b.z)/n;
    p.next=r.route.gates.length-1;p.queue=[];p.car.place(g.x-nx*.05,g.z-nz*.05,Math.atan2(nx,nz),g.y-.25);p.car.vx=nx*12;p.car.vz=nz*12;p.input={steer:0,throttle:false,brake:false,handbrake:false,active:true};p.lastInputAt=now;
    now+=1000/60;app.cityRaceService.simulate(r,now);assert.equal(p.completedLaps,1);app.cityRaceService.broadcast(r,now);
    await page.until('__gp.summitCityRace.client.room.players.find(p=>p.id===__gp.summitCityRace.client.selfId).completedLaps===1');await frame(1,.05);
    await refreshCityHud();assert.ok(await ev('document.getElementById("city-race-progress").textContent.includes("第2/3圈")'));
    await ev('__gp.summitCityRace.open()');assert.ok(await ev('document.getElementById("city-race-players").textContent.includes("圈速")'));await shot('02-ng2-lap');
    assert.equal(await ev(protectedState),await ev('__voyagerProtected'));await click(page,'city-race-leave');await click(page,'city-race-close');await cityPeer.close();cityPeer=null;
  });
  await check('8 真UI建立special房，六貨單2急/2碎/2一般；真WS隊友共同開始',async()=>{
    now=Math.round(now);await click(page,'btn-nexus-coop');
    await page.until('!!__gp.nexusCoop.client&&!!document.getElementById("coop-task-mode")&&document.getElementById("coop-task-mode").getClientRects().length>0&&!document.getElementById("coop-task-mode").disabled',180000);
    await set('coop-task-mode','special');await set('coop-name','Voyager貨運甲');await click(page,'coop-create');
    await page.until('__gp.nexusCoop.client.room?.phase==="lobby"',180000);const code=await ev('__gp.nexusCoop.client.room.code');cr=app.coopService.rooms.get(code);cp=cr.players.get(await ev('__gp.nexusCoop.client.selfId'));
    assert.deepEqual(cr.cargo.map(c=>c.kind),['urgent','urgent','fragile','fragile','standard','standard']);
    const text=await ev('document.getElementById("coop-board").textContent');assert.ok(text.includes('急件')&&text.includes('易碎貨')&&text.includes('一般貨'));
    coopPeer=await new WireClient(wsBase+'/coop',origin).open();coopPeer.send({type:'join',request:1,v:COOP_VERSION,cityStamp:COOP_CITY_STAMP,name:'Voyager貨運乙',vehicle:'pickup',code});await coopPeer.until(m=>m.type==='welcome');
    await page.until('__gp.nexusCoop.client.room.players.length===2');coopPeer.send({type:'ready',request:2,ready:true});await coopPeer.until(m=>m.type==='ack'&&m.request===2);await click(page,'coop-ready');await page.until('__gp.nexusCoop.client.room.players.every(p=>p.ready)&&!!document.getElementById("coop-start")');await click(page,'coop-start');await page.until('__gp.nexusCoop.client.room.phase==="running"');
  });
  function stopAt(station){const svc=app.coopService;svc.place(cp,station);for(let i=0;i<40;i++){now+=1000/30;cp.input={steer:0,throttle:false,brake:false,handbrake:false,active:true};cp.lastInputAt=now;svc.simulate(cr,now);}svc.broadcast(cr);}
  await check('8 真UI急件取貨顯示6分鐘期限，退貨/重取不洗期限（明示停站fixture）',async()=>{
    const cargo=cr.cargo[0];stopAt(COOP_STATIONS[0]);await click(page,`coop-pickup-${cargo.id}`);await wait(()=>cp.cargo===cargo.id);const deadline=cargo.deadlineAt;assert.equal(deadline-now,360000);
    await page.until('document.querySelector("[data-cargo='+cargo.id+']").textContent.includes("期限")');await click(page,`coop-release-${cargo.id}`);await wait(()=>cp.cargo===null);await page.until('!!document.getElementById("coop-pickup-'+cargo.id+'")');await click(page,`coop-pickup-${cargo.id}`);await wait(()=>cp.cargo===cargo.id);assert.equal(cargo.deadlineAt,deadline);
    await click(page,'coop-close');await ev('__gp.nexusCoop.frame(performance.now()+2000,1/30)');assert.ok(await ev('document.getElementById("coop-hud-status").textContent.includes("急件")'));await ev('__gp.nexusCoop.open()');await click(page,`coop-release-${cargo.id}`);await wait(()=>cp.cargo===null);
  });
  await check('8 真FreeCar急煞損耗同步到貨單/交付分數；手機表單可讀且原存檔隔離',async()=>{
    const cargo=cr.cargo[2];stopAt(COOP_STATIONS[0]);await click(page,`coop-pickup-${cargo.id}`);await wait(()=>cp.cargo===cargo.id);
    cp.queue=[];cp.car.vx=0;cp.car.vz=15;cp.car.h=0;cp.input={steer:0,throttle:false,brake:true,handbrake:false,active:true};cp.lastInputAt=now;now+=1000/30;app.coopService.simulate(cr,now);assert.ok(cargo.integrity<100);app.coopService.broadcast(cr);
    await page.until('document.querySelector("[data-cargo='+cargo.id+']").textContent.includes("完整度99%")');stopAt(COOP_STATIONS.find(s=>s.id===cargo.destination));await click(page,`coop-deliver-${cargo.id}`);await wait(()=>cargo.state==='delivered');assert.equal(cargo.score,Math.round(cargo.integrity*2));
    await page.until('document.querySelector("[data-cargo='+cargo.id+']").textContent.includes("分")');
    for(const [width,height]of[[390,844],[844,390]]){await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});const layout=await ev('(()=>{const e=document.querySelector(".nexus-coop-card"),b=e.getBoundingClientRect();return{left:b.left,right:b.right,client:e.clientWidth,scroll:e.scrollWidth}})()');assert.ok(layout.left>=-1&&layout.right<=width+1);assert.ok(layout.scroll<=layout.client+1);await shot(`03-special-${width}x${height}`);}
    await click(page,'coop-leave');assert.equal(await ev(protectedState),await ev('__voyagerProtected'));assert.equal(await ev('__voyagerWire.some(m=>m.pose||m.type==="position")'),false);return{integrity:cargo.integrity,score:cargo.score};
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{
  await cityPeer?.close().catch(()=>{});await coopPeer?.close().catch(()=>{});
  report.cleanup={};try{if(browser&&context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});report.cleanup.context=true;}catch(e){report.cleanup.context=String(e);}page?.close();browser?.close();
  try{await app?.close();report.cleanup.server=true;}catch(e){report.cleanup.server=String(e);}try{if(web)await new Promise(resolve=>web.httpServer.close(resolve));report.cleanup.preview=true;}catch(e){report.cleanup.preview=String(e);}
  report.cleanupComplete=Object.values(report.cleanup).every(v=>v===true)&&!app?.httpServer.listening&&!web?.httpServer.listening;
  await finishAudit(root,new URL(import.meta.url),report);report.summary={PASS:report.cases.filter(c=>c.status==='PASS').length,FAIL:report.cases.filter(c=>c.status==='FAIL').length};
  if(!report.cleanupComplete||!report.sourceUnchangedDuringTests||!report.scriptUnchangedDuringTests)report.status='FAIL';
  const json=JSON.stringify(report,null,2)+'\n';await writeFile(path.join(evidence,'report.json'),json);await writeFile(new URL('voyager-city-browser-result.json',import.meta.url),json);console.log(JSON.stringify({status:report.status,summary:report.summary,error:report.error,evidence:report.evidence}));if(report.status!=='PASS')process.exitCode=1;
}
