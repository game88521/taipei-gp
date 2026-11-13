import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CIRCUITS } from '../shared/circuit-catalog.ts';
import { canonicalJson, sha256Hex, MULTIPLAYER_TRACK_RECIPE_VERSION } from '../shared/multiplayer-track-fingerprint.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const inputs = ['shared/multiplayer-track-recipe.ts', 'shared/multiplayer-track-fingerprint.ts', 'src/track.ts', 'src/car.ts'];
const recipeSources = Object.fromEntries(await Promise.all(inputs.map(async name => [name, hash(await readFile(path.join(root, name)))])));
const recipeHash = hash(canonicalJson({ version: MULTIPLAYER_TRACK_RECIPE_VERSION, performance: 'classic-unmodified', sources: recipeSources }));
const tracks = [];
for (const circuit of [null, ...CIRCUITS]) {
  const id = circuit?.id ?? 'taipei', source = circuit ? `public/data/circuits/${id}.json` : 'src/data/track.json';
  const bytes = await readFile(path.join(root, source)), data = JSON.parse(bytes);
  const dataSha256 = hash(canonicalJson(data)), metaSha256 = hash(canonicalJson(circuit));
  if (sha256Hex(canonicalJson(data)) !== dataSha256) throw Error(`Shared fingerprint differs from Node SHA256: ${id}`);
  const trackStamp = `track-v2:${hash(canonicalJson({ id, dataSha256, metaSha256, recipeHash }))}`;
  tracks.push({ id, name: circuit?.name ?? '台北信義街道賽', place: circuit?.place ?? '台灣 台北', flag: circuit?.flag ?? '🇹🇼', trackStamp, dataSha256, metaSha256, source, fileSha256: hash(bytes) });
}
if (tracks.length !== 24 || new Set(tracks.map(row => row.id)).size !== 24) throw Error('Expected Taipei plus exactly 23 unique GP maps.');
const catalog = { schemaVersion: 1, recipeVersion: MULTIPLAYER_TRACK_RECIPE_VERSION, recipeHash, recipeSources, catalogStamp: `catalog-v2:${hash(canonicalJson(tracks))}`, tracks };
const output = path.join(root, 'shared/multiplayer-catalog.json'), text = JSON.stringify(catalog, null, 2) + '\n';
let previous; try { previous = await readFile(output, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (text !== previous) await writeFile(output, text);
console.log(JSON.stringify({ maps: tracks.length, catalogStamp: catalog.catalogStamp, changed: previous !== text }));
