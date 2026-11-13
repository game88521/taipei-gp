// Real bundled multiplayer solver; deterministic collision invariants, no browser or external traffic.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Car, MULTIPLAYER_COLLISION_SHAPE, multiplayerCarsOverlap, resolveMultiplayerCollisions } from '../../server/physics.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '../..');
const report = { startedAt: new Date().toISOString(), noExternalRequests: true, realBundledSolver: true, cases: [] };
const approx = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
function track() {
  const N = 400, f = value => Float32Array.from({ length: N }, (_, i) => typeof value === 'function' ? value(i) : value);
  return { N, length: N, ds: 1, px: f(0), pz: f(i => i), tx: f(0), tz: f(1), dist: f(i => i),
    curv: f(0), vTarget: f(84), py: f(0), grade: f(0), bank: f(0), bankGrip: f(1), gap: f(100) };
}
function body(id, x, z, v = 40, h = 0) {
  const car = new Car(); car.x = x; car.z = z; car.v = v; car.h = h;
  car.pos = { i: Math.round(z), s: z, lat: -x };
  return { id, car };
}
const energy = cars => cars.reduce((sum, { car }) => sum + car.v ** 2, 0);
const state = cars => cars.map(({ id, car }) => ({ id, x: car.x, z: car.z, v: car.v, h: car.h, pos: { ...car.pos } }));
async function check(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
  console.log(JSON.stringify(report.cases.at(-1)));
}

