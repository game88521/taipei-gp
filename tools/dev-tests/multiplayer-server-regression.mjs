// 真本機 WebSocket + 真 Car/Track：測試可注入伺服器時鐘，網路沒有快進或座標接口。
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMultiplayerServer } from '../../server/index.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, TRACK_STAMP } from '../../shared/multiplayer-protocol.ts';
import { WireClient, ORIGIN, drivingInput, settle } from './multiplayer-test-helpers.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '../..');
const compatibility = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, trackStamp: TRACK_STAMP };
const report = { startedAt: new Date().toISOString(), transport: 'real WebSocket on loopback', authoritativePhysics: true, playerStorageTouched: false, externalRequests: [], cases: [] };
const testedFiles = ['server/index.mjs', 'server/room-service.mjs', 'server/physics.mjs', 'shared/multiplayer-protocol.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(testedFiles.map(async (file) => [file, createHash('sha256').update(await readFile(path.join(project, file))).digest('hex')])));
const beforeSource = await sourceHashes();

async function check(name, exercise) {
  try {
    const details = await exercise(); report.cases.push({ name, status: 'PASS', details });
    console.log(JSON.stringify({ name, status: 'PASS', details }));
  } catch (error) {
    report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) });
    console.error(JSON.stringify({ name, status: 'FAIL', error: error.stack ?? String(error) }));
  }
}

async function withServer(exercise, roomOptions = {}) {
  let now = 1_000_000;
  const app = createMultiplayerServer({ now: () => now, autoTick: false, allowedOrigins: [ORIGIN], roomOptions });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(0, '127.0.0.1', resolve); });
  const address = app.httpServer.address();
  const url = `ws://127.0.0.1:${address.port}/ws`, http = `http://127.0.0.1:${address.port}`;
  const clients = [];
  const open = async (origin = ORIGIN, endpoint = url) => {
    const client = new WireClient(endpoint, origin); clients.push(client); await client.open(); return client;
  };
  const advance = (ms) => {
    const end = now + ms;
    while (now + 1000 / 60 < end - 1e-6) { now += 1000 / 60; app.service.tick(now); }
    now = end; app.service.tick(now);
  };
  const clock = { now: () => now, jump: (ms) => { now += ms; }, advance };
  try { return await exercise({ app, service: app.service, open, clock, url, http, clients }); }
  finally { await Promise.all(clients.map((client) => client.close().catch(() => {}))); await app.close(); }
}

async function welcome(client, message) {
  const mark = client.mark(); client.send({ ...compatibility, ...message });
  return client.until((response) => response.type === 'welcome', mark);
}
async function expectError(client, message, code) {
  const mark = client.mark(); client.send(message);
  const response = await client.until((value) => value.type === 'error', mark);
  assert.equal(response.code, code); return response;
}
async function pair(harness, laps = 1) {
  const a = await harness.open(), first = await welcome(a, { type: 'create', name: '赤焰', laps });
  const b = await harness.open(), second = await welcome(b, { type: 'join', name: '藍流', code: first.room.code });
  const room = harness.service.rooms.get(first.room.code);
  return { a, b, first, second, room };
}
async function begin(harness, players) {
  players.a.send({ type: 'ready', ready: true }); players.b.send({ type: 'ready', ready: true });
  await settle();
  const mark = players.a.mark(); players.a.send({ type: 'start' });
  const begun = await players.a.until((response) => response.room?.phase === 'countdown', mark);
  harness.clock.advance(3000); await settle();
  assert.equal(players.room.phase, 'racing');
  return begun.room;
}

await check('精確 Origin／WS 路徑限制與健康檢查，不依賴正式服務', () => withServer(async (h) => {
  const health = await (await fetch(h.http + '/health')).json();
  assert.equal(health.status, 'ok'); assert.equal(health.version, PROTOCOL_VERSION);
  assert.equal((await fetch(h.http + '/unknown')).status, 404);
  await assert.rejects(h.open('https://untrusted.example'), /403/);
  await assert.rejects(h.open(ORIGIN, h.url.replace('/ws', '/other')), /404/);
  assert.equal(h.service.clients.size, 0);
  return { rejectedOrigin: 403, rejectedPath: 404, health };
}));

