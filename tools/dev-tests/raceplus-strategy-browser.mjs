// 本機真GP策略UI；只安排測試狀態，透過既有rAF與真DOM事件更新，非進站估值校準。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { parseAst } from 'rolldown/parseAst';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { CdpConnection } from './multiplayer-ui-cdp.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),ownProject=path.resolve(here,'../..');
const project=path.resolve(process.env.RACEPLUS_STRATEGY_BROWSER_PROJECT??ownProject),before=process.env.RACEPLUS_EXPECT_BEFORE==='1';
const origin='http://127.0.0.1:4327',cdp=`http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT??9334}`;
const evidence=path.join(here,`raceplus-strategy-browser-evidence-${Date.now()}`);await mkdir(evidence);
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={startedAt:new Date().toISOString(),project,origin,before,localOnly:true,status:'FAIL',cases:[],exceptions:[],externalRequests:[],layouts:[],screenshots:[],sourceHashes:{}};
for(const file of['src/main.ts','src/strategy.ts','src/style.css','src/rivals.ts','src/pitlane.ts'])report.sourceHashes[file]=hash(await readFile(path.join(project,file)));
report.scriptSha256=hash(await readFile(fileURLToPath(import.meta.url)));
const sw=await readFile(path.join(project,'dist/sw.js'),'utf8');report.build=sw.match(/const VERSION = '([a-f0-9]{12})'/)?.[1];assert.ok(report.build);
if(process.env.RACEPLUS_EXPECT_BUILD)assert.equal(report.build,process.env.RACEPLUS_EXPECT_BUILD);
const strategySource=stripTypeScriptTypes(await readFile(path.join(project,'src/strategy.ts'),'utf8'),{mode:'transform'});
const strategy=await import('data:text/javascript;base64,'+Buffer.from(strategySource).toString('base64'));
async function publicValue(file,name){
  const code=stripTypeScriptTypes(await readFile(path.join(project,file),'utf8'),{mode:'transform'}),ast=parseAst(code);
  const declaration=ast.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'&&n.declaration.declarations.some(d=>d.id.name===name));
  const value=declaration?.declaration.declarations.find(d=>d.id.name===name)?.init;assert.ok(value,`${file}:${name}`);
  return vm.runInNewContext(`(${code.slice(value.start,value.end)})`);
}
const tyres=await publicValue('src/rivals.ts','TYRES'),pit=await publicValue('src/pitlane.ts','PIT');
let web,browser,page,context;
async function check(name,action){
  try{report.cases.push({name,status:'PASS',details:await action()});}
  catch(error){report.cases.push({name,status:'FAIL',error:error.stack??String(error)});throw error;}
  finally{console.log(JSON.stringify(report.cases.at(-1)));}
}
async function refresh(){
  return page.evaluate(`(() => {for(let i=0;i<12;i++)__raceplusStrategyFrame(__raceplusStrategyNow);return document.getElementById('strategy-detail').textContent})()`);
}
async function selectTyre(index){
  await page.evaluate(`document.querySelectorAll('#pit-tyre button')[${index}].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch'}))`);
  assert.equal(await page.evaluate('__gp.field.me.pitTyre'),index);return refresh();
}
async function expectedNet(){
  const data=await page.evaluate(`(() => {
    const g=__gp,f=g.field,m=f.me,t=g.track,limIn=${pit.LIM_IN},limOut=${pit.LIM_OUT};let racingTime=0;
    for(let sd=limIn;sd<limOut;sd+=2){const i=((Math.round(sd/t.ds)%t.N)+t.N)%t.N;racingTime+=Math.min(2,limOut-sd)/Math.max(1,t.vTarget[i])}
    return{laneLength:limOut-limIn,limit:f.pitlane?.speed??80/3.6,racingTime,lapTime:m.bestLap,wear:m.wear,
      lapsRemaining:Math.max(0,f.laps-Math.max(1,m.laps))+1,current:m.compound,next:m.pitTyre,wetness:f.wet,
      safetyCar:f.sc.phase!=='off',queueSeconds:f.racers.some(r=>!r.isPlayer&&r.team===m.team&&r.pit?.ph==='box')?4:0};
  })()`);
  const tyre=index=>({label:tyres[index].name,grip:tyres[index].grip,wearPerLap:tyres[index].wear,rain:index===3});
  const baselineLoss=strategy.pitBaselineLoss(data.laneLength,data.limit,data.racingTime);
  const estimate=strategy.estimatePitStrategy({...data,racingTime:baselineLoss===null?0:Math.max(0,data.laneLength/data.limit+2.5-baselineLoss),
    wearPerLap:tyres[data.current].wear,tyres:{current:tyre(data.current),next:tyre(data.next)},previousWetness:data.wetness});
  assert.ok(estimate);return{input:data,range:estimate.currentLap.net,text:`${estimate.currentLap.net.min.toFixed(1)}～${estimate.currentLap.net.max.toFixed(1)} 秒`};
}
async function assertNet(text){const expected=await expectedNet();assert.ok(text.includes(`全程淨代價 ${expected.text}`),JSON.stringify({text,expected}));return expected;}
async function clickSummary(){
  const p=await page.evaluate(`(() => {const e=document.querySelector('#gp-strategy summary'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,hit:h===e||e.contains(h)}})()`);
  assert.equal(p.hit,true,'策略summary必須可點');
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
}
try{
  web=await preview({root:project,logLevel:'error',preview:{host:'127.0.0.1',port:4327,strictPort:true}});
  assert.equal(await(await fetch(origin+'/sw.js')).text(),sw,'preview必須對應本次dist');
  browser=new CdpConnection((await(await fetch(cdp+'/json/version')).json()).webSocketDebuggerUrl,'browser',report);
  context=(await browser.send('Target.createBrowserContext')).browserContextId;
  const{targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});
  const target=(await(await fetch(cdp+'/json')).json()).find(t=>t.id===targetId);assert.ok(target);
  page=new CdpConnection(target.webSocketDebuggerUrl,'strategy',report);
  page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails));
  page.on('Page.javascriptDialogOpening',async()=>page.send('Page.handleJavaScriptDialog',{accept:false}));
  page.on('Fetch.requestPaused',async({requestId,request})=>{
    const url=new URL(request.url),allowed=url.origin===origin||['data:','blob:','about:'].includes(url.protocol);
    if(!allowed)report.externalRequests.push(request.url);
    await page.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...allowed?{}:{errorReason:'BlockedByClient'}});
  });
  await page.send('Page.enable');await page.send('Runtime.enable');await page.send('Network.enable');
  await page.send('Network.setBypassServiceWorker',{bypass:true});await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await page.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  const seed={schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{sound:false,quali:false},taxi:{money:1000,trips:0},tutDone:true,quality:'low',touch:'on'};
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
    if(location.origin!==${JSON.stringify(origin)})return;
    localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});
    const raf=requestAnimationFrame.bind(window),now=performance.now.bind(performance);
    window.__raceplusStrategyManual=false;window.__raceplusStrategyNow=null;
    Object.defineProperty(performance,'now',{value:()=>window.__raceplusStrategyNow??now()});
    window.requestAnimationFrame=callback=>{window.__raceplusStrategyFrame=callback;if(__raceplusStrategyManual)return 0;return window.__raceplusStrategyFrameId=raf(callback)};
  })()`});
  await page.send('Page.navigate',{url:origin+'/?circuit=australia&q=low&notraffic'});
  await page.until(`!!window.__gp&&!document.getElementById('btn-gp').disabled`,180000);
  await page.evaluate(`__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false);window.__raceplusStrategyManual=true;cancelAnimationFrame(window.__raceplusStrategyFrameId);window.__raceplusStrategyNow=performance.now();__gp.input.read=()=>({steer:0,brake:true});
    document.getElementById('opt-quali').checked=false;document.getElementById('opt-quali').dispatchEvent(new Event('change'));
    for(const[id,value]of[['opt-laps','6'],['opt-gpwx','dry'],['opt-sc','off']]){document.getElementById(id).value=value;document.getElementById(id).dispatchEvent(new Event('change'))}
    document.getElementById('btn-gp').click();document.querySelector('.cp-go:not(:disabled)').click()`);
  await page.until(`__gp.state==='countdown'`,20000);
  const started=await page.evaluate(`(() => {for(let i=0;i<80&&__gp.state==='countdown';i++){__raceplusStrategyNow+=100;__raceplusStrategyFrame(__raceplusStrategyNow)}return{state:__gp.state,quali:__gp.qualiRun}})()`);
  assert.deepEqual(started,{state:'race',quali:false});
  assert.equal(await page.evaluate('__gp.field.laps'),6,'必須由真選單開始六圈GP');
  await page.evaluate(`Object.assign(__gp.field.me,{compound:1,wear:.2,bestLap:60,laps:1,pitReq:true,pitTyre:2});__gp.field.wet=0;document.getElementById('gp-strategy').open=true`);
  await refresh();
  await check('selected_tyre_pointer_event_changes_live_strategy_and_matches_model',async()=>{
    const hard=await selectTyre(2),hardModel=await assertNet(hard),rain=await selectTyre(3),rainModel=await assertNet(rain);
    if(before){assert.equal(hardModel.text,rainModel.text);assert.ok(!rain.includes('本次估計換上'));}
    else{assert.ok(hard.includes('本次估計換上硬胎（你指定）'));assert.ok(rain.includes('本次估計換上雨胎（你指定）'));assert.notEqual(hardModel.text,rainModel.text);assert.ok((rainModel.range.min+rainModel.range.max)>(hardModel.range.min+hardModel.range.max));}
    return{hard,hardModel,rain,rainModel};
  });
  if(!before){
    await check('observed_wetness_changes_estimate_and_active_pit_uses_locked_tyre_status',async()=>{
      const dry=await selectTyre(3),dryModel=await assertNet(dry);
      await page.evaluate('__gp.field.wet=.8');const wet=await refresh(),wetModel=await assertNet(wet);
      assert.ok(wet.includes('濕度 80%'));assert.notEqual(wetModel.text,dryModel.text);
      assert.ok((wetModel.range.min+wetModel.range.max)<(dryModel.range.min+dryModel.range.max));
      const phases=[];
      for(const[phase,label]of[['in','進站限速行駛中'],['box','停站換胎中'],['out','出站中']]){
        await page.evaluate(`__gp.field.me.pit={ph:${JSON.stringify(phase)},sd:-170,v:0,entry:5,exit:4.5,t:0,T:2.5,slow:-1,next:2,box:0,team:0};__gp.field.me.pitTyre=3`);
        const text=await refresh();assert.ok(text.includes(label)&&text.includes('本次鎖定換上硬胎'));
        for(const absent of['全程淨代價','下圈進站淨代價','完整損失'])assert.ok(!text.includes(absent));phases.push({phase,text});
      }
      await page.evaluate('__gp.field.me.pit=null;__gp.field.me.pitReq=true;__gp.field.wet=0');await selectTyre(2);
      return{dry:dryModel,wet:wetModel,phases};
    });
    await check('strategy_panel_scrolls_and_summary_can_close_in_three_mobile_viewports',async()=>{
      for(const[width,height]of[[390,844],[844,390],[844,220]]){
        await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
        await page.evaluate(`document.getElementById('gp-strategy').open=true;document.getElementById('strategy-detail').scrollTop=0`);await refresh();
        const layout=await page.evaluate(`(() => {
          const p=document.getElementById('gp-strategy'),s=p.querySelector('summary'),d=document.getElementById('strategy-detail'),r=p.getBoundingClientRect(),q=s.getBoundingClientRect(),v=d.getBoundingClientRect();
          const before=d.scrollTop;d.scrollTop=d.scrollHeight;const moved=d.scrollTop>before;
          return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,panel:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},summary:{width:q.width,height:q.height,top:q.top,bottom:q.bottom},detail:{height:v.height,clientHeight:d.clientHeight,scrollHeight:d.scrollHeight,top:v.top,bottom:v.bottom,moved,text:d.textContent}};
        })()`);
        assert.ok(layout.documentWidth<=width+1);assert.ok(layout.panel.left>=-1&&layout.panel.right<=width+1&&layout.panel.top>=-1&&layout.panel.bottom<=height+1,JSON.stringify(layout));
        assert.ok(layout.summary.width>=44&&layout.summary.height>=44,JSON.stringify(layout));
        assert.ok(layout.detail.clientHeight>=44&&layout.detail.text.includes('本次估計換上硬胎'),JSON.stringify(layout));
        if(layout.detail.scrollHeight>layout.detail.clientHeight)assert.ok(layout.detail.moved,JSON.stringify(layout));
        await clickSummary();assert.equal(await page.evaluate(`document.getElementById('gp-strategy').open`),false);
        await clickSummary();assert.equal(await page.evaluate(`document.getElementById('gp-strategy').open`),true);
        report.layouts.push(layout);
        const file=`strategy-${width}x${height}.png`,shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,file),Buffer.from(shot.data,'base64'));report.screenshots.push(file);
      }
      return report.layouts;
    });
  }
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
}catch(error){report.error=error.stack??String(error);console.error(report.error);process.exitCode=1;}
finally{
  page?.close();
  if(browser&&context)await browser.send('Target.disposeBrowserContext',{browserContextId:context}).catch(error=>{report.cleanupError=String(error);report.status='FAIL';process.exitCode=1;});
  browser?.close();if(web)await new Promise(resolve=>web.httpServer.close(resolve));
  report.sourceUnchanged=true;for(const[file,value]of Object.entries(report.sourceHashes))if(hash(await readFile(path.join(project,file)))!==value)report.sourceUnchanged=false;
  if(!report.sourceUnchanged){report.status='FAIL';process.exitCode=1;}
  report.completedAt=new Date().toISOString();report.limitations=[
    '只連本機preview與既有CDP，以新隔離context測試；沒有操作玩家存檔或正式站。',
    '車手胎種/磨耗/濕度/進站階段由測試安排，按鈕走真pointerdown與UI；既有真rAF callback更新HUD。',
    '起跑燈使用測試時鐘；HUD比較時維持零dt，不驗證完整駕駛、實際進站時間、模型誤差或統計涵蓋率。',
    'viewport為桌面Chrome模擬，內容捲動為DOM操作，非手機實機/觸控手勢/耗電/FPS測量。',
    'before模式只執行指定胎舊行為對照；新版另驗雨勢、進站狀態及三種版面。',
  ];
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(path.join(here,before?'raceplus-strategy-browser-before.json':'raceplus-strategy-browser-result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,before,cases:report.cases.length,build:report.build,evidence}));
}
