// 真dist的城市延後載入、探索護照、目標及稱號；external-browser隔離context。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), origin = 'http://127.0.0.1:4317';
const [target] = (await (await fetch(`http://127.0.0.1:${process.argv[2]}/json`)).json()).filter(p => p.type === 'page');
assert.ok(target, '找不到wrapper提供的分頁');
const report = { build: (await readFile(path.join(root, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1], origin, isolatedContext: true, playerStorageTouched: false, cases: [], exceptions: [], externalRequests: [], layouts: [], limitations: ['Chrome模擬三種viewport，手機實機/FPS/耗電未驗', '地標到訪以真main.updateFreeHud及指定位置驗證，未宣稱實際駕駛完整路線', '延後載入驗證建立時機，未量測啟動省時'] };
let seq = 0; const pending = new Map(), ws = new WebSocket(target.webSocketDebuggerUrl);
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Fetch.requestPaused') {
    const u = new URL(m.params.request.url), local = u.origin === origin || ['about:', 'data:', 'blob:'].includes(u.protocol);
    if (!local) report.externalRequests.push(u.href);
    void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
  }
  const job = pending.get(m.id); if (!job) return;
  clearTimeout(job.timer); pending.delete(m.id); m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 90000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; }
async function until(expression, timeout = 240000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await ev(expression)) return; await new Promise(r => setTimeout(r, 250)); } throw Error('等待逾時 ' + expression); }
async function check(name, fn) { try { report.cases.push({ name, status: 'PASS', detail: await fn() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
async function click(selector) { await ev(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function esc() { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); }
const hidden = id => `document.getElementById('${id}').classList.contains('hidden')`;
try {
  assert.ok((await send('Target.getTargetInfo')).targetInfo.browserContextId, '必須使用隔離context');
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const seed = { schema: 3, playerId: '55555555-5555-4555-8555-555555555555', best: null, sectors: [null, null, null], ghost: null, opts: { sound: false }, tutDone: true, quality: 'low', touch: 'on' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(!sessionStorage.getItem('all-city-seeded')){localStorage.clear();localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('all-city-seeded','1');}` });
  await send('Page.navigate', { url: origin + '/?q=low&notraffic' });
  await until(`!!window.__gp&&!document.querySelector('#btn-start').disabled`);
  await ev('__gp.renderer.setAnimationLoop(null)');
  await check('R：台北賽道可選時尚未建立街頭系統', async () => {
    const d = await ev(`({state:__gp.state,ready:__gp.streetSystemsReady,traffic:!!__gp.traffic,peds:!!__gp.peds,sr:!!__gp.sr,router:!!__gp.router,taxi:!!__gp.taxi})`);
    assert.deepEqual(d, { state: 'menu', ready: false, traffic: false, peds: false, sr: false, router: false, taxi: false }); return d;
  });
  await check('L：護照在menu可看地標/區域，Esc返回menu', async () => {
    await click('#btn-passport'); await until(`!${hidden('passport-page')}`);
    const d = await ev(`({count:document.querySelectorAll('#passport-list button').length,regions:document.querySelector('#passport-regions').textContent,summary:document.querySelector('#passport-summary').textContent})`);
    assert.ok(d.count > 20); assert.match(d.regions, /東區/); await esc(); assert.equal(await ev(hidden('passport-page')), true); assert.equal(await ev('__gp.state'), 'menu'); return d;
  });
  await check('R：自由駕駛才建立完整街頭系統', async () => {
    await click('#btn-free'); await until(`__gp.streetSystemsReady&&__gp.state==='free'`); await ev('__gp.renderer.setAnimationLoop(null)');
    const d = await ev(`({traffic:!!__gp.traffic,peds:!!__gp.peds,sr:!!__gp.sr,router:!!__gp.router,taxi:!!__gp.taxi})`); for (const value of Object.values(d)) assert.equal(value, true); return d;
  });
  await check('L：真main地標跨層不記錄，地面到訪去重並持久保存', async () => {
    await click('#btn-passport'); await until(`!${hidden('passport-page')}`);
    await ev(`window.__marks=[...new Set([...document.querySelectorAll('#passport-list button b')].map(el=>el.textContent.slice(2)))].slice(0,5).map(nm=>__gp.cityData.places.find(p=>p.nm.trim()===nm));`);
    await esc();
    const d = await ev(`(() => {const p=__marks[0],id=p.nm.trim()+':'+Math.round(p.x)+':'+Math.round(p.z);__gp.fcar.place(p.x,p.z,0);const y=__gp.fcar.y;__gp.fcar.y=y+10;__gp.updateFreeHud(.6);const high=__gp.playerProgress.visited.includes(id);__gp.fcar.y=y;__gp.updateFreeHud(.6);const low=__gp.playerProgress.visited.includes(id);const n=__gp.playerProgress.visited.length;__gp.updateFreeHud(.6);return {high,low,count:n,after:__gp.playerProgress.visited.length,stored:JSON.parse(localStorage.getItem('taipei-gp-v2')).progress.visited.includes(id)};})()`);
    assert.equal(d.high, false); assert.equal(d.low, true); assert.equal(d.after, d.count); assert.equal(d.stored, true); return d;
  });
  await check('L：護照暫停/篩選/三種viewport可操作，導航後恢復自由駕駛', async () => {
    await click('#btn-passport'); assert.equal(await ev('__gp.mapOpen'), true);
    await ev(`(() => {const f=document.querySelector('#passport-filter');f.value='visited';f.dispatchEvent(new Event('change'));})()`);
    assert.ok(await ev(`document.querySelectorAll('#passport-list button').length>0&&[...document.querySelectorAll('#passport-list button b')].every(e=>e.textContent.startsWith('✓'))`));
    for (const [width, height] of [[390,844],[844,390],[844,220]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      const d = await ev(`(() => {const c=document.querySelector('#passport-page .card'),b=document.querySelector('#passport-close');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,cardScroll:c.scrollWidth,cardClient:c.clientWidth,filterHeight:document.querySelector('#passport-filter').getBoundingClientRect().height,button:{height:r.height,top:r.top,bottom:r.bottom},reachable:!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#passport-close')}})()`);
      report.layouts.push(d); assert.ok(d.scroll <= width+1); assert.ok(d.cardScroll <= d.cardClient+1); assert.ok(d.filterHeight>=44); assert.ok(d.button.height >=44); assert.ok(d.button.top>=-1&&d.button.bottom<=height+1); assert.ok(d.reachable);
      await mkdir(path.join(root,'tools/dev-tests/shots'),{recursive:true});
      const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,`tools/dev-tests/shots/all-city-passport-${width}x${height}.png`),Buffer.from(shot.data,'base64'));
    }
    await ev(`(() => {const f=document.querySelector('#passport-filter');f.value='unvisited';f.dispatchEvent(new Event('change'));})()`);
    assert.ok(await ev(`[...document.querySelectorAll('#passport-list button b')].every(e=>e.textContent.startsWith('○'))`));
    await click('#passport-list button'); await until(`__gp.state==='free'&&!!__gp.nav&&${hidden('passport-page')}`); assert.equal(await ev('__gp.mapOpen'), false);
    return await ev(`({nav:__gp.nav.nm,state:__gp.state,paused:__gp.mapOpen})`);
  });
  await check('O：成就真按鈕置頂最多三項，取消後可替換，HUD顯示進度', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
    await click('#btn-pause'); await click('#btn-ach');
    const d=await ev(`(() => {const ids=[...document.querySelectorAll('button[data-ach]')].slice(0,4).map(b=>b.dataset.ach);for(const id of ids)document.querySelector('button[data-ach="'+id+'"]').click();const first=[...__gp.playerProgress.pinned];document.querySelector('button[data-ach="'+ids[0]+'"]').click();document.querySelector('button[data-ach="'+ids[3]+'"]').click();return {ids,first,after:[...__gp.playerProgress.pinned],hud:document.querySelector('#pinned-targets-body').textContent,hidden:document.querySelector('#pinned-targets').classList.contains('hidden')};})()`);
    assert.equal(d.first.length,3); assert.deepEqual(d.first,d.ids.slice(0,3)); assert.deepEqual(d.after,[d.ids[1],d.ids[2],d.ids[3]]); assert.equal(d.hidden,false); assert.match(d.hud,/\//); await click('#ach-close'); await click('#btn-resume');
    const visible=await ev(`(() => {const el=document.querySelector('#pinned-targets');el.open=true;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight;})()`);assert.equal(visible,true);return {...d,visible};
  });
  await check('O：探索五地標解鎖稱號，真車庫裝備後menu及存檔一致', async () => {
    await click('#btn-resume');
    await ev(`for(const p of __marks){__gp.fcar.place(p.x,p.z,0);__gp.updateFreeHud(.6);}`);
    await click('#btn-pause'); await click('.m-tabs button[data-tab="garage"]');
    const d=await ev(`(() => {const s=document.querySelector('#profile-tools select'),o=s.querySelector('option[value="explorer"]');const unlocked=!o.disabled;s.value='explorer';s.dispatchEvent(new Event('change'));return {visited:__gp.playerProgress.visited.length,unlocked,title:document.querySelector('#player-title').textContent,stored:JSON.parse(localStorage.getItem('taipei-gp-v2')).progress.title};})()`);
    assert.ok(d.visited>=5); assert.equal(d.unlocked,true); assert.equal(d.title,'城市旅人'); assert.equal(d.stored,'explorer'); return d;
  });
} catch (e) { report.cases.push({ name:'啟動或相依流程',status:'FAIL',error:e.stack }); }
finally {
  report.summary={passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length};
  if(report.summary.failed){try{await mkdir(path.join(root,'tools/dev-tests/shots'),{recursive:true});const s=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tools/dev-tests/shots/all-city-browser-failure.png'),Buffer.from(s.data,'base64'));}catch{}}
  await writeFile(path.join(root,'tools/dev-tests/shots-all-city-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));ws.close();
  if(report.summary.failed||report.exceptions.length||report.externalRequests.length)process.exitCode=1;
}
