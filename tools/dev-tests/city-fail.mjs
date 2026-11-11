// 台北 city.json 下載被擋時：提前請求失敗後 fetchJson 會重試一次；兩次都失敗要照舊停在載入畫面（不能無聲卡住也不能出現未處理例外）
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); let blocked = 0, mode = 'fail1';
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.method === 'Fetch.requestPaused') { const u = d.params.request.url;
    if (u.includes('/data/city.json') && (mode === 'failall' || (mode === 'fail1' && blocked < 1))) { blocked++; send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'ConnectionFailed' }); }
    else send('Fetch.continueRequest', { requestId: d.params.requestId }); }
  if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/city.json' }] });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.exceptionDetails ? 'ERR' : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true; const check = (c, line) => { if (!c) ok = false; console.log(`${c ? 'ok  ' : 'FAIL'} ${line}`); };
// 1) 只失敗第一次：提前請求失敗，重試成功 → 要能進選單
await send('Page.navigate', { url: 'http://localhost:4317/?notraffic' });
let st = ''; for (let k = 0; k < 300; k++) { await sleep(500); st = await ev('window.__gp?.state'); if (st) break; }
check(blocked === 1 && st === 'menu', `第一次失敗、重試成功：進到選單（被擋 ${blocked} 次，state=${st}）`);
// 2) 全部失敗：不能進選單，也不能是白畫面——載入畫面還在
mode = 'failall'; blocked = 0;
await send('Page.navigate', { url: 'http://localhost:4317/?notraffic&x=2' });
await sleep(15000);
const info = JSON.parse(await ev(`JSON.stringify({ gp: typeof window.__gp, note: (document.getElementById('menu-best')||{}).textContent })`));
console.log('全部失敗：', JSON.stringify(info), '；被擋', blocked, '次');
check(info.gp === 'object' && /街景載入失敗/.test(info.note || ''), '兩次都失敗：照舊降級成只有賽道，選單有提示');
console.log('\n結果', ok ? '全部通過' : '有失敗');
process.exit(0);
