// 保留真正的前後版本；正式 build 會清掉 dist 中的診斷頁。
import { build } from 'vite';
import { writeFileSync } from 'node:fs';
const label = process.argv[2];
if (!['before', 'after'].includes(label)) throw new Error('請指定 before 或 after');
const result = await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
  write: false, minify: false, target: 'es2022', lib: { entry: 'tools/dev-tests/quali-entry.ts', formats: ['es'] },
} });
for (const item of (Array.isArray(result) ? result : [result]).flatMap((r) => r.output)) {
  if (item.type === 'chunk' && item.isEntry) writeFileSync(`tools/dev-tests/shots-quali-model-${label}.mjs`, item.code);
}
console.log(`已保留 ${label} 排位計算 bundle`);
