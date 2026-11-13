// 多人版沿用原 26 套斷言；保留歷史摘要，本次結果另存唯一證據目錄。
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const scripts = [
  ['platform-regression', 'shots-platform-regression.json'],
  ['save-regression', 'shots-save-regression.json'],
  ['mission-regression', 'shots-mission-regression.json'],
  ['racing-state-audit', 'racing-state-audit-result.json'],
  ['main-racing-integration', 'main-racing-integration-result.json'],
  ['main-platform-integration', 'shots-main-platform-integration.json'],
  ['leaderboard-regression', 'shots-leaderboard-regression.json'],
  ['identity-regression', 'shots-identity-regression.json'],
  ['economy-regression', 'shots-economy-regression.json'],
  ['main-economy-integration', 'shots-main-economy-integration.json'],
  ['route-preview-audit', 'route-preview-audit-result.json'],
  ['static-ui-contract', 'shots-static-ui-contract.json'],
  ['followup-racing-regression', 'followup-racing-regression-result.json'],
  ['followup-save-regression', 'shots-followup-save-regression.json'],
  ['followup-radio-regression', 'shots-followup-radio-regression.json'],
  ['followup-platform-regression', 'shots-followup-platform-regression.json'],
  ['abcd-save-regression', 'shots-abcd-save-regression.json'],
  ['abcd-racing-regression', 'abcd-racing-regression-result.json'],
  ['abcd-street-regression', 'shots-abcd-street-regression.json'],
  ['abcd-conflict-integration', 'shots-abcd-conflict-integration.json'],
  ['all-platform-regression', 'all-platform-regression-results.json'],
  ['all-racing-features', 'shots-all-racing-features.json'],
  ['all-street-regression', 'all-street-regression.json'],
  ['all-street-main', 'all-street-main.json'],
  ['all-navigation-regression', 'shots-all-navigation.json'],
  ['all-progress-regression', 'shots-all-progress.json'],
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const optionalRead = async (file) => {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
async function productHash() {
  const digest = createHash('sha256');
  async function walk(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`不接受產品來源連結：${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { digest.update(file); digest.update(await readFile(path.join(root, file))); }
    }
  }
  for (const directory of ['src', 'api', 'shared', 'server']) await walk(directory);
  for (const file of ['index.html', 'multiplayer.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tools/build-multiplayer-physics.mjs']) {
    digest.update(file); digest.update(await readFile(path.join(root, file)));
  }
  return digest.digest('hex');
}

const startedAt = new Date().toISOString();
const evidence = path.join(dir, `multiplayer-node-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const oldSummaryPath = path.join(dir, 'shots-all-node-summary.json');
const oldSummary = await optionalRead(oldSummaryPath);
const before = await productHash();
const results = [];

async function run([name, resultName]) {
  const resultPath = path.join(dir, resultName);
  const previousPath = path.join(evidence, `${name}.previous.json`);
  const previous = await optionalRead(resultPath);
  if (previous) await rename(resultPath, previousPath);
  let stdout = '', stderr = '', code = null, signal = null, failure = null;
  try {
    const child = spawn(process.execPath, ['--experimental-vm-modules', path.join(dir, `${name}.mjs`)], {
      cwd: root, windowsHide: true, env: process.env,
    });
    child.stdout.on('data', (bytes) => { stdout += bytes; });
    child.stderr.on('data', (bytes) => { stderr += bytes; });
    ({ code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    }));
  } catch (error) { failure = error.stack ?? String(error); }
  const next = await optionalRead(resultPath);
  let historyPreserved = false;
  try {
    if (next) await rename(resultPath, path.join(evidence, `${name}.result.json`));
    if (previous) await rename(previousPath, resultPath);
    const restored = await optionalRead(resultPath);
    historyPreserved = previous ? restored?.equals(previous) === true : restored === null;
  } finally {
    // 保留舊結果的副本也存於本次 evidence；重跑不覆寫上一輪紀錄。
    if (previous) await writeFile(previousPath, previous);
  }
  await Promise.all([
    writeFile(path.join(evidence, `${name}.stdout.txt`), stdout),
    writeFile(path.join(evidence, `${name}.stderr.txt`), stderr + (failure ? `\n${failure}\n` : '')),
  ]);
  const result = { name, code, signal, status: code === 0 && !failure && next !== null && historyPreserved ? 'PASS' : 'FAIL', historyPreserved, resultSha256: next ? hash(next) : null, error: failure };
  results.push(result);
  console.log(`${result.status} ${name}`);
  if (result.status !== 'PASS') console.error(stdout + stderr + (failure ?? ''));
}

// 舊入口的毫秒級網路案例仍先單獨跑，不改 timeout 或斷言。
await run(scripts[0]);
for (let i = 1; i < scripts.length; i += 3) await Promise.all(scripts.slice(i, i + 3).map(run));
const after = await productHash();
const retainedSummary = await optionalRead(oldSummaryPath);
const oldSummaryPreserved = oldSummary ? retainedSummary?.equals(oldSummary) === true : retainedSummary === null;
const report = {
  startedAt, completedAt: new Date().toISOString(), productHash: after,
  sourceUnchangedDuringTests: before === after, oldSummaryPreserved,
  historicalSummarySha256: oldSummary ? hash(oldSummary) : null,
  hashIncludes: ['src/', 'api/', 'shared/', 'server/ (excluding node_modules)', 'index.html', 'multiplayer.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tools/build-multiplayer-physics.mjs'],
  results, summary: { passed: results.filter((result) => result.status === 'PASS').length, failed: results.filter((result) => result.status !== 'PASS').length },
  status: before === after && oldSummaryPreserved && results.length === 26 && results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL',
  evidence: path.relative(root, evidence).split(path.sep).join('/'),
  limitations: ['原 26 套隔離模組與本機 HTTP 回歸；多人真 WS、瀏覽器及固定三回歸另列，不代表正式服務或手機實機'],
};
await writeFile(path.join(evidence, 'multiplayer-node-summary.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(dir, 'multiplayer-node-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ...report.summary, sourceUnchangedDuringTests: report.sourceUnchangedDuringTests, oldSummaryPreserved, evidence: report.evidence }));
if (report.status !== 'PASS') process.exitCode = 1;
