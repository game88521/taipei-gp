// Real loopback WebSockets and authoritative RoomService; no browser, public server or player storage.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from '../../server/node_modules/ws/wrapper.mjs';
import { createMultiplayerServer } from '../../server/index.mjs';
import * as protocol from '../../shared/multiplayer-protocol.ts';
import * as registry from '../../shared/multiplayer-tracks.ts';
import { WireClient, ORIGIN, settle } from './multiplayer-test-helpers.mjs';
import { verifyRacingCore } from './racing-core-evidence.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(project, '../taipei-gp-lobbybrake-before-f8ca4b1d251c');
const { RoomService: BeforeService } = await import(pathToFileURL(path.join(before, 'server/room-service.mjs')));
const identity = { version: protocol.PROTOCOL_VERSION, physics: protocol.PHYSICS_VERSION, catalogStamp: protocol.CATALOG_STAMP };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tested = ['server/room-service.mjs', 'shared/multiplayer-protocol.ts', 'tools/dev-tests/lobbybrake-host.mjs'];
const core = ['src/car.ts', 'src/track.ts', 'src/rivals.ts', 'src/pitlane.ts', 'server/physics.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all([...tested, ...core].map(async file => [file, hash(await readFile(path.join(project, file)))])));
const initialHashes = await hashes();
const report = { createdAt: new Date().toISOString(), localOnly: true, transport: 'real loopback WebSocket', externalRequests: [],
  playerStorageTouched: false, browserUsed: false, cases: [], limitations: [
    'Real local WebSocket transport and RoomService; deterministic private server clock/phase setup, not human driving or public-network timing.',
    'Legacy client runs its real parser/left handler in an isolated VM with test sessionStorage; actual player storage is never accessed.',
    'A maximum of 64 removed player IDs is retained per room; older revoked identities still fail INVALID_SESSION and cannot resume.',
  ] };
async function check(name, run) {
  try { report.cases.push({ name, status: 'PASS', details: await run() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
  console.log(JSON.stringify(report.cases.at(-1)));
}
async function legacyApp(now) {
  const service = new BeforeService({ now }), httpServer = createServer(), wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => service.accept(ws)));
  return { service, httpServer, close: async () => { service.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => httpServer.close(resolve)); } };
}
async function withServer(run, old = false) {
  let now = 1_000_000;
  const app = old ? await legacyApp(() => now) : createMultiplayerServer({ autoTick: false, now: () => now, allowedOrigins: [ORIGIN] });
  await new Promise((resolve, reject) => { app.httpServer.once('error', reject); app.httpServer.listen(0, '127.0.0.1', resolve); });
  const clients = [], url = `ws://127.0.0.1:${app.httpServer.address().port}/ws`;
  const open = async () => { const client = new WireClient(url); clients.push(client); await client.open(); return client; };
  const h = { app, service: app.service, open, clients, now: () => now, advance: ms => { now += ms; app.service.tick(now); } };
  try { return await run(h); }
  finally { await Promise.all(clients.map(client => client.close().catch(() => {}))); await app.close(); }
}
async function welcome(h, client, message) {
  const mark = client.mark(); client.send({ ...identity, ...message });
  const result = await client.until(value => value.type === 'welcome', mark), room = result.room;
  client.send({ type: 'track-loaded', trackId: room.trackId, trackRevision: room.trackRevision, trackStamp: room.trackStamp });
  await client.until(value => value.room?.players.some(player => player.id === result.playerId && player.loaded), mark);
  return result;
}
async function pair(h, third = false) {
  const a = await h.open(), first = await welcome(h, a, { type: 'create', name: '赤焰', laps: 3 });
  const b = await h.open(), second = await welcome(h, b, { type: 'join', name: '藍流', code: first.room.code });
  const room = h.service.rooms.get(first.room.code), result = { a, b, first, second, room };
  if (third) { result.c = await h.open(); result.third = await welcome(h, result.c, { type: 'join', name: '金曜', code: room.code }); }
  return result;
}
const management = (room, type, targetPlayerId, extra = {}) => ({ type, roomCode: room.code,
  expectedLobbyRevision: room.lobbyRevision, targetPlayerId, ...extra });
async function error(client, message, expected) {
  const mark = client.mark(); client.send(message); const response = await client.until(value => value.type === 'error', mark);
  assert.equal(response.code, expected); return response;
}
async function operation(client, room, type, targetPlayerId) {
  const mark = client.mark(), revision = room.lobbyRevision; client.send(management(room, type, targetPlayerId));
  return (await client.until(value => value.type === 'room' && value.room?.hostManagement?.lobbyRevision > revision, mark)).room;
}
async function waitFor(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < end, 'private server state did not settle'); await settle(); }
}
async function ready(p, client, id) {
  const mark = client.mark(); client.send({ type: 'ready', ready: true, trackRevision: p.room.trackRevision, trackStamp: p.room.trackStamp });
  await client.until(value => value.room?.players.some(player => player.id === id && player.ready), mark);
}
async function start(p, h) {
  await ready(p, p.a, p.first.playerId); await ready(p, p.b, p.second.playerId);
  const mark = p.a.mark(); p.a.send({ type: 'start', trackRevision: p.room.trackRevision });
  await p.a.until(value => value.room?.phase === 'countdown', mark);
}
async function legacyClient() {
  const storage = new Map(), sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const source = await readFile(path.join(before, 'src/multiplayer-client.ts'), 'utf8');
  const code = stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-protocol['"];?/, 'const {PROTOCOL_VERSION,PHYSICS_VERSION}=protocol;')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-tracks['"];?/, 'const {CATALOG_STAMP,DEFAULT_MULTIPLAYER_TRACK_ID,getMultiplayerTrack}=registry;')
    .replace('export class MultiplayerClient', 'class MultiplayerClient') + '\nglobalThis.Client=MultiplayerClient;';
  const context = vm.createContext({ protocol, registry, URL, Date, performance, location: { protocol: 'http:' }, sessionStorage, clearTimeout, clearInterval });
  vm.runInContext(code, context); return { client: new context.Client('ws://127.0.0.1:4320/ws'), storage };
}

await check('before has no capability or host commands; old standard v2 entry remains usable', () => withServer(async h => {
  const p = await pair(h), snapshot = h.service.snapshot(p.room);
  assert.equal(snapshot.hostManagement, undefined);
  await error(p.a, { type: 'kick-player', roomCode: p.room.code, expectedLobbyRevision: 1, targetPlayerId: p.second.playerId }, 'BAD_MESSAGE');
  await error(p.a, { type: 'transfer-host', roomCode: p.room.code, expectedLobbyRevision: 1, targetPlayerId: p.second.playerId }, 'BAD_MESSAGE');
  assert.equal(p.room.players.size, 2); assert.equal(p.room.hostId, p.first.playerId);
  const { client } = await legacyClient(); client.validateRoom(snapshot);
  return { capabilityAbsent: true, oldCommandsRejected: 2, oldEntryUnchanged: true };
}, true));

await check('new server advertises additive capability and snapshots still parse in the old client', () => withServer(async h => {
  const p = await pair(h), snapshot = h.service.snapshot(p.room), { client } = await legacyClient();
  assert.deepEqual(snapshot.hostManagement, { lobbyRevision: 1 }); client.validateRoom(snapshot);
  assert.equal(snapshot.version, 2); assert.equal(snapshot.physics, protocol.PHYSICS_VERSION);
  return { lobbyRevision: snapshot.hostManagement.lobbyRevision, legacyParserAccepted: true };
}));

await check('non-host players cannot remove or transfer; neither command mutates the lobby', () => withServer(async h => {
  const p = await pair(h), revision = p.room.lobbyRevision;
  for (const type of ['kick-player', 'transfer-host']) await error(p.b, management(p.room, type, p.first.playerId), 'HOST_ONLY');
  assert.equal(p.room.lobbyRevision, revision); assert.equal(p.room.players.size, 2); assert.equal(p.room.hostId, p.first.playerId);
}));

await check('self, missing, malformed and foreign targets are rejected without changing readiness or host', () => withServer(async h => {
  const p = await pair(h), revision = p.room.lobbyRevision;
  for (const type of ['kick-player', 'transfer-host']) for (const target of [p.first.playerId, '', 'missing-player', null, {}, 'x'.repeat(129)]) {
    await error(p.a, management(p.room, type, target), 'INVALID_TARGET');
  }
  assert.equal(p.room.lobbyRevision, revision); assert.equal(p.room.players.size, 2); assert.equal(p.room.hostId, p.first.playerId);
  return { rejectedCommands: 12 };
}));

await check('missing, stale, fractional, negative and cross-room generation metadata is rejected', () => withServer(async h => {
  const p = await pair(h), revision = p.room.lobbyRevision;
  const variants = [{ expectedLobbyRevision: undefined }, { expectedLobbyRevision: 0 }, { expectedLobbyRevision: -1 }, { expectedLobbyRevision: 1.5 },
    { expectedLobbyRevision: '1' }, { expectedLobbyRevision: Number.MAX_SAFE_INTEGER + 1 }, { roomCode: 'XXXXXX' }, { roomCode: undefined }];
  for (const type of ['kick-player', 'transfer-host']) for (const variant of variants) await error(p.a, management(p.room, type, p.second.playerId, variant), 'STALE_LOBBY');
  assert.equal(p.room.lobbyRevision, revision); assert.equal(p.room.players.size, 2);
  return { rejectedCommands: variants.length * 2 };
}));

await check('host transfer reaches all three sockets and retains loaded/ready state', () => withServer(async h => {
  const p = await pair(h, true); await ready(p, p.a, p.first.playerId); await ready(p, p.b, p.second.playerId);
  const beforeState = [...p.room.players.values()].map(player => [player.id, player.ready, player.loaded]), marks = [p.a, p.b, p.c].map(client => client.mark());
  const next = await operation(p.a, p.room, 'transfer-host', p.second.playerId);
  for (const [index, client] of [p.a, p.b, p.c].entries()) await client.until(value => value.room?.hostId === p.second.playerId, marks[index]);
  assert.equal(next.hostId, p.second.playerId); assert.equal(next.hostManagement.lobbyRevision, 2);
  assert.deepEqual([...p.room.players.values()].map(player => [player.id, player.ready, player.loaded]), beforeState);
  return { recipients: 3, newHost: p.room.hostId, readinessPreserved: true };
}));

await check('former host immediately loses control and the new host can start normally', () => withServer(async h => {
  const p = await pair(h); await operation(p.a, p.room, 'transfer-host', p.second.playerId);
  for (const type of ['kick-player', 'transfer-host']) await error(p.a, management(p.room, type, p.second.playerId), 'HOST_ONLY');
  await error(p.a, { type: 'start', trackRevision: p.room.trackRevision }, 'HOST_ONLY');
  await ready(p, p.a, p.first.playerId); await ready(p, p.b, p.second.playerId);
  const mark = p.b.mark(); p.b.send({ type: 'start', trackRevision: p.room.trackRevision });
  await p.b.until(value => value.room?.phase === 'countdown', mark); assert.equal(p.room.phase, 'countdown');
}));

await check('kick explicitly notifies, closes normally, revokes resume, and permits a fresh manual join', () => withServer(async h => {
  const p = await pair(h, true), removed = p.room.players.get(p.second.playerId), mark = p.b.mark();
  await operation(p.a, p.room, 'kick-player', p.second.playerId);
  const notification = await p.b.until(value => value.type === 'left', mark);
  assert.deepEqual(notification, { type: 'left', reason: 'kicked', roomCode: p.room.code, message: '房主已將你移出房間；可重新輸入房碼加入。' });
  assert.equal(await p.b.waitClosed(), 1000); assert.equal(removed.token, null); assert.equal(removed.expired, true); assert.equal(removed.client, null);
  assert.equal(p.room.players.has(p.second.playerId), false); assert.equal(p.room.players.size, 2);
  const retry = await h.open(); await error(retry, { type: 'resume', ...identity, code: p.room.code, playerId: p.second.playerId, token: p.second.resumeToken }, 'REMOVED_BY_HOST');
  const rejoined = await welcome(h, retry, { type: 'join', name: '藍流', code: p.room.code });
  assert.notEqual(rejoined.playerId, p.second.playerId); assert.notEqual(rejoined.resumeToken, p.second.resumeToken); assert.equal(p.room.players.size, 3);
  return { closeCode: 1000, revoked: true, manualJoinCreatedNewIdentity: true };
}));

await check('an offline player can be removed and receives an explicit removal error on resume', () => withServer(async h => {
  const p = await pair(h), target = p.room.players.get(p.second.playerId); await p.b.close(); await waitFor(() => !target.connected);
  await error(p.a, management(p.room, 'transfer-host', p.second.playerId), 'INVALID_TARGET');
  await operation(p.a, p.room, 'kick-player', p.second.playerId); assert.equal(p.room.players.has(p.second.playerId), false);
  const retry = await h.open(); const rejected = await error(retry, { type: 'resume', ...identity, code: p.room.code, playerId: p.second.playerId, token: p.second.resumeToken }, 'REMOVED_BY_HOST');
  assert.ok(rejected.message.includes('房主')); assert.ok(rejected.message.includes('重新輸入房碼'));
}));

await check('legacy client left handler clears its saved identity and stops automatic reconnect', () => withServer(async h => {
  const p = await pair(h), mark = p.b.mark(); await operation(p.a, p.room, 'kick-player', p.second.playerId);
  const notification = await p.b.until(value => value.type === 'left', mark), { client, storage } = await legacyClient();
  client._room = p.second.room; client._selfId = p.second.playerId; client.credentials = { token: p.second.resumeToken }; client.authenticated = true; client.wantsConnection = true;
  storage.set('taipei-gp-multiplayer-session-v2', JSON.stringify(client.credentials)); client.receive(JSON.stringify(notification));
  assert.equal(client.credentials, null); assert.equal(client.room, null); assert.equal(client.selfId, null); assert.equal(client.wantsConnection, false); assert.equal(storage.size, 0);
}));

await check('stale actions from another room cannot apply even when both rooms use lobby generation one', () => withServer(async h => {
  const p = await pair(h), oldRoomCode = p.room.code, mark = p.a.mark(); p.a.send({ type: 'leave' }); await p.a.until(value => value.type === 'left', mark);
  const next = await welcome(h, p.a, { type: 'create', name: '新房主', laps: 1 });
  const peer = await h.open(), joined = await welcome(h, peer, { type: 'join', code: next.room.code, name: '新朋友' });
  const room = h.service.rooms.get(next.room.code); assert.equal(room.lobbyRevision, 1);
  for (const type of ['kick-player', 'transfer-host']) await error(p.a, management(room, type, joined.playerId, { roomCode: oldRoomCode }), 'STALE_LOBBY');
  assert.equal(room.players.size, 2); assert.equal(room.hostId, next.playerId);
}));

await check('map changes retire old management confirmations even without a race', () => withServer(async h => {
  const p = await pair(h), stale = management(p.room, 'kick-player', p.second.playerId), mark = p.a.mark();
  p.a.send({ type: 'select-track', trackId: 'austria', expectedRevision: p.room.trackRevision });
  await p.a.until(value => value.room?.trackId === 'austria', mark); assert.ok(p.room.lobbyRevision > stale.expectedLobbyRevision);
  await error(p.a, stale, 'STALE_LOBBY'); assert.equal(p.room.players.size, 2);
}));

await check('management commands are rejected throughout countdown, racing and results', () => withServer(async h => {
  const p = await pair(h); await start(p, h); let rejected = 0;
  for (const phase of ['countdown', 'racing', 'results']) {
    if (phase === 'racing') h.advance(3000);
    if (phase === 'results') { for (const player of p.room.players.values()) h.service.markDnf(player, 'race-timeout'); h.service.maybeFinish(p.room, h.now()); }
    assert.equal(p.room.phase, phase);
    for (const type of ['kick-player', 'transfer-host']) { await error(p.a, management(p.room, type, p.second.playerId), 'INVALID_PHASE'); rejected++; }
    assert.equal(p.room.players.size, 2); assert.equal(p.room.hostId, p.first.playerId);
  }
  return { phases: 3, rejectedCommands: rejected };
}));

await check('a rematch retires the prior lobby generation even on the same map and room code', () => withServer(async h => {
  const p = await pair(h), stale = management(p.room, 'transfer-host', p.second.playerId); await start(p, h); h.advance(3000);
  for (const player of p.room.players.values()) h.service.markDnf(player, 'race-timeout'); h.service.maybeFinish(p.room, h.now());
  const mark = p.a.mark(); p.a.send({ type: 'reset' }); await p.a.until(value => value.room?.phase === 'lobby', mark);
  assert.ok(p.room.lobbyRevision > stale.expectedLobbyRevision); await error(p.a, stale, 'STALE_LOBBY');
  await operation(p.a, p.room, 'transfer-host', p.second.playerId); assert.equal(p.room.hostId, p.second.playerId);
}));

await check('automatic host election advances the lobby generation and resumed former hosts do not steal it', () => withServer(async h => {
  const p = await pair(h, true), oldRevision = p.room.lobbyRevision; await p.a.close(); await waitFor(() => p.room.hostId === p.second.playerId);
  assert.ok(p.room.lobbyRevision > oldRevision);
  await error(p.b, management(p.room, 'kick-player', p.third.playerId, { expectedLobbyRevision: oldRevision }), 'STALE_LOBBY');
  const resumed = await h.open(); await welcome(h, resumed, { type: 'resume', code: p.room.code, playerId: p.first.playerId, token: p.first.resumeToken });
  assert.equal(p.room.hostId, p.second.playerId);
  await error(resumed, management(p.room, 'kick-player', p.third.playerId), 'HOST_ONLY');
}));

await check('resuming when every socket was offline elects a connected host in a new generation', () => withServer(async h => {
  const p = await pair(h); await p.a.close(); await waitFor(() => !p.room.players.get(p.first.playerId).connected);
  await p.b.close(); await waitFor(() => !p.room.players.get(p.second.playerId).connected);
  const previousRevision = p.room.lobbyRevision; assert.equal(p.room.hostId, p.first.playerId);
  const resumed = await h.open(); await welcome(h, resumed, { type: 'resume', code: p.room.code, playerId: p.second.playerId, token: p.second.resumeToken });
  assert.equal(p.room.hostId, p.second.playerId); assert.ok(p.room.lobbyRevision > previousRevision);
}));

await check('removed identity memory is bounded and discarded tombstones still cannot resume', () => withServer(async h => {
  const a = await h.open(), first = await welcome(h, a, { type: 'create', name: '房主', laps: 1 }), room = h.service.rooms.get(first.room.code);
  let oldest;
  for (let i = 0; i < 65; i++) {
    const peer = await h.open(), joined = await welcome(h, peer, { type: 'join', code: room.code, name: '朋友' }); oldest ??= joined;
    await operation(a, room, 'kick-player', joined.playerId); await peer.waitClosed();
  }
  assert.equal(room.removedPlayerIds.size, 64); assert.equal(room.players.size, 1);
  const retry = await h.open(); await error(retry, { type: 'resume', ...identity, code: room.code, playerId: oldest.playerId, token: oldest.resumeToken }, 'INVALID_SESSION');
  return { removals: 65, retainedIds: 64, evictedIdentityStillRejected: true };
}));

await check('snapshots expose neither revoked IDs nor resume tokens, and core simulation remains protected', () => withServer(async h => {
  const p = await pair(h), id = p.second.playerId, token = p.second.resumeToken; await operation(p.a, p.room, 'kick-player', id);
  const snapshot = h.service.snapshot(p.room), wire = JSON.stringify(snapshot); assert.equal(wire.includes(id), false); assert.equal(wire.includes(token), false);
  assert.equal('removedPlayerIds' in snapshot, false); snapshot.hostManagement.lobbyRevision = 0; assert.ok(p.room.lobbyRevision > 0);
  const coreProtection = await verifyRacingCore(project, before);
  return { privateRevocationState: true, coreProtection };
}));

report.sourceHashes = await hashes(); report.sourceUnchangedDuringTests = JSON.stringify(initialHashes) === JSON.stringify(report.sourceHashes);
report.beforeHashes = Object.fromEntries(await Promise.all(['server/room-service.mjs', 'src/multiplayer-client.ts'].map(async file => [file, hash(await readFile(path.join(before, file)))])));
report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
report.status = report.summary.failed === 0 && report.sourceUnchangedDuringTests ? 'PASS' : 'FAIL';
await writeFile(path.join(project, 'tools/dev-tests/lobbybrake-host-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ...report.summary, sourceUnchangedDuringTests: report.sourceUnchangedDuringTests }));
if (report.status !== 'PASS') process.exitCode = 1;
