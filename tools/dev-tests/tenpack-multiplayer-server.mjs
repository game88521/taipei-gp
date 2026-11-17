// Real loopback WebSocket commands and RoomService lifecycle. Result fixtures are
// seeded inside the isolated service to test series accounting, never over wire.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createMultiplayerServer } from '../../server/index.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../../shared/multiplayer-protocol.ts';
import { MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { validSeries, validSeriesTracks, seriesStandings } from '../../shared/multiplayer-series.ts';
import { WireClient, ORIGIN, settle } from './multiplayer-test-helpers.mjs';
import { multiplayerEvidence } from './tenpack-multiplayer-evidence.mjs';
const identity = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP };
const tracks = MULTIPLAYER_TRACKS.slice(0, 5).map(track => track.id);
const report = { localOnly: true, externalRequests: 0, realWebSocket: true, resultFixtures: true, cases: [], limitations: ['Series finish times are service-side fixtures; these cases prove lifecycle/accounting, not real lap driving or network latency.'] };
const finishEvidence = await multiplayerEvidence(report, import.meta.url);
async function test(name, fn) { try { await fn(); report.cases.push({ name, status: 'PASS' }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack }); } }
async function harness(fn) {
  let now = 1000000; const app = createMultiplayerServer({ now: () => now, autoTick: false, allowedOrigins: [ORIGIN] });
  await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve)); const clients = [];
  const open = async () => { const wire = await new WireClient(`ws://127.0.0.1:${app.httpServer.address().port}/ws`).open(); clients.push(wire); return wire; };
  const send = async (wire, message, predicate = response => response.room || response.type === 'error') => { await settle(); const mark = wire.mark(); wire.send(message); return wire.until(predicate, mark); };
  const enter = async (wire, message) => send(wire, { ...identity, ...message }, response => response.type === 'welcome' || response.type === 'error');
  const a = await open(), aw = await enter(a, { type: 'create', name: '同名車手', laps: 1 });
  const b = await open(), bw = await enter(b, { type: 'join', code: aw.room.code, name: '同名車手' });
  const room = app.service.rooms.get(aw.room.code);
  const lobby = () => ({ roomCode: room.code, expectedLobbyRevision: room.lobbyRevision });
  const selection = () => ({ trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
  const load = async wire => send(wire, { type: 'track-loaded', ...selection() });
  const begin = async (wires = [a, b], starter = a) => {
    for (const wire of wires.filter(wire => !wire.closed)) { await load(wire); await send(wire, { type: 'ready', ready: true, ...selection() }); }
    const begun = await send(starter, { type: 'start', trackRevision: room.trackRevision }); assert.equal(begun.room?.phase, 'countdown');
    now = room.startAt; app.service.tick(now); await settle(); assert.equal(room.phase, 'racing');
  };
  const finish = async (dnfIds = []) => {
    let rank = 0;
    for (const player of room.players.values()) {
      if (dnfIds.includes(player.id)) { player.dnf = true; player.dnfReason = 'left'; player.finishMs = null; }
      else { player.finishMs = 1000 + rank++ * 100; player.completedLaps = room.laps; player.lapTimesMs = Array(room.laps).fill(player.finishMs / room.laps); player.bestLapMs = player.lapTimesMs[0]; }
    }
    assert.equal(app.service.maybeFinish(room, now), true); await settle();
  };
  const configure = async (ids = tracks.slice(0, 3)) => { const response = await send(a, { type: 'configure-series', trackIds: ids, ...lobby() }); assert.equal(response.type, 'room'); return response; };
  const next = async wire => send(wire ?? a, { type: 'next-series', roomCode: room.code, matchId: room.matchId, expectedSeriesRevision: room.series.revision });
  try { await fn({ app, room, a, b, aw, bw, open, enter, send, lobby, selection, load, begin, finish, configure, next, now: () => now, advance: ms => { now += ms; app.service.tick(now); } }); }
  finally { await Promise.all(clients.map(wire => wire.close())); await app.close(); }
}
await test('系列路線只允許3~5張唯一合法地圖', () => {
  assert.equal(validSeriesTracks(tracks.slice(0, 3)), true); assert.equal(validSeriesTracks(tracks), true);
  for (const value of [tracks.slice(0, 2), [...tracks, 'not-a-map'], [tracks[0], tracks[0], tracks[1]], [tracks[0], tracks[1], 3], null]) assert.equal(validSeriesTracks(value), false);
});
await test('圈數操作限制房主/房碼/大廳世代/合法值，換圈清準備及舊地圖確認', () => harness(async h => {
  await h.load(h.a); await h.load(h.b); await h.send(h.a, { type: 'ready', ready: true, ...h.selection() });
  const revision = h.room.trackRevision, stale = h.selection();
  for (const [wire, extra, code] of [[h.b, {}, 'HOST_ONLY'], [h.a, { roomCode: 'ABC234' }, 'STALE_LOBBY'], [h.a, { expectedLobbyRevision: 0 }, 'STALE_LOBBY'], [h.a, { laps: 2 }, 'BAD_MESSAGE']]) {
    const response = await h.send(wire, { type: 'set-laps', laps: 3, ...h.lobby(), ...extra }); assert.equal(response.code, code);
  }
  await h.send(h.a, { type: 'set-laps', laps: 5, ...h.lobby() }); assert.equal(h.room.laps, 5); assert.equal(h.room.trackRevision, revision + 1);
  assert.ok([...h.room.players.values()].every(player => !player.ready && !player.loaded));
  assert.equal((await h.send(h.b, { type: 'ready', ready: true, ...stale })).code, 'STALE_TRACK');
  assert.deepEqual(h.app.service.snapshot(h.room).capabilities, { lobbyOptions: true, championship: true, roomRules: true });
}));
await test('無效路線不突變房間，合法五站原子建立', () => harness(async h => {
  const revision = h.room.lobbyRevision;
  for (const ids of [tracks.slice(0, 2), [tracks[0], tracks[0], tracks[1]], [tracks[0], tracks[1], 'evil']]) assert.equal((await h.send(h.a, { type: 'configure-series', trackIds: ids, ...h.lobby() })).code, 'INVALID_SERIES');
  assert.equal(h.room.series, null); assert.equal(h.room.lobbyRevision, revision);
  await h.configure(tracks); assert.equal(h.room.series.trackIds.length, 5); assert.equal(validSeries(h.app.service.snapshot(h.room).series, h.room.trackId, h.room.phase), true);
}));
await test('同名車手按穩定ID鎖名單，單場換圖與舊reset不能繞過系列', () => harness(async h => {
  await h.configure(); await h.begin(); assert.equal(h.room.series.locked, true); assert.equal(new Set(h.room.series.entrants.map(row => row.playerId)).size, 2);
  await h.finish(); assert.equal((await h.send(h.a, { type: 'reset' })).code, 'SERIES_ACTIVE');
  await h.next(); const guest = await h.open(); assert.equal((await h.enter(guest, { type: 'join', code: h.room.code, name: '新車手' })).code, 'SERIES_LOCKED');
  assert.equal((await h.send(h.a, { type: 'select-track', trackId: tracks[4], expectedRevision: h.room.trackRevision })).code, 'SERIES_ACTIVE');
}));
await test('三站完整流程：計分只一次、DNF0、下一站重載/重新準備、最終總排名/歷場', () => harness(async h => {
  await h.configure();
  for (let index = 0; index < 3; index++) {
    await h.begin(); await h.finish(index === 1 ? [h.bw.playerId] : []);
    assert.equal(h.room.series.rounds.length, index + 1);
    const before = structuredClone(h.room.series); h.app.service.maybeFinish(h.room, h.now()); h.app.service.recordSeriesRound(h.room); assert.deepEqual(h.room.series, before);
    assert.equal(validSeries(h.app.service.snapshot(h.room).series, h.room.trackId, h.room.phase), true);
    if (index < 2) { const oldMatch = h.room.matchId; await h.next(); assert.equal(h.room.trackId, tracks[index + 1]); assert.equal(h.room.matchId, null); assert.ok([...h.room.players.values()].every(player => !player.ready && !player.loaded && player.lapTimesMs.length === 0)); assert.ok(oldMatch); }
  }
  assert.equal(h.room.series.complete, true); assert.equal(h.room.series.standings[0].playerId, h.aw.playerId); assert.equal(h.room.series.standings[0].points, 30); assert.equal(h.room.series.standings[1].points, 12);
  assert.equal((await h.next()).code, 'STALE_SERIES');
  await h.send(h.a, { type: 'end-series', ...h.lobby() }); assert.equal(h.room.series, null); await h.send(h.a, { type: 'reset' }); assert.equal(h.room.phase, 'lobby');
}));
await test('下一站拒絕舊match/舊series世代/錯房碼/非房主，不改成績', () => harness(async h => {
  await h.configure(); await h.begin(); await h.finish(); const before = structuredClone(h.room.series);
  for (const [wire, extra, code] of [[h.b, {}, 'HOST_ONLY'], [h.a, { matchId: 'old' }, 'STALE_SERIES'], [h.a, { expectedSeriesRevision: 0 }, 'STALE_SERIES'], [h.a, { roomCode: 'ABC234' }, 'STALE_SERIES']]) {
    assert.equal((await h.send(wire, { type: 'next-series', roomCode: h.room.code, matchId: h.room.matchId, expectedSeriesRevision: h.room.series.revision, ...extra })).code, code);
  } assert.deepEqual(h.room.series, before);
}));
await test('斷線續接保留系列原ID與積分，下一站不能提前取消10秒期限', () => harness(async h => {
  await h.configure(); await h.begin(); await h.finish(); await h.b.close(); await settle();
  assert.equal((await h.next()).code, 'NOT_READY'); const oldSeries = structuredClone(h.room.series);
  const resumed = await h.open(); const response = await h.enter(resumed, { type: 'resume', code: h.room.code, playerId: h.bw.playerId, token: h.bw.resumeToken });
  assert.equal(response.playerId, h.bw.playerId); assert.deepEqual(h.room.series, oldSeries);
}));
await test('平手依名次次數、完賽總時間、原名單順序，DNF沒有積分', () => {
  const entrants = [{ playerId: 'a', name: '同名', color: '#123456' }, { playerId: 'b', name: '同名', color: '#654321' }];
  const result = (id, rank, finishMs) => ({ ...entrants.find(row => row.playerId === id), rank, finishMs, dnf: finishMs === null, points: finishMs === null ? 0 : [10, 6, 4, 3][rank - 1] });
  const rounds = [{ matchId: 'one', trackId: tracks[0], laps: 1, results: [result('a', 1, 1000), result('b', 2, 1100)] }, { matchId: 'two', trackId: tracks[1], laps: 1, results: [result('b', 1, 900), result('a', 2, 1200)] }];
  assert.equal(seriesStandings(entrants, rounds)[0].playerId, 'b');
  rounds[1].results[0].finishMs = 1100; assert.equal(seriesStandings(entrants, rounds)[0].playerId, 'a');
  assert.equal(seriesStandings(entrants, [])[0].playerId, 'a');
});
await test('已開始系列禁止重新設定，明確結束清除總積分且新房不繼承', () => harness(async h => {
  await h.configure(); await h.begin(); await h.finish(); await h.next();
  assert.equal((await h.send(h.a, { type: 'configure-series', trackIds: tracks, ...h.lobby() })).code, 'SERIES_ACTIVE');
  await h.send(h.a, { type: 'end-series', ...h.lobby() }); assert.equal(h.room.series, null);
  const other = await h.open(); const created = await h.enter(other, { type: 'create', name: '另一房', laps: 1 }); assert.equal(created.room.series, null);
}));
await test('交棒/踢人後保留穩定ID積分，缺席後續站DNF0，新身分不能取代舊名單', () => harness(async h => {
  const c = await h.open(), cw = await h.enter(c, { type: 'join', code: h.room.code, name: '第三車手' });
  await h.configure(); await h.begin([h.a, h.b, c]); await h.finish(); await h.next();
  await h.send(h.a, { type: 'transfer-host', targetPlayerId: h.bw.playerId, ...h.lobby() }); assert.equal(h.room.hostId, h.bw.playerId);
  assert.equal((await h.send(h.a, { type: 'set-laps', laps: 3, ...h.lobby() })).code, 'HOST_ONLY');
  await h.send(h.b, { type: 'kick-player', targetPlayerId: h.aw.playerId, ...h.lobby() }); await h.a.waitClosed();
  await h.begin([h.b, c], h.b); await h.finish();
  const missing = h.room.series.rounds[1].results.find(row => row.playerId === h.aw.playerId); assert.equal(missing.dnf, true); assert.equal(missing.points, 0);
  assert.equal(h.room.series.standings.find(row => row.playerId === h.aw.playerId).points, 10);
  const replacement = await h.open(); assert.equal((await h.enter(replacement, { type: 'resume', code: h.room.code, playerId: h.aw.playerId, token: h.aw.resumeToken })).code, 'REMOVED_BY_HOST');
  await h.next(h.b); assert.equal((await h.enter(replacement, { type: 'join', code: h.room.code, name: '同名車手' })).code, 'SERIES_LOCKED');
  await h.begin([h.b, c], h.b); await h.finish();
  assert.equal(h.room.series.standings[0].playerId, h.bw.playerId); assert.equal(h.room.series.standings.find(row => row.playerId === cw.playerId).points, 16);
  assert.equal(validSeries(h.app.service.snapshot(h.room).series, h.room.trackId, h.room.phase), true);
}));
await test('已計分車手斷線逾期後保留歷史且不再續接，可由其餘兩人繼續', () => harness(async h => {
  const c = await h.open(), cw = await h.enter(c, { type: 'join', code: h.room.code, name: '第三車手' });
  await h.configure(); await h.begin([h.a, h.b, c]); await h.finish(); await c.close(); await settle(); h.advance(10001);
  assert.equal(h.room.players.get(cw.playerId).expired, true); await h.next(); assert.equal(h.room.players.has(cw.playerId), false);
  assert.equal(h.room.series.standings.find(row => row.playerId === cw.playerId).points, 4);
  const resumed = await h.open(); assert.equal((await h.enter(resumed, { type: 'resume', code: h.room.code, playerId: cw.playerId, token: cw.resumeToken })).code, 'INVALID_SESSION');
  await h.begin(); await h.finish(); assert.equal(h.room.series.rounds[1].results.find(row => row.playerId === cw.playerId).dnf, true);
}));
report.status = report.cases.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL'; report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length }; await finishEvidence();
await writeFile(new URL('tenpack-multiplayer-server-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
