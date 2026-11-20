// Source-bound local Atlas verification. Suites run sequentially; every attempt is archived.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, lstat, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const specs = [
  [
    "atlas-platform-models",
    "atlas-platform-models-result.json",
    15
  ],
  [
    "atlas-city-server",
    "atlas-city-server-result.json",
    30
  ],
  [
    "atlas-city-client",
    "atlas-city-client-result.json",
    14
  ],
  [
    "atlas-coop-client",
    "atlas-coop-client-result.json",
    7
  ],
  [
    "atlas-coop-history",
    "atlas-coop-history-result.json",
    8
  ],
  [
    "atlas-duty-models",
    "atlas-duty-models-result.json",
    8
  ],
  [
    "atlas-workshop-models",
    "atlas-workshop-models-result.json",
    13
  ],
  [
    "atlas-racing-server",
    "atlas-racing-server-result.json",
    16
  ],
  [
    "atlas-racing-client",
    "atlas-racing-client-result.json",
    4
  ]
];
const selected = process.argv.slice(2);
assert.ok(selected.every(name => specs.some(([candidate]) => candidate === name)), 'Unknown Atlas suite requested');
assert.equal(new Set(selected).size, selected.length, 'Duplicate Atlas suite requested');
const jobs = selected.length ? specs.filter(([name]) => selected.includes(name)) : specs;
async function optional(file) {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function sources() {
  const out = {};
  async function walk(relative) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist'].includes(entry.name.toLowerCase())) continue;
      const file = `${relative}/${entry.name}`, stat = await lstat(path.join(root, file));
      assert.ok(!stat.isSymbolicLink(), `Linked product refused: ${file}`);
      if (stat.isDirectory()) await walk(file);
      else { assert.ok(stat.isFile(), file); out[file] = hash(await readFile(path.join(root, file))); }
    }
  }
  for (const directory of ['src', 'shared', 'server', 'api']) await walk(directory);
  for (const file of ['index.html', 'multiplayer.html', 'splitscreen.html', 'package.json', 'package-lock.json', 'vite.config.ts',
    'tools/build-multiplayer-catalog.mjs', 'tools/build-multiplayer-physics.mjs', 'tools/build-summit-city-physics.mjs', 'tools/build-nexus-coop-city.mjs', 'public/data/city.json']) {
    assert.ok(!(await lstat(path.join(root, file))).isSymbolicLink(), file);
    out[file] = hash(await readFile(path.join(root, file)));
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
async function testScripts() {
  const out = {};
  for (const entry of await readdir(here, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:mjs|sh)$/.test(entry.name)) continue;
    out[`tools/dev-tests/${entry.name}`] = hash(await readFile(path.join(here, entry.name)));
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
const evidence = path.join(here, `atlas-node-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const sourceHashes = await sources(), testScriptHashes = await testScripts();
const report = {
  build: (await readFile(path.join(root, 'dist/sw.js'), 'utf8')).match(/const VERSION = '([^']+)'/)?.[1],
  status: 'FAIL', localOnly: true, externalRequests: 0, startedAt: new Date().toISOString(),
  sourceHashes, testScriptHashes, scriptSha256: hash(await readFile(new URL(import.meta.url))),
  expectedCases: jobs.reduce((count, [, , expected]) => count + expected, 0), results: [],
  evidence: path.relative(root, evidence).replaceAll('\\', '/'),
  limitations: ['Node suites use real local services, physics and declared fixtures; this does not establish browser rendering, real phones/gamepads, external networking or human balance.'],
};
for (const [name, output, expectedCount] of jobs) {
  const outputPath = path.join(here, output), previous = await optional(outputPath);
  if (previous) await rename(outputPath, path.join(evidence, `${name}.previous.json`));
  let stdout = '', stderr = '', result;
  const scriptSha256 = hash(await readFile(path.join(here, `${name}.mjs`)));
  try {
    const child = spawn(process.execPath, ['--experimental-vm-modules', path.join(here, `${name}.mjs`)], { cwd: root, windowsHide: true, env: process.env });
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  } catch (error) { result = { code: null, signal: null, error: String(error.stack ?? error) }; }
  const fresh = await optional(outputPath); let body = null;
  try { body = fresh ? JSON.parse(fresh) : null; } catch { /* Missing or malformed fresh output is a failure. */ }
  if (fresh) await writeFile(path.join(evidence, output), fresh);
  else if (previous) await writeFile(outputPath, previous);
  await writeFile(path.join(evidence, `${name}.stdout.txt`), stdout);
  await writeFile(path.join(evidence, `${name}.stderr.txt`), stderr + (result.error ? `\n${result.error}\n` : ''));
  const cases = body?.cases ?? body?.checks ?? body?.results;
  const passed = result.code === 0 && !result.error && body?.status === 'PASS'
    && Array.isArray(cases) && cases.length === expectedCount && cases.every(item => item.status === 'PASS');
  const row = { name, status: passed ? 'PASS' : 'FAIL', ...result, count: Array.isArray(cases) ? cases.length : null, expectedCount,
    output, freshReport: fresh !== null, previousReportSha256: previous ? hash(previous) : null,
    reportSha256: fresh ? hash(fresh) : null, scriptSha256 };
  report.results.push(row); console.log(JSON.stringify(row));
  if (!passed) console.error((stdout + '\n' + stderr + (result.error ?? '')).slice(-4500));
}
report.sourceUnchangedDuringTests = JSON.stringify(sourceHashes) === JSON.stringify(await sources());
report.testScriptsUnchangedDuringTests = JSON.stringify(testScriptHashes) === JSON.stringify(await testScripts());
report.summary = { passed: report.results.filter(row => row.status === 'PASS').reduce((count, row) => count + row.count, 0),
  reportedCases: report.results.reduce((count, row) => count + (row.count ?? 0), 0), failedSuites: report.results.filter(row => row.status === 'FAIL').length };
report.status = report.sourceUnchangedDuringTests && report.testScriptsUnchangedDuringTests && report.results.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL';
report.completedAt = new Date().toISOString();
const bytes = JSON.stringify(report, null, 2) + '\n';
await writeFile(path.join(evidence, 'summary.json'), bytes);
await writeFile(path.join(here, selected.length ? 'atlas-node-selected-result.json' : 'atlas-node-result.json'), bytes);
console.log(JSON.stringify({ status: report.status, ...report.summary, evidence: report.evidence }));
process.exitCode = report.status === 'PASS' ? 0 : 1;
