// 真 city.json／StreetRace 的 8 條路線與真 main SVG／提示；不建立 WebGL。
// node --experimental-vm-modules tools/dev-tests/route-preview-audit.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import * as THREE from 'three';
import { loadGameModules } from './racing-test-env.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clone = (x) => JSON.parse(JSON.stringify(x));
const env = await loadGameModules(project);
const { routeBends, routePreview } = await env.exports('src/route-preview.ts');
const { decodeCity } = await env.exports('src/citydata.ts');
const { StreetRace } = await env.exports('src/streetrace.ts');
const report = { sourceHashes: {}, checks: [], routes: [], boundaries: {}, limitations: ['真路線規劃與幾何，車模／屋頂畫布隔離', '沒有瀏覽器繪製、WebGL、道路碰撞或駕駛難度實測'] };
for (const name of ['route-preview.ts', 'streetrace.ts', 'decor.ts', 'main.ts']) {
  report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(project, 'src', name))).digest('hex');
}
async function check(label, action) { await action(); report.checks.push(label); }
function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out.at(-1) + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return out;
}
function declarations(raw, names) {
  const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code), selected = [];
  for (let node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') node = node.declaration;
    if (!node) continue;
    if (node.type === 'FunctionDeclaration' && names.includes(node.id?.name)) selected.push(code.slice(node.start, node.end));
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) {
      if (d.id.type === 'Identifier' && names.includes(d.id.name)) selected.push(`var ${d.id.name} = ${code.slice(d.init.start, d.init.end)};`);
    }
  }
  assert.equal(selected.length, names.length, `找不到真來源 ${names.join(',')}`);
  return selected.join('\n');
}
function svgNode(tag) {
  return { tag, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(n) { this.children.push(n); } };
}
const city = decodeCity(JSON.parse(await readFile(path.join(project, 'public/data/city.json'), 'utf8')));
// 真 buildLandmarks 回傳的清單；只跳過屋頂招牌畫布／mesh 的生成。
const landmarkCtx = vm.createContext({ THREE, d: city, scene: new THREE.Scene(),
  textAtlas: () => ({ mats: [], slots: [] }), addBoard() {}, flush() {} });
vm.runInContext(declarations(await readFile(path.join(project, 'src/decor.ts'), 'utf8'), ['NOT_LANDMARK', 'LANDMARK_HINT', 'buildLandmarks']), landmarkCtx);
const landmarks = vm.runInContext('buildLandmarks(scene, d)', landmarkCtx);
const street = new StreetRace(new THREE.Scene(), city, landmarks);
let bendCalls = 0;
const mainCtx = vm.createContext({ document: { createElementNS: (_ns, tag) => svgNode(tag) }, routePreview,
  routeBends(...args) { bendCalls++; return routeBends(...args); } });
vm.runInContext(declarations(await readFile(path.join(project, 'src/main.ts'), 'utf8'), ['routeBendCache', 'bendsOf', 'routeHint', 'streetRouteSvg']), mainCtx);