await check('錯協定／物理／賽道版本與無效名稱不建立房間', () => withServer(async (h) => {
  const client = await h.open();
  for (const incompatible of [{ version: PROTOCOL_VERSION + 1 }, { physics: 'old-physics' }, { trackStamp: 'old-track' }]) {
    await expectError(client, { ...compatibility, ...incompatible, type: 'create', name: '車手', laps: 1 }, 'INCOMPATIBLE_VERSION');
  }
  for (const name of ['', '<script>', '車手'.repeat(9)]) {
    await expectError(client, { ...compatibility, type: 'create', name, laps: 1 }, 'INVALID_NAME');
  }
  await expectError(client, { ...compatibility, type: 'create', name: '車手', laps: 2 }, 'BAD_MESSAGE');
  assert.equal(h.service.rooms.size, 0);
  return { incompatibleVariants: 3, invalidNames: 3, invalidLaps: true };
}));

await check('四個真連線共房、第五人拒絕，快照不洩漏重連憑證', () => withServer(async (h) => {
  const players = await pair(h), welcomes = [players.first, players.second];
  for (const name of ['金曜', '青嵐']) welcomes.push(await welcome(await h.open(), { type: 'join', name, code: players.room.code }));
  const fifth = await h.open();
  await expectError(fifth, { ...compatibility, type: 'join', code: players.room.code, name: '第五位' }, 'ROOM_FULL');
  const snapshot = h.service.snapshot(players.room);
  assert.equal(snapshot.players.length, 4); assert.equal(new Set(snapshot.players.map((p) => p.id)).size, 4);
  assert.equal(new Set(snapshot.players.map((p) => p.color)).size, 4);
  assert.match(snapshot.code, /^[A-HJ-NP-Z2-9]{6}$/);
  for (const entry of welcomes) {
    assert.match(entry.resumeToken, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(snapshot).includes(entry.resumeToken), false);
    for (const response of players.a.messages.filter((message) => message.type !== 'welcome')) assert.equal(JSON.stringify(response).includes(entry.resumeToken), false);
  }
  return { players: snapshot.players.length, codeLength: snapshot.code.length, distinctColors: 4, credentialsPrivate: true };
}));

await check('至少兩人且全員準備才起跑；房主權限與共同三秒時鐘', () => withServer(async (h) => {
  const a = await h.open(), first = await welcome(a, { type: 'create', name: '赤焰', laps: 3 });
  a.send({ type: 'ready', ready: true }); await settle();
  await expectError(a, { type: 'start' }, 'NOT_READY');
  const b = await h.open(), second = await welcome(b, { type: 'join', name: '藍流', code: first.room.code });
  await expectError(b, { type: 'start' }, 'HOST_ONLY');
  await expectError(a, { type: 'start' }, 'NOT_READY');
  const room = h.service.rooms.get(first.room.code), before = h.clock.now();
  b.send({ type: 'ready', ready: true }); await settle();
  const markA = a.mark(), markB = b.mark(); a.send({ type: 'start' });
  const [one, two] = await Promise.all([a.until((m) => m.room?.phase === 'countdown', markA), b.until((m) => m.room?.phase === 'countdown', markB)]);
  assert.equal(one.room.startAt, before + 3000); assert.equal(one.room.startAt, two.room.startAt);
  assert.equal(one.room.matchId, two.room.matchId); assert.equal(one.room.laps, 3);
  a.send({ type: 'input', matchId: room.matchId, seq: 1, steer: 0, brake: false }); await settle();
  h.clock.advance(2990);
  assert.equal(room.phase, 'countdown'); assert.equal(room.players.get(first.playerId).car.v, 0);
  h.clock.advance(10); await settle(); assert.equal(room.phase, 'racing');
  assert.equal(room.players.get(second.playerId).car.v, 0);
  return { startAt: one.room.startAt, sharedMatch: one.room.matchId, noMovementBeforeStart: true };
}));

await check('無效輸入／過期 seq／假座標與完賽宣告不改權威車況', () => withServer(async (h) => {
  const players = await pair(h); await begin(h, players);
  const player = players.room.players.get(players.first.playerId), matchId = players.room.matchId;
  for (const fields of [{ seq: -1, steer: 0, brake: false }, { seq: 1, steer: 2, brake: false }, { seq: 1, steer: null, brake: false }, { seq: 1.5, steer: 0, brake: false }, { seq: 1, steer: 0, brake: 'false' }]) {
    await expectError(players.a, { type: 'input', matchId, ...fields }, 'BAD_MESSAGE');
  }
  const before = player.car.snapshot();
  players.a.send({ type: 'input', matchId, seq: 5, steer: 0.25, brake: true, x: 999999, z: -999999, completedLaps: 100, finishMs: 1 }); await settle();
  assert.equal(player.receivedSeq, 5); assert.equal(player.ackSeq, -1); assert.equal(player.input.steer, 0.25); assert.deepEqual(player.car.snapshot(), before);
  players.a.send({ type: 'input', matchId, seq: 4, steer: -1, brake: false });
  players.a.send({ type: 'input', matchId, seq: 5, steer: -1, brake: false }); await settle();
  assert.equal(player.input.steer, 0.25); assert.equal(player.completedLaps, 0); assert.equal(player.finishMs, null);
  h.clock.advance(20); assert.equal(player.ackSeq, 5, '只在權威物理消費輸入後確認 seq');
  await expectError(players.a, { type: 'finish', finishMs: 1, laps: 1 }, 'BAD_MESSAGE');
  await expectError(players.a, { type: 'input', matchId: randomUUID(), seq: 999, steer: 0, brake: false }, 'STALE_MATCH');
  assert.equal(player.ackSeq, 5);
  return { ackSeq: player.ackSeq, completedLaps: player.completedLaps, finishMs: player.finishMs, clientCoordinatesIgnored: true };
}));

