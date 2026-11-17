// 保留原26套及失敗證據，只在明確放行後單獨重跑platform一次；不修改產品或測試斷言。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--run-isolated-platform')) {
  console.log('Prepared only. After Chrome is idle: node tools/dev-tests/next6-legacy-completion.mjs --run-isolated-platform');
  process.exit(0);
}

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const EXPECTED_PRODUCT = '41494ebaee4e1aae2e0658d0ed1cad1f3efd9fe3c548f2f7d3f910917de2580f';
const EXPECTED_SUMMARY = '957a3ed2b88d5a106cad859233ce014b4e45ef667cd071db62856e9f32157595';
const EXPECTED_PLATFORM = '5f22923a3665d2825e9003e8050ba5b7304ad4acdb3134b2e82d57c093c2a2d9';
const EXPECTED_NETWORK = '11714727330fb4f6447ac7e677b98c9fe668b83d9f7565499f89ef4e21386fb2';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(root, file).split(path.sep).join('/');
const optionalRead = async file => { try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
function projectPath(relativePath) {
  const resolved = path.resolve(root, relativePath);
  assert.ok(resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep), `Evidence outside project: ${relativePath}`);
  return resolved;
}
// Same paths, ordering and bytes as multiplayer-checks.mjs; do not import that executable runner.
async function productHash() {
  const digest = createHash('sha256');
  async function walk(relativePath) {
    const entries = await readdir(path.join(root, relativePath), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const file = `${relativePath}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`不接受產品來源連結：${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { digest.update(file); digest.update(await readFile(path.join(root, file))); }
    }
  }
  for (const dir of ['src', 'api', 'shared', 'server']) await walk(dir);
  for (const file of ['index.html', 'multiplayer.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tools/build-multiplayer-physics.mjs']) {
    digest.update(file); digest.update(await readFile(path.join(root, file)));
  }
  return digest.digest('hex');
}

const evidence = path.join(directory, `next6-legacy-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const report = { startedAt: new Date().toISOString(), status: 'FAIL', evidence: relative(evidence), originalFullRun: null,
  isolatedRerun: { executed: false, attempts: 0 }, results: [], summary: { passed: 0, failed: 26 },
  limitations: ['原26套隔離模組及本機HTTP測試；不代表正式站、手機實機或完整遊戲驗收。',
    '合併保留原25項PASS，只針對唯一失敗項目單獨重跑一次；同一productHash才允許沿用。',
    '原失敗為idle斷言收到timeout；並行瀏覽器負載影響屬推論，保留stderr，不以推論取代重跑結果。'],
};
const summaryPath = path.join(directory, 'multiplayer-node-summary.json');
const resultPath = path.join(directory, 'shots-platform-regression.json');
const platformPath = path.join(directory, 'platform-regression.mjs');
let originalBytes, originalEvidenceSummary, originalEvidencePath, previousResult, stdout = '', stderr = '', childFailure = null;
try {
  originalBytes = await readFile(summaryPath);
  const original = JSON.parse(originalBytes);
  report.originalFullRun = { summaryPath: relative(summaryPath), summarySha256: hash(originalBytes), productHash: original.productHash,
    status: original.status, summary: original.summary, results: original.results, evidence: original.evidence };
  await writeFile(path.join(evidence, 'original-multiplayer-node-summary.json'), originalBytes, { flag: 'wx' });
  assert.equal(hash(originalBytes), EXPECTED_SUMMARY, 'Original 25/1 summary changed; no rerun performed');
  assert.equal(original.productHash, EXPECTED_PRODUCT);
  assert.equal(original.sourceUnchangedDuringTests, true); assert.equal(original.oldSummaryPreserved, true);
  assert.equal(original.results.length, 26); assert.equal(new Set(original.results.map(result => result.name)).size, 26);
  assert.deepEqual(original.summary, { passed: 25, failed: 1 });
  assert.deepEqual(original.results.filter(result => result.status !== 'PASS').map(result => result.name), ['platform-regression']);
  originalEvidencePath = projectPath(original.evidence);
  originalEvidenceSummary = await readFile(path.join(originalEvidencePath, 'multiplayer-node-summary.json'));
  assert.ok(originalEvidenceSummary.equals(originalBytes), 'Original evidence summary differs from latest original summary');
  await writeFile(path.join(evidence, 'original-evidence-summary.json'), originalEvidenceSummary, { flag: 'wx' });
  const preserved = [];
  for (const suffix of ['stdout.txt', 'stderr.txt']) {
    const file = `platform-regression.${suffix}`, bytes = await readFile(path.join(originalEvidencePath, file));
    await writeFile(path.join(evidence, `original-${file}`), bytes, { flag: 'wx' });
    preserved.push({ original: relative(path.join(originalEvidencePath, file)), copy: relative(path.join(evidence, `original-${file}`)), sha256: hash(bytes) });
  }
  assert.ok((await readFile(path.join(evidence, 'original-platform-regression.stderr.txt'), 'utf8')).includes("code: 'timeout'"));
  const originalPassEvidence = [];
  for (const result of original.results.filter(result => result.status === 'PASS')) {
    assert.equal(result.code, 0); assert.equal(result.historyPreserved, true);
    const file = path.join(originalEvidencePath, `${result.name}.result.json`), bytes = await readFile(file);
    assert.equal(hash(bytes), result.resultSha256, `Original PASS evidence changed: ${result.name}`);
    originalPassEvidence.push({ name: result.name, path: relative(file), sha256: hash(bytes) });
  }
  report.originalFullRun.failureEvidence = preserved; report.originalFullRun.verifiedPassEvidence = originalPassEvidence;
  const beforeHash = await productHash(); report.productHashBeforeIsolated = beforeHash;
  assert.equal(beforeHash, EXPECTED_PRODUCT, 'Product changed since the original 26 suites; refusing to reuse 25 PASS results');
  const scriptBytes = await readFile(platformPath), networkBytes = await readFile(path.join(root, 'src/network.ts'));
  assert.equal(hash(scriptBytes), EXPECTED_PLATFORM, 'platform script changed; refusing isolated run');
  assert.equal(hash(networkBytes), EXPECTED_NETWORK, 'network source changed; refusing isolated run');
  const baselineNetwork = await readFile(path.resolve(root, '../taipei-gp-next6-before-57b09b2/src/network.ts'));
  assert.ok(networkBytes.equals(baselineNetwork), 'network.ts differs from next6 baseline');
  report.sourceHashes = { platformRegression: hash(scriptBytes), network: hash(networkBytes), baselineNetwork: hash(baselineNetwork) };
  const once = path.join(directory, `next6-legacy-isolated-${EXPECTED_SUMMARY.slice(0, 12)}.started.json`);
  await writeFile(once, JSON.stringify({ summarySha256: EXPECTED_SUMMARY, productHash: beforeHash, evidence: relative(evidence), startedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
  previousResult = await optionalRead(resultPath);
  if (previousResult) {
    await writeFile(path.join(evidence, 'platform-regression.previous.json'), previousResult, { flag: 'wx' });
    await rename(resultPath, path.join(evidence, 'platform-regression.previous-working-copy.json'));
  }
  report.isolatedRerun = { executed: true, attempts: 1, startedAt: new Date().toISOString(), command: 'node --experimental-vm-modules tools/dev-tests/platform-regression.mjs',
    scriptSha256: EXPECTED_PLATFORM, baselineEnvironment: process.env.GP_BASELINE_DIR ?? null };
  let code = null, signal = null;
  try {
    const child = spawn(process.execPath, ['--experimental-vm-modules', platformPath], { cwd: root, windowsHide: true, env: process.env });
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    ({ code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    }));
  } catch (error) { childFailure = error.stack ?? String(error); }
  const next = await optionalRead(resultPath);
  if (next) await rename(resultPath, path.join(evidence, 'platform-regression.result.json'));
  if (previousResult) await writeFile(resultPath, previousResult, { flag: 'wx' });
  const restored = await optionalRead(resultPath);
  const historyPreserved = previousResult ? restored?.equals(previousResult) === true : restored === null;
  const afterHash = await productHash();
  const scriptUnchanged = (await readFile(platformPath)).equals(scriptBytes);
  const sourceUnchanged = afterHash === beforeHash;
  const isolatedStatus = code === 0 && !childFailure && next !== null && historyPreserved && sourceUnchanged && scriptUnchanged ? 'PASS' : 'FAIL';
  Object.assign(report.isolatedRerun, { completedAt: new Date().toISOString(), code, signal, status: isolatedStatus, historyPreserved,
    sourceUnchangedDuringTests: sourceUnchanged, scriptUnchangedDuringTests: scriptUnchanged, resultSha256: next ? hash(next) : null,
    stdout: relative(path.join(evidence, 'platform-regression.stdout.txt')), stderr: relative(path.join(evidence, 'platform-regression.stderr.txt')),
    result: next ? relative(path.join(evidence, 'platform-regression.result.json')) : null, error: childFailure });
  report.productHash = afterHash; report.sameProductHash = beforeHash === original.productHash && afterHash === beforeHash;
  report.originalSummaryPreserved = (await readFile(summaryPath)).equals(originalBytes);
  report.originalEvidenceSummaryPreserved = (await readFile(path.join(originalEvidencePath, 'multiplayer-node-summary.json'))).equals(originalEvidenceSummary);
  report.results = original.results.map(result => result.name === 'platform-regression'
    ? { name: result.name, status: isolatedStatus, code, signal, resultSha256: next ? hash(next) : null, execution: 'isolated-rerun', evidence: report.isolatedRerun.result,
      originalFailureRetained: { ...result, evidence: original.evidence } }
    : { ...result, execution: 'original-full-run', evidence: relative(path.join(originalEvidencePath, `${result.name}.result.json`)) });
  report.summary = { passed: report.results.filter(result => result.status === 'PASS').length, failed: report.results.filter(result => result.status !== 'PASS').length };
  report.status = report.results.length === 26 && report.summary.failed === 0 && report.sameProductHash
    && report.originalSummaryPreserved && report.originalEvidenceSummaryPreserved && historyPreserved && scriptUnchanged ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = error.stack ?? String(error);
  console.error(report.error);
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'platform-regression.stdout.txt'), stdout, { flag: 'wx' });
  await writeFile(path.join(evidence, 'platform-regression.stderr.txt'), stderr + (childFailure ? `\n${childFailure}\n` : ''), { flag: 'wx' });
  const oldMerged = await optionalRead(path.join(directory, 'next6-legacy-result.json'));
  if (oldMerged) await writeFile(path.join(evidence, 'next6-legacy-result.previous.json'), oldMerged, { flag: 'wx' });
  const bytes = JSON.stringify(report, null, 2) + '\n';
  await writeFile(path.join(evidence, 'next6-legacy-result.json'), bytes, { flag: 'wx' });
  await writeFile(path.join(directory, 'next6-legacy-result.json'), bytes);
  console.log(JSON.stringify({ status: report.status, ...report.summary, sameProductHash: report.sameProductHash, isolatedAttempts: report.isolatedRerun.attempts, evidence: report.evidence }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
