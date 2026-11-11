// 比較 pit-geometry.mjs 的前後量測，確認省下三角形但沒有多畫或改待命姿勢。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const read = (label) => JSON.parse(readFileSync(new URL(`shots-pit-${label}.json`, import.meta.url), 'utf8'));
const before = read('before'), after = read('after');
assert.equal(before.rows.length, after.rows.length);
for (const old of before.rows) {
  const row = after.rows.find((r) => r.key === old.key);
  assert.ok(row, `缺少 ${old.key}`);
  assert.equal(row.instances, old.instances, `${old.key} 實例數`);
  assert.deepEqual(row.matrix, old.matrix, `${old.key} 待命姿勢矩陣`);
  assert.ok(row.finite, `${old.key} 幾何數值`);
  if (old.key !== 'bone') assert.deepEqual(row.bounds, old.bounds, `${old.key} 外框`);
}
assert.equal(after.rendered.calls, before.rendered.calls, '繪製次數不增加');
const saved = before.totalTriangles - after.totalTriangles;
assert.ok(saved > 0, '維修人員幾何確實減少');
assert.equal(before.rendered.triangles - after.rendered.triangles, saved, '實際繪製也省下同樣的三角形');
const result = { before: before.totalTriangles, after: after.totalTriangles, saved, reductionPercent: Number((saved / before.totalTriangles * 100).toFixed(2)), drawCalls: after.rendered.calls, idleMatricesUnchanged: true };
writeFileSync(new URL('shots-pit-comparison.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
