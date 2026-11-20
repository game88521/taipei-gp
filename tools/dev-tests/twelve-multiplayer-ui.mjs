import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { environment, room } from './multiplayer-map-ui-lifecycle.mjs';
import { Storage } from './lobbybrake-client.mjs';
const files = ['multiplayer.html', 'src/multiplayer-game.ts', 'src/multiplayer.css', 'src/multiplayer-history.ts', 'src/multiplayer-history-ui.ts', 'src/multiplayer-awareness.ts', 'src/multiplayer-network.ts', 'shared/multiplayer-room-rules.ts'];
const sha = b => createHash('sha256').update(b).digest('hex'), hashes = async () => Object.fromEntries(await Promise.all(files.map(async f => [f, sha(await readFile(new URL('../../' + f, import.meta.url)))])));
const report = { localOnly: true, externalRequests: 0, browserUsed: false, realControllerAndUi: true, cases: [], sourceHashes: await hashes(), limitations: ['真game/UI原始碼、storage專用替身與SVG DOM替身；不是瀏覽器畫面/觸控/GPU測試。'] };
async function test(name, fn) { try { await fn(); report.cases.push({ name, status: 'PASS' }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
const caps = { lobbyOptions: true, championship: true, roomRules: true };
function data(extra = {}) { const r = room('taipei', 1, { capabilities: caps, roomRules: { collisions: true, finishGraceSeconds: 60 }, hostManagement: { lobbyRevision: 1 }, serverTime: Date.now(), trackLength: 1000, ...extra });
  for (const [i, p] of r.players.entries()) { p.loaded = true; p.progress = i * 10; p.car = { x: i * 3, z: i * 8, h: 0, v: 0, pos: { i: 0, s: 0, lat: 0 } }; } return r; }
async function enter(env, r) { env.client.update(r, 'connected', 1); env.scene.requested.complete(); await env.flush(); }
await test('舊server隱藏修改規則、新房主可改、房客/series鎖定皆唯讀，全員明示', async () => {
  const env = await environment(); await enter(env, data({ capabilities: undefined, roomRules: undefined })); assert.equal(env.ui('mp-room-rules').hidden, true); assert.match(env.ui('mp-rules-description').textContent, /舊版預設/);
  const r = data({ roomRules: { collisions: false, finishGraceSeconds: 30 } }); env.client.update(r); await env.flush(); assert.equal(env.ui('mp-room-rules').hidden, false); assert.equal(env.ui('mp-collisions').disabled, false); assert.match(env.ui('mp-race-rules').textContent, /無碰撞/);
  r.hostId = 'guest'; env.client.notify(); assert.equal(env.ui('mp-collisions').disabled, true); r.hostId = 'self'; r.series = { locked: true, id: 'series', trackIds: ['taipei', 'japan', 'australia'], roundIndex: 0, revision: 1, standings: [], rounds: [] }; env.client.notify(); assert.equal(env.ui('mp-collisions').disabled, true);
});
await test('真UI合併碰撞/寬限欄位送client，server更新之前不假改權威規則', async () => {
  const env = await environment(); await enter(env, data()); env.ui('mp-collisions').value = 'off'; env.ui('mp-collisions').dispatch('change');
  assert.deepEqual(JSON.parse(JSON.stringify(env.client.commands.at(-1))), { type: 'set-room-rules', roomRules: { collisions: false, finishGraceSeconds: 60 } });
  assert.equal(env.client.room.roomRules.collisions, true); env.ui('mp-finish-grace').value = '120'; env.ui('mp-finish-grace').dispatch('change'); assert.equal(env.client.commands.at(-1).roomRules.finishGraceSeconds, 120);
});
await test('真game在results保存一次，離房仍有近期列表、確認清除後不復活', async () => {
  const storage = new Storage(), env = await environment({ localStorage: storage }); await enter(env, data());
  const r = data({ phase: 'results', matchId: 'fixture-one', laps: 1 }); for (const [i, p] of r.players.entries()) Object.assign(p, { completedLaps: 1, finishMs: 1000 + i * 100, bestLapMs: 1000 + i * 100, lapTimesMs: [1000 + i * 100] });
  env.client.update(r); env.client.notify(); assert.equal(storage.writes.filter(k => k === 'taipei-gp-multiplayer-history-v1').length, 1); assert.equal(env.ui('mp-history-list').children.length, 1);
  env.client.leave(); assert.equal(env.ui('mp-history-list').children.length, 1); env.ui('mp-history-clear').dispatch('click'); assert.equal(env.ui('mp-history-list').children.length, 0);
  env.client.update(r); assert.equal(env.ui('mp-history-list').children.length, 0); assert.equal(storage.getItem('taipei-gp-multiplayer-history-v1'), null);
});
await test('真game開啟資訊後用目前track建立真形狀SVG，顯示公尺差與近車', async () => {
  const env = await environment(); await enter(env, data({ phase: 'racing', matchId: 'race', startAt: 1700000000000 })); env.scene.track = { N: 4, px: [0, 100, 100, 0], pz: [0, 0, 20, 20], py: [0, 0, 0, 0], bank: [0, 0, 0, 0] };
  env.ui('mp-awareness').open = true; env.scene.frameLoop(); const svg = env.ui('mp-track-mini').children[0]; assert.equal(svg.children.filter(n => n.tag === 'circle').length, 2);
  assert.match(env.ui('mp-car-gaps').textContent, /10 m/); assert.match(env.ui('mp-nearby').textContent, /右前/);
});
await test('真game快照停頓提示由monotonic到達時鐘觸發，離開比賽即清除', async () => {
  const env = await environment(); await enter(env, data({ phase: 'racing', matchId: 'race', startAt: 1700000000000 })); env.scene.network.observe(performance.now() - 800, 1000, 1000); env.scene.frameLoop(); assert.match(env.ui('mp-network-warning').textContent, /網路快照已停頓/);
  env.client.leave(); env.scene.frameLoop(); assert.equal(env.ui('mp-network-warning').textContent, '');
});
assert.deepEqual(await hashes(), report.sourceHashes); report.sourceUnchangedDuringTests = true; report.scriptSha256 = sha(await readFile(new URL(import.meta.url)));
report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length }; report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(new URL('twelve-multiplayer-ui-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
