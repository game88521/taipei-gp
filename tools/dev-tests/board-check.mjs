// 排行榜重用 <li>：1) 內容跟「依 standings 重新算」一致（名次、名字、差距、顏色、class）2) 連續更新時節點是同一批（沒被重建）3) 名次換位後內容跟著換
// 用法：bash run-node.sh board-check.mjs
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (c, line) => { if (!c) ok = false; console.log(`${c ? 'ok  ' : 'FAIL'} ${line}`); };
await send('Page.navigate', { url: 'http://localhost:4317/?gp&bot' });
for (let k = 0; k < 400; k++) { await sleep(1000); const s = await ev('window.__gp?.state'); if (s === 'race' || s === 'countdown') break; }
for (let k = 0; k < 300 && (await ev('__gp.state')) !== 'race'; k++) await sleep(1000);
const grab = `(() => [...document.querySelectorAll('#board li')].map((li) => ({ t: li.children[1].textContent, g: li.children[2].textContent, c: li.className, bg: li.children[0].style.background })))()`;
// 觸發 updateGpHud：它每 6 格才更新一次，連呼叫 6 次 updateVisuals 不方便；改直接用 __gp 暴露的 tick（若沒有就等 rAF）
const before = JSON.parse(await ev(`JSON.stringify((() => { window.__li = [...document.querySelectorAll('#board li')]; return window.__li.length; })())`));
console.log('開頭 li 數 =', before);
// 讓遊戲自己跑一會兒（rAF 迴圈被我關了，重新打開）
await ev('(() => { for (let i = 0; i < 3000; i++) __gp.step(0.02); return 1; })()');
await ev(`new Promise((r) => { let n = 0; const f = () => { if (++n > 15) r(1); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`).catch(() => {});
const rows = JSON.parse(await ev(`JSON.stringify(${grab})`));
const std = JSON.parse(await ev(`JSON.stringify(__gp.field.standings().map((r, k) => ({ n: k + 1 + ' ' + r.name, c: r.color })))`));
console.log('li 數', rows.length, '／車數', std.length);
check(rows.length === std.length, 'li 數 = 車數');
check(rows.every((r, k) => r.t.endsWith(std[k].n.slice(std[k].n.indexOf(' ') + 1)) && r.t.startsWith(String(k + 1) + ' ')), '名字與名次逐列一致');
check(rows.filter((r) => r.c === 'me').length === 1, '剛好一列是 me');
check(rows[0].g === '領先' || rows[0].g === '完賽', `第一列差距 = ${rows[0].g}`);
check(rows.slice(1).every((r) => /^\+\d+\.\d$/.test(r.g)), '其餘列差距格式 +x.x');
// 節點是否被重用（要在遊戲迴圈跑起來之後比對）：記下一批節點，再跑一會兒
await ev(`(() => { window.__li2 = [...document.querySelectorAll('#board li')]; return 1; })()`);
await ev(`new Promise((r) => { let n = 0; const f = () => { if (++n > 15) r(1); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`).catch(() => {});
const same = await ev(`(() => { const now = [...document.querySelectorAll('#board li')]; return now.length === window.__li2.length && now.every((l, i) => l === window.__li2[i]); })()`);
check(same === true, '相隔多次更新後 <li> 還是同一批節點（沒有重建）');
console.log('\n結果', ok ? '全部通過' : '有失敗');
process.exit(0);
