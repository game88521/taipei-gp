// 區網 HTTP 沒有 crypto.randomUUID 的來源級測試，不改瀏覽器或系統設定。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { SourceTextModule, createContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { UUID } from '../../shared/lap-proof.js';
const source = stripTypeScriptTypes(readFileSync('src/identity.ts', 'utf8'), { mode: 'transform' });
let nativeCalls = 0, fallbackCalls = 0;
const nativeId = '11111111-2222-4333-8444-555555555555';
async function run(crypto) {
  const context = createContext({ crypto, Math: { random() { throw new Error('不得影響模擬亂數'); } } });
  const module = new SourceTextModule(source, { context }); await module.link(() => {}); await module.evaluate();
  return module.namespace.randomUuid();
}
assert.equal(await run({ randomUUID() { nativeCalls++; return nativeId; }, getRandomValues() { throw new Error('native 可用時不得 fallback'); } }), nativeId);
const fallbackId = await run({ getRandomValues(bytes) { fallbackCalls++; bytes.fill(255); return bytes; } });
assert.equal(fallbackId, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
assert.equal(UUID.test(fallbackId), true); assert.equal(UUID.test(nativeId), true);
assert.equal(UUID.test('11111111-2222-1333-8444-555555555555'), false);
assert.equal(UUID.test('11111111-2222-4333-4444-555555555555'), false);
assert.equal(UUID.test('-'.repeat(36)), false);
assert.equal(nativeCalls, 1); assert.equal(fallbackCalls, 1);
const saveSource = readFileSync('src/save.ts', 'utf8');
assert.ok(saveSource.includes('4[a-f0-9]{3}-[89ab]'), 'save 必須同樣限定 v4 與 RFC variant');
const result = { passed: 6, nativeCalls, fallbackCalls, nativeId, fallbackId,
  cases: ['native UUID path', 'getRandomValues fallback without Math.random', 'v4/variant bits match API', 'reject other UUID versions', 'reject wrong variant', 'reject malformed imported identity'],
  limitations: 'VM fake crypto 驗證分支與格式，不是實際手機瀏覽器測試。' };
writeFileSync('tools/dev-tests/shots-identity-regression.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
