// Local production bundle; standard Gamepad samples are injected fixtures, not physical hardware.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {CdpConnection,click,focus} from './multiplayer-ui-cdp.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),origin='http://127.0.0.1:4354',cdp=`http://127.0.0.1:${process.env.GP_MULTIPLAYER_CDP_PORT??9334}`;
const evidence=path.join(root,'tools/dev-tests',`horizon-controls-browser-${Date.now()}`);await mkdir(evidence);
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={status:'FAIL',cases:[],exceptions:[],externalRequests:[],screenshots:[],localOnly:true,realGamepadUsed:false,realPhoneUsed:false,sourceHashes:{}};
for(const f of ['src/input.ts','src/horizon-controls.ts','src/main.ts','src/multiplayer-game.ts','index.html','multiplayer.html'])report.sourceHashes[f]=hash(await readFile(path.join(root,f)));
report.scriptSha256=hash(await readFile(new URL(import.meta.url)));report.build=(await readFile(path.join(root,'dist/sw.js'),'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
let web,browser,page,context;
const ev=e=>page.evaluate(e);
async function check(name,fn){try{report.cases.push({name,status:'PASS',details:await fn()});}catch(e){report.cases.push({name,status:'FAIL',error:String(e.stack)});throw e;}finally{console.log(JSON.stringify(report.cases.at(-1)));}}
async function selectorClick(selector){await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,reachable:!!h&&(e===h||e.contains(h))}})()`);assert.equal(p.reachable,true,selector);for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});}
async function sendKey(code){for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:code.replace(/^Key/,''),code});}
async function shot(name){const r=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));report.screenshots.push(name+'.png');}
try{
 web=await preview({root,preview:{host:'127.0.0.1',port:4354,strictPort:true},logLevel:'error'});
 const v=await(await fetch(cdp+'/json/version')).json();browser=new CdpConnection(v.webSocketDebuggerUrl,'horizon-controls-browser',report);context=(await browser.send('Target.createBrowserContext')).browserContextId;
 const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});const t=(await(await fetch(cdp+'/json')).json()).find(t=>t.id===targetId);page=new CdpConnection(t.webSocketDebuggerUrl,'horizon-controls',report);
 page.on('Runtime.exceptionThrown',e=>report.exceptions.push(e));page.on('Fetch.requestPaused',async({requestId,request})=>{const u=new URL(request.url),allowed=u.origin===origin||['about:','data:','blob:'].includes(u.protocol);if(!allowed)report.externalRequests.push(request.url);await page.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...allowed?{}:{errorReason:'BlockedByClient'}});});
 for(const m of ['Page.enable','Runtime.enable','Network.enable'])await page.send(m);await page.send('Network.setBypassServiceWorker',{bypass:true});await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)}){if(!sessionStorage.getItem('horizon-controls-seeded')){localStorage.setItem('taipei-gp-v2',JSON.stringify({schema:3,best:null,sectors:[null,null,null],ghost:null,opts:{sound:false},tutDone:true,quality:'low',touch:'off'}));sessionStorage.setItem('horizon-controls-seeded','1')}window.__hintPad=null;Object.defineProperty(navigator,'getGamepads',{value:()=>[window.__hintPad]})}`});
 await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await page.send('Page.navigate',{url:origin+'/?debug'});await page.until(`window.__gp&&!document.getElementById('btn-start').disabled`,150000);await ev('__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false)');await focus(page);
 await check('真設定介面改鍵後更新選單與HUD提示',async()=>{
  await selectorClick('[data-tab=settings]');await selectorClick('#control-settings summary');await selectorClick('[data-control-action=left]');await sendKey('KeyQ');await selectorClick('[data-control-action=handbrake]');await sendKey('KeyZ');await page.until(`document.getElementById('steer-l').title.includes('Q')`);assert.match(await ev(`document.getElementById('btn-drift').title`),/Z/);assert.equal(await ev(`__gp.input.getControls().keys.left[0]`),'KeyQ');await selectorClick('[data-tab=play]');assert.match(await ev(`document.getElementById('control-keyboard-hint').textContent`),/Q／→/);return{realSettingsAndKeyboard:true};
 });
 await check('開啟教學使用目前綁定，翻頁甩尾同步',async()=>{
  await selectorClick('[data-tab=records]');await click(page,'btn-tut');assert.match(await ev(`document.getElementById('tut-text').textContent`),/Q／→/);await click(page,'tut-next');await click(page,'tut-next');assert.match(await ev(`document.getElementById('tut-text').textContent`),/按住 Z 甩尾/);await shot('keyboard-tutorial');return{page:3};
 });
 await check('注入標準手把後同頁即時切換，保留手把中立狀態',async()=>{
  const before=await ev(`__gp.input.getGamepadStatus()`);await ev(`window.__hintPad={index:0,connected:true,mapping:'standard',axes:[0],buttons:Array.from({length:8},()=>({pressed:false,value:0}))};dispatchEvent(new Event('gamepadconnected'))`);await page.until(`document.getElementById('tut-text').textContent.includes('左方鍵')`);assert.equal(await ev(`__gp.input.getGamepadStatus()`),before);assert.equal(await ev(`document.getElementById('brake').hasAttribute('aria-keyshortcuts')`),false);assert.match(await ev(`document.getElementById('btn-map').title`),/點選/);await shot('gamepad-tutorial');return{simulatedStandardGamepad:true,readOnlyHints:true};
 });
 await check('鍵盤可接回提示；純打字不改操作模式',async()=>{
  await ev(`document.activeElement.blur()`);await sendKey('KeyQ');await page.until(`document.getElementById('tut-text').textContent.includes('按住 Z')`);await ev(`__hintPad.axes=[.6]`);await page.until(`document.getElementById('tut-text').textContent.includes('左方鍵')`);await ev(`(()=>{const i=document.createElement('input');i.id='hint-text-field';document.body.appendChild(i);i.focus()})()`);await sendKey('KeyQ');assert.match(await ev(`document.getElementById('tut-text').textContent`),/左方鍵/);await ev(`document.getElementById('hint-text-field').remove();__hintPad=null;dispatchEvent(new Event('gamepaddisconnected'))`);return{typingIgnored:true};
 });
 await check('模擬觸控教學與窄螢幕可讀，未冒稱手機實測',async()=>{
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await ev(`dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch'}))`);await page.until(`document.getElementById('tut-text').textContent.includes('🌀 按鈕')`);const sizes=await ev(`(()=>{const e=document.getElementById('tut-text'),r=e.getBoundingClientRect();return{doc:document.documentElement.scrollWidth,width:innerWidth,left:r.left,right:r.right}})()`);assert.ok(sizes.doc<=sizes.width+1);assert.ok(sizes.left>=0&&sizes.right<=sizes.width);await shot('touch-tutorial');await click(page,'tut-skip');return sizes;
 });
 await check('多人頁沿用重綁提示且不顯示自動油門的倒車提示',async()=>{
  await page.send('Page.navigate',{url:origin+'/multiplayer.html'});await page.until(`window.__mp&&document.getElementById('mp-driving-hint').textContent.includes('Q')`,150000);await focus(page);const text=await ev(`document.getElementById('mp-driving-hint').textContent`);assert.match(text,/自動油門/);assert.doesNotMatch(text,/倒車/);assert.match(await ev(`document.getElementById('mp-left').title`),/Q/);await ev(`window.__hintPad={index:0,connected:true,mapping:'standard',axes:[0],buttons:Array.from({length:8},()=>({pressed:false,value:0}))};dispatchEvent(new Event('gamepadconnected'))`);await page.until(`document.getElementById('mp-driving-hint').textContent.includes('左搖桿')`);await shot('multiplayer-hints');return{storedPreferencesShared:true};
 });
 assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
}catch(e){report.error=String(e.stack);process.exitCode=1;if(page)try{report.failureState=await ev(`({focus:document.hasFocus(),hidden:document.hidden,classes:document.documentElement.className,config:window.__gp?.input.getControls(),device:document.getElementById('control-current-device')?.textContent,title:document.getElementById('steer-l')?.title,status:document.querySelector('.controls-status')?.textContent})`);await shot('failure');}catch{} }finally{
 page?.close();if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context}).catch(e=>{report.cleanupError=String(e);report.status='FAIL';process.exitCode=1;});browser?.close();await web?.close();report.completedAt=new Date().toISOString();const output=JSON.stringify({...report,evidence:path.relative(root,evidence)},null,2)+'\n';await writeFile(path.join(evidence,'report.json'),output);await writeFile(path.join(root,'tools/dev-tests/horizon-controls-browser-result.json'),output);console.log(JSON.stringify({status:report.status,cases:report.cases.length,error:report.error,evidence}));
}
