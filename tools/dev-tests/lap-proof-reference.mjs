import { build } from 'vite';
import { writeFileSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validateLapProof, trackManifest } from '../../shared/lap-proof.js';
const temporary = 'tools/dev-tests/shots-lap-reference.mjs';
const result = await build({ configFile: false, publicDir: false, logLevel: 'warn', build: { write: false, minify: false, target: 'node24',
  lib: { entry: 'tools/dev-tests/lap-reference-entry.ts', formats: ['es'] }, rollupOptions: { external: ['three'] } } });
const chunk = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output).find((r) => r.type === 'chunk' && r.isEntry);
writeFileSync(temporary, chunk.code);
try {
  const { referenceLap } = await import(new URL('./shots-lap-reference.mjs', import.meta.url));
  const results = ['classic', '2026'].map((rules) => {
    const lap = referenceLap(rules), validation = validateLapProof({ v: 1, trackStamp: trackManifest.stamp, samples: lap.samples }, lap.time, rules);
    assert.equal(validation.ok, true, `${rules}: ${JSON.stringify(validation)}`);
    return { rules, time: lap.time, points: lap.samples.length, validation };
  });
  writeFileSync('tools/dev-tests/shots-lap-proof-reference.json', JSON.stringify({ results, limitations: '真實 Car.update 參照圈，沒有渲染、車陣、DRS 區段或完整 main。不是完整遊戲基準。' }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { unlinkSync(temporary); }
