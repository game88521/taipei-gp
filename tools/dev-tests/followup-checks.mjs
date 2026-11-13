// 本機隔離測試總入口。只寫測試產物；不啟動Chrome、不連正式服務或讀玩家存檔。
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(dir, '../..');
async function sourceHash() {
  const hash = createHash('sha256');
  async function walk(relative) {
    for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { hash.update(file); hash.update(await readFile(path.join(root, file))); }
    }
  }
  for (const dir of ['src', 'api', 'shared']) await walk(dir);
  for (const file of ['index.html', 'vite.config.ts']) { hash.update(file); hash.update(await readFile(path.join(root, file))); }
  return hash.digest('hex');
}
const startedAt = new Date().toISOString(), before = await sourceHash();
const scripts = ['platform-regression', 'save-regression', 'mission-regression', 'racing-state-audit', 'main-racing-integration', 'main-platform-integration', 'leaderboard-regression', 'identity-regression', 'economy-regression', 'main-economy-integration', 'route-preview-audit', 'static-ui-contract', 'followup-racing-regression', 'followup-save-regression', 'followup-radio-regression', 'followup-platform-regression'];
const results = [];
async function run(name) {
  const child = spawn(process.execPath, ['--experimental-vm-modules', path.join(dir, `${name}.mjs`)], { cwd: root, windowsHide: true, env: process.env });
  let output = '';
  child.stdout.on('data', (data) => { output += data; }); child.stderr.on('data', (data) => { output += data; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  await writeFile(path.join(dir, `shots-followup-${name}.txt`), output);
  const result = { name, code, status: code === 0 ? 'PASS' : 'FAIL' };
  results.push(result); console.log(`${result.status} ${name}`);
  if (code !== 0) console.error(output);
}
for (let i = 0; i < scripts.length; i += 3) await Promise.all(scripts.slice(i, i + 3).map(run));
const after = await sourceHash();
const report = { startedAt, completedAt: new Date().toISOString(), sourceHash: after, sourceUnchangedDuringTests: before === after, baseline: process.env.GP_BASELINE_DIR ?? path.resolve(root, '../taipei-gp-priority-before-20261111'), results, status: before === after && results.every((r) => r.code === 0) ? 'PASS' : 'FAIL', limitations: ['隔離程式與本機HTTP測試，不代表手機實機或正式Redis', '瀏覽器與固定三回歸另行執行'] };
await writeFile(path.join(dir, 'shots-followup-node-summary.json'), JSON.stringify(report, null, 2) + '\n');
if (report.status !== 'PASS') process.exitCode = 1;
