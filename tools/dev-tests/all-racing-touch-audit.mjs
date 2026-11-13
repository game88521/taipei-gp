// 對已保存的真Chrome量測嚴格重審44px門檻；不宣稱重新開瀏覽器。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const input = new URL('./shots-all-racing-browser.json', import.meta.url), raw = await readFile(input, 'utf8'), report = JSON.parse(raw);
assert.equal(report.layouts.length, 6);
const controls = report.layouts.flatMap((layout) => layout.controls.map((control) => ({ panel: layout.label, viewport: `${layout.width}x${layout.height}`, ...control })));
for (const control of controls) {
  assert.ok(control.width >= 44 && control.height >= 44, JSON.stringify(control));
  const height = Number(control.viewport.split('x')[1]); assert.ok(control.top >= -1 && control.bottom <= height + 1, JSON.stringify(control));
}
const result = { build: report.build, source: 'shots-all-racing-browser.json', sourceHash: createHash('sha256').update(raw).digest('hex'),
  threshold: 44, measuredControls: controls.length, minWidth: Math.min(...controls.map((c) => c.width)), minHeight: Math.min(...controls.map((c) => c.height)),
  passed: true, limitations: ['嚴格重新判讀同一趟Chrome的原始量測；沒有另外啟動Chrome或變更產品。'], controls };
await writeFile(new URL('./shots-all-racing-touch44.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(`PASS ${controls.length}個真Chrome控制項量測：最低${result.minHeight}px高／${result.minWidth}px寬，全數>=44px且可捲到。`);
