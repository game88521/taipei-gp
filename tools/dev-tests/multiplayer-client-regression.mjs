// 真 client 模組：隔離 socket／時鐘生命週期；--live 另用真本機 WebSocket server。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(resolve(root, 'src/multiplayer-client.ts'), 'utf8');
const protocolSource = await readFile(resolve(root, 'shared/multiplayer-protocol.ts'), 'utf8');
const protocolCode = stripTypeScriptTypes(protocolSource, { mode: 'transform' }).replace("'./taipei-track.json'", JSON.stringify(pathToFileURL(resolve(root, 'shared/taipei-track.json')).href));
const protocol = await import(`data:text/javascript;base64,${Buffer.from(protocolCode).toString('base64')}`);
const code = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/multiplayer-protocol['"];?/, 'const { PROTOCOL_VERSION, PHYSICS_VERSION, TRACK_STAMP } = protocol;')
  .replace('export class MultiplayerClient', 'class MultiplayerClient') + '\nglobalThis.Client = MultiplayerClient;';
const hash = text => createHash('sha256').update(text).digest('hex');
const report = { createdAt: new Date().toISOString(), clientSourceSha256: hash(source), protocolSourceSha256: hash(protocolSource), playerStorageTouched: false, productionUsed: false, liveServerUsed: process.argv.includes('--live'), cases: [], limitations: ['純生命週期案例使用真client原始碼配合隔離socket與虛擬時鐘；不能證明實際網路延遲或瀏覽器渲染。', 'live案例為本機臨時埠的真server／WebSocket，未部署正式服務。'] };
const identity = { version: protocol.PROTOCOL_VERSION, physics: protocol.PHYSICS_VERSION, trackStamp: protocol.TRACK_STAMP };
const SESSION_KEY = 'taipei-gp-multiplayer-session-v1';

class Storage {
  data = new Map(); writes = [];
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { this.data.set(k, String(v)); this.writes.push(k); }
  removeItem(k) { this.data.delete(k); }
}
function room(extra = {}) {
  return { ...identity, code: 'ABC234', hostId: 'p1', phase: 'lobby', matchId: null, startAt: null, laps: 3, serverTime: 1700000000000, trackLength: 3118.7, players: [{ id: 'p1', name: '甲', color: '#ff3300', ready: false, connected: true, ackSeq: -1, completedLaps: 0, progress: 0, finishMs: null, dnf: false, rank: 1, car: { x: 1, z: 2, h: 0, v: 0, steer: 0, pos: { i: 0, s: 0, lat: 0 } } }], ...extra };
}
function environment(storage = new Storage()) {
  let now = 0, next = 1;
  const timers = new Map();
  class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3; static instances = [];
    readyState = 0; bufferedAmount = 0; sent = []; handlers = new Map(); autoPong = false;
    constructor(url) { this.url = url; FakeSocket.instances.push(this); }
    addEventListener(type, fn) { const list = this.handlers.get(type) ?? []; list.push(fn); this.handlers.set(type, list); }
    emit(type, event = {}) { for (const fn of this.handlers.get(type) ?? []) fn(event); }
    open() { this.readyState = 1; this.emit('open'); }
    receive(message) { this.emit('message', { data: JSON.stringify(message) }); }
    send(text) {
      if (this.readyState !== 1) throw Error('closed fake socket');
      const value = JSON.parse(text); this.sent.push(value);
      if (this.autoPong && value.type === 'ping') this.receive({ type: 'pong', sentAt: value.sentAt, serverTime: value.sentAt + 25 });
    }
    close() { this.readyState = 3; this.emit('close'); }
    drop() { this.close(); }
  }
  const schedule = (fn, ms, interval) => { const id = next++; timers.set(id, { fn, at: now + ms, interval }); return id; };
  class FakeDate extends Date { static now() { return 1700000000000 + now; } }
  const context = vm.createContext({ protocol, URL, WebSocket: FakeSocket, Date: FakeDate, performance: { now: () => now }, sessionStorage: storage, location: { protocol: 'http:' }, console,
    setTimeout: (fn, ms) => schedule(fn, ms, 0), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: id => timers.delete(id),
  });
  Object.defineProperty(context, 'localStorage', { get() { throw Error('不得碰玩家localStorage'); } });
  vm.runInContext(code, context, { filename: 'multiplayer-client.real.ts' });
  const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
  const advance = async ms => {
    const target = now + ms;
    let count = 0;
    for (;;) {
      const entry = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      if (++count > 2000) throw Error('虛擬時鐘回呼未收斂');
      const [id, timer] = entry; now = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn(); await flush();
    }
    now = target; await flush();
  };
  const client = () => new context.Client('ws://127.0.0.1:4320/ws');
  const latest = () => FakeSocket.instances.at(-1);
  const welcome = (socket, extra = {}) => {
    const request = socket.sent.findLast(message => ['create', 'join', 'resume'].includes(message.type));
    socket.receive({ type: 'welcome', requestId: request.requestId, playerId: 'p1', resumeToken: 'isolated-token-123456789', room: room(extra) });
  };
  const create = async (instance = client()) => {
    const pending = instance.create('甲', 3); const socket = latest(); socket.autoPong = true; socket.open(); await flush(); welcome(socket); await pending;
    return { client: instance, socket };
  };
  return { Client: context.Client, client, storage, sockets: FakeSocket.instances, latest, timers, flush, advance, welcome, create };
}
async function test(name, run) {
  try { const detail = await run(); report.cases.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).slice(0, 4500) }); }
}

