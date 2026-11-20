// Real loopback WebSockets. Gate/result fixtures stay inside the isolated service.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createMultiplayerServer } from '../../server/index.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../../shared/multiplayer-protocol.ts';
import { MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { validSeries } from '../../shared/multiplayer-series.ts';
import { SeriesCheckpointSigner, CHECKPOINT_TTL_SECONDS } from '../../server/series-checkpoint.mjs';
import { multiplayerCarsOverlap } from '../../server/physics.mjs';
import { WireClient, ORIGIN, settle, drivingInput } from './multiplayer-test-helpers.mjs';
const identity = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP };
const caps = { clientCapabilities: { roomRules: true, evolution: true } };
const tracks = MULTIPLAYER_TRACKS.slice(0, 5).map(t => t.id);
const KEY = 'evolution-local-test-key-with-at-least-thirty-two-bytes';
const report = { localOnly: true, externalRequests: 0, realWebSocket: true, cases: [], limitations: ['Gate/result fixtures are internal to isolated service; this proves authority/lifecycle, not human driving, external latency, GPU or phone behavior.'] };
async function test(name, fn) { try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
async function harness(fn, options = {}) {
  let now = 1000000;
  const factory = options.factory ?? createMultiplayerServer;
  const app = factory({ now: () => now, autoTick: false, allowedOrigins: [ORIGIN], roomOptions: { ...(options.ephemeral ? {} : { seriesResumeSecret: KEY }) } });
  const clients = []; await new Promise(r => app.httpServer.listen(0, '127.0.0.1', r));
  const open = async () => { const w = await new WireClient(`ws://127.0.0.1:${app.httpServer.address().port}/ws`).open(); clients.push(w); return w; };
  const send = async (w, m, accept = r => r.room || r.type === 'error') => { await settle(); const mark = w.mark(); w.send(m); return w.until(accept, mark); };
  const enter = (w, m, supported = true) => send(w, { ...identity, ...(supported ? caps : {}), ...m }, r => r.type === 'welcome' || r.type === 'error');
  const a = await open(), aw = await enter(a, { type: 'create', name: '領航甲', laps: 1 });
  const b = await open(), bw = await enter(b, { type: 'join', code: aw.room.code, name: '領航乙' }, !options.legacy);
  const room = app.service.rooms.get(aw.room.code), lobby = () => ({ roomCode: room.code, expectedLobbyRevision: room.lobbyRevision });
  const selection = () => ({ trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
  const configure = (mode, extra = {}) => send(a, { type: 'configure-event', mode, durationSeconds: 180, releaseDelays: {}, ...lobby(), ...extra });
  const begin = async (wires = [a, b]) => {
    for (const wire of wires) { await send(wire, { type: 'track-loaded', ...selection() }); await send(wire, { type: 'ready', ready: true, ...selection() }); }
    const response = await send(a, { type: 'start', trackRevision: room.trackRevision });
    if (response.room?.phase === 'countdown') { now = room.startAt; app.service.tick(now); await settle(); }
    return response;
  };
  const finish = () => { let i = 0; for (const p of room.players.values()) { p.finishMs = 1000 + i++ * 100; p.completedLaps = room.laps; p.lapTimesMs = [p.finishMs]; p.bestLapMs = p.finishMs; } assert.equal(app.service.maybeFinish(room, now), true); };
  const series = () => send(a, { type: 'configure-series', trackIds: tracks.slice(0, 3), ...lobby() });
  const checkpoint = () => send(a, { type: 'checkpoint-series', roomCode: room.code, matchId: room.matchId, expectedSeriesRevision: room.series.revision }, r => r.type === 'series-checkpoint' || r.type === 'error');
  try { return await fn({ app, a, b, aw, bw, room, open, send, enter, lobby, selection, configure, begin, finish, series, checkpoint,
    now: () => now, setNow(t) { now = t; }, advance(ms) { now += ms; app.service.tick(now); } }); }
  finally { await Promise.all(clients.map(w => w.close())); await app.close(); }
}
await test('before對照：原版拒絕新命令，新版未變更physics bytes', async () => {
  const before = new URL('../../../taipei-gp-evolution-before-d251460c360c/', import.meta.url);
  const old = await import(new URL('server/index.mjs', before));
  await harness(async h => {
    assert.equal(h.aw.room.capabilities.evolution, undefined);
    assert.equal((await h.configure('time-trial')).code, 'BAD_MESSAGE');
    assert.equal((await h.send(h.a, { type: 'random-series', count: 3, ...h.lobby() })).code, 'BAD_MESSAGE');
  }, { factory: old.createMultiplayerServer });
  const sha = b => createHash('sha256').update(b).digest('hex');
  const current = sha(await readFile(new URL('../../server/physics.mjs', import.meta.url)));
  assert.equal(current, sha(await readFile(new URL('server/physics.mjs', before))));
  return { beforeRejected: ['configure-event', 'random-series'], physicsSha256: current };
});
await test('新能力與永久key可發現；無key明示僅本次服務', () => harness(async h => {
  assert.equal(h.aw.room.capabilities.evolution, true); assert.equal(h.aw.room.capabilities.seriesResume.persistent, true);
  assert.equal(h.aw.room.capabilities.seriesResume.ttlSeconds, CHECKPOINT_TTL_SECONDS);
  const signer = new SeriesCheckpointSigner(); assert.equal(signer.capability().persistent, false);
}));
await test('全員能力涵蓋斷線保留席，舊client一般房仍可參賽', () => harness(async h => {
  assert.equal(h.bw.type, 'welcome'); assert.equal((await h.configure('pursuit')).code, 'EVOLUTION_UNSUPPORTED');
  await h.b.close(); await settle(); assert.equal((await h.configure('time-trial')).code, 'EVOLUTION_UNSUPPORTED');
  assert.equal(h.room.evolution.mode, 'race');
}, { legacy: true }));
await test('玩法房主/大廳世代/嚴格讓秒值與清ready', () => harness(async h => {
  const command = { type: 'configure-event', mode: 'pursuit', durationSeconds: 180, releaseDelays: {}, ...h.lobby() };
  assert.equal((await h.send(h.b, command)).code, 'HOST_ONLY');
  assert.equal((await h.send(h.a, { ...command, expectedLobbyRevision: 0 })).code, 'STALE_LOBBY');
  assert.equal((await h.configure('pursuit', { releaseDelays: { [h.aw.playerId]: 2 } })).code, 'INVALID_EVENT');
  const revision = h.room.trackRevision; await h.configure('pursuit', { releaseDelays: { [h.aw.playerId]: 10 } });
  assert.equal(h.room.trackRevision, revision + 1); assert.ok([...h.room.players.values()].every(p => !p.ready && !p.loaded));
}));
await test('投票可覆投、平手catalog優先、房主結算及舊票重播拒絕', () => harness(async h => {
  const vote = (w, trackId) => h.send(w, { type: 'vote-track', trackId, expectedVoteRevision: h.room.evolution.vote.revision, ...h.lobby() });
  await vote(h.a, tracks[1]); await vote(h.a, tracks[2]); await vote(h.b, tracks[1]);
  assert.equal(Object.keys(h.room.evolution.vote.ballots).length, 2);
  const old = { type: 'vote-track', trackId: tracks[2], expectedVoteRevision: h.room.evolution.vote.revision, ...h.lobby() };
  assert.equal((await h.send(h.b, { type: 'resolve-vote', ...h.lobby() })).code, 'HOST_ONLY');
  await h.send(h.a, { type: 'resolve-vote', ...h.lobby() }); assert.equal(h.room.trackId, tracks[1]);
  assert.deepEqual(h.room.evolution.vote.ballots, {}); assert.equal((await h.send(h.b, old)).code, 'STALE_LOBBY');
  assert.equal((await h.send(h.a, { type: 'resolve-vote', ...h.lobby() })).code, 'INVALID_VOTE');
}));
await test('crypto隨機巡迴3/4/5站，24圖catalog合法且不重複', () => harness(async h => {
  assert.equal(MULTIPLAYER_TRACKS.length, 24);
  for (const count of [3, 4, 5]) { const r = await h.send(h.a, { type: 'random-series', count, ...h.lobby() }); assert.equal(r.type, 'room');
    assert.equal(h.room.series.trackIds.length, count); assert.equal(new Set(h.room.series.trackIds).size, count);
    assert.ok(h.room.series.trackIds.every(id => MULTIPLAYER_TRACKS.some(t => t.id === id))); }
  assert.equal((await h.send(h.a, { type: 'random-series', count: 2, ...h.lobby() })).code, 'INVALID_SERIES');
}));
await test('追逐車與輸入放行前完全凍結，延遲後才接受控制', () => harness(async h => {
  await h.configure('pursuit', { releaseDelays: { [h.aw.playerId]: 10, [h.bw.playerId]: 0 } }); await h.begin();
  const p = h.room.players.get(h.aw.playerId), initial = structuredClone(p.car.snapshot());
  const input = { type: 'input', matchId: h.room.matchId, trackRevision: h.room.trackRevision, seq: 1, steer: 1, brake: false };
  h.a.send(input); await settle(); assert.equal(p.receivedSeq, -1);
  for (let ms = 1000; ms < 10000; ms += 1000) { h.setNow(h.room.startAt + ms); h.app.service.simulate(h.room, h.now()); }
  assert.deepEqual(p.car.snapshot(), initial);
  h.setNow(h.room.startAt + 10000); h.a.send(input); await settle(); h.app.service.simulate(h.room, h.now());
  assert.equal(p.receivedSeq, 1); assert.notDeepEqual(p.car.snapshot(), initial);
}));
await test('追逐排名以共同時間，net時間另列且不倒置冠軍', () => harness(async h => {
  await h.configure('pursuit', { releaseDelays: { [h.aw.playerId]: 0, [h.bw.playerId]: 10 } }); await h.begin();
  const [a, b] = [h.room.players.get(h.aw.playerId), h.room.players.get(h.bw.playerId)];
  a.finishMs = 30000; b.finishMs = 31000; a.lapTimesMs = [30000]; b.lapTimesMs = [21000]; a.bestLapMs = 30000; b.bestLapMs = 21000; a.completedLaps = b.completedLaps = 1;
  h.app.service.maybeFinish(h.room, h.now()); const snapshot = h.app.service.snapshot(h.room);
  assert.equal(snapshot.players[0].id, a.id); assert.equal(snapshot.players[1].netFinishMs, 21000); assert.equal(snapshot.players[1].finishMs, 31000);
}));
await test('限時固定無碰撞、不可圈數提前結束，末圈寬限與無圈DNF', () => harness(async h => {
  await h.configure('time-trial'); assert.equal(h.room.roomRules.collisions, false);
  assert.equal((await h.send(h.a, { type: 'set-room-rules', roomRules: { collisions: true, finishGraceSeconds: 60 }, ...h.lobby() })).code, 'INVALID_RULES');
  await h.begin(); const p = h.room.players.get(h.aw.playerId);
  p.completedLaps = 4; p.lapTimesMs = [40000, 41000, 39000, 40000]; p.bestLapMs = 39000; p.lastLapElapsedMs = 160000;
  assert.equal(h.app.service.maybeFinish(h.room, h.room.startAt + 170000), false);
  const L = h.room.track.length; p.distance = 5 * L - 1; p.nextGate = 3; p.car.pos.s = L - 1;
  p.car.update = () => { p.car.pos.s = 1; }; h.app.service.simulate(h.room, h.room.startAt + 190000);
  assert.equal(p.completedLaps, 5); assert.equal(p.timeTrialDone, true); assert.ok(p.bestLapMs < 31000);
  const count = p.lapTimesMs.length; h.app.service.simulate(h.room, h.room.startAt + 200000); assert.equal(p.lapTimesMs.length, count);
  assert.equal(h.app.service.maybeFinish(h.room, h.room.startAt + 240001), true);
  const rows = h.app.service.snapshot(h.room).players; assert.equal(rows[0].finishMs, rows[0].bestLapMs); assert.equal(rows[1].dnfReason, 'time-trial-no-lap');
}));
await test('限時300秒與DNF退出不讓其他車手提早結束', () => harness(async h => {
  await h.configure('time-trial', { durationSeconds: 300 }); await h.begin();
  await h.send(h.b, { type: 'leave' }, r => r.type === 'left'); assert.equal(h.room.phase, 'racing');
  const p = h.room.players.get(h.aw.playerId); p.bestLapMs = 35000; p.lapTimesMs = [35000]; p.completedLaps = 1;
  assert.equal(h.app.service.maybeFinish(h.room, h.room.startAt + 299999), false);
  assert.equal(h.app.service.maybeFinish(h.room, h.room.startAt + 360001), true);
  assert.equal(h.app.service.snapshot(h.room).players[0].id, p.id);
}));
await test('真WS輸入＋未替換Car物理完整限時賽，多圈與末圈由authority結算', () => harness(async h => {
  await h.configure('time-trial'); await h.begin(); const startedAt = h.room.startAt;
  let seq = 0, firstLapAt = null;
  for (let elapsed = 0; elapsed < 245000 && h.room.phase === 'racing'; elapsed += 50) {
    for (const [wire, id] of [[h.a, h.aw.playerId], [h.b, h.bw.playerId]]) {
      const p = h.room.players.get(id);
      wire.send({ type: 'input', matchId: h.room.matchId, trackRevision: h.room.trackRevision, seq, ...drivingInput(p.car, h.room.track) });
    }
    seq++; await settle(); h.advance(50);
    if (firstLapAt === null && [...h.room.players.values()].some(p => p.completedLaps > 0)) firstLapAt = h.now() - startedAt;
    if (h.now() - startedAt < 180000) assert.equal(h.room.phase, 'racing');
  }
  assert.equal(h.room.phase, 'results'); const rows = h.app.service.snapshot(h.room).players;
  assert.ok(rows.every(p => !p.dnf && p.completedLaps >= 3 && p.finishMs > 30000 && p.finishMs < 90000));
  assert.ok(rows.every(p => p.finishMs === p.bestLapMs && p.lapTimesMs.length === p.completedLaps));
  return { injectedGateOrResultState: false, firstLapAt, commonElapsedMs: h.now() - startedAt, completedLaps: rows.map(p => p.completedLaps), fastestLapsMs: rows.map(p => p.bestLapMs) };
}));
let teamCheckpointFixture;
await test('固定2v2替補舊ID清理、真隊友碰撞、checkpoint自驗與離線缺席規則', () => harness(async h => {
  const c = await h.open(), cw = await h.enter(c, { type: 'join', code: h.room.code, name: '領航丙' });
  let d = await h.open(), dw = await h.enter(d, { type: 'join', code: h.room.code, name: '領航丁' });
  await h.configure('teams', { releaseDelays: { [h.aw.playerId]: 0, [h.bw.playerId]: 3, [cw.playerId]: 5, [dw.playerId]: 10 } });
  for (const [w, team] of [[h.a, 'red'], [h.b, 'blue'], [c, 'red'], [d, 'blue']]) await h.send(w, { type: 'select-team', team, ...h.lobby() });
  await h.send(d, { type: 'vote-track', trackId: tracks[0], expectedVoteRevision: h.room.evolution.vote.revision, ...h.lobby() });
  const removedId = dw.playerId; await h.send(d, { type: 'leave' }, r => r.type === 'left');
  assert.equal(h.room.evolution.teams[removedId], undefined); assert.equal(h.room.evolution.releaseDelays[removedId], undefined); assert.equal(h.room.evolution.vote.ballots[removedId], undefined);
  d = await h.open(); dw = await h.enter(d, { type: 'join', code: h.room.code, name: '替補新車手' });
  await h.send(d, { type: 'select-team', team: 'blue', ...h.lobby() });
  assert.notEqual(dw.playerId, removedId); assert.equal(Object.keys(h.room.evolution.teams).length, 4); await h.series();
  assert.equal((await h.send(h.b, { type: 'select-team', team: 'red', ...h.lobby() })).code, 'TEAM_NOT_READY');
  assert.equal(h.room.roomRules.collisions, true); await h.begin([h.a, h.b, c, d]);
  const reds = [h.room.players.get(h.aw.playerId), h.room.players.get(cw.playerId)];
  reds.forEach(p => p.car.placeAt(h.room.track, 100));
  h.room.players.get(h.bw.playerId).car.placeAt(h.room.track, 200); h.room.players.get(dw.playerId).car.placeAt(h.room.track, 300);
  assert.equal(multiplayerCarsOverlap(h.room.track, reds[0].car, reds[1].car), true);
  h.app.service.simulate(h.room, h.now() + 1000 / 60);
  assert.equal(multiplayerCarsOverlap(h.room.track, reds[0].car, reds[1].car), false); h.finish();
  const standings = h.app.service.snapshot(h.room).evolution.teamStandings;
  assert.equal(standings[0].team, 'red'); assert.equal(standings[0].points, 14); assert.equal(standings[1].points, 9);
  assert.equal(validSeries(h.room.series, h.room.trackId, h.room.phase, h.room.matchId, h.room.laps), true);
  teamCheckpointFixture = { checkpoint: await h.checkpoint(), teams: structuredClone(h.room.evolution.teams), entrants: structuredClone(h.room.series.entrants) };
  assert.equal(teamCheckpointFixture.checkpoint.type, 'series-checkpoint');
  assert.ok(h.app.service.checkpoints.verify(teamCheckpointFixture.checkpoint.token, h.now()));
  await d.close(); await settle(); h.advance(10001);
  await h.send(h.a, { type: 'next-series', roomCode: h.room.code, matchId: h.room.matchId, expectedSeriesRevision: h.room.series.revision });
  assert.equal((await h.begin([h.a, h.b, c])).code, 'TEAM_NOT_READY');
  assert.equal(h.room.series.entrants.find(e => e.playerId === dw.playerId).team, 'blue');
}));
await test('2v2重啟續賽保留原四席、每位隊伍與累計隊分', () => harness(async h => {
  h.setNow(1003001); const w = await h.open();
  const restored = await h.enter(w, { type: 'resume-series', token: teamCheckpointFixture.checkpoint.token });
  assert.equal(restored.type, 'welcome'); assert.equal(restored.room.players.length, 4);
  assert.deepEqual(restored.room.evolution.teams, teamCheckpointFixture.teams);
  assert.deepEqual(restored.room.series.entrants, teamCheckpointFixture.entrants);
  assert.equal(restored.room.evolution.teamStandings[0].points, 14);
  assert.equal(restored.room.evolution.teamStandings[1].points, 9);
}));
let checkpointFixture;
await test('原房主專用checkpoint單播、不出現在snapshot、能力憑證不含原席位token', () => harness(async h => {
  await h.series(); await h.begin(); h.finish(); await settle(); const mark = h.b.mark();
  assert.equal((await h.send(h.b, { type: 'checkpoint-series', roomCode: h.room.code, matchId: h.room.matchId, expectedSeriesRevision: h.room.series.revision })).code, 'HOST_ONLY');
  const saved = await h.checkpoint(); assert.equal(saved.type, 'series-checkpoint'); await settle();
  assert.equal(h.b.take(m => m.type === 'series-checkpoint', mark), undefined);
  assert.equal(JSON.stringify(h.app.service.snapshot(h.room)).includes(saved.token), false);
  const payload = JSON.parse(Buffer.from(saved.token.split('.')[0], 'base64url').toString());
  assert.equal(JSON.stringify(payload).includes(h.bw.resumeToken), false);
  checkpointFixture = { token: saved.token, bw: h.bw, originalHostId: h.aw.playerId, series: structuredClone(h.room.series), payload };
}));
await test('真WS重啟新服務續接站次/積分/原身分，原車手舊憑證恢復席位', () => harness(async h => {
  h.setNow(checkpointFixture.payload.issuedAt + 1);
  const w = await h.open(), restored = await h.enter(w, { type: 'resume-series', token: checkpointFixture.token });
  assert.equal(restored.type, 'welcome'); assert.equal(restored.playerId, checkpointFixture.originalHostId);
  assert.equal(restored.room.series.roundIndex, 1); assert.deepEqual(restored.room.series.rounds, checkpointFixture.series.rounds);
  assert.equal(restored.room.series.standings[0].points, 10);
  const room = h.app.service.rooms.get(restored.room.code); assert.equal(room.phase, 'lobby');
  h.setNow(h.now() + 60000); h.app.service.expireDisconnected(room, h.now());
  const guest = await h.open(), claimed = await h.enter(guest, { type: 'resume', code: room.code, playerId: checkpointFixture.bw.playerId, token: checkpointFixture.bw.resumeToken });
  assert.equal(claimed.type, 'welcome'); assert.equal(claimed.playerId, checkpointFixture.bw.playerId);
  assert.notEqual(claimed.resumeToken, checkpointFixture.bw.resumeToken); assert.equal(room.players.size, 2);
  assert.equal((await h.enter(await h.open(), { type: 'join', code: room.code, name: '冒領者' })).code, 'SERIES_LOCKED');
}));
await test('同checkpoint兩次服務重啟＋新checkpoint第三次：穩定席位能力保留、live token仍輪替', async () => {
  let freshCheckpoint, rotatedLiveToken;
  for (const index of [0, 1, 2]) await harness(async h => {
    const token = index === 2 ? freshCheckpoint.token : checkpointFixture.token;
    const issuedAt = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).issuedAt;
    h.setNow(issuedAt + 1); const host = await h.open(), welcome = await h.enter(host, { type: 'resume-series', token });
    assert.equal(welcome.type, 'welcome'); const room = h.app.service.rooms.get(welcome.room.code), guest = await h.open();
    if (rotatedLiveToken) assert.equal((await h.enter(guest, { type: 'resume', code: room.code, playerId: checkpointFixture.bw.playerId, token: rotatedLiveToken })).code, 'INVALID_SESSION');
    const claimed = await h.enter(guest, { type: 'resume', code: room.code, playerId: checkpointFixture.bw.playerId, token: checkpointFixture.bw.resumeToken });
    assert.equal(claimed.type, 'welcome'); assert.notEqual(claimed.resumeToken, checkpointFixture.bw.resumeToken);
    if (rotatedLiveToken) assert.notEqual(claimed.resumeToken, rotatedLiveToken); rotatedLiveToken = claimed.resumeToken;
    assert.equal(room.series.roundIndex, index === 2 ? 2 : 1); assert.equal(room.series.standings[0].points, index === 2 ? 20 : 10);
    if (index === 0) {
      const selection = { trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision };
      for (const wire of [host, guest]) { await h.send(wire, { type: 'track-loaded', ...selection }); await h.send(wire, { type: 'ready', ready: true, ...selection }); }
      await h.send(host, { type: 'start', trackRevision: room.trackRevision }); h.setNow(room.startAt); h.app.service.tick(h.now()); await settle();
      let order = 0; for (const p of room.players.values()) { p.finishMs = 2000 + order++ * 100; p.completedLaps = room.laps; p.lapTimesMs = [p.finishMs]; p.bestLapMs = p.finishMs; }
      h.app.service.maybeFinish(room, h.now());
      freshCheckpoint = await h.send(host, { type: 'checkpoint-series', roomCode: room.code, matchId: room.matchId, expectedSeriesRevision: room.series.revision }, r => r.type === 'series-checkpoint' || r.type === 'error');
      assert.equal(freshCheckpoint.type, 'series-checkpoint');
    }
  });
  return { serviceInstances: 3, sameOldCheckpointRestoredTwice: true, freshCheckpointRestored: true, stableSeatCredential: true, liveSessionTokensRotated: true };
});
await test('WS拒絕HMAC竄改/不同key/到期/catalog/超限且不建立房間', () => harness(async h => {
  const signed = checkpointFixture.token, wrong = new SeriesCheckpointSigner('different-key-with-at-least-thirty-two-bytes').sign(checkpointFixture.payload, h.now()).token;
  const badCatalog = { ...checkpointFixture.payload, catalogStamp: 'wrong' };
  const encoded = Buffer.from(JSON.stringify(badCatalog)).toString('base64url');
  // Correct-key signed catalog mismatch tests semantic validation after HMAC.
  const { createHmac } = await import('node:crypto'); const catalogToken = encoded + '.' + createHmac('sha256', KEY).update(encoded).digest('base64url');
  const count = h.app.service.rooms.size;
  for (const token of [signed.slice(0, -1) + (signed.at(-1) === 'a' ? 'b' : 'a'), wrong, catalogToken, 'x'.repeat(65537)]) {
    const result = await h.enter(await h.open(), { type: 'resume-series', token }); assert.equal(result.code, 'INVALID_CHECKPOINT');
  }
  h.setNow(checkpointFixture.payload.expiresAt + 1);
  assert.equal((await h.enter(await h.open(), { type: 'resume-series', token: signed })).code, 'INVALID_CHECKPOINT');
  assert.equal(h.app.service.rooms.size, count);
}));
await test('沒有持久key：原process可驗但新process key拒絕，不宣稱跨重啟', async () => {
  const signer = new SeriesCheckpointSigner(), other = new SeriesCheckpointSigner();
  const saved = signer.sign(checkpointFixture.payload, 1000000);
  assert.equal(saved.persistent, false); assert.ok(signer.verify(saved.token, 1000001)); assert.equal(other.verify(saved.token, 1000001), null);
});
report.status = report.cases.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL';
report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length };
await writeFile(new URL('evolution-multiplayer-server-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ...report.summary })); if (report.status !== 'PASS') process.exitCode = 1;
