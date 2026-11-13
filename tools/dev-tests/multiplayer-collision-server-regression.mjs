// Real loopback sockets and authoritative Car/Track; only the harness arranges initial poses.
// No endpoint accepts the harness's position/speed changes. No external traffic or player saves.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(args[i] === '--case' && args[i + 1], 'Use --case NAME.');
  assert.ok(!Object.hasOwn(options, args[i]), 'Duplicate option.'); options[args[i]] = args[i + 1];
}
const project = path.resolve(directory, '../..');
const { createMultiplayerServer } = await import(pathToFileURL(path.join(project, 'server/index.mjs')).href);
const { Car } = await import(pathToFileURL(path.join(project, 'server/physics.mjs')).href);
const { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } = await import(pathToFileURL(path.join(project, 'shared/multiplayer-protocol.ts')).href);
// Test transport dependencies remain the existing installed package in the work tree.
const { WireClient, ORIGIN, settle } = await import('./multiplayer-test-helpers.mjs');
const identity = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP };
const STEP = 1000 / 60;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['server/index.mjs', 'server/room-service.mjs', 'server/physics.mjs', 'src/car.ts', 'src/track.ts', 'shared/multiplayer-protocol.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, hash(await readFile(path.join(project, name)))])));
const beforeSources = await sourceHashes();
const report = {
  startedAt: new Date().toISOString(), project, identity, transport: 'real WebSocket on loopback',
  realAuthoritativeCar: true, externalRequests: 0, playerStorageTouched: false,
  initialPosesArrangedInsideHarness: true, cases: [],
};
async function check(id, name, exercise) {
  if (options['--case'] && options['--case'] !== id) return;
  try { report.cases.push({ id, name, status: 'PASS', detail: await exercise() }); }
  catch (error) { report.cases.push({ id, name, status: 'FAIL', error: error.stack ?? String(error) }); }
  console.log(JSON.stringify(report.cases.at(-1)));
}
async function withServer(exercise) {
  let now = 1_000_000;
  const app = createMultiplayerServer({ now: () => now, autoTick: false, allowedOrigins: [ORIGIN] });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(0, '127.0.0.1', resolve); });
  const endpoint = `ws://127.0.0.1:${app.httpServer.address().port}/ws`, clients = [];
  const open = async () => { const client = new WireClient(endpoint, ORIGIN); clients.push(client); await client.open(); return client; };
  const advance = ms => {
    const end = now + ms;
    while (now + STEP < end - 1e-6) { now += STEP; app.service.tick(now); }
    now = end; app.service.tick(now);
  };
  const h = { app, service: app.service, open, advance, now: () => now };
  try { return await exercise(h); }
  finally { await Promise.all(clients.map(client => client.close().catch(() => {}))); await app.close(); }
}
const selection = room => ({ trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
async function entry(client, message) {
  const mark = client.mark(); client.send({ ...identity, ...message });
  const response = await client.until(value => value.type === 'welcome' || value.type === 'error', mark);
  assert.equal(response.type, 'welcome', response.code); return response;
}
async function load(client, room, id) {
  const mark = client.mark(); client.send({ type: 'track-loaded', ...selection(room) });
  await client.until(value => value.room?.players.some(player => player.id === id && player.loaded), mark);
}
async function roomWith(h, count = 2, trackId = 'taipei') {
  const clients = [], welcomes = [], players = [];
  for (let index = 0; index < count; index++) {
    const client = await h.open();
    const welcome = await entry(client, index === 0
      ? { type: 'create', name: '赤焰', laps: 1, trackId }
      : { type: 'join', name: ['赤焰', '藍流', '金隼', '綠影'][index], code: welcomes[0].room.code });
    clients.push(client); welcomes.push(welcome);
  }
  const room = h.service.rooms.get(welcomes[0].room.code);
  for (let index = 0; index < count; index++) { players.push(room.players.get(welcomes[index].playerId)); await load(clients[index], room, welcomes[index].playerId); }
  return { clients, welcomes, players, room };
}
async function countdown(h, pair) {
  const readyMark = pair.clients[0].mark();
  for (const client of pair.clients) client.send({ type: 'ready', ready: true, trackRevision: pair.room.trackRevision, trackStamp: pair.room.trackStamp });
  await pair.clients[0].until(value => value.room?.players.length === pair.players.length && value.room.players.every(player => player.loaded && player.ready), readyMark);
  const mark = pair.clients[0].mark(); pair.clients[0].send({ type: 'start', trackRevision: pair.room.trackRevision });
  await pair.clients[0].until(value => value.room?.phase === 'countdown', mark);
}
async function begin(h, pair) { await countdown(h, pair); h.advance(3000); await settle(); assert.equal(pair.room.phase, 'racing'); }
async function throttle(pair, seq = 1) {
  // Same-socket pong proves the preceding input reached the real server before advancing its clock.
  await Promise.all(pair.clients.filter(client => !client.closed).map(async client => {
    const mark = client.mark();
    client.send({ type: 'input', matchId: pair.room.matchId, trackRevision: pair.room.trackRevision, seq, steer: 0, brake: false });
    client.send({ type: 'ping', sentAt: seq });
    await client.until(value => value.type === 'pong' && value.sentAt === seq, mark);
  }));
}
function straight(track) {
  let best = Math.floor(track.N / 4), score = Infinity;
  for (let i = 10; i < track.N - 10; i++) {
    let candidate = 0;
    for (let k = -8; k <= 8; k++) candidate += Math.abs(track.curv[(i + k + track.N) % track.N]);
    if (candidate < score) { score = candidate; best = i; }
  }
  return best;
}
function place(car, track, index, along, lat, speed) {
  car.resetTransient(false); car.placeAt(track, index);
  car.x += track.tx[index] * along - track.tz[index] * lat;
  car.z += track.tz[index] * along + track.tx[index] * lat;
  car.v = speed; car.update(0, track, 0, false);
  assert.ok(Math.abs(car.pos.lat) <= 8.50001);
}
function placeAtS(car, track, s, lat, speed) {
  const wrapped = ((s % track.length) + track.length) % track.length;
  const index = Math.min(track.N - 1, Math.floor(wrapped / track.ds));
  place(car, track, index, wrapped - track.dist[index], lat, speed);
}
function clone(car) { const copy = new Car(); copy.restore(car.snapshot()); return copy; }
function wrapDelta(next, previous, length) {
  let delta = next - previous; if (delta > length / 2) delta -= length; if (delta < -length / 2) delta += length; return delta;
}
function assertFiniteCar(car) {
  for (const key of ['x', 'z', 'h', 'v']) assert.ok(Number.isFinite(car[key]), `${key} must remain finite`);
  assert.ok(car.v >= 0); assert.ok(Math.abs(car.pos.lat) <= 8.50001, 'collision cannot leave car outside wall');
}
async function matchingSnapshots(h, pair) {
  const marks = pair.clients.map(client => client.mark()); h.service.broadcast(pair.room, 'snapshot', h.now());
  const messages = await Promise.all(pair.clients.map((client, index) => client.until(value => value.type === 'snapshot' && value.room?.serverTime === h.now(), marks[index])));
  const expected = h.service.snapshot(pair.room, h.now());
  for (const message of messages) {
    assert.deepEqual(message.room, expected, 'both real sockets must receive the final authoritative collision state');
    assert.ok(!JSON.stringify(message).includes('resumeToken'));
    for (const player of message.room.players) { assert.equal(player.token, undefined); assert.equal(player.client, undefined); }
  }
  return expected;
}

await check('baseline-comparison', '相同追撞初始條件：舊server會穿車，新server阻擋並掉速', async () => {
  const baselineProject = path.resolve(project, '../taipei-gp-collision-before-f586ca9');
  const { RoomService: BeforeService } = await import(pathToFileURL(path.join(baselineProject, 'server/room-service.mjs')).href);
  const beforeIdentity = await import(pathToFileURL(path.join(baselineProject, 'shared/multiplayer-protocol.ts')).href);
  const { RoomService: AfterService } = await import(pathToFileURL(path.join(project, 'server/room-service.mjs')).href);
  class MemorySocket extends EventEmitter {
    readyState = 1; bufferedAmount = 0; messages = [];
    send(bytes) { this.messages.push(JSON.parse(bytes)); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  }
  const run = (Service, protocol) => {
    let now = 1_000_000;
    const service = new Service({ now: () => now });
    const sockets = [new MemorySocket(), new MemorySocket()];
    const clients = sockets.map(socket => service.accept(socket));
    const compatible = { version: protocol.PROTOCOL_VERSION, physics: protocol.PHYSICS_VERSION, catalogStamp: protocol.CATALOG_STAMP };
    try {
      service.receive(clients[0], { ...compatible, type: 'create', name: '赤焰', laps: 1, trackId: 'taipei' });
      const welcome = sockets[0].messages.find(value => value.type === 'welcome'); assert.ok(welcome);
      service.receive(clients[1], { ...compatible, type: 'join', name: '藍流', code: welcome.room.code });
      const room = service.rooms.get(welcome.room.code), players = clients.map(client => client.player);
      for (const client of clients) {
        service.receive(client, { type: 'track-loaded', ...selection(room) });
        service.receive(client, { type: 'ready', ready: true, trackRevision: room.trackRevision, trackStamp: room.trackStamp });
      }
      service.receive(clients[0], { type: 'start', trackRevision: room.trackRevision });
      now += 3000; service.tick(now); assert.equal(room.phase, 'racing');
      const index = straight(room.track), [rear, front] = players;
      place(rear.car, room.track, index, 0, 0, 70); place(front.car, room.track, index, 6, 0, 15);
      for (const client of clients) service.receive(client, { type: 'input', matchId: room.matchId, trackRevision: room.trackRevision, seq: 1, steer: 0, brake: false });
      for (let step = 0; step < 8; step++) { now += STEP; service.tick(now); }
      const gap = (front.car.x - rear.car.x) * room.track.tx[index] + (front.car.z - rear.car.z) * room.track.tz[index];
      return { gap, rearSpeed: rear.car.v, frontSpeed: front.car.v, physics: compatible.physics };
    } finally { service.close(); }
  };
  const before = run(BeforeService, beforeIdentity), after = run(AfterService, { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP });
  assert.ok(before.gap < 0, `old server must reproduce passing through: gap=${before.gap}`);
  assert.ok(after.gap >= 5.05, `new server must keep the rear car behind: gap=${after.gap}`);
  assert.ok(after.rearSpeed < before.rearSpeed - 1); assert.ok(after.frontSpeed > before.frontSpeed + 1);
  return { before, after, sameInitialPoses: true, immutableBeforeWritten: false };
});

await check('compatibility', '舊physics拒絕，假碰撞／座標訊息無法改寫權威車況', () => withServer(async h => {
  const client = await h.open(), mark = client.mark();
  client.send({ ...identity, physics: 'classic-multitrack-v2', type: 'create', name: '舊車手', laps: 1, trackId: 'taipei' });
  const rejected = await client.until(value => value.type === 'error' || value.type === 'welcome', mark);
  assert.equal(rejected.type, 'error'); assert.equal(rejected.code, 'INCOMPATIBLE_VERSION'); assert.equal(h.service.rooms.size, 0);
  const pair = await roomWith(h); await begin(h, pair); const saved = pair.players.map(player => player.car.snapshot());
  for (const type of ['collision', 'hit', 'finish']) {
    const from = pair.clients[0].mark(); pair.clients[0].send({ type, x: 999999, z: -999999, v: 999, playerId: pair.players[1].id, impulse: 999, finishMs: 1 });
    const response = await pair.clients[0].until(value => value.type === 'error', from); assert.equal(response.code, 'BAD_MESSAGE');
  }
  pair.clients[0].send({ type: 'input', matchId: pair.room.matchId, trackRevision: pair.room.trackRevision, seq: 1, steer: 0, brake: false, x: 99999, collision: { target: pair.players[1].id, impulse: 99999 } });
  await settle(); assert.deepEqual(pair.players.map(player => player.car.snapshot()), saved);
  await matchingSnapshots(h, pair);
  return { oldPhysicsRejected: true, forgedCollisionTypesRejected: 3, onlyControlsAccepted: true, snapshotSecretsAbsent: true };
}));

await check('grid', '四人起跑格不重疊，倒數不推車且共同加速不鎖死', () => withServer(async h => {
  const pair = await roomWith(h, 4); await countdown(h, pair);
  const initial = pair.players.map(player => player.car.snapshot());
  const lat = initial.map(car => car.pos.lat).sort((a, b) => a - b);
  for (let i = 1; i < lat.length; i++) assert.ok(lat[i] - lat[i - 1] >= 1.9, 'four body-widths must fit at the same start s');
  h.advance(2990); assert.deepEqual(pair.players.map(player => player.car.snapshot()), initial);
  h.advance(10); await throttle(pair); h.advance(200);
  for (const player of pair.players) { assertFiniteCar(player.car); assert.ok(player.car.v > 2, `grid contact must not freeze the start: ${JSON.stringify(pair.players.map(p => ({ v: p.car.v, loaded: p.loaded, ack: p.ackSeq, lat: p.car.pos.lat, inputAt: p.lastInputAt })))}`); assert.equal(player.completedLaps, 0); }
  await matchingSnapshots(h, pair);
  return { players: 4, countdownStationary: true, speedsAfter200ms: pair.players.map(player => player.car.v) };
}));

await check('rear-impact', '真追撞造成權威減速與前車受推，不能直接穿過', () => withServer(async h => {
  const pair = await roomWith(h); await begin(h, pair); const [rear, front] = pair.players, track = pair.room.track, index = straight(track);
  place(rear.car, track, index, 0, 0, 70); place(front.car, track, index, 6, 0, 15);
  const freeRear = clone(rear.car), freeFront = clone(front.car); await throttle(pair);
  for (let i = 0; i < 8; i++) { freeRear.update(1 / 60, track, 0, false); freeFront.update(1 / 60, track, 0, false); h.advance(STEP); }
  assert.ok(rear.car.v < freeRear.v - 1, 'rear driver must lose speed compared with the same unopposed Car');
  assert.ok(front.car.v > freeFront.v + 1, 'front driver must receive the impact rather than remaining intangible');
  const along = (front.car.x - rear.car.x) * track.tx[index] + (front.car.z - rear.car.z) * track.tz[index];
  assert.ok(along >= 5.05, `following car must remain behind the leader, gap=${along}`);
  pair.players.forEach(player => { assertFiniteCar(player.car); assert.equal(player.completedLaps, 0); assert.equal(player.finishMs, null); });
  await matchingSnapshots(h, pair);
  return { freeRearSpeed: freeRear.v, collidedRearSpeed: rear.car.v, freeFrontSpeed: freeFront.v, collidedFrontSpeed: front.car.v, finalGap: along };
}));

await check('wall-contact', '牆邊側擦會分離，雙車維持牆內且snapshot一致', () => withServer(async h => {
  const pair = await roomWith(h); await begin(h, pair); const [inner, outer] = pair.players, track = pair.room.track, index = straight(track);
  place(inner.car, track, index, 0, 6.8, 35); place(outer.car, track, index, 0, 8.35, 35); await throttle(pair);
  h.advance(STEP * 6);
  const width = Math.abs(inner.car.pos.lat - outer.car.pos.lat);
  assert.ok(width >= 1.88, `side contact must leave body-width clearance, width=${width}`);
  pair.players.forEach(player => { assertFiniteCar(player.car); assert.ok(player.car.v < 40, 'side contact must not add uncontrolled acceleration'); });
  await matchingSnapshots(h, pair);
  return { sideClearance: width, lat: pair.players.map(player => player.car.pos.lat), finiteAndWithinWalls: true };
}));

await check('progress-after-impact', '碰撞後依最終pose結算progress／gate，不漏記受推車或誤給圈數', () => withServer(async h => {
  const pair = await roomWith(h); await begin(h, pair); const [rear, front] = pair.players, track = pair.room.track, gate = track.length / 3;
  placeAtS(front.car, track, gate - 0.2, 0, 3); placeAtS(rear.car, track, gate - 5.5, 0, 65);
  const initial = pair.players.map(player => ({ s: player.car.pos.s, distance: player.car.pos.s }));
  pair.players.forEach((player, index) => { player.distance = initial[index].distance; player.nextGate = 1; player.completedLaps = 0; });
  const freeFront = clone(front.car); freeFront.update(1 / 60, track, 0, false); await throttle(pair); h.advance(STEP);
  assert.ok(front.car.pos.s > freeFront.pos.s + 0.1, 'collision must push the front car across the nearby sector gate');
  for (let index = 0; index < pair.players.length; index++) {
    const player = pair.players[index], expected = initial[index].distance + wrapDelta(player.car.pos.s, initial[index].s, track.length);
    assert.ok(Math.abs(player.distance - expected) < 1e-7, `progress must use final collision pose: ${player.distance} vs ${expected}`);
    assert.equal(player.nextGate, expected >= gate ? 2 : 1); assert.equal(player.completedLaps, 0); assert.equal(player.finishMs, null);
  }
  const snapshot = await matchingSnapshots(h, pair);
  assert.equal(snapshot.players[0].id, front.id); assert.equal(snapshot.players[0].rank, 1); assert.equal(snapshot.players[1].rank, 2);
  return { pushedBeyondFreeMotion: front.car.pos.s - freeFront.pos.s, sectorGateUpdatedFromFinalPose: true, completedLaps: [rear.completedLaps, front.completedLaps], finishDeclared: false };
}));

await check('resume-loaded-gate', '斷線／重連未loaded不阻擋實車，loaded後才重新可碰撞', () => withServer(async h => {
  const pair = await roomWith(h); await begin(h, pair); const [active, returning] = pair.players, track = pair.room.track, index = straight(track);
  await pair.clients[1].close(); await settle(); assert.equal(returning.connected, false);
  place(active.car, track, index, 0, 0, 30); place(returning.car, track, index, 0, 0, 30);
  let free = clone(active.car); await throttle(pair); free.update(1 / 60, track, 0, false); h.advance(STEP);
  assert.deepEqual(active.car.snapshot(), free.snapshot(), 'disconnected car must be nonblocking');
  const resumedClient = await h.open();
  const resumed = await entry(resumedClient, { type: 'resume', code: pair.room.code, playerId: returning.id, token: pair.welcomes[1].resumeToken });
  assert.equal(resumed.playerId, returning.id); assert.equal(returning.connected, true); assert.equal(returning.loaded, false);
  place(active.car, track, index, 0, 0, 30); place(returning.car, track, index, 0, 0, 30);
  free = clone(active.car); await throttle(pair, 2); free.update(1 / 60, track, 0, false); h.advance(STEP);
  assert.deepEqual(active.car.snapshot(), free.snapshot(), 'unloaded resume must remain nonblocking');
  await load(resumedClient, pair.room, returning.id);
  place(active.car, track, index, 0, 0, 30); place(returning.car, track, index, 0, 0, 30);
  free = clone(active.car); await throttle(pair, 3); free.update(1 / 60, track, 0, false); h.advance(STEP);
  assert.ok(Math.hypot(active.car.x - free.x, active.car.z - free.z) > 0.1, 'loaded overlapping player must participate again');
  [active, returning].forEach(player => assertFiniteCar(player.car));
  return { disconnectedNonblocking: true, resumedBeforeAckNonblocking: true, loadedRejoinsCollision: true };
}));

await check('finished-and-dnf', '已完賽與DNF車不影響其他車手且保持成績', async () => {
  const detail = [];
  for (const state of ['finished', 'dnf']) await withServer(async h => {
    const pair = await roomWith(h); await begin(h, pair); const [active, ghost] = pair.players, track = pair.room.track, index = straight(track);
    if (state === 'finished') ghost.finishMs = 45_678.125; else ghost.dnf = true;
    place(active.car, track, index, 0, 0, 30); place(ghost.car, track, index, 0, 0, 0);
    const saved = ghost.car.snapshot(), free = clone(active.car); await throttle(pair); free.update(1 / 60, track, 0, false); h.advance(STEP);
    assert.deepEqual(active.car.snapshot(), free.snapshot(), `${state} car must not block the active car`);
    assert.deepEqual(ghost.car.snapshot(), saved); assert.equal(ghost.finishMs, state === 'finished' ? 45_678.125 : null);
    detail.push({ state, nonblocking: true, resultPreserved: true });
  });
  return detail;
});

await check('room-isolation', '同圖不同房不互撞，碰撞不可跨房間影響權威車況', () => withServer(async h => {
  const first = await roomWith(h), second = await roomWith(h); await begin(h, first); await begin(h, second);
  assert.notEqual(first.room.track, second.room.track);
  for (const pair of [first, second]) {
    const track = pair.room.track, index = straight(track);
    place(pair.players[0].car, track, index, 0, 0, 30);
    place(pair.players[1].car, track, index, 30, 5, 30);
  }
  // An opposite-heading car occupies the identical location in another room.
  second.players[0].car.h += Math.PI;
  const free = clone(first.players[0].car); await throttle(first); await throttle(second);
  free.update(1 / 60, first.room.track, 0, false); h.advance(STEP);
  assert.deepEqual(first.players[0].car.snapshot(), free.snapshot());
  await matchingSnapshots(h, first); await matchingSnapshots(h, second);
  return { rooms: 2, independentTrack: true, coincidentDifferentRoomCarIgnored: true };
}));

assert.ok(report.cases.length > 0, 'No matching test case.');
report.finishedAt = new Date().toISOString();
report.sourceHashes = await sourceHashes();
report.sourceUnchangedDuringTests = JSON.stringify(beforeSources) === JSON.stringify(report.sourceHashes);
report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
report.status = report.summary.failed === 0 && report.sourceUnchangedDuringTests ? 'PASS' : 'FAIL';
report.limitations = ['初始相對位置由本機測試harness安排，封包仍只接受方向／煞車；不驗跨網路延遲、渲染或手機', '此套聚焦RoomService整合；純OBB/SAT、高速sweep、立體橋與四車堆疊由獨立物理案例驗證'];
const evidence = path.join(directory, `multiplayer-collision-server-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(directory, 'multiplayer-collision-server-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.summary, sourceUnchangedDuringTests: report.sourceUnchangedDuringTests, evidence: path.relative(directory, evidence) }));
if (report.status !== 'PASS') process.exitCode = 1;