await check('七百毫秒無新輸入自動煞車，其他車手與伺服器時鐘繼續', () => withServer(async (h) => {
  const players = await pair(h); await begin(h, players);
  const a = players.room.players.get(players.first.playerId), b = players.room.players.get(players.second.playerId);
  for (let i = 0; i < 20; i++) {
    players.a.send({ type: 'input', matchId: players.room.matchId, seq: i, steer: 0, brake: false });
    players.b.send({ type: 'input', matchId: players.room.matchId, seq: i, steer: 0, brake: false });
    await settle(); h.clock.advance(50);
  }
  const previousA = a.car.v, previousB = b.car.v, at = h.clock.now();
  for (let i = 20; i < 60; i++) {
    players.b.send({ type: 'input', matchId: players.room.matchId, seq: i, steer: 0, brake: false });
    await settle(); h.clock.advance(50);
  }
  assert.ok(a.car.v < previousA, `stale input must brake: ${a.car.v} < ${previousA}`);
  assert.ok(b.car.v > previousB); assert.equal(players.room.phase, 'racing');
  return { before: { a: previousA, b: previousB }, after: { a: a.car.v, b: b.car.v }, elapsedMs: h.clock.now() - at };
}));

await check('真物理跑完整圈、依序分段後由伺服器完賽與排序；reset清除上一場', () => withServer(async (h) => {
  const players = await pair(h); await begin(h, players);
  const matchId = players.room.matchId, sockets = [players.a, players.b], ids = [players.first.playerId, players.second.playerId];
  let seq = 0;
  for (let frame = 0; frame < 120 * 60 && players.room.phase === 'racing'; frame += 3) {
    for (let index = 0; index < sockets.length; index++) {
      const player = players.room.players.get(ids[index]);
      const command = index === 1 && frame < 120 ? { steer: 0, brake: true } : drivingInput(player.car, h.service.track);
      sockets[index].send({ type: 'input', matchId, seq, ...command });
    }
    seq++; await settle(); h.clock.advance(50);
  }
  await settle();
  assert.equal(players.room.phase, 'results', 'both authoritative cars must complete a full lap');
  const snapshot = h.service.snapshot(players.room), [winner, runnerUp] = snapshot.players;
  assert.equal(winner.id, ids[0]);
  for (const player of snapshot.players) {
    assert.equal(player.completedLaps, 1); assert.equal(player.dnf, false); assert.ok(player.finishMs > 30_000 && player.finishMs < 120_000);
    assert.ok(player.progress >= snapshot.trackLength - 1e-4);
  }
  assert.ok(runnerUp.finishMs > winner.finishMs + 1000);
  const received = await players.a.until((message) => message.room?.phase === 'results');
  assert.deepEqual(received.room.players.map((p) => [p.id, p.finishMs, p.rank]), snapshot.players.map((p) => [p.id, p.finishMs, p.rank]));
  await expectError(players.b, { type: 'reset' }, 'HOST_ONLY');
  players.a.send({ type: 'reset' }); await settle();
  assert.equal(players.room.phase, 'lobby'); assert.equal(players.room.matchId, null);
  for (const player of players.room.players.values()) { assert.equal(player.ackSeq, -1); assert.equal(player.completedLaps, 0); assert.equal(player.ready, false); assert.equal(player.finishMs, null); }
  await begin(h, players); assert.notEqual(players.room.matchId, matchId);
  await expectError(players.a, { type: 'input', matchId, seq: seq + 10, steer: 0, brake: false }, 'STALE_MATCH');
  assert.equal(players.room.players.get(ids[0]).ackSeq, -1);
  players.a.send({ type: 'input', matchId: players.room.matchId, seq: 0, steer: 0, brake: true }); await settle(); h.clock.advance(20);
  assert.equal(players.room.players.get(ids[0]).ackSeq, 0);
  return { fullLapByActualPhysics: true, finishMs: snapshot.players.map((p) => p.finishMs), orderedRanks: snapshot.players.map((p) => p.rank), nextMatchFresh: true };
}));

