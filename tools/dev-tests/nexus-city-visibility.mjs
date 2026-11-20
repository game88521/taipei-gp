// Exercise the real Traffic render/setter with real Three meshes; no renderer, city simulation or GPU.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as THREE from 'three';
import { parseAst } from 'rolldown/parseAst';

const root = new URL('../../', import.meta.url), sourceFile = new URL('src/traffic.ts', root);
const beforeFile = process.env.GP_NEXUS_BEFORE_TRAFFIC
  ? pathToFileURL(resolve(process.env.GP_NEXUS_BEFORE_TRAFFIC))
  : new URL('../../../taipei-gp-nexus-before-999a1a3aa5b7/src/traffic.ts', import.meta.url);
const sha = b => createHash('sha256').update(b).digest('hex');
const evidencePath = `tools/dev-tests/nexus-city-visibility-evidence-${Date.now()}`, evidence = new URL(evidencePath + '/', root);
await mkdir(evidence);
const script = new URL(import.meta.url), before = await readFile(beforeFile, 'utf8'), after = await readFile(sourceFile, 'utf8');
const report = {
  status: 'RUNNING', evidence: evidencePath, scriptSha256: sha(await readFile(script)),
  sourceHashes: { 'src/traffic.ts': sha(after) }, beforeSha256: sha(before), cases: [],
  limitations: ['使用真Traffic類別方法與真Three InstancedMesh；測試注入一台靜止車的繪圖資料，沒有建立完整城市或執行GPU。', 'before為不可變開發基準的真traffic.ts；可用GP_NEXUS_BEFORE_TRAFFIC指定該來源檔。'],
};
await writeFile(new URL('before-traffic.ts', evidence), before);
try { await writeFile(new URL('previous-result.json', evidence), await readFile(new URL('tools/dev-tests/nexus-city-visibility-result.json', root))); } catch (e) { if (e.code !== 'ENOENT') throw e; }

