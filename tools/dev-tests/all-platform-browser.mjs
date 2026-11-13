// node tools/dev-tests/external-browser.mjs 9333 all-platform-browser.mjs
// 僅使用 wrapper 的單一新隔離分頁，不連其他target、不讀寫玩家資料、不使用正式站。
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), origin = 'http://127.0.0.1:4317', port = process.argv[2];
const KEY = 'taipei-gp-v2', GOOD = KEY + '-last-good', ORIGINAL = KEY + '-recovery-original';
const game = origin + '/?q=low&notraffic', controlUrl = origin + '/__all_platform_control__';
const build = (await readFile(resolve(root, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
assert.match(build ?? '', /^[a-f0-9]{12}$/);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
assert.equal(targets.length, 1, '只能由 external-browser 的單分頁wrapper執行');
const target = targets[0]; assert.equal(target.type, 'page');
const socketUrl = new URL(target.webSocketDebuggerUrl); assert.ok(['127.0.0.1', 'localhost'].includes(socketUrl.hostname));
const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let seq = 0, currentCase = '初始化', acceptDialog = false;
const report = { origin, build, externalChrome: true, isolatedContext: true, wrapperPageOnly: true, playerStorageTouched: false, realPhone: false, cases: [], exceptions: [], dialogs: [], blockedExternalRequests: [], managerRequests: [], screenshots: [],
  limitations: ['桌面Chrome真SW/CacheStorage/WebAudio與手機viewport；尚未驗證手機實機權限、傾斜硬體與聲音聽感。', 'V使用原生DeviceOrientationEvent注入測試，X注入建構失敗後還原真AudioContext。', '停止測試分頁的3D動畫以降低負載；沒有測量FPS、耗電或完整物理。'] };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} 逾時`)); }, 90000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ case: currentCase, text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
  if (m.method === 'Page.javascriptDialogOpening') {
    const accept = acceptDialog; report.dialogs.push({ case: currentCase, message: m.params.message, accepted: accept });
    void send('Page.handleJavaScriptDialog', { accept }).catch(() => {});
  }
  if (m.method === 'Fetch.requestPaused') {
    const request = m.params.request, u = new URL(request.url), local = u.origin === origin || ['data:', 'blob:', 'about:'].includes(u.protocol);
    if (u.href === controlUrl) {
      void send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from('<!doctype html><meta charset="utf-8"><title>平台隔離控制頁</title>').toString('base64') }).catch(() => {});
    } else {
      if (!local) report.blockedExternalRequests.push({ case: currentCase, url: request.url });
      const management = Object.entries(request.headers).some(([k, value]) => k.toLowerCase() === 'x-taipei-gp-offline-download' && String(value) === '1');
      if (management) report.managerRequests.push({ url: request.url, local });
      void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
    }
  }
  const job = pending.get(m.id); if (!job) return;
  pending.delete(m.id); clearTimeout(job.timer); m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result);
};
ws.onclose = () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('CDP 已斷線')); } pending.clear(); };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ev(expression, gesture = false) {
  new Script(expression); // 先檢查送進瀏覽器的內嵌JS，不把runner跳脫錯誤誤報為產品exception。
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
async function until(expression, ms = 180000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await ev(expression)) return; } catch (error) { if (!/context|navigation|Cannot find/i.test(error.message)) throw error; }
    await delay(300);
  }
  throw Error(`等待逾時：${expression}`);
}
async function check(name, fn) {
  currentCase = name;
  try { const details = await fn(); report.cases.push({ name, status: 'PASS', ...(details ? { details } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }), file = `tools/dev-tests/shots/all-platform-${name}.png`;
  await mkdir(resolve(root, 'tools/dev-tests/shots'), { recursive: true }); await writeFile(resolve(root, file), Buffer.from(data, 'base64')); report.screenshots.push(file);
}
async function ready() {
  await until('!!window.__gp && !document.querySelector("#btn-free").disabled', 240000);
  await ev('__gp.renderer.setPixelRatio(.15);__gp.renderer.setSize(128,72,false);__gp.renderer.setAnimationLoop(null)');
}
const managerButton = (text) => `[...document.querySelectorAll('#offline-manager button')].find(b=>b.textContent===${JSON.stringify(text)})`;
const managerStatus = 'document.querySelector("#offline-manager [role=status]").textContent';
const coreKeys = `(async()=>{const c=await caches.open(window.__allCache);return(await c.keys()).map(r=>new URL(r.url).pathname).filter(p=>!p.startsWith('/data/tiles/')).sort()})()`;
let selectedIndex = -1, selectedTileUrls = [], coreBefore, selectedLabel;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const info = (await send('Target.getTargetInfo')).targetInfo; assert.ok(info.browserContextId, '拒絕使用玩家預設context'); report.contextVerified = true;
  await send('Page.bringToFront'); await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__allToken=crypto.randomUUID();window.__allWebgl=0;window.__allNativeAudioContext=window.AudioContext;window.__allNativeWebkit=window.webkitAudioContext;const native=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(String(kind).startsWith('webgl'))window.__allWebgl++;return native.call(this,kind,...args)};` });
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Page.navigate', { url: controlUrl });
  await until(`location.href===${JSON.stringify(controlUrl)}&&document.title==='平台隔離控制頁'`);
  const seed = { schema: 3, playerId: '11111111-1111-4111-8111-111111111111', best: null, sectors: [null, null, null], ghost: null, opts: { sound: true }, taxi: { money: 12345, trips: 7 }, tilt: { inv: false, zero: 20, dead: 2 }, tutDone: true, quality: 'low', touch: 'on', car: 'sedan' };
  await ev(`localStorage.clear();localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify(seed))})`);
  await send('Network.setBypassServiceWorker', { bypass: false }); await send('Page.navigate', { url: game }); await ready();
  await check('Q 真SW控制本機分頁，完整本版核心與SHA manifest可列九區', async () => {
    await until('!!navigator.serviceWorker.controller', 120000);
    const version = await ev(`(async()=>{const worker=navigator.serviceWorker.controller,channel=new MessageChannel();return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SW version timeout')),5000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data)};worker.postMessage({type:'taipei-gp-offline-version'},[channel.port2])})})()`);
    assert.equal(version.ready, true); assert.equal(version.version, build); assert.equal(version.cache, `taipei-gp-${build}`);
    await ev(`window.__allCache=${JSON.stringify(version.cache)};document.querySelector('[data-tab="settings"]').click();document.querySelector('#offline-manager').closest('details').open=true;${managerButton('重新整理')}.click()`);
    await until('document.querySelectorAll("#offline-manager input[type=checkbox]").length===9');
    const manifest = await ev(`(async()=>{const cache=await caches.open(window.__allCache),hashes=await(await cache.match('/data/offline-tiles.json')).json(),city=await(await cache.match('/data/city.json')).json();window.__allIntegrity=hashes.files;window.__allCityIndex=city.tiles;return{tiles:city.tiles.list.length,hashes:Object.keys(hashes.files).length,rows:[...document.querySelectorAll('#offline-manager label')].map(e=>e.textContent),ready:!!await cache.match('/__taipei-gp-offline-ready__'),core:!!await cache.match('/')}})()`);
    assert.equal(manifest.tiles, manifest.hashes); assert.equal(manifest.ready, true); assert.equal(manifest.core, true); assert.equal(manifest.rows.length, 9); return { version, ...manifest };
  });
  await check('X AudioContext建構失敗仍能進自由駕駛，錯誤狀態可見', async () => {
    await ev(`window.AudioContext=class{constructor(){throw new DOMException('平台回歸注入音訊失敗','NotSupportedError')}};window.webkitAudioContext=undefined;document.querySelector('[data-tab="play"]').click();document.querySelector('#btn-free').click()`);
    await until('window.__gp.state==="free"', 120000);
    assert.equal(await ev('__gp.sound.started'), false);
    await ev(`document.querySelector('#btn-pause').click();document.querySelector('[data-tab="settings"]').click()`);
    await until('document.querySelector("#sound-tools [role=status]").textContent.includes("無法啟動")');
    return await ev(`({state:__gp.state,status:__gp.sound.getStatus(),visible:document.querySelector('#sound-tools [role=status]').textContent})`);
  });
  await check('S 還原真AudioContext後以UI重試成功，五類試聽連到真音訊且不改存檔音量', async () => {
    await ev(`window.AudioContext=window.__allNativeAudioContext;window.webkitAudioContext=window.__allNativeWebkit;[...document.querySelectorAll('#sound-tools button')].find(b=>b.textContent==='重新啟用音效').click()`, true);
    await until('__gp.sound.started && __gp.sound.getStatus().status==="running"', 30000);
    await until('document.querySelector("#sound-tools [role=status]").textContent.includes("正常")', 10000);
    const result = await ev(`(()=>{const sound=__gp.sound,preview=sound.preview.bind(sound),vol=JSON.stringify(sound.vol),raw=localStorage.getItem('${KEY}');window.__allPreview=[];sound.preview=(kind)=>{const ok=preview(kind);window.__allPreview.push({kind,ok});return ok};for(const button of document.querySelectorAll('#sound-tools button'))if(button.textContent.startsWith('試聽'))button.click();return{previews:window.__allPreview,unchangedVol:JSON.stringify(sound.vol)===vol,unchangedSave:localStorage.getItem('${KEY}')===raw,status:sound.getStatus()}})()`, true);
    assert.deepEqual(result.previews.map((p) => p.kind).sort(), ['ambient', 'engine', 'fx', 'master', 'others']); assert.ok(result.previews.every((p) => p.ok)); assert.equal(result.unchangedVol, true); assert.equal(result.unchangedSave, true); return result;
  });
  await check('V 感測無效時安全回正且不存校正；有效事件才能校正，過期回正', async () => {
    await ev(`document.querySelector('#opt-steer').value='tilt';document.querySelector('#opt-steer').dispatchEvent(new Event('change'));window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:null,gamma:null}))`);
    await until('document.querySelector("#tilt-tools button:nth-of-type(2)").disabled', 10000);
    const unsafe = await ev(`(()=>{const raw=localStorage.getItem('${KEY}');document.querySelector('#opt-tilt-zero').click();return{state:__gp.input.getTiltState(),steer:__gp.input.read().steer,unchanged:localStorage.getItem('${KEY}')===raw,message:document.querySelector('#tilt-tools [role=status]').textContent}})()`);
    assert.equal(unsafe.steer, 0); assert.equal(unsafe.unchanged, true); assert.equal(unsafe.state.canCalibrate, false);
    await ev(`window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:25,gamma:25}))`);
    await until('!document.querySelector("#tilt-tools button:nth-of-type(2)").disabled', 10000);
    const calibrated = await ev(`(()=>{const raw=__gp.input.tiltRaw;document.querySelector('#tilt-tools button:nth-of-type(2)').click();return{raw,zero:__gp.input.tiltZero,saved:JSON.parse(localStorage.getItem('${KEY}')).tilt.zero}})()`);
    assert.equal(calibrated.zero, Math.round(calibrated.raw)); assert.equal(calibrated.saved, calibrated.zero);
    await until('__gp.input.getTiltState().status==="stale"', 10000); assert.equal(await ev('__gp.input.read().steer'), 0); return { unsafe, calibrated, stale: await ev('__gp.input.getTiltState()') };
  });
  await check('Q 從UI選小區、實際下載並驗SHA，重新整理仍完整且核心不動', async () => {
    await ev(`document.querySelector('#offline-manager').closest('details').open=true`);
    const selected = await ev(String.raw`(()=>{const labels=[...document.querySelectorAll('#offline-manager label')].map((e,i)=>({index:i,text:e.textContent,total:Number(e.textContent.match(/已驗證\s*\d+\/(\d+)/)?.[1]??9999)})).sort((a,b)=>a.total-b.total),chosen=labels[0],list=window.__allCityIndex.list,minX=Math.min(...list.map(t=>t[0])),spanX=Math.max(...list.map(t=>t[0]))-minX+1,minZ=Math.min(...list.map(t=>t[1])),spanZ=Math.max(...list.map(t=>t[1]))-minZ+1,row=chosen.text.startsWith(' 北部')?0:chosen.text.startsWith(' 中部')?1:2,col=chosen.text.includes('西區')?0:chosen.text.includes('中區')?1:2,urls=list.filter(([x,z])=>Math.min(2,Math.floor((x-minX)*3/spanX))===col&&Math.min(2,Math.floor((z-minZ)*3/spanZ))===row).map(([x,z])=>'/data/tiles/'+x+'_'+z+'.json');const check=document.querySelectorAll('#offline-manager input')[chosen.index];check.checked=true;check.dispatchEvent(new Event('change'));return{...chosen,urls}})()`);
    selectedIndex = selected.index; selectedTileUrls = selected.urls; selectedLabel = selected.text; assert.equal(selectedTileUrls.length, selected.total); assert.ok(selected.total > 0);
    coreBefore = await ev(coreKeys); assert.ok(coreBefore.includes('/') && coreBefore.includes('/__taipei-gp-offline-ready__'));
    // 暫停真Cache.delete觀察刪除中的按鈕；不改產品，只延後完成此測試的第一筆刪除。
    await ev(`window.__allNativeCacheDelete=Cache.prototype.delete;window.__allDeleteRelease=null;Cache.prototype.delete=async function(...args){await new Promise(resolve=>window.__allDeleteRelease=resolve);return window.__allNativeCacheDelete.apply(this,args)}`);
    acceptDialog = true; await ev(`${managerButton('刪除選區')}.click()`); await until('typeof window.__allDeleteRelease==="function"', 10000);
    const deletingCancelDisabled = await ev(`${managerButton('取消下載')}.disabled`);
    await ev('Cache.prototype.delete=window.__allNativeCacheDelete;window.__allDeleteRelease()');
    assert.equal(deletingCancelDisabled, true, '刪除中沒有下載可取消，取消下載按鈕應停用');
    await until(`${managerStatus}.includes('已刪除')`); acceptDialog = false;
    await until(`!${managerButton('下載選區')}.disabled`); const requestsBefore = report.managerRequests.length;
    await ev(`${managerButton('下載選區')}.click()`); await until(`${managerStatus}.startsWith('下載完成')`, 120000);
    const downloaded = await ev(`(async()=>{const c=await caches.open(window.__allCache),urls=${JSON.stringify(selectedTileUrls)},out=[];for(const url of urls){const response=await c.match(url),body=response?await response.arrayBuffer():null,hex=body?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),n=>n.toString(16).padStart(2,'0')).join(''):null,want=window.__allIntegrity[url];out.push({url,bytes:body?.byteLength,verified:!!body&&body.byteLength===want.bytes&&hex===want.sha256})}return out})()`);
    assert.equal(downloaded.length, selected.total); assert.ok(downloaded.every((tile) => tile.verified)); assert.ok(report.managerRequests.length > requestsBefore, '必須有真正的管理下載request'); assert.deepEqual(await ev(coreKeys), coreBefore);
    await ev(`${managerButton('重新整理')}.click()`); await until('document.querySelectorAll("#offline-manager input").length===9');
    await until(`document.querySelectorAll('#offline-manager label')[${selectedIndex}].textContent.includes('${selected.total}/${selected.total}')`);
    await until(`${managerStatus}.startsWith('請選擇')&&!${managerButton('重新整理')}.disabled`);
    await ev(`document.querySelector('#offline-manager').closest('details').scrollIntoView({block:'start'})`);
    await screenshot('offline-complete'); return { selected: selectedLabel, downloaded, requests: report.managerRequests.length - requestsBefore, deletingCancelDisabled, refreshed: await ev(`document.querySelectorAll('#offline-manager label')[${selectedIndex}].textContent`) };
  });
  await check('Q 真網路offline仍可經SW讀已下載區塊；UI刪區保留核心及存檔', async () => {
    const tile = selectedTileUrls[0]; await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    try {
      const result = await ev(`(async()=>{const r=await fetch(${JSON.stringify(tile + '?offline-browser-check=1')},{cache:'no-store'}),b=await r.arrayBuffer();return{ok:r.ok,bytes:b.byteLength,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join(''),want:window.__allIntegrity[${JSON.stringify(tile)}]}})()`);
      assert.equal(result.ok, true); assert.equal(result.bytes, result.want.bytes); assert.equal(result.hash, result.want.sha256); report.offlineTile = { url: tile, bytes: result.bytes, verified: true };
    } finally { await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
    const raw = await ev(`localStorage.getItem('${KEY}')`); acceptDialog = true; await ev(`${managerButton('刪除選區')}.click()`); await until(`${managerStatus}.includes('已刪除')`); acceptDialog = false;
    const remaining = await ev(`(async()=>{const c=await caches.open(window.__allCache);return Promise.all(${JSON.stringify(selectedTileUrls)}.map(async u=>({url:u,exists:!!await c.match(u)})))})()`);
    assert.ok(remaining.every((tile) => !tile.exists)); assert.deepEqual(await ev(coreKeys), coreBefore); assert.equal(await ev(`localStorage.getItem('${KEY}')`), raw); return { offline: report.offlineTile, removed: remaining.length, coreUnchanged: true, saveUnchanged: true };
  });
  await check('U 真partial救援覆蓋層保留原文及完整快照，不建立WebGL；還原可取回錢包', async () => {
    await send('Network.setBypassServiceWorker', { bypass: true }); await send('Page.navigate', { url: controlUrl }); await until(`document.title==='平台隔離控制頁'&&location.href===${JSON.stringify(controlUrl)}`);
    const fixture = await ev(`(()=>{const snapshot=localStorage.getItem('${GOOD}'),good=JSON.parse(snapshot),save=JSON.parse(good.raw),money=save.taxi.money;save.taxi.money=String(money);const damaged=JSON.stringify(save);localStorage.setItem('${KEY}',damaged);return{snapshot,damaged,money}})()`);
    await send('Page.navigate', { url: game }); await until('!document.querySelector("#save-recovery").classList.contains("hidden")');
    const stopped = await ev(`({message:document.querySelector('#save-recovery-message').textContent,raw:localStorage.getItem('${KEY}'),snapshot:localStorage.getItem('${GOOD}'),archived:localStorage.getItem('${ORIGINAL}'),webgl:window.__allWebgl,gp:!!window.__gp,restoreDisabled:document.querySelector('#save-recovery-restore').disabled})`);
    assert.match(stopped.message, /部分.*taxi/); assert.equal(stopped.raw, fixture.damaged); assert.equal(stopped.snapshot, fixture.snapshot); assert.equal(stopped.archived, fixture.damaged); assert.equal(stopped.webgl, 0); assert.equal(stopped.gp, false); assert.equal(stopped.restoreDisabled, false);
    await screenshot('partial-recovery'); const token = await ev('window.__allToken'); acceptDialog = true;
    await ev(`document.querySelector('#save-recovery-restore').click()`).catch((error) => { if (!/context|navigation|Cannot find/i.test(error.message)) throw error; });
    await until(`window.__allToken&&window.__allToken!==${JSON.stringify(token)}`); acceptDialog = false; await ready();
    const restored = await ev(`({money:JSON.parse(localStorage.getItem('${KEY}')).taxi.money,archived:localStorage.getItem('${ORIGINAL}'),overlayHidden:document.querySelector('#save-recovery').classList.contains('hidden'),gp:!!window.__gp})`);
    assert.equal(restored.money, fixture.money); assert.equal(restored.archived, fixture.damaged); assert.equal(restored.overlayHidden, true); assert.equal(restored.gp, true);
    return { stopped: { message: stopped.message, snapshotUnchanged: true, originalPreserved: true, webgl: stopped.webgl }, restored: { money: restored.money, overlayHidden: restored.overlayHidden, gp: restored.gp }, snapshotHash: createHash('sha256').update(fixture.snapshot).digest('hex') };
  });
} catch (error) { if (!report.cases.some((c) => c.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: error.stack }); await screenshot('failure').catch(() => {}); }
finally {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length, exceptions: report.exceptions.length };
  await writeFile(resolve(root, 'tools/dev-tests/all-platform-browser-results.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  ws.close(); if (report.summary.failed || report.summary.exceptions) process.exitCode = 1;
}
