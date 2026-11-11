// 建立暫時的獨立車模測試頁。正式 npm run build 會清掉這些 dist 測試產物。
import { build } from 'vite';
import { writeFileSync } from 'node:fs';
const label = process.argv[2] ?? 'check';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('無效的輸出名稱');
const result = await build({
  configFile: false, publicDir: false, logLevel: 'warn',
  build: { write: false, minify: false, target: 'es2022',
    lib: { entry: 'tools/dev-tests/f1-entry.ts', formats: ['es'] } },
});
for (const item of (Array.isArray(result) ? result : [result]).flatMap((r) => r.output)) {
  if (item.type === 'chunk' && item.isEntry) {
    writeFileSync(`dist/shots-f1-${label}.js`, item.code);
    writeFileSync(`tools/dev-tests/shots-f1-model-${label}.mjs`, item.code);
  }
}
writeFileSync(`dist/shots-f1-${label}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>車模量測</title><style>body{margin:0;background:#28303c}canvas{display:block}</style></head><body><script type="module">import * as m from "/shots-f1-${label}.js"; window.__f1=m;</script></body></html>`);
console.log(`獨立車模測試頁已建立：/shots-f1-${label}.html`);
