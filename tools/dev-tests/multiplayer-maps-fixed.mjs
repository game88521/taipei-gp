// 在專用4318 preview執行原chain-stab；保留歷史三項文字及結果。
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url)), project = path.resolve(directory, '../..');
const origin = 'http://127.0.0.1:4318';
const evidence = path.join(directory, `multiplayer-maps-fixed-evidence-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidence);
const optional = async file => { try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const protectedFiles = ['src/main.ts', 'src/car.ts', 'src/track.ts', 'src/rivals.ts', 'src/pitlane.ts'];
const hashes = async () => Object.fromEntries(await Promise.all(protectedFiles.map(async file => [file, hash(await readFile(path.join(project, file)))])));
const beforeHashes = await hashes();
const sw = await readFile(path.join(project, 'dist/sw.js'), 'utf8');
const build = sw.match(/const VERSION = '([^']+)'/)?.[1];
const chainPath = path.join(directory, 'chain-stab-out.txt'), previous = await optional(chainPath);
let web, stdout = '', stderr = '', code = null, signal = null, output, error;
try {
  web = await preview({ root: project, preview: { host: '127.0.0.1', port: 4318, strictPort: true }, logLevel: 'error' });
  if (await (await fetch(origin + '/sw.js')).text() !== sw) throw new Error('preview來源不是本次dist');
  const executable = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const child = spawn(executable, ['tools/dev-tests/chain-stab.sh'], { cwd: project, windowsHide: true, env: { ...process.env, GP_TEST_ORIGIN: origin, GP_CDP_PORT: process.env.GP_CDP_PORT ?? '9334' } });
  child.stdout.on('data', bytes => { stdout += bytes; process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { stderr += bytes; process.stderr.write(bytes); });
  ({ code, signal } = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); }));
} catch (failure) { error = failure.stack ?? String(failure); }
finally {
  output = await optional(chainPath);
  if (previous) { await writeFile(path.join(evidence, 'chain-stab.previous.txt'), previous); await writeFile(chainPath, previous); }
  else if (output) await unlink(chainPath);
  if (output) await writeFile(path.join(evidence, 'chain-stab-out.txt'), output);
  await writeFile(path.join(evidence, 'stdout.txt'), stdout); await writeFile(path.join(evidence, 'stderr.txt'), stderr);
  if (web) await new Promise(resolve => web.httpServer.close(resolve));
}
const text = output?.toString('utf8') ?? '';
const afterHashes = await hashes(), history = await optional(chainPath);
const historyPreserved = previous ? history?.equals(previous) === true : history === null;
const sourceUnchanged = JSON.stringify(beforeHashes) === JSON.stringify(afterHashes);
const passed = code === 0 && !error && historyPreserved && sourceUnchanged && ['BOT lap2 54.425 hits=0', '陳冠宇:162.0', '陳冠宇:175.7', '=== done: 3/3 PASS'].every(s => text.includes(s)) && !text.includes('FAIL:');
const report = { completedAt: new Date().toISOString(), status: passed ? 'PASS' : 'FAIL', build, code, signal, error, historyPreserved, sourceUnchanged, sourceHashes: afterHashes, output: text, evidence: path.relative(project, evidence).split(path.sep).join('/'), origin, productionUsed: false };
await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(directory, 'multiplayer-maps-fixed-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, build, historyPreserved, sourceUnchanged, evidence: report.evidence }));
if (!passed) process.exitCode = 1;
