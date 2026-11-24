// True client source, isolated sockets/storage and controllable clock. Importing does not run cases.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {pureUrl} from './pure-module-loader.mjs';
import * as protocol from '../../shared/multiplayer-protocol.ts';
import * as registry from '../../shared/multiplayer-tracks.ts';
import * as roomRules from '../../shared/multiplayer-room-rules.ts';
import * as horizon from '../../shared/multiplayer-horizon.ts';
import * as arena from '../../shared/multiplayer-arena.ts';
import * as nexusReplay from '../../shared/nexus-replay.ts';
import * as summit from '../../shared/summit-racing.ts';
import * as atlas from '../../shared/atlas-racing.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(project, '../taipei-gp-lobbybrake-before-f8ca4b1d251c');
const identity = { version: protocol.PROTOCOL_VERSION, physics: protocol.PHYSICS_VERSION, catalogStamp: registry.CATALOG_STAMP };
const SESSION_KEY = 'taipei-gp-multiplayer-session-v2';
const stamp = 1_700_000_000_000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Rex <game88521@gmail.com>. Discover the real named imports instead of maintaining
// a partial export list. Only import bindings change; client logic remains intact.
const namedImports=/\bimport\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2\s*;?/g;
const dependencyKey=(sourceRoot,spec)=>{if(!spec.startsWith('.'))throw Error('Client harness requires a relative named import: '+spec);return path.resolve(sourceRoot,'src',path.extname(spec)?spec:spec+'.ts');};
const dependencies=new Map();
for(const sourceRoot of[project,...(existsSync(path.join(before,'src/multiplayer-client.ts'))?[before]:[])]){
 const code=stripTypeScriptTypes(await readFile(path.join(sourceRoot,'src/multiplayer-client.ts'),'utf8'),{mode:'transform'});
 for(const match of code.matchAll(namedImports)){
  const key=dependencyKey(sourceRoot,match[3]);
  if(!dependencies.has(key))dependencies.set(key,await import(await pureUrl(sourceRoot,key)));
 }
}
function compile(source,sourceRoot){
 const code=stripTypeScriptTypes(source,{mode:'transform'}).replace(namedImports,(_all,names,_quote,spec)=>{
  const key=dependencyKey(sourceRoot,spec),module=dependencies.get(key);
  if(!module)throw Error('Client harness dependency was not preloaded: '+spec);
  const bindings=names.split(',').map(name=>name.trim()).filter(Boolean).map(name=>{
   const match=/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(name);
   if(!match||!Object.hasOwn(module,match[1]))throw Error('Client harness named export is unavailable: '+name+' from '+spec);
   return match[1]+(match[2]?':'+match[2]:'');
  });
  return 'const {'+bindings.join(',')+'}=__clientDependencies.get('+JSON.stringify(key)+');';
 });
 if(/\bimport\s/.test(code))throw Error('Client harness only supports named runtime imports.');
 return code.replace('export class MultiplayerClient','class MultiplayerClient')+'\nglobalThis.Client=MultiplayerClient;';
}
export class Storage {
  data = new Map(); writes = []; removals = [];
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); this.writes.push(key); }
  removeItem(key) { this.data.delete(key); this.removals.push(key); }
}
export function room(extra = {}) {
  const player = (id, name, rank) => ({ id, name, rank, color: '#ff3300', ready: false, loaded: true, connected: true,
    ackSeq: -1, completedLaps: 0, progress: 0, finishMs: null, dnf: false, lapTimesMs: [], bestLapMs: null,
    car: { x: rank * 3, z: 0, h: 0, v: 0, steer: 0, pos: { i: 0, s: 0, lat: 0 } } });
  return { ...identity, trackId: 'taipei', trackStamp: registry.getMultiplayerTrack('taipei').trackStamp, trackRevision: 1,
    code: 'ABC234', hostId: 'p1', hostManagement: { lobbyRevision: 1 }, phase: 'lobby', matchId: null, startAt: null,
    laps: 3, serverTime: stamp, trackLength: 3118.7, players: [player('p1', '赤焰', 1), player('p2', '藍流', 2)], ...extra };
}
export function environment(options = {}) {
  const source = options.source ?? readFileSync(path.join(options.sourceRoot ?? project, 'src/multiplayer-client.ts'), 'utf8');
  const storage = options.storage ?? new Storage();
  let now = 0, next = 1; const timers = new Map();
  class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3; static instances = [];
    readyState = 0; bufferedAmount = 0; sent = []; handlers = new Map(); autoPong = false; closeEvents = [];
    constructor(url) { this.url = url; FakeSocket.instances.push(this); }
    addEventListener(type, listener) { const listeners = this.handlers.get(type) ?? []; listeners.push(listener); this.handlers.set(type, listeners); }
    emit(type, event = {}) { for (const listener of this.handlers.get(type) ?? []) listener(event); }
    open() { this.readyState = 1; this.emit('open'); }
    receive(value) { this.emit('message', { data: JSON.stringify(value) }); }
    send(text) {
      if (this.readyState !== 1) throw new Error('fake socket is closed');
      const value = JSON.parse(text); this.sent.push(value);
      if (this.autoPong && value.type === 'ping') this.receive({ type: 'pong', sentAt: value.sentAt, serverTime: value.sentAt + 25 });
    }
    close(code = 1000, reason = '') { this.readyState = 3; this.closeEvents.push({ code, reason }); this.emit('close'); }
    drop() { this.close(); }
  }
  const schedule = (fn, ms, interval = 0) => { const id = next++; timers.set(id, { fn, at: now + ms, interval }); return id; };
  class FakeDate extends Date { static now() { return stamp + now; } }
  const context = vm.createContext({ protocol, registry, roomRules, horizon, arena, nexusReplay, summit, atlas,__clientDependencies:dependencies, URL, WebSocket: FakeSocket, Date: FakeDate, performance: { now: () => now },
    sessionStorage: storage, location: { protocol: 'http:' }, console,
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: id => timers.delete(id),
  });
  Object.defineProperty(context, 'localStorage', options.localStorage ? { value: options.localStorage } : { get() { throw new Error('must not touch player localStorage'); } });
  vm.runInContext(compile(source,options.sourceRoot??project), context, { filename: 'multiplayer-client.real.ts' });
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  const advance = async ms => {
    const end = now + ms; let turns = 0;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      assert.ok(++turns <= 10_000, 'virtual timer loop did not settle');
      const [id, timer] = due; now = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn(); await flush();
    }
    now = end; await flush();
  };
  const client = () => new context.Client('ws://127.0.0.1:4320/ws');
  const latest = () => FakeSocket.instances.at(-1);
  const welcome = (socket, extra = {}, playerId = 'p1') => {
    const request = socket.sent.findLast(message => ['create', 'join', 'resume'].includes(message.type)); assert.ok(request);
    socket.receive({ type: 'welcome', requestId: request.requestId, playerId, resumeToken: 'isolated-token-123456789', room: room(extra) });
  };
  const create = async (extra = {}, instance = client()) => {
    const pending = instance.create('赤焰', 3), socket = latest(); socket.autoPong = true; socket.open(); await flush(); welcome(socket, extra); await pending;
    return { client: instance, socket };
  };
  return { context, Client: context.Client, client, create, welcome, storage, timers, flush, advance, latest, sockets: FakeSocket.instances, now: () => now };
}

