import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { environment, room } from './lobbybrake-client.mjs';
import { MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { validSeries, seriesStandings } from '../../shared/multiplayer-series.ts';
import { multiplayerEvidence } from './tenpack-multiplayer-evidence.mjs';
const tracks = MULTIPLAYER_TRACKS.slice(0, 3).map(track => track.id);
const caps = { lobbyOptions: true, championship: true };
const report = { localOnly: true, externalRequests: 0, realClientSource: true, isolatedSockets: true, cases: [] };
const finishEvidence = await multiplayerEvidence(report, import.meta.url);
async function test(name, fn) { try { await fn(); report.cases.push({ name, status: 'PASS' }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); } }
const plain = value => JSON.parse(JSON.stringify(value));
const unlocked = () => ({ id: 'series', revision: 1, trackIds: tracks, roundIndex: 0, locked: false, complete: false, entrants: [], rounds: [], standings: [] });
function completeRound() {
  const entrants = [{ playerId: 'p1', name: '赤焰', color: '#ff3300' }, { playerId: 'p2', name: '藍流', color: '#ff3300' }];
  const rounds = [{ matchId: 'race', trackId: tracks[0], laps: 3, results: entrants.map((entrant, index) => ({ ...entrant, rank: index + 1, finishMs: 1000 + index * 100, dnf: false, points: index ? 6 : 10 })) }];
  return { ...unlocked(), revision: 3, locked: true, entrants, rounds, standings: seriesStandings(entrants, rounds) };
}
await test('舊server省略能力仍可玩；新圈數/系列命令不傳送', async () => {
  const env = environment(); const { client, socket } = await env.create(); const count = socket.sent.length;
  assert.equal(client.setLaps(1), false); assert.equal(client.configureSeries(tracks), false); assert.equal(client.endSeries(), false); assert.equal(client.nextSeries(), false); assert.equal(socket.sent.length, count);
});
await test('圈數與系列命令精確綁房碼/世代，僅房主大廳可設置', async () => {
  const env = environment(); const { client, socket } = await env.create({ capabilities: caps, series: null });
  assert.equal(client.setLaps(5), true); assert.deepEqual(plain(socket.sent.at(-1)), { type: 'set-laps', laps: 5, roomCode: 'ABC234', expectedLobbyRevision: 1 });
  assert.equal(client.configureSeries(tracks), true); assert.deepEqual(plain(socket.sent.at(-1)), { type: 'configure-series', trackIds: tracks, roomCode: 'ABC234', expectedLobbyRevision: 1 });
  const count = socket.sent.length; assert.equal(client.configureSeries([tracks[0], tracks[0], tracks[2]]), false); assert.equal(client.setLaps(2), false); assert.equal(socket.sent.length, count);
  socket.receive({ type: 'room', room: room({ capabilities: caps, series: null, hostId: 'p2', hostManagement: { lobbyRevision: 2 } }) });
  assert.equal(client.setLaps(1), false); assert.equal(client.configureSeries(tracks), false);
});
await test('下一站綁目前match與series世代，完成與非房主均不可傳送', async () => {
  const env = environment(); const { client, socket } = await env.create({ capabilities: caps, series: completeRound(), phase: 'results', matchId: 'race', startAt: 1700000000000 });
  assert.equal(client.nextSeries(), true); assert.deepEqual(plain(socket.sent.at(-1)), { type: 'next-series', roomCode: 'ABC234', matchId: 'race', expectedSeriesRevision: 3 });
  assert.equal(client.endSeries(), true); assert.deepEqual(plain(socket.sent.at(-1)), { type: 'end-series', roomCode: 'ABC234', expectedLobbyRevision: 1 });
  client.room.series.complete = true; assert.equal(client.nextSeries(), false);
});
await test('惡意能力與系列資料明確拒絕，舊省略及合法完整資料可讀', async () => {
  const env = environment(); const client = env.client();
  for (const capabilities of [null, [], {}, { lobbyOptions: true }, { lobbyOptions: 'true', championship: true }]) assert.throws(() => client.validateRoom(room({ capabilities })));
  for (const mutation of [series => { series.standings[0].points = 999; }, series => { series.roundIndex = 2; }, series => { series.rounds[0].results[0].points = 6; }, series => { series.rounds[0].results[1].playerId = 'p1'; }, series => { series.rounds[0].results[0].finishMs = '1000'; }]) {
    const series = completeRound(); mutation(series); assert.equal(validSeries(series, 'taipei', 'results'), false); assert.throws(() => client.validateRoom(room({ capabilities: caps, series, phase: 'results', matchId: 'race', startAt: 1700000000000 })));
  }
  assert.doesNotThrow(() => client.validateRoom(room())); assert.doesNotThrow(() => client.validateRoom(room({ capabilities: caps, series: unlocked() })));
});
await test('較晚到的舊series世代不覆蓋新積分', async () => {
  const env = environment(); const { client, socket } = await env.create({ capabilities: caps, series: completeRound(), phase: 'results', matchId: 'race', startAt: 1700000000000 });
  const stale = completeRound(); stale.revision = 2;
  socket.receive({ type: 'room', room: room({ capabilities: caps, series: stale, phase: 'results', matchId: 'race', startAt: 1700000000000, serverTime: 1700000001000 }) });
  assert.equal(client.room.series.revision, 3);
});
await test('完賽與DNF之後真client不再送駕駛輸入，觀戰無法控制他車', async () => {
  const env = environment(); const value = room({ capabilities: caps, series: null, phase: 'racing', matchId: 'race', startAt: 1700000000000 });
  const { client, socket } = await env.create(value); assert.equal(client.sendInput(.2, false), true);
  const finished = room({ capabilities: caps, series: null, phase: 'racing', matchId: 'race', startAt: 1700000000000, serverTime: 1700000000010 });
  Object.assign(finished.players[0], { completedLaps: 3, lapTimesMs: [1000, 1000, 1000], bestLapMs: 1000, finishMs: 3000 }); socket.receive({ type: 'snapshot', room: finished });
  const count = socket.sent.filter(message => message.type === 'input').length; assert.equal(client.sendInput(1, false), false); assert.equal(client.sendInput(0, true), false);
  assert.equal(socket.sent.filter(message => message.type === 'input').length, count);
  const other = environment(); const dnf = room({ phase: 'racing', matchId: 'race', startAt: 1700000000000 }); dnf.players[0].dnf = true;
  const created = await other.create(dnf); assert.equal(created.client.sendInput(1, false), false);
});
report.status = report.cases.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL'; report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length }; await finishEvidence();
await writeFile(new URL('tenpack-multiplayer-client-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
