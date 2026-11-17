// 真 Police.update/bumpCars/FreeCar；只隔離車模、畫布、路由與地形。
// node --experimental-vm-modules tools/dev-tests/next6-city-police.mjs [before]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as THREE from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = resolve(process.argv[2] ?? resolve(root, '../taipei-gp-next6-before-57b09b2'));
const report = { source: root, before, checks: [], browserUsed: false, playerStorageTouched: false,
  limitations: ['真碰撞/更新流程，固定接觸場景；不代表城市AI路線、WebGL、音質或手機實測。'] };
async function check(name, run) { try { await run(); report.checks.push({ name, pass: true }); } catch (e) { report.checks.push({ name, pass: false, error: String(e.stack ?? e) }); } }
async function load(base) {
  const context = vm.createContext({ console }), cache = new Map();
  async function module(id) {
    if (cache.has(id)) return cache.get(id);
    const values = id === 'three' ? THREE : id.endsWith('/citydata.ts') ? { groundH: () => 0 }
      : id.endsWith('/surface.ts') ? { ROAD_Y: -0.25 }
      : id.endsWith('/vehicles.ts') ? { buildPlayerVehicle() {}, vehicleById() {} } : null;
    const m = values ? new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context, identifier: id })
      : new vm.SourceTextModule(stripTypeScriptTypes(await readFile(id, 'utf8'), { mode: 'transform' }), { context, identifier: id });
    cache.set(id, m); return m;
  }
  const m = await module(resolve(base, 'src/police.ts').replaceAll('\\', '/'));
  await m.link((id, ref) => { if (!id.startsWith('.')) return module(id); let p = resolve(dirname(ref.identifier), id).replaceAll('\\', '/'); if (!extname(p)) p += '.ts'; return module(p); });
  await m.evaluate();
  return { ...m.namespace, FreeCar: (await module(resolve(base, 'src/freecar.ts').replaceAll('\\', '/'))).namespace.FreeCar };
}
const current = await load(root), old = await load(before);
const unit = (car) => ({ car, pv: { model: { root: { visible: true } } } });
function car(env, x = 0, z = 0, vx = 0, vz = 0, y = -0.25) {
  const p = new env.FreeCar(); p.place(x, z, 0); p.y = y; p.vx = vx; p.vz = vz; return p;
}
function police(env, extra = {}) {
  return Object.assign(Object.create(env.Police.prototype), { stars: 1, heat: 1, suspect: null, crashCool: 0, units: [], blocks: [], heli: { on: false },
    suspectHp: 100, arrestT: 0, escapeT: 0, lostT: 0, bustT: 0, spawnT: 1000, blockT: 1000,
    lastPursuitReason: null, pursuitT: 180, drive: () => 0, pickGoal: () => false, ...extra });
}
const physics = (p) => [p.x, p.z, p.vx, p.vz, p.w];
for (const kind of ['chaser', 'roadblock', 'suspect']) await check(`${kind}: 真接觸回傳玩家撞擊，與before物理/獎懲相同`, () => {
  const run = (env) => {
    const p = car(env, 0, 0, 0, 25), other = car(env, 0.3, 3.1, 0, 0), u = unit(other);
    other.update = () => 0;
    const extra = kind === 'chaser' ? { units: [u] } : kind === 'roadblock' ? { blocks: [{ cops: [u], bars: [], age: 0, x: 0, z: 0 }] }
      : { stars: 0, suspect: { ...u, goal: [1000, 1000] } };
    const manager = police(env, extra), event = manager.update(0.02, p, null, null, true);
    return { event, player: physics(p), other: physics(other), hp: manager.suspectHp };
  };
  const a = run(current), b = run(old);
  assert.ok(a.event.playerImpact > 4, `撞擊值 ${a.event.playerImpact}`); assert.equal(b.event.playerImpact, undefined);
  assert.deepEqual(a.player, b.player); assert.deepEqual(a.other, b.other); assert.equal(a.hp, b.hp);
  assert.equal(a.event.money, b.event.money); assert.equal(a.event.msg, b.event.msg);
});
await check('同一步多次接觸採最大值，不累加成多次扣款', () => {
  const p = car(current), contacts = [];
  p.contact = (...args) => { const impact = Math.abs(args[5]); contacts.push(impact); p.jx = p.jz = 0; return impact; };
  const a = car(current, 0.2, 3, 7), b = car(current, -0.2, -3, 12);
  const event = police(current, { units: [unit(a), unit(b)] }).update(0.02, p, null, null, true);
  assert.ok(contacts.length > 1); assert.equal(event.playerImpact, Math.max(...contacts)); assert.equal(event.playerImpact, 12);
});
await check('警車互撞/警車撞車流不算玩家撞擊', () => {
  const a = car(current, 0, 0, 0, 25), b = car(current, 0.3, 3.1), p = car(current, 100, 100);
  const event = police(current, { units: [unit(a), unit(b)] }).update(0.02, p, null, { signalAt: () => null, collidePlayer: () => 99 }, true);
  assert.equal(event.playerImpact, 0); assert.notEqual(a.vz, 25, '警車彼此真的發生接觸');
});
await check('橋上橋下及無接觸回傳0', () => {
  const p = car(current, 0, 0, 0, 25), other = car(current, 0.3, 3.1, 0, 0, 10);
  assert.equal(police(current, { units: [unit(other)] }).update(0.02, p, null, null, true).playerImpact, 0);
  assert.equal(police(current, { stars: 0 }).update(0.02, p, null, null, false).playerImpact, 0);
});
await check('清通緝/追緝路線中斷early return都回傳有限playerImpact', () => {
  const p = car(current);
  assert.equal(police(current).update(0.02, p, null, null, false).playerImpact, 0);
  const s = unit(car(current, 100, 100));
  const event = police(current, { stars: 0, suspect: s }).update(0.02, p, null, null, false);
  assert.equal(event.playerImpact, 0); assert.equal(event.money, 0); assert.match(event.msg, /路線中斷/);
});
report.passed = report.checks.filter((c) => c.pass).length; report.failed = report.checks.length - report.passed;
await writeFile(resolve(root, 'tools/dev-tests/next6-city-police.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
