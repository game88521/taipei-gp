// 不需要 WebGL 的實際車模幾何量測；canvas 只提供貼圖繪製介面，不能當畫面驗證。
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [label = 'check'] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('無效的輸出名稱');
const gradient = () => ({ addColorStop() {} });
const context = new Proxy({ createLinearGradient: gradient, createRadialGradient: gradient }, {
  get: (obj, key) => obj[key] ?? (() => {}), set: (obj, key, value) => { obj[key] = value; return true; },
});
globalThis.location = { search: '' };
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
const { makeF1, setLod, TEAMS } = await import(`./shots-f1-model-${label}.mjs`);
const models = TEAMS.map(({ livery }) => makeF1(livery));
const count = (model) => {
  let meshes = 0, triangles = 0, bytes = 0;
  const surfaces = [];
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh) {
      meshes++; const g = o.geometry;
      triangles += (g.index?.count ?? g.attributes.position.count) / 3;
      bytes += Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0);
      const mat = o.material;
      // 合併範圍只有沒有彩色貼圖的 Standard 材質；逐頂點核對位置、法線、線性色與 PBR 參數。
      if (o.parent === model.body && mat.isMeshStandardMaterial && !mat.map) {
        const pos = g.attributes.position, normal = g.attributes.normal, color = g.attributes.color, uv = g.attributes.uv;
        const map = mat.roughnessMap?.image;
        for (let i = 0; i < pos.count; i++) {
          const texel = map ? Math.min(map.width - 1, Math.floor(uv.getX(i) * map.width)) * 4 : 0;
          const c = color ? [color.getX(i), color.getY(i), color.getZ(i)] : [1, 1, 1];
          const row = [pos.getX(i), pos.getY(i), pos.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i),
            c[0] * mat.color.r, c[1] * mat.color.g, c[2] * mat.color.b,
            mat.roughness * (map ? map.data[texel + 1] : 1), mat.metalness * (map ? map.data[texel + 2] : 1)];
          surfaces.push(`${model.root.userData.fine.includes(o) ? 'fine' : 'coarse'}:${row.map(Math.fround).join(',')}`);
        }
      }
    }
    o.children.forEach(walk);
  };
  walk(model.root); return { meshes, triangles, bytes, surfaceHash: createHash('sha256').update(surfaces.sort().join('\n')).digest('hex'), surfaceVertices: surfaces.length };
};
const full = models.map(count);
const buffers = new Set();
models.forEach((m) => m.root.traverse((o) => {
  if (!o.isMesh) return;
  Object.values(o.geometry.attributes).forEach((a) => buffers.add(a.array.buffer));
  if (o.geometry.index) buffers.add(o.geometry.index.array.buffer);
}));
const uniqueGeometryBytes = [...buffers].reduce((n, b) => n + b.byteLength, 0);
models.forEach((m) => setLod(m, true)); const far = models.map(count);
models.forEach((m) => setLod(m, false)); const restored = models.map(count);
const result = { label, full, far, restored, uniqueGeometryBytes };
writeFileSync(new URL(`shots-f1-topology-${label}.json`, import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
