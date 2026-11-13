// 執行真正 TeamRadio before/after；只隔離顯示節點，不使用瀏覽器、玩家存檔或網路。
// node tools/dev-tests/followup-radio-regression.mjs [immutable-before-root]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? process.env.GP_FOLLOWUP_BASELINE_DIR ?? resolve(root, '../taipei-gp-followup-before-2dee076'));
if (before === root) throw Error('before 不可指向受測工作副本');
async function load(base) {
  const source = await readFile(resolve(base, 'src/radio.ts'), 'utf8');
  const code = stripTypeScriptTypes(source, { mode: 'transform' });
  return { ...(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)), hash: createHash('sha256').update(source).digest('hex') };
}
const old = await load(before), current = await load(root);
const report = { before, after: root, beforeHash: old.hash, sourceHash: current.hash, cases: [], evidence: {}, browserUsed: false, playerStorageTouched: false,
  limitations: ['真 radio.ts 原碼，顯示節點為記憶體替身；未操作 WebGL、完整賽事、真實音效或手機。', '待播佇列最多3則；已滿且全部同級重要時拒收新同級訊息，不搶掉已等候訊息，也不消耗被拒訊息冷卻。'] };
async function test(name, action) {
  try { await action(); report.cases.push({ name, status: 'PASS' }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack ?? error).slice(0, 4000) }); }
}
function harness(module = current) {
  const classes = new Set(), properties = new Map(), span = { textContent: '' };
  const element = { style: { setProperty: (key, value) => properties.set(key, value) },
    classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key) }, querySelector: () => span };
  const radio = new module.TeamRadio(element); let sounds = 0; radio.onSay = () => sounds++;
  return { radio, classes, properties, span, sounds: () => sounds };
}
function advance(radio, seconds) { for (let left = seconds; left > 1e-8; left -= 0.25) radio.update(Math.min(0.25, left)); }
const drain = (radio) => advance(radio, 30);

await test('before/after：一般滿列被拒的Infinity訊息，空位後可再觸發，不永久冷卻', () => {
  function scenario(module) {
    const h = harness(module);
    for (const key of ['a', 'b', 'c']) h.radio.say(key, key, 30);
    h.radio.say('rain', '開始下雨', Infinity); drain(h.radio);
    h.radio.say('rain', '開始下雨', Infinity); drain(h.radio);
    return h.radio.log;
  }
  const beforeLog = scenario(old), afterLog = scenario(current);
  assert.equal(beforeLog.includes('開始下雨'), false); assert.equal(afterLog.filter((x) => x === '開始下雨').length, 1);
  report.evidence.rejectedInfinity = { before: beforeLog, after: afterLog };
});

await test('before/after：緊急訊息可進滿列、優先播；取代最低優先最舊提醒並釋放未播冷卻', () => {
  function scenario(module) {
    const h = harness(module);
    h.radio.say('important', '重要輪胎提示', Infinity, 1);
    h.radio.say('old-normal', '舊一般提醒', Infinity);
    h.radio.say('new-normal', '新一般提醒', Infinity);
    h.radio.say('critical', '緊急換雨胎', Infinity, 2); drain(h.radio);
    return h;
  }
  const b = scenario(old), a = scenario(current);
  assert.equal(b.radio.log.includes('緊急換雨胎'), false);
  assert.deepEqual(a.radio.log, ['緊急換雨胎', '重要輪胎提示', '新一般提醒']);
  assert.equal(a.radio.say('old-normal', '條件仍成立的新提醒', Infinity), true); drain(a.radio);
  assert.equal(a.radio.log.at(-1), '條件仍成立的新提醒');
  report.evidence.criticalFullQueue = { before: b.radio.log, after: a.radio.log };
});

await test('同key待播／顯示中均去重，零冷卻高頻輪詢不插隊或重複響聲', () => {
  const h = harness(); h.radio.say('same', '第一則', 0, 2);
  for (let n = 0; n < 50; n++) assert.equal(h.radio.say('same', '重複', 0, 2), false);
  h.radio.update(0);
  for (let n = 0; n < 50; n++) assert.equal(h.radio.say('same', '重複', 0, 2), false);
  assert.equal(h.span.textContent, '第一則'); assert.equal(h.radio.count, 1); assert.equal(h.sounds(), 1);
  advance(h.radio, 8); assert.equal(h.radio.say('same', '下一次', 0, 2), true); drain(h.radio);
  assert.deepEqual(h.radio.log, ['第一則', '下一次']); assert.equal(h.sounds(), 2);
});

await test('有限cooldown按成功入列時間、Infinity播一次；rearm後可再次提示', () => {
  const h = harness(); assert.equal(h.radio.say('finite', '有限冷卻', 10), true); advance(h.radio, 7);
  assert.equal(h.radio.say('finite', '太早', 10), false); advance(h.radio, 4);
  assert.equal(h.radio.say('finite', '冷卻已過', 10), true); drain(h.radio);
  assert.equal(h.radio.say('once', '一次', Infinity, 1), true); drain(h.radio);
  assert.equal(h.radio.say('once', '不可重播', Infinity, 1), false);
  h.radio.rearm('once'); assert.equal(h.radio.say('once', '重新觸發', Infinity, 1), true); drain(h.radio);
  assert.deepEqual(h.radio.log, ['有限冷卻', '冷卻已過', '一次', '重新觸發']);
});

