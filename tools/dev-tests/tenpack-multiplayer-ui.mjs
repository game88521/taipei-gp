import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { environment, room } from './multiplayer-map-ui-lifecycle.mjs';
import { Storage } from './lobbybrake-client.mjs';
import { MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { multiplayerEvidence } from './tenpack-multiplayer-evidence.mjs';
const caps = { lobbyOptions: true, championship: true };
const ids = MULTIPLAYER_TRACKS.slice(0, 3).map(track => track.id);
const series = () => ({ id: 'series', revision: 1, trackIds: ids, roundIndex: 0, locked: false, complete: false, entrants: [], standings: [], rounds: [] });
const report = { localOnly: true, externalRequests: 0, realControllerSource: true, isolatedDomAndScene: true, cases: [] };
const finishEvidence = await multiplayerEvidence(report, import.meta.url);
async function test(name, fn) { try { await fn(); report.cases.push({ name, status: 'PASS' }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); } }
async function enter(env, extra = {}) { const value = room('taipei', 1, extra); env.client.update(value, 'connected', 1); env.scene.requested.complete(); await env.flush(); return value; }
await test('舊server隱藏圈數與系列；新server房主可見，房客圈數唯讀', async () => {
  const env = environment(); await enter(env); assert.equal(env.ui('mp-room-laps-field').hidden, true); assert.equal(env.ui('mp-series-setup').hidden, true);
  const value = await enter(env, { capabilities: caps, hostManagement: { lobbyRevision: 1 }, series: null });
  assert.equal(env.ui('mp-room-laps-field').hidden, false); assert.equal(env.ui('mp-room-laps').disabled, false); assert.equal(env.ui('mp-series-setup').hidden, false);
  value.hostId = 'guest'; env.client.notify(); assert.equal(env.ui('mp-room-laps').disabled, true); assert.equal(env.ui('mp-series-setup').hidden, true);
});
await test('真控制器送改圈與合法路線；重複地圖留在本頁明示原因', async () => {
  const env = environment(); await enter(env, { capabilities: caps, hostManagement: { lobbyRevision: 1 }, series: null });
  env.ui('mp-room-laps').value = '5'; env.ui('mp-room-laps').dispatch('change'); assert.equal(env.client.commands.at(-1).laps, 5);
  env.ui('mp-series-create').dispatch('click'); assert.equal(env.client.commands.at(-1).type, 'configure-series');
  const fields = env.ui('mp-series-route').children.map(label => label.children[0]); fields[1].value = fields[0].value;
  const count = env.client.commands.length; env.ui('mp-series-create').dispatch('click'); assert.equal(env.client.commands.length, count); assert.match(env.ui('mp-message').textContent, /不重複/);
  env.ui('mp-series-count').value = '5'; env.ui('mp-series-count').dispatch('change'); assert.ok(env.ui('mp-series-route').children.every(label => !label.hidden));
});
await test('總積分與歷場用文字節點呈現，下一站/完成/明確結束流程正確', async () => {
  const env = environment(); const data = series(); data.locked = true;
  data.standings = [{ playerId: 'self', name: '<img src=x>', rank: 1, points: 10, wins: 1 }];
  data.rounds = [{ matchId: 'one', trackId: 'taipei', laps: 1, results: [{ playerId: 'self', name: '<img src=x>', rank: 1, points: 10, finishMs: 50000, dnf: false }] }];
  const value = await enter(env, { phase: 'results', capabilities: caps, hostManagement: { lobbyRevision: 1 }, series: data });
  assert.equal(env.ui('mp-series-summary').hidden, false); assert.equal(env.ui('mp-room-track').disabled, true); assert.equal(env.ui('mp-series-history').children.length, 1);
  assert.equal(env.ui('mp-series-standings').children[0].children[0].textContent, '1. <img src=x>（你）');
  env.ui('mp-rematch').dispatch('click'); assert.equal(env.client.commands.at(-1).type, 'next-series');
  value.series.complete = true; value.series.revision++; env.client.notify(); assert.equal(env.ui('mp-rematch').disabled, true); assert.match(env.ui('mp-series-title').textContent, /總冠軍/);
  env.ui('mp-series-end').dispatch('click'); assert.equal(env.client.commands.at(-1).type, 'end-series');
});
await test('結束確認期間房間或系列已變動時不送出舊操作', async () => {
  let env; env = environment({ confirm: () => { env.client.room.series.id = 'new-series'; return true; } });
  await enter(env, { capabilities: caps, hostManagement: { lobbyRevision: 1 }, series: series() });
  const count = env.client.commands.length; env.ui('mp-series-end').dispatch('click'); assert.equal(env.client.commands.length, count); assert.match(env.ui('mp-message').textContent, /狀態已更新/);
});
await test('完賽才顯示觀戰/隱藏操控，切換目標與掉線後備；下一場解除', async () => {
  const env = environment(); const value = await enter(env, { phase: 'racing', matchId: 'one' });
  assert.equal(env.ui('mp-spectator-field').hidden, true); value.players[0].finishMs = 50000; value.players[0].loaded = true;
  value.players.push({ ...value.players[1], id: 'guest2', name: '丙' }); env.client.notify();
  assert.equal(env.ui('mp-spectator-field').hidden, false); assert.equal(env.ui('mp-controls').hidden, true); assert.equal(env.mp.input.isDriving(), false);
  env.ui('mp-spectator').value = 'guest2'; env.ui('mp-spectator').dispatch('change'); assert.equal(env.scene.spectatorId, 'guest2');
  value.players[2].connected = false; env.client.notify(); assert.equal(env.scene.spectatorId, 'guest');
  value.phase = 'lobby'; value.players[0].finishMs = null; env.client.notify(); assert.equal(env.ui('mp-spectator-field').hidden, true); assert.equal(env.ui('mp-controls').hidden, false);
});
await test('畫質使用專用儲存鍵，固定省電與標準可即時切回且不改FPS設定', async () => {
  const storage = new Storage(); storage.data.set('taipei-gp-multiplayer-fps-v1', '30'); storage.data.set('taipei-gp-multiplayer-quality-v1', 'economy'); storage.data.set('single-save', 'untouched');
  const env = environment({ localStorage: storage }); assert.equal(env.ui('mp-quality').value, 'economy'); assert.equal(env.scene.qualityLevel, 'economy'); assert.equal(env.ui('mp-fps').value, '30');
  env.ui('mp-quality').value = 'standard'; env.ui('mp-quality').dispatch('change'); assert.equal(env.scene.qualityLevel, 'standard'); assert.equal(storage.getItem('taipei-gp-multiplayer-fps-v1'), '30');
  assert.equal(storage.getItem('single-save'), 'untouched'); assert.deepEqual(storage.writes, ['taipei-gp-multiplayer-quality-v1']);
});
report.status = report.cases.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL'; report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length }; await finishEvidence();
await writeFile(new URL('tenpack-multiplayer-ui-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
