// 離線讀取本輪 Chrome trace；不連線、不啟動場景，也不是功能通過證據。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const tracePath = process.argv[2];
if (!tracePath) throw new Error('請提供 browser-race-trace.json 路徑');
const trace = JSON.parse(await readFile(tracePath, 'utf8')), events = trace.traceEvents ?? trace;
const threads = new Map(), processes = new Map(), profiles = new Map();
const key = e => `${e.pid}:${e.tid}`;
for (const event of events) {
  if (event.ph === 'M' && event.name === 'thread_name') threads.set(key(event), event.args?.name);
  if (event.ph === 'M' && event.name === 'process_name') processes.set(event.pid, event.args?.name);
  if (event.name !== 'ProfileChunk') continue;
  const id = `${event.pid}:${event.id ?? event.id2?.local ?? event.tid}`, data = event.args?.data ?? {};
  let profile = profiles.get(id);
  if (!profile) { profile = { pid: event.pid, tid: event.tid, nodes: new Map(), samples: [] }; profiles.set(id, profile); }
  for (const node of data.cpuProfile?.nodes ?? []) profile.nodes.set(node.id, node);
  for (let i = 0; i < (data.cpuProfile?.samples?.length ?? 0); i++) profile.samples.push({ id: data.cpuProfile.samples[i], us: data.timeDeltas?.[i] ?? 0 });
}
const durationByThread = new Map(), complete = events.filter(e => e.ph === 'X' && e.dur >= 0);
for (const event of complete) {
  const id = key(event), group = durationByThread.get(id) ?? { pid: event.pid, tid: event.tid, thread: threads.get(id), process: processes.get(event.pid), events: 0, maxMs: 0 };
  group.events++; group.maxMs = Math.max(group.maxMs, event.dur / 1000); durationByThread.set(id, group);
}
const functions = [];
for (const profile of profiles.values()) {
  const tally = new Map();
  for (const sample of profile.samples) {
    const node = profile.nodes.get(sample.id), frame = node?.callFrame;
    if (!frame) continue;
    const name = `${frame.functionName || '(anonymous)'} ${frame.url || ''}:${frame.lineNumber ?? 0}:${frame.columnNumber ?? 0}`, prior = tally.get(name) ?? { function: name, samples: 0, totalMs: 0 };
    prior.samples++; prior.totalMs += sample.us / 1000; tally.set(name, prior);
  }
  functions.push({ pid: profile.pid, tid: profile.tid, thread: threads.get(`${profile.pid}:${profile.tid}`), sampledMs: profile.samples.reduce((sum, sample) => sum + sample.us / 1000, 0), functions: [...tally.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 30) });
}
const summary = {
  tracePath: path.resolve(tracePath), events: events.length,
  durationWarning: '巢狀事件時間不可相加為CPU占用；取樣時間亦包含idle/native等待，需對照thread與函式。',
  threads: [...durationByThread.values()].sort((a, b) => b.maxMs - a.maxMs),
  longest: complete.sort((a, b) => b.dur - a.dur).slice(0, 50).map(e => ({ pid: e.pid, tid: e.tid, thread: threads.get(key(e)), process: processes.get(e.pid), name: e.name, category: e.cat, ms: e.dur / 1000, at: e.ts, args: e.args })),
  profiles: functions,
};
const output = path.join(path.dirname(tracePath), 'browser-race-trace-summary.json');
await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ output, events: summary.events, threads: summary.threads.slice(0, 10), longest: summary.longest.slice(0, 12), profiles: summary.profiles.map(p => ({ ...p, functions: p.functions.slice(0, 12) })) }, null, 2));