async function run() {
  const files = ['src/multiplayer-client.ts', 'shared/multiplayer-protocol.ts', 'tools/dev-tests/lobbybrake-client.mjs'];
  const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(project, file)))])));
  const initialHashes = await hashes();
  const report = { createdAt: new Date().toISOString(), localOnly: true, externalRequests: [], playerStorageTouched: false, browserUsed: false,
    transport: 'isolated sockets; true current/before client implementations', cases: [], limitations: [
      'Runs the real client parser, public methods and lifecycle with isolated socket/sessionStorage and virtual timers; not a browser or real-network test.',
      'Server authorization, real loopback WebSockets and revoked identity behavior are covered separately by lobbybrake-host.mjs.',
    ] };
  async function check(name, exercise) {
    try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
    catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
    console.log(JSON.stringify(report.cases.at(-1)));
  }
  const hostMessages = socket => socket.sent.filter(value => ['kick-player', 'transfer-host'].includes(value.type));
  const copiedRoom = client => JSON.parse(JSON.stringify(client.room));
  function update(socket, value, type = 'room') { socket.receive({ type, room: value }); }

  await check('before has no host methods; current client accepts an old server omitting the capability', async () => {
    const old = environment({ sourceRoot: before }); assert.equal(typeof old.client().kickPlayer, 'undefined'); assert.equal(typeof old.client().transferHost, 'undefined');
    const env = environment(), { client, socket } = await env.create({ hostManagement: undefined });
    assert.equal(client.status, 'connected'); assert.equal(client.room.hostManagement, undefined);
    assert.equal(client.kickPlayer('p2'), false); assert.equal(client.transferHost('p2'), false); assert.equal(hostMessages(socket).length, 0);
    assert.equal(client.ready(true), true); assert.equal(socket.sent.at(-1).type, 'ready'); client.leave();
    return { newMethodsOnBefore: false, oldServerEntryAndReadyAccepted: true };
  });

  await check('current client validates the capability while before intentionally ignores the additive metadata', async () => {
    const current = environment().client(), old = environment({ sourceRoot: before }).client();
    for (const revision of [1, 2, 999, Number.MAX_SAFE_INTEGER]) current.validateRoom(room({ hostManagement: { lobbyRevision: revision } }));
    const malformed = [undefined, null, true, 'yes', [], {}, { lobbyRevision: 0 }, { lobbyRevision: -1 }, { lobbyRevision: 1.5 },
      { lobbyRevision: '1' }, { lobbyRevision: null }, { lobbyRevision: NaN }, { lobbyRevision: Infinity }, { lobbyRevision: Number.MAX_SAFE_INTEGER + 1 }];
    for (const hostManagement of malformed) { const value = room({ hostManagement }); assert.throws(() => current.validateRoom(value), /房主管理/); old.validateRoom(value); }
    const legacy = room(); delete legacy.hostManagement; current.validateRoom(legacy);
    return { validRevisions: 4, rejectedMetadataShapes: malformed.length, oldOmissionAccepted: true };
  });

  await check('host methods send the exact current room/target/generation without creating another socket', async () => {
    const env = environment(), { client, socket } = await env.create({ hostManagement: { lobbyRevision: 7 } });
    assert.equal(client.kickPlayer('p2'), true); assert.equal(client.transferHost('p2'), true);
    assert.deepEqual(hostMessages(socket), [
      { type: 'kick-player', targetPlayerId: 'p2', roomCode: 'ABC234', expectedLobbyRevision: 7 },
      { type: 'transfer-host', targetPlayerId: 'p2', roomCode: 'ABC234', expectedLobbyRevision: 7 },
    ]); assert.equal(env.sockets.length, 1); client.leave();
  });

  await check('non-host and every active/result phase reject management locally', async () => {
    let rejected = 0;
    for (const extra of [{ hostId: 'p2' }, { phase: 'countdown', matchId: 'race', startAt: stamp + 3000 },
      { phase: 'racing', matchId: 'race', startAt: stamp }, { phase: 'results', matchId: 'race', startAt: stamp }]) {
      const env = environment(), { client, socket } = await env.create(extra);
      assert.equal(client.kickPlayer('p2'), false); assert.equal(client.transferHost('p2'), false);
      assert.equal(hostMessages(socket).length, 0); rejected += 2; client.leave();
    }
    return { rejectedCommands: rejected };
  });

  await check('self/missing targets are rejected; offline players can be removed but cannot receive host control', async () => {
    const env = environment(), { client, socket } = await env.create();
    for (const id of ['p1', '', 'gone-player']) { assert.equal(client.kickPlayer(id), false); assert.equal(client.transferHost(id), false); }
    const offline = copiedRoom(client); offline.serverTime++; offline.players[1].connected = false; update(socket, offline);
    assert.equal(client.transferHost('p2'), false); assert.equal(client.kickPlayer('p2'), true);
    assert.deepEqual(hostMessages(socket).map(value => value.type), ['kick-player']); client.leave();
  });

  await check('a disconnected transport cannot send management using its cached lobby', async () => {
    const env = environment(), { client, socket } = await env.create(); socket.drop();
    assert.equal(client.status, 'reconnecting'); assert.equal(client.kickPlayer('p2'), false); assert.equal(client.transferHost('p2'), false);
    assert.equal(hostMessages(socket).length, 0); client.disconnect(); assert.equal(env.timers.size, 0);
  });

  await check('lower lobby generations are ignored even with newer times; before would accept the stale host', async () => {
    for (const isOld of [false, true]) {
      const env = environment(isOld ? { sourceRoot: before } : {}), { client, socket } = await env.create({ hostManagement: { lobbyRevision: 5 } });
      const snapshots = []; client.onSnapshot(value => snapshots.push(value.hostManagement.lobbyRevision));
      const newest = copiedRoom(client); newest.serverTime += 100; newest.hostManagement.lobbyRevision = 6; update(socket, newest, 'snapshot');
      const stale = copiedRoom(client); stale.serverTime += 1000; stale.hostManagement.lobbyRevision = 5; stale.hostId = 'p2'; update(socket, stale, 'snapshot');
      assert.equal(client.room.hostId, isOld ? 'p2' : 'p1'); assert.equal(client.room.hostManagement.lobbyRevision, isOld ? 5 : 6);
      assert.deepEqual(snapshots, isOld ? [6, 5] : [6]); client.leave();
    }
    return { newerTimestampCannotReviveOldHost: true, beforeReproduced: true };
  });

  await check('same-generation readiness updates work and a higher generation immediately revokes former host buttons', async () => {
    const env = environment(), { client, socket } = await env.create();
    const ready = copiedRoom(client); ready.serverTime++; ready.players[1].ready = true; update(socket, ready);
    assert.equal(client.room.players[1].ready, true);
    const moved = copiedRoom(client); moved.serverTime++; moved.hostId = 'p2'; moved.hostManagement.lobbyRevision++; update(socket, moved);
    assert.equal(client.kickPlayer('p2'), false); assert.equal(client.transferHost('p2'), false); assert.equal(hostMessages(socket).length, 0); client.leave();
  });

  await check('map changes keep their existing snapshot reset and also bind management to the newest generation', async () => {
    const env = environment(), { client, socket } = await env.create(); update(socket, copiedRoom(client), 'snapshot'); assert.ok(client.snapshot);
    const next = copiedRoom(client); next.trackId = 'austria'; next.trackStamp = registry.getMultiplayerTrack('austria').trackStamp;
    next.trackRevision++; next.hostManagement.lobbyRevision++; next.serverTime++; update(socket, next);
    assert.equal(client.snapshot, null); assert.equal(client.room.trackId, 'austria'); assert.equal(client.kickPlayer('p2'), true);
    assert.equal(hostMessages(socket).at(-1).expectedLobbyRevision, 2); assert.equal(hostMessages(socket).at(-1).roomCode, next.code); client.leave();
  });

  await check('matching kicked notification clears identity/timers, does not send leave, and never automatically resumes', async () => {
    const env = environment(), { client, socket } = await env.create(); assert.ok(client.hasSavedSession);
    socket.receive({ type: 'left', reason: 'kicked', roomCode: 'ABC234', message: '<script>untrusted server text</script>' });
    assert.equal(client.room, null); assert.equal(client.snapshot, null); assert.equal(client.selfId, null); assert.equal(client.hasSavedSession, false);
    assert.equal(client.status, 'disconnected'); assert.equal(socket.readyState, 3); assert.equal(env.timers.size, 0);
    assert.equal(socket.sent.some(value => value.type === 'leave'), false); assert.equal(env.storage.getItem(SESSION_KEY), null);
    assert.match(client.error, /房主已將你移出/); assert.equal(client.error.includes('<script>'), false);
    await env.advance(30_000); assert.equal(env.sockets.length, 1); assert.equal(env.timers.size, 0); assert.equal(client.wantsConnection, false);
    return { automaticResumeRequests: 0, leaveRequests: 0, clearSession: true };
  });

  await check('foreign or incomplete kicked notifications cannot clear the current room/session', async () => {
    const env = environment(), { client, socket } = await env.create(), token = env.storage.getItem(SESSION_KEY);
    for (const roomCode of ['ZZZ999', undefined, null, 123]) {
      socket.receive({ type: 'left', reason: 'kicked', roomCode, message: 'old room' });
      assert.equal(client.room.code, 'ABC234'); assert.equal(client.status, 'connected'); assert.equal(env.storage.getItem(SESSION_KEY), token);
    }
    assert.equal(socket.sent.some(value => value.type === 'leave'), false); client.leave();
  });

  await check('metadata-free old left notifications retain the established compatibility cleanup', async () => {
    for (const options of [{}, { sourceRoot: before }]) {
      const env = environment(options), { client, socket } = await env.create({ hostManagement: undefined }); socket.receive({ type: 'left' });
      assert.equal(client.room, null); assert.equal(client.hasSavedSession, false); assert.equal(client.status, 'disconnected');
      assert.equal(env.timers.size, 0); await env.advance(20_000); assert.equal(env.sockets.length, 1);
    }
  });

  await check('offline REMOVED_BY_HOST resume rejection clears credentials and stops the ten-second reconnect loop', async () => {
    const env = environment(), { client, socket } = await env.create(); socket.drop(); await env.advance(100);
    const resumed = env.latest(); resumed.autoPong = true; resumed.open(); await env.flush();
    const request = resumed.sent.find(value => value.type === 'resume'); assert.ok(request);
    resumed.receive({ type: 'error', requestId: request.requestId, code: 'REMOVED_BY_HOST', message: '房主已將你移出房間；可重新輸入房碼加入。' });
    await env.flush(); await env.advance(30_000);
    assert.equal(client.hasSavedSession, false); assert.equal(client.room, null); assert.equal(client.status, 'disconnected');
    assert.match(client.error, /移出房間/); assert.equal(env.sockets.length, 2); assert.equal(env.timers.size, 0);
  });

  await check('after a kick only an explicit manual join creates a new connection; malformed capability fails closed', async () => {
    const env = environment(), { client, socket } = await env.create();
    socket.receive({ type: 'left', reason: 'kicked', roomCode: 'ABC234' }); await env.advance(2000); assert.equal(env.sockets.length, 1);
    const pending = client.join('ABC234', '赤焰'), next = env.latest(); next.autoPong = true; next.open(); await env.flush(); env.welcome(next); await pending;
    assert.equal(env.sockets.length, 2); assert.equal(next.sent.filter(value => value.type === 'join').length, 1); assert.equal(client.status, 'connected');
    const bad = copiedRoom(client); bad.hostManagement.lobbyRevision = 0; update(next, bad, 'snapshot');
    assert.equal(client.room, null); assert.equal(client.hasSavedSession, false); assert.match(client.error, /房主管理/);
    await env.advance(20_000); assert.equal(env.sockets.length, 2); assert.equal(env.timers.size, 0);
  });

  report.sourceHashes = await hashes(); report.sourceUnchangedDuringTests = JSON.stringify(initialHashes) === JSON.stringify(report.sourceHashes);
  report.beforeHashes = { 'src/multiplayer-client.ts': hash(await readFile(path.join(before, 'src/multiplayer-client.ts'))) };
  report.summary = { passed: report.cases.filter(value => value.status === 'PASS').length, failed: report.cases.filter(value => value.status === 'FAIL').length };
  report.status = report.summary.failed === 0 && report.sourceUnchangedDuringTests ? 'PASS' : 'FAIL';
  await writeFile(path.join(project, 'tools/dev-tests/lobbybrake-client-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, ...report.summary, sourceUnchangedDuringTests: report.sourceUnchangedDuringTests }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
