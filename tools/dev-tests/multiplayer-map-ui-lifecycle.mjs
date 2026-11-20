// 真 UI 控制器配合可控制的場景工作，驗證晚到地圖與續接不能誤確認。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { MULTIPLAYER_TRACKS, DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack } from '../../shared/multiplayer-tracks.ts';
import { validSeriesTracks, PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../../shared/multiplayer-protocol.ts';
import { spectatorTarget } from '../../src/multiplayer-spectator.ts';
import { MultiplayerNetworkWindow } from '../../src/multiplayer-network.ts';
import { defaultControls, controlCodeLabel } from '../../src/input.ts';
import * as THREE from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(resolve(root, 'src/multiplayer-game.ts'), 'utf8');
const uiSource = await readFile(resolve(root, 'src/multiplayer-ui.ts'), 'utf8');
const pacingSource = await readFile(resolve(root, 'src/frame-pacing.ts'), 'utf8');
const inviteSource = await readFile(resolve(root, 'src/multiplayer-invite.ts'), 'utf8');
const entrySource = await readFile(resolve(root, 'src/multiplayer-entry.ts'), 'utf8');
const qualitySource = await readFile(resolve(root, 'src/multiplayer-quality.ts'), 'utf8');
const seriesUiSource = await readFile(resolve(root, 'src/multiplayer-series-ui.ts'), 'utf8');
const spectatorSource = await readFile(resolve(root, 'src/multiplayer-spectator.ts'), 'utf8');
// A re-export must be removed as a whole statement before stripping local export keywords.
// Otherwise new `export {name} from './module'` declarations leave invalid VM syntax.
const scriptCode = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[^\n]*\r?\n/gm, '')
  .replace(/^export\s*\{[^\n]*\}\s*from\s*[^\n]*\r?\n/gm, '')
  .replace(/\bexport /g, '');
const helpersCode = [uiSource, pacingSource, inviteSource, entrySource, qualitySource, seriesUiSource, spectatorSource].map(scriptCode).join('\n');
const addedModules = [
  ['src/voyager-comfort.ts', 'getVoyagerComfort,applyVoyagerComfort,mountVoyagerComfort'],
  ['src/voyager-photo.ts', 'VoyagerPhoto,mountResultCard,downloadPng,createResultCard'],
  ['src/voyager-result-data.ts', 'multiplayerResultCardData'],
  ['src/atlas-storage-lease.ts', 'acquireAtlasPageLease,withAtlasRestoreLease'],
  ['shared/atlas-racing.ts', 'ATLAS_RACING_VERSION,ATLAS_AI_LEVELS,ATLAS_PIT_SERVICES,defaultAtlasSettings,atlasSettings,atlasPlayer,atlasDamage,atlasRepairMs,atlasPitMs,atlasLimits,validateAtlas'],
  ['shared/multiplayer-room-rules.ts', 'DEFAULT_ROOM_RULES,parseRoomRules,roomRulesText'],
  ['shared/multiplayer-horizon.ts', 'defaultHorizon,parseRoomPreset'],
  ['src/multiplayer-presets.ts', 'MultiplayerPresets'],
  ['src/multiplayer-horizon-ui.ts', 'MultiplayerHorizonPanel'],
  ['src/multiplayer-evolution-ui.ts', 'MultiplayerEvolutionPanel,eventDescription,modeLabel,releaseRemaining'],
  ['src/multiplayer-awareness.ts', 'MultiplayerAwareness'],
  ['src/multiplayer-history.ts', 'MultiplayerHistory'],
  ['src/multiplayer-history-ui.ts', 'MultiplayerHistoryPanel'],
  ['src/multiplayer-arena-ui.ts', 'MultiplayerArenaPanel'],
  ['src/multiplayer-arena-visuals.ts', 'MultiplayerArenaVisuals'],
  ['shared/nexus-replay.ts', 'decodeMultiplayerReplay,parseMultiplayerReplay,replayRoomAt,REPLAY_MAX_CHARS'],
  ['src/nexus-replay-library.ts', 'ReplayLibrary'],
  ['src/nexus-replay-ui.ts', 'mountMultiplayerReplay'],
  ['shared/summit-racing.ts', 'SUMMIT_TYRES'],
  ['src/atlas-racing-ui.ts', 'AtlasRacingPanel'],
  ['shared/voyager-racing.ts', 'voyagerForecast,voyagerSettings'],
  ['src/voyager-racing-ui.ts', 'VoyagerRacingPanel'],
  ['shared/odyssey-racing.ts', 'parseOdysseyState,odysseyStopWindow'],
  ['src/odyssey-racing-ui.ts', 'OdysseyRacingPanel'],
  ['src/summit-racing-ui.ts', 'SummitRacingPanel'],
  ['src/summit-replay-bookmarks.ts', 'ReplayBookmarks'],
];
const addedSources = await Promise.all(addedModules.map(async ([file, exports]) => ({ file, exports, source: await readFile(resolve(root, file), 'utf8') })));
const addedHelpersCode = addedSources.map(m => `Object.assign(globalThis,(()=>{${scriptCode(m.source)}\nreturn {${m.exports}};})());`).join('\n');
const hash = value => createHash('sha256').update(value).digest('hex');
export const controllerFixtureHashes = { game: hash(source), ui: hash(uiSource), invite: hash(inviteSource), pacing: hash(pacingSource), entry: hash(entrySource), quality: hash(qualitySource), seriesUi: hash(seriesUiSource), spectator: hash(spectatorSource) };
for (const m of addedSources) controllerFixtureHashes[m.file] = hash(m.source);
const code = scriptCode(source)
  .replace('import.meta.env.VITE_MULTIPLAYER_URL', "'ws://127.0.0.1:4320/ws'");
