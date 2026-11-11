/** 最近的收支紀錄；金額以遊戲錢包使用的 NT$ 計，支出為負數。 */
export interface Transaction { at: number; amount: number; balance: number; reason: string }
export interface TransactionTotals { income: number; expense: number; count: number; net: number }
export interface TransactionReasonSummary extends TransactionTotals { reason: string }
export interface TransactionSummary extends TransactionTotals { byReason: TransactionReasonSummary[] }

export const LEDGER_LIMIT = 100;
const MAX_MONEY = 1e9;
const validMoney = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MONEY;
const validAt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
const validReason = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f<>]/u.test(value);

function parseTransaction(value: unknown): Transaction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!validAt(row.at) || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount === 0 || Math.abs(row.amount) > MAX_MONEY || !validMoney(row.balance) || !validMoney(row.balance - row.amount) || !validReason(row.reason)) return undefined;
  return { at: row.at, amount: row.amount, balance: row.balance, reason: row.reason.trim() };
}

/** 匯入時不推算或修補錯誤金額；整個欄位無效便交由存檔流程保留現有明細。 */
export function parseTransactionLedger(value: unknown): Transaction[] | undefined {
  if (!Array.isArray(value) || value.length > LEDGER_LIMIT) return undefined;
  const rows: Transaction[] = [];
  for (const valueRow of value) { const row = parseTransaction(valueRow); if (!row) return undefined; rows.push(row); }
  return rows;
}

/** 不改動傳入存檔；呼叫端指定時間即可完整重跑。零差額與非法輸入不產生交易。 */
export function recordTransaction(save: { ledger?: Transaction[] }, before: number, after: number, reason: string, at = Date.now()): Transaction[] {
  const ledger = save.ledger ?? [];
  if (!validMoney(before) || !validMoney(after) || before === after || !validReason(reason) || !validAt(at)) return ledger;
  return [...ledger, { at, amount: after - before, balance: after, reason: reason.trim() }].slice(-LEDGER_LIMIT);
}

/** 支出以正值累計；只比較保留中的最近100筆，不代表玩家歷來全部收入。 */
export function summarizeTransactions(ledger: readonly Transaction[] | undefined): TransactionSummary {
  const summary: TransactionSummary = { income: 0, expense: 0, count: 0, net: 0, byReason: [] };
  const reasons = new Map<string, TransactionReasonSummary>();
  for (const value of (ledger ?? []).slice(-LEDGER_LIMIT)) {
    const row = parseTransaction(value);
    if (!row) continue;
    let group = reasons.get(row.reason);
    if (!group) { group = { reason: row.reason, income: 0, expense: 0, count: 0, net: 0 }; reasons.set(row.reason, group); }
    const income = Math.max(0, row.amount), expense = Math.max(0, -row.amount);
    for (const total of [summary, group]) { total.income += income; total.expense += expense; total.count++; total.net += row.amount; }
  }
  summary.byReason = [...reasons.values()];
  return summary;
}
