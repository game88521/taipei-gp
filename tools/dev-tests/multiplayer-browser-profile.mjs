// 在既有專用測試 Chrome 讀取 CPU/GPU trace；不建立／關閉任何分頁或 context。
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const directory = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(directory, `multiplayer-browser-profile-${Date.now()}`);
await mkdir(evidence);
const version = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl), pending = new Map();
let seq = 0, completed;
const report = { at: new Date().toISOString(), browser: version.Browser, targets: [], trace: null, error: null, limitations: ['既有失敗收尾期間的診斷採樣，不是多人功能通過證據，也不代表手機效能'] };
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Tracing.tracingComplete') completed?.(message.params);
  if (!message.id) return;
  const item = pending.get(message.id); if (!item) return;
  pending.delete(message.id); clearTimeout(item.timer);
  if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 30000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
try {
  report.targets = (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.url === 'http://127.0.0.1:4317/multiplayer.html');
  await send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['devtools.timeline', 'v8', 'gpu', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing'] } });
  await delay(3000);
  const completion = new Promise((resolve, reject) => { completed = resolve; setTimeout(() => reject(new Error('Tracing completion timeout')), 30000).unref(); });
  await send('Tracing.end');
  const { stream } = await completion;
  if (!stream) throw new Error('Trace stream was not returned');
  const chunks = [];
  for (;;) { const part = await send('IO.read', { handle: stream, size: 1024 * 1024 }); chunks.push(part.base64Encoded ? Buffer.from(part.data, 'base64') : Buffer.from(part.data)); if (part.eof) break; }
  await send('IO.close', { handle: stream });
  await writeFile(path.join(evidence, 'cpu-gpu-trace.json'), Buffer.concat(chunks)); report.trace = 'cpu-gpu-trace.json';
} catch (error) { report.error = error.stack ?? String(error); process.exitCode = 1; }
finally {
  ws.close(); await writeFile(path.join(evidence, 'profile-summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ evidence, targets: report.targets.length, trace: report.trace, error: report.error }));
}
