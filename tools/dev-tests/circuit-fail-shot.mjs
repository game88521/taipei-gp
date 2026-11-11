// 載入失敗畫面：截圖，並讀出說明文字（#boot-tip）、按鈕大小、手機直式寬度下會不會超出畫面
// 用法：bash run-node.sh circuit-fail-shot.mjs
import fs from 'node:fs';
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Fetch.requestPaused') { const u = d.params.request.url; if (u.includes('/data/circuits/italy.json')) send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'ConnectionFailed' }); else send('Fetch.continueRequest', { requestId: d.params.requestId }); }
  if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/circuits/*' }] });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.exceptionDetails ? 'ERR' : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (c, line) => { if (!c) ok = false; console.log(`${c ? 'ok  ' : 'FAIL'} ${line}`); };
for (const [tag, w, h, mobile] of [['desk', 960, 540, false], ['phone', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Page.navigate', { url: 'http://localhost:4317/?circuit=italy&notraffic' });
  await sleep(9000);
  const r = JSON.parse(await ev(`(() => { const tip = document.getElementById('boot-tip'), box = document.getElementById('boot-error'); const bs = box ? [...box.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }; }) : []; return JSON.stringify({ 說明: tip ? tip.textContent : null, 按鈕: bs, 視窗寬: innerWidth, 可橫捲: document.documentElement.scrollWidth > innerWidth }); })()`));
  console.log(tag, JSON.stringify(r));
  check(/賽道資料下載失敗/.test(r.說明 ?? '') && /重試|網路/.test(r.說明 ?? ''), `${tag}：說明文字寫出原因與建議`);
  check(r.按鈕.length === 2 && r.按鈕.every((b) => b.h >= 40 && b.left >= 0 && b.right <= r.視窗寬), `${tag}：兩顆按鈕都在畫面內、高度 ≥ 40`);
  check(!r.可橫捲, `${tag}：頁面不會橫向捲動`);
  fs.writeFileSync(`./shots-bootfail-${tag}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
}
console.log('\n結果', ok ? '全部通過' : '有失敗');
process.exit(0);
