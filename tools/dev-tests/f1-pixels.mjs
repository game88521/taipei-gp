// 比較同一鏡位的原始 WebGL 像素；允許材質合併造成的小量浮點／邊緣差異。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const read = (name) => readFileSync(new URL(name, import.meta.url));
const before = JSON.parse(read('shots-f1-render-before.json'));
const after = JSON.parse(read('shots-f1-render-after.json'));
const result = {};
for (const mode of ['full', 'far', 'restored', 'paint-tyre-rain']) {
  const a = read(`shots-f1-before-${mode}.rgba`), b = read(`shots-f1-after-${mode}.rgba`);
  assert.equal(a.length, b.length); assert.equal(a.length, 960 * 540 * 4);
  let sum = 0, max = 0, strong = 0;
  for (let i = 0; i < a.length; i += 4) {
    let pixel = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; max = Math.max(max, d); pixel = Math.max(pixel, d); }
    if (pixel > 8) strong++;
  }
  const meanChannelDifference = sum / (960 * 540 * 3), strongPixelFraction = strong / (960 * 540);
  assert.ok(strongPixelFraction < 0.005, `${mode} 大幅差異像素超過 0.5%：${strongPixelFraction * 100}%`);
  assert.ok(meanChannelDifference < 0.5, `${mode} 平均通道差異過高：${meanChannelDifference}`);
  assert.equal(before[mode].triangles, after[mode].triangles, `${mode} 三角形數`);
  assert.ok(after[mode].calls < before[mode].calls, `${mode} 實際繪製次數應降低`);
  assert.equal(after[mode].glError, 0);
  result[mode] = { before: before[mode], after: after[mode], meanChannelDifference, maxChannelDifference: max, strongPixelFraction };
}
assert.equal(after.full.calls, after.restored.calls, '切回近處的繪製次數還原');
writeFileSync(new URL('shots-f1-pixels.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
