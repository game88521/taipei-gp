// 在 Node 中載入真 TypeScript 純模組；只改寫 import 路徑，不替換受測邏輯。
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { dirname, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const cache = new Map();
export const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
export async function pureSource(base, name) {
  const file = resolve(base, 'src', name);
  let code = stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'transform' });
  const specs = [...code.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)].map((m) => m[2]);
  const mappings = new Map();
  for (const spec of new Set(specs)) {
    if (spec.startsWith('.')) {
      const dependency = resolve(dirname(file), extname(spec) ? spec : `${spec}.ts`);
      mappings.set(spec, await pureUrl(base, dependency));
    } else if (!spec.startsWith('node:')) mappings.set(spec, pathToFileURL(createRequire(resolve(base, 'package.json')).resolve(spec)).href);
  }
  return code.replace(/\bfrom\s+(['"])([^'"]+)\1/g, (all, q, spec) => mappings.has(spec) ? `from ${q}${mappings.get(spec)}${q}` : all);
}
export async function pureUrl(base, name) {
  const key = resolve(base, 'src', name);
  if (!cache.has(key)) cache.set(key, pureSource(base, key).then(moduleUrl));
  return cache.get(key);
}
