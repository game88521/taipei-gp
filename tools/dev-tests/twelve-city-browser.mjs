// external-browser.mjs <CDP> twelve-city-browser.mjs <expected-build> [http://127.0.0.1:<preview>]
// 由root排程；wrapper必須提供獨立context。只測本機正式dist。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const script = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(script), '../..');
const [port, expectedBuild, originArg] = process.argv.slice(2), origin = originArg ?? 'http://127.0.0.1:4318';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const sw = await readFile(path.join(root, 'dist/sw.js'), 'utf8'), build = sw.match(/const VERSION = '([^']+)'/)?.[1];
assert.ok(expectedBuild); assert.equal(build, expectedBuild); assert.equal(await (await fetch(origin + '/sw.js')).text(), sw);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); assert.equal(pages.length, 1, '必須使用external-browser獨立頁');
const target = pages.find((p) => p.type === 'page'); assert.ok(target);
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(target.webSocketDebuggerUrl).hostname));
const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let sequence = 0, currentCase = '啟動';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const files = ['src/main.ts', 'src/city-entry-intent.ts', 'src/city-guidance.ts', 'src/police-warning.ts', 'src/street-performance.ts',
  'src/streetrace.ts', 'src/street-series.ts', 'src/freecar.ts', 'src/vehicles.ts', 'src/router.ts', 'src/police.ts', 'index.html', 'src/style.css', 'dist/sw.js'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(path.join(root, file)))])));
