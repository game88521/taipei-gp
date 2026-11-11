// 靜態 DOM 接線與可點尺寸約束；不取代瀏覽器排版／實機驗證。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? process.env.GP_BASELINE_DIR ?? resolve(root, '../taipei-gp-priority-before-20261111'));
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const oldHTML = await readFile(resolve(before, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'src/style.css'), 'utf8');
const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]);
const oldIDs = [...oldHTML.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, '所有靜態 ID 必須唯一');
for (const id of oldIDs) assert.ok(ids.includes(id), `既有 DOM 接線不能消失：${id}`);

const nodes = new Map(), stack = [];
const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
for (const token of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
  const [raw, tagName] = token;
  if (!tagName) continue;
  const tag = tagName.toLowerCase();
  if (raw.startsWith('</')) {
    const index = stack.findLastIndex((node) => node.tag === tag);
    assert.notEqual(index, -1, `結束標籤需有起始：${tag}`);
    stack.length = index;
    continue;
  }
  const attrs = Object.fromEntries([...raw.matchAll(/\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [m[1], m[2] ?? m[3] ?? m[4] ?? '']));
  const node = { tag, attrs, parent: stack.at(-1) };
  if (attrs.id) nodes.set(attrs.id, node);
  if (!voids.has(tag) && !raw.endsWith('/>')) stack.push(node);
}
const ancestor = (id, wanted) => { let node = nodes.get(id)?.parent; while (node) { if (node.attrs.id === wanted) return true; node = node.parent; } return false; };
const expected = {
  'gp-settling': 'div', 'gp-settle-progress': 'p', 'gp-settle-retry': 'button', 'gp-settle-exit': 'button',
  'season-abandon': 'button', 'paint-preview-note': 'p', 'paint-apply': 'button', 'paint-cancel': 'button', 'bk-undo': 'button',
  'legacy-record-note': 'p', 'taxi-last-trip': 'p', 'taxi-title': 'span', 'taxi-distance': 'span', 'taxi-time': 'span', 'taxi-wallet': 'span', 'taxi-details': 'details', 'taxi-trip-text': 'p',
  'btn-drift-practice': 'button', 'drift-coach': 'details', 'coach-status': 'p', 'coach-exit': 'button', 'sr-offer-route': 'div',
  'economy-history': 'details', 'economy-summary': 'div', 'economy-list': 'ol',
};
for (const [id, tag] of Object.entries(expected)) assert.equal(nodes.get(id)?.tag, tag, `${id} 元素型別`);
assert.match(nodes.get('gp-settling').attrs.class, /\boverlay\b/);
assert.match(nodes.get('gp-settling').attrs.class, /\bhidden\b/);
assert.equal(nodes.get('gp-settle-progress').attrs['aria-live'], 'polite');
assert.ok('hidden' in nodes.get('gp-settle-retry').attrs);
assert.ok('hidden' in nodes.get('season-abandon').attrs);
assert.match(nodes.get('taxi-hud').attrs.class, /\bhidden\b/);
assert.ok(!('open' in nodes.get('taxi-details').attrs), '行程明細預設收合');
for (const id of ['taxi-title', 'taxi-distance', 'taxi-time', 'taxi-wallet', 'taxi-details', 'taxi-trip-text']) assert.ok(ancestor(id, 'taxi-hud'), id);
assert.ok(ancestor('taxi-trip-text', 'taxi-details'));
assert.ok(ancestor('coach-status', 'drift-coach')); assert.ok(ancestor('coach-exit', 'drift-coach')); assert.ok(ancestor('drift-coach', 'top-stack'));
assert.ok(ancestor('sr-offer-route', 'sr-offer')); assert.ok(ancestor('economy-summary', 'economy-history')); assert.ok(ancestor('economy-list', 'economy-history'));
assert.ok(ancestor('season-abandon', 'season-page'));
for (const id of ['gp-settle-progress', 'gp-settle-retry', 'gp-settle-exit']) assert.ok(ancestor(id, 'gp-settling'));
for (const id of ['paint-preview-note', 'paint-apply', 'paint-cancel']) assert.ok(ancestor(id, 'car-pick'));
assert.ok(html.indexOf('id="legacy-record-note"') < html.indexOf('class="m-backup"'));
assert.ok(html.indexOf('id="taxi-last-trip"') < html.indexOf('class="m-backup"'));
assert.match(html, /休閒榜：軌跡合理性檢查，非權威防作弊/);
assert.match(html, /同分時依冠軍、亞軍、季軍等名次次數排序/);

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), declarations: m[2] }));
const targetButtons = ['paint-apply', 'paint-cancel', 'bk-undo', 'season-abandon', 'gp-settle-retry', 'gp-settle-exit'];
for (const id of targetButtons) {
  assert.equal(nodes.get(id).attrs.type, 'button');
  assert.ok(rules.some((rule) => rule.selector.split(',').some((s) => s.trim() === `#${id}`) && /min-height:\s*44px/.test(rule.declarations) && /min-width:\s*44px/.test(rule.declarations)), `${id} 應宣告至少44px可點目標`);
}
assert.ok(rules.some((r) => r.selector === '#taxi-details summary' && /min-height:\s*44px/.test(r.declarations) && /min-width:\s*44px/.test(r.declarations)));
assert.ok(rules.some((r) => r.selector === '#menu .m-backup button' && /min-height:\s*44px/.test(r.declarations) && /min-width:\s*44px/.test(r.declarations)), '全部備份入口應至少44px可點');
assert.ok(rules.some((r) => r.selector === '#taxi-trip-text' && /max-height:/.test(r.declarations) && /overflow-y:\s*auto/.test(r.declarations) && /touch-action:\s*pan-y/.test(r.declarations)));
assert.ok(rules.some((r) => r.selector.includes('#paint-preview-note') && /overflow-wrap:\s*anywhere/.test(r.declarations)));
const result = { status: 'PASS', uniqueStaticIDs: ids.length, originalIDsPreserved: oldIDs.length, newHookIDsChecked: Object.keys(expected).length, buttonsWith44pxCSS: targetButtons, taxiSummary44pxCSS: true, taxiDetailsInitiallyClosed: true, taxiDetailsScrollsWhenExpanded: true, browserLayoutMeasured: false };
await writeFile(resolve(root, 'tools/dev-tests/shots-static-ui-contract.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
