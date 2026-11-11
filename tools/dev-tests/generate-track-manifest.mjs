// 只產生伺服器的真實賽道路徑資料，不寫 dist、不建立 WebGL。
import { build } from 'vite';
import { writeFileSync, mkdirSync, unlinkSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const output = 'tools/dev-tests/shots-track-manifest.mjs';
const result = await build({ configFile: false, publicDir: false, logLevel: 'warn',
  build: { write: false, minify: false, target: 'node24', lib: { entry: 'tools/dev-tests/track-manifest-entry.ts', formats: ['es'] }, rollupOptions: { external: ['three'] } } });
const entry = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output).find((r) => r.type === 'chunk' && r.isEntry);
if (!entry) throw new Error('track manifest entry missing');
writeFileSync(output, entry.code);
try {
  const manifest = (await import(new URL('./shots-track-manifest.mjs', import.meta.url))).default;
  manifest.sourceHash = createHash('sha256').update(readFileSync('src/track.ts')).update(readFileSync('src/data/track.json')).digest('hex');
  mkdirSync('shared', { recursive: true });
  writeFileSync('shared/taipei-track.json', JSON.stringify(manifest));
  console.log(JSON.stringify({ stamp: manifest.stamp, length: manifest.length, points: manifest.points.length, sourceHash: manifest.sourceHash }, null, 2));
} finally { unlinkSync(output); }
