import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function startAudit(root, script, files) {
  const sourceHashes = {};
  for (const file of files) sourceHashes[file] = sha256(await readFile(path.join(root, file)));
  return { sourceHashes, scriptSha256: sha256(await readFile(script)), startedAt: new Date().toISOString() };
}
export async function finishAudit(root, script, report) {
  report.sourceUnchangedDuringTests = true;
  for (const [file, hash] of Object.entries(report.sourceHashes)) if (sha256(await readFile(path.join(root, file))) !== hash) report.sourceUnchangedDuringTests = false;
  report.scriptUnchangedDuringTests = report.scriptSha256 === sha256(await readFile(script));
  report.finishedAt = new Date().toISOString();
  if (!report.sourceUnchangedDuringTests || !report.scriptUnchangedDuringTests || report.cleanupComplete === false) { report.status = 'FAIL'; process.exitCode = 1; }
}
