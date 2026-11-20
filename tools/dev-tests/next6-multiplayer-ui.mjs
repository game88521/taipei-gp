// 執行真renderUi／keyed列表；隔離DOM可精確計數元素建立，非手機FPS量測。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { getMultiplayerTrack, MULTIPLAYER_TRACKS } from '../../shared/multiplayer-tracks.ts';
import { DEFAULT_ROOM_RULES, roomRulesText } from '../../shared/multiplayer-room-rules.ts';
import { MultiplayerHistory } from '../../src/multiplayer-history.ts';
import { defaultControls, controlCodeLabel } from '../../src/input.ts';
import { SUMMIT_TYRES } from '../../shared/summit-racing.ts';
import {voyagerForecast} from '../../shared/voyager-racing.ts';
import { ATLAS_AI_LEVELS, atlasPitMs } from '../../shared/atlas-racing.ts';
import { odysseyStopWindow } from '../../shared/odyssey-racing.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const before = path.resolve(project, '../taipei-gp-next6-before-57b09b2');
const currentSource = await readFile(path.join(project, 'src/multiplayer-game.ts'), 'utf8');
const beforeSource = await readFile(path.join(before, 'src/multiplayer-game.ts'), 'utf8');
const uiSource = await readFile(path.join(project, 'src/multiplayer-ui.ts'), 'utf8');
const inviteSource = await readFile(path.join(project, 'src/multiplayer-invite.ts'), 'utf8');
const entrySource = await readFile(path.join(project, 'src/multiplayer-entry.ts'), 'utf8');
const seriesUiSource = await readFile(path.join(project, 'src/multiplayer-series-ui.ts'), 'utf8');
const spectatorSource = await readFile(path.join(project, 'src/multiplayer-spectator.ts'), 'utf8');
const historyUiSource = await readFile(path.join(project, 'src/multiplayer-history-ui.ts'), 'utf8');
const evolutionUiSource = await readFile(path.join(project, 'src/multiplayer-evolution-ui.ts'), 'utf8');
const arenaUiSource = await readFile(path.join(project, 'src/multiplayer-arena-ui.ts'), 'utf8');
const summitUiSource = await readFile(path.join(project, 'src/summit-racing-ui.ts'), 'utf8');
const voyagerUiSource=await readFile(path.join(project,'src/voyager-racing-ui.ts'),'utf8');
const atlasUiSource = await readFile(path.join(project, 'src/atlas-racing-ui.ts'), 'utf8');
const odysseyUiSource = await readFile(path.join(project, 'src/odyssey-racing-ui.ts'), 'utf8');
const strip = source => stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import[^\n]*\r?\n/gm, '').replace(/\bexport /g, '');
const report = { externalRequests: 0, storageTouched: false, cases: [], limitations: ['真控制器renderUi與UI模組配合隔離DOM計數，不是實際瀏覽器的FPS或手機耗電量。'] };
async function test(name, exercise) {
  try { report.cases.push({ name, status: 'PASS', details: await exercise() }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
}
function room(phase = 'lobby') {
  return { code: 'ABC234', trackId: 'taipei', hostId: 'p0', laps: 3, phase, players: Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`, name: `車手${i}`, color: '#ff3300', ready: true, loaded: true, connected: true,
    completedLaps: 0, progress: 0, finishMs: null, dnf: false, dnfReason: null, rank: i + 1,
  })) };
}
function environment(source = currentSource) {
  const metrics = { created: 0, writes: 0, moves: 0 };
  class Element {
    hidden = false; disabled = false; value = ''; dataset = {}; style = {}; children = []; parentNode = null; _text = '';
    constructor(tag = 'div') { this.tagName = tag; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { metrics.writes++; this._text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; }
    appendChild(child) { return this.insertBefore(child, null); }
    append(...children) { for (const child of children) this.appendChild(child); }
    prepend(...children) { for (let i = children.length - 1; i >= 0; i--) this.insertBefore(children[i], this.children[0] ?? null); }
    get options() { return this.children.filter(child => child.tagName === 'option'); }
    get selectedOptions() { return this.options.filter(option => option.value === this.value); }
    insertBefore(child, anchor) {
      if (child === anchor) return child;
      child.remove(); const index = anchor === null ? this.children.length : this.children.indexOf(anchor);
      assert.ok(index >= 0); this.children.splice(index, 0, child); child.parentNode = this; metrics.moves++; return child;
    }
    remove() { if (this.parentNode) { const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; } }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    blur() {} setAttribute() {} addEventListener() {}
  }
  const elements = new Map();
  const ui = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = { activeElement: null, getElementById: ui, createElement: tag => { metrics.created++; return new Element(tag); } };
  const client = { room: room(), selfId: 'p0', status: 'connected', rttMs: 25, error: null, hasSavedSession: false, serverNow: () => 1_700_000_000_000 };
  const context = vm.createContext({ document, HTMLElement: Element, client, scene: { matchesMap: () => true, setSpectatorTarget() {} }, voyagerForecast,getMultiplayerTrack, MULTIPLAYER_TRACKS,
    evolutionPanel: { render() {} }, horizonPanel: { render() {} }, input: { release() {}, getControls: defaultControls }, canDrive: () => false, controlCodeLabel,
    DEFAULT_ROOM_RULES, roomRulesText, MultiplayerHistory, recentHistory: new MultiplayerHistory(null), SUMMIT_TYRES, ATLAS_AI_LEVELS, atlasPitMs, odysseyStopWindow,
    URL, URLSearchParams, location: new URL('http://127.0.0.1:4319/multiplayer.html'),
    $: ui, time: ms => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`,
    sound: { engine() {} }, graphicsReady: true, busy: false, notice: '', mapLoading: false, mapError: '', mapProgress: '', previousPhase: '',
    entryFeedback: '', entryRetryKind: null, hostTargetKey: '', entryWait: { active: false, state: null },
  });
  context.window = context; context.addEventListener = () => {};
  vm.runInContext(strip(uiSource) + '\n' + strip(inviteSource) + '\n' + strip(entrySource) + '\n' + strip(seriesUiSource) + '\n' + strip(spectatorSource) + '\nconst seriesPanel = new MultiplayerSeriesPanel(); let spectatorKey = "";\nglobalThis.helpers = { MultiplayerPlayerList, deadlineText, dnfLabel };', context);
  vm.runInContext('Object.assign(globalThis,(()=>{' + strip(evolutionUiSource) + ';return {modeLabel,eventDescription,releaseRemaining};})());', context);
  vm.runInContext('const arenaPanel=(()=>{' + strip(arenaUiSource) + ';return new MultiplayerArenaPanel(()=>client,input);})();', context);
  vm.runInContext('Object.assign(globalThis,(()=>{' + strip(atlasUiSource) + ';return {AtlasRacingPanel};})());', context);
  vm.runInContext('Object.assign(globalThis,(()=>{' + strip(odysseyUiSource) + ';return {OdysseyRacingPanel};})());', context);
  vm.runInContext('const summitPanel=(()=>{' + strip(voyagerUiSource) + ';' + strip(summitUiSource) + ';return new SummitRacingPanel(()=>client);})();', context);
  vm.runInContext('const MultiplayerHistoryPanel=(function(){' + strip(historyUiSource) + ';return MultiplayerHistoryPanel;})();const historyPanel=new MultiplayerHistoryPanel(recentHistory,$("mp-history-list"),$("mp-history-status"));', context);
  vm.runInContext("const playerLists = { lobby: new MultiplayerPlayerList($('mp-players'), 'lobby'), results: new MultiplayerPlayerList($('mp-results-list'), 'results'), board: new MultiplayerPlayerList($('mp-board'), 'board') }; const lapList = new MultiplayerLapList($('mp-laps-list')); let lapDriverId = null, lapDriversKey = '';", context);
  const start = source.includes('function playerItem(') ? source.indexOf('function playerItem(') : source.indexOf('function renderUi(');
  const code = source.slice(start, source.indexOf('async function action('));
  vm.runInContext(strip(code) + '\nglobalThis.render = renderUi;', context);
  const render = value => { if (value) client.room = value; context.render(); };
  const resetMetrics = () => { metrics.created = metrics.writes = metrics.moves = 0; };
  return { render, ui, metrics, resetMetrics, client, helpers: context.helpers };
}

await test('四人20筆穩定比賽快照：before建立1120元素，after為0，無不變文字寫入', () => {
  const results = {};
  for (const [label, source] of [['before', beforeSource], ['after', currentSource]]) {
    const env = environment(source), value = room('racing'); env.render(value); env.resetMetrics();
    for (let n = 0; n < 20; n++) { const snapshot = structuredClone(value); snapshot.serverTime = n * 50; snapshot.players[0].progress = n; env.render(snapshot); }
    results[label] = { ...env.metrics };
  }
  assert.equal(results.before.created, 1120); assert.equal(results.after.created, 0);
  assert.equal(results.after.writes, 0); assert.equal(results.after.moves, 0);
  return results;
});

await test('只更新可見清單；大廳、比賽、結果各自延遲建立且保留其他面板節點', () => {
  const env = environment(), value = room(); env.render(value);
  assert.equal(env.ui('mp-players').children.length, 4); assert.equal(env.ui('mp-results-list').children.length, 0); assert.equal(env.ui('mp-board').children.length, 0);
  const lobby = [...env.ui('mp-players').children], lobbyText = env.ui('mp-players').textContent;
  const race = structuredClone(value); race.phase = 'racing'; race.players[0].ready = false; env.render(race);
  assert.equal(env.ui('mp-board').children.length, 4); assert.equal(env.ui('mp-results-list').children.length, 0);
  assert.deepEqual(env.ui('mp-players').children, lobby); assert.equal(env.ui('mp-players').textContent, lobbyText);
  const board = [...env.ui('mp-board').children]; const results = structuredClone(race); results.phase = 'results';
  results.players[0].dnf = true; results.players[0].dnfReason = 'left'; env.render(results);
  assert.equal(env.ui('mp-results-list').children.length, 4); assert.ok(env.ui('mp-results-list').textContent.includes('主動退出'));
  assert.deepEqual(env.ui('mp-board').children, board); assert.deepEqual(env.ui('mp-players').children, lobby);
  env.resetMetrics(); env.render(results); assert.equal(env.metrics.created, 0); assert.equal(env.metrics.writes, 0);
});

await test('排名改變移動既有玩家；改名、斷線及離房後資料正確，不累積舊列', () => {
  const env = environment(), value = room('racing'); env.render(value);
  const rows = [...env.ui('mp-board').children]; env.resetMetrics();
  value.players = [value.players[1], value.players[0], value.players[2], value.players[3]];
  value.players.forEach((player, index) => { player.rank = index + 1; });
  value.players[0].name = '換名字'; value.players[0].connected = false; env.render(value);
  assert.equal(env.ui('mp-board').children[0], rows[1]); assert.equal(env.ui('mp-board').children[1], rows[0]);
  assert.equal(env.metrics.created, 0); assert.ok(env.ui('mp-board').children[0].textContent.includes('換名字失聯'));
  value.players.splice(0, 1); env.render(value); assert.equal(env.ui('mp-board').children.length, 3); assert.equal(rows[1].parentNode, null);
  env.client.room = null; env.render();
  for (const id of ['mp-players', 'mp-results-list', 'mp-board']) assert.equal(env.ui(id).children.length, 0);
});

await test('倒數取伺服器同步時間、秒數向上取整／不變負數；舊server不捏造期限', () => {
  const { deadlineText, dnfLabel } = environment().helpers;
  const race = { ...room('racing'), deadlineAt: 160_000, deadlineReason: 'finish-timeout' };
  assert.equal(deadlineText(race, 100_000), '最後完賽 1:00');
  assert.equal(deadlineText(race, 159_500), '最後完賽 0:01'); assert.equal(deadlineText(race, 160_500), '最後完賽 0:00');
  assert.equal(deadlineText({ ...race, deadlineReason: 'race-timeout' }, 100_000), '比賽剩餘 1:00');
  assert.equal(deadlineText({ ...race, phase: 'results' }, 100_000), ''); assert.equal(deadlineText(room('racing'), 100_000), '');
  assert.equal(dnfLabel(undefined), '未完成'); assert.equal(dnfLabel('disconnect-expired'), '斷線逾期');
});

report.summary = { passed: report.cases.filter(item => item.status === 'PASS').length, failed: report.cases.filter(item => item.status === 'FAIL').length };
await writeFile(path.join(project, 'tools/dev-tests/next6-multiplayer-ui-result.json'), JSON.stringify(report, null, 2) + '\n');
for (const item of report.cases) console.log(`${item.status} ${item.name}${item.error ? '\n' + item.error : ''}`);
console.log(JSON.stringify(report.summary)); if (report.summary.failed) process.exitCode = 1;
