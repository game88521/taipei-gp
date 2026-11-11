// 修正 13：國外賽道的資料下載失敗，載入畫面會不會卡住、有沒有提示
//   用 CDP 的 Fetch 攔截：把 /data/circuits/italy.json 的回應換成 500（或直接斷線），再開 ?circuit=italy
//   觀察：載入畫面（#boot）在 25 秒後是不是還在、有沒有錯誤訊息、有沒有「重試」「回台北」按鈕、__gp 有沒有出現
// 用法：GPFIX=1 bash run-node.sh circuit-fail.mjs   （GPFIX 沒設就是改前的行為觀察）
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); const errs = []; let blocked = 0, allowed = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text || '').split('\n')[0].slice(0, 160));
  if (d.method === 'Fetch.requestPaused') {
    const u = d.params.request.url;
    if (u.includes('/data/circuits/italy.json') && !allowed) { blocked++; send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'ConnectionFailed' }); }
    else send('Fetch.continueRequest', { requestId: d.params.requestId });
  }
  if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/circuits/*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const ev = async (e, aw = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw, userGesture: true }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200) : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (c, line) => { if (!c) ok = false; console.log(`${c ? 'ok  ' : 'FAIL'} ${line}`); };
await send('Page.navigate', { url: 'http://localhost:4317/?circuit=italy&notraffic' });
await sleep(25000);
const info = JSON.parse(await ev(`(() => { const b = document.getElementById('boot'); const vis = !!b && !b.classList.contains('done'); return JSON.stringify({ 載入畫面還在: vis, 標籤: document.getElementById('boot-label')?.textContent ?? null, 百分比: document.getElementById('boot-pct')?.textContent ?? null, 有gp: typeof window.__gp !== 'undefined', 按鈕: b ? [...b.querySelectorAll('button, a')].map((x) => x.textContent.trim()) : [], 錯誤區: b ? (b.querySelector('#boot-error')?.textContent ?? null) : null }); })()`));
console.log('被擋下的請求數 =', blocked, '；25 秒後：', JSON.stringify(info));
if (process.env.GPFIX) {
  check(info.載入畫面還在 && /失敗|無法|重試|網路/.test((info.錯誤區 ?? '') + info.標籤), '載入畫面停住，但有說明失敗');
  check(info.按鈕.some((t) => /重試|重新/.test(t)), '有「重新載入」按鈕');
  check(info.按鈕.some((t) => /台北/.test(t)), '有「回台北」按鈕（不是死路）');
  // 放行請求後按重試：應該能進遊戲
  allowed = true;
  await ev(`(() => { const b = [...document.querySelectorAll('#boot button')].find((x) => /重試|重新/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
  let st = ''; for (let k = 0; k < 200; k++) { await sleep(1000); st = await ev('window.__gp?.state'); if (st) break; }
  check(st === 'menu', `放行後按重試，遊戲載入到選單（state = ${st}）`);
} else {
  console.log(info.載入畫面還在 && !info.有gp ? '→ 舊行為：載入畫面一直卡著、沒有 __gp、沒有任何說明或出路' : '→ 沒有卡住');
}
console.log('例外:', errs.length ? [...new Set(errs)].join(' | ') : '無');
if (process.env.GPFIX) console.log('\n結果', ok ? '全部通過' : '有失敗');
process.exit(0);
