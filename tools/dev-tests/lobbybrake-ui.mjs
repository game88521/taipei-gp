import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { environment, room, controllerFixtureHashes } from './multiplayer-map-ui-lifecycle.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'PASS', localOnly: true, productionUsed: false, externalRequests: 0, sourceHashes: { ...controllerFixtureHashes }, cases: [], limitations: ['真控制器與真等待協調器，DOM／client／場景為替身；實際WebSocket另有server/client與browser測試。'] };
report.sourceHashes['tools/dev-tests/multiplayer-map-ui-lifecycle.mjs'] = digest(await readFile(path.join(project, 'tools/dev-tests/multiplayer-map-ui-lifecycle.mjs')));
const test = async (name, run) => { try { report.cases.push({ name, status: 'PASS', details: await run() }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); } };
const managed = (extra = {}) => room('taipei', 1, { hostManagement: { lobbyRevision: 1 }, ...extra });

await test('等待可見且可取消；保留輸入、解除busy，晚到open不加入', async () => {
  let release; const connect = new Promise(resolve => { release = resolve; });
  const env = await environment({ connect: () => connect }); assert.equal(env.client.commands.length, 0);
  env.ui('mp-name').value = '朋友'; env.ui('mp-code').value = 'ABC234';
  env.ui('mp-join').dispatch('click'); await env.flush();
  assert.equal(env.ui('mp-entry-wait').hidden, false); assert.match(env.ui('mp-entry-progress').textContent, /正在連線/);
  assert.equal(env.ui('mp-join').disabled, true); env.ui('mp-cancel-connect').dispatch('click'); await env.flush();
  assert.equal(env.ui('mp-entry-wait').hidden, true); assert.equal(env.ui('mp-join').disabled, false);
  assert.equal(env.ui('mp-name').value, '朋友'); assert.equal(env.ui('mp-code').value, 'ABC234');
  assert.match(env.ui('mp-message').textContent, /已取消連線/); assert.equal(env.ui('mp-entry-retry').hidden, true);
  release(); await env.flush(); assert.equal(env.client.commands.length, 0); assert.equal(env.client.disconnects, 1);
});
await test('房間拒絕不自動重送，明確重試按鈕沿用目前輸入', async () => {
  const env = await environment(); env.ui('mp-code').value = 'ABC234';
  let requests = 0; env.client.join = async () => { requests++; throw new Error('房間已滿'); };
  env.ui('mp-join').dispatch('click'); await env.flush();
  assert.equal(requests, 1); assert.match(env.ui('mp-message').textContent, /房間已滿/); assert.equal(env.ui('mp-entry-retry').hidden, false);
  env.client.join = async (code, name) => { requests++; env.client.commands.push({ code, name }); };
  env.ui('mp-name').value = '改名'; env.ui('mp-code').value = 'DEF234'; env.ui('mp-entry-retry').dispatch('click'); await env.flush();
  assert.equal(requests, 2); assert.equal(env.client.commands[0].code, 'DEF234'); assert.equal(env.client.commands[0].name, '改名');
  assert.equal(env.ui('mp-entry-retry').hidden, true);
});
await test('舊連線錯誤不覆蓋本次空暱稱／無效房碼提示，也不建立連線', async () => {
  let connections = 0; const env = await environment({ connect: async () => { connections++; } });
  env.client.error = '舊連線錯誤'; env.ui('mp-code').value = 'ABC234'; env.ui('mp-name').value = '';
  env.ui('mp-join').dispatch('click'); await env.flush(); assert.match(env.ui('mp-message').textContent, /車手名稱/);
  env.ui('mp-name').value = '甲'; env.ui('mp-code').value = 'BAD'; env.ui('mp-join').dispatch('click'); await env.flush();
  assert.match(env.ui('mp-message').textContent, /6 碼/); assert.equal(connections, 0);
});
await test('支援能力＋房主＋大廳才顯示管理；舊server、非房主、比賽中隱藏', async () => {
  const env = await environment(); env.client.update(room('taipei')); assert.equal(env.ui('mp-host-controls').hidden, true);
  env.client.update(managed()); assert.equal(env.ui('mp-host-controls').hidden, false);
  assert.equal(env.ui('mp-host-target').children.length, 1); assert.equal(env.ui('mp-host-target').value, 'guest');
  env.client.update(managed({ hostId: 'guest' })); assert.equal(env.ui('mp-host-controls').hidden, true);
  env.client.update(managed({ phase: 'countdown' })); assert.equal(env.ui('mp-host-controls').hidden, true);
  env.client.update(managed({ phase: 'racing' })); assert.equal(env.ui('mp-host-controls').hidden, true);
});
await test('離線車手可移出但不能交棒；無目標或失聯時停用按鈕', async () => {
  const env = await environment(), value = managed(); value.players[1].connected = false; env.client.update(value);
  assert.equal(env.ui('mp-host-transfer').disabled, true); assert.equal(env.ui('mp-host-kick').disabled, false);
  env.ui('mp-host-transfer').dispatch('click'); assert.equal(env.client.commands.length, 0);
  env.client.update(value, 'reconnecting'); assert.equal(env.ui('mp-host-kick').disabled, true);
  env.client.update(managed({ players: [value.players[0]] })); assert.equal(env.ui('mp-host-target').value, '');
  assert.equal(env.ui('mp-host-kick').disabled, true); assert.equal(env.ui('mp-host-transfer').disabled, true);
});
await test('原生確認取消不送出；確認後才送給選定車手', async () => {
  let accepted = false; const env = await environment({ confirm: () => accepted }); env.client.update(managed());
  env.ui('mp-host-kick').dispatch('click'); assert.equal(env.client.commands.length, 0);
  accepted = true; env.ui('mp-host-kick').dispatch('click');
  assert.equal(env.client.commands.length, 1); assert.equal(env.client.commands[0].type, 'kick-player'); assert.equal(env.client.commands[0].targetPlayerId, 'guest');
});
await test('確認期間換圖／大廳版本或房主改變，不送出晚到管理命令', async () => {
  let env; env = await environment({ confirm: () => { env.client.update(managed({ hostManagement: { lobbyRevision: 2 } })); return true; } });
  env.client.update(managed()); env.ui('mp-host-transfer').dispatch('click');
  assert.equal(env.client.commands.length, 0); assert.match(env.ui('mp-message').textContent, /大廳狀態已變更/);
  let env2; env2 = await environment({ confirm: () => { env2.client.update(managed({ hostId: 'guest' })); return true; } });
  env2.client.update(managed()); env2.ui('mp-host-kick').dispatch('click'); assert.equal(env2.client.commands.length, 0);
});
await test('確認期間目標離線不交棒；交棒後舊房主立即失去管理入口', async () => {
  let env; env = await environment({ confirm: () => { const value = managed(); value.players[1].connected = false; env.client.update(value); return true; } });
  env.client.update(managed()); env.ui('mp-host-transfer').dispatch('click'); assert.equal(env.client.commands.length, 0);
  const next = await environment(); next.client.update(managed()); next.ui('mp-host-transfer').dispatch('click');
  assert.equal(next.client.commands[0].type, 'transfer-host'); next.client.update(managed({ hostId: 'guest', hostManagement: { lobbyRevision: 2 } }));
  assert.equal(next.ui('mp-host-controls').hidden, true); next.ui('mp-host-kick').dispatch('click'); assert.equal(next.client.commands.length, 1);
});
await test('穩定大廳不重建管理選單；離房與新房不沿用舊目標', async () => {
  const env = await environment(); env.client.update(managed()); const option = env.ui('mp-host-target').children[0];
  for (let n = 0; n < 20; n++) env.client.update(managed()); assert.equal(env.ui('mp-host-target').children[0], option);
  env.client.update(null, 'disconnected'); assert.equal(env.ui('mp-host-controls').hidden, true);
  const value = managed({ code: 'DEF234' }); value.players[1].id = 'new-guest'; env.client.update(value);
  assert.equal(env.ui('mp-host-target').value, 'new-guest'); assert.notEqual(env.ui('mp-host-target').children[0], option);
});
report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status !== 'PASS').length };
if (report.summary.failed) report.status = 'FAIL';
await writeFile(path.join(project, 'tools/dev-tests/lobbybrake-ui-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
