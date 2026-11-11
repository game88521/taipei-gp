// 頒獎台畫面：台北與日本（較長的中文名）各拍一張，檢查：
//   1. 背板寫的是該賽道的名稱（不是一律「台北街道賽」）、字沒有超出背板
//   2. 名牌的順序跟台子一樣：左 = P2、中 = P1、右 = P3；P2、P3 的金銀銅顏色跟名次綁（不是跟第幾個 li）
// 用法：bash run-node.sh podium-shot.mjs
import fs from 'node:fs';
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map(); const errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200)); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const ev = async (e, aw = false) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (c, line) => { if (!c) ok = false; console.log(`${c ? 'ok  ' : 'FAIL'} ${line}`); };
for (const [label, q, wantTitle] of [['台北', '', '台北街道賽'], ['日本', '&circuit=japan', '日本大獎賽'], ['拉斯維加斯', '&circuit=lasvegas', '拉斯維加斯大獎賽']]) {
  await send('Page.navigate', { url: `http://localhost:4317/?bot&gp&podium&sim=400&notraffic${q}` });
  for (let k = 0; k < 400; k++) { await sleep(1000); if ((await ev('window.__gp?.state')) === 'podium') break; }
  await sleep(3000); // 讓頒獎台的鏡頭轉過來、畫面畫出來
  const names = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#podium-names li')].map((li) => li.querySelector('b').textContent + ' ' + li.querySelector('span').textContent))`));
  const colors = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#podium-names li')].map((li) => getComputedStyle(li.querySelector('b')).color))`));
  console.log(label, '名牌（左→右）：', names.join(' | '));
  check(names[0].startsWith('P2') && names[1].startsWith('P1') && names[2].startsWith('P3'), `${label}：名牌由左到右是 P2、P1、P3`);
  // 金／銀／銅：P1 #f2c14e = rgb(242,193,78)；P2 #d8dbe4 = rgb(216,219,228)；P3 #d09060 = rgb(208,144,96)
  check(colors[1] === 'rgb(242, 193, 78)' && colors[0] === 'rgb(216, 219, 228)' && colors[2] === 'rgb(208, 144, 96)', `${label}：金銀銅顏色跟名次綁定（${colors.join(' / ')}）`);
  await ev(`document.getElementById('hud').style.display = 'none'`);
  fs.writeFileSync(`./shots-podium-${label}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
}
console.log('例外:', errs.length ? errs.join(' | ') : '無');
console.log('\n結果', ok ? '全部通過' : '有失敗');
process.exit(0);
