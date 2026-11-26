/** Rex <game88521@gmail.com>. Built localhost UI and real local rooms; no deployment. */
import assert from 'node:assert/strict';
import {FrontierBrowserHarness,ORIGIN,focus,click,set} from './frontier-browser-harness.mjs';
const files=['multiplayer.html','src/lantern-lobby.ts','src/lantern-lobby.css','src/lantern-track-picker.ts','src/lantern-track-picker.css','src/lantern-reading.ts','src/harbor-accessibility.ts','src/harbor-accessibility.css','src/lantern-rules.ts','src/lantern-rules.css','shared/lantern-ui-rules.ts','shared/lantern-ui-tracks.ts','shared/lantern-ui-track-previews.json'];
const h=new FrontierBrowserHarness('lantern-ui-browser',new URL(import.meta.url),files);let error;
const frame=p=>p.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
async function target(p,id){await p.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center',inline:'nearest'})`);return p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{id:e.id,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:!!hit&&(hit===e||e.contains(hit)),hidden:!!e.closest('[hidden]')};})()`);}
try{
 await h.start(1);const p=h.pages[0];
 await h.test('既有社交規則卡隨真實單人巡航大廳、倒數、起跑更新',async()=>{
  await h.social(p,'cruise');await p.until('!!document.getElementById("lantern-social-rules")');
  assert.match(await p.evaluate('document.getElementById("lantern-social-rules").textContent'),/這場目標/);
  await click(p,'social-create');await p.until('__gp.expeditionSocial.client.room?.phase==="lobby"');
  assert.match(await p.evaluate('document.querySelector("#lantern-social-rules .lantern-rule-phase").textContent'),/賽前準備/);
  await click(p,'social-ready');await p.until('!document.getElementById("social-start").disabled');await click(p,'social-start');await p.until('__gp.expeditionSocial.client.room?.phase==="countdown"');
  assert.match(await p.evaluate('document.querySelector("#lantern-social-rules .lantern-rule-phase").textContent'),/倒數/);
  await p.until('__gp.expeditionSocial.client.room?.phase==="running"',15000);
  await p.until('document.querySelector("#lantern-social-rules .lantern-rule-phase").textContent.includes("進行中")');
  const hint=await p.evaluate('document.getElementById("lantern-social-rules-live").textContent');assert.match(hint,/城市|集合點/);
  await h.leaveSocial(p);return{authority:'real local room',phases:['lobby','countdown','running'],hint};
 });
 await h.test('閱讀100/125/150保留原標題比例與層級，HUD設定不變',async()=>{
  await p.evaluate('document.querySelector("[data-tab=settings]").click()');await set(p,'harbor-reading-scale','100');await frame(p);
  const selector='[data-harbor-reading-surface] :is(h1,h2,h3,h4)';
  const bases=await p.evaluate(`(()=>{window.__lanternHeadingNodes=[...document.querySelectorAll(${JSON.stringify(selector)})];return __lanternHeadingNodes.map(e=>parseFloat(getComputedStyle(e).fontSize));})()`);
  assert.ok(bases.length>3);assert.ok(new Set(bases).size>1);
  const hud=await p.evaluate('localStorage.getItem("taipei-gp-voyager-comfort-v1")');
  for(const scale of[125,150]){await set(p,'harbor-reading-scale',String(scale));await frame(p);const sizes=await p.evaluate('__lanternHeadingNodes.map(e=>parseFloat(getComputedStyle(e).fontSize))');for(let i=0;i<bases.length;i++)assert.ok(Math.abs(sizes[i]-bases[i]*scale/100)<.1,`heading ${i}: ${sizes[i]} vs ${bases[i]} at ${scale}`);}
  assert.equal(await p.evaluate('localStorage.getItem("taipei-gp-voyager-comfort-v1")'),hud);await set(p,'harbor-reading-scale','100');return{headings:bases.length,distinctAuthoredSizes:new Set(bases).size,scales:[125,150]};
 });
 await focus(p);await p.send('Page.navigate',{url:ORIGIN+'/multiplayer.html'});await p.until('window.__mp?.ready&&!document.getElementById("mp-create").disabled',180000);
 await h.test('24張真路線卡可搜尋選擇；快速草稿不切場景、不建立房間',async()=>{
  const before=await p.evaluate('__mp.scene.trackId??null'),rooms=h.app.service.rooms.size;
  await click(p,'harbor-quick-open');await click(p,'harbor-quick-next');
  await p.evaluate('document.querySelector("#harbor-quick-track-lantern-picker details").open=true');
  const all=await p.evaluate('[...document.querySelectorAll("#harbor-quick-track-lantern-picker .lantern-track-grid button")].map(b=>({id:b.dataset.trackId,path:b.querySelector("path").getAttribute("d")}))');assert.equal(all.length,24);assert.equal(new Set(all.map(x=>x.path)).size,24);
  await set(p,'harbor-quick-track-lantern-search','不存在的地圖123');assert.equal(await p.evaluate('document.querySelectorAll("#harbor-quick-track-lantern-picker .lantern-track-grid button:not([hidden])").length'),0);
  await set(p,'harbor-quick-track-lantern-search','摩納哥');await click(p,'harbor-quick-track-lantern-monaco');assert.equal(await p.evaluate('document.getElementById("harbor-quick-track").value'),'monaco');
  assert.equal(await p.evaluate('__mp.scene.trackId??null'),before);assert.equal(h.app.service.rooms.size,rooms);
  await set(p,'harbor-quick-track-lantern-search','');await click(p,'harbor-quick-track-lantern-taipei');await click(p,'harbor-quick-next');await set(p,'harbor-quick-humans','1');await set(p,'harbor-quick-ai','1');await click(p,'harbor-quick-create');await p.until('__mp.client.room?.players.length===2&&__mp.client.room.players.every(p=>p.loaded)',180000);return{maps:24,uniquePaths:24,draftRoomWrites:0,sceneUnchanged:true};
 });
 await h.test('手機三分頁保留原控制ID，準備列可點擊且小視窗不橫溢',async()=>{
  const evidence=[];
  for(const[width,height]of[[390,844],[844,390],[390,220]]){
   await p.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await frame(p);
   for(const key of['players','rules','events']){await click(p,'lantern-lobby-tab-'+key);await frame(p);assert.equal(await p.evaluate(`document.getElementById('lantern-lobby-${key}').hidden`),false);if(width<=640)assert.equal(await p.evaluate('[...document.querySelectorAll(".lantern-lobby-section")].filter(e=>!e.hidden).length'),1);}
   const result=await target(p,'mp-ready');assert.ok(result.width>=44&&result.height>=44);assert.equal(result.reachable,true);assert.equal(result.hidden,false);assert.ok(await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
   if(width===390&&height===844){assert.ok(result.bottom<=height&&result.top>height/2);for(const y of[0,400,1200]){await p.evaluate(`window.scrollTo(0,${y})`);const edge=await p.evaluate('({bottom:document.getElementById("lantern-lobby-actions").getBoundingClientRect().bottom,height:innerHeight})');assert.ok(Math.abs(edge.bottom-edge.height)<2,'action dock must remain at viewport bottom while scrolling');}await click(p,'mp-ready');await p.until('__mp.client.room.players.find(p=>p.id===__mp.client.selfId).ready');assert.match(await p.evaluate('document.getElementById("lantern-lobby-readiness").textContent'),/已準備/);await click(p,'mp-ready');await p.until('!__mp.client.room.players.find(p=>p.id===__mp.client.selfId).ready');}
   evidence.push({viewportWidth:width,viewportHeight:height,...result});await h.shot(p,`lobby-${width}x${height}.png`);
  }
  await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await click(p,'lantern-lobby-tab-rules');await p.evaluate('document.getElementById("lantern-lobby-tab-rules").focus()');await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});assert.equal(await p.evaluate('document.activeElement.id'),'lantern-lobby-tab-events');
  await click(p,'mp-leave');await p.until('!__mp.client.room');return{layouts:evidence,originalReadyHandlerUsed:true,keyboardTabs:true};
 });
}catch(e){error=e;}finally{await h.finish(error);}
