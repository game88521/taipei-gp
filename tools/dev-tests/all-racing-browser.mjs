// node tools/dev-tests/external-browser.mjs 9333 all-racing-browser.mjs [expected-build]
// 隔離context、本機dist；排位用真step推進超時，回放由真BOT GP產生。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:4317', port = process.argv[2];
const build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
if (process.argv[3]) assert.equal(build, process.argv[3]);
const report = { origin, build, externalChrome: true, isolatedContext: true, playerStorageTouched: false, realPhone: false, cases: [], layouts: [], exceptions: [], blockedExternalRequests: [],
  limitations: ['本機桌面Chrome模擬390×844／844×390／844×220，沒有手機實機驗證。', '排位玩家以煞車停住並用真step推進150秒超時，驗證1/2/3次與AI進度；未驗證手動排位圈速。', 'E/H使用真BOT GP記錄；降低canvas解析度但保留真DOM/WebGL，不量FPS、音質或估算區間涵蓋率。'] };
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
assert.equal(pages.length, 1, '只接受external-browser建立的單一隔離分頁');
const target = pages.find((p) => p.type === 'page'); assert.ok(target);
const ws = new WebSocket(target.webSocketDebuggerUrl), jobs = new Map(); let seq = 0, currentCase = '啟動';
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { jobs.delete(id); reject(Error(`${method}逾時`)); }, 90000); jobs.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ case: currentCase, text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
  if (m.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  if (m.method === 'Fetch.requestPaused') {
    const u = new URL(m.params.request.url), local = u.origin === origin || ['about:', 'data:', 'blob:'].includes(u.protocol);
    if (!local) report.blockedExternalRequests.push(m.params.request.url);
    void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
  }
  const job = jobs.get(m.id); if (!job) return; clearTimeout(job.timer); jobs.delete(m.id); m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
ws.onclose = () => { for (const j of jobs.values()) { clearTimeout(j.timer); j.reject(Error('CDP斷線')); } jobs.clear(); };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; }
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expression, ms = 180000) { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expression)) return; await delay(200); } throw Error(`等待逾時：${expression}`); }
async function check(name, action) { currentCase = name; try { report.cases.push({ name, status: 'PASS', detail: await action() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); throw e; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
async function ready() { await until('!!window.__gp&&!!__gp.save&&!!__gp.sessionLaps&&!document.querySelector("#btn-start").disabled', 240000); await ev('__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false)'); }
async function navigate(query) { await send('Page.navigate', { url: `${origin}/?${query}` }); await ready(); }
async function stopFrames() { await ev('window.__allRacingManual=true;cancelAnimationFrame(window.__allRacingFrameId);__gp.sound.started=false'); }
async function screenshot(name) { const shot = await send('Page.captureScreenshot', { format: 'png' }); await mkdir(path.join(project, 'tools/dev-tests/shots'), { recursive: true }); await writeFile(path.join(project, `tools/dev-tests/shots/all-racing-${name}.png`), Buffer.from(shot.data, 'base64')); }
async function layouts(panel, controls, label) {
  for (const [width, height] of [[390, 844], [844, 390], [844, 220]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    const result = await ev(`(() => {const panel=document.querySelector(${JSON.stringify(panel)});const r=panel.getBoundingClientRect();const controls=[...document.querySelectorAll(${JSON.stringify(controls)})].map(el=>{el.scrollIntoView({block:'nearest',inline:'nearest'});const q=el.getBoundingClientRect();return {id:el.id||el.textContent.slice(0,25),width:q.width,height:q.height,top:q.top,bottom:q.bottom}});return {label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,panel:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,clientHeight:panel.clientHeight,scrollHeight:panel.scrollHeight},controls}})()`);
    report.layouts.push(result); assert.ok(result.documentWidth <= width + 1, JSON.stringify(result));
    assert.ok(result.panel.left >= -1 && result.panel.right <= width + 1, JSON.stringify(result.panel));
    for (const c of result.controls) { assert.ok(c.width >= 44 && c.height >= 44, JSON.stringify(c)); assert.ok(c.top >= -1 && c.bottom <= height + 1, JSON.stringify(c)); }
    await screenshot(`${label}-${width}x${height}`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  assert.ok((await send('Target.getTargetInfo')).targetInfo.browserContextId, '拒絕在玩家／預設context執行');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__allRacingToken=crypto.randomUUID();window.__allRacingManual=false;
    if(!localStorage.getItem('taipei-gp-v2'))localStorage.setItem('taipei-gp-v2',JSON.stringify({schema:3,playerId:'11111111-1111-4111-8111-111111111111',best:null,sectors:[null,null,null],ghost:null,opts:{sound:false,quali:true},taxi:{money:1000,trips:0},tutDone:true,quality:'low',touch:'on'}));
    const nativeRaf=requestAnimationFrame.bind(window);window.requestAnimationFrame=(callback)=>{window.__allRacingFrame=callback;if(window.__allRacingManual)return 0;window.__allRacingFrameId=nativeRaf(callback);return window.__allRacingFrameId};
  ` });
  await navigate('circuit=australia&q=low&notraffic');
  await check('G 新賽季對話框：三種手機尺寸可選長度與開始／取消', async () => {
    await ev('delete __gp.save.season;document.querySelector("#btn-season").click()');
    await layouts('#season-new .card', '#sn-length,#sn-go,#sn-cancel', 'season-new');
    await ev('document.querySelector("#sn-cancel").click()');
  });
  for (const length of [3, 6, 12, 23]) await check(`G 真UI建立${length}站、重載實際賽曆及季內排位鎖定`, async () => {
    const token = await ev('window.__allRacingToken');
    await ev(`delete __gp.save.season;document.querySelector('#btn-season').click();document.querySelector('#sn-length').value='${length}';document.querySelector('#sn-go').click()`);
    await until(`window.__allRacingToken!==${JSON.stringify(token)}`); await ready();
    const value = await ev(`(() => {document.querySelector('#btn-season-table').click();document.querySelector('#season-tabs [data-tab="rounds"]').click();return {calendar:__gp.save.season.calendar,stored:JSON.parse(localStorage.getItem('taipei-gp-v2')).season.calendar,banner:document.querySelector('#season-banner').textContent,attempts:{disabled:document.querySelector('#opt-quali-attempts').disabled,value:document.querySelector('#opt-quali-attempts').value},roundRows:document.querySelectorAll('#season-rounds tr').length}})()`);
    assert.equal(value.calendar.length, length); assert.equal(new Set(value.calendar).size, length); assert.deepEqual(value.stored, value.calendar); assert.equal(value.roundRows, length + 1);
    assert.ok(value.banner.includes(`/ ${length} 站`)); assert.equal(value.attempts.disabled, true); assert.equal(value.attempts.value, '1');
    await ev('document.querySelector("#season-close").click()'); return value;
  });
  await navigate('circuit=australia&q=low&notraffic'); await stopFrames();
  for (const attempts of [1, 2, 3]) await check(`N 真UI${attempts}次：玩家150秒超時、AI等次數進度、無有效圈排最後`, async () => {
    await ev(`(() => {const q=document.querySelector('#opt-quali');q.checked=true;q.dispatchEvent(new Event('change'));const select=document.querySelector('#opt-quali-attempts');select.value='${attempts}';select.dispatchEvent(new Event('change'));document.querySelector('#btn-gp').click();document.querySelector('.cp-go:not(:disabled)').click()})()`);
    await until('__gp.qualiRun');
    await ev('__gp.input.read=()=>({steer:0,brake:true,throttle:false})');
    for (let batch = 0; batch < attempts * 11 + 2 && await ev('__gp.qualiRun'); batch++) await ev('for(let i=0;i<1800&&__gp.qualiRun;i++)__gp.step(1/120)');
    await until(`__gp.state==='results'&&document.querySelector('#quali-sub').textContent.includes('各 ${attempts} 次')`, 180000);
    const value = await ev(`({title:document.querySelector('#quali-title').textContent,subtitle:document.querySelector('#quali-sub').textContent,rows:document.querySelectorAll('#quali-table tr').length,player:document.querySelector('#quali-table .me').textContent,progress:{max:document.querySelector('#quali-progress').max,value:document.querySelector('#quali-progress').value},laps:__gp.sessionLaps.rows()})`);
    assert.equal(value.rows, 23); assert.ok(value.player.includes('無有效圈')); assert.equal(value.progress.max, 21 * attempts); assert.equal(value.progress.value, 21 * attempts); assert.equal(value.laps.length, attempts); assert.ok(value.laps.every((r) => !r.valid));
    await ev('document.querySelector("#quali-menu").click()'); return { ...value, laps: value.laps.map((r) => ({ lap: r.lap, valid: r.valid, time: r.time })) };
  });
  await check('E 真BOT GP有效圈產生圈表、分段與穩定度DOM', async () => {
    await navigate('bot&gp&sim=400&scat=35&q=low&notraffic');
    await until(`__gp.state==='results'&&document.title.startsWith('GP')`, 240000); await stopFrames();
    const value = await ev(`({title:document.title,rows:__gp.sessionLaps.rows(),summary:__gp.sessionLaps.summary(),tableRows:document.querySelectorAll('#lap-history-body tr').length,text:document.querySelector('#lap-history-summary').textContent,replayLength:__gp.field.replayLength,events:__gp.field.replayEvents})`);
    assert.ok(value.summary.validCount >= 1); assert.ok(value.summary.best > 20); assert.equal(value.tableRows, value.rows.length + 1); assert.ok(value.text.includes('標準差')); assert.ok(value.replayLength > 10); assert.ok(value.events.some((e) => e.type === 'sc-out')); return value;
  });
  await check('H 真回放DOM：暫停、±5秒、倒退seek、車手／鏡頭與事件定位，不改物理', async () => {
    await ev(`window.__allRacingFinal=JSON.stringify(__gp.field.snapshot());document.querySelector('#btn-replay').click();document.querySelector('#replay-pause').click()`);
    assert.equal(await ev('__gp.replayPaused'), true);
    await ev(`(() => {const seek=document.querySelector('#replay-seek');seek.value='10';seek.dispatchEvent(new Event('input'))})()`); assert.equal(await ev('__gp.replayT'), 10);
    await ev(`document.querySelector('#replay-forward').click()`); assert.equal(await ev('__gp.replayT'), 15);
    await ev(`document.querySelector('#replay-back').click()`); assert.equal(await ev('__gp.replayT'), 10);
    const value = await ev(`(() => {const driver=document.querySelector('#replay-driver');driver.value=__gp.field.racers[0].name;driver.dispatchEvent(new Event('change'));const camera=document.querySelector('#replay-camera');camera.value='chase';camera.dispatchEvent(new Event('change'));const chase=__gp.camera.fov;camera.value='heli';camera.dispatchEvent(new Event('change'));document.querySelector('#replay-events button').click();return {drivers:driver.options.length,follow:document.querySelector('#replay-time').textContent,driver:driver.value,chase,heli:__gp.camera.fov,time:__gp.replayT,event:__gp.field.replayEvents[0],same:JSON.stringify(__gp.field.snapshot())===window.__allRacingFinal}})()`);
    assert.equal(value.drivers, 22); assert.ok(value.follow.includes(value.driver)); assert.equal(value.chase, 65); assert.equal(value.heli, 50); assert.ok(Math.abs(value.time - value.event.time) <= .05); assert.equal(value.same, true); return value;
  });
  await check('H 回放控制在390×844／844×390／844×220可捲動觸達', async () => {
    await layouts('#replay-ui', '#replay-pause,#replay-back,#replay-forward,#replay-driver,#replay-camera,#replay-end', 'replay');
  });
  await check('H 尾端維持回放暫停，退出還原最終物理', async () => {
    await ev(`(() => {const seek=document.querySelector('#replay-seek');seek.value=seek.max;seek.dispatchEvent(new Event('input'))})()`);
    assert.equal(await ev('__gp.state'), 'replay'); assert.equal(await ev('__gp.replayPaused'), true);
    await ev('document.querySelector("#replay-end").click()');
    assert.equal(await ev('__gp.state'), 'results'); assert.equal(await ev('JSON.stringify(__gp.field.snapshot())===window.__allRacingFinal'), true);
  });
  await check('F 真GP策略明細：完整損失／本下圈比較／出站名次區間及假設', async () => {
    await ev('document.querySelector("#btn-again").click()'); await until('__gp.state === "countdown"');
    await ev('document.querySelector("#gp-strategy").open=true;for(let i=0;i<12;i++)window.__allRacingFrame(performance.now())');
    const text = await ev('document.querySelector("#strategy-detail").textContent');
    assert.ok(text.includes('完整損失')); assert.ok(text.includes('下圈進站')); assert.ok(text.includes('估計出站 P')); assert.ok(text.includes('對手未來進站')); return { text };
  });
} catch (e) { if (!report.cases.some((r) => r.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: e.stack }); try { await screenshot('failure'); } catch {} }
finally {
  report.summary = { passed: report.cases.filter((r) => r.status === 'PASS').length, failed: report.cases.filter((r) => r.status === 'FAIL').length };
  await writeFile(path.join(project, 'tools/dev-tests/shots-all-racing-browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); ws.close();
  if (report.summary.failed || report.exceptions.length || report.blockedExternalRequests.length) process.exitCode = 1;
}
