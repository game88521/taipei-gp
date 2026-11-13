// 獨立使用原 main.ts 配方與原 track.ts，避免新版 loader 和測試共用同一實作。
// node tools/dev-tests/multiplayer-maps-geometry.mjs --baseline <未修改的專案目錄>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { build } from 'vite';
import { RoomService } from '../../server/room-service.mjs';
import { MULTIPLAYER_TRACKS } from '../../server/physics.mjs';
import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../../shared/multiplayer-protocol.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argument = process.argv.indexOf('--baseline');
const baseline = resolve(argument >= 0 ? process.argv[argument + 1] : join(project, '../taipei-gp-maps-before-f41315a'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { startedAt: new Date().toISOString(), baseline, networkUsed: false, baselinePhysics: 'unmodified classic', cases: [] };
const evidence = await mkdtemp(join(project, 'tools/dev-tests/multiplayer-maps-geometry-evidence-'));
const resultPath = join(project, 'tools/dev-tests/multiplayer-maps-geometry-result.json');
async function check(name, exercise) {
  try {
    const details = await exercise(); report.cases.push({ name, status: 'PASS', details });
    console.log(JSON.stringify({ name, status: 'PASS', details }));
  } catch (error) {
    report.cases.push({ name, status: 'FAIL', error: String(error.message) });
    console.error(JSON.stringify({ name, status: 'FAIL', error: String(error.message) }));
  }
}

class MemorySocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  send() {}
  close() { this.readyState = 3; this.emit('close'); }
}
const service = new RoomService({ now: () => 1_000_000, maxRooms: 100 });
function createRoom(trackId) {
  const client = service.accept(new MemorySocket());
  service.receive(client, { type: 'create', name: '幾何測試', laps: 1, trackId,
    version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP });
  assert.ok(client.room, `實際 create 流程必須建立 ${trackId} 房間`);
  return client.room;
}
function compareTrack(actual, expected, label) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label} 欄位相同`);
  let numbers = 0, arrays = 0;
  for (const [key, reference] of Object.entries(expected)) {
    const value = actual[key];
    if (ArrayBuffer.isView(reference)) {
      arrays++;
      assert.equal(value.constructor.name, reference.constructor.name, `${label}.${key} 型別`);
      assert.equal(value.length, reference.length, `${label}.${key} 長度`);
      assert.equal(digest(Buffer.from(value.buffer, value.byteOffset, value.byteLength)),
        digest(Buffer.from(reference.buffer, reference.byteOffset, reference.byteLength)), `${label}.${key} 原配方位元組完全一致`);
      for (const item of value) { assert.ok(Number.isFinite(item), `${label}.${key} 只有有限數值`); numbers++; }
    } else { assert.equal(value, reference, `${label}.${key} 原配方相同`); assert.ok(Number.isFinite(value)); numbers++; }
  }
  return { numbers, arrays };
}

try {
  const baselineMain = await readFile(join(baseline, 'src/main.ts'), 'utf8');
  const baselineCircuits = await readFile(join(baseline, 'src/circuits.ts'), 'utf8');
  const circuitScript = stripTypeScriptTypes(baselineCircuits, { mode: 'transform' })
    .replace(/^import\s.+;\s*$/gm, '').replace(/^export\s+/gm, '');
  const originalMetadata = JSON.parse(JSON.stringify(vm.runInNewContext(`${circuitScript}\nCIRCUITS;`, {
    location: { search: '' }, URLSearchParams, fetchJsonWithRetry() { throw new Error('此測試不下載資料'); },
  })));
  await check('原有 23 個 GP metadata 與新版目錄完全一致，另保留台北', () => {
    assert.equal(originalMetadata.length, 23); assert.equal(MULTIPLAYER_TRACKS.length, 24);
    assert.equal(new Set(MULTIPLAYER_TRACKS.map(item => item.id)).size, 24);
    const current = MULTIPLAYER_TRACKS.filter(item => item.circuit);
    assert.deepEqual(current.map(item => JSON.parse(JSON.stringify(item.circuit))), originalMetadata);
    assert.equal(MULTIPLAYER_TRACKS[0].id, 'taipei'); assert.equal(MULTIPLAYER_TRACKS[0].circuit, null);
    return { originalGp: 23, currentGp: current.length, totalMaps: MULTIPLAYER_TRACKS.length };
  });
  await check('單人 main／Car／track／rivals／pitlane 原始位元組完全保留', async () => {
    const hashes = {};
    for (const name of ['main.ts', 'car.ts', 'track.ts', 'rivals.ts', 'pitlane.ts']) {
      const before = await readFile(join(baseline, 'src', name)), after = await readFile(join(project, 'src', name));
      assert.equal(digest(after), digest(before), `${name} 不得變更`);
      hashes[name] = digest(after);
    }
    return hashes;
  });
  const entry = join(evidence, 'baseline-entry.mjs');
  await writeFile(entry, `export { buildTrack, spreadLegs, VMAX } from ${JSON.stringify(join(baseline, 'src/track.ts').replaceAll('\\', '/'))};\n`);
  await build({ configFile: false, root: project, publicDir: false, logLevel: 'silent', build: {
    outDir: evidence, emptyOutDir: false, copyPublicDir: false, minify: false,
    lib: { entry, formats: ['es'], fileName: () => 'baseline-track.mjs' }, rollupOptions: { external: ['three'] },
  } });
  const original = await import(pathToFileURL(join(evidence, 'baseline-track.mjs')).href);
  assert.equal(original.VMAX, 84, '測試原版 track 使用 classic 性能，未呼叫 setRealPerf');
  const recipeStart = baselineMain.indexOf('const smooth = '), recipeEnd = baselineMain.indexOf('// 存檔裡的最快圈', recipeStart);
  assert.ok(recipeStart >= 0 && recipeEnd > recipeStart, '從原 main.ts 取得完整原配方');
  const recipeSource = baselineMain.slice(recipeStart, recipeEnd);
  const recipe = new vm.Script(`${stripTypeScriptTypes(recipeSource, { mode: 'transform' })}\ntrack;`);
  report.referenceRecipeSha256 = digest(recipeSource);
  report.referenceBundleSha256 = digest(await readFile(join(evidence, 'baseline-track.mjs')));
  for (const descriptor of MULTIPLAYER_TRACKS) await check(`原配方幾何與跨房隔離：${descriptor.id}`, async () => {
    const relative = descriptor.circuit ? `public/data/circuits/${descriptor.id}.json` : 'src/data/track.json';
    const before = await readFile(join(baseline, relative)), after = await readFile(join(project, relative));
    assert.equal(digest(after), digest(before), `${descriptor.id} 賽道輸入資料未改`);
    const metadata = originalMetadata.find(item => item.id === descriptor.id) ?? null;
    const data = descriptor.circuit ? JSON.parse(before) : null;
    const expected = recipe.runInNewContext({ buildTrack: original.buildTrack, spreadLegs: original.spreadLegs, circuitData: data, CIRCUIT: metadata }, { timeout: 30000 });
    const first = createRoom(descriptor.id), second = createRoom(descriptor.id);
    assert.equal(first.trackId, descriptor.id); assert.equal(first.trackStamp, descriptor.trackStamp);
    assert.ok(Object.isFrozen(first.track));
    const compared = compareTrack(first.track, expected, descriptor.id);
    compareTrack(second.track, expected, `${descriptor.id}/second`);
    for (const [key, value] of Object.entries(first.track)) if (ArrayBuffer.isView(value)) {
      assert.notEqual(value.buffer, second.track[key].buffer, `${descriptor.id}.${key} 不共享房間記憶體`);
      const originalValue = value[0]; value[0] += 123;
      assert.equal(second.track[key][0], originalValue, `${descriptor.id}.${key} 修改一房不影響另一房`);
    }
    const third = service.trackFor(descriptor.id).track;
    compareTrack(third, expected, `${descriptor.id}/cache`);
    return { N: expected.N, lengthM: expected.length, ...compared, actualRooms: 2, cachedTemplateIntact: true };
  });
} finally {
  service.close(); report.finishedAt = new Date().toISOString();
  report.pass = report.cases.length === 26 && report.cases.every(item => item.status === 'PASS');
  report.passed = report.cases.filter(item => item.status === 'PASS').length;
  report.failed = report.cases.filter(item => item.status === 'FAIL').length;
  await writeFile(resultPath, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ pass: report.pass, passed: report.passed, failed: report.failed, resultPath }));
if (!report.pass) process.exitCode = 1;
