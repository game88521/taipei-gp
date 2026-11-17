import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createMultiplayerServer } from '../../server/index.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../../shared/multiplayer-protocol.ts';
import { MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { WireClient, ORIGIN, settle } from './multiplayer-test-helpers.mjs';
import { sceneFixture } from './twelve-multiplayer-fixtures.mjs';
import { multiplayerCarsOverlap } from '../../server/physics.mjs';
const identity = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP }, caps = { clientCapabilities: { roomRules: true } };
const files = ['server/room-service.mjs', 'shared/multiplayer-protocol.ts', 'shared/multiplayer-room-rules.ts', 'src/multiplayer-client.ts', 'src/multiplayer-scene.ts', 'src/multiplayer-network.ts'];
const sha = b => createHash('sha256').update(b).digest('hex'), hashes = async () => Object.fromEntries(await Promise.all(files.map(async f => [f, sha(await readFile(new URL('../../' + f, import.meta.url)))])));
const report = { localOnly: true, externalRequests: 0, realWebSocket: true, realAuthority: true, realSceneAcceptAndFrame: true, gpuUsed: false, cases: [], sourceHashes: await hashes(), limitations: ['延遲採真WS快照的可重現虛擬到達排程，非外網/手機量測；renderer為計數替身。', '記分/完賽寬限使用隔離服務端fixture，不等同真人駕駛。'] };
async function test(name, fn) { try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
async function harness(fn, legacy = false) {
  let now = 1000000; const app = createMultiplayerServer({ now: () => now, autoTick: false, allowedOrigins: [ORIGIN] }), clients = [];
  await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve));
  const open = async () => { const wire = await new WireClient(`ws://127.0.0.1:${app.httpServer.address().port}/ws`).open(); clients.push(wire); return wire; };
  const send = async (wire, message, accept = m => m.room || m.type === 'error') => { await settle(); const mark = wire.mark(); wire.send(message); return wire.until(accept, mark); };
  const enter = (wire, message, supported = true) => send(wire, { ...identity, ...(supported ? caps : {}), ...message }, m => m.type === 'welcome' || m.type === 'error');
  const a = await open(), aw = await enter(a, { type: 'create', name: '車手甲', laps: 1 });
  const b = await open(), bw = await enter(b, { type: 'join', code: aw.room.code, name: '車手乙' }, !legacy), room = app.service.rooms.get(aw.room.code);
  const lobby = () => ({ roomCode: room.code, expectedLobbyRevision: room.lobbyRevision });
  const selection = () => ({ trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
  const rules = (value, wire = a, extra = {}) => send(wire, { type: 'set-room-rules', roomRules: value, ...lobby(), ...extra });
  const begin = async () => { for (const wire of [a, b]) { await send(wire, { type: 'track-loaded', ...selection() }); await send(wire, { type: 'ready', ready: true, ...selection() }); }
    await send(a, { type: 'start', trackRevision: room.trackRevision }); now = room.startAt; app.service.tick(now); await settle(); assert.equal(room.phase, 'racing'); };
  try { await fn({ app, a, b, aw, bw, room, open, enter, send, lobby, selection, rules, begin,
    now: () => now, advance(ms) { now += ms; app.service.tick(now); }, setNow(t) { now = t; } }); }
  finally { await Promise.all(clients.map(w => w.close())); await app.close(); }
}
await test('新server宣告完整預設；舊client省略能力仍可一般碰撞房', () => harness(async h => {
  assert.equal(h.aw.room.capabilities.roomRules, true); assert.deepEqual(h.aw.room.roomRules, { collisions: true, finishGraceSeconds: 60 });
  assert.equal(h.bw.type, 'welcome'); assert.equal(h.room.players.get(h.bw.playerId).supportsRoomRules, false);
}, true));
await test('規則權限/世代/型別/額外欄位嚴格拒絕且房間不變', () => harness(async h => {
  const valid = { collisions: false, finishGraceSeconds: 30 }, initial = structuredClone(h.room.roomRules), revision = h.room.trackRevision;
  for (const [value, wire, extra, error] of [[valid, h.b, {}, 'HOST_ONLY'], [valid, h.a, { roomCode: 'ABC234' }, 'STALE_LOBBY'], [valid, h.a, { expectedLobbyRevision: 0 }, 'STALE_LOBBY'],
    [{ collisions: 0, finishGraceSeconds: 30 }, h.a, {}, 'INVALID_RULES'], [{ collisions: false, finishGraceSeconds: '30' }, h.a, {}, 'INVALID_RULES'], [{ ...valid, extra: 1 }, h.a, {}, 'INVALID_RULES']]) assert.equal((await h.rules(value, wire, extra)).code, error);
  assert.deepEqual(h.room.roomRules, initial); assert.equal(h.room.trackRevision, revision);
}));
await test('混用舊client含斷線名額阻擋非預設規則', () => harness(async h => {
  assert.equal((await h.rules({ collisions: false, finishGraceSeconds: 60 })).code, 'RULES_UNSUPPORTED');
  await h.b.close(); await settle(); assert.equal((await h.rules({ collisions: true, finishGraceSeconds: 120 })).code, 'RULES_UNSUPPORTED');
  assert.deepEqual(h.room.roomRules, { collisions: true, finishGraceSeconds: 60 });
}, true));
await test('改規則全員清ready/loaded並升兩世代，晚到舊ready拒絕，重複值冪等', () => harness(async h => {
  for (const wire of [h.a, h.b]) { await h.send(wire, { type: 'track-loaded', ...h.selection() }); await h.send(wire, { type: 'ready', ready: true, ...h.selection() }); }
  const old = h.selection(), revision = h.room.lobbyRevision;
  await h.rules({ collisions: false, finishGraceSeconds: 120 }); assert.equal(h.room.trackRevision, old.trackRevision + 1); assert.equal(h.room.lobbyRevision, revision + 1);
  assert.ok([...h.room.players.values()].every(p => !p.ready && !p.loaded)); assert.equal((await h.send(h.b, { type: 'ready', ready: true, ...old })).code, 'STALE_TRACK');
  const mark = h.a.mark(); h.a.send({ type: 'set-room-rules', roomRules: { collisions: false, finishGraceSeconds: 120 }, ...h.lobby() }); await settle();
  assert.equal(h.room.lobbyRevision, revision + 1); assert.equal(h.a.mark(), mark);
}));
await test('舊client不能加入/續接非預設規則房，新client續接保留規則與重新loaded', () => harness(async h => {
  await h.rules({ collisions: false, finishGraceSeconds: 30 }); const old = await h.open();
  assert.equal((await h.enter(old, { type: 'join', code: h.room.code, name: '舊車手' }, false)).code, 'RULES_UNSUPPORTED');
  await h.b.close(); await settle(); const next = await h.open(), message = { type: 'resume', code: h.room.code, playerId: h.bw.playerId, token: h.bw.resumeToken };
  assert.equal((await h.enter(next, message, false)).code, 'RULES_UNSUPPORTED'); assert.equal((await h.enter(next, message)).type, 'welcome');
  assert.equal(h.room.players.get(h.bw.playerId).loaded, false); assert.deepEqual(h.room.roomRules, { collisions: false, finishGraceSeconds: 30 });
}));
await test('一般碰撞有接觸反應；無碰撞真authority與兩端scene.predict/frame均允許交疊', async () => {
  for (const collisions of [true, false]) await harness(async h => {
    await h.rules({ collisions, finishGraceSeconds: 30 }); await h.begin(); const players = [...h.room.players.values()];
    players.forEach(p => { p.car.placeAt(h.room.track, 0); p.car.v = 0; p.input = { steer: 0, brake: true }; p.lastInputAt = h.now(); });
    h.app.service.simulate(h.room, h.now() + 1000 / 60);
    const distance = Math.hypot(players[0].car.x - players[1].car.x, players[0].car.z - players[1].car.z);
    if (collisions) assert.ok(distance > .5); else assert.ok(distance < .001);
    const snap = h.app.service.snapshot(h.room, h.now());
    for (const p of snap.players) { p.car = players[0].car.snapshot(); p.car = structuredClone(p.car); }
    for (const self of snap.players) { const f = sceneFixture(snap, self.id, h.room.track); f.at(h.now()); f.scene.accept(snap, self.id, h.now()); f.frame(h.now() + 16.7);
      const vs = [...f.scene.cars.values()].map(v => v.model.root.position);
      const presented = snap.players.map((p, i) => ({ ...p.car, x: vs[i].x, z: vs[i].z }));
      assert.equal(multiplayerCarsOverlap(h.room.track, presented[0], presented[1]), !collisions); }
  });
});
await test('30/60/120秒寬限採房間規則且總限10分鐘仍較早者優先', async () => {
  for (const seconds of [30, 60, 120]) await harness(async h => {
    if (seconds !== 60) await h.rules({ collisions: true, finishGraceSeconds: seconds }); await h.begin();
    const first = h.room.players.get(h.aw.playerId); first.finishMs = 1000; first.completedLaps = 1; first.lapTimesMs = [1000]; first.bestLapMs = 1000; h.room.firstFinishAt = h.now();
    assert.equal(h.app.service.deadline(h.room).deadlineAt, h.now() + seconds * 1000);
    h.setNow(h.now() + seconds * 1000 - 1); assert.equal(h.app.service.maybeFinish(h.room, h.now()), false); assert.equal(h.room.phase, 'racing');
    h.setNow(h.now() + 1); assert.equal(h.app.service.maybeFinish(h.room, h.now()), true); assert.equal(h.room.phase, 'results');
    assert.equal(h.room.players.get(h.bw.playerId).dnfReason, 'finish-timeout');
  });
});
await test('系列第一站鎖規則，換圖/下一站/交棒與再戰保留', () => harness(async h => {
  await h.rules({ collisions: false, finishGraceSeconds: 120 }); const tracks = MULTIPLAYER_TRACKS.slice(0, 3).map(t => t.id);
  await h.send(h.a, { type: 'configure-series', trackIds: tracks, ...h.lobby() }); await h.begin();
  for (const [i, p] of [...h.room.players.values()].entries()) { p.finishMs = 1000 + i * 100; p.completedLaps = 1; p.lapTimesMs = [p.finishMs]; p.bestLapMs = p.finishMs; }
  assert.equal(h.app.service.maybeFinish(h.room, h.now()), true);
  await h.send(h.a, { type: 'next-series', roomCode: h.room.code, matchId: h.room.matchId, expectedSeriesRevision: h.room.series.revision });
  assert.deepEqual(h.room.roomRules, { collisions: false, finishGraceSeconds: 120 }); assert.equal((await h.rules({ collisions: true, finishGraceSeconds: 60 })).code, 'SERIES_ACTIVE');
  await h.send(h.a, { type: 'transfer-host', targetPlayerId: h.bw.playerId, ...h.lobby() }); assert.equal(h.room.hostId, h.bw.playerId); assert.equal(h.room.roomRules.collisions, false);
}));
// The fixture uses real loopback WS snapshots, then replays their arrival under a deterministic network schedule.
await test('真WS快照→真scene.accept/frame：延遲/抖動/短停排程、buffer欠缺與180ms封頂量測', () => harness(async h => {
  await h.begin(); const snapshots = [];
  const start = h.now(); for (let k = 0; k < 240; k++) { h.setNow(start + k * 50); h.app.service.simulate(h.room, h.now());
    const mark = h.a.mark(); h.app.service.broadcast(h.room, 'snapshot', h.now()); const data = await h.a.until(m => m.type === 'snapshot', mark); snapshots.push(data.room); }
  report.networkMeasurements = [];
  for (const [name, latency, jitter, pause] of [['50ms', 50, 0, false], ['100ms', 100, 0, false], ['200ms', 200, 0, false], ['100ms-jitter', 100, 70, false], ['100ms-pause600', 100, 0, true]]) {
    const f = sceneFixture(snapshots[0], h.aw.playerId, h.room.track), queue = snapshots.map((s, i) => ({ s, at: s.serverTime + latency + (jitter ? [0, 70, 20, 50][i % 4] : 0) + (pause && i >= 120 && i < 132 ? 600 : 0) }));
    let latest = null, oldUnder = 0, newUnder = 0, samples = 0, maxPredict = 0, warning = false;
    for (let at = start; at < start + 12000; at += 1000 / 60) {
      const due = queue.filter(p => p.at <= at).sort((a, b) => a.at - b.at); for (const p of due) { queue.splice(queue.indexOf(p), 1); if (!latest || p.s.serverTime > latest.serverTime) { latest = p.s; f.at(at); f.scene.accept(p.s, h.aw.playerId, at); } }
      if (!latest) continue; f.frame(at); maxPredict = Math.max(maxPredict, f.scene.predictionAt - latest.serverTime); warning ||= !!f.scene.network.warning(at);
      if (at > start + 3000) { samples++; oldUnder += at - 110 > latest.serverTime ? 1 : 0; newUnder += at - f.scene.network.delayMs > latest.serverTime ? 1 : 0; }
    }
    assert.ok(f.scene.network.delayMs >= 80 && f.scene.network.delayMs <= 220); assert.ok(maxPredict <= 180.0001);
    if (name !== '50ms') assert.ok(newUnder < oldUnder, `${name}需有可量測buffer欠缺降低`);
    report.networkMeasurements.push({ name, samples, baselineUnderflowFrames: oldUnder, adaptiveUnderflowFrames: newUnder, finalDelayMs: f.scene.network.delayMs, maxPredictionMs: maxPredict, warned: warning });
  }
}));
assert.deepEqual(await hashes(), report.sourceHashes); report.sourceUnchangedDuringTests = true; report.scriptSha256 = sha(await readFile(new URL(import.meta.url)));
report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length }; report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(new URL('twelve-multiplayer-server-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
