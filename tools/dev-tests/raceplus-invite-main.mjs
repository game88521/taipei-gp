// 真multiplayer-game控制器，場景、網路、剪貼簿及分享由隔離fixture取代。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { environment, room, controllerFixtureHashes } from './multiplayer-map-ui-lifecycle.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = 'http://127.0.0.1:4319/multiplayer.html', code = 'ABC234', expected = `${base}?room=${code}`;
const href = `${base}?__vercel_toolbar_code=private-toolbar&token=private-login&room=JKLM45#private-fragment`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { createdAt: new Date().toISOString(), localOnly: true, browserUsed: false, externalRequests: 0,
  actualClipboardOrShareUsed: false, sourceHashes: controllerFixtureHashes, cases: [],
  limitations: ['真controller事件與UI狀態；DOM、場景、連線、clipboard/share為隔離替身，非瀏覽器、手機或外網驗收。'] };
async function check(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
}
async function enter(env, value = room('japan', 1, { code })) {
  env.client.update(value, 'connected', 1); env.scene.requested.complete(); await env.flush(); return value;
}

await check('開邀請頁僅預填房碼與提示，場景就緒後仍等使用者確認加入', async () => {
  const env = environment({ href: `${base}?room=abcd23` });
  assert.equal(env.ui('mp-code').value, 'ABCD23'); assert.match(env.ui('mp-invite-hint').textContent, /確認車手暱稱/);
  assert.deepEqual(env.client.commands, []); assert.equal(env.client.room, null);
  env.scene.requested.complete(); await env.flush(); assert.deepEqual(env.client.commands, []);
  env.ui('mp-name').value = '車手甲'; env.ui('mp-join').dispatch('click'); await env.flush();
  assert.deepEqual(env.client.commands, [{ type: 'join', code: 'ABCD23', name: '車手甲' }]);
  return { code: env.ui('mp-code').value, joins: env.client.commands.length };
});

await check('重複或無效邀請不預填不自動加入，保留手動輸入與確認入口', async () => {
  const env = environment({ href: `${base}?room=${code}&room=JKLM45` });
  assert.equal(env.ui('mp-code').value, ''); assert.match(env.ui('mp-invite-hint').textContent, /重複/);
  assert.deepEqual(env.client.commands, []);
  env.ui('mp-code').value = 'abc#234'; env.ui('mp-code').dispatch('input'); assert.equal(env.ui('mp-code').value, code);
  env.ui('mp-join').dispatch('click'); await env.flush();
  assert.equal(env.client.commands[0].type, 'join'); assert.equal(env.client.commands[0].code, code);
});

await check('大廳提供目前房碼的乾淨邀請，原六碼複製按鈕仍可用', async () => {
  const written = [], env = environment({ href, clipboard: { async writeText(text) { written.push(text); } } }); await enter(env);
  assert.equal(env.ui('mp-invite-url').value, expected);
  env.ui('mp-copy-link').dispatch('click'); await env.flush(); assert.equal(written[0], expected);
  assert.match(env.ui('mp-message').textContent, /邀請連結已複製/);
  env.ui('mp-copy').dispatch('click'); await env.flush(); assert.equal(written[1], code);
  assert.equal(written.join('').includes('private-'), false);
  return { invite: written[0], legacyCode: written[1] };
});

await check('複製被拒與分享不支援時留下可選取連結，點欄位可手動複製', async () => {
  const env = environment({ href, clipboard: { async writeText() { throw new Error('denied'); } } }); await enter(env);
  env.ui('mp-copy-link').dispatch('click'); await env.flush();
  assert.match(env.ui('mp-message').textContent, /無法自動複製/); assert.equal(env.ui('mp-invite-url').value, expected);
  env.ui('mp-invite-url').dispatch('click'); assert.equal(env.ui('mp-invite-url').selected, true);
  env.ui('mp-share-link').dispatch('click'); await env.flush();
  assert.match(env.ui('mp-message').textContent, /目前無法開啟分享/); assert.equal(env.ui('mp-invite-url').value, expected);
});

await check('分享取消有獨立提示，不自動轉成clipboard或入房命令', async () => {
  let copies = 0, shares = 0;
  const env = environment({ href, clipboard: { async writeText() { copies++; } }, share: async () => { shares++; throw { name: 'AbortError' }; } });
  await enter(env); env.ui('mp-share-link').dispatch('click'); await env.flush();
  assert.match(env.ui('mp-message').textContent, /已取消分享/); assert.equal(shares, 1); assert.equal(copies, 0); assert.deepEqual(env.client.commands, []);
});

await check('複製尚未完成時離房再入另一房，舊成功回覆不覆蓋新房間提示或連結', async () => {
  let resolveCopy; const written = [];
  const env = environment({ href, clipboard: { writeText(text) { written.push(text); return new Promise(resolve => { resolveCopy = resolve; }); } } });
  await enter(env); env.ui('mp-copy-link').dispatch('click'); await env.flush(); assert.equal(written[0], expected);
  env.ui('mp-leave').dispatch('click'); env.client.update(room('japan', 1, { code: 'DEF567' }), 'connected', 3);
  const currentMessage = env.ui('mp-message').textContent; assert.equal(env.ui('mp-invite-url').value, `${base}?room=DEF567`);
  resolveCopy(); await env.flush();
  assert.equal(env.ui('mp-message').textContent, currentMessage); assert.equal(env.ui('mp-invite-url').value, `${base}?room=DEF567`);
  assert.equal(env.ui('mp-message').textContent.includes('邀請連結已複製'), false);
});

await check('分享尚未完成時離房，晚到錯誤不留下舊房間邀請或錯誤訊息', async () => {
  let rejectShare; const env = environment({ href, share: () => new Promise((_resolve, reject) => { rejectShare = reject; }) });
  await enter(env); env.ui('mp-share-link').dispatch('click'); await env.flush();
  env.ui('mp-leave').dispatch('click'); const message = env.ui('mp-message').textContent;
  rejectShare(new Error('late failure')); await env.flush();
  assert.equal(env.client.room, null); assert.equal(env.ui('mp-invite-url').value, ''); assert.equal(env.ui('mp-message').textContent, message);
});

for (const [key, file] of Object.entries({ game: 'src/multiplayer-game.ts', ui: 'src/multiplayer-ui.ts', invite: 'src/multiplayer-invite.ts', pacing: 'src/frame-pacing.ts' })) {
  assert.equal(hash(await readFile(path.join(project, file))), report.sourceHashes[key], `Source changed during test: ${file}`);
}
report.sourceUnchangedDuringTests = true;
report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status !== 'PASS').length };
report.status = report.summary.failed === 0 ? 'PASS' : 'FAIL';
await writeFile(path.join(project, 'tools/dev-tests/raceplus-invite-main-result.json'), JSON.stringify(report, null, 2) + '\n');
for (const row of report.cases) console.log(`${row.status} ${row.name}${row.error ? '\n' + row.error : ''}`);
console.log(JSON.stringify({ status: report.status, ...report.summary, sourceUnchangedDuringTests: true }));
if (report.status !== 'PASS') process.exitCode = 1;
