import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MultiplayerHistory, MULTIPLAYER_HISTORY_KEY, parseHistory } from '../../src/multiplayer-history.ts';
import { opponentRadar, raceGaps, trackProjection } from '../../src/multiplayer-awareness.ts';
import { MultiplayerNetworkWindow } from '../../src/multiplayer-network.ts';
import { collisionVisualTarget } from './twelve-multiplayer-fixtures.mjs';
import { parseRoomRules } from '../../shared/multiplayer-room-rules.ts';
import { seriesStandings } from '../../shared/multiplayer-series.ts';
import { environment, room, Storage } from './lobbybrake-client.mjs';
const files = ['src/multiplayer-history.ts', 'src/multiplayer-awareness.ts', 'src/multiplayer-network.ts', 'src/multiplayer-collision-feedback.ts', 'src/multiplayer-client.ts', 'shared/multiplayer-room-rules.ts'];
const sha = b => createHash('sha256').update(b).digest('hex'), hashes = async () => Object.fromEntries(await Promise.all(files.map(async f => [f, sha(await readFile(new URL('../../' + f, import.meta.url)))])));
const report = { localOnly: true, browserUsed: false, externalRequests: 0, playerStorageTouched: false, cases: [], sourceHashes: await hashes(), limitations: ['真model/client與隔離socket、storage、clock；不是GPU、真人外網或手機量測。'] };
async function test(name, fn) { try { await fn(); report.cases.push({ name, status: 'PASS' }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); } console.log(JSON.stringify(report.cases.at(-1))); }
function finished(id = 'one') { const r = room({ phase: 'results', matchId: id, startAt: 1000, laps: 1, serverTime: 3000, roomRules: { collisions: true, finishGraceSeconds: 60 } });
  r.players.forEach((p, i) => Object.assign(p, { finishMs: 1000 + i * 100, completedLaps: 1, bestLapMs: 1000 + i * 100, lapTimesMs: [1000 + i * 100], dnfReason: null })); return r; }
