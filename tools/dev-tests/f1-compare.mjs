import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const read = (label) => JSON.parse(readFileSync(new URL(`shots-f1-topology-${label}.json`, import.meta.url), 'utf8'));
const before = read('before'), after = read('after');
assert.equal(after.full.length, before.full.length);
for (const mode of ['full', 'far', 'restored']) {
  for (let i = 0; i < before[mode].length; i++) {
    const a = after[mode][i], b = before[mode][i];
    assert.equal(a.triangles, b.triangles, `${mode} 車隊 ${i} 三角形`);
    assert.equal(a.surfaceVertices, b.surfaceVertices, `${mode} 車隊 ${i} 頂點數`);
    assert.equal(a.surfaceHash, b.surfaceHash, `${mode} 車隊 ${i} 頂點／法線／顏色／PBR／LOD 歸屬`);
    assert.ok(a.meshes < b.meshes, `${mode} 車隊 ${i} 網格數減少`);
  }
}
assert.deepEqual(after.full, after.restored, '遠處切回近處後完整還原');
assert.ok(after.uniqueGeometryBytes < before.uniqueGeometryBytes, '共用 BufferAttribute 後，整隊實際保留的幾何資料應減少');
const result = { teams: after.full.length, full: { before: before.full[0], after: after.full[0] }, far: { before: before.far[0], after: after.far[0] }, uniqueGeometryBytes: { before: before.uniqueGeometryBytes, after: after.uniqueGeometryBytes }, surfaceDataIdentical: true, lodRestores: true };
writeFileSync(new URL('shots-f1-comparison.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