await test('constructor不連線、不讀寫單人存檔；名稱／房間碼錯誤也不建立socket', async () => {
  const env = environment(), client = env.client();
  assert.equal(client.status, 'idle'); assert.equal(env.sockets.length, 0); assert.equal(env.storage.writes.length, 0);
  await assert.rejects(client.create(''), /車手名稱/); await assert.rejects(client.create('甲'.repeat(17)), /16/);
  await assert.rejects(client.join('ABCIO0', '甲'), /6 碼/); assert.equal(env.sockets.length, 0);
  assert.throws(() => new env.Client('http://example.test'), /ws/);
});
await test('真協定新玩家ackSeq=-1可完成建房；sessionStorage只寫專用續接憑證', async () => {
  const env = environment(), { client, socket } = await env.create();
  const sent = socket.sent.find(message => message.type === 'create');
  assert.deepEqual({ version: sent.version, physics: sent.physics, trackStamp: sent.trackStamp }, identity);
  assert.equal(client.room.players[0].ackSeq, -1); assert.equal(client.status, 'connected'); assert.equal(client.selfId, 'p1');
  assert.deepEqual(env.storage.writes, [SESSION_KEY]); assert.equal(client.hasSavedSession, true);
  assert.equal(JSON.parse(env.storage.getItem(SESSION_KEY)).token, 'isolated-token-123456789'); client.leave();
});
await test('requestId不相符不完成加入；伺服器拒絕後可重試，輸入房碼正規化', async () => {
  const env = environment(), client = env.client();
  const pending = client.join(' abc234 ', '甲').then(() => 'ok', error => error.message);
  const socket = env.latest(); socket.autoPong = true; socket.open(); await env.flush();
  const request = socket.sent.find(message => message.type === 'join'); assert.equal(request.code, 'ABC234');
  socket.receive({ type: 'error', requestId: 'old', code: 'ROOM_NOT_FOUND', message: '舊錯誤' });
  assert.equal(client.error, null);
  socket.receive({ type: 'error', requestId: request.requestId, code: 'ROOM_NOT_FOUND', message: '找不到房間' });
  assert.equal(await pending, '找不到房間');
  const next = client.join('ABC234', '甲'); await env.flush(); env.welcome(socket); await next; assert.equal(client.room.code, 'ABC234'); client.leave();
});
await test('輸入只傳matchId／序號／steer／brake；限頻、急煞及ack後續序號正確', async () => {
  const env = environment(), { client, socket } = await env.create();
  assert.equal(client.sendInput(1, false), false);
  const race = room({ phase: 'racing', matchId: 'race-1', startAt: 1700000000000, serverTime: 1700000000001 });
  race.players[0].ackSeq = 42; socket.receive({ type: 'snapshot', room: race });
  assert.equal(client.sendInput(9, false), true); assert.equal(client.sendInput(0, false), false);
  assert.equal(client.sendInput(0, true), true); assert.equal(client.sendInput(NaN, true), false);
  const inputs = socket.sent.filter(message => message.type === 'input');
  assert.deepEqual(inputs.map(message => message.seq), [43, 44]); assert.equal(inputs[0].steer, 1);
  assert.deepEqual(Object.keys(inputs[0]).sort(), ['brake', 'matchId', 'seq', 'steer', 'type']); client.leave();
});
await test('舊時間快照與已結束match不能覆蓋新一場', async () => {
  const env = environment(), { client, socket } = await env.create();
  const seen = []; client.onSnapshot(value => seen.push(value.serverTime));
  socket.receive({ type: 'snapshot', room: room({ phase: 'racing', matchId: 'old', startAt: 1700000000000, serverTime: 1700000000100 }) });
  socket.receive({ type: 'snapshot', room: room({ serverTime: 1700000000050 }) });
  assert.equal(client.room.matchId, 'old');
  socket.receive({ type: 'room', room: room({ serverTime: 1700000000200 }) });
  socket.receive({ type: 'snapshot', room: room({ phase: 'racing', matchId: 'new', startAt: 1700000000000, serverTime: 1700000000300 }) });
  socket.receive({ type: 'snapshot', room: room({ phase: 'racing', matchId: 'old', startAt: 1700000000000, serverTime: 1700000000400 }) });
  assert.equal(client.room.matchId, 'new'); assert.deepEqual(seen, [1700000000100, 1700000000300]); client.leave();
});
await test('短斷線自動resume；舊socket訊息無效，伺服器ack後可繼續輸入', async () => {
  const env = environment(), { client, socket } = await env.create();
  socket.drop(); assert.equal(client.status, 'reconnecting'); await env.advance(100);
  const next = env.latest(); assert.notEqual(next, socket); next.autoPong = true; next.open(); await env.flush();
  const resume = next.sent.find(message => message.type === 'resume'); assert.equal(resume.playerId, 'p1'); assert.equal(resume.token, 'isolated-token-123456789');
  const race = room({ phase: 'racing', matchId: 'r1', startAt: 1700000000000, serverTime: 1700000000100 }); race.players[0].ackSeq = 99;
  env.welcome(next, race); await env.flush(); assert.equal(client.status, 'connected');
  socket.receive({ type: 'room', room: room({ code: 'ZZZ999', serverTime: 1700000000900 }) });
  assert.equal(client.room.code, 'ABC234'); assert.equal(client.sendInput(0, false), true);
  assert.equal(next.sent.find(message => message.type === 'input').seq, 100); client.leave();
});
await test('resume被伺服器拒絕會清憑證並停止重試', async () => {
  const env = environment(), { client, socket } = await env.create(); socket.drop(); await env.advance(100);
  const next = env.latest(); next.open(); await env.flush(); const request = next.sent.find(message => message.type === 'resume');
  next.receive({ type: 'error', requestId: request.requestId, code: 'SESSION_EXPIRED', message: '續接期限已過' }); await env.flush();
  await env.advance(11000); assert.equal(client.status, 'disconnected'); assert.equal(client.room, null); assert.equal(client.hasSavedSession, false); assert.equal(env.sockets.length, 2); assert.equal(env.timers.size, 0);
});
await test('connect逾時會結束Promise、關socket並清timer', async () => {
  const env = environment(), client = env.client(), pending = client.create('甲').then(() => 'ok', error => error.message);
  await env.advance(7001); assert.match(await pending, /逾時/); assert.equal(client.status, 'disconnected'); assert.equal(env.latest().readyState, 3); assert.equal(env.timers.size, 0);
});
await test('開socket但不回welcome的entry逾時不會永久pending', async () => {
  const env = environment(), client = env.client(), pending = client.create('甲').then(() => 'ok', error => error.message);
  const socket = env.latest(); socket.autoPong = true; socket.open(); await env.flush();
  await env.advance(7001); assert.match(await pending, /房間回應逾時/); assert.equal(client.room, null); assert.equal(env.timers.size, 0);
});
await test('10秒重連截止會結束未完成連線、清除房間及續接token', async () => {
  const env = environment(), { client, socket } = await env.create(); socket.drop(); await env.advance(11000);
  assert.equal(client.status, 'disconnected'); assert.equal(client.room, null); assert.equal(client.hasSavedSession, false); assert.equal(env.timers.size, 0);
});
await test('離房中止待重連timer；已離開的socket回呼不能恢復身分', async () => {
  const env = environment(), { client, socket } = await env.create(); socket.drop(); client.leave(); await env.advance(11000);
  assert.equal(env.sockets.length, 1); assert.equal(env.timers.size, 0); assert.equal(client.hasSavedSession, false);
  socket.receive({ type: 'room', room: room() }); socket.emit('open'); assert.equal(client.room, null); assert.equal(client.selfId, null);
});
await test('頁面reload保留session憑證但不自動開socket，顯式restore後續接', async () => {
  const storage = new Storage(), first = environment(storage), { client } = await first.create(); client.disconnect();
  const next = environment(storage), restored = next.client(); assert.equal(restored.hasSavedSession, true); assert.equal(next.sockets.length, 0);
  const pending = restored.restore(), socket = next.latest(); socket.open(); await next.flush(); next.welcome(socket); assert.equal(await pending, true); assert.equal(restored.selfId, 'p1'); restored.leave();
});
await test('版本或車手資料不合法會安全斷線，不沿用舊房間或自動重連', async () => {
  const env = environment(), { client, socket } = await env.create(); socket.receive({ type: 'snapshot', room: room({ physics: 'old' }) });
  await env.advance(11000); assert.match(client.error, /版本或賽道不一致/); assert.equal(client.room, null); assert.equal(client.hasSavedSession, false); assert.equal(env.sockets.length, 1);
});
await test('同時加入請求會明確拒絕；disconnect會取消尚未完成的建房', async () => {
  const env = environment(), client = env.client(), first = client.create('甲').then(() => 'ok', error => error.message);
  await assert.rejects(client.join('ABC234', '甲'), /正在處理/); client.disconnect(); assert.match(await first, /中止/); assert.equal(env.timers.size, 0);
});
await test('ping採往返中點校時；解除訂閱後不再收到狀態與快照', async () => {
  const env = environment(), { client, socket } = await env.create(); assert.equal(client.rttMs, 0); assert.equal(client.serverNow(), 1700000000025);
  let states = 0, snaps = 0; const off = client.subscribe(() => states++), offSnapshot = client.onSnapshot(() => snaps++);
  assert.equal(states, 1); off(); offSnapshot();
  socket.receive({ type: 'snapshot', room: room({ serverTime: 1700000000100 }) }); await env.advance(1500);
  assert.equal(states, 1); assert.equal(snaps, 0); client.leave();
});

