import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseAst } from 'rolldown/parseAst';
import { pureUrl } from './pure-module-loader.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const before = process.env.GP_ALL_BASELINE_DIR ?? resolve(root, '../taipei-gp-all-before-811385b20e05');
const cityModule = await import(await pureUrl(root, 'citydata.ts'));
const city = cityModule.decodeCity(JSON.parse(await readFile(resolve(root, 'public/data/city.json'), 'utf8')));
const { ROAD_Y } = await import(await pureUrl(root, 'surface.ts'));
const report = { before, root, cases: [], browserUsed: false, playerStorageTouched: false };
async function test(name, fn) { try { const detail = await fn(); report.cases.push({ name, status: 'PASS', detail }); } catch (e) { report.cases.push({ name, status: 'FAIL', error: String(e.stack).replace(/data:text\/javascript;base64,[\w+/=]+/g, '[module]').slice(0, 3000) }); } }
async function version(base) {
  const { Router } = await import(await pureUrl(base, 'router.ts')), mission = await import(await pureUrl(base, 'mission.ts'));
  const code = stripTypeScriptTypes(await readFile(resolve(base, 'src/main.ts'), 'utf8'), { mode: 'transform' });
  const node = parseAst(code).body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === 'updateNav');
  return { Router, router: new Router(city), mission, update: code.slice(node.start, node.end) };
}
const old = await version(before), current = await version(root), N = city.net.nodes, Y = city.net.y ?? [];
function exercise(v, sample, shift = 0, height = 0) {
  let calls = 0;
  const end = sample.route.path.at(-1), nav = { x: end[0], z: end[1], y: sample.route.ys.at(-1) + ROAD_Y, nm: sample.name, path: sample.route.path, ys: sample.route.ys, t: 0 };
  const ctx = vm.createContext({ nav, router: { route(...args) { calls++; return v.router.route(...args); } }, fcar: { x: sample.x + shift, z: sample.z, y: sample.y + height }, ROAD_Y,
    streetRacing: () => false, taxiOn: () => false, navArrows: { update() {} }, performance: { now: () => 0 }, ...v.mission,
    $: () => ({ style: {}, textContent: '' }), toast() {} });
  vm.runInContext(v.update, ctx);
  for (let i = 0; i < 40; i++) ctx.updateNav(0.25);
  return { calls, path: ctx.nav?.path, nav: ctx.nav };
}
const edges = [];
for (const w of city.net.ways.filter((w) => w.c <= 2)) for (let i = 1; i < w.n.length; i++) {
  const a = w.n[i-1], b = w.n[i], length = Math.hypot(N[a*2]-N[b*2], N[a*2+1]-N[b*2+1]);
  if (length > 120 && old.router.nearest(N[a*2],N[a*2+1],Y[a]??0)===a && old.router.nearest(N[b*2],N[b*2+1],Y[b]??0)===b) edges.push({ a,b,length,name:w.nm });
}
const samples=[];
for (const edge of edges.sort((a,b)=>b.length-a.length).slice(0,50)) {
  const {a,b}=edge, route=old.router.route(N[a*2],N[a*2+1],N[b*2],N[b*2+1],Y[a]??0,Y[b]??0);
  if (!route) continue;
  for (let i=1;i<route.path.length;i++) {
    const p=route.path[i-1],q=route.path[i],x=(p[0]+q[0])/2,z=(p[1]+q[1])/2;
    if (Math.min(...route.path.map((n)=>Math.hypot(n[0]-x,n[1]-z)))>25 && Math.hypot(x-route.path.at(-1)[0],z-route.path.at(-1)[1])>60) { samples.push({...edge,route,x,z,y:(route.ys[i-1]+route.ys[i])/2+ROAD_Y});break; }
  }
  if(samples.length===3)break;
}
assert.equal(samples.length,3);
await test('W 真城市三長路段：舊40/2/40重算，修後各只保留六秒定期重算',()=>samples.map((s)=>{
  const b=exercise(old,s),a=exercise(current,s); assert.ok(b.calls>=2);assert.equal(a.calls,1);assert.ok(a.path.length>=2);
  assert.ok(Math.hypot(a.path[0][0]-s.x,a.path[0][1]-s.z)<0.01);
  return {road:s.name,seconds:10,beforeCalls:b.calls,afterCalls:a.calls};
}));
await test('線段中點/尾端/空路線/橋上橋下距離',()=>{
  const f=current.mission.routeDeviation,p=[[0,0],[300,0]];
  assert.equal(f(p,150,0,[0,0],ROAD_Y),0);assert.equal(f(p,150,30,[0,0],ROAD_Y),30);
  assert.equal(f(p,330,0,[0,0],ROAD_Y),30);assert.equal(f(p,150,0,[0,0],8+ROAD_Y),Infinity);
  assert.equal(f([],0,0),Infinity);assert.equal(f([[0,0]],3,4,[0],ROAD_Y),5);
});
await test('偏離超過25m仍立即重算，六秒週期沒有被移除',()=>{
  assert.ok(exercise(current,samples[0],50,10).calls>=1);
});
await test('單行環路：同段順向走短路，逆向須繞行，起終點保留在線段上',()=>{
  const d={net:{nodes:[0,0,300,0,300,100,0,100],y:[0,0,0,0],ways:[{n:[0,1,2,3,0],c:1,o:1}]}};
  const r=new current.Router(d),forward=r.route(60,0,240,0,0,0),reverse=r.route(240,0,60,0,0,0);
  assert.ok(forward&&reverse);assert.ok(Math.abs(forward.length-180)<0.01);assert.ok(reverse.length>400);
  assert.deepEqual(reverse.path[0],[240,0]);assert.deepEqual(reverse.path.at(-1),[60,0]);
  return {forward:forward.length,reverse:reverse.length};
});
report.passed=report.cases.filter((c)=>c.status==='PASS').length; report.failed=report.cases.length-report.passed;
await writeFile(resolve(root,'tools/dev-tests/shots-all-navigation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
