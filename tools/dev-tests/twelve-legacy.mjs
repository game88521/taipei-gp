// Run relevant historical Node suites against the integrated project.
// Keeps every prior report; no browser, remote service, Git, or original project access.
import assert from 'node:assert/strict';
import { readFile, readdir, lstat, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const digest = (b) => createHash('sha256').update(b).digest('hex');
const suite = [
  ['multiplayer-server-regression', 'multiplayer-server-summary.json'],
  ['multiplayer-maps-server-regression', 'multiplayer-maps-server-summary.json'],
  ['multiplayer-collision-server-regression', 'multiplayer-collision-server-summary.json'],
  ['multiplayer-client-regression', 'shots-multiplayer-maps-client-live-regression.json'],
  ['lobbybrake-client', 'lobbybrake-client-result.json'],
  ['next6-multiplayer-deadlines', 'next6-multiplayer-deadlines-result.json'],
  ['raceplus-laps-regression', 'raceplus-laps-result.json'],
  ['multiplayer-map-ui-lifecycle', 'shots-multiplayer-map-ui-lifecycle.json'],
  ['multiplayer-collision-client-regression', 'multiplayer-collision-client-result.json'],
  ['next6-multiplayer-pacing', 'next6-multiplayer-pacing-result.json'],
  ['next6-multiplayer-ui', 'next6-multiplayer-ui-result.json'],
  ['lobbybrake-host', 'lobbybrake-host-result.json'],
  ['lobbybrake-entry', 'lobbybrake-entry-result.json'],
  ['raceplus-invite-main', 'raceplus-invite-main-result.json'],
  ['next6-racing-regression', 'next6-racing-result.json'],
  ['raceplus-strategy-main', 'raceplus-strategy-main-result.json'],
  ['lobbybrake-assist-main', 'lobbybrake-assist-main-result.json'],
  ['next6-city-main', 'next6-city-main.json'],
  ['next6-city-police', 'next6-city-police.json'],
  ['tenpack-hud', 'tenpack-hud-result.json'],
  ['tenpack-racing-regression', 'tenpack-racing-result.json'],
  ['tenpack-city-regression', 'tenpack-city-regression.json'],
  ['tenpack-tour-cancel', 'tenpack-tour-cancel-result.json'],
  ['tenpack-multiplayer-server', 'tenpack-multiplayer-server-result.json'],
  ['tenpack-multiplayer-models', 'tenpack-multiplayer-models-result.json'],
  ['tenpack-multiplayer-client', 'tenpack-multiplayer-client-result.json'],
  ['tenpack-multiplayer-ui', 'tenpack-multiplayer-ui-result.json'],
];
const selected = process.argv.slice(2);
assert.ok(selected.every((n) => suite.some(([name]) => n === name)), 'Unknown suite requested');
const jobs = selected.length ? suite.filter(([n]) => selected.includes(n)) : suite;
async function optional(p) { try { return await readFile(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function sourceHashes() {
  const rows = {};
  async function walk(relative) {
    for (const e of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(e.name.toLowerCase())) continue;
      const p = `${relative}/${e.name}`, stat = await lstat(path.join(root, p));
      assert.ok(!stat.isSymbolicLink(), `Linked product refused: ${p}`);
      if (stat.isDirectory()) await walk(p); else { assert.ok(stat.isFile()); rows[p] = digest(await readFile(path.join(root, p))); }
    }
  }
  for (const p of ['src', 'shared', 'server', 'api']) await walk(p);
  for (const p of ['index.html', 'multiplayer.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tools/build-multiplayer-physics.mjs']) rows[p] = digest(await readFile(path.join(root, p)));
  return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
}
const evidence = path.join(here, `twelve-legacy-${Date.now()}-${randomUUID().slice(0, 8)}`); await mkdir(evidence);
const before = await sourceHashes(), results = [], report = { startedAt: new Date().toISOString(), status: 'FAIL', localOnly: true,
  scriptSha256: digest(await readFile(fileURLToPath(import.meta.url))), sourceHashes: before, results, evidence: path.relative(root, evidence).replaceAll('\\', '/') };
for (const [name, output] of jobs) {
  const file = path.join(here, output), previous = await optional(file), previousCopy = path.join(evidence, `${name}.previous.json`);
  if (previous) await rename(file, previousCopy);
  let stdout = '', stderr = '', result;
  try {
    const child = spawn(process.execPath, ['--experimental-vm-modules', path.join(here, `${name}.mjs`), ...(name === 'multiplayer-client-regression' ? ['--live'] : [])], { cwd: root, windowsHide: true });
    child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
    result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  } catch (e) { result = { code: null, error: String(e.stack ?? e) }; }
  const fresh = await optional(file); let historyPreserved;
  if (fresh) await rename(file, path.join(evidence, `${name}.result.json`));
  if (previous) await writeFile(file, previous);
  historyPreserved = previous ? previous.equals(await readFile(file)) : await optional(file) === null;
  await writeFile(path.join(evidence, `${name}.stdout.txt`), stdout); await writeFile(path.join(evidence, `${name}.stderr.txt`), stderr);
  let body; try { body = fresh ? JSON.parse(fresh) : null; } catch { body = null; }
  const cases = body?.cases ?? body?.checks ?? body?.results;
  const failedRows = Array.isArray(cases) ? cases.filter((c) => c.status === 'FAIL' || c.pass === false || c.passed === false) : [];
  const status = result.code === 0 && body !== null && body.status !== 'FAIL' && failedRows.length === 0 && historyPreserved ? 'PASS' : 'FAIL';
  const row = { name, status, ...result, output, historyPreserved, reportSha256: fresh ? digest(fresh) : null, count: Array.isArray(cases) ? cases.length : null,
    scriptSha256: digest(await readFile(path.join(here, `${name}.mjs`))) };
  results.push(row); console.log(JSON.stringify(row));
  if (status === 'FAIL') console.error((stdout + '\n' + stderr).slice(-4500));
}
report.sourceUnchangedDuringTests = JSON.stringify(before) === JSON.stringify(await sourceHashes());
report.completedAt = new Date().toISOString(); report.status = report.sourceUnchangedDuringTests && results.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL';
report.summary = { passedSuites: results.filter((r) => r.status === 'PASS').length, failedSuites: results.filter((r) => r.status === 'FAIL').length,
  reportedCases: results.reduce((n, r) => n + (r.count ?? 0), 0) };
const name = selected.length ? `twelve-legacy-selected-${Date.now()}.json` : 'twelve-legacy-result.json';
await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(here, name), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ...report.summary, evidence: report.evidence, report: name }));
if (report.status !== 'PASS') process.exitCode = 1;
