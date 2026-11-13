// node external-browser.mjs 9333 followup-ui-browser.mjs
// 僅本機4317及外部Chrome隔離context；不開/關外部Chrome、不使用玩家storage。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = process.argv[2], origin = 'http://127.0.0.1:4317', KEY = 'taipei-gp-v2';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = pages.find((p) => p.type === 'page'); if (!target) throw Error('找不到隔離測試分頁');
// 先完成檔案 I/O，再開 WebSocket，避免 onopen 在 await readFile 期間已發生。
const build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let seq = 0, initId, scenario = 0, acceptDialogs = false;
const report = { origin, build,
  externalChrome: true, isolatedContext: true, playerStorageTouched: false, realPhone: false, cases: [], layouts: [], exceptions: [], dialogs: [], blockedExternalRequests: [],
  limitations: ['軟體Chrome只驗UI/流程，未量真機FPS、功耗或音效', '幀率驗證使用真main的人工120Hz動畫回呼與render呼叫計數，render本身替換為計數器'] };
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ message: m.params.message, accepted: acceptDialogs }); void send('Page.handleJavaScriptDialog', { accept: acceptDialogs }).catch(() => {}); }
  if (m.method === 'Fetch.requestPaused') {
    const u = new URL(m.params.request.url), local = u.origin === origin || ['data:', 'blob:', 'about:'].includes(u.protocol);
    if (!local) report.blockedExternalRequests.push(m.params.request.url);
    void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
  }
  const job = pending.get(m.id); if (!job) return; pending.delete(m.id); clearTimeout(job.timer); m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method}逾時`)); }, 90000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, ms = 120000) { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (await ev(expression)) return; await delay(250); } throw Error(`等待逾時：${expression}`); }
async function check(name, fn) { try { const detail = await fn(); report.cases.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
const metrics = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
const valid = () => ({ schema: 3, playerId: '11111111-1111-4111-8111-111111111111', best: null, sectors: [null, null, null], ghost: null, opts: { sound: false, fps: true, 'opt-frame-cap': '60' }, taxi: { money: 12345, trips: 7 }, tutDone: true, quality: 'low', touch: 'on' });
const broken = '{"taxi":{"money":12345},';
async function navigate({ raw = broken, snapshot = null, failGpu = false, search = '?circuit=australia&q=low&notraffic' } = {}) {
  if (initId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId });
  const seed = `followup-${++scenario}`;
  const injected = `
    window.__followupToken=crypto.randomUUID();window.__webglCalls=0;
    if(!sessionStorage.getItem(${JSON.stringify(seed)})){localStorage.clear();localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(raw)});${snapshot ? `localStorage.setItem(${JSON.stringify(KEY + '-last-good')},${JSON.stringify(JSON.stringify({ at: Date.now(), raw: JSON.stringify(snapshot) }))});` : ''}sessionStorage.setItem(${JSON.stringify(seed)},'1');}
    const nativeGetContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){if(String(kind).startsWith('webgl')){window.__webglCalls++;${failGpu ? "throw Error('fixture WebGL startup failure');" : ''}}return nativeGetContext.call(this,kind,...args)};
    const nativeRaf=requestAnimationFrame.bind(window);window.__manualFrames=false;
    window.requestAnimationFrame=(cb)=>{window.__testFrame=cb;if(window.__manualFrames)return 0;window.__testFrameId=nativeRaf(cb);return window.__testFrameId};
  `;
  initId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: injected })).identifier;
  await send('Page.navigate', { url: origin + search });
  await until(`!!window.__followupToken && sessionStorage.getItem(${JSON.stringify(seed)})==='1'`);
}
async function recoveryReady() { await until(`!!document.querySelector('#save-recovery')&&!document.querySelector('#save-recovery').classList.contains('hidden')`); }
async function clickReloading(id) { const token = await ev('window.__followupToken'); await ev(`document.getElementById(${JSON.stringify(id)}).click()`); await until(`!!window.__followupToken&&window.__followupToken!==${JSON.stringify(token)}&&window.__webglCalls>0`); }
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await metrics(390, 844);
  await check('壞raw啟動停在救援且不建WebGL/不覆寫；直橫向卡片不溢出、可捲且按鈕至少44px', async () => {
    await navigate(); await recoveryReady();
    assert.deepEqual(await ev(`({raw:localStorage.getItem('${KEY}'),calls:window.__webglCalls,gp:!!window.__gp,archive:localStorage.getItem('${KEY}-recovery-original')})`), { raw: broken, calls: 0, gp: false, archive: broken });
    for (const [width, height] of [[390, 844], [844, 390]]) {
      await metrics(width, height);
      const layout = await ev(`(() => {const c=document.querySelector('.recovery-card'),r=c.getBoundingClientRect();const buttons=[...c.querySelectorAll('button')].map(b=>{b.scrollIntoView({block:'nearest'});const q=b.getBoundingClientRect();return {id:b.id,width:q.width,height:q.height,top:q.top,bottom:q.bottom}});return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,card:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:c.clientWidth,scroll:c.scrollWidth,clientHeight:c.clientHeight,scrollHeight:c.scrollHeight,overflow:getComputedStyle(c).overflowY},buttons};})()`);
      report.layouts.push(layout); assert.ok(layout.documentWidth <= width + 1); assert.ok(layout.card.left >= -1 && layout.card.right <= width + 1); assert.ok(layout.card.scroll <= layout.card.client + 1); assert.equal(layout.card.overflow, 'auto');
      for (const b of layout.buttons) { assert.ok(b.width >= 44 && b.height >= 44, JSON.stringify(b)); assert.ok(b.top >= -1 && b.bottom <= height + 1, JSON.stringify(b)); }
      if (height === 390) assert.ok(layout.card.scrollHeight > layout.card.clientHeight, '矮螢幕應允許捲動');
    }
  });
  await check('取消建立新檔確認不覆寫，也不離開救援', async () => {
    acceptDialogs = false; const token = await ev('window.__followupToken'); await ev(`document.querySelector('#save-recovery-new').click()`);
    assert.equal(await ev(`localStorage.getItem('${KEY}')`), broken); assert.equal(await ev('window.__followupToken'), token); assert.equal(await ev('window.__webglCalls'), 0);
  });
  await check('取消恢復不寫入；確認恢復最近快照成功reload並保留錢包', async () => {
    await navigate({ snapshot: valid() }); await recoveryReady(); assert.equal(await ev(`document.querySelector('#save-recovery-restore').disabled`), false);
    acceptDialogs = false; await ev(`document.querySelector('#save-recovery-restore').click()`); assert.equal(await ev(`localStorage.getItem('${KEY}')`), broken);
    acceptDialogs = true; await clickReloading('save-recovery-restore');
    return await ev(`(() => {const value=JSON.parse(localStorage.getItem('${KEY}'));if(value.taxi.money!==12345)throw Error('錢包不符');if(!document.querySelector('#save-recovery').classList.contains('hidden'))throw Error('仍在救援');return {money:value.taxi.money,webglCalls:window.__webglCalls,archive:localStorage.getItem('${KEY}-recovery-original')};})()`);
  });
  await check('明確建立新進度成功reload，原始raw保留', async () => {
    await navigate(); await recoveryReady(); acceptDialogs = true; await clickReloading('save-recovery-new');
    const result = await ev(`({value:JSON.parse(localStorage.getItem('${KEY}')),archive:localStorage.getItem('${KEY}-recovery-original'),calls:window.__webglCalls})`);
    assert.equal(result.archive, broken); assert.equal(result.value.best, null); assert.deepEqual(result.value.opts, {}); assert.equal(result.value.taxi, undefined); assert.ok(result.calls > 0); return result;
  });
  await check('救援選擇自己的備份檔：取消不寫入、再次選檔確認後reload', async () => {
    await navigate(); await recoveryReady(); const token = await ev('window.__followupToken');
    const choose = () => ev(`(() => {const d=new DataTransfer();d.items.add(new File([${JSON.stringify(JSON.stringify({ app: 'taipei-gp', save: valid() }))}],'fixture-backup.json',{type:'application/json'}));const f=document.querySelector('#save-recovery-file');f.files=d.files;f.dispatchEvent(new Event('change'));})()`);
    acceptDialogs = false; await choose(); await until(`window.__followupToken===${JSON.stringify(token)}&&document.querySelector('#save-recovery-file').value===''`); await delay(100);
    assert.equal(await ev(`localStorage.getItem('${KEY}')`), broken);
    acceptDialogs = true; await choose(); await until(`window.__followupToken!==${JSON.stringify(token)}&&window.__webglCalls>0`);
    assert.equal(await ev(`JSON.parse(localStorage.getItem('${KEY}')).taxi.money`), 12345);
  });
  await check('WebGL初始getContext拋錯可見重試/低畫質重試，沒有__gp且低畫質重試保留賽道', async () => {
    await navigate({ raw: JSON.stringify(valid()), failGpu: true, search: '?circuit=australia&notraffic' }); await until(`!!document.querySelector('#boot-error')`);
    const result = await ev(`({gp:!!window.__gp,canvases:document.querySelectorAll('#app canvas').length,text:document.querySelector('#boot-tip').textContent,buttons:[...document.querySelectorAll('#boot-error button')].map(b=>({text:b.textContent,height:b.getBoundingClientRect().height}))})`);
    assert.equal(result.gp, false); assert.equal(result.canvases, 0); assert.match(result.text, /無法啟動 3D/); assert.deepEqual(result.buttons.map((b) => b.text), ['重試', '低畫質重試']); for (const b of result.buttons) assert.ok(b.height >= 44);
    const token = await ev('window.__followupToken'); await ev(`[...document.querySelectorAll('#boot-error button')].find(b=>b.textContent==='低畫質重試').click()`);
    await until(`window.__followupToken!==${JSON.stringify(token)}&&!!document.querySelector('#boot-error')`); const search = await ev('location.search'); assert.match(search, /q=low/); assert.match(search, /circuit=australia/); return { ...result, retriedSearch: search };
  });
  await check('正常遊戲30/60/unlimited即時套用真main渲染節流，reload保留且fps checkbox仍為boolean', async () => {
    await metrics(844, 390); await navigate({ raw: JSON.stringify(valid()) }); await until('!!window.__gp && !document.querySelector("#btn-start").disabled', 240000);
    await ev(`window.__gp.renderer.setPixelRatio(.15);window.__gp.renderer.setSize(160,90,false);window.__manualFrames=true;cancelAnimationFrame(window.__testFrameId);document.querySelector('#btn-start').click();document.querySelector('.cp-go:not(:disabled)').click();`);
    await until(`window.__gp.state==='countdown'||window.__gp.state==='race'`, 30000);
    const result = await ev(`(() => {const token=window.__followupToken,nativeNow=performance.now.bind(performance),start=nativeNow()+1000;window.__fixtureNow=start;Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__fixtureNow});let renders=0;const nativeRender=__gp.renderer.render;__gp.renderer.render=()=>{renders++};const samples=[];try{for(const cap of ['30','60','unlimited']){const el=document.querySelector('#opt-frame-cap');el.value=cap;el.dispatchEvent(new Event('change'));const first=renders;for(let k=0;k<120;k++){window.__fixtureNow+=1000/120;window.__testFrame(window.__fixtureNow)}samples.push({cap,renders:renders-first,stored:JSON.parse(localStorage.getItem('${KEY}')).opts['opt-frame-cap'],sameDocument:token===window.__followupToken});}}finally{delete performance.now;__gp.renderer.render=nativeRender;}return {samples,fps:JSON.parse(localStorage.getItem('${KEY}')).opts.fps,checkbox:document.querySelector('#opt-fps').checked};})()`);
    for (const sample of result.samples) { assert.equal(sample.stored, sample.cap); assert.equal(sample.sameDocument, true); assert.ok(Math.abs(sample.renders - (sample.cap === 'unlimited' ? 120 : Number(sample.cap))) <= 1, JSON.stringify(sample)); }
    assert.equal(result.fps, true); assert.equal(result.checkbox, true);
    const token = await ev('window.__followupToken'); await send('Page.reload'); await until(`window.__followupToken!==${JSON.stringify(token)}&&!!window.__gp`, 240000);
    const reloaded = await ev(`({cap:document.querySelector('#opt-frame-cap').value,fps:JSON.parse(localStorage.getItem('${KEY}')).opts.fps,checkbox:document.querySelector('#opt-fps').checked})`);
    assert.equal(reloaded.cap, 'unlimited'); assert.equal(reloaded.fps, true); assert.equal(reloaded.checkbox, true); return { ...result, reloaded };
  });
} catch (error) { report.cases.push({ name: '測試啟動', status: 'FAIL', error: error.stack }); }
finally {
  if (report.cases.some((c) => c.status === 'FAIL')) { try { const shot = await send('Page.captureScreenshot', { format: 'png' }); await mkdir(path.join(project, 'tools/dev-tests/shots'), { recursive: true }); await writeFile(path.join(project, 'tools/dev-tests/shots/followup-ui-browser.png'), Buffer.from(shot.data, 'base64')); } catch { /* 盡力留圖 */ } }
  report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
  await writeFile(path.join(project, 'tools/dev-tests/shots-followup-ui-browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); ws.close();
  if (report.summary.failed || report.exceptions.length || report.blockedExternalRequests.length) process.exitCode = 1;
}