const report = { origin, build, status: 'RUNNING', source: root, isolatedContext: true, playerStorageTouched: false, realPhone: false,
  cases: [], layouts: [], screenshots: [], exceptions: [], externalRequests: [], dialogs: [], sourceHashes: await hashes(), scriptSha256: hash(await readFile(script)),
  cleanup: { owner: 'external-browser.mjs', contextDisposal: '由wrapper finally在本腳本結束後執行' },
  limitations: ['真main/城市/Taxi/Police/StreetRace/UI；授權延遲為可控enableTilt Promise，不是手機系統授權視窗。',
    '導航先建真路線，再使用受控幾何/routeYs檢查轉向/層級；未代表全城市逐路口準確度。',
    '比賽以合法檢查點座標準備完賽狀態；未測真人駕駛平衡。手機尺寸為桌面Chrome模擬。'] };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method}逾時`)); }, 90000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ case: currentCase, text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
  if (m.method === 'Page.javascriptDialogOpening') { report.dialogs.push(m.params.message); void send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); }
  if (m.method === 'Fetch.requestPaused') {
    const url = new URL(m.params.request.url), allowed = url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol);
    if (!allowed) report.externalRequests.push(m.params.request.url);
    void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
  }
  const job = pending.get(m.id); if (!job) return; pending.delete(m.id); clearTimeout(job.timer);
  m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
ws.onclose = () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('CDP已斷線')); } pending.clear(); };
await new Promise((resolve, reject) => {
  if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
  if (ws.readyState !== WebSocket.CONNECTING) { reject(Error('CDP在開始前已關閉')); return; }
  const timer = setTimeout(() => reject(Error('CDP連線開啟逾時')), 20000);
  ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = (error) => { clearTimeout(timer); reject(error); };
});
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; }
async function until(expression, timeout = 240000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await ev(expression)) return; await delay(180); } throw Error('等待逾時：' + expression); }
async function check(name, fn) { currentCase = name; try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error) }); throw error; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const metrics = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
async function hit(selector) {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('找不到控制');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,width:r.width,height:r.height,disabled:e.disabled,hit:h===e||e.contains(h)}})()`);
  assert.ok(!r.disabled && r.width >= 44 && r.height >= 44 && r.hit, `${selector}: ${JSON.stringify(r)}`); return r;
}
async function trustedClick(selector) { const r = await hit(selector); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }); }
async function change(selector, value) { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`); }
async function screenshot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }), file = path.join(root, `tools/dev-tests/shots/twelve-city-${name}.png`); await writeFile(file, Buffer.from(r.data, 'base64')); report.screenshots.push(path.relative(root, file)); }
async function ready() { await until(`!!window.__gp&&!document.querySelector('#btn-free').disabled&&!!document.querySelector('#car-list button')`); await ev(`__gp.renderer.setAnimationLoop(null);__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(160,90,false)`); }
async function menu() {
  await ev(`(()=>{const g=__gp;if(g.sr?.active){g.sr.cancel();document.querySelector('#sr-result').classList.add('hidden')}if(g.taxi?.phase!=='off'){g.taxi?.abandon();g.checkpointTaxi()}g.police?.endPursuit('cancelled');if(g.state==='free')document.querySelector('#btn-pause').click();})()`);
  await click('.m-tabs [data-tab="play"]');
}
async function openEntry(kind) { await menu(); await click(kind === 'taxi' ? '#btn-taxi' : '#btn-duel'); await until(kind === 'taxi' ? `!document.querySelector('#taxi-order-page').classList.contains('hidden')&&!!document.querySelector('#taxi-orders button')` : `!document.querySelector('#duel-pick').classList.contains('hidden')&&!!document.querySelector('#duel-list button')`); }
async function armEntry(kind) {
  await ev(`(()=>{const g=__gp;window.__cityEntryTest={kind:${JSON.stringify(kind)},tilt:g.input.enableTilt,accept:g.taxi.acceptOrder,begin:g.sr.begin,attempts:0,starts:0,pending:false};const t=__cityEntryTest;g.input.enableTilt=()=>{t.pending=true;return new Promise(done=>t.resolve=done)};g.taxi.acceptOrder=function(...a){t.attempts++;return t.accept.apply(this,a)};g.sr.begin=function(...a){t.starts++;return t.begin.apply(this,a)};})()`);
  await change('#opt-steer', 'tilt');
}
async function releaseEntry() { await ev(`__cityEntryTest.resolve(true)`); await until(`!document.querySelector('#taxi-orders button:disabled')&&!document.querySelector('#duel-list button:disabled')`); }
async function restoreEntry() {
  await ev(`(()=>{const t=window.__cityEntryTest;if(!t)return;__gp.input.enableTilt=t.tilt;__gp.taxi.acceptOrder=t.accept;__gp.sr.begin=t.begin;delete window.__cityEntryTest})()`);
  await change('#opt-steer', 'buttons');
}
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); await metrics(844, 390);
  await mkdir(path.join(root, 'tools/dev-tests/shots'), { recursive: true });
  const seed = { schema: 3, playerId: '11111111-1111-4111-8111-111111111111', best: null, sectors: [null, null, null], ghost: null,
    opts: { sound: false, quali: false }, taxi: { money: 10000, trips: 2 }, tutDone: true, quality: 'low', touch: 'on', car: 'police' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__twelveCityToken=crypto.randomUUID();if(!sessionStorage.getItem('twelve-city-seed')){localStorage.clear();localStorage.setItem('taipei-gp-v2',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('twelve-city-seed','1')}` });
  await send('Page.navigate', { url: origin + '/?q=low&notraffic' }); await ready();
  await click('#btn-free'); await until(`__gp.state==='free'&&!!__gp.taxi&&!!__gp.sr&&!!__gp.police`);
  for (const kind of ['taxi', 'street']) {
    for (const cancel of ['back', 'escape', 'refresh']) await check(`3${kind}授權晚到:${cancel}取消後不啟動`, async () => {
      await openEntry(kind); await armEntry(kind); const selector = kind === 'taxi' ? '#taxi-orders button' : '#duel-list button';
      await trustedClick(selector); await until(`__cityEntryTest.pending`);
      assert.equal(await ev(`document.querySelector(${JSON.stringify(selector)}).disabled`), true);
      if (cancel === 'back') await trustedClick(kind === 'taxi' ? '#taxi-order-back' : '#duel-back');
      if (cancel === 'escape') { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }); }
      if (cancel === 'refresh') { if (kind === 'taxi') await trustedClick('#taxi-refresh-orders'); else await change('#duel-difficulty', 'easy'); }
      await releaseEntry(); const r = await ev(`({attempts:__cityEntryTest.attempts,starts:__cityEntryTest.starts,phase:__gp.taxi.phase,state:__gp.state})`);
      assert.equal(r.attempts, 0); assert.equal(r.starts, 0); assert.notEqual(r.state, 'free'); await restoreEntry();
      if (cancel === 'refresh') await click(kind === 'taxi' ? '#taxi-order-back' : '#duel-back'); return r;
    });
    await check(`3${kind}連點只接受一次且合法操作仍開始`, async () => {
      await openEntry(kind); await armEntry(kind); const selector = kind === 'taxi' ? '#taxi-orders button' : '#duel-list button';
      await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.click();e.click()})()`); await until(`__cityEntryTest.pending`); await releaseEntry();
      await until(`__gp.state==='free'`); const r = await ev(`({attempts:__cityEntryTest.attempts,starts:__cityEntryTest.starts,phase:__gp.taxi.phase})`);
      assert.equal(kind === 'taxi' ? r.attempts : r.starts, 1); await restoreEntry(); return r;
    });
  }
  await check('4真追緝HUD真倒數/回追清除，選配聲音去重', async () => {
    await menu(); await click('#btn-free'); await until(`__gp.state==='free'`); await ev(`__gp.updateFreeHud(.26)`); await trustedClick('#btn-pursuit'); await until(`!!__gp.police.suspect`);
    const r = await ev(`(()=>{const g=__gp,p=g.police;window.__cityOriginalBeep=g.sound.beep;window.__cityBeeps=[];g.sound.beep=(...v)=>__cityBeeps.push(v);p.suspectDistance=600;p.escapeT=5.3;g.updateFreeHud(.26);const text=document.querySelector('#wanted').textContent,cls=document.querySelector('#wanted').className,off=__cityBeeps.length;g.save.opts['city-pursuit-sound']=true;p.escapeT=6.1;g.updateFreeHud(.26);g.updateFreeHud(.26);const once=__cityBeeps.length;p.suspectDistance=440;g.updateFreeHud(.26);return {text,cls,off,once,cleared:document.querySelector('#wanted').textContent}})()`);
    assert.match(r.text, /跟丟倒數 2\.7 s/); assert.match(r.cls, /escape-urgent/); assert.equal(r.off, 0); assert.equal(r.once, 1); assert.doesNotMatch(r.cleared, /跟丟倒數/);
    await ev(`__gp.police.endPursuit('cancelled');__gp.sound.beep=__cityOriginalBeep;delete window.__cityOriginalBeep`); return r;
  });
  await check('11真setNav與HUD顯示轉向/路層、重規劃不重音、取消清除', async () => {
    const real = await ev(`(()=>{const g=__gp,target=g.taxi.places.find(p=>Math.hypot(p.x-g.fcar.x,p.z-g.fcar.z)>300);g.setNav(target.x,target.z,target.nm);g.updateFreeHud(.26);return {path:g.nav.path?.length,text:document.querySelector('#nav-hud').textContent}})()`);
    assert.ok(real.path > 1); assert.match(real.text, /道路|路段/);
    const r = await ev(`(()=>{const g=__gp,c=g.fcar,x=c.x,z=c.z,y=c.y+.25,n=g.nav;n.x=x+100;n.z=z+100;n.y=c.y;n.path=[[x,z],[x+100,z],[x+100,z+100]];n.ys=[y,y,y];n.t=0;g.save.opts['city-nav-sound']=true;window.__cityOriginalBeep=g.sound.beep;window.__cityBeeps=[];g.sound.beep=(...a)=>__cityBeeps.push(a);g.updateFreeHud(.26);const ground=document.querySelector('#nav-hud').textContent;n.path=n.path.map(p=>[...p]);g.updateFreeHud(.26);const beeps=__cityBeeps.length;c.y+=10;n.y+=10;n.ys=[y+10,y+10,y+10];g.updateFreeHud(.26);const high=document.querySelector('#nav-hud').textContent;c.y-=10;g.sound.beep=__cityOriginalBeep;delete window.__cityOriginalBeep;return {ground,high,beeps}})()`);
    assert.match(r.ground, /100 m 後右轉/); assert.match(r.high, /高架路段/); assert.equal(r.beeps, 1);
    await click('#map-clear'); await ev(`__gp.updateFreeHud(.26)`); assert.equal(await ev(`document.querySelector('#nav-hud').style.display`), 'none'); return { real, ...r };
  });
  await check('12同級車真選賽/性能/完賽分類紀錄，原版與舊紀錄保持', async () => {
    await openEntry('street'); await change('#duel-opponents', 'class'); await change('#duel-car-mode', 'selected'); await change('#duel-difficulty', 'standard');
    const preview = await ev(`document.querySelector('#duel-list button').textContent`); assert.match(preview, /同級性能/);
    await trustedClick('#duel-list button'); await until(`__gp.state==='free'&&__gp.sr.active`);
    const r = await ev(`(()=>{const g=__gp,s=g.sr,key=s.scopedRecordKey,original=key.replace('clear-class-v1','clear');g.save.street={legacy:99};g.save.streetChallenge??={};g.save.streetChallenge[original]={best:1,medal:'gold'};const car=s.options.carId,top=s.rivals[0].top,accel=s.rivals[0].accel;s.update(4,g.fcar,null);for(const cp of s.active.checkpoints){const p=s.active.path[cp];g.fcar.place(p[0],p[1],0);g.freeStep(.02)}for(let i=0;i<45&&g.state==='free';i++)g.freeStep(.02);return {key,car,top,accel,state:g.state,record:g.save.streetChallenge[key],original:g.save.streetChallenge[original],legacy:g.save.street,text:document.querySelector('#sr-res-sub').textContent}})()`);
    assert.match(r.key, /clear-class-v1/); assert.equal(r.car, 'police'); assert.ok(r.accel > 0); assert.equal(r.state, 'paused'); assert.ok(r.record.best > 0); assert.equal(r.original.best, 1); assert.deepEqual(r.legacy, { legacy: 99 }); assert.match(r.text, /同級性能/);
    await trustedClick('#sr-ok'); return { preview, ...r };
  });
  await check('11計程車使用同一任務路線顯示轉向且不重疊手動導航', async () => {
    await openEntry('taxi'); await trustedClick('#taxi-orders button'); await until(`__gp.state==='free'&&__gp.taxi.phase==='seek'`); await ev(`__gp.updateFreeHud(.26)`);
    const r = await ev(`({text:document.querySelector('#taxi-guidance').textContent,display:document.querySelector('#taxi-guidance').style.display,manual:document.querySelector('#nav-hud').style.display,target:__gp.taxi.target.nm})`);
    assert.match(r.text, /接客/); assert.match(r.text, /道路|路段/); assert.equal(r.display, ''); assert.equal(r.manual, 'none'); return r;
  });
  await check('手機尺寸控制可達與HUD順序，音效偏好經UI保存', async () => {
    for (const [width, height] of [[844, 390], [844, 220], [390, 844]]) {
      await metrics(width, height); await ev(`__gp.updateFreeHud(.26)`);
      const layout = await ev(`(()=>{const ids=['taxi-hud','nav-hud','wanted'],rects=ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,x:r.x,y:r.y,w:r.width,h:r.height,visible:getComputedStyle(e).display!=='none'&&!e.classList.contains('hidden')}});return {rects,viewport:{w:innerWidth,h:innerHeight}}})()`);
      for (const r of layout.rects.filter((r) => r.visible)) assert.ok(r.x >= -1 && r.x + r.w <= width + 1 && r.y + r.h <= height + 1, JSON.stringify(layout));
      report.layouts.push({ width, height, ...layout }); await screenshot(`${width}x${height}`);
      await menu(); await click('.m-tabs [data-tab="settings"]');
      for (const id of ['city-pursuit-sound', 'city-nav-sound']) await hit(`label:has(#${id})`);
      await click('.m-tabs [data-tab="play"]'); await click('#btn-duel'); await until(`!document.querySelector('#duel-pick').classList.contains('hidden')`);
      await hit('#duel-opponents'); await hit('#duel-car-mode'); await trustedClick('#duel-back');
      await click('#btn-free'); await until(`__gp.state==='free'`);
    }
    await menu(); await click('.m-tabs [data-tab="settings"]');
    await ev(`for(const id of ['city-pursuit-sound','city-nav-sound']){const e=document.getElementById(id);e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))}`);
    const stored = await ev(`JSON.parse(localStorage.getItem('taipei-gp-v2')).opts`); assert.equal(stored['city-pursuit-sound'], true); assert.equal(stored['city-nav-sound'], true);
    return stored;
  });
  assert.deepEqual(report.exceptions, []); assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.dialogs, []);
} catch (error) {
  report.failure = String(error.stack ?? error); if (!report.cases.some((c) => c.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: report.failure }); await screenshot('failure').catch(() => {});
} finally {
  await ev(`(()=>{const g=window.__gp;if(!g)return;if(window.__cityEntryTest){const t=__cityEntryTest;t.resolve?.(false);g.input.enableTilt=t.tilt;g.taxi.acceptOrder=t.accept;g.sr.begin=t.begin;delete window.__cityEntryTest}if(window.__cityOriginalBeep){g.sound.beep=__cityOriginalBeep;delete window.__cityOriginalBeep}g.renderer.setAnimationLoop(null)})()`).then(() => { report.cleanup.overridesRestored = true; }, (e) => { report.cleanup.overrideError = String(e); });
  report.sourceHashesAfter = await hashes(); const unchanged = JSON.stringify(report.sourceHashesAfter) === JSON.stringify(report.sourceHashes) && hash(await readFile(script)) === report.scriptSha256;
  report.cases.push({ name: '正式build/來源/腳本測試期間未變', status: unchanged ? 'PASS' : 'FAIL' });
  report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
  report.status = report.summary.failed || report.exceptions.length || report.externalRequests.length || !report.cleanup.overridesRestored ? 'FAIL' : 'PASS';
  await writeFile(path.join(root, 'tools/dev-tests/twelve-city-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, build, summary: report.summary, exceptions: report.exceptions, externalRequests: report.externalRequests, cleanup: report.cleanup })); ws.close();
  if (report.status !== 'PASS') process.exitCode = 1;
}