await test('history逐match去重、reload保留，重複results不改日期或增加寫入', () => {
  const storage = new Storage(), h = new MultiplayerHistory(storage), r = finished();
  assert.equal(h.capture(r, 'p1', 100), true); assert.equal(h.capture(r, 'p1', 200), false); assert.equal(storage.writes.length, 1);
  const next = new MultiplayerHistory(storage); assert.equal(next.entries.length, 1); assert.equal(next.entries[0].at, 100); assert.equal(next.capture(r, 'p1', 300), false);
  h.capture(null, null); assert.equal(h.entries.length, 1);
});
await test('history只收結算及本機參賽者、不保存房碼token端點玩家ID或軌跡', () => {
  const storage = new Storage(), h = new MultiplayerHistory(storage), r = finished(); r.token = 'secret'; r.endpoint = 'wss://private.example';
  assert.equal(h.capture({ ...r, phase: 'racing' }, 'p1'), false); assert.equal(h.capture(r, 'spectator'), false); h.capture(r, 'p1', 100);
  const text = h.export(); for (const forbidden of ['ABC234', 'secret', 'private.example', 'playerId', '"p1"', '"p2"', 'car', 'progress']) assert.equal(text.includes(forbidden), false);
  assert.deepEqual(parseHistory(text), h.entries); assert.deepEqual(storage.writes, [MULTIPLAYER_HISTORY_KEY]);
});
await test('history最多20單場與10系列，series ID去重且保留每站及總積分', () => {
  const h = new MultiplayerHistory(new Storage());
  for (let i = 0; i < 25; i++) h.capture(finished(String(i)), 'p1', i);
  assert.equal(h.entries.length, 20); assert.equal(h.entries[0].id, 'race:24');
  for (let i = 0; i < 12; i++) { const r = finished(`series-race-${i}`), entrants = r.players.map(p => ({ playerId: p.id, name: p.name, color: p.color }));
    const rounds = ['taipei', 'japan', 'australia'].map((trackId, n) => ({ trackId, laps: 1, matchId: `round-${i}-${n}`, results: entrants.map((p, k) => ({ ...p, rank: k + 1, finishMs: 1000 + k * 100, dnf: false, points: k ? 6 : 10 })) }));
    r.series = { id: `series-${i}`, complete: true, entrants, rounds, standings: seriesStandings(entrants, rounds) }; h.capture(r, 'p1', 30 + i); }
  assert.equal(h.entries.filter(e => e.kind === 'race').length, 20); assert.equal(h.entries.filter(e => e.kind === 'series').length, 10);
  const e = h.entries.find(e => e.kind === 'series'); assert.equal(e.rounds.length, 3); assert.equal(e.players[0].points, 30); assert.equal(parseHistory(h.export()).length, 30);
});
await test('history亂碼/過大/錯型別不覆蓋原檔，清除後可重新保存', () => {
  for (const raw of ['亂碼', 'x'.repeat(200001), '{"v":1,"entries":{}}', '{"v":2,"entries":[]}']) {
    const storage = new Storage(); storage.data.set(MULTIPLAYER_HISTORY_KEY, raw); const h = new MultiplayerHistory(storage); assert.ok(h.error);
    h.capture(finished(), 'p1', 100); assert.equal(storage.getItem(MULTIPLAYER_HISTORY_KEY), raw); assert.ok(h.error); assert.equal(h.entries.length, 1);
    assert.equal(h.clear(), true); h.capture(finished('new'), 'p1', 200); assert.ok(parseHistory(storage.getItem(MULTIPLAYER_HISTORY_KEY)));
  }
});
await test('history惡意/重複ID/超界/非法地圖parser拒絕，白名單剝除額外隱私欄位', () => {
  const h = new MultiplayerHistory(new Storage()); h.capture(finished(), 'p1', 100); const valid = JSON.parse(h.export());
  for (const mutate of [v => v.entries.push(v.entries[0]), v => v.entries[0].players[0].rank = 99, v => v.entries[0].rounds[0].trackId = '../../private', v => v.entries[0].rules.collisions = 'false', v => v.entries[0].players[0].lapTimesMs = Array(99).fill(1)]) {
    const bad = structuredClone(valid); mutate(bad); assert.equal(parseHistory(JSON.stringify(bad)), null);
  }
  valid.entries[0].token = 'secret'; valid.entries[0].players[0].playerId = 'private'; const cleaned = JSON.stringify(parseHistory(JSON.stringify(valid))); assert.equal(cleaned.includes('secret'), false); assert.equal(cleaned.includes('private'), false);
});
await test('history quota失敗仍可看/匯出，reload不捏造保存；儲存恢復後新場可保存', () => {
  const storage = new Storage(), set = storage.setItem.bind(storage); storage.setItem = () => { throw Error('QuotaExceeded'); };
  const h = new MultiplayerHistory(storage); h.capture(finished(), 'p1', 100); assert.equal(h.entries.length, 1); assert.ok(h.error); assert.equal(parseHistory(h.export()).length, 1);
  assert.equal(new MultiplayerHistory(storage).entries.length, 0); storage.setItem = set; h.capture(finished('two'), 'p1', 200); assert.equal(h.error, ''); assert.equal(new MultiplayerHistory(storage).entries.length, 2);
  const unavailable = new MultiplayerHistory(null); assert.ok(unavailable.error); unavailable.capture(finished(), 'p1', 100); assert.equal(unavailable.entries.length, 1);
});
await test('history跨tab合併與同match去重，不覆蓋另一頁已完成場次', () => {
  const storage = new Storage(), a = new MultiplayerHistory(storage), b = new MultiplayerHistory(storage);
  a.capture(finished('one'), 'p1', 100); b.capture(finished('two'), 'p1', 200);
  assert.equal(new MultiplayerHistory(storage).entries.length, 2);
  a.capture(finished('two'), 'p1', 300); assert.equal(new MultiplayerHistory(storage).entries.length, 2);
  a.capture(finished('three'), 'p1', 400); assert.equal(new MultiplayerHistory(storage).entries.length, 3);
});
await test('history明確清除只刪專用鍵，同一results快照不復活舊紀錄', () => {
  const storage = new Storage(); storage.data.set('single-save', 'keep'); storage.data.set('quality', 'keep'); const h = new MultiplayerHistory(storage), r = finished(); h.capture(r, 'p1', 100);
  assert.equal(h.clear(), true); assert.equal(h.capture(r, 'p1', 200), false); assert.equal(storage.getItem(MULTIPLAYER_HISTORY_KEY), null); assert.equal(h.entries.length, 0);
  assert.equal(storage.getItem('single-save'), 'keep'); assert.equal(storage.getItem('quality'), 'keep'); assert.deepEqual(storage.removals, [MULTIPLAYER_HISTORY_KEY]);
});
await test('小地圖保留真中心線比例；近車方向隨航向且不同高度不假報旁車', () => {
  const track = { px: [0, 100, 100, 0], pz: [0, 0, 20, 20], N: 4, py: [0, 0, 10, 0], bank: [0, 0, 0, 0] }, project = trackProjection(track), a = project(0, 0), b = project(100, 20);
  assert.ok(Math.abs((b.x - a.x) / (b.y - a.y) - 5) < 1e-9);
  const r = room(); r.players[0].car = { x: 0, z: 0, h: 0, pos: { i: 0, lat: 0 } }; r.players[1].car = { x: 4, z: 8, h: 0, pos: { i: 1, lat: 0 } };
  let radar = opponentRadar(r, r.players[0], track); assert.equal(radar[0].right, 4); assert.equal(radar[0].forward, 8);
  r.players[0].car.h = Math.PI; radar = opponentRadar(r, r.players[0], track); assert.ok(radar[0].right < 0 && radar[0].forward < 0);
  r.players[1].car.pos.i = 2; assert.deepEqual(opponentRadar(r, r.players[0], track), []);
});
await test('前後公尺差採authority progress並明示套圈，無秒差換算', () => {
  const r = room(); r.players[0].progress = 100; r.players[1].progress = 120; assert.match(raceGaps(r, r.players[0]), /前：藍流 20 m/);
  r.players[1].progress = r.trackLength + 200; assert.match(raceGaps(r, r.players[0]), /套圈/); assert.equal(raceGaps(r, r.players[0]).includes('秒'), false);
  r.players[1].dnf = true; assert.match(raceGaps(r, r.players[0]), /前方無車/);
});
await test('自調有界/重置、重複或倒序快照不刷新過期；碰撞漸回時間軸單調', () => {
  const n = new MultiplayerNetworkWindow(); n.observe(0, 1000, 1100); n.observe(100, 1100, 1200); assert.ok(n.delayMs >= 80 && n.delayMs <= 220);
  n.observe(700, 1100, 1800); assert.ok(n.warning(700)); n.observe(710, 1000, 1900); assert.ok(n.warning(710));
  for (let i = 2; i < 1000; i++) n.observe(i * 200, i * 100 + 1000, i * 100 + 2000); assert.equal(n.delayMs, 220);
  for (let d of [80, 110, 220]) { let last = -Infinity; for (let t = 1000; t < 1600; t++) { const target = collisionVisualTarget(t, 1100, d); assert.ok(target >= last); last = target; } }
  n.reset(); assert.equal(n.delayMs, 110); assert.equal(n.warning(100000), ''); assert.equal(n.age(100000), null);
});
await test('新client舊server預設相容，roomRules能力與資料不成對或錯型別嚴格拒絕', () => {
  const c = environment().client(); c.validateRoom(room());
  for (const extra of [{ roomRules: { collisions: false, finishGraceSeconds: 60 } }, { capabilities: { lobbyOptions: true, championship: true, roomRules: true } },
    { capabilities: { lobbyOptions: true, championship: true, roomRules: false }, roomRules: { collisions: true, finishGraceSeconds: 60 } },
    { capabilities: { lobbyOptions: true, championship: true, roomRules: true }, roomRules: { collisions: true, finishGraceSeconds: '60' } }]) assert.throws(() => c.validateRoom(room(extra)));
  c.validateRoom(room({ capabilities: { lobbyOptions: true, championship: true, roomRules: true }, roomRules: { collisions: false, finishGraceSeconds: 120 } }));
});
await test('新client入房宣告能力，命令綁世代且不向舊server/非房主傳規則', async () => {
  const env = environment(), { client, socket } = await env.create({ capabilities: { lobbyOptions: true, championship: true, roomRules: true }, roomRules: { collisions: true, finishGraceSeconds: 60 } });
  assert.equal(socket.sent.find(m => m.type === 'create').clientCapabilities.roomRules, true);
  assert.equal(client.setRoomRules({ collisions: false, finishGraceSeconds: 30 }), true); const msg = JSON.parse(JSON.stringify(socket.sent.at(-1)));
  assert.deepEqual(msg, { type: 'set-room-rules', roomRules: { collisions: false, finishGraceSeconds: 30 }, roomCode: 'ABC234', expectedLobbyRevision: 1 });
  client.room.hostId = 'p2'; assert.equal(client.setRoomRules({ collisions: false, finishGraceSeconds: 30 }), false);
  client.room.hostId = 'p1'; delete client.room.capabilities; assert.equal(client.setRoomRules({ collisions: false, finishGraceSeconds: 30 }), false);
  assert.equal(parseRoomRules({ collisions: false, finishGraceSeconds: 30, token: 1 }), null);
});
assert.deepEqual(await hashes(), report.sourceHashes); report.sourceUnchangedDuringTests = true; report.scriptSha256 = sha(await readFile(new URL(import.meta.url)));
report.summary = { passed: report.cases.filter(c => c.status === 'PASS').length, failed: report.cases.filter(c => c.status === 'FAIL').length }; report.status = report.summary.failed ? 'FAIL' : 'PASS';
await writeFile(new URL('twelve-multiplayer-models-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