const report = { createdAt: new Date().toISOString(), gameSourceSha256: hash(source), localOnly: true, productionUsed: false, playerStorageTouched: false, cases: [], limitations: ['真控制器與隔離DOM／場景工作；不證明WebGL畫面、實際網路或手機操作。','新增的自助診斷與手把掛載為明示noop，非本套地圖生命週期受測範圍；Odyssey房規面板及共用解析函式仍載入真實來源。'] };
const selection = (trackId, trackRevision = 1) => ({ trackId, trackStamp: getMultiplayerTrack(trackId).trackStamp, trackRevision });
const same = (a, b) => !!a && !!b && a.trackId === b.trackId && a.trackStamp === b.trackStamp && a.trackRevision === b.trackRevision;
export function room(trackId, trackRevision = 1, extra = {}) {
  return { ...selection(trackId, trackRevision), code: 'ABC234', hostId: 'self', phase: 'lobby', laps: 3, matchId: null, startAt: null, players: [
    { id: 'self', name: '甲', color: '#ff3300', loaded: false, ready: false, connected: true, dnf: false, finishMs: null, completedLaps: 0, rank: 1 },
    { id: 'guest', name: '乙', color: '#22ccff', loaded: true, ready: true, connected: true, dnf: false, finishMs: null, completedLaps: 0, rank: 2 },
  ], ...extra };
}
export async function environment(options = {}) {
  class Element {
    hidden = false; disabled = false; value = ''; textContent = ''; dataset = {}; style = { setProperty(name,value) { this[name]=String(value); } }; children = []; listeners = new Map();
    constructor(tag = 'div') { this.tag = tag; }
    appendChild(child) { return this.insertBefore(child, null); }
    append(...children) { for (const child of children) this.appendChild(child); }
    prepend(...children) { for (let i = children.length - 1; i >= 0; i--) this.insertBefore(children[i], this.children[0] ?? null); }
    get options() { return this.children.filter(child => child.tag === 'option'); }
    get selectedOptions() { return this.options.filter(child => child.value === this.value); }
    insertBefore(child, anchor) {
      if (child === anchor) return child;
      child.remove(); const index = anchor === null ? this.children.length : this.children.indexOf(anchor);
      if (index < 0) throw new Error('DOM anchor not found');
      this.children.splice(index, 0, child); child.parentNode = this; return child;
    }
    remove() { if (this.parentNode) { const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; } }
    before(child) { this.parentNode?.insertBefore(child, this); }
    after(child) { if(this.parentNode){const i=this.parentNode.children.indexOf(this);this.parentNode.insertBefore(child,this.parentNode.children[i+1]??null);} }
    querySelector(selector) { for(const child of this.children){if(selector.startsWith('#')&&child.id===selector.slice(1))return child;const match=child.querySelector(selector);if(match)return match;}return null; }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() {} }); }
    setAttribute() {} blur() {} select() { this.selected = true; } click() { this.dispatch('click'); }
  }
  const elements = new Map();
  const document = { hidden: false, activeElement: null, body: new Element('body'), documentElement: new Element('html'), hasFocus: () => true, addEventListener() {}, createElement: tag => new Element(tag), createTextNode: text=>Object.assign(new Element('#text'),{textContent:String(text)}), createElementNS: (_ns, tag) => new Element(tag), getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id);
  } };
  document.getElementById('mp-laps').value = '3'; document.getElementById('mp-name').value = '甲';
  class Client {
    static instance;
    room = null; selfId = null; status = 'idle'; error = null; rttMs = null; hasSavedSession = false; connectionGeneration = 0;
    listeners = []; acks = []; commands = []; disconnects = 0; snapshots = [];
    constructor() { Client.instance = this; }
    connect() { return options.connect ? options.connect(this) : Promise.resolve(); }
    subscribe(listener) { this.listeners.push(listener); listener(this); }
    onSnapshot(listener) { this.snapshots.push(listener); }
    onSeriesCheckpoint() {}
    notify() { for (const listener of this.listeners) listener(this); }
    update(value, status = 'connected', generation = this.connectionGeneration) {
      this.room = value; this.selfId = value ? 'self' : null; this.status = status; this.connectionGeneration = generation; this.notify();
    }
    trackLoaded(value, generation) { this.acks.push({ ...value, generation }); this.notify(); return true; }
    ready(value) { this.commands.push({ type: 'ready', value }); }
    async create(name, laps, trackId) { this.commands.push({ type: 'create', name, laps, trackId }); }
    async join(code, name) { this.commands.push({ type: 'join', code, name }); }
    start() { this.commands.push({ type: 'start' }); }
    selectTrack(trackId) { this.commands.push({ type: 'select-track', trackId }); }
    setLaps(laps) { this.commands.push({ type: 'set-laps', laps }); return true; }
    setRoomRules(roomRules) { this.commands.push({ type: 'set-room-rules', roomRules }); return true; }
    configureSeries(trackIds) { this.commands.push({ type: 'configure-series', trackIds: [...trackIds] }); return true; }
    nextSeries() { this.commands.push({ type: 'next-series' }); return true; }
    endSeries() { this.commands.push({ type: 'end-series' }); return true; }
    reset() { this.commands.push({ type: 'reset' }); return true; }
    kickPlayer(targetPlayerId) { this.commands.push({ type: 'kick-player', targetPlayerId }); return true; }
    transferHost(targetPlayerId) { this.commands.push({ type: 'transfer-host', targetPlayerId }); return true; }
    sendInput() { return false; }
    serverNow() { return 1700000000000; }
    disconnect() { this.disconnects++; options.disconnected?.(this); }
    leave() { this.update(null, 'idle', this.connectionGeneration + 1); }
  }
  class Scene {
    static instance;
    contextLost = false; ready = false; active = null; jobs = []; requested = null; accepted = []; car = { v: 0 };
    network = new MultiplayerNetworkWindow();
    renderer = { setAnimationLoop: callback => { this.frameLoop = callback; } };
    constructor() { Scene.instance = this; }
    matchesMap(value) { return this.ready && same(this.active, value); }
    prepareMap(value, progress) {
      if (this.matchesMap(value)) return Promise.resolve(true);
      this.ready = false;
      let resolveJob, rejectJob;
      const promise = new Promise((yes, no) => { resolveJob = yes; rejectJob = no; });
      const job = { selection: { ...value }, progress, complete: () => {
        if (this.requested === job) { this.active = { ...value }; this.ready = true; resolveJob(true); } else resolveJob(false);
      }, fail: message => rejectJob(new Error(message)) };
      this.requested = job; this.jobs.push(job); return promise;
    }
    accept(value) { this.accepted.push(value); }
    frame() {} toggleCamera() {} recordInput() {} setQuality(level) { this.qualityLevel = level; }
    setSpectatorTarget(id) { this.spectatorId = spectatorTarget(Client.instance.room, Client.instance.selfId, id); }
  }
  class Input { reads = 0; releases = 0; read() { this.reads++; return { steer: 0, brake: false }; } release() { this.releases++; } getControls() { return defaultControls(); } }
  class Sound { engine() {} start() { return true; } setEngine() {} unlock() {} }
  // Explicit browser Web Locks fixture; acquireAtlasPageLease itself executes unchanged.
  const leaseRequests = [];
  const locks = { request(name, settings, callback) { leaseRequests.push({ name, ...settings }); return Promise.resolve().then(() => callback({ name, mode: settings.mode })); } };
  const context = vm.createContext({ MultiplayerClient: Client, MultiplayerScene: Scene, Input, Sound, mountControlSettings() {}, mountControlHints() {}, MULTIPLAYER_TRACKS, DEFAULT_MULTIPLAYER_TRACK_ID, getMultiplayerTrack, validSeriesTracks,
    // These additions do not participate in map loading, session generations or driver gating.
    mountDiagnostics() { return { cancel() {} }; }, mountOdysseyGamepad() {},
    PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP, controlCodeLabel, THREE,
    document, HTMLElement: Element, Error, URL, URLSearchParams,
    location: Object.assign(new URL(options.href ?? 'http://127.0.0.1:4319/multiplayer.html'), { reload() {} }), performance, console,
    addEventListener() {}, setInterval() {}, clearInterval() {}, setTimeout, clearTimeout, confirm: options.confirm ?? (() => true),
    navigator: { clipboard: 'clipboard' in options ? options.clipboard : { writeText: async () => {} }, share: options.share, locks },
  });
  if (options.localStorage) context.localStorage = options.localStorage;
  context.window = context;
  // Keep the product's top-level await: an async evaluation boundary mirrors module startup.
  await vm.runInContext(helpersCode + '\n' + addedHelpersCode + '\n(async()=>{\n' + code + '\n})()', context, { filename: 'multiplayer-game.real.ts' });
  assert.deepEqual(leaseRequests, [{ name: 'taipei-gp-full-profile-pages-v1', mode: 'shared' }], 'Real lease runtime must acquire the shared page lock before controller startup');
  const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
  const scene = Scene.instance, client = Client.instance;
  return { ui: id => document.getElementById(id), client, scene, mp: context.__mp, flush, context, leaseRequests };
}
async function test(name, run) {
  try { const details = await run(); report.cases.push({ name, status: 'PASS', details }); }
  catch (error) { report.cases.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
await test('入口／大廳均提供24圖，預覽未完成不可建房，完成後解鎖', async () => {
  const env = await environment();
  assert.equal(env.ui('mp-track').children.length, 24); assert.equal(env.ui('mp-room-track').children.length, 24);
  assert.equal(env.mp.ready, false); assert.equal(env.ui('mp-create').disabled, true);
  env.scene.requested.complete(); await env.flush();
  assert.equal(env.mp.ready, true); assert.equal(env.ui('mp-create').disabled, false);
  env.ui('mp-track').value = 'netherlands'; env.ui('mp-track').dispatch('change');
  assert.equal(env.scene.requested.selection.trackId, 'netherlands'); assert.equal(env.mp.ready, false);
  env.scene.requested.complete(); await env.flush(); assert.equal(env.mp.ready, true); assert.equal(env.client.acks.length, 0);
});
await test('快速換圖忽略晚到進度與完成，只確認最新地圖版本', async () => {
  const env = await environment();
  env.client.update(room('netherlands'), 'connected', 1); const first = env.scene.requested;
  env.client.update(room('japan', 2), 'connected', 1); const latest = env.scene.requested;
  first.progress('過期進度'); assert.notEqual(env.ui('mp-loading').textContent, '過期進度');
  latest.complete(); await env.flush(); first.complete(); await env.flush();
  assert.equal(env.mp.ready, true); assert.equal(env.client.acks.length, 1);
  assert.equal(env.client.acks[0].trackId, 'japan'); assert.equal(env.client.acks[0].trackRevision, 2);
  assert.equal(env.ui('mp-room-track').value, 'japan');
});
await test('場景完成仍等server.loaded，載入中的車手不能準備或起跑', async () => {
  const env = await environment(), value = room('netherlands');
  env.client.update(value, 'connected', 1); env.scene.requested.complete(); await env.flush();
  assert.equal(env.mp.ready, true); assert.equal(env.ui('mp-ready').disabled, true); assert.equal(env.ui('mp-start').disabled, true);
  value.players[0].loaded = true; value.players[0].ready = true; env.client.update(value);
  assert.equal(env.ui('mp-ready').disabled, false); assert.equal(env.ui('mp-start').disabled, false);
  assert.equal(env.client.acks.length, 1);
});
await test('載入失敗保留連線與房間，房主仍可換圖並成功重試', async () => {
  const env = await environment(); env.client.update(room('japan'), 'connected', 1);
  env.scene.requested.fail('測試載入失敗'); await env.flush();
  assert.equal(env.mp.ready, false); assert.equal(env.ui('mp-map-retry').hidden, false);
  assert.equal(env.ui('mp-room-track').disabled, false); assert.equal(env.client.disconnects, 0);
  assert.equal(env.ui('mp-ready').disabled, true); assert.match(env.ui('mp-message').textContent, /測試載入失敗/);
  env.ui('mp-map-retry').dispatch('click'); assert.equal(env.scene.requested.selection.trackId, 'japan');
  env.scene.requested.complete(); await env.flush(); assert.equal(env.mp.ready, true); assert.equal(env.ui('mp-map-retry').hidden, true);
  assert.equal(env.client.acks.length, 1);
});
await test('換圖可取代失敗工作，房客選單鎖定，成績與HUD顯示現圖', async () => {
  const env = await environment(); env.client.update(room('japan'), 'connected', 1);
  env.scene.requested.fail('測試失敗'); await env.flush();
  const value = room('netherlands', 2, { hostId: 'guest' }); env.client.update(value);
  env.scene.requested.complete(); await env.flush();
  const name = getMultiplayerTrack('netherlands').name;
  assert.equal(env.ui('mp-room-track').disabled, true); assert.equal(env.ui('mp-map-retry').hidden, true);
  assert.ok(env.ui('mp-result-track').textContent.includes(name)); assert.ok(env.ui('mp-race-track').textContent.includes(name));
});
await test('同圖重連重送新世代確認，斷線期間不得接受晚到完成', async () => {
  const env = await environment(); const value = room('netherlands'); env.client.update(value, 'connected', 1);
  const pending = env.scene.requested; env.client.update(value, 'reconnecting', 2);
  pending.complete(); await env.flush(); assert.equal(env.mp.ready, false); assert.equal(env.client.acks.length, 0);
  env.client.update(value, 'connected', 3); await env.flush();
  assert.equal(env.mp.ready, true); assert.equal(env.client.acks.length, 1); assert.equal(env.client.acks[0].generation, 3);
  env.client.update(value, 'reconnecting', 4); assert.equal(env.mp.ready, false);
  env.client.update(value, 'connected', 5); await env.flush();
  assert.equal(env.client.acks.length, 2); assert.equal(env.client.acks[1].generation, 5);
});
await test('離房加入另一房間即使相同圖與版號，也只確認最新房間', async () => {
  const env = await environment(); env.client.update(room('japan'), 'connected', 1); const old = env.scene.requested;
  env.client.leave(); const preview = env.scene.requested;
  env.client.update(room('japan', 1, { code: 'DEF567' }), 'connected', 3); const current = env.scene.requested;
  old.complete(); preview.complete(); await env.flush(); assert.equal(env.client.acks.length, 0);
  current.complete(); await env.flush(); assert.equal(env.client.acks.length, 1); assert.equal(env.client.acks[0].generation, 3);
});
await test('比賽中續接載入失敗仍看得到重試，失聯／未載入時不能駕駛', async () => {
  const env = await environment(); const value = room('japan', 1, { phase: 'racing', matchId: 'race', startAt: 1700000000000 });
  env.client.update(value, 'connected', 1); assert.equal(env.mp.input.isDriving(), false);
  env.scene.requested.fail('測試失敗'); await env.flush();
  assert.equal(env.ui('mp-panel').hidden, false); assert.equal(env.ui('mp-map-retry').hidden, false);
  env.ui('mp-map-retry').dispatch('click'); env.scene.requested.complete(); await env.flush();
  assert.equal(env.mp.input.isDriving(), false); value.players[0].loaded = true; env.client.update(value); assert.equal(env.mp.input.isDriving(), true);
  env.client.update(value, 'reconnecting', 2); assert.equal(env.mp.input.isDriving(), false);
});

assert.equal(hash(await readFile(resolve(root, 'src/multiplayer-game.ts'), 'utf8')), report.gameSourceSha256, '測試期間控制器來源已改變');
report.summary = { passed: report.cases.filter(item => item.status === 'PASS').length, failed: report.cases.filter(item => item.status === 'FAIL').length };
await writeFile(resolve(root, 'tools/dev-tests/shots-multiplayer-map-ui-lifecycle.json'), JSON.stringify(report, null, 2) + '\n');
for (const item of report.cases) console.log(`${item.status} ${item.name}${item.error ? '\n' + item.error : ''}`);
console.log(JSON.stringify(report.summary)); if (report.summary.failed) process.exitCode = 1;
}
