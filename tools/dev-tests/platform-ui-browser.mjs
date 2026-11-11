// 只連 external-browser.mjs 提供的隔離分頁；不自行啟動或關閉 Chrome。
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [port] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = pages.find((p) => p.type === 'page');
if (!target) throw Error('找不到隔離測試分頁');
const ws = new WebSocket(target.webSocketDebuggerUrl), jobs = new Map(); let seq = 0;
const report = { url: 'http://127.0.0.1:4317/?q=low&notraffic', realPhone: false, browser: '使用者啟動的 Chrome，CDP 獨立 context', cases: [], exceptions: [], layouts: [] };
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.method === 'Runtime.exceptionThrown') report.exceptions.push(msg.params.exceptionDetails.text + ':' + (msg.params.exceptionDetails.exception?.description ?? ''));
  const job = jobs.get(msg.id); if (!job) return;
  jobs.delete(msg.id); clearTimeout(job.timer); msg.error ? job.reject(Error(JSON.stringify(msg.error))) : job.resolve(msg.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { jobs.delete(id); reject(Error(`${method} 逾時`)); }, 45000);
  jobs.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, ms = 180000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await ev(expression)) return; await delay(500); }
  throw Error(`等待逾時：${expression}`);
}
async function test(name, fn) {
  try { const details = await fn(); report.cases.push({ name, status: 'PASS', ...(details ? { details } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); }
  console.log(JSON.stringify(report.cases.at(-1)));
}
const metrics = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await metrics(390, 844);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear();localStorage.setItem('taipei-gp-v2',JSON.stringify({schema:3,playerId:'11111111-1111-4111-8111-111111111111',best:null,sectors:[null,null,null],ghost:null,opts:{sound:false},taxi:{money:10000,trips:1},tutDone:true,quality:'low',touch:'on',car:'sedan'}));` });
  await send('Page.navigate', { url: report.url });
  await until('!!window.__gp && !!document.querySelector("#paint-list button")');
  // 減少繪圖負擔；CSS viewport 與 DOM 排版仍是指定尺寸，不作 FPS 測量。
  await ev('window.__gp.renderer.setPixelRatio(0.25)');
  await until('!document.querySelector("#btn-taxi").disabled', 180000);
  await test('烤漆試色／取消不扣款，確認套用才扣款並保存', async () => {
    const result = await ev(`(() => {
      document.querySelector('[data-tab="garage"]').click();
      const read=()=>JSON.parse(localStorage.getItem('taipei-gp-v2'));
      const before=read(),swatch=document.querySelector('#paint-list button.locked');
      if(!swatch)throw Error('缺少可購買烤漆');
      const selected=swatch.style.background;swatch.click();
      const trial={money:read().taxi.money,paint:read().paint??{},applyHidden:document.querySelector('#paint-apply').hidden,note:document.querySelector('#paint-preview-note').textContent};
      document.querySelector('#paint-cancel').click();
      const canceled={money:read().taxi.money,paint:read().paint??{},applyHidden:document.querySelector('#paint-apply').hidden};
      document.querySelector('#paint-list button.locked').click();document.querySelector('#paint-apply').click();
      return {beforeMoney:before.taxi.money,trial,canceled,after:read(),selected};
    })()`);
    assert.equal(result.trial.money, result.beforeMoney); assert.deepEqual(result.trial.paint, {}); assert.equal(result.trial.applyHidden, false); assert.match(result.trial.note, /尚未套用或扣款/);
    assert.equal(result.canceled.money, result.beforeMoney); assert.deepEqual(result.canceled.paint, {}); assert.equal(result.canceled.applyHidden, true);
    assert.ok(result.after.taxi.money < result.beforeMoney); assert.ok(result.after.paint.sedan); assert.ok(result.after.paints.sedan.includes(result.after.paint.sedan));
    return { beforeMoney: result.beforeMoney, afterMoney: result.after.taxi.money, paint: result.after.paint.sedan };
  });
  await test('備份有效→無效預覽不會誤寫；undo僅預覽', async () => {
    const result = await ev(`(() => {
      document.querySelector('[data-tab="records"]').click();const text=document.querySelector('#bk-text'),confirm=document.querySelector('#bk-confirm');
      const original=localStorage.getItem('taipei-gp-v2'),payload=JSON.parse(original);payload.taxi.money=7777;
      text.value=JSON.stringify({app:'taipei-gp',save:payload});text.dispatchEvent(new Event('input'));
      const valid=!confirm.hidden;text.value='{not-a-valid-backup-after-valid}';text.dispatchEvent(new Event('input'));
      const invalidHidden=confirm.hidden;document.querySelector('#bk-apply').click();const unchanged=localStorage.getItem('taipei-gp-v2')===original;
      localStorage.setItem('taipei-gp-v2-before-restore',JSON.stringify(payload));document.querySelector('#bk-undo').click();
      return {valid,invalidHidden,unchanged,undoVisible:!confirm.hidden,undoUnchanged:localStorage.getItem('taipei-gp-v2')===original,message:document.querySelector('#bk-msg').textContent};
    })()`);
    assert.equal(result.valid, true); assert.equal(result.invalidHidden, true); assert.equal(result.unchanged, true); assert.equal(result.undoVisible, true); assert.equal(result.undoUnchanged, true); assert.match(result.message, /7,777/);
  });
  await test('烤漆購買後直接切紀錄立即顯示300支出', async () => {
    const result = await ev(`(() => {document.querySelector('[data-tab="records"]').click();document.querySelector('#economy-history').open=true;return {summary:document.querySelector('#economy-summary').textContent,list:document.querySelector('#economy-list').textContent,ledger:JSON.parse(localStorage.getItem('taipei-gp-v2')).ledger};})()`);
    assert.match(result.summary, /支出 (?:NT\$ )?300/); assert.match(result.list, /烤漆.*-300/); assert.equal(result.ledger.at(-1).amount, -300); return { summary: result.summary };
  });
  await test('手機直向與橫向車庫／備份無水平溢出，新增按鈕至少44px', async () => {
    for (const [width, height] of [[390, 844], [844, 390]]) {
      await metrics(width, height);
      for (const tab of ['garage', 'records']) {
        const layout = await ev(`(() => {document.querySelector('[data-tab="${tab}"]').click();const main=document.querySelector('.m-main');return {width:innerWidth,height:innerHeight,tab:'${tab}',documentWidth:document.documentElement.scrollWidth,client:main.clientWidth,scroll:main.scrollWidth,buttons:[...document.querySelectorAll('${tab === 'garage' ? '#paint-list button,#car-use' : '#bk-copy,#bk-save,#bk-undo'}')].map(e=>({id:e.id||e.getAttribute('aria-label'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))};})()`);
        report.layouts.push(layout); assert.ok(layout.documentWidth <= width + 1); assert.ok(layout.scroll <= layout.client + 1);
        for (const b of layout.buttons) { assert.ok(b.width >= 44, JSON.stringify(b)); assert.ok(b.height >= 44, JSON.stringify(b)); }
      }
    }
  });
  await test('設定select的方向鍵不被駕駛攔截', async () => {
    await ev(`document.querySelector('[data-tab="settings"]').click();document.querySelector('#opt-rules').focus();window.__uiKeys=[];document.querySelector('#opt-rules').addEventListener('keydown',e=>queueMicrotask(()=>window.__uiKeys.push({code:e.code,prevented:e.defaultPrevented})))`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    const keys = await ev('window.__uiKeys'); assert.equal(keys[0].prevented, false); return keys;
  });
  await test('計程車行程明細可用空白鍵展開，HUD更新不重建details', async () => {
    await metrics(844, 390);
    await until('!document.querySelector("#btn-taxi").disabled', 180000);
    await ev(`document.querySelector('#bk-cancel').click();document.querySelector('[data-tab="play"]').click();document.querySelector('#btn-taxi').click();`);
    await until('window.__gp.state === "free" && !document.querySelector("#taxi-hud").classList.contains("hidden")');
    await ev(`window.__taxiDetails=document.querySelector('#taxi-details');window.__taxiDetails.querySelector('summary').focus();`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await until('document.querySelector("#taxi-details").open', 20000);
    await delay(1500);
    const result = await ev(`(() => {const d=document.querySelector('#taxi-details'),hud=document.querySelector('#taxi-hud'),s=d.querySelector('summary'),r=hud.getBoundingClientRect();return {sameNode:d===window.__taxiDetails,open:d.open,summaryHeight:s.getBoundingClientRect().height,hud:{left:r.left,right:r.right,bottom:r.bottom},width:innerWidth,height:innerHeight};})()`);
    assert.equal(result.sameNode, true); assert.equal(result.open, true); assert.ok(result.summaryHeight >= 44); assert.ok(result.hud.left >= -1 && result.hud.right <= result.width + 1); assert.ok(result.hud.bottom <= result.height + 1);
    return result;
  });
  await test('結算面板短螢幕可捲動，離開與重試控制可達', async () => {
    await metrics(844, 390);
    // 結算流程另有真實 main AST／VM 整合測試；這裡只檢查同一靜態面板的瀏覽器排版。
    const result = await ev(`(() => {const el=document.querySelector('#gp-settling');el.classList.remove('hidden');document.querySelector('#gp-settle-retry').hidden=false;const card=el.querySelector('.card'),r=card.getBoundingClientRect();const buttons=['gp-settle-retry','gp-settle-exit'].map(id=>{const b=document.getElementById(id);b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {id,height:r.height,width:r.width,top:r.top,bottom:r.bottom}});el.classList.add('hidden');return {card:{top:r.top,bottom:r.bottom},height:innerHeight,overflow:getComputedStyle(card).overflowY,buttons};})()`);
    assert.ok(result.card.top >= -1 && result.card.bottom <= result.height + 1); assert.equal(result.overflow, 'auto');
    for (const b of result.buttons) { assert.ok(b.width >= 44 && b.height >= 44); assert.ok(b.top >= 0 && b.bottom <= result.height + 1); }
    return result;
  });
  await test('甩尾練習提示在直向／橫向不覆蓋駕駛控制，可收合及結束', async () => {
    await ev(`document.querySelector('#btn-pause').click();document.querySelector('[data-tab="play"]').click();document.querySelector('#btn-drift-practice').click()`);
    await until('window.__gp.state === "free" && !document.querySelector("#drift-coach").classList.contains("hidden")');
    await until('document.querySelector("#coach-status").textContent.includes("速度")', 30000);
    const layouts = [];
    for (const [width, height] of [[844, 390], [390, 844]]) {
      await metrics(width, height);
      const layout = await ev(`(() => {const coach=document.querySelector('#drift-coach');coach.open=true;const rect=e=>{const r=e.getBoundingClientRect();return {id:e.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {width:innerWidth,height:innerHeight,coach:rect(coach),controls:['steer-btns','pad','gas','brake','btn-drift','btn-horn'].map(id=>document.getElementById(id)).filter(e=>e&&getComputedStyle(e).display!=='none').map(rect),text:document.querySelector('#coach-status').textContent};})()`);
      layouts.push(layout); assert.ok(layout.coach.left >= -1 && layout.coach.right <= width + 1); assert.ok(layout.coach.top >= 0 && layout.coach.bottom <= height + 1); assert.match(layout.text, /速度/);
      for (const c of layout.controls) {
        const overlap = Math.max(0, Math.min(c.right, layout.coach.right) - Math.max(c.left, layout.coach.left)) * Math.max(0, Math.min(c.bottom, layout.coach.bottom) - Math.max(c.top, layout.coach.top));
        assert.equal(overlap, 0, `練習提示覆蓋${c.id}：${JSON.stringify(layout)}`);
      }
    }
    await ev(`(() => {const g=window.__gp,c=g.sr.challenges[0];g.fcar.place(c.start.x,c.start.z,c.start.h,c.start.y);for(let i=0;i<35;i++)g.step(0.01);})()`);
    await until('!document.querySelector("#sr-offer").classList.contains("hidden")', 30000);
    await ev(`window.__coachKey=null;document.querySelector('#drift-coach').querySelector('summary').focus();document.querySelector('#drift-coach').querySelector('summary').addEventListener('keydown',e=>queueMicrotask(()=>window.__coachKey={code:e.code,target:e.target.tagName,prevented:e.defaultPrevented}),{once:true})`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.equal(await ev('window.__gp.sr.phase'), 'offer', '操作原生summary不得同時接受街頭邀請');
    const key = await ev('window.__coachKey'); assert.equal(key?.code, 'Enter'); assert.equal(key.target, 'SUMMARY'); assert.equal(key.prevented, false);
    await ev(`document.querySelector('#drift-coach').open=true;document.querySelector('#drift-coach').querySelector('summary').click()`);
    assert.equal(await ev(`document.querySelector('#drift-coach').open`), false);
    await ev(`document.querySelector('#drift-coach').open=true;document.querySelector('#coach-exit').click()`); assert.equal(await ev(`document.querySelector('#drift-coach').classList.contains('hidden')`), true);
    return layouts;
  });
  await test('街頭單挑邀請與多人對決路線圖在手機尺寸不溢出', async () => {
    await metrics(390, 844);
    await ev(`(() => {const g=window.__gp,c=g.sr.challenges[0];g.fcar.place(c.start.x,c.start.z,c.start.h,c.start.y);g.sr.phase='idle';g.sr.active=null;for(let i=0;i<35;i++)g.step(0.01);})()`);
    await until('!!document.querySelector("#sr-offer-route svg") && !document.querySelector("#sr-offer").classList.contains("hidden")', 30000);
    const single = await ev(`(() => {const e=document.querySelector('#sr-offer'),s=e.querySelector('svg'),r=e.getBoundingClientRect(),v=s.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,svgWidth:v.width,role:s.getAttribute('role'),label:s.getAttribute('aria-label')};})()`);
    assert.ok(single.left >= -1 && single.right <= single.width + 1); assert.ok(single.svgWidth > 0); assert.equal(single.role, 'img'); assert.ok(single.label);
    await ev(`document.querySelector('#btn-pause').click();document.querySelector('[data-tab="play"]').click();document.querySelector('#btn-duel').click()`);
    const multi = await ev(`(() => {const list=document.querySelector('#duel-list'),r=list.getBoundingClientRect();return {count:list.querySelectorAll('svg').length,challenges:window.__gp.sr.challenges.length,left:r.left,right:r.right,width:innerWidth,client:list.clientWidth,scroll:list.scrollWidth};})()`);
    assert.ok(multi.count > 0 && multi.count === multi.challenges); assert.ok(multi.left >= -1 && multi.right <= multi.width + 1); assert.ok(multi.scroll <= multi.client + 1);
    return { single, multi };
  });
} catch (error) { report.cases.push({ name: '測試啟動', status: 'FAIL', error: error.stack }); }
finally {
  if (report.cases.some((c) => c.status === 'FAIL')) {
    try { const screenshot = await send('Page.captureScreenshot', { format: 'png' }); await mkdir(path.join(root, 'tools/dev-tests/shots'), { recursive: true }); await writeFile(path.join(root, 'tools/dev-tests/shots/platform-ui-browser.png'), Buffer.from(screenshot.data, 'base64')); } catch { /* 測試失敗時盡力留下畫面 */ }
  }
  report.summary = { passed: report.cases.filter((c) => c.status === 'PASS').length, failed: report.cases.filter((c) => c.status === 'FAIL').length };
  await writeFile(path.join(root, 'tools/dev-tests/shots-platform-ui-browser.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2)); ws.close();
  if (report.summary.failed || report.exceptions.length) process.exitCode = 1;
}
