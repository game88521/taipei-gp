// 舊回歸的「錄製檔位元不變」歷史假設，改以本輪真長時before/after物理對照保護。
// 其他四個核心仍逐位元比較；證據過期、來源改變或案例失敗皆拒絕，不跳過檢查。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyRacingCore(project, historicalBefore) {
  const core = ['src/car.ts', 'src/track.ts', 'src/rivals.ts', 'src/pitlane.ts', 'server/physics.mjs'];
  const hashes = {};
  for (const file of core) {
    const after = digest(await readFile(path.join(project, file))), before = digest(await readFile(path.join(historicalBefore, file)));
    hashes[file] = { before, after };
    if (file !== 'src/rivals.ts') assert.equal(after, before, `${file} 核心必須逐位元相同`);
  }
  if (hashes['src/rivals.ts'].after === hashes['src/rivals.ts'].before) return { status: 'PASS', immutableCoreFiles: 5, hashes };

  const immutableBefore = path.resolve(project, '../taipei-gp-twelve-before-102e84eea8ea');
  assert.equal(hashes['src/rivals.ts'].before, digest(await readFile(path.join(immutableBefore, 'src/rivals.ts'))), '歷史rivals必須與十二項不可變before相同');
  const resultPath = 'tools/dev-tests/twelve-racing-result.json', bytes = await readFile(path.join(project, resultPath));
  const result = JSON.parse(bytes);
  assert.equal(result.status, 'PASS', '必須先執行本輪真長時物理回歸');
  assert.ok(result.cases.length >= 20 && result.cases.every(row => row.status === 'PASS'));
  assert.equal(result.summary.FAIL, 0); assert.equal(result.summary.PASS, result.cases.length);
  assert.equal(result.scriptSha256, digest(await readFile(path.join(project, 'tools/dev-tests/twelve-racing-regression.mjs'))), '長時對照測試腳本已變更，必須重跑');
  assert.ok(result.sourceHashes['src/rivals.ts'] && result.sourceHashes['src/bounded-recording.ts'] && result.sourceHashes['src/main.ts']);
  for (const [file, expected] of Object.entries(result.sourceHashes)) assert.equal(digest(await readFile(path.join(project, file))), expected, `長時對照來源已變更，必須重跑：${file}`);
  for (const file of core) {
    assert.ok(result.beforeHashes[file], `長時對照缺少before來源：${file}`);
    assert.equal(result.beforeHashes[file], digest(await readFile(path.join(immutableBefore, file))), `長時對照before來源不符：${file}`);
  }
  const long = result.cases.find(row => row.name.startsWith('GP長時真before/after：'));
  assert.equal(long?.status, 'PASS');
  assert.ok(long.details.beforeFrames > 12000 && long.details.afterFrames <= 12000 && long.details.duration >= 650);
  assert.equal(long.details.pitCounts.length, 22); assert.equal(long.details.pitCounts.filter(n => n >= 1).length, 21);
  assert.ok(Number.isSafeInteger(long.details.calls) && long.details.calls >= 0);
  return {
    status: 'PASS', immutableCoreFiles: 4, hashes,
    recordingOnlyRivalsChange: { evidence: resultPath, evidenceSha256: digest(bytes), scriptSha256: result.scriptSha256, before: immutableBefore, details: long.details, allSourceAndBeforeHashesMatched: true },
    helperSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  };
}
