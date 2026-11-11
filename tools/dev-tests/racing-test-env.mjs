// 真正的物理／賽事來源，只隔離未受測的車模與畫布。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
export async function loadGameModules(root) {
  const context = vm.createContext({ console, URLSearchParams, location: { search: '' }, performance,
    setTimeout, clearTimeout, AbortController, DOMException, fetch, URL, TextDecoder, Response, Request, Headers });
  const modules = new Map();
  const synthetic = (id, values) => new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context, identifier: id });
  const teams = Array.from({ length: 11 }, (_, i) => ({ team: `team${i}`, livery: { main: '#ff0000' } }));
  async function module(id) {
    if (modules.has(id)) return modules.get(id);
    const loading = (async () => {
      if (id === 'three') return synthetic(id, THREE);
      if (id.includes('three/')) return synthetic(id, await import(id));
      if (id.endsWith('/f1model.ts')) return synthetic(id, { TEAMS: teams, makeF1: () => ({ root: new THREE.Group(), body: new THREE.Group(), steer: [], spin: [] }), setLod() {}, setTyre() {} });
      if (id.endsWith('/world.ts')) return synthetic(id, { canvasTex() { throw Error('測試不應建立畫面'); } });
      if (id.endsWith('.json')) return synthetic(id, { default: JSON.parse(await readFile(id, 'utf8')) });
      const source = await readFile(id, 'utf8');
      return new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: id }), { context, identifier: id });
    })();
    modules.set(id, loading); return loading;
  }
  const linker = async (specifier, referring) => {
    let next = specifier;
    if (specifier.startsWith('.')) { next = path.resolve(path.dirname(referring.identifier), specifier).replaceAll('\\', '/'); if (!path.extname(next)) next += '.ts'; }
    return module(next);
  };
  async function exports(file) {
    const m = await module(path.join(root, file).replaceAll('\\', '/'));
    if (m.status === 'unlinked') await m.link(linker);
    if (m.status !== 'evaluated') await m.evaluate();
    return m.namespace;
  }
  return { rivals: await exports('src/rivals.ts'), track: await exports('src/track.ts'), car: await exports('src/car.ts'), season: await exports('src/season.ts'), circuits: await exports('src/circuits.ts'), exports };
}