await check('純直線／單點／重複點不產生急彎或NaN；空路線預覽中心點', () => {
  assert.deepEqual(clone(routePreview([])), { points: '', start: [80, 40], end: [80, 40] });
  for (const points of [[], [[5, 9]], [[0, 0], [100, 0]], [[0, 0], [0, 0], [50, 0], [50, 0]]]) {
    assert.equal(routeBends(points, cumulative(points)).length, 0);
    assert.equal(/NaN|Infinity/.test(routePreview(points).points), false);
  }
});
await check('90度彎正確標急彎；180度折返標hairpin，位置與累積距離一致', () => {
  const right = [[0, 0], [100, 0], [100, 100]], back = [[0, 0], [100, 0], [0, 0]];
  assert.deepEqual(clone(routeBends(right, cumulative(right))), [{ at: 100, angle: 90, hairpin: false }]);
  assert.deepEqual(clone(routeBends(back, cumulative(back))), [{ at: 100, angle: 180, hairpin: true }]);
});
await check('40m內相鄰彎合併；分離彎保留兩處；小於50度不提醒', () => {
  const near = [[0, 0], [100, 0], [100, 20], [200, 20]], far = [[0, 0], [100, 0], [100, 100], [200, 100]];
  assert.equal(routeBends(near, cumulative(near)).length, 1);
  assert.equal(routeBends(far, cumulative(far)).length, 2);
  const mild = [[0, 0], [100, 0], [200, 40]]; assert.equal(routeBends(mild, cumulative(mild)).length, 0);
});
await check('真實8條路線均產生合法預覽／急彎距離，資料與物理路線不變', () => {
  assert.equal(street.challenges.length, 8);
  for (const c of street.challenges) {
    const original = clone({ path: c.path, cum: c.cum, vmax: c.vmax, checkpoints: c.checkpoints });
    const preview = routePreview(c.path), bends = routeBends(c.path, c.cum);
    const points = preview.points.split(' ').map((p) => p.split(',').map(Number));
    assert.equal(points.length, c.path.length);
    for (const [x, z] of points) { assert.ok(Number.isFinite(x) && x >= 10 && x <= 150); assert.ok(Number.isFinite(z) && z >= 8 && z <= 72); }
    for (const [i, pair] of [[0, preview.start], [points.length - 1, preview.end]]) {
      assert.ok(Math.abs(points[i][0] - pair[0]) <= 0.051); assert.ok(Math.abs(points[i][1] - pair[1]) <= 0.051);
    }
    for (const b of bends) {
      assert.ok(b.at > 0 && b.at < c.length); assert.ok(b.angle >= 50 && b.angle <= 180); assert.equal(b.hairpin, b.angle >= 130);
    }
    assert.deepEqual(clone({ path: c.path, cum: c.cum, vmax: c.vmax, checkpoints: c.checkpoints }), original);
    report.routes.push({ id: c.def.id, title: c.def.title, length: c.length, points: c.path.length, bends: clone(bends), maximumAngle: Math.max(0, ...bends.map((b) => b.angle)) });
  }
});
await check('信義大環線約1015m、世貿到新光三越約945m均如實標示180度折返', () => {
  for (const [id, at] of [['xinyi-loop', 1015], ['ticc-a8', 945]]) {
    const route = report.routes.find((c) => c.id === id), back = route.bends.filter((b) => b.hairpin);
    assert.ok(back.some((b) => Math.abs(b.at - at) < 1 && b.angle > 170));
  }
});
await check('真main路線SVG含無障礙說明、起終點；急彎快取重複使用不重算', () => {
  for (const c of street.challenges) {
    mainCtx.c = c; const before = bendCalls;
    const svg = vm.runInContext('streetRouteSvg(c)', mainCtx), hint = vm.runInContext('routeHint(c)', mainCtx);
    assert.equal(bendCalls, before + 1); assert.equal(svg.tag, 'svg'); assert.equal(svg.attrs.viewBox, '0 0 160 80'); assert.equal(svg.attrs.role, 'img');
    assert.equal(svg.attrs['aria-label'], `${c.def.title} 路線預覽，${hint}`);
    assert.equal(svg.children.length, 3); assert.equal(svg.children[0].tag, 'polyline');
    assert.equal(svg.children[0].attrs.points, routePreview(c.path).points);
    assert.equal(svg.children[1].attrs.fill, '#4dff9a'); assert.equal(svg.children[2].attrs.fill, '#ff6b6b');
    assert.match(hint, /綠點起跑、紅點終點/);
    if (c.def.id === 'xinyi-loop') assert.match(hint, /折返/);
  }
});
await check('200000點容量邊界：不因Math.min展開呼叫造成stack overflow', () => {
  const large = Array.from({ length: 200000 }, (_, i) => [i, i % 2]);
  const preview = routePreview(large);
  assert.equal(/NaN|Infinity/.test(preview.points), false); assert.equal(preview.points.split(' ').length, large.length);
  report.boundaries.largePath = { points: large.length, result: 'ok', outputLength: preview.points.length };
});
report.ok = true;
await writeFile(path.join(project, 'tools/dev-tests/route-preview-audit-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
