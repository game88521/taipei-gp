import { build } from 'vite';
import { writeFileSync } from 'node:fs';
const result = await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
  write: false, minify: false, target: 'es2022', lib: { entry: 'tools/dev-tests/experience-entry.ts', formats: ['es'] },
} });
for (const item of (Array.isArray(result) ? result : [result]).flatMap(r => r.output)) {
  if (item.type === 'chunk' && item.isEntry) {
    writeFileSync('dist/__experience.js', item.code);
    writeFileSync('tools/dev-tests/shots-experience-model.mjs', item.code);
  }
}