await check('四車同s公平起跑留出實際間隙，不會立即碰撞或掉速', () => {
  const t = track(), cars = [-3, -1, 1, 3].map((x, i) => body(String(i), x, 100));
  const before = state(cars), contacts = resolveMultiplayerCollisions(t, cars);
  assert.equal(contacts.length, 0); assert.deepEqual(state(cars), before);
  for (let i = 0; i < cars.length - 1; i++) assert.equal(multiplayerCarsOverlap(t, cars[i].car, cars[i + 1].car), false);
  return { contactCount: contacts.length, physicalSideGap: 2 - MULTIPLAYER_COLLISION_SHAPE.halfWidth * 2 };
});
await check('追撞會阻止穿車並傳遞速度，總動能不會增加', () => {
  const t = track(), cars = [body('rear', 0, 100, 70), body('front', 0, 104.8, 20)], before = energy(cars);
  const contacts = resolveMultiplayerCollisions(t, cars);
  assert.equal(contacts.length, 1);
  assert.ok(cars[0].car.v < 70 && cars[1].car.v > 20);
  assert.ok(cars[1].car.z - cars[0].car.z >= 5.2);
  assert.ok(energy(cars) <= before + 1e-6);
  assert.ok(cars.every(({ car }) => car.v >= 0 && car.v <= 70));
  return { beforeEnergy: before, afterEnergy: energy(cars), speeds: cars.map(({ car }) => car.v) };
});
await check('側擦會推開車身，平行等速車不憑空掉速或加速', () => {
  const t = track(), cars = [body('a', 0, 100), body('b', 1.4, 100)];
  const midpoint = (cars[0].car.x + cars[1].car.x) / 2;
  assert.equal(resolveMultiplayerCollisions(t, cars).length, 1);
  assert.ok(Math.abs(cars[1].car.x - cars[0].car.x) >= 1.9);
  approx((cars[0].car.x + cars[1].car.x) / 2, midpoint);
  assert.ok(cars.every(({ car }) => car.v === 40));
  return { separation: Math.abs(cars[1].car.x - cars[0].car.x), speeds: cars.map(({ car }) => car.v) };
});
await check('已分離中的重疊車不會再次施加撞擊速度', () => {
  const t = track(), cars = [body('a', 0, 100, 20), body('b', 0, 105, 70)];
  const contacts = resolveMultiplayerCollisions(t, cars);
  assert.equal(contacts.length, 1); assert.equal(contacts[0].impact, 0);
  assert.deepEqual(cars.map(({ car }) => car.v), [20, 70]);
  return { speeds: [20, 70], impact: 0 };
});
await check('正面碰撞低回彈且不產生倒車或無限速度', () => {
  const t = track(), cars = [body('a', 0, 100, 60), body('b', 0, 104.8, 60, Math.PI)];
  assert.equal(resolveMultiplayerCollisions(t, cars).length, 1);
  assert.ok(cars.every(({ car }) => car.v >= 0 && car.v <= 3));
  assert.ok(cars[0].car.z < cars[1].car.z);
  return { speeds: cars.map(({ car }) => car.v) };
});
await check('高速對向穿越即使終點OBB不重疊，也會在首次接觸攔住', () => {
  const t = track(), a = body('a', 0, 103.4, 84), b = body('b', 0, 96.6, 84, Math.PI);
  a.previous = { x: 0, z: 95, h: 0 }; b.previous = { x: 0, z: 105, h: Math.PI };
  assert.equal(multiplayerCarsOverlap(t, a.car, b.car), false);
  const contacts = resolveMultiplayerCollisions(t, [a, b], .1);
  assert.equal(contacts.length, 1); assert.ok(a.car.z < b.car.z);
  assert.ok(b.car.z - a.car.z >= 5.2 - 1e-6);
  assert.ok(a.car.v === 0 && b.car.v === 0);
  return { positions: [a.car.z, b.car.z], stoppedBeforePassing: true };
});
await check('高速橫向穿越同樣攔截，不把長寬軸混淆', () => {
  const t = track(), a = body('a', 4.4, 100, 84, Math.PI / 2), b = body('b', -4.4, 100, 84, -Math.PI / 2);
  a.previous = { x: -4, z: 100, h: Math.PI / 2 }; b.previous = { x: 4, z: 100, h: -Math.PI / 2 };
  assert.equal(multiplayerCarsOverlap(t, a.car, b.car), false);
  assert.equal(resolveMultiplayerCollisions(t, [a, b], .1).length, 1);
  assert.ok(a.car.x < b.car.x); assert.ok(b.car.x - a.car.x >= 5.2 - 1e-6);
  return { positions: [a.car.x, b.car.x], stoppedBeforePassing: true };
});
await check('GP立體交叉同XZ但不同高度完全不碰撞', () => {
  const t = track(), cars = [body('lower', 0, 100), body('upper', 0, 100)];
  t.py.fill(10, 280, 321); cars[1].car.pos = { i: 300, s: 300, lat: 0 };
  const before = state(cars);
  assert.equal(multiplayerCarsOverlap(t, cars[0].car, cars[1].car, 1.5), false);
  assert.equal(resolveMultiplayerCollisions(t, cars).length, 0);
  assert.deepEqual(state(cars), before);
  return { heightDifference: 10, contactCount: 0 };
});
await check('傾斜路面高度參與碰撞層判定', () => {
  const t = track(), a = body('a', 0, 100), b = body('b', 1.4, 100); t.bank.fill(2);
  assert.equal(multiplayerCarsOverlap(t, a.car, b.car), false);
  assert.equal(resolveMultiplayerCollisions(t, [a, b]).length, 0);
  return { bankHeightDifference: 2.8 };
});
await check('貼牆側擦由有空間的車承擔推開，不把另一車推出護牆', () => {
  const t = track(), cars = [body('wall', 8.5, 100), body('inside', 7.1, 100)];
  assert.equal(resolveMultiplayerCollisions(t, cars).length, 1);
  for (const { car } of cars) assert.ok(Math.abs(car.pos.lat) <= 8.5 + 1e-6);
  assert.ok(Math.abs(cars[0].car.x - cars[1].car.x) >= 1.9 - 1e-6);
  approx(cars[0].car.x, 8.5);
  return { lateral: cars.map(({ car }) => car.pos.lat) };
});
await check('四車完全重疊可有限次解開，結果不依傳入順序', () => {
  const t = track(), first = [0, 1, 2, 3].map(i => body(String(i), 0, 100, 0));
  const second = first.map(row => structuredClone(row)).reverse();
  resolveMultiplayerCollisions(t, first); resolveMultiplayerCollisions(t, second);
  assert.deepEqual(state(first), state(second.reverse()));
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j < first.length; j++) assert.ok(Math.abs(first[i].car.x - first[j].car.x) >= 1.898);
    assert.ok(Math.abs(first[i].car.pos.lat) <= 8.5 && Number.isFinite(first[i].car.pos.s));
  }
  return { positions: first.map(({ car }) => car.x), deterministic: true };
});
await check('推開後賽道位置與最後座標一致，可供權威計圈使用', () => {
  const t = track(), cars = [body('a', 0, 100, 50), body('b', 0, 104.7, 10)];
  resolveMultiplayerCollisions(t, cars);
  for (const { car } of cars) { approx(car.pos.s, car.z); approx(car.pos.lat, -car.x); }
  return { positions: cars.map(({ car }) => ({ z: car.z, s: car.pos.s })) };
});
await check('接近查詢不改變車狀態，margin讓前端可提早接受權威校正', () => {
  const t = track(), a = body('a', 0, 100), b = body('b', 2.5, 100), before = state([a, b]);
  assert.equal(multiplayerCarsOverlap(t, a.car, b.car), false);
  assert.equal(multiplayerCarsOverlap(t, a.car, b.car, .5), true);
  assert.deepEqual(state([a, b]), before);
  return { clearWithoutMargin: true, proximityWithMargin: true, mutated: false };
});
await check('斜向撞擊不增加總動能或超過當下最快車速', () => {
  const t = track();
  for (let n = 0; n < 24; n++) {
    const cars = [body('a', 0, 100, 20 + n * 2, n / 24 * Math.PI * 2), body('b', 1, 101, 70 - n, -n / 24 * Math.PI)];
    const before = energy(cars), speedLimit = Math.max(...cars.map(({ car }) => car.v));
    resolveMultiplayerCollisions(t, cars);
    assert.ok(energy(cars) <= before + 1e-6);
    assert.ok(cars.every(({ car }) => Number.isFinite(car.v) && car.v >= 0 && car.v <= speedLimit));
  }
  return { directionPairs: 24, increasedEnergy: false };
});

report.finishedAt = new Date().toISOString();
report.summary = { passed: report.cases.filter(row => row.status === 'PASS').length, failed: report.cases.filter(row => row.status === 'FAIL').length };
report.sourceHashes = Object.fromEntries(await Promise.all(['shared/multiplayer-collisions.ts', 'server/physics-entry.ts', 'server/physics.mjs'].map(async file => [file, createHash('sha256').update(await readFile(path.join(project, file))).digest('hex')])));
await writeFile(path.join(directory, 'multiplayer-collision-physics-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary: report.summary }));
if (report.summary.failed) process.exitCode = 1;
