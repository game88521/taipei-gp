// 真RoomService／client驗證器；注入時鐘測期限邊界，不連線或改玩家storage。
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import * as roomRules from '../../shared/multiplayer-room-rules.ts';

import * as protocol from '../../shared/multiplayer-protocol.ts';
import * as registry from '../../shared/multiplayer-tracks.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(project, '../taipei-gp-next6-before-57b09b2');
const { RoomService } = await import(pathToFileURL(path.join(project, 'server/room-service.mjs')));
const BeforeService = (await import(pathToFileURL(path.join(before, 'server/room-service.mjs')))).RoomService;
const identity = { version: protocol.PROTOCOL_VERSION, physics: protocol.PHYSICS_VERSION, catalogStamp: registry.CATALOG_STAMP };
const report = { externalRequests: 0, storageTouched: false, cases: [], limitations: ['真RoomService與client驗證器，使用隔離socket及注入時鐘；不代表真瀏覽器或外網對戰驗收。'] };
async function test(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
}
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; messages = [];
  send(text) { this.messages.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.emit('close'); }
}
function pair(Service = RoomService) {
  let now = 1_000_000;
  const service = new Service({ now: () => now });
  const a = service.accept(new Socket()), b = service.accept(new Socket());
  service.receive(a, { type: 'create', ...identity, name: '甲', laps: 3, trackId: 'taipei' });
  const room = a.room;
  service.receive(b, { type: 'join', ...identity, name: '乙', code: room.code });
  for (const client of [a, b]) {
    service.receive(client, { type: 'track-loaded', trackId: room.trackId, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
    service.receive(client, { type: 'ready', ready: true, trackStamp: room.trackStamp, trackRevision: room.trackRevision });
  }
  const begin = () => {
    service.receive(a, { type: 'start', trackRevision: room.trackRevision });
    now = room.startAt; service.tick(now); assert.equal(room.phase, 'racing');
  };
  return { service, a, b, room, begin, setNow: value => { now = value; } };
}
function clientClass(source) {
  const code = stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-protocol['"];?/, 'const { PROTOCOL_VERSION, PHYSICS_VERSION, validSeries, validSeriesTracks } = protocol;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-tracks['"];?/, 'const { CATALOG_STAMP, DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack } = registry;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-room-rules['"];?/, 'const {parseRoomRules}=roomRules;')
    .replace('export class MultiplayerClient', 'class MultiplayerClient') + '\nglobalThis.Client = MultiplayerClient;';
  const context = vm.createContext({ protocol, registry, roomRules, URL, Date, performance, location: { protocol: 'http:' } });
  vm.runInContext(code, context); return context.Client;
}
const Client = clientClass(await readFile(path.join(project, 'src/multiplayer-client.ts'), 'utf8'));
const BeforeClient = clientClass(await readFile(path.join(before, 'src/multiplayer-client.ts'), 'utf8'));
const validate = (room, Class = Client) => new Class('ws://127.0.0.1:4320/ws').validateRoom(room);

await test('舊版缺少期限與原因，新版明確同步；新舊client相互讀取v2快照', () => {
  const old = pair(BeforeService), next = pair();
  const lobby = next.service.snapshot(next.room); validate(lobby); validate(lobby, BeforeClient);
  assert.equal(lobby.deadlineAt, null); assert.equal(lobby.deadlineReason, null);
  old.begin(); next.begin();
  const legacy = old.service.snapshot(old.room), snapshot = next.service.snapshot(next.room);
  assert.equal(legacy.deadlineAt, undefined); assert.equal(legacy.players[0].dnfReason, undefined);
  validate(legacy); validate(snapshot); validate(snapshot, BeforeClient);
  assert.equal(snapshot.deadlineAt, next.room.startAt + 600_000); assert.equal(snapshot.deadlineReason, 'race-timeout');
  return { protocolVersion: identity.version, legacyServerAccepted: true, legacyClientAccepted: true, raceLimitMs: snapshot.deadlineAt - next.room.startAt };
});

await test('10分鐘到期前不結束，邊界與舊版相同；新增race-timeout原因', () => {
  for (const Service of [BeforeService, RoomService]) {
    const h = pair(Service); h.begin(); const deadline = h.room.startAt + 600_000;
    assert.equal(h.service.maybeFinish(h.room, deadline - 0.001), false);
    assert.equal(h.service.maybeFinish(h.room, deadline), true);
    assert.ok([...h.room.players.values()].every(player => player.dnf));
    if (Service === RoomService) {
      const snapshot = h.service.snapshot(h.room, deadline); validate(snapshot);
      assert.ok(snapshot.players.every(player => player.dnfReason === 'race-timeout'));
    }
  }
});

await test('首位完賽後60秒仍沿用舊邊界；靠近10分鐘時取較早期限', () => {
  for (const Service of [BeforeService, RoomService]) {
    const h = pair(Service); h.begin();
    h.a.player.finishMs = 120_000; h.a.player.completedLaps = 3;
    h.a.player.lapTimesMs = [40_000, 40_000, 40_000]; h.a.player.bestLapMs = 40_000; h.a.player.lastLapElapsedMs = 120_000;
    h.room.firstFinishAt = h.room.startAt + 120_000;
    const deadline = h.room.firstFinishAt + 60_000;
    assert.equal(h.service.maybeFinish(h.room, deadline - 0.001), false);
    if (Service === RoomService) {
      const snapshot = h.service.snapshot(h.room, deadline - 1); validate(snapshot);
      assert.equal(snapshot.deadlineAt, deadline); assert.equal(snapshot.deadlineReason, 'finish-timeout');
    }
    assert.equal(h.service.maybeFinish(h.room, deadline), true);
    assert.equal(h.a.player.dnf, false); assert.equal(h.b.player.dnf, true);
    if (Service === RoomService) {
      assert.equal(h.a.player.dnfReason, null); assert.equal(h.b.player.dnfReason, 'finish-timeout');
      validate(h.service.snapshot(h.room, deadline));
    }
  }
  const h = pair(); h.begin(); h.room.firstFinishAt = h.room.startAt + 580_000;
  assert.equal(h.service.snapshot(h.room).deadlineAt, h.room.startAt + 600_000);
  assert.equal(h.service.snapshot(h.room).deadlineReason, 'race-timeout');
  h.room.firstFinishAt = h.room.startAt + 540_000;
  assert.equal(h.service.snapshot(h.room).deadlineAt, h.room.startAt + 600_000);
  assert.equal(h.service.snapshot(h.room).deadlineReason, 'race-timeout', '兩個期限相同時維持全場期限原因');
});

await test('斷線仍有10秒重連期限，逾期記原因；主動退出及長停頓原因各自保留', () => {
  const h = pair(); h.begin(); const disconnected = h.b.player;
  h.service.disconnect(h.b); h.service.expireDisconnected(h.room, h.room.startAt + 9999);
  assert.equal(disconnected.dnf, false);
  h.service.expireDisconnected(h.room, h.room.startAt + 10_000);
  assert.equal(disconnected.dnfReason, 'disconnect-expired'); validate(h.service.snapshot(h.room));
  h.service.maybeFinish(h.room, h.room.startAt + 600_000);
  assert.equal(disconnected.dnfReason, 'disconnect-expired', '整場期限不覆蓋較早的斷線原因');
  const leave = pair(); leave.begin(); const left = leave.b.player;
  leave.service.leave(leave.b, leave.room.startAt); assert.equal(left.dnfReason, 'left'); validate(leave.service.snapshot(leave.room));
  const stall = pair(); stall.begin(); stall.service.tick(stall.room.startAt + 5001);
  assert.equal(stall.room.phase, 'results'); assert.ok([...stall.room.players.values()].every(player => player.dnfReason === 'server-stall'));
  validate(stall.service.snapshot(stall.room));
});

await test('已完賽再離線保持有效成績；再戰與取消倒數清除期限和舊原因', () => {
  const h = pair(); h.begin(); h.a.player.finishMs = 123_000; h.a.player.completedLaps = 3;
  h.a.player.lapTimesMs = [41_000, 41_000, 41_000]; h.a.player.bestLapMs = 41_000; h.a.player.lastLapElapsedMs = 123_000;
  h.service.disconnect(h.a); h.service.expireDisconnected(h.room, h.room.startAt + 10_000);
  assert.equal(h.room.players.get(h.room.hostId).id, h.b.player.id);
  const finished = [...h.room.players.values()].find(player => player.finishMs !== null);
  assert.equal(finished.dnf, false); assert.equal(finished.dnfReason, null);
  const completedLeave = pair(); completedLeave.begin(); const completed = completedLeave.b.player;
  completed.finishMs = 120_000; completed.completedLaps = 3;
  completed.lapTimesMs = [40_000, 40_000, 40_000]; completed.bestLapMs = 40_000; completed.lastLapElapsedMs = 120_000;
  completedLeave.service.leave(completedLeave.b, completedLeave.room.startAt + 120_000);
  assert.equal(completed.finishMs, 120_000); assert.equal(completed.dnf, false); assert.equal(completed.dnfReason, null);
  const next = pair(); next.begin(); next.service.maybeFinish(next.room, next.room.startAt + 600_000);
  next.service.receive(next.a, { type: 'reset' });
  const snapshot = next.service.snapshot(next.room); validate(snapshot);
  assert.equal(snapshot.deadlineAt, null); assert.equal(snapshot.deadlineReason, null);
  assert.ok(snapshot.players.every(player => !player.dnf && player.dnfReason === null));
  next.service.receive(next.a, { type: 'ready', ready: true, trackStamp: next.room.trackStamp, trackRevision: next.room.trackRevision });
  next.service.receive(next.b, { type: 'ready', ready: true, trackStamp: next.room.trackStamp, trackRevision: next.room.trackRevision });
  next.service.receive(next.a, { type: 'start', trackRevision: next.room.trackRevision });
  assert.equal(next.room.phase, 'countdown'); next.service.disconnect(next.b);
  assert.equal(next.room.phase, 'lobby'); assert.equal(next.service.snapshot(next.room).deadlineAt, null);
});

await test('新client拒絕不完整／錯型別／矛盾deadline與DNF原因，合法原因全數接受', () => {
  const h = pair(); h.begin(); const snapshot = h.service.snapshot(h.room);
  const invalid = [
    { deadlineAt: undefined }, { deadlineReason: undefined }, { deadlineAt: null, deadlineReason: null },
    { deadlineAt: '600000' }, { deadlineAt: Infinity }, { deadlineAt: snapshot.startAt - 1 },
    { deadlineReason: 'unknown' }, { deadlineAt: snapshot.deadlineAt, phase: 'lobby' },
  ];
  for (const patch of invalid) {
    const value = { ...snapshot, ...patch };
    assert.throws(() => validate(value), /截止時間/); validate(value, BeforeClient);
  }
  for (const reason of ['race-timeout', 'finish-timeout', 'disconnect-expired', 'left', 'server-stall']) {
    const value = structuredClone(snapshot); Object.assign(value.players[0], { dnf: true, dnfReason: reason }); validate(value);
  }
  const invalidReasons = [
    { dnf: true, dnfReason: null }, { dnf: true, dnfReason: 'unknown' },
    { dnf: false, dnfReason: 'left' }, { dnf: true, dnfReason: 'left', finishMs: 1000 },
    ...[1, ['left'], [['left']], {}, true, undefined].map(dnfReason => ({ dnf: true, dnfReason })),
  ];
  for (const patch of invalidReasons) {
    const value = structuredClone(snapshot); Object.assign(value.players[0], patch);
    assert.throws(() => validate(value), /原因/); validate(value, BeforeClient);
  }
  const legacyDnf = structuredClone(snapshot); legacyDnf.players[0].dnf = true; delete legacyDnf.players[0].dnfReason; validate(legacyDnf);
  return { invalidDeadlineCases: invalid.length, validReasons: 5, invalidReasonCases: invalidReasons.length, legacyDnfWithoutReasonAccepted: true };
});

report.summary = { passed: report.cases.filter(item => item.status === 'PASS').length, failed: report.cases.filter(item => item.status === 'FAIL').length };
await writeFile(path.join(project, 'tools/dev-tests/next6-multiplayer-deadlines-result.json'), JSON.stringify(report, null, 2) + '\n');
for (const item of report.cases) console.log(`${item.status} ${item.name}${item.error ? '\n' + item.error : ''}`);
console.log(JSON.stringify(report.summary)); if (report.summary.failed) process.exitCode = 1;