await check('房主斷線移交，合法 token 恢復席位與車況且舊 socket 不再有權操作', () => withServer(async (h) => {
  const players = await pair(h); await begin(h, players);
  const player = players.room.players.get(players.first.playerId), before = player.car.snapshot();
  await players.a.close(); await settle();
  assert.equal(player.connected, false); assert.equal(players.room.hostId, players.second.playerId);
  const invalid = await h.open();
  await expectError(invalid, { ...compatibility, type: 'resume', code: players.room.code, playerId: player.id, token: '0'.repeat(64) }, 'INVALID_SESSION');
  const replacement = await h.open();
  const resumed = await welcome(replacement, { type: 'resume', code: players.room.code, playerId: player.id, token: players.first.resumeToken });
  assert.equal(resumed.playerId, player.id); assert.equal(player.connected, true); assert.deepEqual(player.car.snapshot(), before);
  assert.equal(players.room.players.size, 2); assert.equal(players.room.hostId, players.second.playerId);
  // 同一合法 token 替換仍在線的 socket；先前 socket 關閉不得把新 owner 斷線。
  const final = await h.open();
  await welcome(final, { type: 'resume', code: players.room.code, playerId: player.id, token: players.first.resumeToken });
  await settle(); assert.equal(replacement.closed, true); assert.equal(player.connected, true);
  final.send({ type: 'input', matchId: players.room.matchId, seq: 1, steer: 0, brake: false }); await settle(); h.clock.advance(20);
  assert.equal(player.ackSeq, 1);
  return { samePlayerId: resumed.playerId, players: players.room.players.size, hostTransferred: true, singleSocketOwner: true };
}));

await check('首位真物理完賽後保留六十秒，逾期未完成者 DNF 並保留贏家時間', () => withServer(async (h) => {
  const players = await pair(h); await begin(h, players);
  const winner = players.room.players.get(players.first.playerId), pending = players.room.players.get(players.second.playerId);
  for (let frame = 0; frame < 120 * 60 && winner.finishMs === null; frame += 3) {
    players.a.send({ type: 'input', matchId: players.room.matchId, seq: frame, ...drivingInput(winner.car, h.service.track) });
    await settle(); h.clock.advance(50);
  }
  assert.ok(winner.finishMs > 30_000 && winner.finishMs < 120_000);
  assert.equal(players.room.phase, 'racing'); assert.equal(pending.finishMs, null); assert.equal(pending.dnf, false);
  const recordedTime = winner.finishMs;
  h.clock.advance(59_800); assert.equal(players.room.phase, 'racing'); assert.equal(pending.dnf, false);
  h.clock.advance(300); await settle();
  assert.equal(players.room.phase, 'results'); assert.equal(pending.dnf, true); assert.equal(winner.dnf, false); assert.equal(winner.finishMs, recordedTime);
  const snapshot = h.service.snapshot(players.room);
  assert.equal(snapshot.players[0].id, winner.id); assert.equal(snapshot.players[1].dnf, true);
  return { winnerFinishMs: recordedTime, graceMs: 60_000, pendingDnf: true, winnerTimePreserved: true };
}));

await check('重連超過十秒標示 DNF；離開不能以舊 token 復活', () => withServer(async (h) => {
  const players = await pair(h); await begin(h, players);
  const player = players.room.players.get(players.first.playerId);
  await players.a.close(); await settle(); h.clock.jump(10_001);
  const reconnect = await h.open();
  await expectError(reconnect, { ...compatibility, type: 'resume', code: players.room.code, playerId: player.id, token: players.first.resumeToken }, 'SESSION_EXPIRED');
  assert.equal(player.dnf, true); assert.equal(player.expired, true); assert.equal(player.token, null);
  players.b.send({ type: 'leave' }); await settle();
  assert.equal(players.room.phase, 'results');
  assert.ok([...players.room.players.values()].every((p) => p.dnf));
  const departed = await h.open();
  await expectError(departed, { ...compatibility, type: 'resume', code: players.room.code, playerId: players.second.playerId, token: players.second.resumeToken }, 'SESSION_EXPIRED');
  return { expiredMs: 10_001, dnf: true, removedCredentials: true };
}));