await test('rearm取消已失效待播及正在顯示的提醒，不重設其他類別冷卻或歷史', () => {
  const h = harness(); h.radio.say('tyre', '舊輪胎狀況', Infinity, 1); h.radio.say('other', '其他提醒', Infinity);
  h.radio.rearm('tyre'); drain(h.radio); assert.deepEqual(h.radio.log, ['其他提醒']);
  assert.equal(h.radio.say('other', '其他不可重播', Infinity), false);
  h.radio.say('tyre', '新輪胎後再次磨耗', Infinity, 1); h.radio.update(0); assert.equal(h.classes.has('show'), true);
  h.radio.rearm('tyre'); assert.equal(h.classes.has('show'), false); assert.equal(h.radio.count, 2);
  assert.equal(h.radio.say('tyre', '重設後的新提醒', Infinity, 1), true); drain(h.radio);
  assert.deepEqual(h.radio.log, ['其他提醒', '新輪胎後再次磨耗', '重設後的新提醒']);
});

await test('連續高優先高頻消息不餓死最舊提醒；同級有界FIFO不互相踢走', () => {
  const h = harness(); h.radio.say('normal', '最舊一般提醒', Infinity);
  h.radio.say('urgent-a', '緊急A', 0, 2); h.radio.say('urgent-b', '緊急B', 0, 2);
  let maxPending = 0;
  for (let n = 0; n < 120; n++) {
    h.radio.say('urgent-a', '緊急A', 0, 2); h.radio.say('urgent-b', '緊急B', 0, 2);
    maxPending = Math.max(maxPending, h.radio.queue.length); h.radio.update(0.25);
  }
  assert.deepEqual(h.radio.log.slice(0, 3), ['緊急A', '緊急B', '最舊一般提醒']); assert.ok(maxPending <= 3);
  const full = harness(); for (const key of ['a', 'b', 'c']) assert.equal(full.radio.say(key, key, Infinity, 2), true);
  for (let n = 0; n < 50; n++) assert.equal(full.radio.say('new', '新同級', Infinity, 2), false);
  assert.equal(full.radio.queue.length, 3); drain(full.radio); assert.deepEqual(full.radio.log, ['a', 'b', 'c']);
  assert.equal(full.radio.say('new', '新同級', Infinity, 2), true); drain(full.radio); assert.equal(full.radio.log.at(-1), '新同級');
  report.evidence.fairness = { firstThree: h.radio.log.slice(0, 3), maxPending };
});

await test('緊急訊息不打斷顯示中內容，同級重要訊息維持先到先播', () => {
  const h = harness(); h.radio.say('current', '目前內容', Infinity); h.radio.update(0);
  h.radio.say('first', '重要第一則', Infinity, 2); h.radio.say('second', '重要第二則', Infinity, 2);
  advance(h.radio, 1); assert.equal(h.span.textContent, '目前內容'); assert.equal(h.radio.log.length, 1);
  drain(h.radio); assert.deepEqual(h.radio.log, ['目前內容', '重要第一則', '重要第二則']);
});

await test('hide放棄未播並釋放冷卻，保留已播紀錄；reset完整清除與更新隊色', () => {
  const h = harness(); h.radio.say('shown', '已播', Infinity); h.radio.update(0); h.radio.say('waiting', '待播', Infinity, 1);
  h.radio.hide(); assert.equal(h.classes.has('show'), false); assert.equal(h.radio.queue.length, 0); assert.deepEqual(h.radio.log, ['已播']);
  assert.equal(h.radio.say('shown', '已播不可再播', Infinity), false); assert.equal(h.radio.say('waiting', '未播可重排', Infinity, 1), true);
  h.radio.reset('#ff5500'); assert.equal(h.properties.get('--team'), '#ff5500'); assert.equal(h.span.textContent, '');
  assert.equal(h.classes.has('show'), false); assert.equal(h.radio.count, 0); assert.deepEqual(h.radio.log, []); assert.equal(h.radio.queue.length, 0);
  drain(h.radio); assert.equal(h.radio.count, 0); assert.equal(h.radio.say('shown', '新場可再播', Infinity), true); drain(h.radio);
  assert.deepEqual(h.radio.log, ['新場可再播']); assert.equal(h.sounds(), 2);
});

await test('既有三參數say成功入列的FIFO／間隔／log與嗶聲行為相容', () => {
  function scenario(module) {
    const h = harness(module), at = [], beep = h.radio.onSay;
    h.radio.onSay = () => { beep(); at.push(h.radio.t); };
    for (const key of ['a', 'b', 'c']) h.radio.say(key, key, 30);
    drain(h.radio); return { log: h.radio.log, count: h.radio.count, sounds: h.sounds(), at };
  }
  assert.deepEqual(scenario(current), scenario(old));
});

const failed = report.cases.filter((x) => x.status === 'FAIL'); report.summary = { passed: report.cases.length - failed.length, failed: failed.length };
await writeFile(resolve(root, 'tools/dev-tests/shots-followup-radio-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2)); if (failed.length) process.exitCode = 1;
