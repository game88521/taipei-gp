import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const read = (label) => JSON.parse(readFileSync(new URL(`shots-quali-${label}.json`, import.meta.url), 'utf8'));
const before = read('before'), after = read('after');
assert.deepEqual(after.sync.times, before.sync.times, '21 位 AI 的正常圈速必須完全相同');
assert.deepEqual(after.asyncResult.times, after.sync.times, '分批計算不得改變物理結果');
assert.deepEqual(after.r26sync.times, before.r26sync.times, '2026 規則的正常圈速也必須相同');
assert.deepEqual(after.r26async.times, before.r26sync.times);
assert.ok(before.stalled.stalledTime > 149 && before.stalled.stalledTime < 151, '對照組要重現未完圈仍有成績');
assert.equal(after.stalled.stalledTime, null);
assert.equal(after.asyncStalled.stalledTime, null);
assert.deepEqual(after.asyncStalled.times.slice(1), before.stalled.times.slice(1), '一位超時不得改變後面車手的亂數與圈速');
for (const run of [after.sync, after.stalled, after.asyncResult, after.asyncStalled]) {
  assert.equal(run.draws, 21, '每位 AI 保留原有的一次亂數');
  assert.equal(run.solo, false);
}
assert.equal(before.sync.beats, 0);
assert.ok(after.asyncResult.beats > 0, '實際計算期間必須交還事件迴圈');
assert.ok(after.cancellation.reached > 0);
assert.equal(after.cancellation.rejected, true);
assert.equal(after.cancellation.released, true);
assert.equal(after.cancellation.restarted, true);
const result = { identicalNormalTimes: true, timeoutHasNoTime: true, randomSequencePreserved: true,
  before: { elapsed: before.sync.elapsed, maxGap: before.sync.maxGap, beats: before.sync.beats },
  after: { elapsed: after.asyncResult.elapsed, maxGap: after.asyncResult.maxGap, beats: after.asyncResult.beats }, cancellation: after.cancellation };
writeFileSync(new URL('shots-quali-comparison.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
