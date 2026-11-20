import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pureUrl } from './pure-module-loader.mjs';
import { voyagerModule } from './voyager-module-loader.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:' };
const { RoadDutyTraffic } = await voyagerModule(root, 'odyssey-city-road.ts');
const { FreeCar } = await import(await pureUrl(root, 'freecar.ts'));
const { Router } = await import(await pureUrl(root, 'router.ts'));
const { decodeCity } = await import(await pureUrl(root, 'citydata.ts'));
const { buildDutyPlan } = await import(await pureUrl(root, 'summit-city-duty.ts'));
const THREE = await import(new URL('../../node_modules/three/build/three.module.js', import.meta.url));
// Traffic's true geometry, agents and render method run; only the shadow canvas context is isolated.
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

const sha = b => createHash('sha256').update(b).digest('hex');
const report = { status: 'RUNNING', localOnly: true, cases: [], sourceHashes: {}, limitations: ['Node驗證真Traffic的instance數量、矩陣與釋放事件；未建立WebGL，不代替勤務UI瀏覽器整合測試或真人試駕。'] };
for (const file of ['src/odyssey-city-road.ts', 'src/summit-city-ui.ts', 'src/traffic.ts']) report.sourceHashes[file] = sha(await readFile(new URL('../../' + file, import.meta.url)));
async function check(name, fn) { try { report.cases.push({ name, status: 'PASS', details: await fn() }); } catch (error) { report.cases.push({ name, status: 'FAIL', error: String(error.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[真TS模組]').slice(0, 2500) }); } console.log(JSON.stringify(report.cases.at(-1))); }

const city = decodeCity(JSON.parse(await readFile(new URL('../../public/data/city.json', import.meta.url))));
const scene = new THREE.Scene(), duty = new RoadDutyTraffic(scene, city, null), car = new FreeCar();
const p = buildDutyPlan(new Router(city), 'bus', 'south').start;
car.place(p.x, p.z, p.h, p.y);
for (let n = 0; n < 20; n++) duty.step(.02, car);
const physicalState = () => ({ time: duty.traffic.t, car: [car.x, car.y, car.z, car.h, car.vx, car.vz, car.w], agents: duty.traffic.agents.map(a => [a.alive, a.x, a.y, a.z, a.h, a.v, a.kx, a.kz, a.kvx, a.kvz, a.kw]) });
const bodies = () => duty.traffic.meshes.reduce((n, m) => n + m.paint.count, 0);

await check('隱藏勤務不更新渲染矩陣；可見時8台真AI有車身與陰影', () => {
  assert.equal(duty.traffic.count, 8);
  assert.equal(bodies(), 0);
  const initialVersion = duty.traffic.meshes[0].paint.instanceMatrix.version;
  duty.frame(.02, false);
  assert.equal(duty.root.visible, false);
  assert.equal(bodies(), 0);
  assert.equal(duty.traffic.meshes[0].paint.instanceMatrix.version, initialVersion);
  const before = physicalState();
  duty.frame(.02, true);
  assert.equal(duty.root.visible, true);
  assert.equal(bodies(), duty.traffic.count);
  assert.equal(duty.traffic.blob.count, duty.traffic.count);
  assert.ok(duty.traffic.meshes.every(m => m.paint.count === m.fixed.count));
  assert.deepEqual(physicalState(), before, 'visual render must not advance physics or simulation clock');
  return { agents: duty.traffic.count, bodies: bodies(), shadows: duty.traffic.blob.count };
});

await check('可見frame同步最新位置；暫停隱藏不推進物理，恢復可見會刷新矩陣', () => {
  const agent = duty.traffic.agents.find(a => a.alive), mesh = duty.traffic.meshes[agent.kind].paint;
  const peers = duty.traffic.agents.filter(a => a.alive && a.kind === agent.kind), index = peers.indexOf(agent);
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const oldX = matrix.elements[12], oldVersion = mesh.instanceMatrix.version;
  agent.x += 7;
  const before = physicalState();
  duty.frame(.1, false);
  assert.equal(duty.root.visible, false);
  mesh.getMatrixAt(index, matrix);
  assert.equal(matrix.elements[12], oldX);
  assert.equal(mesh.instanceMatrix.version, oldVersion);
  for (let n = 0; n < 5; n++) duty.frame(.1, false);
  assert.deepEqual(physicalState(), before);
  duty.frame(.02, true);
  mesh.getMatrixAt(index, matrix);
  assert.ok(Math.abs(matrix.elements[12] - agent.x - agent.kx) < .001);
  assert.ok(mesh.instanceMatrix.version > oldVersion);
  assert.deepEqual(physicalState(), before);
});

await check('退出後scene與agents清空、共用geometry/material及instance各釋放一次，晚到frame無效', () => {
  const resources = new Set();
  duty.root.traverse(object => {
    if (object.isMesh) { resources.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material); }
    if (object.isInstancedMesh) resources.add(object);
  });
  const disposed = new Map();
  for (const resource of resources) { disposed.set(resource, 0); resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1)); }
  duty.dispose();
  duty.dispose();
  duty.frame(.02, true);
  assert.equal(scene.children.length, 0);
  assert.equal(duty.root.children.length, 0);
  assert.equal(duty.traffic.count, 0);
  assert.equal(duty.step(.02, car), 0);
  assert.ok([...disposed.values()].every(count => count === 1));
  return { releasedResources: resources.size };
});

report.summary = { PASS: report.cases.filter(c => c.status === 'PASS').length, FAIL: report.cases.filter(c => c.status === 'FAIL').length };
report.status = report.summary.FAIL ? 'FAIL' : 'PASS';
await writeFile(new URL('version-audit-city-traffic-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, ...report.summary }));
if (report.status !== 'PASS') process.exitCode = 1;