await check('倒數時斷線取消起跑，回大廳重新準備', () => withServer(async (h) => {
  const players = await pair(h);
  players.a.send({ type: 'ready', ready: true }); players.b.send({ type: 'ready', ready: true }); await settle();
  players.a.send({ type: 'start' }); await settle(); assert.equal(players.room.phase, 'countdown');
  await players.b.close(); await settle();
  assert.equal(players.room.phase, 'lobby'); assert.equal(players.room.matchId, null); assert.equal(players.room.startAt, null);
  assert.ok([...players.room.players.values()].every((p) => !p.ready));
  await expectError(players.a, { type: 'start' }, 'NOT_READY');
  return { countdownCancelled: true, allReadyReset: true };
}));

await check('大廳離開移交房主，空房期限清理，已關房間無法加入', () => withServer(async (h) => {
  const players = await pair(h), code = players.room.code;
  players.a.send({ type: 'leave' }); await settle();
  assert.equal(players.room.hostId, players.second.playerId); assert.equal(players.room.players.size, 1);
  players.b.send({ type: 'leave' }); await settle(); assert.equal(players.room.players.size, 0);
  h.clock.advance(60_001); assert.equal(h.service.rooms.has(code), false);
  const another = await h.open();
  await expectError(another, { ...compatibility, type: 'join', name: '新車手', code }, 'ROOM_NOT_FOUND');
  return { hostTransferred: true, emptyRoomRemovedAfterMs: 60_001 };
}));

await check('全場時間上限與伺服器長停頓均產生 DNF 結果', async () => {
  const result = [];
  await withServer(async (h) => {
    const players = await pair(h); await begin(h, players);
    h.clock.advance(2000);
    assert.equal(players.room.phase, 'results'); assert.ok([...players.room.players.values()].every((p) => p.dnf));
    result.push({ trigger: 'raceLimit', dnf: true });
  }, { raceLimitMs: 2000 });
  await withServer(async (h) => {
    const players = await pair(h); await begin(h, players);
    h.clock.jump(5001); h.service.tick(h.clock.now());
    assert.equal(players.room.phase, 'results'); assert.ok([...players.room.players.values()].every((p) => p.dnf));
    result.push({ trigger: 'serverStall', dnf: true });
  });
  return result;
});

await check('房間與連線容量限制、無效 JSON／過大訊息及操作頻率受限', async () => {
  await withServer(async (h) => {
    await welcome(await h.open(), { type: 'create', name: '房主一', laps: 1 });
    const second = await h.open();
    await expectError(second, { ...compatibility, type: 'create', name: '房主二', laps: 1 }, 'SERVER_FULL');
  }, { maxRooms: 1 });
  await withServer(async (h) => {
    await h.open(); await assert.rejects(h.open(), /503/);
  }, { maxClients: 1 });
  await withServer(async (h) => {
    const client = await h.open();
    for (let i = 0; i < 3; i++) client.ws.send('{bad json');
    await client.waitClosed();
    assert.equal(client.messages.filter((m) => m.code === 'BAD_MESSAGE').length, 3);
    const oversized = await h.open();
    oversized.ws.send('x'.repeat(5000));
    const closeCode = await oversized.waitClosed();
    assert.equal(closeCode, 1009);
    const flood = await h.open();
    for (let i = 0; i < 125; i++) flood.send({ type: 'ping', sentAt: i });
    await flood.waitClosed();
    assert.ok(flood.messages.some((m) => m.code === 'RATE_LIMIT'));
  });
  return { maxRooms: true, maxClients: true, invalidJsonClosesAfter: 3, maxPayloadBytes: 4096, rateLimited: true };
});

report.completedAt = new Date().toISOString();
report.summary = { passed: report.cases.filter((test) => test.status === 'PASS').length, failed: report.cases.filter((test) => test.status === 'FAIL').length };
report.sourceHashes = await sourceHashes();
report.sourceUnchangedDuringTests = JSON.stringify(beforeSource) === JSON.stringify(report.sourceHashes);
report.status = report.summary.failed === 0 && report.sourceUnchangedDuringTests ? 'PASS' : 'FAIL';
report.limitations = ['本機隔離 WS／真權威物理與注入時鐘，不代表跨網路延遲、手機 FPS 或公開常駐服務可靠度', '未使用正式站、Redis、玩家 storage；瀏覽器與固定單人三回歸另行驗證'];
const evidence = path.join(directory, `multiplayer-server-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
await writeFile(path.join(evidence, 'multiplayer-server-summary.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(directory, 'multiplayer-server-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.summary, sourceUnchangedDuringTests: report.sourceUnchangedDuringTests, evidence: path.relative(project, evidence) }));
if (report.status !== 'PASS') process.exitCode = 1;
