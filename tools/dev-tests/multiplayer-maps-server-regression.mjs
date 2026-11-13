// Real loopback WebSocket, real classic Car, injected server clock. No external traffic.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMultiplayerServer } from '../../server/index.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../../shared/multiplayer-protocol.ts';
import { MULTIPLAYER_TRACKS, getMultiplayerTrack, verifyMultiplayerTrackData } from '../../server/physics.mjs';
import { canonicalJson, sha256Hex } from '../../shared/multiplayer-track-fingerprint.ts';
import { WireClient, ORIGIN, settle } from './multiplayer-test-helpers.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(dir, '../..');
const identity = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['server/index.mjs','server/room-service.mjs','server/physics.mjs','shared/multiplayer-protocol.ts','shared/multiplayer-catalog.json','shared/circuit-catalog.ts','shared/multiplayer-track-recipe.ts','shared/multiplayer-track-fingerprint.ts','src/car.ts','src/track.ts','src/main.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await readFile(path.join(project, name)))])));
const before = await sourceHashes();
const report = { startedAt: new Date().toISOString(), protocol: identity, transport: 'real loopback WebSocket', authoritativePhysics: true, playerStorageTouched: false, externalRequests: [], cases: [] };
async function check(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', detail: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
  console.log(JSON.stringify(report.cases.at(-1)));
}
async function withServer(exercise, roomOptions = {}) {
  let now = 1_000_000;
  const app = createMultiplayerServer({ now: () => now, autoTick: false, allowedOrigins: [ORIGIN], roomOptions });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(0, '127.0.0.1', resolve); });
  const clients = [], url = `ws://127.0.0.1:${app.httpServer.address().port}/ws`;
  const open = async () => { const client = new WireClient(url, ORIGIN); clients.push(client); await client.open(); return client; };
  const advance = ms => { const end = now + ms; while (now + 1000 / 60 < end - 1e-6) { now += 1000 / 60; app.service.tick(now); } now = end; app.service.tick(now); };
  try { return await exercise({ app, service: app.service, open, advance, now: () => now }); }
  finally { await Promise.all(clients.map(client => client.close().catch(() => {}))); await app.close(); }
}
const selection = room => ({ trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
async function entry(client, message) { const mark = client.mark(); client.send({ ...identity, ...message }); return client.until(value => value.type === 'welcome' || value.type === 'error', mark).then(value => { assert.equal(value.type, 'welcome', value.code); return value; }); }
async function error(client, message, code) { const mark = client.mark(); client.send(message); const response = await client.until(value => value.type === 'error', mark); assert.equal(response.code, code); }
async function pair(h, trackId = 'taipei') {
  const a = await h.open(), first = await entry(a, { type: 'create', trackId, name: '赤焰', laps: 1 });
  const b = await h.open(), second = await entry(b, { type: 'join', code: first.room.code, name: '藍流' });
  return { a, b, first, second, room: h.service.rooms.get(first.room.code) };
}
async function load(client, room, playerId) {
  const mark = client.mark(); client.send({ type: 'track-loaded', ...selection(room) });
  await client.until(value => value.room?.players.some(player => player.id === playerId && player.loaded), mark);
}
async function prepare(players) {
  await Promise.all([load(players.a, players.room, players.first.playerId), load(players.b, players.room, players.second.playerId)]);
  const mark = players.a.mark();
  for (const client of [players.a, players.b]) client.send({ type: 'ready', ready: true, trackRevision: players.room.trackRevision, trackStamp: players.room.trackStamp });
  const ids = new Set([players.first.playerId, players.second.playerId]);
  await players.a.until(value => value.room?.players.filter(player => ids.has(player.id)).length === 2 && value.room.players.filter(player => ids.has(player.id)).every(player => player.loaded && player.ready), mark);
}
async function begin(h, players) {
  await prepare(players); const mark = players.a.mark();
  players.a.send({ type: 'start', trackRevision: players.room.trackRevision });
  await players.a.until(value => value.room?.phase === 'countdown', mark);
  h.advance(3000); await settle(); assert.equal(players.room.phase, 'racing');
}

await check('24圖目錄與跨Node/browser SHA256一致，整份資料含高度變更會拒絕', async () => {
  assert.equal(MULTIPLAYER_TRACKS.length, 24); assert.equal(new Set(MULTIPLAYER_TRACKS.map(item => item.id)).size, 24);
  for (const text of ['', 'abc', '台北🏁', 'x'.repeat(1000)]) assert.equal(sha256Hex(text), hash(text));
  const descriptor = getMultiplayerTrack('netherlands');
  const data = JSON.parse(await readFile(path.join(project, 'public/data/circuits/netherlands.json'), 'utf8'));
  verifyMultiplayerTrackData(descriptor, data);
  const changed = structuredClone(data); changed.elev[0] += 0.01;
  assert.throws(() => verifyMultiplayerTrackData(descriptor, changed), /版本/);
  assert.equal(sha256Hex(canonicalJson(data)), descriptor.dataSha256);
  return { maps: 24, gp: 23, shaVectors: 4, elevationTamperRejected: true };
});
await check('所有24圖可用真WS建房，圈長與起點來自該房track', () => withServer(async h => {
  const client = await h.open();
  for (const descriptor of MULTIPLAYER_TRACKS) {
    const welcome = await entry(client, { type: 'create', name: '試跑車手', laps: 1, trackId: descriptor.id });
    const room = h.service.rooms.get(welcome.room.code), player = room.players.get(welcome.playerId);
    assert.equal(room.trackId, descriptor.id); assert.equal(room.trackStamp, descriptor.trackStamp); assert.equal(room.trackRevision, 1);
    assert.equal(welcome.room.trackLength, room.track.length); assert.equal(welcome.room.catalogStamp, CATALOG_STAMP);
    assert.ok(Number.isFinite(room.track.length) && room.track.length > 1000);
    assert.ok(Math.hypot(player.car.x - room.track.px[0], player.car.z - room.track.pz[0]) <= 3.001);
    assert.equal(player.loaded, false);
    const mark = client.mark(); client.send({ type: 'leave' }); await client.until(value => value.type === 'left', mark);
  }
  return { createdUsingRealSockets: 24, defaultRevision: 1 };
}));
await check('v1/錯catalog與不存在地圖均拒絕，不能建空房或穿越資料路徑', () => withServer(async h => {
  const client = await h.open();
  for (const fields of [{ version: 1 }, { catalogStamp: 'old' }, { catalogStamp: undefined }]) await error(client, { ...identity, ...fields, type: 'create', name: '車手', laps: 1 }, 'INCOMPATIBLE_VERSION');
  for (const trackId of ['unknown', '../src/data/track', 123]) await error(client, { ...identity, type: 'create', name: '車手', laps: 1, trackId }, 'INVALID_TRACK');
  assert.equal(h.service.rooms.size, 0); assert.equal(h.service.trackCache.size, 0);
  return { incompatible: 3, invalidTrack: 3, rooms: 0 };
}));
await check('載入ack綁整個selection，舊ready/start不能解鎖GP', () => withServer(async h => {
  const players = await pair(h, 'japan'), room = players.room, player = room.players.get(players.first.playerId);
  await error(players.a, { type: 'ready', ready: true, trackRevision: 1, trackStamp: room.trackStamp }, 'NOT_READY');
  for (const fields of [{ trackId: 'taipei' }, { trackStamp: 'old' }, { trackRevision: 0 }]) await error(players.a, { type: 'track-loaded', ...selection(room), ...fields }, 'STALE_TRACK');
  assert.equal(player.loaded, false); assert.equal(player.ready, false);
  await load(players.a, room, players.first.playerId);
  await error(players.a, { type: 'ready', ready: true, trackRevision: 0, trackStamp: room.trackStamp }, 'STALE_TRACK');
  await error(players.a, { type: 'start', trackRevision: 0 }, 'STALE_TRACK');
  await error(players.a, { type: 'start', trackRevision: 1 }, 'NOT_READY');
  assert.equal(room.phase, 'lobby'); assert.equal(room.matchId, null);
  await begin(h, players); assert.equal(room.phase, 'racing');
  return { badLoadAcks: 3, gatedReady: true, gatedStart: true };
}));
await check('房主切圖原子清ready/loaded/car/clock；無效圖與舊revision拒絕且同圖no-op', () => withServer(async h => {
  const players = await pair(h, 'japan'), room = players.room; await prepare(players);
  const before = JSON.stringify(h.service.snapshot(room));
  for (const [sender, message, code] of [
    [players.b, { type: 'select-track', trackId: 'mexico', expectedRevision: 1 }, 'HOST_ONLY'],
    [players.a, { type: 'select-track', trackId: 'missing', expectedRevision: 1 }, 'INVALID_TRACK'],
    [players.a, { type: 'select-track', trackId: 'mexico', expectedRevision: 0 }, 'STALE_TRACK'],
  ]) { await error(sender, message, code); assert.equal(JSON.stringify(h.service.snapshot(room)), before); }
  let mark = players.a.mark(); players.a.send({ type: 'select-track', trackId: 'japan', expectedRevision: 1 });
  await players.a.until(value => value.type === 'room', mark); assert.equal(JSON.stringify(h.service.snapshot(room)), before);
  mark = players.a.mark(); players.a.send({ type: 'select-track', trackId: 'mexico', expectedRevision: 1 });
  await players.a.until(value => value.room?.trackId === 'mexico', mark);
  assert.equal(room.trackRevision, 2); assert.equal(room.trackStamp, getMultiplayerTrack('mexico').trackStamp);
  assert.equal(room.matchId, null); assert.equal(room.startAt, null); assert.equal(room.simAt, null);
  for (const player of room.players.values()) {
    assert.equal(player.ready, false); assert.equal(player.loaded, false); assert.equal(player.receivedSeq, -1); assert.equal(player.ackSeq, -1);
    assert.equal(player.completedLaps, 0); assert.equal(player.distance, 0); assert.equal(player.finishMs, null); assert.equal(player.dnf, false); assert.equal(player.car.v, 0);
  }
  await error(players.a, { type: 'ready', ready: true, trackRevision: 1, trackStamp: getMultiplayerTrack('japan').trackStamp }, 'STALE_TRACK');
  return { atomicRejectedVariants: 3, sameMapNoop: true, nextRevision: 2 };
}));
await check('兩房不同地圖互不污染、同圖亦各自持有arrays，仍維持classic性能', () => withServer(async h => {
  const one = await pair(h, 'taipei'), two = await pair(h, 'japan'); await begin(h, one);
  const track = one.room.track, car = one.room.players.get(one.first.playerId).car.snapshot();
  const mark = two.a.mark(); two.a.send({ type: 'select-track', trackId: 'mexico', expectedRevision: 1 });
  await two.a.until(value => value.room?.trackId === 'mexico', mark);
  assert.equal(one.room.track, track); assert.deepEqual(one.room.players.get(one.first.playerId).car.snapshot(), car); assert.equal(one.room.trackRevision, 1);
  const copyA = h.service.trackFor('japan').track, copyB = h.service.trackFor('japan').track;
  assert.notEqual(copyA, copyB); assert.notEqual(copyA.px, copyB.px); assert.equal(copyA.px[0], copyB.px[0]);
  const original = copyB.px[0]; copyA.px[0] += 1; assert.equal(copyB.px[0], original); assert.equal(h.service.trackFor('japan').track.px[0], original);
  one.a.send({ type: 'input', matchId: one.room.matchId, trackRevision: 1, seq: 1, steer: 0, brake: false });
  await settle(); h.advance(20); assert.equal(one.room.players.get(one.first.playerId).ackSeq, 1);
  assert.ok(one.room.players.get(one.first.playerId).car.v > 0); assert.equal(one.room.track.length, track.length);
  return { rooms: 2, separateGeometryArrays: true, taipeiStillAdvances: true };
}));
await check('舊圖input/舊match/假座標不能改權威車況；正確revision才消費seq', () => withServer(async h => {
  const players = await pair(h), room = players.room;
  const mark = players.a.mark(); players.a.send({ type: 'select-track', trackId: 'monaco', expectedRevision: 1 });
  await players.a.until(value => value.room?.trackRevision === 2, mark); await begin(h, players);
  const player = room.players.get(players.first.playerId), before = player.car.snapshot();
  await error(players.a, { type: 'input', matchId: room.matchId, trackRevision: 1, seq: 999, steer: 0, brake: false }, 'STALE_TRACK');
  await error(players.a, { type: 'input', matchId: randomUUID(), trackRevision: 2, seq: 999, steer: 0, brake: false }, 'STALE_MATCH');
  assert.equal(player.receivedSeq, -1); assert.deepEqual(player.car.snapshot(), before);
  players.a.send({ type: 'input', matchId: room.matchId, trackRevision: 2, seq: 1, steer: 0, brake: false, x: 999999, completedLaps: 100 });
  await settle(); assert.equal(player.receivedSeq, 1); assert.equal(player.ackSeq, -1); assert.deepEqual(player.car.snapshot(), before);
  h.advance(20); assert.equal(player.ackSeq, 1); assert.equal(player.completedLaps, 0); assert.notEqual(player.car.x, 999999);
  await error(players.a, { type: 'select-track', trackId: 'italy', expectedRevision: 2 }, 'INVALID_PHASE');
  return { staleTrackRejected: true, staleMatchRejected: true, fakeCoordinatesIgnored: true };
}));
await check('2–4人起跑須全員loaded，斷線轉房主後resume跟隨新地圖且重新ack', () => withServer(async h => {
  const players = await pair(h, 'japan'), room = players.room;
  const extra = await h.open(), third = await entry(extra, { type: 'join', code: room.code, name: '青嵐' });
  const fourthClient = await h.open(), fourth = await entry(fourthClient, { type: 'join', code: room.code, name: '金曜' });
  await prepare(players);
  await error(players.a, { type: 'start', trackRevision: 1 }, 'NOT_READY');
  await load(extra, room, third.playerId); await load(fourthClient, room, fourth.playerId);
  const allReadyAt = players.a.mark();
  for (const client of [extra, fourthClient]) client.send({ type: 'ready', ready: true, trackRevision: 1, trackStamp: room.trackStamp });
  await players.a.until(value => value.room?.players.length === 4 && value.room.players.every(player => player.loaded && player.ready), allReadyAt);
  const startAt = players.a.mark(); players.a.send({ type: 'start', trackRevision: 1 });
  await players.a.until(value => value.room?.phase === 'countdown', startAt);
  await players.a.close(); await settle(); assert.equal(room.hostId, players.second.playerId);
  const mark = players.b.mark(); players.b.send({ type: 'select-track', trackId: 'italy', expectedRevision: 1 });
  await players.b.until(value => value.room?.trackId === 'italy', mark);
  const replacement = await h.open(), restored = await entry(replacement, { type: 'resume', code: room.code, playerId: players.first.playerId, token: players.first.resumeToken });
  assert.equal(restored.room.trackId, 'italy'); assert.equal(restored.room.trackRevision, 2);
  const self = room.players.get(players.first.playerId); assert.equal(self.loaded, false); assert.equal(self.ready, false);
  await error(replacement, { type: 'ready', ready: true, trackRevision: 2, trackStamp: room.trackStamp }, 'NOT_READY');
  await load(replacement, room, self.id); assert.equal(self.loaded, true);
  return { players: 4, newHost: true, resumedLatestMap: true, freshLoadRequired: true };
}));
await check('GP再戰保留地圖/revision與已載入狀態，只清ready及舊賽事', () => withServer(async h => {
  const players = await pair(h, 'belgium'), room = players.room; await begin(h, players);
  const oldMatch = room.matchId; h.advance(50); await settle(); assert.equal(room.phase, 'results');
  const mark = players.a.mark(); players.a.send({ type: 'reset' }); await players.a.until(value => value.room?.phase === 'lobby', mark);
  assert.equal(room.trackId, 'belgium'); assert.equal(room.trackRevision, 1); assert.equal(room.matchId, null);
  assert.ok([...room.players.values()].every(player => player.loaded && !player.ready && player.receivedSeq === -1));
  await begin(h, players); assert.notEqual(room.matchId, oldMatch);
  await error(players.a, { type: 'input', matchId: oldMatch, trackRevision: 1, seq: 1, steer: 0, brake: false }, 'STALE_MATCH');
  return { mapPreserved: true, loadPreserved: true, readyCleared: true, freshMatch: true };
}, { raceLimitMs: 50 }));

report.sourceHashes = await sourceHashes(); report.sourceUnchanged = JSON.stringify(before) === JSON.stringify(report.sourceHashes);
report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
report.status = report.summary.failed === 0 && report.sourceUnchanged ? 'PASS' : 'FAIL';
report.finishedAt = new Date().toISOString();
const evidence = path.join(dir, `multiplayer-maps-server-evidence-${Date.now()}-${randomUUID().slice(0,8)}`); await mkdir(evidence);
await writeFile(path.join(evidence, 'multiplayer-maps-server-summary.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(dir, 'multiplayer-maps-server-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ...report.summary, sourceUnchanged: report.sourceUnchanged, evidence: path.relative(project, evidence) }));
if (report.status !== 'PASS') process.exitCode = 1;
