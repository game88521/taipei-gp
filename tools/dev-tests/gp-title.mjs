// 開網址，等 document.title 以 prefix 開頭（最多 TMO 秒），印出 title
const [port, url, prefix, tmo = '400'] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const wait = new Map();
let exceptions = 0;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') { exceptions++; console.log('EXC', JSON.stringify(d.params.exceptionDetails).slice(0, 300)); } if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.result?.value;
await send('Page.navigate', { url: 'http://127.0.0.1:4317/?' + url });
let t = '';
for (let k = 0; k < +tmo; k++) { await new Promise(r => setTimeout(r, 1000)); t = await ev('document.title'); if (t && t.startsWith(prefix)) break; }
console.log(t); console.log('aiHits', await ev('window.__gp?.field?.aiHits'));
if (!t?.startsWith(prefix)) console.error(`等待 ${prefix} 結果逾時（${tmo} 秒）`);
process.exit(exceptions === 0 && t?.startsWith(prefix) ? 0 : 1);
