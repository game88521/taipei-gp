import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const files = ['multiplayer.html', 'src/multiplayer-game.ts', 'src/multiplayer-client.ts', 'src/multiplayer-scene.ts', 'src/multiplayer-quality.ts', 'src/multiplayer-spectator.ts', 'src/multiplayer-series-ui.ts', 'src/multiplayer.css', 'shared/multiplayer-series.ts', 'shared/multiplayer-protocol.ts', 'server/room-service.mjs', 'server/physics.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function multiplayerEvidence(report, script) {
  const scriptUrl = new URL(script);
  report.sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(new URL(`../../${file}`, import.meta.url)))])));
  report.scriptSha256 = digest(await readFile(scriptUrl));
  return async () => {
    report.sourceUnchangedDuringTests = true;
    for (const [file, expected] of Object.entries(report.sourceHashes)) if (digest(await readFile(new URL(`../../${file}`, import.meta.url))) !== expected) report.sourceUnchangedDuringTests = false;
    report.scriptUnchangedDuringTests = report.scriptSha256 === digest(await readFile(scriptUrl));
    if (!report.sourceUnchangedDuringTests || !report.scriptUnchangedDuringTests) report.status = 'FAIL';
  };
}
