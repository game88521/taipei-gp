// 邀請純函式及注入 clipboard/share 的前後對照；不開瀏覽器、不連外、不傳訊息。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(here, '../..');
const before = path.resolve(project, '../taipei-gp-raceplus-before-38335611f205');
const source = await readFile(path.join(project, 'src/multiplayer-invite.ts'), 'utf8');
const baselineGame = await readFile(path.join(before, 'src/multiplayer-game.ts'), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64'));
const { normalizeMultiplayerRoomCode: normalize, parseMultiplayerInvite: parse, buildMultiplayerInviteUrl: build, copyMultiplayerInvite: copy, shareMultiplayerInvite: share } = api;
const hash = text => createHash('sha256').update(text).digest('hex');
const base = 'https://example.invalid/games/multiplayer.html', code = 'ABCD23', clean = `${base}?room=${code}`;
const noisy = `${base}?__vercel_toolbar_code=private-preview-token&token=private-login-token&room=${code}&debug=1#private-fragment`;
const report = { createdAt: new Date().toISOString(), localOnly: true, externalRequests: 0, browserUsed: false, clipboardOrShareUsed: false,
  sourceHashes: { 'src/multiplayer-invite.ts': hash(source), baselineGame: hash(baselineGame) }, cases: [],
  limitations: ['執行真邀請helper，clipboard/share均由測試替身注入，未接觸系統剪貼簿或實際分享。', '預填與手動確認、選取備援欄位的真DOM行為由root另行整合／瀏覽器驗證；本腳本不宣稱已測。'] };
async function check(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
}

await check('before只複製六碼；after產可開頁的邀請並清除所有舊query/hash', async () => {
  const start = baselineGame.indexOf("$('mp-copy').addEventListener"), end = baselineGame.indexOf("$('mp-camera').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  let listener, pending, written;
  const context = vm.createContext({ client: { room: { code } }, notice: '',
    $: id => { assert.equal(id, 'mp-copy'); return { addEventListener: (_type, handler) => { listener = handler; } }; },
    navigator: { clipboard: { async writeText(text) { written = text; } } },
    action(run) { pending = Promise.resolve().then(run); return pending; },
  });
  vm.runInContext(baselineGame.slice(start, end), context); listener(); await pending;
  assert.equal(written, code); assert.throws(() => new URL(written));
  const after = build(noisy, code); assert.equal(after, clean);
  assert.deepEqual([...new URL(after).searchParams], [['room', code]]); assert.equal(new URL(after).hash, '');
  return { before: written, after };
});

await check('邀請保持目前origin、子路徑及本機埠，不依賴固定公開域名', () => {
  assert.equal(build('http://127.0.0.1:4319/multiplayer.html?old=1#test', 'abcd23'), 'http://127.0.0.1:4319/multiplayer.html?room=ABCD23');
  const link = new URL(build(base, code)); assert.equal(link.origin, new URL(base).origin); assert.equal(link.pathname, '/games/multiplayer.html');
});

await check('有效邀請正規化小寫與外側空白，回傳預填資料而無入房動作', () => {
  assert.deepEqual(parse(`${base}?room=%20abcd23%20`), { status: 'valid', code });
  assert.equal(normalize(' abcd23 '), code);
  assert.deepEqual(parse(clean), { status: 'valid', code });
});

await check('無room參數及僅hash內room不觸發邀請；手動六碼入口可保留', () => {
  assert.deepEqual(parse(base), { status: 'absent', code: null });
  assert.deepEqual(parse(`${base}?debug=1#room=${code}`), { status: 'absent', code: null });
});

await check('重複、百分比編碼同名及大小寫衝突room一律拒絕，不任意挑第一個', () => {
  for (const query of [`room=${code}&room=${code}`, `room=${code}&%72oom=JKLM45`, `room=${code}&ROOM=JKLM45`]) {
    const result = parse(`${base}?${query}`); assert.equal(result.status, 'invalid'); assert.match(result.message, /重複/);
  }
  assert.equal(parse(`${base}?Room=${code}`).status, 'invalid');
});

await check('非法字元、長短、Unicode大寫展開與URL/HTML注入不能變成房碼', () => {
  for (const value of ['', 'ABC23', 'ABCD234', 'ABCD01', 'ABCDIO', 'ＡBCD23', 'ßABCD', 'ABC\n23', '<b>23</b>', 'ABC&23', '?room=ABCD23', 'https://evil.invalid']) {
    assert.equal(normalize(value), null, value);
    assert.equal(build(base, value), null, value);
    assert.equal(parse(`${base}?room=${encodeURIComponent(value)}`).status, 'invalid', value);
  }
  for (const value of [null, undefined, 123456, ['ABCD23'], { toString: () => code }]) assert.equal(normalize(value), null);
});

await check('超長網址、非http(s)、憑證URL及非多人頁面提供明確失敗', () => {
  for (const page of ['not a URL', 'javascript:alert(1)', 'file:///multiplayer.html', 'https://name:secret@example.invalid/multiplayer.html', 'https://example.invalid/index.html', `${base}?padding=${'x'.repeat(8192)}`]) {
    const parsed = parse(page); assert.equal(parsed.status, 'invalid'); assert.ok(parsed.message.length > 0); assert.equal(build(page, code), null);
  }
});

await check('clipboard成功只寫乾淨邀請，不洩漏工具token；不直接讀navigator', async () => {
  const written = []; const result = await copy(noisy, async text => { written.push(text); });
  assert.deepEqual(written, [clean]); assert.equal(result.status, 'copied'); assert.equal(result.url, clean);
  assert.match(result.message, /按「加入房間」/);
});

await check('clipboard不存在或被拒絕時，回傳可選取的同一安全連結與手動提示', async () => {
  for (const writeText of [undefined, async () => { throw new Error('permission denied'); }]) {
    const result = await copy(noisy, writeText); assert.equal(result.status, 'manual'); assert.equal(result.url, clean); assert.match(result.message, /選取/);
  }
});

await check('share成功使用乾淨URL，未帶入其他參數、片段或登入資訊', async () => {
  const calls = []; const result = await share(noisy, async data => { calls.push(data); });
  assert.equal(result.status, 'shared'); assert.equal(calls.length, 1); assert.equal(calls[0].url, clean);
  assert.equal(JSON.stringify(calls).includes('private-'), false); assert.match(calls[0].text, /確認暱稱/);
});

await check('分享取消與功能不可用/失敗分開回報，均保留手動連結而不自動轉送', async () => {
  let calls = 0;
  const cancelled = await share(clean, async () => { calls++; throw { name: 'AbortError' }; });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.url, clean); assert.equal(calls, 1);
  for (const shareFn of [undefined, async () => { throw new Error('share failed'); }]) {
    const result = await share(clean, shareFn); assert.equal(result.status, 'manual'); assert.equal(result.url, clean); assert.match(result.message, /複製/);
  }
});

await check('無效邀請不能呼叫clipboard或share，包括重複房碼', async () => {
  for (const value of [base, `${base}?room=${code}&room=JKLM45`, 'javascript:alert(1)']) {
    let calls = 0; const invoke = async () => { calls++; };
    assert.equal((await copy(value, invoke)).status, 'invalid'); assert.equal((await share(value, invoke)).status, 'invalid'); assert.equal(calls, 0);
  }
});

report.sourceUnchanged = source === await readFile(path.join(project, 'src/multiplayer-invite.ts'), 'utf8');
report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status !== 'PASS').length };
report.status = report.sourceUnchanged && report.summary.failed === 0 ? 'PASS' : 'FAIL';
await writeFile(path.join(here, 'raceplus-invite-result.json'), JSON.stringify(report, null, 2) + '\n');
for (const row of report.cases) console.log(`${row.status} ${row.name}${row.error ? '\n' + row.error : ''}`);
console.log(JSON.stringify({ status: report.status, ...report.summary, sourceUnchanged: report.sourceUnchanged }));
if (report.status !== 'PASS') process.exitCode = 1;
