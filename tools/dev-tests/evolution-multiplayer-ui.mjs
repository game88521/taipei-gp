import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { environment, room, Storage } from './lobbybrake-client.mjs';
import { MULTIPLAYER_TRACKS, getMultiplayerTrack } from '../../shared/multiplayer-tracks.ts';
import { defaultEvolution } from '../../shared/multiplayer-evolution.ts';
import { MultiplayerHistory, parseHistory } from '../../src/multiplayer-history.ts';
import { sceneFixture, buildTrack, Car } from './twelve-multiplayer-fixtures.mjs';
import { spectatorTargets } from '../../src/multiplayer-spectator.ts';

const report = { localOnly: true, externalRequests: 0, realClientAndPanelSource: true, isolatedDomAndSocket: true, cases: [], limitations: ['真 client/panel 與隔離 DOM/socket；真 loopback WS 由 evolution-multiplayer-server 另驗，未代表手機、WebGL 或外網。'] };
const source = await readFile(new URL('../../src/multiplayer-evolution-ui.ts', import.meta.url), 'utf8');
report.sourceSha256 = createHash('sha256').update(source).digest('hex');
const caps = { lobbyOptions: true, championship: true, evolution: true, seriesResume: { persistent: true, ttlSeconds: 604800 } };
const evoRoom = (mode = 'race', extra = {}) => room({ capabilities: caps, evolution: { ...defaultEvolution(), mode }, ...extra });
const plain = v => JSON.parse(JSON.stringify(v));
async function test(name, fn) { try { await fn(); report.cases.push({ name, status: 'PASS' }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }

await test('舊 server 隱藏玩法操作，client 不送新命令；新能力精確綁房碼與世代', async () => {
  const legacy = await environment().create(); const count = legacy.socket.sent.length;
  assert.equal(legacy.client.configureEvent('time-trial', 180, {}), false); assert.equal(legacy.client.voteTrack('japan'), false); assert.equal(legacy.socket.sent.length, count);
  const env = environment(), { client, socket } = await env.create(evoRoom());
  assert.equal(client.configureEvent('pursuit', 300, { p1: 5, p2: 0 }), true);
  assert.deepEqual(plain(socket.sent.at(-1)), { type: 'configure-event', mode: 'pursuit', durationSeconds: 300, releaseDelays: { p1: 5, p2: 0 }, roomCode: 'ABC234', expectedLobbyRevision: 1 });
  assert.equal(client.voteTrack('japan'), true); assert.equal(socket.sent.at(-1).expectedVoteRevision, 1);
  socket.receive({ type: 'room', room: evoRoom('race', { hostId: 'p2', hostManagement: { lobbyRevision: 2 }, serverTime: client.room.serverTime + 1 }) });
  assert.equal(client.resolveVote(), false); assert.equal(client.randomSeries(3), false); assert.equal(client.voteTrack('japan'), true);
});

await test('限時賽可超過圈數，finishMs 驗最快有效圈；一般賽仍拒絕超圈', () => {
  const client = environment().client(), r = evoRoom('time-trial', { phase: 'results', startAt: 1700000000000, matchId: 'tt' });
  for (const p of r.players) Object.assign(p, { completedLaps: 6, lapTimesMs: [30000, 31000, 29000, 32000, 33000, 34000], bestLapMs: 29000, finishMs: 29000 });
  assert.doesNotThrow(() => client.validateRoom(r));
  const bad = structuredClone(r); bad.players[0].finishMs = 189000; assert.throws(() => client.validateRoom(bad), /逐圈/);
  const race = structuredClone(r); race.evolution.mode = 'race'; assert.throws(() => client.validateRoom(race), /逐圈/);
});

await test('讓秒放行前 client 不送輸入，共同時間與淨跑時間分別驗證', async () => {
  const r = evoRoom('pursuit', { phase: 'racing', startAt: 1700000000000, matchId: 'pursuit' }); r.evolution.releaseDelays = { p1: 5, p2: 0 };
  const env = environment(), { client, socket } = await env.create(r); assert.equal(client.sendInput(1, false), false);
  await env.advance(5000); assert.equal(client.sendInput(1, false), true);
  const done = structuredClone(r); done.phase = 'results'; Object.assign(done.players[0], { completedLaps: 3, lapTimesMs: [1000, 1000, 1000], bestLapMs: 1000, finishMs: 8000, netFinishMs: 3000 });
  assert.doesNotThrow(() => client.validateRoom(done)); done.players[0].netFinishMs = 8000; assert.throws(() => client.validateRoom(done));
  assert.equal(socket.sent.filter(m => m.type === 'input').length, 1);
});

await test('系列席位能力依seriesId保存，live session輪替不覆寫舊checkpoint席位能力', async () => {
  const storage = new Storage(), env = environment({ localStorage: storage });
  const { client } = await env.create(evoRoom());
  const locked = evoRoom(); locked.series = { id: 'stable-series', revision: 2, locked: true, entrants: [{ playerId: 'p1' }] };
  client.preserveSeriesSeat(locked); const key = 'taipei-gp-multiplayer-series-seats-v1';
  const original = JSON.parse(storage.getItem(key))[0].token;
  client.credentials.token = 'rotated-live-session-token'; locked.series.revision++;
  client.preserveSeriesSeat(locked); let records = JSON.parse(storage.getItem(key));
  assert.equal(records[0].token, original); assert.equal(records[0].seriesId, 'stable-series');
  assert.equal(client.savedSeriesSeats[0].key, 'stable-series:p1');
  locked.series.id = 'second-series'; client.preserveSeriesSeat(locked); records = JSON.parse(storage.getItem(key));
  assert.equal(records.length, 2); assert.equal(records[0].token, 'rotated-live-session-token'); assert.equal(records[1].token, original);
  assert.equal(records[1].seriesId, 'stable-series');
});

await test('末圈完成等待結算時停止 client 輸入及真 scene 預測，仍可觀戰未完成對手', async () => {
  const track = buildTrack(), car = new Car(); car.placeAt(track, 0);
  const r = evoRoom('time-trial', { phase: 'racing', startAt: 1700000000000, matchId: 'done', serverTime: 1700000181000 });
  r.players.forEach((p, i) => { p.car = car.snapshot(); p.car.x += i * 20; }); r.players[0].timeTrialDone = true;
  const { client, socket } = await environment().create(r); assert.equal(client.sendInput(1, false), false); assert.equal(socket.sent.some(m => m.type === 'input'), false);
  const fixture = sceneFixture(r, 'p1', track); fixture.scene.accept(r, 'p1', r.serverTime); const before = fixture.scene.car.snapshot();
  for (let i = 1; i <= 30; i++) fixture.frame(r.serverTime + i * 16, .016);
  assert.deepEqual(fixture.scene.car.snapshot(), before); assert.deepEqual(spectatorTargets(r, 'p1').map(p => p.id), ['p2']);
  const pursuit = structuredClone(r); pursuit.evolution.mode = 'pursuit'; delete pursuit.players[0].timeTrialDone; pursuit.startAt = pursuit.serverTime; pursuit.evolution.releaseDelays.p1 = 5;
  const locked = sceneFixture(pursuit, 'p1', track); locked.scene.accept(pursuit, 'p1', pursuit.serverTime); const parked = locked.scene.car.snapshot();
  for (let i = 1; i <= 30; i++) locked.frame(pursuit.serverTime + i * 16, .016);
  assert.deepEqual(locked.scene.car.snapshot(), parked);
});

await test('戰績保留玩法分類與讓秒雙時間，不包含 checkpoint/token/endpoint', () => {
  const r = evoRoom('pursuit', { phase: 'results', startAt: 1700000000000, matchId: 'history' }); r.evolution.releaseDelays = { p1: 5, p2: 0 };
  for (const [i, p] of r.players.entries()) Object.assign(p, { completedLaps: 3, lapTimesMs: [1000, 1000, 1000], bestLapMs: 1000, finishMs: 8000 + i, netFinishMs: 3000 + i });
  r.token = 'DO-NOT-EXPORT'; r.endpoint = 'PRIVATE-ENDPOINT';
  const h = new MultiplayerHistory(new Storage()); assert.equal(h.capture(r, 'p1'), true);
  const out = h.export(), parsed = parseHistory(out); assert.equal(parsed[0].mode, 'pursuit'); assert.equal(parsed[0].players[0].netFinishMs, 3000); assert.equal(parsed[0].players[0].releaseDelaySeconds, 5);
  for (const forbidden of ['DO-NOT-EXPORT', 'PRIVATE-ENDPOINT', 'checkpoint', 'token', 'playerId']) assert.equal(out.includes(forbidden), false);
  const tt = structuredClone(r); tt.matchId = 'tt-history'; tt.evolution.mode = 'time-trial'; tt.players.forEach(p => { p.lapTimesMs = Array(8).fill(1000); p.completedLaps = 8; p.finishMs = 1000; });
  assert.equal(h.capture(tt, 'p1'), true); assert.equal(parseHistory(h.export())[0].mode, 'time-trial');
});

function panelEnvironment() {
  class Element {
    children = []; listeners = new Map(); hidden = false; disabled = false; value = ''; textContent = ''; dataset = {}; style = {}; files = [];
    append(...children) { this.children.push(...children); } appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.children = children; } setAttribute() {} remove() {} click() { return this.dispatch('click'); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
    dispatch(type) { for (const fn of this.listeners.get(type) ?? []) fn({}); }
  }
  const elements = new Map(), element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const storage = new Storage(), calls = [], resumed = [], claims = [], revoked = [], lifecycle = new Map();
  const client = { url: 'ws://127.0.0.1:4320/ws', selfId: 'p1', room: evoRoom(), savedSeriesSeats: [{ playerId: 'original-p1', name: '原車手' }],
    configureEvent(...args) { calls.push(['configure', ...args]); return true; }, selectTeam(...args) { calls.push(['team', ...args]); },
    voteTrack(...args) { calls.push(['vote', ...args]); }, resolveVote() { calls.push(['resolve']); }, randomSeries(...args) { calls.push(['random', ...args]); }, checkpointSeries() { calls.push(['checkpoint']); return true; } };
  const document = { getElementById: element, createElement: () => new Element(), body: new Element() };
  const context = vm.createContext({ document, localStorage: storage, MULTIPLAYER_TRACKS, getMultiplayerTrack, Date, Blob, console,
    URL: { createObjectURL: () => 'blob:checkpoint-test', revokeObjectURL: url => revoked.push(url) },
    addEventListener: (type, fn) => { lifecycle.set(type, [...(lifecycle.get(type) ?? []), fn]); },
    setText: (e, text) => { e.textContent = text; } });
  const code = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import[^\n]*\r?\n/gm, '').replace(/\bexport /g, '');
  vm.runInContext(code + '\nglobalThis.Panel=MultiplayerEvolutionPanel;globalThis.release=releaseRemaining;', context);
  const panel = new context.Panel(() => client, () => {}, token => resumed.push(token), id => claims.push(id));
  return { panel, client, element, elements, storage, calls, resumed, claims, context, revoked,
    lifecycle(type) { for (const fn of lifecycle.get(type) ?? []) fn({}); } };
}

await test('真 panel 選玩法、讓秒、選隊、投票與隨機系列均有可操作 UI', () => {
  const e = panelEnvironment(); e.panel.render(e.client.room, 'p1', true, false);
  e.element('mp-event-mode').value = 'pursuit'; e.element('mp-event-mode').dispatch('change'); assert.equal(e.element('mp-event-delays').hidden, false);
  e.element('mp-event-delays').children[0].children[0].value = '10'; e.element('mp-event-duration').value = '180'; e.element('mp-event-apply').click();
  assert.deepEqual(plain(e.calls.at(-1)), ['configure', 'pursuit', 180, { p1: 10, p2: 0 }]);
  e.element('mp-team-red').click(); e.element('mp-vote-track').value = 'japan'; e.element('mp-vote-submit').click();
  e.element('mp-vote-resolve').click(); e.element('mp-series-count').value = '5'; e.element('mp-series-random').click();
  assert.deepEqual(plain(e.calls.slice(1)), [['team', 'red'], ['vote', 'japan'], ['resolve'], ['random', 5]]);
  e.client.room.evolution.vote.ballots = { p1: 'japan', p2: 'taipei' }; e.panel.render(e.client.room, 'p1', true, false);
  assert.equal(e.element('mp-vote-tally').children[0].textContent.includes('台北'), true);
  e.client.room.capabilities = undefined; e.panel.render(e.client.room, 'p1', true, false); assert.equal(e.element('mp-evolution').hidden, true);
});

await test('簽名續賽檔只保存不顯示 token，原席位可恢復，未設固定 key 明示重啟失效', () => {
  const e = panelEnvironment(); e.client.room.phase = 'results'; e.client.room.series = { complete: false, originalHostId: 'p1' };
  const token = 'OPAQUE-SIGNED-SECRET-TOKEN'; e.panel.receiveCheckpoint({ token, expiresAt: Date.now() + 3600000, persistent: false });
  assert.ok([...e.storage.data.values()].some(v => v.includes(token))); e.panel.render(e.client.room, 'p1', true, false);
  assert.equal(e.element('mp-series-checkpoint-download').hidden, false);
  assert.ok(e.element('mp-series-checkpoint-status').textContent.includes('重啟後此檔案會失效'));
  for (const el of e.elements.values()) assert.equal(el.textContent.includes(token), false);
  e.client.room = null; e.panel.render(null, null, true, false); e.element('mp-series-resume-saved').click(); assert.deepEqual(e.resumed, [token]);
  e.element('mp-series-seat').value = 'original-p1'; e.element('mp-series-seat-claim').click(); assert.deepEqual(e.claims, ['original-p1']);
  e.element('mp-series-resume-token').value = token; e.element('mp-series-resume-paste').click(); assert.equal(e.element('mp-series-resume-token').value, '');
});

await test('讓秒倒數及限時寬限使用伺服器時鐘邊界', () => {
  const e = panelEnvironment(), r = evoRoom('pursuit', { phase: 'racing', startAt: 1000 }); r.evolution.releaseDelays.p1 = 5;
  assert.equal(e.context.release(r, 'p1', 5999), 1); assert.equal(e.context.release(r, 'p1', 6000), 0); assert.equal(e.context.release(r, 'p1', 9000), 0);
});

await test('慢速File.text取消/新意圖/切房/endpoint/世代/忙碌/離頁均不得晚到續賽', async () => {
  const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
  for (const change of [e => e.element('mp-series-import-cancel').click(), e => e.element('mp-create').click(),
    e => e.element('mp-join').click(), e => e.element('mp-cancel-connect').click(), e => { e.client.room = evoRoom(); },
    e => { e.client.url = 'ws://127.0.0.1:9999/ws'; }, e => { e.client.connectionGeneration = 2; },
    e => { e.panel.render(null, null, true, true); e.panel.render(null, null, true, false); },
    e => { e.lifecycle('pagehide'); e.lifecycle('pageshow'); }]) {
    const e = panelEnvironment(); e.client.room = null; e.client.connectionGeneration = 1; e.panel.render(null, null, true, false);
    let resolve; const text = new Promise(r => { resolve = r; });
    e.element('mp-series-resume-file').files = [{ size: 100, text: () => text }]; e.element('mp-series-resume-file').dispatch('change');
    assert.equal(e.element('mp-series-import-cancel').hidden, false); change(e);
    resolve(JSON.stringify({ token: 'late-opaque-token-never-used' })); await flush(); assert.deepEqual(e.resumed, []);
  }
  const e = panelEnvironment(); e.client.room = null; e.panel.render(null, null, true, false);
  let resolveFirst; const first = new Promise(r => { resolveFirst = r; });
  e.element('mp-series-resume-file').files = [{ size: 100, text: () => first }]; e.element('mp-series-resume-file').dispatch('change');
  e.element('mp-series-resume-file').files = [{ size: 100, text: async () => JSON.stringify({ token: 'latest-opaque-token' }) }]; e.element('mp-series-resume-file').dispatch('change');
  await flush(); resolveFirst(JSON.stringify({ token: 'obsolete-opaque-token' })); await flush(); assert.deepEqual(e.resumed, ['latest-opaque-token']);
});

await test('續賽下載URL於替換及pagehide回收，晚到讀檔不回寫狀態', () => {
  const e = panelEnvironment(); e.client.room.phase = 'results'; e.client.room.series = { complete: false, originalHostId: 'p1' };
  e.panel.receiveCheckpoint({ token: 'opaque-download-token', expiresAt: Date.now() + 60000, persistent: true });
  e.element('mp-series-checkpoint-download').click(); e.element('mp-series-checkpoint-download').click();
  assert.deepEqual(e.revoked, ['blob:checkpoint-test']); e.lifecycle('pagehide'); assert.deepEqual(e.revoked, ['blob:checkpoint-test', 'blob:checkpoint-test']);
});

report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length };
report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(new URL('evolution-multiplayer-ui-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary)); if (report.summary.failed) process.exitCode = 1;
