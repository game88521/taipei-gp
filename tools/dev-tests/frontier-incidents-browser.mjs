// Rex <game88521@gmail.com>. Real file chooser, WebGL replay and native facts download on localhost only.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {analyzeReplayIncident} from '../../shared/frontier-incidents.ts';
import {FrontierBrowserHarness,click,focus,set,layout,ORIGIN} from './frontier-browser-harness.mjs';
const h=new FrontierBrowserHarness('frontier-incidents-browser',new URL(import.meta.url),['src/nexus-replay-ui.ts','src/frontier-incidents-ui.ts','src/frontier-incidents.css','shared/frontier-incidents.ts','shared/nexus-replay.ts','tools/dev-tests/frontier-browser-harness.mjs']);let error;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function fileInput(p,file){const root=(await p.send('DOM.getDocument')).root.nodeId;const {nodeId}=await p.send('DOM.querySelector',{nodeId:root,selector:'#mp-replay-library input[type=file]'});assert.ok(nodeId);await p.send('DOM.setFileInputFiles',{nodeId,files:[file]});}
try{
 const service=JSON.parse(await readFile(new URL('frontier-incidents-service-node-result.json',import.meta.url),'utf8'));assert.equal(service.status,'PASS');
 const fixture=service.generated.find(r=>r.schema===2),archive=JSON.parse(await readFile(fixture.path,'utf8')),expected=analyzeReplayIncident(archive,fixture.collisionIndex),wall=analyzeReplayIncident(archive,fixture.wallIndex);assert.ok(expected&&wall);h.report.fixture={...fixture,limitations:service.limitations};
 await h.start(1);const p=h.pages[0];let storage;
 await p.send('Page.navigate',{url:ORIGIN+'/multiplayer.html'});await p.until('!!window.__mp?.scene',180000);await focus(p);await set(p,'mp-quality','economy');await p.until('__mp.ready',180000);
 await p.evaluate('document.getElementById("mp-replay-library").open=true');await p.until('!!document.getElementById("mp-replay-import")',30000);
 await h.test('真服務權威回放經原生file匯入，原JSON與成績保持不變',async()=>{
  storage=await p.evaluate('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))');await fileInput(p,fixture.path);await p.until('__mp.replay.current?.id==='+JSON.stringify(archive.id));assert.deepEqual(await p.evaluate('__mp.replay.current'),archive);await click(p,'mp-replay-play');await p.until('__mp.replay.ready',180000);await p.evaluate('document.getElementById("frontier-incidents").open=true');await set(p,'frontier-incident-event',String(fixture.collisionIndex));assert.equal(await p.evaluate('document.getElementById("frontier-incident-event").value'),String(fixture.collisionIndex));
 });
 await h.test('接觸三點列出原始frame、帶方向速度、同frame相對位置及全部未知限制',async()=>{
  const text=await p.evaluate('document.getElementById("frontier-incident-facts").textContent');assert.match(text,/未知：高度、連線狀態、煞車、油門、接觸法線及真正接觸步/);assert.match(text,/不作為肇責依據/);
  for(const point of expected.points){const text=await p.evaluate('document.querySelector(".frontier-incident-point[data-role='+point.role+']").textContent');assert.ok(text.includes((point.sampleAt/1000).toFixed(3)+' 秒'));assert.ok(text.includes(String(Math.round(point.offsetMs))+'ms'));for(const car of point.cars)assert.ok(text.includes(car.speedKph.toFixed(2)));assert.ok(text.includes(point.relative.distanceM.toFixed(2)+'m'));}
  assert.deepEqual(await p.evaluate('__mp.replay.current'),archive);await h.shot(p,'contact-facts.png');return{eventIndex:fixture.collisionIndex,sourceFrames:expected.points.map(r=>r.sampleAt),actualContactStepKnown:false};
 });
 await h.test('選護牆事件只列一車，保留原始eventIndex，沒有虛構對手',async()=>{
  await set(p,'frontier-incident-event',String(fixture.wallIndex));const cards=await p.evaluate('[...document.querySelectorAll(".frontier-incident-point")].map(e=>({tables:e.querySelectorAll("table").length,text:e.textContent}))');assert.equal(cards.length,3);for(const c of cards){assert.equal(c.tables,1);assert.ok(!c.text.includes('朝向為基準'));}await set(p,'frontier-incident-event',String(fixture.collisionIndex));
 });
 await h.test('真按鈕播放接觸前後片段，自動停止於界線並關閉原A/B循環',async()=>{
  await set(p,'mp-replay-speed','4');await click(p,'frontier-incident-play');await p.until('__mp.replay.at>'+String(Math.max(0,expected.event.at-3000)));await p.until('document.getElementById("mp-replay-toggle").textContent==="播放"',15000);assert.ok(Math.abs(await p.evaluate('__mp.replay.at')-(expected.event.at+3000))<.01);assert.equal(await p.evaluate('document.getElementById("odyssey-replay-notes").dataset.loopEnabled'),'false');return{segmentEnd:await p.evaluate('__mp.replay.at')};
 });
 await h.test('原生Blob下載等於瀏覽器事實JSON，原始值逐欄精確、衍生幾何跨runtime容差1e-10',async()=>{
  await h.browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:h.evidence,browserContextId:h.contexts[0]});await p.evaluate('window.__frontierNativeURL=URL.createObjectURL;URL.createObjectURL=function(blob){window.__frontierFactsBlob=blob;return __frontierNativeURL.call(URL,blob)}');await click(p,'frontier-incident-download');const filename=`taipei-gp-contact-${archive.id}-${fixture.collisionIndex}.json`;for(let i=0;i<100&&!(await readdir(h.evidence)).includes(filename);i++)await wait(50);const downloaded=JSON.parse(await readFile(path.join(h.evidence,filename),'utf8'));assert.deepEqual(downloaded,JSON.parse(await p.evaluate('__frontierFactsBlob.text()')));await p.evaluate('URL.createObjectURL=__frontierNativeURL');const comparison=structuredClone(expected);for(let i=0;i<comparison.points.length;i++)if(comparison.points[i].relative){for(const[key,value]of Object.entries(comparison.points[i].relative))if(typeof value==='number')assert.ok(Math.abs(downloaded.points[i].relative[key]-value)<1e-10);comparison.points[i].relative=downloaded.points[i].relative;}assert.deepEqual(downloaded,comparison);for(const key of['penaltyMs','responsibility','verdict'])assert.equal(key in downloaded,false);assert.deepEqual(await p.evaluate('__mp.replay.current'),archive);assert.equal(await p.evaluate('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))'),storage);
 });
 await h.test('事實面板在三種手機尺寸所有控制至少44px、可捲動點擊',async()=>{await layout(p,'contact-facts','#frontier-incidents',h.report,h.evidence);});
 await h.test('關閉播放器後舊按鈕不能再播放／下載，新viewer無殘留元件',async()=>{
  await p.evaluate('window.__frontierOldPlay=document.getElementById("frontier-incident-play");window.__frontierOldDownload=document.getElementById("frontier-incident-download")');await click(p,'mp-replay-close');assert.equal(await p.evaluate('__mp.replay.active'),false);assert.equal(await p.evaluate('document.getElementById("frontier-incidents")'),null);await p.evaluate('__frontierOldPlay.click();__frontierOldDownload.click()');assert.equal(await p.evaluate('__mp.replay.active'),false);assert.deepEqual(await p.evaluate('__mp.replay.current'),archive);
 });
 await h.test('明示schema1相容檔無事件時停用分析與下載，不從軌跡猜接觸',async()=>{
  const legacyPath=service.cases.find(c=>c.details?.derivativeSchema===1).details.fixturePath;h.report.limitations.push('legacy schema1 is an explicit compatibility derivative of the true schema2 archive, with schema2 fields removed and strict-parser validation; it is not claimed as a schema1 live service recording.');await fileInput(p,legacyPath);await p.until('__mp.replay.current?.schema===1');await click(p,'mp-replay-play');await p.until('__mp.replay.ready',180000);await p.evaluate('document.getElementById("frontier-incidents").open=true');for(const id of['frontier-incident-event','frontier-incident-play','frontier-incident-download'])assert.equal(await p.evaluate('document.getElementById('+JSON.stringify(id)+').disabled'),true);assert.match(await p.evaluate('document.getElementById("frontier-incident-status").textContent'),/v1.*沒有事件/);await click(p,'mp-replay-close');assert.equal(await p.evaluate('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))'),storage);
 });
}catch(e){error=e;}finally{await h.finish(error);}