if (report.liveServerUsed) await test('真server／真WebSocket：雙人建房、加入、準備起跑、權威移動與斷線續接', async () => {
  const { createMultiplayerServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')).href);
  const require = createRequire(resolve(root, 'server/package.json'));
  const NativeSocket = require('ws');
  class BrowserSocket extends NativeSocket { constructor(url) { super(url, { origin: 'http://127.0.0.1:4317' }); } }
  const server = createMultiplayerServer();
  await new Promise((resolveListen, reject) => { server.httpServer.once('error', reject); server.httpServer.listen(0, '127.0.0.1', resolveListen); });
  const endpoint = `ws://127.0.0.1:${server.httpServer.address().port}/ws`;
  const clients = [];
  const make = () => {
    const context = vm.createContext({ protocol, URL, WebSocket: BrowserSocket, Date, performance, sessionStorage: new Storage(), location: { protocol: 'http:' }, console, setTimeout, clearTimeout, setInterval, clearInterval });
    Object.defineProperty(context, 'localStorage', { get() { throw Error('不得碰玩家localStorage'); } });
    vm.runInContext(code, context); const value = new context.Client(endpoint); clients.push(value); return value;
  };
  const until = async (condition, timeout = 7000) => { const deadline = performance.now() + timeout; while (!condition()) { if (performance.now() > deadline) throw Error('真server條件逾時'); await new Promise(resolveWait => setTimeout(resolveWait, 25)); } };
  try {
    const a = make(), b = make(); await a.create('甲'.repeat(16), 1); assert.equal(a.room.players[0].ackSeq, -1);
    await b.join(a.room.code, '乙'); await until(() => a.room.players.length === 2 && b.room.players.length === 2);
    a.ready(true); b.ready(true); await until(() => a.room.players.every(player => player.ready)); a.start();
    await until(() => a.room.phase === 'racing' && b.room.phase === 'racing');
    const began = a.room.players.find(player => player.id === a.selfId).car.x;
    const inputTimer = setInterval(() => { a.sendInput(0, false); b.sendInput(0, true); }, 35);
    try { await until(() => Math.abs(a.room.players.find(player => player.id === a.selfId).car.x - began) > 1); }
    finally { clearInterval(inputTimer); }
    const playerId = a.selfId, matchId = a.room.matchId; a.socket.terminate();
    await until(() => a.status === 'reconnecting'); await until(() => a.status === 'connected' && a.room.players.find(player => player.id === playerId).connected);
    assert.equal(a.selfId, playerId); assert.equal(a.room.matchId, matchId); assert.equal(a.error, null);
    return { players: a.room.players.length, startAt: a.room.startAt, initialAckSeq: -1, samePlayerAfterResume: a.selfId === playerId, sameMatchAfterResume: a.room.matchId === matchId };
  } finally { for (const client of clients) client.leave(); await server.close(); }
});

assert.equal(hash(await readFile(resolve(root, 'src/multiplayer-client.ts'), 'utf8')), report.clientSourceSha256, '測試期間client來源改變，結果不可沿用');
report.summary = { passed: report.cases.filter(item => item.status === 'PASS').length, failed: report.cases.filter(item => item.status === 'FAIL').length };
const filename = report.liveServerUsed ? 'shots-multiplayer-client-live-regression.json' : 'shots-multiplayer-client-regression.json';
await writeFile(resolve(root, 'tools/dev-tests', filename), JSON.stringify(report, null, 2) + '\n');
for (const item of report.cases) console.log(`${item.status} ${item.name}${item.error ? '\n' + item.error : ''}`);
console.log(JSON.stringify(report.summary));
if (report.summary.failed) process.exitCode = 1;
