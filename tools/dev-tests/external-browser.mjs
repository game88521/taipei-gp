// 在使用者啟動的專用 Chrome 中建立獨立 context，執行既有 CDP 測試。
// 用法：node external-browser.mjs 9333 gp-title.mjs 'bot&sim=120' BOT 400
// 不關閉外部 Chrome；只清掉本次建立的 context。既有腳本無須改寫。
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [port, script, ...args] = process.argv.slice(2);
if (!/^\d+$/.test(port ?? '') || !script) throw new Error('需要 CDP port 與測試腳本');
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data), job = pending.get(msg.id);
  if (!job) return;
  pending.delete(msg.id); clearTimeout(job.timer);
  if (msg.error) job.reject(new Error(JSON.stringify(msg.error)));
  else job.resolve(msg.result);
};
ws.onclose = () => {
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('Chrome CDP 已斷線')); }
  pending.clear();
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 逾時`)); }, 20000);
  pending.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
let context, server, timeout;
try {
  context = (await send('Target.createBrowserContext')).browserContextId;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = pages.find((p) => p.id === targetId);
  if (!target) throw new Error('找不到新建的測試分頁');
  // 既有腳本會從 /json 選第一個 page；只提供本次分頁，WebSocket 仍直連 Chrome。
  server = createServer((req, res) => {
    if (req.url !== '/json') { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([target]));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const child = spawn(process.execPath, [resolve(fileURLToPath(new URL('.', import.meta.url)), script), String(server.address().port), ...args], { stdio: 'inherit', windowsHide: true });
  timeout = setTimeout(() => child.kill(), Number(process.env.GP_TEST_TIMEOUT ?? 550) * 1000);
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  clearTimeout(timeout);
  process.exitCode = result.code ?? 1;
  if (result.signal) console.error(`測試已終止：${result.signal}`);
} finally {
  clearTimeout(timeout);
  server?.closeAllConnections();
  server?.close();
  if (context) await send('Target.disposeBrowserContext', { browserContextId: context }).catch((e) => { console.error(e.message); process.exitCode = 1; });
  ws.close();
}
