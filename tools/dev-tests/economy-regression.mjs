// 收支純資料驗證：不啟動瀏覽器、不接觸玩家存檔或網路。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = stripTypeScriptTypes(await readFile(resolve(root, 'src/economy.ts'), 'utf8'), { mode: 'transform' });
const { recordTransaction, summarizeTransactions, parseTransactionLedger, LEDGER_LIMIT } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const cases = [];
function test(name, action) { action(); cases.push({ name, pass: true }); }
const row = { at: 1794330000000, amount: 100, balance: 200, reason: '計程車載客' };

test('before/after 差額記入、保留原物件，重複設定零差額不新增', () => {
  const save = { ledger: [row] }, before = structuredClone(save);
  const next = recordTransaction(save, 200, 350, '街頭對決', row.at + 1);
  assert.deepEqual(save, before); assert.notEqual(next, save.ledger);
  assert.deepEqual(next[1], { at: row.at + 1, amount: 150, balance: 350, reason: '街頭對決' });
  const withExpense = recordTransaction({ ledger: next }, 350, 250, '修車', row.at + 2);
  assert.deepEqual(withExpense[2], { at: row.at + 2, amount: -100, balance: 250, reason: '修車' });
  assert.equal(recordTransaction({ ledger: withExpense }, 250, 250, '修車', row.at + 3), withExpense);
});

test('只保留最近100筆，舊陣列不受截斷影響', () => {
  let ledger = [];
  for (let n = 0; n < 105; n++) ledger = recordTransaction({ ledger }, n, n + 1, '計程車載客', row.at + n);
  assert.equal(ledger.length, LEDGER_LIMIT); assert.equal(ledger[0].balance, 6); assert.equal(ledger.at(-1).balance, 105);
  assert.equal(parseTransactionLedger(ledger).length, 100);
});

test('不接受非法金額、時間、原因字串或隱式型別轉換', () => {
  const save = { ledger: [row] };
  for (const args of [
    [NaN, 250, '載客'], [200, Infinity, '載客'], ['200', 250, '載客'], [200, '250', '載客'], [-1, 250, '載客'], [200, 1e9 + 1, '載客'],
    [200, 250, ''], [200, 250, '  '], [200, 250, null], [200, 250, 'x'.repeat(81)], [200, 250, 'a\nb'], [200, 250, '<b>'],
    [200, 250, '載客', -1], [200, 250, '載客', 1.5], [200, 250, '載客', Infinity], [200, 250, '載客', '123'],
  ]) assert.equal(recordTransaction(save, ...args), save.ledger);
  assert.deepEqual(save.ledger, [row]);
});

test('按原因統計收入、支出、次數與淨額，特殊屬性名不污染分組', () => {
  const ledger = [row, { ...row, amount: 50, balance: 250 }, { ...row, amount: -25, balance: 225, reason: '修車' }, { ...row, amount: 10, balance: 235, reason: '__proto__' }];
  assert.deepEqual(summarizeTransactions(ledger), { income: 160, expense: 25, count: 4, net: 135, byReason: [
    { reason: '計程車載客', income: 150, expense: 0, count: 2, net: 150 },
    { reason: '修車', income: 0, expense: 25, count: 1, net: -25 },
    { reason: '__proto__', income: 10, expense: 0, count: 1, net: 10 },
  ] });
  assert.deepEqual(summarizeTransactions(undefined), { income: 0, expense: 0, count: 0, net: 0, byReason: [] });
});

test('匯入拒收不合法明細，統計略過非法資料且不產生NaN', () => {
  assert.deepEqual(parseTransactionLedger([]), []);
  assert.deepEqual(parseTransactionLedger([{ ...row, reason: '  計程車載客  ', extra: 'discard' }]), [row]);
  for (const patch of [{ at: NaN }, { at: -1 }, { amount: 0 }, { amount: '100' }, { amount: -1e9 - 1 }, { balance: Infinity }, { balance: 50 }, { reason: {} }, { reason: '\u0000' }]) {
    const invalid = { ...row, ...patch };
    assert.equal(parseTransactionLedger([invalid]), undefined);
    assert.equal(summarizeTransactions([invalid]).count, 0);
  }
  assert.equal(parseTransactionLedger({}), undefined);
  assert.equal(parseTransactionLedger(Array.from({ length: 101 }, () => row)), undefined);
});

const result = { passed: cases.length, cases, limitations: '純資料函式；存檔完整匯出/匯入與基準來源對照由 save-regression.mjs 驗證，UI與手機未驗證。' };
await writeFile(resolve(root, 'tools/dev-tests/shots-economy-regression.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
