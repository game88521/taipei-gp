import { readFile, writeFile } from 'node:fs/promises';
import { pureUrl } from './pure-module-loader.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { decodeCity } = await import(await pureUrl(root, 'citydata.ts'));
const { Router } = await import(await pureUrl(root, 'router.ts'));
const { buildDutyPlan } = await import(await pureUrl(root, 'summit-city-duty.ts'));
const city = decodeCity(JSON.parse(await readFile(new URL('../../public/data/city.json', import.meta.url))));
const router = new Router(city);
const report = {};
for (const kind of ['bus', 'rescue']) { const plan = buildDutyPlan(router, kind); report[kind] = plan && { length: plan.length, estimatedSeconds: plan.estimatedSeconds, legs: plan.legs.map(l => ({ name: l.target.name, length: l.length, target: l.target })) }; }
await writeFile(new URL('summit-city-inspect-result.json', import.meta.url), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
