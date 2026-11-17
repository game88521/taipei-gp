// 本機隔離 Chrome：真 BOT 完整物理圈建立遙測；真 UI 建立自訂賽曆。
// node tools/dev-tests/tenpack-racing-browser.mjs；等主代理排程，不與其他CDP回歸並跑。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { CdpConnection } from './multiplayer-ui-cdp.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),project=path.resolve(here,'../..'),port=4325,origin=`http://127.0.0.1:${port}`;
const report={startedAt:new Date().toISOString(),status:'FAIL',cases:[],exceptions:[],externalRequests:[],localOnly:true,sourceHashes:{}};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sw=await readFile(path.join(project,'dist/sw.js'));report.swSha256=digest(sw);report.build=sw.toString('utf8').match(/const VERSION = '([^']+)'/)?.[1];
report.scriptSha256=digest(await readFile(fileURLToPath(import.meta.url)));
for(const file of ['src/main.ts','src/style.css','index.html','src/race-analysis.ts','src/tt-coach.ts','src/season-editor.ts','src/racing-tools-ui.ts','src/season.ts','src/save.ts'])report.sourceHashes[file]=digest(await readFile(path.join(project,file)));
let web,browser,page,context;
const evaluate=code=>page.evaluate(code),click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
async function check(name,action){try{report.cases.push({name,status:'PASS',details:await action()});}catch(error){report.cases.push({name,status:'FAIL',error:error.stack});throw error;}finally{console.log(JSON.stringify(report.cases.at(-1)));}}
async function ready(){await page.until(`!!window.__gp&&!!document.getElementById('tt-lap-coach')&&!document.getElementById('btn-start').disabled`,180000);await evaluate(`__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false);window.__tenpackRacingManual=true;cancelAnimationFrame(window.__tenpackRacingRafId)`);}
async function navigate(query){const old=await evaluate('window.__tenpackRacingToken');await page.send('Page.navigate',{url:`${origin}/?${query}`});await page.until(`!!window.__tenpackRacingToken&&window.__tenpackRacingToken!==${JSON.stringify(old)}`,60000);await ready();}
try{
  web=await preview({root:project,preview:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});
  const cdp=process.env.GP_MULTIPLAYER_CDP_PORT??9334,version=await(await fetch(`http://127.0.0.1:${cdp}/json/version`)).json();
  browser=new CdpConnection(version.webSocketDebuggerUrl,'browser',report);context=(await browser.send('Target.createBrowserContext')).browserContextId;
  const{targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});const targets=await(await fetch(`http://127.0.0.1:${cdp}/json`)).json();
  page=new CdpConnection(targets.find(t=>t.id===targetId).webSocketDebuggerUrl,'tenpack-racing',report);
  page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails));
  page.on('Page.javascriptDialogOpening',()=>page.send('Page.handleJavaScriptDialog',{accept:false}));
  page.on('Fetch.requestPaused',async({requestId,request})=>{const url=new URL(request.url),ok=url.origin===origin||['data:','blob:','about:'].includes(url.protocol);if(!ok)report.externalRequests.push(request.url);await page.send(ok?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...ok?{}:{errorReason:'BlockedByClient'}});});
  await page.send('Runtime.enable');await page.send('Page.enable');await page.send('Network.enable');await page.send('Network.setBypassServiceWorker',{bypass:true});await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const seed={schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{sound:false,quali:false},taxi:{money:1000,trips:0},quality:'low',touch:'off',tutDone:true};
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{if(location.origin!==${JSON.stringify(origin)})return;if(!sessionStorage.getItem('tenpack-racing-seed')){localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('tenpack-racing-seed','1')}window.__tenpackRacingToken=crypto.randomUUID();window.__tenpackRacingManual=false;const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{window.__tenpackRacingFrame=cb;if(__tenpackRacingManual)return 0;return window.__tenpackRacingRafId=raf(cb)}})()`});
  await navigate('bot&sim=120&q=low&notraffic');
  await check('tt_true_complete_laps_create_same_rule_speed_brake_and_delta_ui',async()=>{
    assert.ok((await evaluate('__gp.sessionLaps.summary().validCount'))>=1);
    await click('btn-pause');await evaluate(`document.querySelector('.m-tabs [data-tab="records"]').click();document.getElementById('tt-lap-coach').open=true;document.getElementById('tt-coach-focus').value='last';document.getElementById('tt-coach-focus').dispatchEvent(new Event('change'))`);
    const result=await evaluate(`(()=>{const p=document.getElementById('tt-lap-coach');return{best:__gp.save.best,title:document.title,text:p.textContent,curves:p.querySelectorAll('polyline').length,brakes:p.querySelectorAll('path').length,rows:p.querySelectorAll('table tr').length}})()`);
    assert.ok(result.best>20);assert.equal(result.curves,2);assert.equal(result.brakes,2);assert.equal(result.rows,5);assert.ok(result.text.includes('累積失時'));assert.ok(!result.text.includes('舊紀錄沒有煞車遙測'));return result;
  });
  await navigate('bot&gp&sim=400&q=low&notraffic');
  await page.until(`__gp.state==='results'&&document.title.startsWith('GP')`,180000);
  await check('gp_true_full_race_all_drivers_laps_stints_and_stops',async()=>{
    await evaluate(`document.getElementById('gp-race-analysis').open=true;document.getElementById('gp-analysis-driver').dispatchEvent(new Event('change'))`);
    const result=await evaluate(`(()=>{const p=document.getElementById('gp-race-analysis'),s=document.getElementById('gp-analysis-driver');return{drivers:s.options.length,text:p.textContent,tables:p.querySelectorAll('table').length,rows:p.querySelectorAll('table')[0]?.rows.length,title:document.title}})()`);
    assert.equal(result.drivers,22);assert.equal(result.tables,2);assert.ok(result.rows>=2);assert.ok(result.text.includes('胎段可比平均'));assert.ok(result.text.includes('不推測採樣前停站')||result.text.includes('觀察到換胎'));
    const switched=await evaluate(`(()=>{const s=document.getElementById('gp-analysis-driver');s.selectedIndex=s.options.length-1;s.dispatchEvent(new Event('change'));return{driver:s.value,rows:document.querySelector('#gp-race-analysis table')?.rows.length,text:document.getElementById('gp-race-analysis').textContent}})()`);assert.ok(switched.rows>=2);return{...result,switched};
  });
  await navigate('bot&q=low&notraffic');
  await check('historical_pb_reload_explicitly_has_no_brake_trace',async()=>{
    await click('btn-pause');await evaluate(`document.querySelector('.m-tabs [data-tab="records"]').click();document.getElementById('tt-lap-coach').open=true;document.getElementById('tt-coach-reference').dispatchEvent(new Event('change'))`);
    const text=await evaluate(`document.getElementById('tt-lap-coach').textContent`);assert.ok(text.includes('舊紀錄沒有煞車遙測'));return{text};
  });
  await navigate('circuit=australia&q=low&notraffic');
  await check('custom_season_reorder_four_maps_stores_and_reloads_exact_order',async()=>{
    await click('btn-season');await evaluate(`document.getElementById('season-calendar-editor').open=true;const c=document.getElementById('season-custom-enabled');c.checked=true;c.dispatchEvent(new Event('change'));while(document.getElementById('season-custom-order').children.length>4)document.querySelector('#season-custom-order li:last-child button:last-child').click();document.querySelector('#season-custom-order li:first-child button:nth-of-type(2)').click()`);
    const order=await evaluate(`[...document.querySelectorAll('#season-custom-order li')].map(e=>e.dataset.circuit)`);assert.equal(order.length,4);
    const label=await evaluate(`document.getElementById('season-calendar-status').textContent`);assert.ok(label.includes('4/23'));assert.ok(label.includes('不適用'));
    const layouts=[];
    for(const[width,height]of[[390,844],[844,390]]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
      const layout=await evaluate(`(()=>{const panel=document.getElementById('season-calendar-editor');panel.open=true;const buttons=[...panel.querySelectorAll('button')].filter(b=>!b.disabled).map(b=>{b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{text:b.textContent,width:r.width,height:r.height,top:r.top,bottom:r.bottom,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b}});return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons}})()`);
      assert.ok(layout.scrollWidth<=width+1);assert.ok(layout.buttons.length>=3);for(const b of layout.buttons)assert.ok(b.width>=44&&b.height>=44&&b.top>=-1&&b.bottom<=height+1&&b.hit,JSON.stringify(b));layouts.push(layout);
    }
    const old=await evaluate('window.__tenpackRacingToken');await click('sn-go');await page.until(`!!window.__tenpackRacingToken&&window.__tenpackRacingToken!==${JSON.stringify(old)}`,60000);await ready();
    const actual=await evaluate(`({season:__gp.save.season,stored:JSON.parse(localStorage.getItem('taipei-gp-v2')).season,url:location.search,banner:document.getElementById('season-banner').textContent})`);
    assert.equal(actual.season.custom,true);assert.deepEqual(actual.season.calendar,order);assert.deepEqual(actual.stored.calendar,order);assert.ok(actual.url.includes(`circuit=${order[0]}`));return{order,label,layouts,...actual};
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
}catch(error){report.error=error.stack??String(error);console.error(report.error);process.exitCode=1;}
finally{
  if(digest(await readFile(path.join(project,'dist/sw.js')))!==report.swSha256){report.status='FAIL';report.buildChangedDuringTest=true;process.exitCode=1;}
  for(const[file,hash]of Object.entries(report.sourceHashes))if(digest(await readFile(path.join(project,file)))!==hash){report.status='FAIL';(report.sourcesChangedDuringTest??=[]).push(file);process.exitCode=1;}
  page?.close();if(browser&&context)await browser.send('Target.disposeBrowserContext',{browserContextId:context}).catch(error=>{report.cleanupError=String(error);report.status='FAIL';process.exitCode=1;});browser?.close();if(web)await new Promise(resolve=>web.httpServer.close(resolve));
  report.completedAt=new Date().toISOString();report.limitations=['隔離context的本機Chrome；未連外或讀寫玩家存檔。','TT/GP用既有BOT真物理完整跑圈；不等於真人操作或手機實機驗證。','純UI排版檢查不量測FPS、耗電、煞車點教學效果。'];
  const payload=JSON.stringify(report,null,2)+'\n';
  await writeFile(path.join(here,'tenpack-racing-browser-result.json'),payload);
  await writeFile(path.join(here,`tenpack-racing-browser-${report.startedAt.replaceAll(/[^0-9]/g,'')}.json`),payload);
  console.log(JSON.stringify({status:report.status,cases:report.cases.length,build:report.build}));
}
