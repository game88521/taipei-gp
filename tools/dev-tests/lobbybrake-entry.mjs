import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { environment } from './lobbybrake-client.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(project, '../taipei-gp-lobbybrake-before-f8ca4b1d251c');
const source = await readFile(path.join(project, 'src/multiplayer-entry.ts'), 'utf8');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const code = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/\bexport /g, '') + '\nglobalThis.Entry = MultiplayerEntryWait; globalThis.waitText = entryWaitText;';
const sources = ['src/multiplayer-entry.ts', 'src/multiplayer-client.ts', 'tools/dev-tests/lobbybrake-client.mjs'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async name => [name, digest(await readFile(path.join(project, name)))])));
sourceHashes['before/src/multiplayer-client.ts'] = digest(await readFile(path.join(before, 'src/multiplayer-client.ts')));
const report = { status: 'PASS', localOnly: true, productionUsed: false, externalRequests: 0, sourceHashes, cases: [], limitations: ['真client與等待協調器，WebSocket及時鐘為隔離替身；不代表真服務啟動秒數或外網品質。'] };
const fixture = () => { const env = environment(); vm.runInContext(code, env.context); return { ...env, wait: new env.context.Entry() }; };
const entries = env => env.sockets.flatMap(socket => socket.sent.filter(message => ['create', 'join', 'resume'].includes(message.type)));
const test = async (name, run) => { try { report.cases.push({ name, status: 'PASS', details: await run() }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); } };

await test('before真client單次握手7秒逾時，沒有啟動等待／重試', async () => {
  const env = environment({ sourceRoot: before }), client = env.client();
  const result = client.join('ABC234', '甲').then(() => 'ok', error => error.message);
  await env.advance(7001); assert.match(await result, /連線逾時/);
  assert.equal(env.sockets.length, 1); assert.equal(entries(env).length, 0); assert.equal(client.status, 'disconnected');
});
await test('constructor無連線；握手慢於7秒會重試，成功才送一次加入', async () => {
  const env = fixture(), client = env.client(); assert.equal(env.wait.active, false); assert.equal(env.sockets.length, 0);
  const done = (async () => { await env.wait.open(client); await client.join('ABC234', '甲'); })();
  await env.advance(7001); assert.equal(env.wait.active, true); assert.equal(entries(env).length, 0);
  await env.advance(1500); assert.equal(env.sockets.length, 2);
  const socket = env.latest(); socket.autoPong = true; socket.open(); await env.flush();
  assert.equal(entries(env).length, 1); assert.equal(entries(env)[0].type, 'join');
  env.welcome(socket); await done; assert.equal(env.wait.active, false); client.leave(); assert.equal(env.timers.size, 0);
});
await test('45秒總期限截斷最後一次握手，不會等到單次7秒滿才停止', async () => {
  const env = fixture(), client = env.client(); const result = env.wait.open(client).then(() => 'ok', error => error.message);
  await env.advance(44999); assert.equal(env.wait.active, true); assert.equal(env.sockets.length, 6);
  await env.advance(1); assert.match(await result, /45 秒/); assert.equal(env.wait.active, false);
  assert.equal(entries(env).length, 0); assert.equal(env.timers.size, 0);
  await env.advance(60000); assert.equal(env.sockets.length, 6);
});
await test('握手等待可取消，舊socket晚到open不送出任何房間請求', async () => {
  const env = fixture(), client = env.client(); let sent = 0;
  const done = (async () => { await env.wait.open(client); sent++; await client.create('甲'); })().catch(error => error.message);
  const old = env.latest(); await env.advance(2000); assert.equal(env.wait.cancel(), true);
  old.open(); await env.flush(); assert.match(await done, /已取消連線/); assert.equal(sent, 0);
  await env.advance(60000); assert.equal(env.sockets.length, 1); assert.equal(entries(env).length, 0); assert.equal(env.timers.size, 0);
});
await test('重試間隔可取消，不會多開下一條socket', async () => {
  const env = fixture(), client = env.client(); const result = env.wait.open(client).catch(error => error.message);
  env.latest().emit('error'); await env.flush(); assert.equal(env.wait.state.phase, 'retrying');
  env.wait.cancel(); await env.flush(); assert.match(await result, /已取消連線/);
  await env.advance(60000); assert.equal(env.sockets.length, 1); assert.equal(env.timers.size, 0);
});
await test('取消後立即重試，舊finally不會清掉新一輪deadline或成功', async () => {
  const env = fixture(), client = env.client(); const first = env.wait.open(client).catch(error => error.message);
  env.wait.cancel(); const second = env.wait.open(client); await env.flush(); assert.match(await first, /已取消連線/);
  assert.equal(env.wait.active, true); assert.equal(env.sockets.length, 2);
  const socket = env.latest(); socket.autoPong = true; socket.open(); await second;
  assert.equal(env.wait.active, false); client.disconnect(); assert.equal(env.timers.size, 0);
});
await test('連點不能建立第二個等待流程或額外socket', async () => {
  const env = fixture(), client = env.client(); const result = env.wait.open(client).catch(error => error.message);
  await assert.rejects(env.wait.open(client), /正在等待/); assert.equal(env.sockets.length, 1);
  env.wait.cancel(); await result; assert.equal(env.wait.cancel(), false); assert.equal(env.timers.size, 0);
});
await test('房間操作被拒絕只執行一次，不將ROOM_FULL等錯誤當成握手重試', async () => {
  const env = fixture(), client = env.client();
  const result = (async () => { await env.wait.open(client); await client.join('ABC234', '甲'); })().catch(error => error.message);
  const socket = env.latest(); socket.autoPong = true; socket.open(); await env.flush();
  const request = entries(env)[0]; assert.ok(request);
  socket.receive({ type: 'error', requestId: request.requestId, code: 'ROOM_FULL', message: '房間已滿' });
  assert.equal(await result, '房間已滿'); await env.advance(60000);
  assert.equal(entries(env).length, 1); assert.equal(env.sockets.length, 1); client.disconnect();
});
await test('即時網路錯誤採1500ms間隔，不忙迴圈且總等待有上限', async () => {
  const env = fixture(), client = env.client(); const result = env.wait.open(client).catch(error => error.message);
  env.latest().emit('error'); await env.flush(); await env.advance(1499); assert.equal(env.sockets.length, 1);
  await env.advance(1); assert.equal(env.sockets.length, 2); env.latest().emit('error'); await env.flush();
  await env.advance(43500); assert.match(await result, /45 秒/); assert.equal(entries(env).length, 0); assert.equal(env.timers.size, 0);
});
await test('進度文字標示可能啟動、已等待及總期限，不假稱已確認服務狀態', async () => {
  const env = fixture(), client = env.client(); const result = env.wait.open(client).catch(error => error.message);
  assert.match(env.context.waitText(env.wait.state), /第 1 次/); await env.advance(7000);
  assert.match(env.context.waitText({ phase: 'connecting', attempt: 2, elapsedSeconds: 8 }), /可能正在啟動.*8 秒.*45 秒/);
  assert.match(env.context.waitText(env.wait.state), /稍後會重試/); env.wait.cancel(); await result;
});
for (const name of sources) assert.equal(digest(await readFile(path.join(project, name))), sourceHashes[name], `Source changed: ${name}`);
report.sourceUnchanged = true; report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
if (report.summary.failed) report.status = 'FAIL';
await writeFile(path.join(project, 'tools/dev-tests/lobbybrake-entry-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
