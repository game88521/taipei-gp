// 真實本機 HTTP：實際 API handler -> 有狀態 Redis REST stand-in。
// 不讀環境機密、不連正式 Redis、不建立瀏覽器。node tools/dev-tests/leaderboard-regression.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLeaderboardHandler } from '../../api/leaderboard.js';
import { trackManifest as track, validateLapProof, boardKey } from '../../shared/lap-proof.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? resolve(root, '../taipei-gp-priority-before-20261111'));

const contract = JSON.parse(readFileSync('postman/leaderboard.openapi.json', 'utf8'));
assert.equal(contract.openapi, '3.1.0');
const storage = new Map(), trace = [], cases = [];
let mode = 'normal', delayMs = 0, slowClassic = 0;
const apiRequests = [];
const sorted = (key) => [...(storage.get(key) ?? new Map())].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
function command(c) {
  const [op, key, ...args] = c;
  if (op === 'ZRANGE') return sorted(key).slice(0, 20).flatMap(([id, time]) => [id, String(time)]);
  if (op === 'HMGET') return args.map((id) => storage.get(key)?.get(id) ?? null);
  if (op === 'ZRANK') { const i = sorted(key).findIndex(([id]) => id === args[0]); return i < 0 ? null : i; }
  if (op === 'ZSCORE') return storage.get(key)?.get(args[0]) ?? null;
  if (op === 'SET') { if (args.includes('NX') && storage.has(key)) return null; storage.set(key, args[0]); return 'OK'; }
  if (op === 'ZADD') { const scores = storage.get(key) ?? new Map(), [, value, member] = args; scores.set(member, Math.min(scores.get(member) ?? Infinity, Number(value))); storage.set(key, scores); return 1; }
  if (op === 'EVAL') {
    // Stand-in 明確支援端點送出的四 key 原子操作；不是 Lua／正式 Redis 相容性測試。
    assert.equal(c[2], 4); assert.match(key, /redis.call\('ZADD'/);
    const [, , , scoreKey, namesKey, receiptKey, rateKey, id, name, time, fingerprint] = c;
    const receipt = storage.get(receiptKey);
    if (receipt) return receipt.fingerprint === fingerprint ? [0, receipt.rank] : [2, 0];
    if (storage.has(rateKey)) return [3, 0];
    storage.set(rateKey, true);
    const scores = storage.get(scoreKey) ?? new Map();
    scores.set(id, Math.min(scores.get(id) ?? Infinity, Number(time))); storage.set(scoreKey, scores);
    const names = storage.get(namesKey) ?? new Map(); names.set(id, name); storage.set(namesKey, names);
    const rank = sorted(scoreKey).findIndex(([member]) => member === id) + 1;
    storage.set(receiptKey, { fingerprint, rank }); return [1, rank];
  }
  throw new Error(`unexpected command ${op}`);
}
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const upstream = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const cmd = JSON.parse(body); trace.push({ command: cmd[0], scenario: mode });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  if (res.destroyed) return;
  if (mode === 'error') { json(res, 200, { error: 'SECRET_TEST_TOKEN redis://private-internal' }); return; }
  if (mode === 'html') { res.writeHead(500); res.end('<html>SECRET_TEST_TOKEN</html>'); return; }
  json(res, 200, { result: command(cmd) });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const redisUrl = `http://127.0.0.1:${upstream.address().port}`;
const handler = createLeaderboardHandler({ url: redisUrl, token: 'local-fixture-only', timeoutMs: 150 });
let activeHandler = handler;
const api = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  req.query = Object.fromEntries(new URL(req.url, 'http://local').searchParams); req.body = body;
  apiRequests.push({ method: req.method, rules: req.query.rules });
  if (req.method === 'GET' && req.query.rules === 'classic' && slowClassic) await new Promise((r) => setTimeout(r, slowClassic));
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (value) { this.end(JSON.stringify(value)); return this; };
  await activeHandler(req, res);
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${api.address().port}`;
const board = { track: 'taipei', rules: 'classic', version: 1 };
function proof(time) {
  const count = Math.ceil(time / 0.05);
  const samples = Array.from({ length: count + 1 }, (_, i) => {
    const t = time * i / count, s = 2 + track.length * i / count;
    const f = (s / track.ds) % track.points.length, k = Math.floor(f), a = track.points[k], b = track.points[(k + 1) % track.points.length];
    return [+t.toFixed(3), +s.toFixed(3), +(a[0] + (b[0] - a[0]) * (f - k)).toFixed(3), +(a[1] + (b[1] - a[1]) * (f - k)).toFixed(3)];
  });
  return { v: 1, trackStamp: track.stamp, samples };
}
const payload = (playerId = randomUUID(), time = 70, rules = 'classic') => ({ playerId, name: '同名車手', time, board: { ...board, rules }, proof: proof(time) });
async function send(body, { idem = randomUUID(), ip = randomUUID(), raw } = {}) {
  const r = await fetch(`${origin}/api/leaderboard`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem, 'X-Forwarded-For': ip }, body: raw ?? JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function get(query = '') { const r = await fetch(`${origin}/api/leaderboard${query}`); return { status: r.status, body: await r.json() }; }
const pass = (name, data = {}) => cases.push({ name, pass: true, ...data });
try {
  // 修改前 API 對照：只把其上游定向至本機，其餘處理程式完全使用原檔。
  const original = readFileSync(resolve(baseline, 'api/leaderboard.js'), 'utf8')
    .replace(/^const URL_ =.*$/m, `const URL_ = ${JSON.stringify(redisUrl)};`)
    .replace(/^const TOKEN =.*$/m, "const TOKEN = 'local-fixture-only';");
  const old = new SourceTextModule(original); await old.link(() => {}); await old.evaluate();
  activeHandler = old.namespace.default;
  assert.equal((await send(payload())).status, 200); assert.equal((await send(payload(undefined, 68))).status, 200);
  assert.equal((await get()).body.top.length, 1);
  mode = 'error'; const oldFailure = await get(); assert.equal(oldFailure.status, 500); assert.ok(oldFailure.body.error.includes('SECRET_TEST_TOKEN'));
  mode = 'normal'; activeHandler = handler; storage.clear();
  pass('before reproduces same-name merge/internal error exposure; new handler separates/redacts');
  const a = payload(), b = payload(undefined, 68);
  assert.equal(validateLapProof(a.proof, a.time, a.board.rules).ok, true);
  assert.equal((await send(a)).status, 200); assert.equal((await send(b)).status, 200);
  let r = await get(); assert.equal(r.body.top.length, 2); assert.equal(new Set(r.body.top.map((e) => e.playerId)).size, 2);
  pass('same name, separate UUID scores', { top: r.body.top.length });
  assert.equal((await send(payload(a.playerId, 80))).status, 200); r = await get(`?playerId=${a.playerId}`); assert.equal(r.body.me.time, 70);
  assert.equal((await send(payload(a.playerId, 69, '2026'))).status, 200); r = await get('?rules=2026&version=1'); assert.equal(r.body.top.length, 1); assert.equal(r.body.top[0].time, 69);
  assert.equal((await get()).body.top.length, 2); assert.equal((await get('?version=999')).status, 400);
  pass('slower lap cannot overwrite, rules/version isolated');
  storage.set('taipei-gp:tt:v2', new Map([['舊車手', 54.425]])); r = await get('?board=legacy&name=舊車手');
  assert.equal(r.body.validation, 'legacy-unverified'); assert.equal(r.body.me.time, 54.425); assert.equal((await get()).body.top.length, 2);
  pass('legacy board preserved and explicitly unverified');
  const once = payload(), idem = randomUUID(), ip = randomUUID();
  assert.equal((await send(once, { idem, ip })).status, 200); assert.equal((await send(once, { idem, ip })).status, 200);
  assert.equal((await send({ ...once, name: '變更內容' }, { idem, ip })).status, 409);
  assert.equal((await send(payload(), { ip })).status, 429);
  pass('idempotency replay/conflict and IP rate limit');
  for (const mutation of [
    (p) => { p.samples[0][0] = 0.05; },
    (p) => { p.samples.at(-1)[0] -= 0.05; },
    (p) => { p.samples.splice(20, 6); },
    (p) => { p.samples[20][0] = p.samples[19][0]; },
    (p) => { p.samples[20][2] += 200; },
    (p) => { p.samples[20][1] += 100; },
    (p) => { p.samples.at(-1)[1] = 20; },
    (p) => { p.trackStamp = 'stale'; },
  ]) { const bad = payload(); mutation(bad.proof); const out = await send(bad); assert.equal(out.status, 400); assert.equal(out.body.error, 'proof'); }
  assert.equal((await send({ name: '舊版', time: 60 })).status, 400);
  assert.equal((await send({}, { raw: '{' })).status, 400);
  assert.equal((await send({}, { raw: JSON.stringify({ oversized: 'a'.repeat(768001) }) })).status, 413);
  pass('reject 8 malformed trajectories, legacy POST, invalid JSON and oversized body');
  const node = new URL(origin); mode = 'error'; r = await get(); assert.equal(r.status, 503); assert.equal(r.body.error, 'unavailable'); assert.ok(!JSON.stringify(r.body).includes('SECRET'));
  mode = 'html'; r = await get(); assert.equal(r.status, 503); assert.ok(!JSON.stringify(r.body).includes('SECRET'));
  mode = 'normal'; delayMs = 350; r = await get(); assert.equal(r.status, 504); assert.equal(r.body.error, 'upstream-timeout'); delayMs = 0;
  pass('upstream JSON/HTML failures redact internal data; hanging dependency returns 504');
  // 寫入可能已提交但讀回逾時：重送同 idempotency key 不新增玩家或重扣 rate。
  const uncertain = payload(), uncertainKey = randomUUID(), uncertainIp = randomUUID();
  mode = 'normal'; const countBefore = sorted(boardKey(board)).length;
  assert.equal((await send(uncertain, { idem: uncertainKey, ip: uncertainIp })).status, 200);
  assert.equal((await send(uncertain, { idem: uncertainKey, ip: uncertainIp })).status, 200);
  assert.equal(sorted(boardKey(board)).length, countBefore + 1); pass('same operation retry creates one score');

  // 共用真實 client HTTP deadline，非 mock fetch：GET／POST pending 均可被期限與取消終止。
  const source = stripTypeScriptTypes(readFileSync('src/network.ts', 'utf8'), { mode: 'transform' });
  const network = new SourceTextModule(source); await network.link(() => {}); await network.evaluate();
  mode = 'normal'; delayMs = 350;
  const timeout = network.namespace.requestJson(`${origin}/api/leaderboard`, { timeoutMs: 40, idleTimeoutMs: 35, retries: 0 });
  await assert.rejects(timeout.promise, (e) => e.code === 'timeout' || e.code === 'idle');
  const cancelled = network.namespace.requestJson(`${origin}/api/leaderboard`, { timeoutMs: 1000, retries: 0 }); cancelled.cancel();
  await assert.rejects(cancelled.promise, (e) => e.code === 'cancelled');
  delayMs = 0; pass('real network client timeout and explicit cancel');

  // 實際 leaderboard-ui 模組 + 簡化 DOM + 真實 HTTP；確認過期讀取、重複點擊與關閉取消。
  const dom = new Map(), messages = [];
  class Element extends EventTarget {
    constructor(tag = 'div') { super(); this.tagName = tag; this.style = {}; this.children = []; this.attributes = {}; this.value = ''; this.textContent = ''; const set = new Set(); this.classList = { add: (...s) => s.forEach((v) => set.add(v)), remove: (...s) => s.forEach((v) => set.delete(v)), contains: (s) => set.has(s) }; }
    set id(value) { this._id = value; dom.set(value, this); } get id() { return this._id; }
    appendChild(el) { this.children.push(el); return el; } append(...items) { this.children.push(...items); }
    before() {} after() {} closest() { return new Element('label'); }
    replaceChildren(...items) { this.children = items; } setAttribute(k, v) { this.attributes[k] = v; } removeAttribute(k) { delete this.attributes[k]; }
  }
  for (const id of ['lb-submit', 'lb-name', 'lb-close', 'btn-lb', 'lb-page', 'lb-status', 'lb-list']) { const e = new Element(); e.id = id; }
  dom.get('lb-page').classList.add('hidden');
  const savedGlobals = { document: globalThis.document, addEventListener: globalThis.addEventListener, fetch: globalThis.fetch };
  let clientBest = null, clientGhost = null;
  const clientId = randomUUID(), clientSave = { name: 'UI車手' };
  const saveExports = { save: clientSave, writeSave() {}, bestLapOf: () => clientBest, ghostOf: () => clientGhost, stampOf: () => track.stamp, playerIdentity: () => clientId, selectedRecordRules: () => 'classic', RECORD_VERSION: 1 };
  const saveModule = new SyntheticModule(Object.keys(saveExports), function () { for (const [k, v] of Object.entries(saveExports)) this.setExport(k, v); });
  await saveModule.link(() => {}); await saveModule.evaluate();
  const proofModule = new SourceTextModule(stripTypeScriptTypes(readFileSync('src/lap-proof.ts', 'utf8'), { mode: 'transform' })); await proofModule.link(() => {}); await proofModule.evaluate();
  const identityModule = new SourceTextModule(stripTypeScriptTypes(readFileSync('src/identity.ts', 'utf8'), { mode: 'transform' })); await identityModule.link(() => {}); await identityModule.evaluate();
  globalThis.document = { getElementById: (id) => dom.get(id), createElement: (tag) => new Element(tag) };
  globalThis.addEventListener = () => {};
  globalThis.fetch = (url, init) => savedGlobals.fetch(new URL(url, origin), init);
  const ui = new SourceTextModule(stripTypeScriptTypes(readFileSync('src/leaderboard-ui.ts', 'utf8'), { mode: 'transform' }));
  await ui.link((s) => s === './save' ? saveModule : s === './network' ? network : s === './identity' ? identityModule : proofModule); await ui.evaluate();
  const until = async (predicate) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 5)); } throw new Error('UI scenario did not settle'); };
  try {
    ui.namespace.initLeaderboard((text) => messages.push(text), String);
    slowClassic = 100; dom.get('btn-lb').dispatchEvent(new Event('click'));
    await until(() => apiRequests.some((r) => r.method === 'GET' && r.rules === 'classic'));
    dom.get('lb-board').value = '2026'; dom.get('lb-board').dispatchEvent(new Event('change'));
    await until(() => dom.get('lb-status').textContent.startsWith('2026・紀錄'));
    await new Promise((r) => setTimeout(r, 130)); assert.ok(dom.get('lb-status').textContent.startsWith('2026・紀錄'));
    pass('UI stale classic reply cannot overwrite selected 2026 board');
    slowClassic = 0;
    const points = proof(72).samples;
    clientBest = 72; clientGhost = { t: points.map((p) => p[0]), s: points.map((p) => p[1]), x: points.map((p) => p[2]), z: points.map((p) => p[3]), h: points.map(() => 0) };
    const countBeforePost = apiRequests.filter((r) => r.method === 'POST').length;
    const one = ui.namespace.submitLap(72), two = ui.namespace.submitLap(72);
    assert.equal(one, two); assert.equal(await one, null);
    assert.equal(apiRequests.filter((r) => r.method === 'POST').length, countBeforePost + 1);
    pass('UI duplicate submissions share one HTTP request');
    dom.get('lb-board').value = 'classic'; slowClassic = 150; dom.get('lb-board').dispatchEvent(new Event('change'));
    dom.get('lb-close').dispatchEvent(new Event('click')); assert.equal(dom.get('lb-page').classList.contains('hidden'), true);
    const statusAfterClose = dom.get('lb-status').textContent;
    await new Promise((r) => setTimeout(r, 180)); assert.equal(dom.get('lb-status').textContent, statusAfterClose);
    pass('closing UI cancels and ignores pending reads');
  } finally {
    slowClassic = 0;
    for (const [key, value] of Object.entries(savedGlobals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
  const result = { passed: cases.length, dependencyRequests: trace.length, cases, trace,
    limitations: '本機實際HTTP與有狀態REST stand-in。未執行真正Redis/Lua、正式環境、瀏覽器UI或權威防作弊；valid proof是合成合法路線，不是實際駕駛證明。' };
  writeFileSync('tools/dev-tests/shots-leaderboard-regression.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, dependencyRequests: trace.length, cases }, null, 2));
} finally {
  api.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([new Promise((r) => api.close(r)), new Promise((r) => upstream.close(r))]);
}
