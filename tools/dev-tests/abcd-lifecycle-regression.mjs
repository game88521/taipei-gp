// 真save.ts及依賴於隔離本機HTML中執行；以Page.navigate產生isTrusted原生pagehide。
// node tools/dev-tests/external-browser.mjs 9333 abcd-lifecycle-regression.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pureUrl } from './pure-module-loader.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = path.resolve(process.env.GP_ABCD_BASELINE_DIR ?? path.resolve(project, '../taipei-gp-abcd-before-3bdf97336c02'));
const brokenFile = path.resolve(process.env.GP_ABCD_MICROTASK_SOURCE ?? path.resolve(project, '../taipei-gp-pagehide-microtask-before.ts'));
const port = process.argv[2], KEY = 'taipei-gp-v2', LOG = '__abcd_lifecycle_log', LOCK = KEY + '-writer';
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const hashes = {};
async function compiled(root, name, rawOverride) {
  const raw = rawOverride ?? await readFile(path.join(root, 'src', name), 'utf8');
  const code = stripTypeScriptTypes(raw, { mode: 'transform' });
  const specs = [...new Set([...code.matchAll(/from (['"])([^'"]+)\1/g)].map((match) => match[2]))];
  const dependencies = new Map(await Promise.all(specs.filter((spec) => spec.startsWith('.')).map(async (spec) => {
    const file = path.resolve(root, 'src', path.dirname(name), path.extname(spec) ? spec : spec + '.ts');
    return [spec, await pureUrl(root, file)];
  })));
  return code.replace(/from (['"])([^'"]+)\1/g,
    (all, quote, specifier) => dependencies.has(specifier) ? `from ${quote}${dependencies.get(specifier)}${quote}` : all);
}
async function saveModule(root, label, rawOverride) {
  const raw = rawOverride ?? await readFile(path.join(root, 'src/save.ts'), 'utf8');
  hashes[label] = createHash('sha256').update(raw).digest('hex');
  return dataUrl(await compiled(root, 'save.ts', raw));
}
const brokenRaw = await readFile(brokenFile, 'utf8');
assert.match(brokenRaw, /queueMicrotask\(\(\) => \{ blockWriter\('released'/, '問題版快照必須含原始microtask釋放');
const modules = { before: await saveModule(baseline, 'before'), broken: await saveModule(project, 'broken', brokenRaw), after: await saveModule(project, 'after') };
const build = (await readFile(path.join(project, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1];
const report = { build, baseline, brokenFile, sourceHashes: hashes, usesRealSaveSource: true, nativeNavigation: true,
  isolatedContext: true, playerStorageTouched: false, cases: [], exceptions: [],
  limitations: ['真Chrome／WebLocks／localStorage／原生pagehide；未載遊戲場景或WebGL。', '只驗保存與釋放次序，不代表手機BFCache完整行為。'] };
const connections = [], delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let currentCase = '準備';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/source') { res.end('<!doctype html><title>隔離生命周期控制頁</title>'); return; }
  const which = url.searchParams.get('which'), throws = url.searchParams.get('throws') === '1';
  if (!modules[which]) { res.writeHead(404); res.end(); return; }
  res.end(`<!doctype html><title>真save生命周期</title><script type="module">
    try {
      const m = await import(${JSON.stringify(modules[which])});
      const log = [], append = (item) => { log.push(item); localStorage.setItem(${JSON.stringify(LOG)}, JSON.stringify(log)); };
      m.subscribeSaveWriter?.((state) => append({ event: 'writer', phase: state.phase, reason: state.reason }));
      await m.initializeSaveWriter?.();
      const flush = () => {
        append({ event: 'flush-start', phase: m.getSaveWriterState?.().phase ?? 'legacy' });
        if (${throws}) throw Error('隔離flush失敗');
        m.save.taxi = { money: 1800, trips: 1 };
        const saved = m.writeSave();
        append({ event: 'flush-save', saved, phase: m.getSaveWriterState?.().phase ?? 'legacy' });
      };
      if (${JSON.stringify(which)} === 'after') {
        if (typeof m.setBeforeSaveWriterRelease !== 'function') throw Error('新版setBeforeSaveWriterRelease尚未完成');
        m.setBeforeSaveWriterRelease(flush);
      } else addEventListener('pagehide', flush);
      addEventListener('pagehide', (event) => append({ event: 'native-pagehide', trusted: event.isTrusted }));
      window.__lifecycleReady = true;
    } catch (error) { window.__lifecycleFailure = error.stack; }
  </script>`);
});
async function connect(target, label) {
  const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let sequence = 0;
  const client = { ws, label };
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') report.exceptions.push({ case: currentCase, label, text: message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text });
    const job = pending.get(message.id); if (!job) return;
    pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(Error(JSON.stringify(message.error))) : job.resolve(message.result);
  };
  ws.onclose = () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('CDP closed')); } pending.clear(); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  client.send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`${label} ${method} timeout`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  client.ev = async (expression) => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  connections.push(client); await client.send('Page.enable'); await client.send('Runtime.enable'); return client;
}
async function until(client, expression) {
  const limit = Date.now() + 15000;
  while (Date.now() < limit) {
    try {
      const failure = await client.ev('window.__lifecycleFailure ?? null'); if (failure) throw Error(failure);
      if (await client.ev(expression)) return;
    } catch (error) { if (!/Execution context|Cannot find context|navigation/i.test(error.message)) throw error; }
    await delay(50);
  }
  throw Error(`條件逾時：${expression}`);
}
async function test(name, action) {
  currentCase = name;
  try { report.cases.push({ name, status: 'PASS', detail: await action() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[隔離模組]').slice(0, 7000) }); throw error; }
  finally { console.log(JSON.stringify(report.cases.at(-1))); }
}
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  assert.equal(pages.length, 1, '需經external-browser隔離入口');
  const target = pages.find((page) => page.type === 'page'); assert.ok(target);
  const control = await connect(target, 'control');
  const context = (await control.send('Target.getTargetInfo')).targetInfo.browserContextId;
  assert.ok(context, '不可操作預設／玩家context');
  await control.send('Page.navigate', { url: origin + '/control' });
  await until(control, `location.pathname === '/control' && document.readyState === 'complete'`);
  assert.equal(await control.ev("typeof navigator.locks?.request === 'function'"), true, '需真WebLocks');
  const { targetId } = await control.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const endpoint = new URL(target.webSocketDebuggerUrl);
  const targets = await (await fetch(`http://${endpoint.host}/json`)).json();
  const sourceTarget = targets.find((page) => page.id === targetId); assert.ok(sourceTarget);
  const source = await connect(sourceTarget, 'source');
  assert.equal((await source.send('Target.getTargetInfo')).targetInfo.browserContextId, context);
  async function navigate(which, throws = false) {
    await control.ev(`localStorage.clear();localStorage.setItem(${JSON.stringify(KEY)},JSON.stringify({best:null,sectors:[null,null,null],ghost:null,opts:{},taxi:{money:1000,trips:0}}));`);
    await source.send('Page.navigate', { url: origin + '/source?which=' + which + (throws ? '&throws=1' : '') });
    await until(source, 'window.__lifecycleReady === true');
    const heldBefore = await control.ev('navigator.locks.query()');
    assert.equal(heldBefore.held.filter((lock) => lock.name === LOCK).length, which === 'before' ? 0 : 1);
    await source.send('Page.navigate', { url: origin + '/after?which=' + which });
    await until(source, `location.pathname === '/after' && document.readyState === 'complete'`);
    await until(control, `navigator.locks.query().then(result=>result.held.every(lock=>lock.name!==${JSON.stringify(LOCK)}))`);
    const result = await control.ev(`({log:JSON.parse(localStorage.getItem(${JSON.stringify(LOG)})),money:JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).taxi.money})`);
    const heldAfter = await control.ev('navigator.locks.query()');
    assert.ok(result.log.some((item) => item.event === 'native-pagehide' && item.trusted === true));
    assert.equal(heldAfter.held.filter((lock) => lock.name === LOCK).length, 0);
    return { ...result, heldBefore: heldBefore.held.length, heldAfter: heldAfter.held.length };
  }
  await test('before真save沒有A鎖定，原生pagehide仍可保存1800', async () => {
    const result = await navigate('before'); assert.equal(result.money, 1800);
    assert.equal(result.log.find((item) => item.event === 'flush-save').saved, true); return result;
  });
  await test('問題版真save先microtask封鎖，原生pagehide漏掉1800且只留1000', async () => {
    const result = await navigate('broken'); assert.equal(result.money, 1000);
    assert.equal(result.log.find((item) => item.event === 'flush-save').saved, false);
    assert.ok(result.log.findIndex((item) => item.event === 'writer' && item.phase === 'blocked') < result.log.findIndex((item) => item.event === 'flush-start'));
    return result;
  });
  await test('after真save同步flush保存1800才封鎖並釋放WebLock', async () => {
    const result = await navigate('after'); assert.equal(result.money, 1800);
    assert.equal(result.log.find((item) => item.event === 'flush-save').saved, true);
    assert.equal(result.log.find((item) => item.event === 'flush-start').phase, 'ready');
    assert.ok(result.log.findIndex((item) => item.event === 'flush-save') < result.log.findIndex((item) => item.event === 'writer' && item.phase === 'blocked'));
    return result;
  });
  await test('after flush callback拋錯仍封鎖／釋放，保留原存檔1000', async () => {
    const result = await navigate('after', true); assert.equal(result.money, 1000);
    assert.ok(result.log.some((item) => item.event === 'writer' && item.phase === 'blocked' && item.reason === 'released'));
    assert.equal(result.log.some((item) => item.event === 'flush-save'), false); return result;
  });
} catch (error) {
  if (!report.cases.some((item) => item.status === 'FAIL')) report.cases.push({ name: currentCase, status: 'FAIL', error: error.stack });
} finally {
  report.summary = { passed: report.cases.filter((item) => item.status === 'PASS').length, failed: report.cases.filter((item) => item.status === 'FAIL').length };
  await writeFile(path.join(project, 'tools/dev-tests/shots-abcd-lifecycle-regression.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
  for (const client of connections) client.ws.close();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  if (report.summary.failed || report.exceptions.length) process.exitCode = 1;
}