function loadTraffic(raw) {
  const code = stripTypeScriptTypes(raw, { mode: 'transform' }), ast = parseAst(code);
  const classNode = ast.body.map(n => n.type === 'ExportNamedDeclaration' ? n.declaration : n).find(n => n?.type === 'ClassDeclaration' && n.id?.name === 'Traffic');
  const lengths = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'KIND_LEN'));
  assert.ok(classNode && lengths, 'fixture必須載入真Traffic與真車長常數');
  const context = vm.createContext({ THREE });
  new vm.Script(`${code.slice(lengths.start, lengths.end)}\n${code.slice(classNode.start, classNode.end)}\nglobalThis.Traffic=Traffic;`).runInContext(context);
  return context.Traffic;
}
function fixture(Traffic) {
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial(), meshes = [];
  const mesh = capacity => { const m = new THREE.InstancedMesh(geometry, material, capacity); m.count = 0; meshes.push(m); return m; };
  const a = { alive: true, kind: 0, h: 0, vh: 0, kh: 0, e: { way: {}, ya: 0, yb: 0, len: 50 }, fall: 0, x: 10, z: 20, y: 0, kx: 0, kz: 0, color: new THREE.Color('#ffffff'), laneBlink: 0, laneSide: 0, blink: 0 };
  const traffic = Object.create(Traffic.prototype);
  Object.assign(traffic, { agents: [a], meshes: Array.from({ length: 5 }, () => ({ paint: mesh(1), fixed: mesh(1) })), blob: mesh(1), carLights: mesh(6), lightsOn: true, renderVisible: true, t: 0, rand: () => { throw Error('可見性不應消耗模擬亂數'); } });
  return { traffic, a, dispose() { for (const m of meshes) m.dispose(); geometry.dispose(); material.dispose(); } };
}
function visual(t) { return { bodies: t.meshes.every(m => m.paint.visible && m.fixed.visible), allBodiesHidden: t.meshes.every(m => !m.paint.visible && !m.fixed.visible), shadow: t.blob.visible, lights: t.carLights.visible, lightCount: t.carLights.count }; }
function check(name, fn) { try { const details = fn(); report.cases.push({ name, status: 'PASS', details }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: String(e.stack) }); throw e; } finally { console.log(JSON.stringify(report.cases.at(-1))); } }
let old, current;
try {
  old = fixture(loadTraffic(before)); current = fixture(loadTraffic(after));
  check('before重現隱藏車身後，夜間render仍把車燈顯示', () => {
    old.traffic.render(1 / 60); old.traffic.visible = false;
    const hidden = visual(old.traffic); old.traffic.render(1 / 60); const rendered = visual(old.traffic);
    assert.equal(hidden.allBodiesHidden, true); assert.equal(hidden.shadow, false); assert.equal(hidden.lights, true);
    assert.equal(rendered.lights, true); assert.ok(rendered.lightCount > 0);
    return { hidden, rendered, reproduced: true };
  });
  check('after夜間可見車輛具有四盞真實instance車燈', () => {
    current.traffic.render(1 / 60); const v = visual(current.traffic);
    assert.equal(v.bodies, true); assert.equal(v.shadow, true); assert.equal(v.lights, true); assert.equal(v.lightCount, 4); return v;
  });
  check('after切換隱藏立即移除車身、影子與車燈', () => {
    current.traffic.visible = false; const v = visual(current.traffic);
    assert.equal(v.allBodiesHidden, true); assert.equal(v.shadow, false); assert.equal(v.lights, false); assert.equal(v.lightCount, 4); return v;
  });
  check('after持續render仍保持整組隱藏，未改動模擬位置時間', () => {
    const initial = JSON.stringify({ a: current.a, t: current.traffic.t });
    for (let i = 0; i < 10; i++) current.traffic.render(1 / 60);
    const v = visual(current.traffic); assert.equal(v.allBodiesHidden, true); assert.equal(v.shadow, false); assert.equal(v.lights, false); assert.equal(v.lightCount, 4);
    assert.equal(JSON.stringify({ a: current.a, t: current.traffic.t }), initial); return { ...v, simulationStateUnchanged: true };
  });
  check('after恢復可見後夜間車燈與車身一起恢復', () => {
    current.traffic.visible = true; const v = visual(current.traffic);
    assert.equal(v.bodies, true); assert.equal(v.shadow, true); assert.equal(v.lights, true); assert.equal(v.lightCount, 4); return v;
  });
  check('after白天零盞車燈不會被visible切換顯示', () => {
    current.traffic.lightsOn = false; current.traffic.render(1 / 60); current.traffic.visible = false; current.traffic.visible = true;
    const v = visual(current.traffic); assert.equal(v.bodies, true); assert.equal(v.lights, false); assert.equal(v.lightCount, 0); return v;
  });
  report.status = 'PASS';
} catch (e) { report.status = 'FAIL'; report.error = String(e.stack); process.exitCode = 1; }
finally {
  old?.dispose(); current?.dispose(); report.cleanup = { status: 'PASS' };
  report.sourceUnchangedDuringTests = sha(await readFile(sourceFile)) === report.sourceHashes['src/traffic.ts'];
  report.scriptUnchangedDuringTests = sha(await readFile(script)) === report.scriptSha256;
  if (!report.sourceUnchangedDuringTests || !report.scriptUnchangedDuringTests) { report.status = 'FAIL'; process.exitCode = 1; }
  report.summary = { PASS: report.cases.filter(c => c.status === 'PASS').length, FAIL: report.cases.filter(c => c.status === 'FAIL').length };
  const bytes = JSON.stringify(report, null, 2) + '\n'; await writeFile(new URL('report.json', evidence), bytes); await writeFile(new URL('tools/dev-tests/nexus-city-visibility-result.json', root), bytes);
  console.log(JSON.stringify({ status: report.status, ...report.summary }));
}
