import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { qualityFor, defaultLevel, LOWER, LEVEL_NAME, type Level } from './quality';
import { buildTrack, VMAX, setRealPerf, heightAt, locate, type Locate } from './track';
import { buildWorld } from './world';
import { GaragePreview } from './garage3d';
import { CIRCUIT, CIRCUITS, loadCircuitData } from './circuits';
import { driverStandings, teamStandings, standingsHtml, roundName, POINTS } from './season';
import { buildCircuitEnv } from './circuitenv';
import { setupInstall } from './install';
import { PedZones } from './pedzone';
import { bootProgress, bootDone } from './boot';
import { buildEnvMap, makeComposer, applyShadowFlags as applyShadowFlagsIn } from './graphics';
import { loadCity } from './city';
import { makeF1, TEAMS } from './f1model';
import { TeamRadio } from './radio';
import { Podium } from './podium';
import { FreeCar, CAR_VMAX, DEFAULT_SPEC } from './freecar';
import { stage, marks, onProgress } from './loading';
import { Weather, headlightRig, TIME_NAME, cycleAt, CYCLE_LEN, type TimeKind } from './weather';
import { Cockpit } from './cockpit';
import { Damage } from './damage';
import { emptyStats, newlyUnlocked, renderAchPage, type Stats } from './achievements';
import { BigMap, NavArrows } from './bigmap';
import { RainFx } from './rainfx';
import { DriftScore } from './drift';
import { VEHICLES, vehicleById, buildPlayerVehicle, PAINTS, PAINT_PRICE, type PlayerVehicle, type VehicleId, type Vehicle } from './vehicles';
import { type Collider, RoadNet } from './citydata';
import { shortEn, type Landmark } from './decor';
import { Minimap } from './minimap';
import { Traffic } from './traffic';
import { Pedestrians } from './peds';
import { RaceField, PLAYER_LIVERY, TYRES, RAIN, PERSONAS, type Racer, type GpWeather } from './rivals';
import { WALL_OFF, TOWER_101 } from './track';
import { StreetRace, type Challenge } from './streetrace';
import type { Breakables } from './breakables';
import { Router } from './router';
import { TaxiJob } from './taxi';
import { Police, LOSE_TIME } from './police';
import { Car } from './car';
import { Input } from './input';
import { Sound } from './audio';
import { physicsTest } from './physicstest';
import { initLeaderboard, submitLap } from './leaderboard-ui';


import { save, writeSave, KEY, type Ghost, type SteerMode } from './save';

// ---------------------------------------------------------------- 場景
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// 觸控裝置（手機、平板）：有些手機／瀏覽器（例如「電腦版網站」模式）會回報 pointer: fine，
// 所以也看觸控點數；真的被手指點到也算。觸控按鈕的顯示看 html.touch（style.css）
const TOUCH = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const MOBILE = matchMedia('(pointer: coarse)').matches || (TOUCH && !matchMedia('(hover: hover)').matches);
// 選單「觸控按鈕」：自動（有觸控螢幕或被手指點到就顯示）／總是顯示／不顯示（觸控筆電當電腦玩）
let touchSeen = false;
function applyTouch() {
  const pref = save.touch ?? 'auto';
  document.documentElement.classList.toggle('touch', pref === 'on' || (pref === 'auto' && (TOUCH || touchSeen)));
}
applyTouch();
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !touchSeen) { touchSeen = true; applyTouch(); } }, { capture: true });
const qPref = (new URLSearchParams(location.search).get('q') as Level | null) ?? save.quality ?? 'auto'; // ?q=medium 給測試用
let level: Level = qPref === 'auto' ? defaultLevel(MOBILE) : qPref;
const Q = qualityFor(level);
const renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 2 && !Q.bloom, powerPreference: 'high-performance', stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 5000);
// 調到 AI 排位圈速跟真實竿位差 ±5%（蒙札 +3%、鈴鹿 +5%、摩納哥 -2%）：極速 342 km/h、煞車約 5g、高速彎約 6.7g
const REAL_PERF = { vmax: 95, engine: 16, brake: 50, g0: 23, gk: 0.0068, gmax: 66 };
// 各國賽道（?circuit=suzuka）：先讀中心線再建賽道；不載入台北街景，改成通用的賽道場景（circuitenv.ts）
const circuitData = await loadCircuitData();
// 各國賽道用接近真實 F1 的性能（台北街道賽維持原本的手感、線上排行榜才比得下去）；?perf=v,e,b,g0,gk,gmax 測試用
if (circuitData) {
  const pq = new URLSearchParams(location.search).get('perf')?.split(',').map(Number);
  setRealPerf(pq?.length === 6 ? { vmax: pq[0], engine: pq[1], brake: pq[2], g0: pq[3], gk: pq[4], gmax: pq[5] } : REAL_PERF);
}
// 中心線先平滑兩次（前後各 2 點、約 16 m）：OSM 的線有細小的鋸齒，曲率會亂跳，AI 的賽車線跟著亂擺就會撞牆
const smooth = (p: [number, number][]) => p.map((_, i) => { let x = 0, z = 0; for (let k = -2; k <= 2; k++) { const q = p[(i + k + p.length) % p.length]; x += q[0]; z += q[1]; } return [x / 5, z / 5] as [number, number]; });
const track = circuitData ? buildTrack(smooth(smooth(circuitData.points)), circuitData.elev) : buildTrack(); // elev：高低起伏（tools/fetch-elevation.mjs）
const world = buildWorld(scene, track, CIRCUIT?.banner, CIRCUIT ? `${CIRCUIT.banner[1]}  ${CIRCUIT.banner[0]}` : undefined);
let circuitEnv: ReturnType<typeof buildCircuitEnv> | null = null;
(scene.fog as THREE.Fog).far = Q.fogFar;
// 陰影：只涵蓋玩家周圍（每幀跟著移動），範圍越小越清楚
{
  const sc = world.sun.shadow;
  world.sun.castShadow = Q.shadows;
  sc.mapSize.set(Q.shadowSize, Q.shadowSize);
  const R = Q.shadowRange;
  Object.assign(sc.camera, { left: -R, right: R, top: R, bottom: -R, near: 10, far: 1200 });
  sc.camera.updateProjectionMatrix();
  sc.bias = -0.0004;
  sc.normalBias = 0.6;
}
const buildEnv = (sunColor?: THREE.Color) => buildEnvMap(renderer, scene, world, sunColor);
buildEnv();
scene.environmentIntensity = 0.75; // 不要讓反光蓋過原本的顏色
// 光暈（Bloom）：霓虹招牌、亮燈的窗戶、路燈、車燈、紅綠燈會暈開；最後加一點暗角與暖色調
let composer: EffectComposer | null = null, bloom: UnrealBloomPass | null = null, gradePass: ShaderPass | null = null;
function setupBloom() { ({ composer, bloom, gradePass } = makeComposer(renderer, scene, camera, Q.bloomScale)); }
const applyShadowFlags = () => applyShadowFlagsIn(scene, Q.shadows);
let cityReady = false;
let collider: Collider | null = null, roadNet: RoadNet | null = null, minimap: Minimap | null = null;
let landmarks: Landmark[] = [];
let traffic: Traffic | null = null;
let peds: Pedestrians | null = null;
let sr: StreetRace | null = null;
let breakables: Breakables | null = null;
let taxi: TaxiJob | null = null;
let police: Police | null = null;
let router: Router | null = null;
let bigmap: BigMap | null = null;
let rainfx: RainFx | null = null;
let pedzones: PedZones | null = null; // 行人徒步區
let zoneIn = false, zoneT = 0, zoneStare = false;
let trains: import('./trains').Trains | null = null;
const WANTED_TEST = new URLSearchParams(location.search).has('wanted');
const PURSUIT_TEST = new URLSearchParams(location.search).has('pursuit');
const policeLog: string[] = []; // 測試標題用
const HONK_TEST = new URLSearchParams(location.search).has('honktest');
let honkYield = 0, honkBack = 0, honkT = 0, honkPlaced = false;
const taxiOn = () => !!taxi && taxi.phase !== 'off';
let raceHide: THREE.Object3D[] = []; // 街道賽封路時要藏起來的東西（賽道旁的路名牌）
let cityCull: ((x: number, z: number, r: number) => void) | null = null;
let cityStream: import('./city').CityStream | null = null;
// 載入進度：選單的按鈕上顯示目前在做什麼＋進度條
// 開始建城市之後先不重畫背景：每加進一批新東西，畫面第一次畫到它就要同步編譯著色器，載入會一直卡
let holdRender = true; // 一開始就先不畫：開場就建好的車、警車、雨…第一次畫到也要同步編譯，等最後 compileAsync 一次編
onProgress((label, f) => {
  if (cityReady) return;
  // holdRender 從一開始就是 true；解除只在著色器編好之後（下面）
  $('free-label').textContent = `${label}… ${Math.round(f * 100)}%`;
  bootProgress(label, f);
  $('load-bar').style.width = `${Math.round(f * 100)}%`;
});
// 自動測試（?sim）是同步模擬，等不到背景載入：一次載入全部區塊（?alltiles 也可以）
const ALL_TILES = new URLSearchParams(location.search).has('sim') || new URLSearchParams(location.search).has('alltiles');
/** 賽道模式：蓋場景、準備畫面（跟台北街景載完之後同一套：陰影旗標、天氣、著色器先編好） */
async function loadCircuitScene() {
  await stage('蓋賽道場景', 0.4);
  circuitEnv = buildCircuitEnv(scene, track, CIRCUIT!, world);
  circuitEnv.setDetail(level); // 手機預設「中」、上次自動降過級的話照那一級
  await stage('準備畫面', 0.9);
  applyShadowFlags();
  weather.collect();
  applyWeather();
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { await renderer.compileAsync(scene, camera); } catch { /* 不支援就照舊第一次畫時編 */ }
  for (const o of hidden) o.visible = false;
  holdRender = false;
  await stage('完成', 1);
  $('load-bar').parentElement!.style.display = 'none';
  refreshGarage();
  cityReady = true;
  if (state === 'menu') showMenu(false);
  bootDone();
}
// 自由駕駛上次停在哪（save.freePos）：開場先載入那一帶的街景，一進自由駕駛四周就有房子
const START_POS = !new URLSearchParams(location.search).has('bot') && validFreePos(save.freePos) ? save.freePos! : null;
function validFreePos(p: { x: number; z: number; h: number } | undefined) { return !!p && [p.x, p.z, p.h].every(Number.isFinite) && Math.abs(p.x) < 20000 && Math.abs(p.z) < 20000; }
const cityLoad = CIRCUIT ? loadCircuitScene() : loadCity(scene, track, Q, { all: ALL_TILES, cx: START_POS?.x ?? track.px[0], cz: START_POS?.z ?? track.pz[0] }).then(async (c) => {
  await stage('建立碰撞與路網', 0.76);
  collider = c.collider;
  cityStream = c.stream;
  c.stream.onAdd = (g) => applyShadowFlagsIn(g, Q.shadows); // 串流進來的區塊：跟載入時一樣只接受陰影
  c.stream.onRemove = () => renderer.renderLists.dispose(); // 繪製清單會留著卸掉區塊的物件，下一格重建一份新的
  for (const b of c.filler.boxes) collider.addRect(b.x, b.z, b.w, b.d);
  for (const [x, z, r] of c.elev.posts) collider.addPost(x, z, r); // 高架橋墩
  for (const [x1, z1, x2, z2] of c.elev.walls) collider.addWall(x1, z1, x2, z2); // 匝道貼地那段
  for (const [x, z] of c.marketSpots) collider.addPost(x, z, 1.1); // 夜市攤位
  roadNet = new RoadNet(c.data);
  // 水邊：擋住不讓車開進河裡；附近 8 m 內有車道的那段不擋（跨河、跨溝的橋）
  for (const w of c.data.water ?? []) {
    const P = w.p, n = P.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, mx = (P[i * 2] + P[j * 2]) / 2, mz = (P[i * 2 + 1] + P[j * 2 + 1]) / 2;
      if (roadNet.segGrid.query(mx, mz, 8).some((s) => s.way.c <= 3)) continue;
      collider.addWall(P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1]);
    }
  }
  minimap = new Minimap($<HTMLCanvasElement>('minimap'), roadNet);
  landmarks = c.landmarks;
  breakables = c.breakables;
  raceHide = c.raceHide;
  cityCull = c.cull;
  trains = c.trains;
  rainfx = new RainFx(scene, c.data); // 雨天的積水與水花
  pedzones = new PedZones(scene, c.data); // 行人徒步區（西門町…）：石板路面
  trains.frozen = new URLSearchParams(location.search).has('trainfreeze');
  await stage('車流與紅綠燈', 0.82);
  traffic = new Traffic(scene, c.data, Q.traffic, c.breakables);
  traffic.collider = collider;
  await stage('行人', 0.9);
  peds = new Pedestrians(scene, c.data, collider, Q.peds);
  await stage('街頭挑戰與導航', 0.95);
  sr = new StreetRace(scene, c.data, c.landmarks);
  router = new Router(c.data);
  taxi = new TaxiJob(scene, c.landmarks, router);
  bigmap = new BigMap($<HTMLCanvasElement>('bigmap'), roadNet, c.landmarks);
  bigmap.onPick = (x, z) => setNav(x, z);
  buildMapShortcuts();
  police = new Police(scene, router, roadNet);
  if (WANTED_TEST) police.heat = police.stars = +new URLSearchParams(location.search).get('wanted')!; // 測試：?wanted=3 一開始就 3 星通緝
  // 著色器一次編好：隱藏的東西（其他車、遠處區塊、計程車頂燈）也先打開一起編，之後切換才不會卡一下；
  // 有平行編譯擴充（KHR_parallel_shader_compile）時不會卡住主執行緒
  await stage('準備畫面', 0.98);
  applyShadowFlags();
  weather.collect();
  applyWeather();
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { await renderer.compileAsync(scene, camera); } catch { /* 不支援就照舊第一次畫時編 */ }
  for (const o of hidden) o.visible = false;
  hidden.length = 0; // 這個範圍會被之後的回呼（大地圖 onPick…）一直留著：不清掉的話，卸掉的城市區塊永遠放不掉
  holdRender = false;
  await stage('完成', 1);
  $('load-bar').parentElement!.style.display = 'none';
  if (new URLSearchParams(location.search).has('prof')) document.title = 'PROF ' + marks.map(([l, ms]) => `${l}:${ms}`).join(' ');
  taxi.money = save.taxi?.money ?? 0;
  taxi.trips = save.taxi?.trips ?? 0;
  refreshGarage();
  applyShadowFlags();
  cityReady = true;
  if (state === 'menu') showMenu(false);
  bootDone(); // 載入畫面淡出，接上選單運鏡
}).catch((e) => {
  bootDone();
  console.error(e);
  holdRender = false; // 街景載入失敗：至少把賽道畫出來
  cityReady = true; // 街景載入失敗也讓人能玩（只剩賽道）
  $('menu-best').textContent = '街景載入失敗，請檢查網路後重新整理';
});

const carModel = makeF1(PLAYER_LIVERY); // 玩家：躍馬紅（紅白黑）
carModel.root.userData.dynamic = true;
scene.add(carModel.root);
const ghostModel = makeF1(PLAYER_LIVERY, true);
ghostModel.root.visible = false;
scene.add(ghostModel.root);

// 自由駕駛／計程車可選的車（vehicles.ts）：全部先建好藏起來，選哪台就顯示哪台
// 會動的東西才投射即時陰影（建築、樹的影子是預先算好的）；buildPlayerVehicle 會標成 dynamic
const playerCars = new Map<VehicleId, PlayerVehicle>();
for (const v of VEHICLES) {
  const pv = buildPlayerVehicle(v);
  pv.model.root.visible = false;
  scene.add(pv.model.root);
  playerCars.set(v.id, pv);
}
// 車庫：所有車都免費選（Rex 要一開始就能全部玩到）；烤漆照樣用錢買，每台各自記（save.paints 買過的、save.paint 目前的）
// 要改回「賺錢買車」：把 FREE_CARS 改成 false（價格在 vehicles.ts，save.owned 記買過的）
const FREE_CARS = true;
const ownedCars = () => new Set<string>(FREE_CARS ? VEHICLES.map((v) => v.id) : ['sedan', 'taxi', ...(save.owned ?? [])]);
for (const [id, pv] of playerCars) { const c = save.paint?.[id]; if (c) pv.setPaint(c); }
// ?car=muscle 測試用：直接指定車（不管有沒有買）
const CAR_Q = new URLSearchParams(location.search).get('car');
let chosen = vehicleById(CAR_Q ?? (ownedCars().has(save.car ?? '') ? save.car : 'sedan'));
const pcar = () => playerCars.get(chosen.id)!;
// 時段天氣（weather.ts）
const weather = new Weather(scene, world, Q.level === 'high' ? 3000 : Q.level === 'medium' ? 1800 : 900);
{
  const FRONT: Record<string, [number, number, number]> = { sedan: [2.35, 0.75, 0.6], taxi: [2.35, 0.75, 0.6], muscle: [2.45, 0.72, 0.68], super: [2.38, 0.58, 0.62], police: [2.35, 0.75, 0.6], pickup: [2.3, 0.75, 0.6], f1: [3.2, 0.35, 0.35] };
  for (const [id, pv] of playerCars) { const h = headlightRig(...(FRONT[id] ?? FRONT.sedan)); pv.model.root.add(h); weather.headlights.push(h); }
  const h = headlightRig(...FRONT.f1);
  carModel.root.add(h);
  weather.headlights.push(h);
}
const TIMES = Object.keys(TIME_NAME) as TimeKind[];
// 各國賽道照那一站的時段（新加坡、拉斯維加斯、卡達是夜賽、阿布達比黃昏）
let timeKind: TimeKind = TIMES.includes(new URLSearchParams(location.search).get('time') as TimeKind) ? new URLSearchParams(location.search).get('time') as TimeKind : CIRCUIT ? CIRCUIT.time : TIMES.includes(save.time as TimeKind) ? save.time as TimeKind : 'dusk';
// 自動日夜循環：從白天開始（cycleT 秒），每 0.25 秒漸變一次；環境反射只在每段開始時重做（很花時間）
let cycleT = +(new URLSearchParams(location.search).get('cyclet') ?? 0), cycleAcc = 0, cycleSeg = -1; // 測試：&cyclet=520 直接跳到循環第 520 秒
let envFor = 'dusk'; // 環境反射目前是照哪個時段做的（開場的 buildEnv() 是黃昏）
function applyWeather() {
  weather.apply(timeKind, Q.fogFar, bloom, gradePass, cycleT);
  const k = timeKind === 'auto' ? `auto${cycleAt(cycleT).seg}` : timeKind;
  if (k !== envFor) { envFor = k; buildEnv(weather.envSun); } // 很花時間：時段真的變了才重做
  if (traffic) traffic.lightsOn = weather.night || weather.raining;
}
function tickCycle(dt: number) {
  const clock = $('clock');
  if (timeKind !== 'auto') { clock.style.display = 'none'; return; }
  cycleT = (cycleT + dt) % CYCLE_LEN;
  cycleAcc += dt;
  const c = cycleAt(cycleT);
  if (cycleAcc > 0.25 || c.seg !== cycleSeg) {
    cycleAcc = 0;
    weather.apply('auto', Q.fogFar, bloom, gradePass, cycleT);
    if (traffic) traffic.lightsOn = weather.night;
    if (c.seg !== cycleSeg) { cycleSeg = c.seg; envFor = `auto${c.seg}`; buildEnv(weather.envSun); }
  }
  const hh = Math.floor(c.clock) % 24, mm = Math.floor((c.clock % 1) * 60);
  clock.style.display = state === 'free' || state === 'race' ? '' : 'none';
  clock.textContent = `🕐 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
applyWeather(); // 載入中的天空就先換好（城市載入完會再套一次，連窗戶、路燈）

const car = new Car(); // 街道賽的 F1
const field = new RaceField(scene, track, car); // 正賽的 7 台 AI 對手
let raceKind: 'gp' | 'tt' = 'tt'; // 正賽 or 計時賽
const fcar = new FreeCar(); // 自由駕駛的汽車
type Mode = 'free' | 'race';
let mode: Mode = 'free';
const veh = () => (mode === 'race' ? car : fcar);
const input = new Input($('pad'), $('pad-dot'), $('brake'), $('gas'), $('steer-l'), $('steer-r'), $('btn-drift'));
const drift = new DriftScore(); // 甩尾計分（drift.ts）
const sound = new Sound();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
  bloom?.resolution.set(innerWidth * Q.bloomScale, innerHeight * Q.bloomScale);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- 選項
// 手機轉向：左右按鈕（預設）／拖曳滑桿／傾斜手機；舊存檔勾過「傾斜手機轉向」的沿用
let steerMode: SteerMode = save.steer ?? (save.opts.tilt ? 'tilt' : 'buttons');
const timeSel = $<HTMLSelectElement>('opt-time');
timeSel.value = timeKind;
timeSel.addEventListener('change', () => { timeKind = timeSel.value as TimeKind; save.time = timeKind; writeSave(); applyWeather(); });
// 轉向靈敏度、音量（滑桿；記在存檔）
{
  const sens = $<HTMLInputElement>('opt-sens');
  sens.value = String(save.sens ?? 1);
  input.sens = save.sens ?? 1;
  const showSens = () => { $('sens-val').textContent = `${(+sens.value).toFixed(1)}×`; };
  showSens();
  sens.addEventListener('input', () => { input.sens = save.sens = +sens.value; showSens(); writeSave(); });
  // 觸控按鈕：大小、透明度、位置（CSS 變數 --tc-scale、--tc-op、--tc-lift；html.tc-swap 左右對調）
  const tc: NonNullable<typeof save.tc> = save.tc ?? { size: 1, op: 1, pos: 'std' };
  const tcSize = $<HTMLInputElement>('opt-tc-size'), tcOp = $<HTMLInputElement>('opt-tc-op'), tcPos = $<HTMLSelectElement>('opt-tc-pos');
  const applyTc = () => {
    const st = document.documentElement.style;
    st.setProperty('--tc-scale', String(tc.size));
    st.setProperty('--tc-op', String(tc.op));
    st.setProperty('--tc-lift', tc.pos.endsWith('lift') ? '46px' : '0px');
    document.documentElement.classList.toggle('tc-swap', tc.pos.startsWith('swap'));
    document.documentElement.classList.toggle('tc-radio-top', tc.size > 1.05 || tc.pos !== 'std');
    $('tc-size-val').textContent = `${Math.round(tc.size * 100)}%`;
    $('tc-op-val').textContent = `${Math.round(tc.op * 100)}%`;
  };
  tcSize.value = String(tc.size); tcOp.value = String(tc.op); tcPos.value = tc.pos;
  const saveTc = () => { save.tc = { ...tc }; writeSave(); applyTc(); };
  tcSize.addEventListener('input', () => { tc.size = +tcSize.value; saveTc(); });
  tcOp.addEventListener('input', () => { tc.op = +tcOp.value; saveTc(); });
  tcPos.addEventListener('change', () => { tc.pos = tcPos.value as typeof tc.pos; saveTc(); });
  applyTc();
  const vol = save.vol ?? { master: 1, engine: 1, fx: 1 };
  sound.setVolume(vol);
  for (const k of ['master', 'engine', 'fx'] as const) {
    const el = $<HTMLInputElement>(`opt-vol-${k}`);
    el.value = String(vol[k]);
    el.addEventListener('input', () => { vol[k] = +el.value; save.vol = vol; sound.setVolume(vol); writeSave(); });
  }
}
// 新手教學：第一次進自由駕駛時跳出來；選單也可以重看
const TUT_TOUCH = [
  ['🚗 開車', '左下 ◀ ▶ 轉向（「設定」可改拖曳或傾斜手機），右下「油門」「煞車」。停住再按煞車＝倒車。'],
  ['📷 視角與地圖', '右上 📷 切換車後／車內視角，🗺 打開大地圖：點一下就能導航過去。⟲ 卡住時回到路上。'],
  ['📯 喇叭與甩尾', '按 📯 喇叭，前面的車會讓路。高速轉彎時按住 🌀 甩尾（會自動給油），甩越久分數越高、還能賺錢；撞到東西分數歸零。'],
  ['🚨 小心警察', '撞車、撞人、闖紅燈會被通緝。離警車 110 m 以外撐 7 秒就甩掉，停在警車旁邊會被抓。'],
  ['🏁 玩法', '路上的橘色光柱是街頭飆車挑戰；選單還有計程車載客、街頭對決、F1 正賽和計時賽（線上排行榜）。'],
];
const TUT_KEYS = [
  ['🚗 開車', '↑／W 油門、↓／S 煞車（停住再按＝倒車）、← →／A D 轉向，Esc 暫停。'],
  ['📷 視角與地圖', 'C 切換車後／車內視角，M 打開大地圖：點一下就能導航過去。右上 ⟲ 卡住時回到路上。'],
  ['📯 喇叭與甩尾', 'H 按喇叭，前面的車會讓路。高速轉彎時按住 Shift 甩尾，甩越久分數越高、還能賺錢；撞到東西分數歸零。車子受損時停車可以 🔧 修車。'],
  ['🚨 小心警察', '撞車、撞人、闖紅燈會被通緝。離警車 110 m 以外撐 7 秒就甩掉，停在警車旁邊會被抓。開巡邏車按 G 可以追緝嫌犯。'],
  ['🏁 玩法', '路上的橘色光柱是街頭飆車挑戰（Enter 接受）；正賽 Ctrl／E 開 DRS、B 進站。'],
];
let tutPage = 0;
function showTut(page = 0) {
  const pages = document.documentElement.classList.contains('touch') ? TUT_TOUCH : TUT_KEYS;
  tutPage = Math.max(0, Math.min(pages.length - 1, page));
  const [t, b] = pages[tutPage];
  $('tut-title').textContent = t;
  $('tut-text').textContent = b;
  $('tut-step').textContent = `${tutPage + 1} / ${pages.length}`;
  $('tut-next').textContent = tutPage === pages.length - 1 ? '開始開車！' : '下一頁';
  $('tut').classList.remove('hidden');
}
function closeTut() { $('tut').classList.add('hidden'); save.tutDone = true; writeSave(); }
$('tut-next').addEventListener('click', () => {
  const pages = document.documentElement.classList.contains('touch') ? TUT_TOUCH : TUT_KEYS;
  if (tutPage >= pages.length - 1) closeTut(); else showTut(tutPage + 1);
});
$('tut-skip').addEventListener('click', closeTut);
$('btn-tut').addEventListener('click', () => showTut(0));
const touchSel = $<HTMLSelectElement>('opt-touch');
touchSel.value = save.touch ?? 'auto';
touchSel.addEventListener('change', () => { save.touch = touchSel.value as 'auto' | 'on' | 'off'; writeSave(); applyTouch(); });
const steerSel = $<HTMLSelectElement>('opt-steer');
steerSel.value = steerMode;
steerSel.addEventListener('change', () => { steerMode = steerSel.value as SteerMode; save.steer = steerMode; writeSave(); applyOpts(); });
const opts = {
  assist: save.opts.assist ?? true,
  ghost: save.opts.ghost ?? true,
  sound: save.opts.sound ?? true,
  fps: save.opts.fps ?? false,
  quali: save.opts.quali ?? true, // 大獎賽先跑排位賽
};
for (const k of Object.keys(opts) as (keyof typeof opts)[]) {
  const el = $<HTMLInputElement>('opt-' + k);
  el.checked = opts[k];
  el.addEventListener('change', () => { opts[k] = el.checked; save.opts = { ...save.opts, ...opts }; writeSave(); applyOpts(); });
}
function applyOpts() {
  world.assist.visible = opts.assist;
  sound.enabled = opts.sound;
  input.tilt = steerMode === 'tilt';
  // 傾斜模式仍顯示拖曳滑桿（陀螺儀不能用時可以改用手指）
  document.documentElement.dataset.steer = steerMode === 'buttons' ? 'buttons' : 'drag';
}
applyOpts();
// 正賽的圈數與起跑胎（記在存檔裡）
for (const id of ['opt-laps', 'opt-tyre', 'opt-rules', 'opt-gpwx'] as const) {
  const el = $<HTMLSelectElement>(id);
  const v = (save.opts as Record<string, unknown>)[id];
  if (typeof v === 'string') el.value = v;
  el.addEventListener('change', () => { (save.opts as Record<string, unknown>)[id] = el.value; writeSave(); });
}

// ---------------------------------------------------------------- 比賽狀態
type State = 'menu' | 'countdown' | 'race' | 'free' | 'paused' | 'results' | 'replay' | 'podium';
let state: State = 'menu';
let countdown = 0, lightsOutAt = 0, litShown = 0;
let lap = 1, lapTime = 0, lastLap: number | null = null;
let sectorIdx = 0, sectorStart = 0;
const bounds = [track.length / 3, (track.length * 2) / 3];
let rec: Ghost = { t: [], s: [], x: [], z: [], h: [] }, recAcc = 0;
let ghostPtr = 0;
let wrongWay = 0, warnText = '', toastUntil = 0, clearSectorsAt = 0, deltaAcc = 0;

const fmt = (t: number | null) => {
  if (t == null) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
const fmtDelta = (d: number) => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3);

function resetRace() {
  car.placeAt(track, 1);
  lap = 1;
  startLap();
  lastLap = null;
  $('last').textContent = '--';
  $('best').textContent = fmt(save.best);
  $('lap').textContent = '1';
  camSnap = true;
}

function startLap() {
  lapTime = 0;
  sectorIdx = 0;
  sectorStart = 0;
  rec = { t: [], s: [], x: [], z: [], h: [] };
  recAcc = 0;
  ghostPtr = 0;
  clearSectorsAt = performance.now() + 2500;
}

function sectorDone(k: number, time: number) {
  const best = save.sectors[k];
  const el = $('s' + k);
  el.className = best == null || time < best ? 'purple' : 'yellow';
  if (best != null) {
    const d = $('delta');
    d.textContent = `S${k + 1} ${fmtDelta(time - best)}`;
    d.className = time < best ? 'good' : 'bad';
  }
  if (best == null || time < best) save.sectors[k] = time;
}

function completeLap() {
  const t = lapTime;
  if (qualiRun) { finishQuali(t); return; } // 排位賽：跑完一圈就排名
  sectorDone(2, t - sectorStart);
  lastLap = t;
  $('last').textContent = fmt(t);
  if (save.best == null || t < save.best) {
    const first = save.best == null;
    save.best = t;
    save.ghost = rec;
    $('best').textContent = fmt(t);
    toast(first ? `完成第一圈！${fmt(t)}` : `最快圈！${fmt(t)}`, 'purple');
    if (!BOT && !CIRCUIT) void submitLap(t); // 新的最快圈：上傳線上排行榜（只收台北信義街道賽）
  } else {
    toast(`${fmt(t)}（${fmtDelta(t - save.best)}）`, '');
  }
  writeSave();
  if (BOT) document.title = `BOT lap${lap} ${t.toFixed(3)} hits=${botHits}`;
  lap++;
  $('lap').textContent = String(lap);
  startLap();
}

function toast(text: string, cls: string) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'show ' + cls;
  toastUntil = performance.now() + 2600;
}

function ghostTimeAt(s: number): number | null {
  const g = save.ghost;
  if (!g || g.s.length < 2) return null;
  let lo = 0, hi = g.s.length - 1;
  if (s <= g.s[0] || s >= g.s[hi]) return null;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (g.s[m] < s) lo = m; else hi = m;
  }
  const f = (s - g.s[lo]) / (g.s[hi] - g.s[lo] || 1);
  return g.t[lo] + (g.t[hi] - g.t[lo]) * f;
}

// ---------------------------------------------------------------- 物理步進（固定 120 Hz）
const STEP = 1 / 120;
// ?bot：自動駕駛，給截圖與調整手感用（照建議速度開、看前方一點轉向）
const BOT = new URLSearchParams(location.search).has('bot');
let botHits = 0;
let lastHitSound = 0; // 碰撞音效冷卻：接觸期間每一步都會回報撞擊
function botInput() {
  const i = car.pos.i, N = track.N;
  const j = (i + Math.round((8 + car.v * 0.45) / track.ds)) % N;
  let err = Math.atan2(track.px[j] - car.x, track.pz[j] - car.z) - car.h;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const ahead = (i + Math.round((car.v * 0.5) / track.ds)) % N;
  return { steer: Math.max(-1, Math.min(1, -err * 2.5)), brake: car.v > track.vTarget[ahead] + 1 };
}
function step(dt: number) {
  const inp = BOT ? botInput() : input.read();
  const prevS = car.pos.s;
  // DRS：計時賽在 DRS 區隨時可開；正賽要在偵測點落後前車 1 秒內
  const zone = field.drsZoneAt(car.pos.s);
  if (zone < 0) { car.drs = false; car.ovt = false; }
  car.aeroZone = zone >= 0; // 2026：直線模式區段
  if (BOT) { drsPress = true; if (raceKind === 'gp' && (field.me.wear > 0.7 || (field.wet > 0.35 && field.me.compound !== RAIN)) && !field.me.pitReq && field.me.pitTimer <= 0 && field.laps - field.me.laps >= 1) pitPress = true; } // 測試用的駕駛：能開就開 DRS、胎磨太多就進站
  if (drsPress) {
    drsPress = false;
    if (raceKind === 'tt' && zone >= 0) { if (car.r26) { if (car.energy > 0.1) car.ovt = true; } else car.drs = true; }
    else if (raceKind === 'gp') field.playerDrs();
  }
  if (pitPress) { pitPress = false; if (raceKind === 'gp') toast(field.playerPit() ? '🔧 這圈結束進站' : '取消進站', ''); }
  const inPit = raceKind === 'gp' && field.me.pitTimer > 0;
  let impact = inPit ? 0 : car.update(dt, track, inp.steer, inp.brake);
  if (inPit) car.v = 0;
  if (raceKind === 'gp') {
    impact = Math.max(impact, field.update(dt, true));
    if (impact > 22) field.incident(); // 玩家重撞也可能出安全車
    if (SC_AT != null && field.raceTime >= SC_AT) field.incident(true); // 測試：&scat=秒數 強制出安全車
    for (const ev of field.events.splice(0)) gpEvent(ev);
    field.playerLap(prevS);
    const me = field.racers.find((r) => r.isPlayer)!;
    if (me.finish != null && state === 'race') { if (BOT && !new URLSearchParams(location.search).has('podium')) showResults(); else startPodium(); return; } // 測試：&podium 也播頒獎典禮
  }
  if (impact && performance.now() - lastHitSound > 250) { sound.hit(impact); lastHitSound = performance.now(); botHits++; }
  lapTime += dt;

  const s = car.pos.s, L = track.length;
  if (sectorIdx < 2 && prevS < bounds[sectorIdx] && s >= bounds[sectorIdx] && s - prevS < 30) {
    sectorDone(sectorIdx, lapTime - sectorStart);
    sectorStart = lapTime;
    sectorIdx++;
  }
  if (prevS > L - 40 && s < 40) {
    if (sectorIdx === 2) completeLap();
    else startLap(); // 沒有跑完整圈（倒退穿線等）就重新計時
  }

  recAcc += dt;
  if (recAcc >= 0.05) {
    recAcc -= 0.05;
    rec.t.push(+lapTime.toFixed(3));
    rec.s.push(+s.toFixed(2));
    rec.x.push(+car.x.toFixed(2));
    rec.z.push(+car.z.toFixed(2));
    rec.h.push(+car.h.toFixed(3));
  }

  // 反方向：車頭跟賽道方向相反太久就自動扶正
  const i = car.pos.i;
  const dot = Math.sin(car.h) * track.tx[i] + Math.cos(car.h) * track.tz[i];
  wrongWay = dot < -0.3 ? wrongWay + dt : 0;
  if (wrongWay > 2.5) { car.placeAt(track, i); wrongWay = 0; }

  warnText = '';
  if (wrongWay > 0.4) warnText = '反方向！';
  else if (opts.assist && !inp.brake) {
    const ahead = (i + Math.round((car.v * 0.7) / track.ds)) % track.N;
    if (car.v > track.vTarget[ahead] + 5) warnText = '煞車！';
  }

  // 這一步裡比賽結束了（排位賽跑完一圈會切到成績表）：別再把引擎聲打開，不然之後不再步進，聲音就一直卡著
  if (state !== 'race') return;
  const gear = gearOf(car.v);
  sound.setEngine('f1');
  sound.engine(gear.rpm, inp.brake ? 0.15 : 1, true);
}

const GEARS = [0, 17, 28, 38, 48, 57, 66, 75];
function gearOf(v: number) {
  let g = 0;
  while (g < GEARS.length - 1 && v >= GEARS[g + 1]) g++;
  const lo = GEARS[g], hi = g === GEARS.length - 1 ? VMAX : GEARS[g + 1];
  return { n: g + 1, rpm: 0.3 + 0.7 * Math.min(1, (v - lo) / (hi - lo)) };
}

// ---------------------------------------------------------------- 畫面
let camSnap = true;
// ?cam=x,y,z,看向x,y,z：固定鏡頭（截圖檢查街景用）
const CAM = new URLSearchParams(location.search).get('cam')?.split(',').map(Number) ?? null;
const VIEW_FRONT = new URLSearchParams(location.search).get('view') === 'front';
// ---------------------------------------------------------------- 大地圖與導航
// 🗺（電腦 M）開全螢幕地圖，點一下或選地標＝目的地；路上一排箭頭指路，偏離太多自動重新規劃
const navArrows = new NavArrows(scene);
let nav: { x: number; z: number; nm: string; path: [number, number][] | null; t: number } | null = null;
let mapOpen = false;
function setNav(x: number, z: number, nm?: string) {
  if (!nm) {
    let best = '地圖上的點', bd = 80;
    for (const l of landmarks) { const d = Math.hypot(l.x - x, l.z - z); if (d < bd) { bd = d; best = l.nm; } }
    nm = best;
  }
  nav = { x, z, nm, path: null, t: 99 };
  closeMap();
  toast(`🧭 導航到 ${nm}`, '');
}
function updateNav(dt: number) {
  if (!nav || !router) { navArrows.update(null, 0, 0, 0); $('nav-hud').style.display = 'none'; return; }
  nav.t += dt;
  const d = Math.hypot(nav.x - fcar.x, nav.z - fcar.z);
  // 偏離路線 25 m 以上、或每 6 秒，重新規劃
  let off = 0;
  if (nav.path) { off = Infinity; for (const [x, z] of nav.path) off = Math.min(off, Math.hypot(x - fcar.x, z - fcar.z)); }
  if (nav.t > 6 || off > 25) { nav.t = 0; nav.path = router.route(fcar.x, fcar.z, nav.x, nav.z)?.path ?? null; }
  if (d < 25) { toast(`🏁 抵達 ${nav.nm}`, 'purple'); nav = null; navArrows.update(null, 0, 0, 0); $('nav-hud').style.display = 'none'; return; }
  navArrows.update(nav.path, fcar.x, fcar.z, performance.now() / 1000);
  let len = 0;
  if (nav.path) for (let i = 1; i < nav.path.length; i++) len += Math.hypot(nav.path[i][0] - nav.path[i - 1][0], nav.path[i][1] - nav.path[i - 1][1]);
  const el = $('nav-hud');
  el.style.display = '';
  el.textContent = `🧭 ${nav.nm}　${(len || d) >= 1000 ? `${((len || d) / 1000).toFixed(1)} km` : `${Math.round(len || d)} m`}`;
}
function openMap() {
  if (!bigmap || state !== 'free') return;
  mapOpen = true;
  $('map-page').classList.remove('hidden');
  bigmap.setZoom(bigmap.zoom);
  bigmap.focus(fcar.x, fcar.z);
}
function closeMap() { mapOpen = false; $('map-page').classList.add('hidden'); }
function buildMapShortcuts() {
  const box = $('map-marks');
  const want = ['台北101', '臺北市政府', '國父紀念館', '臺北大巨蛋', '臺北小巨蛋', '臺北國際會議中心', '捷運象山站', '臺北市議會'];
  // 往西擴的地標：有些不在地標清單裡（太小、或名字太長），直接給座標
  const west: [string, number, number][] = [['中正紀念堂', -4063, 311], ['總統府', -5045, -276], ['台北車站', -4527, -1130], ['西門町', -5560, -470], ['北門', -5121, -1131]];
  const addBtn = (label: string, x: number, z: number, nm: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => setNav(x, z, nm));
    box.appendChild(b);
  };
  for (const nm of want) {
    const l = landmarks.find((m) => m.nm === nm);
    if (l) addBtn(nm.replace(/^臺北/, ''), l.x, l.z, l.nm);
  }
  for (const [nm, x, z] of west) addBtn(nm, x, z, nm);
  if (bigmap) bigmap.areas = west;
}
$('btn-map').addEventListener('click', openMap);
$('map-close').addEventListener('click', closeMap);
$('map-in').addEventListener('click', () => bigmap?.setZoom(bigmap.zoom * 1.6));
$('map-out').addEventListener('click', () => bigmap?.setZoom(bigmap.zoom / 1.6));
$('map-all').addEventListener('click', () => bigmap?.showAll());
$('map-clear').addEventListener('click', () => { nav = null; closeMap(); });
addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) { if (mapOpen) closeMap(); else openMap(); } });

// 鏡頭：車後追蹤／車內（📷 按鈕、電腦 C）；車內時藏起車身，畫面疊上儀表板與雨刷（cockpit.ts）
let camView: 'chase' | 'cockpit' = new URLSearchParams(location.search).get('view') === 'cockpit' ? 'cockpit' : 'chase';
const cockpit = new Cockpit($<HTMLCanvasElement>('cockpit'));
const damage = new Damage(scene); // 車損（damage.ts）：自由駕駛、計程車、街頭比賽都算
// 成就與統計（achievements.ts）
const stats: Stats = { ...emptyStats(), ...save.stats };
save.stats = stats;
save.ach ??= [];
let statAcc = 0, statSave = 0, lastKnocked = -1;
function tickStats(dt: number) {
  if (state !== 'free' && state !== 'race') return;
  const v = Math.abs(veh().v);
  stats.dist += v * dt;
  if (weather.night) stats.nightDist += v * dt;
  stats.topSpeed = Math.max(stats.topSpeed, v * 3.6);
  stats.playTime += dt;
  const kn = breakables?.knocked ?? 0;
  if (lastKnocked >= 0 && kn > lastKnocked) stats.knocked += kn - lastKnocked;
  lastKnocked = kn;
  statAcc += dt; statSave += dt;
  if (statAcc > 1) {
    statAcc = 0;
    for (const a of newlyUnlocked(stats, save.ach!)) {
      save.ach!.push(a.id);
      toast(`🏆 成就解鎖：${a.icon} ${a.name}`, 'purple');
      sound.beep(1180, 0.3);
      statSave = 99;
    }
  }
  if (statSave > 5) { statSave = 0; writeSave(); }
}
initLeaderboard(toast, fmt);
$('btn-ach').addEventListener('click', () => {
  $('ach-body').innerHTML = renderAchPage(stats, save.ach ?? []);
  $('ach-page').classList.remove('hidden');
});
$('ach-close').addEventListener('click', () => $('ach-page').classList.add('hidden'));
if (new URLSearchParams(location.search).get('dmg')) damage.value = +new URLSearchParams(location.search).get('dmg')!; // 測試：&dmg=0.8
// 駕駛的眼睛在車上的位置（本地座標：x 往左、y 往上、z 往前；台灣駕駛座在左邊）
const EYE: Record<string, [number, number, number]> = { sedan: [0.38, 1.2, 0.15], taxi: [0.38, 1.2, 0.15], police: [0.38, 1.2, 0.15], muscle: [0.4, 1.12, -0.1], super: [0.38, 0.98, -0.25], pickup: [0.4, 1.66, 1.5], f1: [0, 0.98, -0.05] };
function toggleCam() { camView = camView === 'chase' ? 'cockpit' : 'chase'; camSnap = true; }
$('btn-cam').addEventListener('click', toggleCam);
addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.repeat && (state === 'free' || state === 'race' || state === 'countdown')) toggleCam(); });
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camH = 0;

// 選單背景的運鏡：四個鏡位輪流（每個 10 秒），都在起點與 101 附近（開場就載好的區塊）
// ?menucam=2 固定在第 2 個鏡位（截圖用）；?nomenucam 關掉
const MENU_CAM_OFF = new URLSearchParams(location.search).has('nomenucam');
const MENU_CAM_FIX = new URLSearchParams(location.search).get('menucam');
const SHOT_LEN = 10;
let menuT = 0;
function menuCamera(dt: number) {
  menuT += dt;
  const shot = MENU_CAM_FIX != null ? +MENU_CAM_FIX : Math.floor(menuT / SHOT_LEN) % 4, u = (menuT % SHOT_LEN) / SHOT_LEN;
  const N = track.N, T = circuitEnv ? { x: circuitEnv.center.x, z: circuitEnv.center.z } : TOWER_101;
  const big = circuitEnv ? circuitEnv.extent : 0; // 各國賽道：繞整條賽道拍（沒有 101）
  // 賽道上第 i 點（可以是小數）
  const at = (i: number) => { const k = ((Math.floor(i) % N) + N) % N, j = (k + 1) % N, f = i - Math.floor(i); return [track.px[k] + (track.px[j] - track.px[k]) * f, track.pz[k] + (track.pz[j] - track.pz[k]) * f]; };
  const ds = Math.hypot(track.px[1] - track.px[0], track.pz[1] - track.pz[0]) || 2; // 取樣間距
  let fov = 50;
  if (shot === 0) {
    // 沿著賽道低空往前推，看向前方
    const i = (8 + u * 16 * SHOT_LEN) / ds, [x, z] = at(i), [lx, lz] = at(i + 40 / ds);
    camera.position.set(x, 1.8 + heightAt(track, i * ds), z);
    camera.lookAt(lx, 2.4 + heightAt(track, (i + 40 / ds) * ds), lz);
    fov = 58;
  } else if (shot === 1) {
    // 環繞 101：高空慢慢繞
    const a = 2.2 + u * 0.55, R = big ? big * 0.6 : 560;
    camera.position.set(T.x + Math.cos(a) * R, big ? big * 0.28 + track.py[0] : 150, T.z + Math.sin(a) * R);
    camera.lookAt(T.x, big ? 0 : 170, T.z);
    fov = 46;
  } else if (shot === 2) {
    // 101 從低空斜看：一邊慢慢升高、一邊繞一點（仰角不要太大，會看到天空球頂）
    if (big) {
      // 主看台、維修區那段直線：從賽道外側斜看起跑線
      const i0 = 0, a = 0.6 + u * 0.5;
      camera.position.set(track.px[i0] + Math.cos(a) * 90, 22 + track.py[i0], track.pz[i0] + Math.sin(a) * 90);
      camera.lookAt(track.px[i0], 2 + track.py[i0], track.pz[i0]);
    } else {
      const a = 4.0 + u * 0.3, R = 680;
      camera.position.set(T.x + Math.cos(a) * R, 30 + u * 40, T.z + Math.sin(a) * R);
      camera.lookAt(T.x, 210, T.z);
    }
    fov = 48;
  } else {
    // 沿賽道高空飛越，看前方的路
    const i = (N * 0.5 + u * 30 * SHOT_LEN / ds), [x, z] = at(i), [lx, lz] = at(i + 320 / ds);
    camera.position.set(x, 120 + heightAt(track, i * ds), z);
    camera.lookAt(lx, 10 + heightAt(track, (i + 320 / ds) * ds), lz);
    fov = 55;
  }
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camSnap = true; // 離開選單時鏡頭直接跳回車後
}
function updateVisuals(dt: number) {
  // 車子
  // 街道賽、街頭比賽都開 F1；平常自由駕駛、計程車開選單選的車
  const f1Look = mode === 'race' || streetRacing();
  const pv = pcar(), vc = veh(), model = f1Look ? carModel : pv.model;
  carModel.root.visible = f1Look;
  for (const p of playerCars.values()) p.model.root.visible = !f1Look && p === pv;
  if (pv.taxiSign) pv.taxiSign.visible = taxiOn(); // 開別台車載客：車頂加 TAXI 燈箱
  pv.tick(performance.now() / 1000);
  world.race.visible = mode === 'race' || !!CIRCUIT; // 各國賽道：選單時也看得到賽道
  if (traffic) {
    traffic.visible = mode === 'free';
    if (mode === 'free') traffic.render(dt);
  }
  if (mode === 'race' && raceKind === 'gp') field.render(dt);
  // 安全車：在領先者前面 35 m 帶隊，車頂黃燈閃
  const scOn = mode === 'race' && raceKind === 'gp' && field.sc.phase !== 'off' && (state === 'race' || state === 'paused');
  scCar.model.root.visible = scOn;
  if (scOn) {
    const i = Math.floor(field.sc.s / track.ds) % track.N;
    scCar.model.root.position.set(track.px[i], track.py[i], track.pz[i]);
    scCar.model.root.rotation.set(-Math.atan(track.grade[i]), Math.atan2(track.tx[i], track.tz[i]), 0, 'YXZ');
    const on = Math.floor(performance.now() / 250) % 2 === 0;
    scLights[0].color.set(on ? '#ffb000' : '#3a2600');
    scLights[1].color.set(on ? '#3a2600' : '#ffb000');
  }
  if (sr && mode === 'free') sr.render(dt);
  trains?.update(dt);
  // 下雨：路人撐傘、路上積水、開過去噴水花
  if (peds) peds.raining = weather.raining;
  if (rainfx) {
    rainfx.update(dt, weather.raining && mode === 'free', fcar);
    if (rainfx.splash) sound.splash(rainfx.splash);
  }
  if (police) { if (mode === 'free') police.render(dt, performance.now() / 1000); else police.hide(); }
  // 街道賽封路：挑戰光柱、紅綠燈、賽道旁的路名牌都不出現（會擋視線）
  sr?.showMarkers(mode === 'free' && !taxiOn());
  taxi?.render(performance.now() / 1000);
  if (traffic) traffic.signalsVisible = mode === 'free';
  for (const o of raceHide) { o.userData.off = mode !== 'free'; o.visible = !o.userData.off && o.userData.inRange !== false; }
  breakables?.update(dt, vc.x, vc.z);
  if (peds) {
    peds.visible = mode === 'free';
    if (mode === 'free') peds.render();
  }
  const ry = mode === 'race' ? track.py[car.pos.i] : 0; // 各國賽道的高低起伏
  model.root.position.set(vc.x, mode === 'free' ? -0.25 : ry, vc.z); // 城市道路比賽道路面低 0.25 m
  model.root.rotation.set(mode === 'race' ? -Math.atan(track.grade[car.pos.i]) : 0, vc.h, 0, 'YXZ'); // 上坡車頭抬起來
  model.body.rotation.z = vc.steer * Math.min(1, Math.abs(vc.v) / 40) * (mode === 'race' ? 0.04 : 0.06);
  for (const w of model.steer) w.rotation.y = -vc.steer * 0.45;
  for (const w of model.spin) w.rotation.x += (vc.v / 0.35) * dt;

  // 影子車
  const g = save.ghost;
  const showGhost = opts.ghost && g && g.t.length > 1 && state === 'race' && raceKind === 'tt';
  ghostModel.root.visible = !!showGhost;
  if (showGhost && g) {
    while (ghostPtr < g.t.length - 2 && g.t[ghostPtr + 1] < lapTime) ghostPtr++;
    const a = ghostPtr, b = ghostPtr + 1;
    const f = Math.max(0, Math.min(1, (lapTime - g.t[a]) / (g.t[b] - g.t[a] || 1)));
    let dh = g.h[b] - g.h[a];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    ghostModel.root.position.set(g.x[a] + (g.x[b] - g.x[a]) * f, 0.02 + heightAt(track, g.s[a]), g.z[a] + (g.z[b] - g.z[a]) * f);
    ghostModel.root.rotation.y = g.h[a] + dh * f;
    if (lapTime > g.t[g.t.length - 1]) ghostModel.root.visible = false;
  }

  // 追蹤鏡頭：車頭方向平滑跟隨，速度越快視野越寬
  let d = vc.h - camH;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  camH += camSnap ? d : d * Math.min(1, dt * 7);
  const fx = Math.sin(camH), fz = Math.cos(camH);
  const lowCar = f1Look || chosen.id === 'f1', back = lowCar ? 8 : chosen.id === 'pickup' ? 8 : 7.5, up = lowCar ? 2.9 : chosen.id === 'pickup' ? 3.7 : 3.3;
  const target = new THREE.Vector3(vc.x - fx * back, up + ry, vc.z - fz * back);
  const look = new THREE.Vector3(vc.x + fx * 6, 1.2 + ry, vc.z + fz * 6);
  if (camSnap) { camPos.copy(target); camLook.copy(look); camSnap = false; }
  const k = Math.min(1, dt * 10);
  camPos.lerp(target, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  const fov = 62 + Math.min(1, Math.abs(vc.v) / (mode === 'race' ? VMAX : fcar.spec.vmax)) * 14;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  // 車內視角
  const inCar = camView === 'cockpit' && (state === 'free' || state === 'race' || state === 'countdown') && !CAM;
  model.body.visible = !inCar;
  for (const w of [...model.steer, ...model.spin]) w.visible = !inCar;
  model.root.traverse((o) => { if (o.userData.lens) o.visible = !inCar; });
  if (mode === 'free' && state === 'free') damage.update(dt, model, f1Look ? '#d40000' : save.paint?.[chosen.id] ?? pv.baseColor, vc.x, -0.25, vc.z, vc.h);
  if (inCar) {
    const [ex, ey, ez] = EYE[f1Look ? 'f1' : chosen.id] ?? EYE.sedan;
    const hx = Math.sin(vc.h), hz = Math.cos(vc.h), lx = Math.cos(vc.h), lz = -Math.sin(vc.h); // 前、左
    const base = mode === 'free' ? -0.25 : ry;
    camera.position.set(vc.x + lx * ex + hx * ez, base + ey, vc.z + lz * ex + hz * ez);
    camera.lookAt(vc.x + lx * ex + hx * 30, base + ey - 0.8, vc.z + lz * ex + hz * 30);
    if (Math.abs(camera.fov - 72) > 0.05) { camera.fov = 72; camera.updateProjectionMatrix(); }
    cockpit.draw(dt, f1Look || chosen.id === 'f1', weather.raining, vc.v, vc.steer);
  } else cockpit.hide();
  if (state === 'menu' && cityReady && !CAM && !VIEW_FRONT && !MENU_CAM_OFF) menuCamera(dt);
  if (CAM) { camera.position.set(CAM[0], CAM[1], CAM[2]); camera.lookAt(CAM[3], CAM[4], CAM[5]); }
  if (VIEW_FRONT) { // 截圖檢查車子外型：從左前方斜看
    const sx = Math.cos(vc.h), sz = -Math.sin(vc.h);
    camera.position.set(vc.x + fx * 5.2 + sx * 3.2, 1.7, vc.z + fz * 5.2 + sz * 3.2);
    camera.lookAt(vc.x, 1.9, vc.z);
  }
  world.sky.position.copy(camera.position);
  world.mountains.position.y = -camera.position.y;
  if (Q.shadows && world.sun.castShadow) {
    // 陰影範圍的中心在車子前方一點；對齊陰影貼圖的格子，移動時陰影邊緣才不會閃
    const step = (Q.shadowRange * 2) / Q.shadowSize;
    const cx = Math.round((vc.x + Math.sin(vc.h) * 25) / step) * step, cz = Math.round((vc.z + Math.cos(vc.h) * 25) / step) * step;
    world.sun.target.position.set(cx, 0, cz);
    world.sun.position.set(cx, 0, cz).addScaledVector(world.sunDir, 500);
    world.sun.target.updateMatrixWorld();
  }

  // HUD
  if (state === 'free') updateFreeHud(dt);
  if (state === 'race' || state === 'countdown') {
    $('time').textContent = fmt(lapTime);
    if (raceKind === 'gp') updateGpHud();
    $('speed').textContent = String(Math.round(car.v * 3.6));
    $('gear').textContent = car.v < 0.5 ? 'N' : String(gearOf(car.v).n);
    const w = $('warn');
    if (w.textContent !== warnText) { w.textContent = warnText; w.className = warnText ? 'show' : ''; }
    const now = performance.now();
    if (toastUntil && now > toastUntil) { $('toast').className = ''; toastUntil = 0; }
    if (clearSectorsAt && now > clearSectorsAt) {
      for (let s = 0; s < 3; s++) $('s' + s).className = '';
      $('delta').textContent = '';
      clearSectorsAt = 0;
    }
    deltaAcc += dt;
    if (deltaAcc > 0.15 && state === 'race' && !clearSectorsAt) {
      deltaAcc = 0;
      const gt = ghostTimeAt(car.pos.s);
      const el = $('delta');
      if (gt != null && lapTime > 3) {
        const dd = lapTime - gt;
        el.textContent = fmtDelta(dd);
        el.className = dd <= 0 ? 'good' : 'bad';
      }
    }
  }
}

// ---------------------------------------------------------------- 起跑燈
const lights = Array.from($('lights').children) as HTMLElement[];
function updateCountdown(dt: number) {
  countdown += dt;
  const lit = Math.min(5, Math.floor(countdown));
  if (lit !== litShown) {
    litShown = lit;
    lights.forEach((l, n) => l.classList.toggle('on', n < lit));
    world.setStartLights(lit);
    if (lit > 0) sound.beep(440);
  }
  sound.engine(0.25 + (lit / 5) * 0.3, 0.4, true);
  if (countdown >= lightsOutAt) {
    lights.forEach((l) => l.classList.remove('on'));
    world.setStartLights(0);
    circuitEnv?.crowd.cheer(1); // 燈號熄滅：全場歡呼
    $('lights').classList.add('go');
    setTimeout(() => $('lights').classList.remove('go'), 900);
    sound.beep(880, 0.35);
    state = 'race';
  }
}

function beginCountdown() {
  resetRace();
  world.setStartLights(0); // 倒數到一半離開的話燈還亮著
  // 比賽規則（設定頁）：經典＝DRS；2026＝主動空力＋電池＋超車模式
  field.rules = (new URLSearchParams(location.search).get('rules') ?? $<HTMLSelectElement>('opt-rules').value) === '2026' ? '2026' : 'classic';
  hud.dataset.rules = field.rules;
  $('drs').textContent = field.rules === '2026' ? '超車' : 'DRS';
  if (raceKind === 'gp') {
    // 發車格：剛跑完的排位賽（或上一場的）；沒跑排位就從第 10 格起跑
    const grid = qualiGrid ?? lastGrid;
    lastGrid = grid;
    qualiGrid = null;
    const wx = (BOT ? new URLSearchParams(location.search).get('gpwx') ?? 'dry' : $<HTMLSelectElement>('opt-gpwx').value) as GpWeather;
    field.setup(9, +$<HTMLSelectElement>('opt-tyre').value, +$<HTMLSelectElement>('opt-laps').value, grid ?? undefined, wx);
    if (new URLSearchParams(location.search).has('sc')) field.scChance = 1; // 測試：重撞一定出安全車
    if (new URLSearchParams(location.search).get('rainat')) field.rainAt = +new URLSearchParams(location.search).get('rainat')!; // 測試：比賽第幾秒開始下雨
    setRaceRain(field.wet > 0);
    radio.reset(PLAYER_LIVERY.main);
    lastPos = -1;
    scBanner('');
    field.ttMode = false;
    $('lap').textContent = `0/${field.laps}`;
  } else { field.hide(); field.ttMode = true; }
  car.drs = false;
  car.gripMul = 1;
  car.r26 = field.rules === '2026';
  car.energy = 1;
  car.ovt = false;
  hud.dataset.kind = raceKind;
  countdown = 0;
  litShown = 0;
  lightsOutAt = 5.4 + Math.random() * 1.2; // 五燈全亮後隨機停一下才熄，跟真的一樣
  state = 'countdown';
}

// ---------------------------------------------------------------- 選單
const menu = $('menu'), hud = $('hud');
// ---------------------------------------------------------------- 錢包與車庫
// 錢包就是計程車的收入（save.taxi.money）；街頭對決、正賽拿名次也有獎金
function money() { return taxi ? taxi.money : save.taxi?.money ?? 0; }
function setMoney(n: number) {
  if (taxi) taxi.money = n;
  save.taxi = { money: n, trips: taxi?.trips ?? save.taxi?.trips ?? 0 };
  writeSave();
  refreshGarage();
}
function earn(n: number, why: string) {
  if (n <= 0) return;
  stats.earned += n;
  setMoney(money() + n);
  toast(`💰 ${why} 獎金 NT$ ${n.toLocaleString()}`, '');
}
// 選車：點車子看介紹；已經有的直接換上，沒有的顯示購買按鈕
let preview: Vehicle = chosen;
const garage3d = new GaragePreview($<HTMLCanvasElement>('car-3d')); // 車庫分頁的 3D 預覽
const fmtNT = (n: number) => `NT$ ${n.toLocaleString()}`;
function refreshGarage() {
  const list = $('car-list'), have = ownedCars(), m = money();
  $('wallet').textContent = fmtNT(m);
  garage3d.show(preview);
  for (const b of list.children) {
    const id = (b as HTMLElement).dataset.id!, v = vehicleById(id);
    b.classList.toggle('on', id === preview.id);
    b.classList.toggle('mine', id === chosen.id);
    b.classList.toggle('locked', !have.has(id));
    b.querySelector('small')!.textContent = have.has(id) ? '' : `🔒 ${v.price.toLocaleString()}`;
  }
  // 車子介紹：名稱、說明、四項性能長條（0~100 分）
  const s = preview.spec, kmh = Math.round(s.vmax * 3.6 * 0.9);
  const f01 = (x: number, lo: number, hi: number) => Math.max(0.06, Math.min(1, (x - lo) / (hi - lo)));
  const bar = (label: string, f: number, txt: string) => `<div class="m-stat"><span>${label}</span><i style="--f:${(f * 100).toFixed(0)}%"></i><em>${txt}</em></div>`;
  const score = (f: number) => String(Math.round(f * 100));
  const fa = f01(s.engine, 5, 15), fg = f01(s.grip, 10, 24), fm = f01(s.mass, 0.4, 1.6);
  $('car-note').innerHTML = `<b class="m-cn">${preview.name}</b><span class="m-cd">${preview.note}</span>`
    + bar('極速', f01(kmh, 100, 340), `${kmh} km/h`) + bar('加速', fa, score(fa)) + bar('操控', fg, score(fg)) + bar('重量', fm, score(fm));
  const buy = $<HTMLButtonElement>('car-buy');
  const owned = have.has(preview.id);
  buy.style.display = owned ? 'none' : '';
  if (!owned) {
    buy.disabled = m < preview.price;
    buy.textContent = m >= preview.price ? `購買 ${preview.name}（${fmtNT(preview.price)}）` : `${preview.name} ${fmtNT(preview.price)}：還差 ${fmtNT(preview.price - m)}（開計程車、贏比賽賺錢）`;
  }
  // 烤漆：自己的車才能換；小黃是計程車，不換色
  const pl = $('paint-list');
  pl.innerHTML = '';
  pl.style.display = owned && preview.id !== 'taxi' ? '' : 'none';
  if (owned && preview.id !== 'taxi') {
    const pv = playerCars.get(preview.id as VehicleId)!, cur = save.paint?.[preview.id] ?? pv.baseColor, bought = new Set(save.paints?.[preview.id] ?? []);
    const label = document.createElement('span');
    label.textContent = '烤漆';
    pl.appendChild(label);
    for (const c of [pv.baseColor, ...PAINTS.filter((p) => p !== pv.baseColor)]) {
      const sw = document.createElement('button');
      const free = c === pv.baseColor || bought.has(c);
      sw.style.background = c;
      sw.className = (c === cur ? 'on ' : '') + (free ? '' : 'locked');
      sw.title = free ? '換上' : `${fmtNT(PAINT_PRICE)}`;
      sw.addEventListener('click', () => {
        if (!free) {
          if (money() < PAINT_PRICE) { $('car-note').textContent = `烤漆 ${fmtNT(PAINT_PRICE)}，還差 ${fmtNT(PAINT_PRICE - money())}`; return; }
          save.paints = { ...save.paints, [preview.id]: [...bought, c] };
          setMoney(money() - PAINT_PRICE);
        }
        save.paint = { ...save.paint, [preview.id]: c };
        pv.setPaint(c);
        damage.refreshPaint();
        writeSave();
        refreshGarage();
      });
      pl.appendChild(sw);
    }
    const tip = document.createElement('small');
    tip.textContent = `每色 ${fmtNT(PAINT_PRICE)}，買過就能隨時換`;
    pl.appendChild(tip);
  }
}
{
  const list = $('car-list');
  for (const v of VEHICLES) {
    const b = document.createElement('button');
    b.dataset.id = v.id;
    b.innerHTML = `<i style="background:${v.color}"></i>${v.name}<small></small>`;
    b.addEventListener('click', () => {
      preview = v;
      if (ownedCars().has(v.id)) { chosen = v; save.car = v.id; writeSave(); }
      refreshGarage();
    });
    list.appendChild(b);
  }
  $('car-buy').addEventListener('click', () => {
    if (ownedCars().has(preview.id) || money() < preview.price) return;
    save.owned = [...(save.owned ?? []), preview.id];
    chosen = preview;
    save.car = preview.id;
    setMoney(money() - preview.price);
    toast(`🚗 買下 ${preview.name}！`, '');
  });
  refreshGarage();
}
// 選單分頁：開始／車庫／設定／紀錄
function menuTab(t: string) {
  for (const b of document.querySelectorAll<HTMLElement>('.m-tabs button')) b.classList.toggle('on', b.dataset.tab === t);
  for (const p of document.querySelectorAll<HTMLElement>('.m-pane')) p.classList.toggle('on', p.dataset.pane === t);
  document.querySelector('.m-main')?.scrollTo(0, 0);
}
for (const b of document.querySelectorAll<HTMLElement>('.m-tabs button')) b.addEventListener('click', () => menuTab(b.dataset.tab!));
// 賽道：台北信義街道賽＋2026 賽曆 23 站；換賽道＝帶 ?circuit= 重新載入
{
  const sel = $<HTMLSelectElement>('circuit-pick');
  const opt = (v: string, text: string) => { const o = document.createElement('option'); o.value = v; o.textContent = text; sel.appendChild(o); };
  opt('', '🇹🇼 台北街道賽｜信義區真實街道');
  CIRCUITS.forEach((c, k) => opt(c.id, `${String(k + 1).padStart(2, '0')} ${c.flag} ${c.gp}｜${c.name}`));
  sel.value = CIRCUIT?.id ?? '';
  sel.addEventListener('change', () => { location.search = sel.value ? `?circuit=${sel.value}` : ''; });
  const info = $('circuit-info');
  if (CIRCUIT && circuitData) {
    const f = circuitData.info, rec = f.lapRecord;
    info.innerHTML = '';
    const line = (k: string, v: string) => { const d = document.createElement('div'); const b = document.createElement('small'); b.textContent = k; const e = document.createElement('b'); e.textContent = v; d.append(b, e); info.appendChild(d); };
    line('地點', CIRCUIT.place);
    line('長度', `${(f.lengthKm ?? circuitData.lengthM / 1000).toFixed(3)} km`);
    line('彎道', f.turns != null ? `${f.turns} 個・${circuitData.direction === 'clockwise' ? '順時針' : '逆時針'}` : '—');
    line('首屆大獎賽', f.firstGp != null ? String(f.firstGp) : '—');
    if (rec) line('單圈紀錄', `${rec.time}（${rec.driver}，${rec.year}）`);
    if (f.corners?.length) line('知名彎道', f.corners.slice(0, 4).join('、'));
    document.querySelector('[data-pane="play"] .m-eyebrow')!.textContent = `${CIRCUIT.flag} ${CIRCUIT.gp} · ${CIRCUIT.place}`;
  } else info.style.display = 'none';
}
if (!BOT) setupInstall($('m-install')); // 「加到主畫面」提示（install.ts）
function showMenu(paused: boolean) {
  $('menu-best').textContent = save.best != null ? `街道賽最快圈 ${fmt(save.best)}` : '';
  const free = $<HTMLButtonElement>('btn-free'), race = $<HTMLButtonElement>('btn-start');
  free.disabled = race.disabled = !cityReady;
  $('btn-resume').style.display = paused ? '' : 'none';
  $('free-label').textContent = !cityReady ? '載入台北街景中…' : '自由駕駛';
  race.style.display = cityReady ? '' : 'none';
  for (const id of ['btn-gp', 'btn-duel', 'btn-taxi']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = !cityReady;
    b.style.display = cityReady ? '' : 'none';
  }
  $('free-reset').hidden = !!CIRCUIT || !validFreePos(save.freePos) || !cityReady; // 有記住的位置才顯示「從 101 出發」
  // 各國賽道：沒有城市，自由駕駛、計程車、街頭對決不能玩
  if (CIRCUIT) for (const id of ['btn-free', 'btn-taxi', 'btn-duel']) $(id).style.display = 'none';
  $('menu-best').textContent = save.best != null ? `${CIRCUIT ? CIRCUIT.name : '街道賽'}最快圈 ${fmt(save.best)}` : '';
  updateSeasonUi();
  menu.classList.remove('hidden');
  hud.classList.add('hidden');
}
function hideMenu() {
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  hud.dataset.mode = mode;
}
async function userStart() {
  sound.start();
  if (steerMode === 'tilt') {
    const ok = await input.enableTilt();
    if (!ok) toast('無法使用陀螺儀，改用觸控轉向', '');
  }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (!document.fullscreenElement && el.requestFullscreen && TOUCH) {
      await el.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    }
  } catch { /* iPhone 沒有全螢幕 API，略過 */ }
}
$('btn-start').addEventListener('click', async () => {
  await userStart();
  taxi?.stop();
  mode = 'race';
  raceKind = 'tt';
  hideMenu();
  beginCountdown();
});
async function startGp() {
  await userStart();
  taxi?.stop();
  mode = 'race';
  lastGrid = null;
  if (opts.quali) { startQuali(); return; }
  raceKind = 'gp';
  hideMenu();
  beginCountdown();
}
$('btn-gp').addEventListener('click', startGp);

// ---------------------------------------------------------------- 賽季模式（season.ts）
const SEASON = new URLSearchParams(location.search).has('season');
const teamOf = (name: string) => field.racers.find((r) => r.name === name)?.team ?? '';
const seasonDone = () => !!save.season && save.season.round >= CIRCUITS.length;
/** 現在這個頁面是不是賽季目前要跑的那一站 */
const inSeasonRound = () => SEASON && !!CIRCUIT && !!save.season && CIRCUITS[save.season.round]?.id === CIRCUIT.id;
if (BOT && SEASON && CIRCUIT && !save.season) save.season = { round: CIRCUITS.indexOf(CIRCUIT), results: [] }; // 測試：直接從這一站開始賽季
const goSeasonRound = () => { location.search = `?circuit=${CIRCUITS[save.season!.round].id}&season=1`; };
function updateSeasonUi() {
  const ss = save.season;
  $('season-sub').textContent = !ss ? '2026 賽曆 23 站 · 累積車手與車隊積分' : seasonDone() ? '賽季完成！再開新的一季' : `繼續：${roundName(ss.round)}`;
  const banner = $('season-banner');
  banner.hidden = !inSeasonRound();
  if (inSeasonRound()) {
    const rows = driverStandings(ss!, teamOf), k = rows.findIndex((r) => r.name === '你');
    banner.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = `🏆 2026 賽季 第 ${ss!.round + 1} / ${CIRCUITS.length} 站`;
    banner.append(b, document.createTextNode(k >= 0 ? `　你目前第 ${k + 1} 名、${rows[k].pts} 分（按「大獎賽」或「賽季模式」開始這一站）` : '　按「大獎賽」或「賽季模式」開始這一站'));
  }
}
$('btn-season').addEventListener('click', () => {
  if (!save.season || seasonDone()) { save.season = { round: 0, results: [] }; writeSave(); }
  if (inSeasonRound()) void startGp(); else goSeasonRound();
});
function showSeasonPage() {
  const ss = save.season ?? { round: 0, results: [] };
  const rows = driverStandings(ss, teamOf);
  $('season-title').textContent = seasonDone() ? `🏆 2026 年度冠軍：${rows[0]?.name ?? ''}` : '2026 賽季';
  $('season-page-sub').textContent = !save.season ? '還沒開始賽季：按「賽季模式」從澳洲站開始' : seasonDone() ? `23 站全部比完。你是第 ${rows.findIndex((r) => r.name === '你') + 1} 名` : `已比完 ${ss.round} 站，下一站：${roundName(ss.round)}`;
  $('season-drivers').innerHTML = standingsHtml(rows, '你');
  $('season-teams').innerHTML = '<tr><th>名次</th><th>車隊</th><th></th><th>積分</th></tr>' + teamStandings(rows).map((t, k) => `<tr><td>${k + 1}</td><td>${t.team}</td><td></td><td>${t.pts}</td></tr>`).join('');
  $('season-continue').style.display = save.season && !seasonDone() ? '' : 'none';
  $('season-page').classList.remove('hidden');
}
$('btn-season-table').addEventListener('click', showSeasonPage);
$('season-close').addEventListener('click', () => $('season-page').classList.add('hidden'));
$('season-continue').addEventListener('click', () => { $('season-page').classList.add('hidden'); if (inSeasonRound()) void startGp(); else goSeasonRound(); });
$('season-reset').addEventListener('click', () => { if (!confirm('重新開始賽季？目前的積分會清掉')) return; save.season = { round: 0, results: [] }; writeSave(); goSeasonRound(); });
$('btn-next-round').addEventListener('click', () => { if (seasonDone()) location.search = '?showseason=1'; else goSeasonRound(); });
if (new URLSearchParams(location.search).has('showseason')) setTimeout(showSeasonPage, 300);
/** 正賽結束：記下這一站的名次、更新積分榜、成績表下面顯示積分與「下一站」 */
function recordSeason(st: Racer[]) {
  const box = $('season-res'), next = $<HTMLButtonElement>('btn-next-round'), again = $('btn-again');
  if (!(inSeasonRound() && raceKind === 'gp')) { box.hidden = true; next.style.display = 'none'; again.style.display = ''; return; }
  const ss = save.season!;
  ss.results.push({ id: CIRCUIT!.id, order: st.map((r) => r.name) });
  ss.round++;
  writeSave();
  const rows = driverStandings(ss, teamOf), me = st.findIndex((r) => r.isPlayer);
  $('season-res-title').textContent = seasonDone() ? `🏆 賽季結束！年度冠軍 ${rows[0].name}（${rows[0].team}）` : `這一站 +${POINTS[me] ?? 0} 分　車手積分榜（${ss.round} / ${CIRCUITS.length} 站）`;
  $('season-res-table').innerHTML = standingsHtml(rows, '你', 10);
  box.hidden = false;
  again.style.display = 'none'; // 賽季中同一站不能重比
  next.style.display = '';
  next.textContent = seasonDone() ? '看完整積分榜 ›' : `下一站：${roundName(ss.round)} ›`;
}
$('btn-again').addEventListener('click', async () => {
  await userStart();
  $('results').classList.add('hidden');
  hideMenu();
  beginCountdown();
});
$('btn-menu').addEventListener('click', () => {
  $('results').classList.add('hidden');
  state = 'menu';
  setRaceRain(false);
  sound.engine(0, 0, false);
  sound.sirenAt(0, 0);
  showMenu(false);
});

// ---------------------------------------------------------------- 排位賽、安全車、無線電、天氣、頒獎台
const QUALI_TEST = new URLSearchParams(location.search).has('quali');
const SC_AT = new URLSearchParams(location.search).get('scat') != null ? +new URLSearchParams(location.search).get('scat')! : null;
let qualiRun = false, qualiGrid: Racer[] | null = null, lastGrid: Racer[] | null = null, QUALI_POS: number | null = null;
const radio = new TeamRadio($('radio'));
radio.onSay = () => sound.beep(1500, 0.05);
let lastPos = -1, radioAcc = 0;
// 安全車：超跑造型、銀色，車頂兩顆輪流閃的黃燈
const scCar = buildPlayerVehicle(vehicleById('super'));
scCar.setPaint('#d9dde2');
const scLights = [new THREE.MeshBasicMaterial({ color: '#ffb000', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#3a2600', toneMapped: false })];
{
  const geo = new THREE.BoxGeometry(0.45, 0.14, 0.24);
  const a = new THREE.Mesh(geo, scLights[0]), b = new THREE.Mesh(geo, scLights[1]);
  a.position.set(-0.28, 1.32, -0.2); b.position.set(0.28, 1.32, -0.2);
  scCar.model.body.add(a, b);
  scCar.model.root.visible = false;
  scene.add(scCar.model.root);
}
let podium: Podium | null = null, podiumT = 0;

function startQuali() {
  qualiRun = true;
  raceKind = 'tt';
  hideMenu();
  beginCountdown();
  setRaceRain(false);
  toast('🏁 排位賽：跑一圈，圈速決定發車位置', 'purple');
}
/** 車手名字後面加個性圖示（🔥 激進、🛡️ 防守…；均衡的不加） */
const withPersona = (r: Racer) => (r.persona.icon ? `${r.name} ${r.persona.icon}` : r.name);
/** 排位賽跑完：AI 用同一套物理各跑一圈，大家照圈速排發車格 */
function finishQuali(t: number) {
  qualiRun = false;
  state = 'results';
  sound.engine(0, 0, false);
  const times = field.qualify();
  times.set(field.me, t);
  const grid = [...field.racers].sort((a, b) => times.get(a)! - times.get(b)!);
  qualiGrid = grid;
  const pos = grid.indexOf(field.me) + 1, pole = times.get(grid[0])!;
  QUALI_POS = pos;
  const tb = $('quali-table');
  tb.innerHTML = '<tr><th>位置</th><th>車手</th><th>車隊</th><th>圈速</th><th>差距</th></tr>';
  grid.forEach((r, k) => {
    const tr = document.createElement('tr');
    if (r.isPlayer) tr.className = 'me';
    if (k === 0) tr.className += ' pole';
    for (const v of [String(k + 1), withPersona(r), r.team, fmt(times.get(r)!), k ? `+${(times.get(r)! - pole).toFixed(3)}` : '']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  $('quali-title').textContent = pos === 1 ? '🏁 竿位！' : `排位賽：第 ${pos} 位發車`;
  $('quali-legend').textContent = Object.values(PERSONAS).filter((p) => p.icon).map((p) => `${p.icon} ${p.tag}`).join('　');
  $('quali-sub').textContent = `你的圈速 ${fmt(t)}${pos > 1 ? `，落後竿位 ${(t - pole).toFixed(3)} 秒` : ''}`;
  if (BOT && !new URLSearchParams(location.search).has('qualistop')) { startGpAfterQuali(); return; } // 測試：&qualistop 停在排位成績表（截圖用）
  $('quali-res').classList.remove('hidden');
}
function startGpAfterQuali() {
  $('quali-res').classList.add('hidden');
  raceKind = 'gp';
  mode = 'race';
  hideMenu();
  beginCountdown();
}
$('quali-go').addEventListener('click', async () => { await userStart(); startGpAfterQuali(); });
$('quali-again').addEventListener('click', async () => { await userStart(); $('quali-res').classList.add('hidden'); startQuali(); });
$('quali-menu').addEventListener('click', () => { $('quali-res').classList.add('hidden'); qualiGrid = null; state = 'menu'; showMenu(false); });

/** 正賽中下雨：天空、雨滴、路面換成雨天（夜晚就是雨夜）；比賽結束回到選單的時段天氣 */
function setRaceRain(on: boolean) {
  if (on) weather.apply(timeKind === 'night' || timeKind === 'rainnight' ? 'rainnight' : 'rain', Q.fogFar, bloom, gradePass, cycleT);
  else applyWeather();
}
function scBanner(text: string, green = false) {
  const el = $('sc-banner');
  el.textContent = text;
  el.className = text ? (green ? 'show green' : 'show') : '';
}
function gpEvent(ev: string) {
  if (ev === 'sc-out') { scBanner('🟡 安全車'); radio.say('sc', '安全車出動！保持車距、不要超車，DRS 關閉', Infinity); sound.beep(660, 0.3); }
  else if (ev === 'sc-in') { scBanner('🟡 安全車本圈進站'); radio.say('sc-in', '安全車這圈進站，準備重新起跑', Infinity); }
  else if (ev === 'green') { scBanner('🟢 綠旗！', true); setTimeout(() => scBanner(''), 3000); radio.say('green', '綠旗！衝！', Infinity); }
  else if (ev === 'rain') { setRaceRain(true); toast('🌧️ 開始下雨了', ''); radio.say('rain', '開始下雨了，賽道會越來越濕——準備進站換雨胎', Infinity); }
}
/** 車隊無線電：每 0.5 秒看一次狀況，有事就說（同一件事有冷卻時間） */
function radioTick(dt: number) {
  radioAcc += dt;
  if (radioAcc < 0.5) return;
  radioAcc = 0;
  const st = field.standings(), k = st.findIndex((r) => r.isPlayer), me = st[k];
  if (me.finish != null) return;
  if (field.raceTime < 4) radio.say('start', '燈號熄滅！第一個彎小心，別跟人擠', Infinity);
  if (me.laps === field.laps && field.laps > 1) radio.say('last', '最後一圈！全力推！', Infinity);
  if (me.pitTimer <= 0 && me.wear > 0.62 && !me.pitReq && field.laps - me.laps >= 1) radio.say('tyre', `輪胎剩 ${Math.round((1 - me.wear) * 100)}%，考慮這圈進站（按「進站」）`, Infinity);
  if (me.wear < 0.1) radio.rearm('tyre');
  const ahead = st[k - 1], behind = st[k + 1];
  if (ahead && ahead.wear > 0.7 && field.progress(ahead) - field.progress(me) < 80) radio.say('ahead-tyre', `前車 ${ahead.name} 的輪胎快不行了，準備攻擊！`, 40);
  // 對手的個性：追到防守型要用假動作、被激進型追要小心晚煞車
  if (ahead && field.sc.phase === 'off' && field.raceTime > 15 && field.progress(ahead) - field.progress(me) < Math.max(15, car.v) && ahead.persona.tag === '防守') radio.say('ahead-def', `${ahead.name} 很會卡位，先假裝走一邊、等他換線再從另一邊過`, 60);
  if (behind && field.sc.phase === 'off' && field.raceTime > 15 && field.progress(me) - field.progress(behind) < Math.max(15, car.v)) {
    const p = behind.persona.tag;
    const hint = p === '激進' ? '，他很敢晚煞車，進彎前守好內線' : p === '雨戰' && field.wet > 0.3 ? '，他雨天特別快，別犯錯' : '，守住內線';
    radio.say('behind', `後面的 ${behind.name} 在 1 秒內${hint}`, 35);
  }
  if (car.r26 && car.energy < 0.2) radio.say('batt', '電量剩 20%，先別開超車，煞車多回收一點', Infinity);
  if (car.energy > 0.5) radio.rearm('batt');
  if (field.wet > 0.35 && me.compound !== RAIN && !me.pitReq && me.pitTimer <= 0 && field.laps - me.laps >= 1) radio.say('wet', '路面已經很濕了，這圈進站換雨胎！', 45);
  // 名次創新高才報（在兩個名次之間跳來跳去不要一直說）；掉了兩名以上之後重新算
  if (lastPos < 0) lastPos = k;
  if (k < lastPos && field.raceTime > 5) { radio.say('gain', `漂亮！上到第 ${k + 1} 名`, 12); lastPos = k; circuitEnv?.crowd.cheer(0.8); }
  else if (k > lastPos + 1) lastPos = k;
}
/** 頒獎典禮：前三名站上台、噴香檳；12 秒後（或按「查看成績」）看成績表 */
function startPodium() {
  state = 'podium';
  podiumT = 0;
  sound.engine(0, 0, false);
  radio.hide();
  scBanner('');
  hud.classList.add('hidden');
  podium ??= new Podium(scene, track);
  field.hide(); // 頒獎台搭在賽道上：賽車先收起來
  const st = field.standings().slice(0, 3);
  const helmetOf = (r: Racer) => (r.isPlayer ? PLAYER_LIVERY.helmet : TEAMS.find((t) => t.team === r.team)?.livery.helmet ?? '#ffffff');
  podium.show(st.map((r) => ({ suit: r.color, helmet: helmetOf(r) })));
  const ol = $('podium-names');
  ol.innerHTML = '';
  st.forEach((r, k) => {
    const li = document.createElement('li');
    if (r.isPlayer) li.className = 'me';
    li.style.setProperty('--c', r.color);
    const b = document.createElement('b'), n = document.createElement('span'), t = document.createElement('small');
    b.textContent = `P${k + 1}`; n.textContent = r.name; t.textContent = r.team;
    li.append(b, n, t);
    ol.appendChild(li);
  });
  $('podium-ui').classList.remove('hidden');
  [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => sound.beep(f, 0.18), k * 160)); // 小小的勝利號角
}
function endPodium() {
  if (state !== 'podium') return;
  podium?.hide();
  $('podium-ui').classList.add('hidden');
  hud.classList.remove('hidden');
  showResults();
}
function podiumFrame(dt: number) {
  podiumT += dt;
  carModel.root.visible = false; // updateVisuals 每格會把玩家的車打開
  podium!.frame(dt, camera);
  world.sky.position.copy(camera.position);
  world.mountains.position.y = -camera.position.y;
  if (podiumT > 12) endPodium();
}
$('podium-skip').addEventListener('click', endPodium);

// ---------------------------------------------------------------- 正賽：名次、排行榜、成績表
let boardAcc = 0;
function updateGpHud() {
  boardAcc += 1;
  if (boardAcc % 6) return; // 每 6 幀更新一次就夠了
  const st = field.standings();
  const me = st.findIndex((r) => r.isPlayer);
  const mine = st[me];
  $('pos').textContent = `P${me + 1}`;
  $('pos').dataset.of = `/${st.length}`;
  $('lap').textContent = `${Math.min(field.laps, Math.max(1, mine.laps))}/${field.laps}`;
  // 胎況：胎種＋剩幾成
  const ty = TYRES[mine.compound], tyEl = $('tyre');
  tyEl.textContent = mine.pitTimer > 0 ? `🔧 換胎中 ${mine.pitTimer.toFixed(1)}` : `${ty.short}胎 ${Math.round((1 - mine.wear) * 100)}%`;
  tyEl.style.borderColor = ty.color;
  tyEl.classList.toggle('worn', mine.wear > 0.6);
  $('pit').classList.toggle('on', mine.pitReq);
  $('pit').textContent = mine.pitReq ? '進站 ✓' : '進站';
  const lead = field.progress(st[0]);
  const ol = $('board');
  ol.innerHTML = '';
  st.forEach((r, k) => {
    const li = document.createElement('li');
    if (r.isPlayer) li.className = 'me';
    else if (k !== 0 && Math.abs(k - me) > 1) li.className = k > 2 && Math.abs(k - me) > 2 ? 'far hide' : 'far'; // 矮螢幕只列領先者、前後一名；22 台時大螢幕也只列前三名＋前後兩名（style.css）
    const sw = document.createElement('i');
    sw.style.background = r.color;
    const nm = document.createElement('span');
    nm.textContent = `${k + 1} ${r.name}`;
    const gap = document.createElement('em');
    // 差距：用距離換算成大約的秒數（以 60 m/s 估）
    gap.textContent = k === 0 ? (r.finish != null ? '完賽' : '領先') : `+${((lead - field.progress(r)) / 60).toFixed(1)}`;
    li.append(sw, nm, gap);
    ol.appendChild(li);
  });
}
function showResults() {
  state = 'results';
  sound.engine(0, 0, false);
  sound.sirenAt(0, 0);
  const st = field.standings();
  const winner = st[0].finish ?? field.raceTime;
  const tb = $('res-table');
  tb.innerHTML = '<tr><th>名次</th><th>車手</th><th>車隊</th><th>成績</th><th>最快圈</th><th>進站</th></tr>';
  st.forEach((r, k) => {
    const tr = document.createElement('tr');
    if (r.isPlayer) tr.className = 'me';
    const time = r.finish != null ? (k === 0 ? fmt(r.finish) : `+${(r.finish - winner).toFixed(3)}`) : `差 ${Math.max(1, field.laps + 1 - r.laps)} 圈內`;
    for (const v of [String(k + 1), withPersona(r), r.team, time, fmt(r.bestLap), `${r.pits} 次`]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  const me = st.findIndex((r) => r.isPlayer) + 1;
  $('res-title').textContent = me === 1 ? '🏆 冠軍！' : me <= 3 ? `第 ${me} 名，上頒獎台！` : `第 ${me} 名`;
  if (raceKind === 'gp') {
    const prize = ([1500, 1000, 700, 400, 300, 250, 200, 150][me - 1] ?? 100) * (field.laps >= 6 ? 2 : 1); // 6 圈加倍
    $('res-title').textContent += `　💰 +${fmtNT(prize)}`;
    earn(prize, `正賽第 ${me} 名`);
    if (me === 1) stats.gpWins++;
  }
  recordSeason(st);
  $('results').classList.remove('hidden');
  if (BOT) document.title = `GP P${me} ${st.map((r) => r.name + ':' + (r.finish?.toFixed(1) ?? '-') + (r.pits ? `(進${r.pits})` : '')).join(' ')} DRS區${field.drsZones.length} 回放${field.replayLength.toFixed(0)}s 安全車${field.sc.used ? '有' : '無'} 濕${field.wet.toFixed(2)} 雨胎${field.racers.filter((r) => r.compound === RAIN).length}台 無線電${radio.count}則（${radio.log.join('／')}）${QUALI_POS != null ? ` 排位P${QUALI_POS}` : ''}${save.season ? ` 賽季已比${save.season.round}站 你${driverStandings(save.season, teamOf).find((r) => r.name === '你')?.pts ?? 0}分 領先${driverStandings(save.season, teamOf)[0]?.name}${driverStandings(save.season, teamOf)[0]?.pts}分` : ''}`;
}
// ---------------------------------------------------------------- 回放：轉播機位（賽道外側每 220 m 一台）與追車鏡頭輪流
let replayT = 0, replaySpeed = 1, camCut = 0, camMode: 'tv' | 'chase' | 'heli' = 'tv';
const tvCams: THREE.Vector3[] = [];
{
  const stepN = Math.round(220 / track.ds);
  for (let i = 0, k = 0; i < track.N; i += stepN, k++) {
    // 就架在護牆外 2 m、10 m 高：比行道樹更靠賽道，往下拍不會被樹擋住
    const off = (k % 2 ? 1 : -1) * (WALL_OFF + 2);
    tvCams.push(new THREE.Vector3(track.px[i] - track.tz[i] * off, 10 + track.py[i], track.pz[i] + track.tx[i] * off));
  }
}
function startReplay() {
  state = 'replay';
  replayT = 0;
  replaySpeed = 1;
  camCut = 0;
  $('results').classList.add('hidden');
  hud.classList.add('hidden');
  $('replay-ui').classList.remove('hidden');
  $('replay-speed').textContent = '2×';
  ghostModel.root.visible = false;
}
function endReplay() {
  state = 'results';
  $('replay-ui').classList.add('hidden');
  $('results').classList.remove('hidden');
}
const replayLoc = new Map<unknown, Locate>();
function replayFrame(dt: number) {
  const len = field.replayLength;
  // 回放的是街道賽：護牆在、車流行人紅綠燈都不在
  world.race.visible = true;
  if (traffic) { traffic.visible = false; traffic.signalsVisible = false; }
  if (peds) peds.visible = false;
  for (const p of playerCars.values()) p.model.root.visible = false;
  for (const o of raceHide) { o.userData.off = true; o.visible = false; }
  replayT += dt * replaySpeed;
  if (replayT >= len) { endReplay(); return; }
  field.replayAt(replayT, (r, x, z, h, steer, v) => {
    const m = r.isPlayer ? carModel : r.model!;
    m.root.visible = true;
    // 高低起伏：回放只記了平面位置，找回賽道上的點拿高度（每台車記住上次的點，搜尋很快）
    let loc = replayLoc.get(r);
    if (!loc) replayLoc.set(r, (loc = { i: 0, lat: 0, s: 0 }));
    locate(track, x, z, loc);
    m.root.position.set(x, track.py[loc.i], z);
    m.root.rotation.set(-Math.atan(track.grade[loc.i]), h, 0, 'YXZ');
    for (const w of m.steer) w.rotation.y = -steer * 0.35;
    for (const w of m.spin) w.rotation.x += (v / 0.36) * dt * replaySpeed;
  });
  const p = carModel.root.position, h = carModel.root.rotation.y;
  // 每 7 秒換一種鏡頭：轉播機位 → 追車 → 空拍
  camCut -= dt * replaySpeed;
  if (camCut <= 0) { camCut = 7; camMode = camMode === 'tv' ? 'chase' : camMode === 'chase' ? 'heli' : 'tv'; }
  if (camMode === 'tv') {
    let best = tvCams[0], bd = Infinity;
    for (const c of tvCams) { const d = c.distanceTo(p); if (d < bd) { bd = d; best = c; } }
    camera.position.copy(best);
    camera.lookAt(p.x, 0.8 + p.y, p.z);
    camera.fov = Math.max(18, Math.min(55, 900 / Math.max(bd, 10))); // 遠的時候拉近（長焦）
  } else if (camMode === 'chase') {
    camera.position.set(p.x - Math.sin(h) * 7, 2.4 + p.y, p.z - Math.cos(h) * 7);
    camera.lookAt(p.x + Math.sin(h) * 8, 1 + p.y, p.z + Math.cos(h) * 8);
    camera.fov = 65;
  } else {
    camera.position.set(p.x - Math.sin(h) * 25 + 10, 38 + p.y, p.z - Math.cos(h) * 25);
    camera.lookAt(p.x, p.y, p.z);
    camera.fov = 50;
  }
  camera.updateProjectionMatrix();
  world.sky.position.copy(camera.position);
  world.mountains.position.y = -camera.position.y;
  $('replay-time').textContent = `▶ 回放 ${fmt(replayT)} / ${fmt(len)}`;
}
$('btn-replay').addEventListener('click', startReplay);
$('replay-end').addEventListener('click', endReplay);
$('replay-speed').addEventListener('click', () => {
  replaySpeed = replaySpeed === 1 ? 2 : replaySpeed === 2 ? 4 : 1;
  $('replay-speed').textContent = replaySpeed === 4 ? '1×' : `${replaySpeed * 2}×`;
});
// DRS、進站按鈕（電腦：Ctrl 或 E 開 DRS、B 進站）
let drsPress = false, pitPress = false;
$('drs').addEventListener('pointerdown', (e) => { e.preventDefault(); drsPress = true; });
$('pit').addEventListener('pointerdown', (e) => { e.preventDefault(); pitPress = true; });
addEventListener('keydown', (e) => {
  if (state !== 'race') return;
  // 比賽中按著 Ctrl 再按 S／D／A 會觸發瀏覽器的存檔、加書籤、全選，擋掉（Ctrl+W 關分頁瀏覽器不讓擋，街道賽油門自動不用按 W）
  if (e.ctrlKey && /^Key[SDAPF]$/.test(e.code)) e.preventDefault();
  if (e.repeat) return; // 按住不放不會一直重複觸發
  if (e.code === 'KeyE' || e.code === 'ControlLeft' || e.code === 'ControlRight') drsPress = true;
  if (e.code === 'KeyB') pitPress = true;
});
function updateDrsButton() {
  const el = $('drs'), zone = field.drsZoneAt(car.pos.s) >= 0;
  const ready = zone && (raceKind === 'tt' || field.me.drsOk) && (!car.r26 || car.energy > 0.1);
  el.className = car.drs || car.ovt ? 'on' : ready ? 'ready' : '';
  // 2026：電池電量
  const b = $('batt');
  b.style.display = car.r26 ? '' : 'none';
  if (car.r26) {
    const pct = Math.round(car.energy * 100);
    b.textContent = `${car.ovt ? '⚡' : '🔋'} ${pct}%`;
    b.className = pct < 15 ? 'low' : car.ovt ? 'boost' : '';
    b.style.setProperty('--e', `${pct}%`);
  }
}

// ---------------------------------------------------------------- 計程車任務
let rerouteAcc = 0;
function updateTaxiHud() {
  const el = $('taxi-hud');
  if (!taxi || !taxiOn() || !taxi.target) { el.classList.add('hidden'); return; }
  const d = Math.hypot(fcar.x - taxi.target.x, fcar.z - taxi.target.z);
  // 每 5 秒照目前位置重算一次路線（開錯路也會導回來）
  rerouteAcc += 0.25;
  if (rerouteAcc > 5) { rerouteAcc = 0; taxi.reroute(fcar.x, fcar.z); }
  el.innerHTML = '';
  const add = (t: string, cls = '') => { const s = document.createElement('span'); s.textContent = t; if (cls) s.className = cls; el.appendChild(s); };
  if (taxi.phase === 'seek') {
    add(`🙋 載客：${taxi.target.nm}`);
    add(`${Math.round(d)} m`);
  } else {
    add(`🚕 → ${taxi.target.nm}`);
    add(`${Math.round(d)} m`);
    add(`⏱ ${Math.ceil(taxi.timeLeft)} 秒`, taxi.timeLeft < 15 ? 'bad' : 'good');
  }
  add(`💰 NT$ ${taxi.money.toLocaleString()}`, 'money');
  el.classList.remove('hidden');
}
$('btn-taxi').addEventListener('click', async () => {
  await userStart();
  police?.hide();
  mode = 'free';
  field.hide();
  sr?.cancel();
  hideMenu();
  beginFree();
  taxi?.start(fcar.x, fcar.z);
  toast('🚕 出車囉！到綠色光柱載乘客', '');
});

$('free-reset').addEventListener('click', async () => {
  delete save.freePos;
  writeSave();
  $('free-reset').hidden = true;
  $('btn-free').click();
});
$('btn-free').addEventListener('click', async () => {
  await userStart();
  if (!save.tutDone && !BOT) showTut(0);
  taxi?.stop();
  mode = 'free';
  field.hide();
  hideMenu();
  beginFree();
});
$('btn-resume').addEventListener('click', async () => {
  await userStart();
  hideMenu();
  state = pausedFrom;
  clock.getDelta();
});
let pausedFrom: State = 'race';
function pause() {
  if (state !== 'race' && state !== 'countdown' && state !== 'free') return;
  if (state === 'free') saveFreePos();
  pausedFrom = state;
  state = 'paused';
  sound.engine(0, 0, false);
  sound.sirenAt(0, 0);
  showMenu(true);
}
$('btn-pause').addEventListener('click', pause);
$('btn-reset').addEventListener('click', () => {
  if (state === 'race') car.placeAt(track, car.pos.i);
  if (state === 'free') unstick();
});
addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else sound.unlock(); });
// 手機的聲音被系統停掉（切 App、鎖螢幕、來電）之後，下一次碰螢幕或按鍵就叫醒
for (const ev of ['pointerdown', 'touchend', 'keydown'] as const) addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });
document.addEventListener('contextmenu', (e) => e.preventDefault());
$('btn-reset-best').addEventListener('click', () => {
  if (!confirm('確定要清除最快圈和影子車？')) return;
  save.best = null;
  save.sectors = [null, null, null];
  save.ghost = null;
  writeSave();
  showMenu(state === 'paused');
});

// ---------------------------------------------------------------- 街頭飆車
let srShown = false, bigUntil = 0, offerFor: Challenge | null = null;
function bigMsg(text: string) {
  const el = $('big');
  el.textContent = text;
  el.className = 'show';
  bigUntil = performance.now() + (text.length <= 3 ? 900 : 1800);
}
function updateOffer(c: Challenge | null) {
  if (c === offerFor) return;
  offerFor = c;
  const el = $('sr-offer');
  if (!c) { el.classList.add('hidden'); return; }
  const best = save.street?.[c.def.id];
  $('sr-offer-title').textContent = `🏁 ${c.def.title}`;
  $('sr-offer-sub').textContent = `對手：${c.def.rival} ｜ 約 ${(c.length / 1000).toFixed(1)} km ｜ ${c.checkpoints.length} 個檢查點` + (best ? ` ｜ 你的最佳 ${fmt(best)}` : '');
  el.classList.remove('hidden');
}
function acceptChallenge(c: Challenge, duel = false) {
  if (!sr) return;
  updateOffer(null);
  srShown = false;
  sr.begin(c, (x, z, h) => fcar.place(x, z, h), duel);
  camSnap = true;
}
$('sr-accept').addEventListener('click', () => { if (offerFor) acceptChallenge(offerFor); });
addEventListener('keydown', (e) => { if (e.code === 'Enter' && offerFor && state === 'free') acceptChallenge(offerFor); });
function updateSrHud() {
  const el = $('sr-hud');
  if (!sr || !sr.active || (sr.phase !== 'race' && sr.phase !== 'count')) { el.classList.add('hidden'); return; }
  const lead = sr.lead(fcar.x, fcar.z);
  el.innerHTML = '';
  const add = (t: string, cls = '') => { const s = document.createElement('span'); s.textContent = t; if (cls) s.className = cls; el.appendChild(s); };
  if (sr.duel) {
    const st = sr.standings();
    add(`P${st.findIndex((r) => r.isPlayer) + 1}/${st.length}`, 'pos');
  } else add(`vs ${sr.active.def.rival}`);
  add(`檢查點 ${Math.min(sr.next + 1, sr.active.checkpoints.length)}/${sr.active.checkpoints.length}`);
  add(fmt(sr.time));
  const anyDone = sr.rivals.some((r) => r.done != null);
  add(anyDone ? '已有對手到終點' : lead >= 0 ? `領先 ${lead.toFixed(0)} m` : `落後第一名 ${(-lead).toFixed(0)} m`, lead >= 0 ? 'good' : 'bad');
  el.classList.remove('hidden');
}
// 通緝星數／追緝嫌犯的狀態，與「追緝」按鈕（開巡邏車時）
function updateWantedHud() {
  const el = $('wanted'), btn = $('btn-pursuit');
  const canPursue = mode === 'free' && chosen.id === 'police' && !taxiOn() && !streetRacing() && !!police && !police.active;
  btn.style.display = canPursue ? '' : 'none';
  if (police?.wanted) {
    const st = police.stars;
    let t = '★'.repeat(st) + '☆'.repeat(5 - st);
    if (police.bustT > 0.3) t += `　被包圍 ${Math.max(0, 3 - police.bustT).toFixed(1)}`;
    else if (police.lostT > 0.5) t += `　甩開中 ${Math.ceil(LOSE_TIME - police.lostT)} s`;
    el.textContent = t;
    el.className = 'show' + (police.bustT > 0.3 ? ' bust' : '');
  } else if (police?.suspect) {
    el.textContent = `🎯 嫌犯　耐久 ${Math.round(police.suspectHp)}%　剩 ${Math.ceil(police.pursuitT)} s`;
    el.className = 'show cop';
  } else el.className = '';
}
// 喇叭：電腦 H、手機喇叭鍵；前面的車會讓路或回按
function playerHorn() {
  if (state !== 'free') return;
  stats.honks++;
  sound.horn(1, chosen.id === 'pickup' ? 0.8 : chosen.id === 'f1' || chosen.id === 'super' ? 1.15 : 1, 0.4);
  traffic?.honk(fcar.x, fcar.z, fcar.h);
  peds?.honked(fcar.x, fcar.z); // 路人轉頭看
}
$('btn-horn').addEventListener('pointerdown', (e) => { e.preventDefault(); playerHorn(); });
addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !e.repeat) playerHorn(); });
/** 路人的尖叫：照距離決定音量 */
function playScreams() {
  if (!peds?.screams.length) return;
  for (const s of peds.screams.splice(0)) {
    const vol = Math.max(0, 1 - Math.hypot(s.x - fcar.x, s.z - fcar.z) / 45);
    sound.scream(vol, 0.8 + Math.random() * 0.5);
  }
}
/** 車流按的喇叭：照距離決定音量，音高每台不太一樣 */
function playTrafficHonks() {
  if (!traffic?.honks.length) return;
  for (const h of traffic.honks.splice(0)) {
    const d = Math.hypot(h.x - fcar.x, h.z - fcar.z), vol = Math.max(0, 1 - d / 110) * (h.angry ? 0.7 : 0.5);
    sound.horn(vol, 0.82 + Math.random() * 0.35, h.angry ? 0.5 : 0.25 + Math.random() * 0.2);
  }
}
// 車況與修車：車損 30% 以上、車子停住時出現修車鍵（NT$100，沒錢免費）
function updateDriftHud() {
  const el = $('drift-hud');
  if (drift.active && mode === 'free') { el.style.display = ''; el.textContent = `🌀 ${drift.total.toLocaleString()}  ×${drift.mult}`; }
  else el.style.display = 'none';
}
function updateDamageHud() {
  const el = $('dmg'), btn = $('btn-repair'), d = damage.value;
  const show = mode === 'free' && d > 0.05;
  el.style.display = show ? '' : 'none';
  if (show) { el.textContent = `🔧 車況 ${Math.round((1 - d) * 100)}%`; el.className = d > 0.75 ? 'bad' : d > 0.45 ? 'warn' : ''; }
  btn.style.display = mode === 'free' && d > 0.3 && Math.abs(fcar.v) < 1 && state === 'free' ? '' : 'none';
}
$('btn-repair').addEventListener('click', () => {
  const cost = money() >= 100 ? 100 : 0;
  if (cost) setMoney(money() - cost);
  damage.repair();
  toast(cost ? '🔧 修好了（NT$ 100）' : '🔧 修好了（這次免費）', '');
});
function startPursuit() {
  if (!police || chosen.id !== 'police' || mode !== 'free' || state !== 'free') return;
  const m = police.startPursuit(fcar);
  if (m) toast(m, '');
}
$('btn-pursuit').addEventListener('pointerdown', (e) => { e.preventDefault(); startPursuit(); });
addEventListener('keydown', (e) => { if (e.code === 'KeyG' && !e.repeat) startPursuit(); });

function showStreetResult() {
  if (!sr?.active) return;
  srShown = true;
  const c = sr.active, me = sr.playerDone, rv = sr.rivalDone;
  const st = sr.standings(), place = st.findIndex((r) => r.isPlayer) + 1;
  const win = me != null && isFinite(me) && (sr.duel ? place === 1 : rv == null || me < rv);
  const tb = $('sr-res-table');
  tb.innerHTML = '';
  $('sr-again').style.display = sr.duel ? '' : 'none';
  if (sr.duel) {
    tb.innerHTML = '<tr><th>名次</th><th>車手</th><th>成績</th></tr>';
    const first = st[0].done;
    st.forEach((r, k) => {
      const tr = document.createElement('tr');
      if (r.isPlayer) tr.className = 'me';
      const fin = r.done != null && isFinite(r.done);
      const time = fin ? (k === 0 ? fmt(r.done) : `+${(r.done! - (first ?? 0)).toFixed(2)}`) : '未完成';
      for (const v of [String(k + 1), r.name, time]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
      tb.appendChild(tr);
    });
  }
  if (BOT) document.title = `DUEL ${c.def.title} P${place} ` + st.map((r) => `${r.name}:${r.done != null && isFinite(r.done) ? r.done.toFixed(1) : '-'}`).join(' ') + ` 檢查點${sr.next}/${c.checkpoints.length} 車${fcar.x.toFixed(0)},${fcar.z.toFixed(0)}`;
  if (win && me != null) {
    save.street = save.street || {};
    if (!save.street[c.def.id] || me < save.street[c.def.id]) save.street[c.def.id] = me;
    writeSave();
  }
  $('sr-res-title').textContent = sr.duel ? (place === 1 ? '🏆 街頭之王！' : `第 ${place} 名`) : win ? `🏆 你贏了 ${c.def.rival}！` : `${c.def.rival} 贏了`;
  const prize = me != null && isFinite(me) ? (sr.duel ? [600, 350, 200, 100, 50][place - 1] ?? 0 : win ? 300 : 0) : 0;
  if (prize) { $('sr-res-title').textContent += `　💰 +${fmtNT(prize)}`; earn(prize, sr.duel ? `街頭對決第 ${place} 名` : '街頭飆車獲勝'); }
  if (sr.duel ? place === 1 && me != null && isFinite(me) : win) stats.streetWins++;
  $('sr-res-sub').textContent = (sr.duel ? `${c.def.title} ｜ 你 ${me != null && isFinite(me) ? fmt(me) : '未完成'}` : `你 ${me != null && isFinite(me) ? fmt(me) : '未完成'} ｜ ${c.def.rival} ${rv != null ? fmt(rv) : '未完成'}`) + (save.street?.[c.def.id] ? ` ｜ 最佳 ${fmt(save.street[c.def.id])}` : '');
  $('sr-result').classList.remove('hidden');
}
$('sr-ok').addEventListener('click', () => { $('sr-result').classList.add('hidden'); sr?.cancel(); });
$('sr-again').addEventListener('click', () => {
  const c = sr?.active;
  $('sr-result').classList.add('hidden');
  if (c) { sr!.cancel(); acceptChallenge(c, true); }
});
// 選單的「街頭對決」：先選路線
$('btn-duel').addEventListener('click', () => {
  if (!sr) return;
  const list = $('duel-list');
  list.innerHTML = '';
  for (const c of sr.challenges) {
    const b = document.createElement('button');
    b.className = 'ghost-btn';
    const best = save.street?.[c.def.id];
    b.innerHTML = '';
    const t = document.createElement('b');
    t.textContent = c.def.title;
    const s = document.createElement('small');
    s.textContent = `${(c.length / 1000).toFixed(1)} km ｜ ${c.checkpoints.length} 個檢查點` + (best ? ` ｜ 最佳 ${fmt(best)}` : '');
    b.append(t, s);
    b.addEventListener('click', async () => {
      await userStart();
      $('duel-pick').classList.add('hidden');
      taxi?.stop();
      mode = 'free';
      field.hide();
      hideMenu();
      beginFree();
      acceptChallenge(c, true);
    });
    list.appendChild(b);
  }
  menu.classList.add('hidden');
  $('duel-pick').classList.remove('hidden');
});
$('duel-back').addEventListener('click', () => { $('duel-pick').classList.add('hidden'); showMenu(false); });
/** 測試用：玩家照挑戰路線開（純追蹤，最高約 80 km/h） */
function srBot() {
  const c = sr?.active;
  if (!c || sr!.phase !== 'race') return { steer: 0, brake: true, throttle: false };
  // ?ram：測撞擊——油門全開衝向最近的對手
  if (new URLSearchParams(location.search).has('ram')) {
    let tgt: { x: number; z: number } | null = null, td = Infinity;
    for (const r of sr!.rivals) { const d = Math.hypot(r.pos.x - fcar.x, r.pos.z - fcar.z); if (r.done == null && d < td) { td = d; tgt = r.pos; } }
    if (tgt) {
      let e = Math.atan2(tgt.x - fcar.x, tgt.z - fcar.z) - fcar.h;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      return { steer: Math.max(-1, Math.min(1, -e * 3)), brake: false, throttle: true };
    }
  }
  let bi = 0, bd = Infinity;
  for (let i = 0; i < c.path.length; i++) { const d = (c.path[i][0] - fcar.x) ** 2 + (c.path[i][1] - fcar.z) ** 2; if (d < bd) { bd = d; bi = i; } }
  const target = c.cum[bi] + 9 + Math.abs(fcar.v) * 0.5;
  const j = Math.max(0, c.cum.findIndex((q) => q >= target));
  const p = c.path[j < 0 ? c.path.length - 1 : j], q = c.path[Math.min(c.path.length - 1, (j < 0 ? c.path.length - 1 : j) + 1)];
  const th = Math.atan2(q[0] - p[0], q[1] - p[1]), off = c.twoWay ? 1.8 : 0; // 走右側車道
  let err = Math.atan2(p[0] - Math.cos(th) * off - fcar.x, p[1] + Math.sin(th) * off - fcar.z) - fcar.h;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  let want = Math.min(22, c.vmax[bi] * 0.95);
  // 前面有車就停（測試用的駕駛不會鑽車縫）
  const fx = Math.sin(fcar.h), fz = Math.cos(fcar.h);
  for (const o of traffic?.near(fcar.x, fcar.z, 20) ?? []) {
    const dx = o.x - fcar.x, dz = o.z - fcar.z, ahead = dx * fx + dz * fz;
    if (ahead > 0 && ahead < 12 && Math.abs(-dx * fz + dz * fx) < 1.8) want = Math.min(want, o.v);
  }
  return { steer: Math.max(-1, Math.min(1, -err * 2)), brake: fcar.v > want + 1, throttle: fcar.v < want };
}

// ---------------------------------------------------------------- 自由駕駛
let roadAcc = 0, roadShown = '', lmAcc = 0, lmLast = '', lmAt = 0;
function beginFree() {
  // 從上次停的地方出發（沒有就從 101 前的信義路）；測試一律從起點，結果才可重現
  const p = !BOT && validFreePos(save.freePos) ? save.freePos! : null;
  if (p) fcar.place(p.x, p.z, p.h); else fcar.place(track.px[1], track.pz[1], Math.atan2(track.tx[1], track.tz[1]));
  unstick(); // 對齊到真實車道中心
  if (p && roadNet) { const w = roadNet.nearestNamed(fcar.x, fcar.z, 60); toast(`📍 從上次的位置出發${w?.nm ? `：${w.nm}` : ''}`, ''); }
  camSnap = true;
  state = 'free';
  roadShown = '';
  lmLast = '';
}
/** 卡住時：移到最近道路的中心，車頭順著道路 */
function unstick() {
  if (!roadNet) return;
  let best: { x: number; z: number; h: number } | null = null, bd = Infinity;
  for (const s of roadNet.segGrid.query(fcar.x, fcar.z, 60)) {
    if (s.way.c > 3) continue;
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((fcar.x - s.x1) * dx + (fcar.z - s.z1) * dz) / l2));
    const x = s.x1 + dx * t, z = s.z1 + dz * t, d = Math.hypot(fcar.x - x, fcar.z - z);
    if (d >= bd) continue;
    bd = d;
    let h = Math.atan2(dx, dz);
    if (s.way.o === -1) h += Math.PI;
    else if (!s.way.o && Math.cos(h - fcar.h) < 0) h += Math.PI; // 雙向道就照原本大致的方向
    best = { x, z, h };
  }
  if (best) fcar.place(best.x, best.z, best.h);
}
const CAR_GEARS = [0, 7, 14, 22, 31];
function carGear(v: number) {
  // 檔位照這台車的極速等比例放大（跑車、F1 換檔的速度比較高）
  const k = fcar.spec.vmax / CAR_VMAX;
  v /= k;
  let g = 0;
  while (g < CAR_GEARS.length - 1 && v >= CAR_GEARS[g + 1]) g++;
  const lo = CAR_GEARS[g], hi = g === CAR_GEARS.length - 1 ? CAR_VMAX : CAR_GEARS[g + 1];
  return { n: g + 1, rpm: Math.min(1, (v - lo) / (hi - lo)) };
}
let heavyAcc = 0, heliAcc = 0;
/** 街頭比賽進行中（倒數、比賽、剛結束）：開 F1、用原本調好的性能（對手的強度是照這個調的） */
function streetRacing() {
  return mode === 'free' && !!sr?.active && sr.phase !== 'idle' && sr.phase !== 'offer';
}
let posSaveAcc = 0;
/** 記下自由駕駛的位置（下次從這裡出發） */
function saveFreePos() {
  if (BOT || CIRCUIT || mode !== 'free' || !Number.isFinite(fcar.x)) return;
  save.freePos = { x: Math.round(fcar.x * 10) / 10, z: Math.round(fcar.z * 10) / 10, h: Math.round(fcar.h * 1000) / 1000 };
  writeSave();
}
function freeStep(dt: number) {
  posSaveAcc += dt;
  if (posSaveAcc > 5) { posSaveAcc = 0; saveFreePos(); }
  fcar.spec = streetRacing() ? DEFAULT_SPEC : damage.speedMul < 1 ? { ...chosen.spec, vmax: chosen.spec.vmax * damage.speedMul } : chosen.spec;
  if (PURSUIT_TEST && police && !police.suspect && policeLog.length === 0) startPursuit();
  if (HONK_TEST && traffic && FREE_SIM) {
    honkT += dt;
    // 3 秒後把玩家放到一台行駛中的車前面 15 m（同車道、同方向），後面的車就會被擋住
    if (!honkPlaced && honkT > 3) {
      const a = traffic.agents.find((b) => b.alive && b.v > 6 && b.kind !== 3 && b.kind !== 2);
      if (a) { honkPlaced = true; fcar.place(a.x + Math.sin(a.h) * 15, a.z + Math.cos(a.h) * 15, a.h); honkT = 0; }
    }
    if (honkPlaced && honkT > 2) { honkT = 0; honkYield += traffic.honk(fcar.x, fcar.z, fcar.h); }
    honkBack += traffic.honks.splice(0).length;
  }
  let inp = FREE_SIM ? (TAXI_TEST ? taxiBot() : SR_TEST ? srBot() : PURSUIT_TEST ? chaseBot() : { steer: 0, brake: false, throttle: !IDLE }) : input.read();
  if (sr?.phase === 'count') { inp = { steer: 0, brake: false, throttle: false }; fcar.vx = fcar.vz = fcar.w = 0; } // 倒數時原地不動（按煞車會變倒車）
  const hb = !!(inp as { handbrake?: boolean }).handbrake;
  fcar.drift = hb && Math.abs(fcar.v) > 8; // 按住甩尾鍵：車尾甩出去
  if (hb && !inp.brake) inp = { ...inp, throttle: true }; // 甩尾時自動給油（手機右手大拇指只要按住 🌀）
  let impact = fcar.update(dt, inp.steer, inp.throttle, inp.brake, collider);
  const knockHit = breakables ? breakables.hit(fcar) : 0; // 樹、路燈：撞倒過去
  const hardHit = impact;
  impact = Math.max(impact, knockHit);
  if (sr) {
    const msg = sr.update(dt, fcar, traffic);
    if (msg) { bigMsg(msg); if (msg.length <= 3) sound.beep(msg === 'GO!' ? 880 : 520, 0.25); }
    impact = Math.max(impact, sr.collide(fcar));
    if (sr.phase === 'done' && !srShown) showStreetResult();
    if (sr.phase === 'idle' || sr.phase === 'offer') updateOffer(taxiOn() ? null : sr.checkOffer(fcar.x, fcar.z, fcar.v)); // 載客時不接街頭挑戰
  }
  heavyAcc += dt;
  const heavy = heavyAcc >= 1 / 60; // 車流、行人每秒更新 60 次就夠（玩家的車照樣每步都算）
  let trafficHit = 0, pedHit = false;
  if (traffic && !NO_TRAFFIC && heavy) {
    traffic.update(heavyAcc, fcar, [...(sr?.obstacle() ?? []), ...(peds?.crossers() ?? []), ...(police?.units.map((u) => u.car) ?? []), ...(police?.suspect ? [police.suspect.car] : [])]); // 車流會讓對手、過馬路的行人、警車、嫌犯車
    trafficHit = traffic.collidePlayer(fcar);
  }
  if (traffic && !NO_TRAFFIC && !heavy) trafficHit = traffic.collidePlayer(fcar);
  impact = Math.max(impact, trafficHit);
  if (peds && heavy && peds.update(heavyAcc, fcar, traffic)) {
    fcar.v *= 0.7; // 碰到行人：車子也被擋一下
    sound.hit(6);
    pedHit = true;
  }
  if (heavy) heavyAcc = 0;
  // 警察：街頭比賽中、自己開巡邏車時不算犯規
  if (police) {
    const crimesOn = !streetRacing() && chosen.id !== 'police' && (!FREE_SIM || WANTED_TEST); // 自動測試（同步模擬）時不算，除非 ?wanted
    const say = (m: string | null) => { if (m) toast(m, 'bad'); };
    if (crimesOn && trafficHit > 6) say(police.crime(0.35, '撞車'));
    if (crimesOn && pedHit) say(police.crime(1, '撞到行人'));
    const starsBefore = police.stars;
    const r = police.update(dt, fcar, collider, NO_TRAFFIC ? null : traffic, crimesOn);
    if (r.msg?.startsWith('😎')) { stats.escapes++; stats.maxEscaped = Math.max(stats.maxEscaped, starsBefore); }
    if (r.msg?.startsWith('🚔')) stats.busted++;
    if (r.msg?.startsWith('✅')) { stats.arrests++; stats.earned += r.money; }
    if (r.msg) policeLog.push(r.msg.replace(/[^\p{L}\p{N}$ ]/gu, '').trim());
    if (r.msg) { toast(r.msg, r.money > 0 ? 'purple' : r.money < 0 || r.msg.startsWith('🚨') ? 'bad' : ''); if (r.msg.startsWith('🚨')) sound.beep(660, 0.25); }
    if (r.money) setMoney(Math.max(0, money() + r.money));
  }

  // 行人徒步區：開進去提醒；開太快路人會停下來瞪你，再快就算違規
  if (pedzones) {
    const zn = pedzones.at(fcar.x, fcar.z), kmh = Math.abs(fcar.v) * 3.6;
    if (zn && !zoneIn) { toast(`🚶 ${zn.nm ? zn.nm + '：' : ''}行人徒步區，請慢慢開`, ''); zoneStare = false; zoneT = 0; }
    zoneIn = !!zn;
    if (zn) {
      zoneT += dt;
      if (kmh > 25 && zoneT > 1.5) {
        zoneT = 0;
        peds?.honked(fcar.x, fcar.z); // 附近的人停下來轉頭看你
        if (!zoneStare) { zoneStare = true; toast('😠 路人都在瞪你，徒步區請慢行', 'bad'); }
        if (kmh > 40 && police && !streetRacing() && chosen.id !== 'police' && (!FREE_SIM || WANTED_TEST)) { const m = police.crime(0.3, '徒步區飆車'); if (m) toast(m, 'bad'); }
      }
    }
  }
  if (impact) sound.hit(impact * 2.5);
  // 甩尾計分：入帳時換成一點錢（每 100 分 NT$1）
  {
    const r = drift.update(dt, fcar, impact);
    if (r.banked) {
      const cash = Math.floor(r.banked / 100);
      stats.bestDrift = Math.max(stats.bestDrift, r.banked);
      stats.totalDrift += r.banked;
      if (cash) { setMoney(money() + cash); stats.earned += cash; }
      toast(`🌀 甩尾 +${r.banked.toLocaleString()} 分${cash ? `（NT$ ${cash}）` : ''}`, 'purple');
    }
    if (r.lost) toast('💥 撞到了，甩尾分數歸零', 'bad');
  }
  // 車損：撞牆、撞車照實算；撞倒行道樹、路燈這種一撞就倒的只算 35%
  const dmgHit = Math.max(hardHit, trafficHit, knockHit * 0.35, impact === knockHit ? 0 : impact);
  if (dmgHit) damage.hit(dmgHit, fcar.x + Math.sin(fcar.h) * 2.2, 0.5, fcar.z + Math.cos(fcar.h) * 2.2);
  if (taxi && taxiOn()) {
    if (impact) taxi.onHit(impact);
    const moneyBefore = taxi.money;
    const msg = taxi.update(dt, fcar);
    if (taxi.money > moneyBefore) stats.earned += taxi.money - moneyBefore;
    stats.trips = Math.max(stats.trips, taxi.trips);
    if (msg) {
      toast(msg, msg.startsWith('💰') ? 'purple' : '');
      if (msg.startsWith('💰')) { save.taxi = { money: taxi.money, trips: taxi.trips }; writeSave(); refreshGarage(); sound.beep(990, 0.3); }
    }
  }
  sound.setEngine(streetRacing() ? 'f1' : chosen.id); // 每台車的引擎聲不一樣（audio.ts ENGINES）
  sound.engine(0.15 + 0.55 * carGear(Math.abs(fcar.v)).rpm, inp.throttle ? 1 : 0.2, true);
  // 警笛：被通緝時照最近那台警車的距離；自己開巡邏車追嫌犯時自己的警笛
  let siren = 0;
  if (police) {
    for (const u of police.units) siren = Math.max(siren, 1 - Math.hypot(u.car.x - fcar.x, u.car.z - fcar.z) / 260);
    if (police.suspect) siren = 0.75;
  }
  sound.sirenAt(Math.max(0, siren), performance.now() / 1000);
  // 直升機旋翼聲
  if (police?.heli.on) { heliAcc += dt; if (heliAcc > 0.12) { heliAcc = 0; sound.thump(police.heliVol); } }
}
function updateFreeHud(dt: number) {
  const v = fcar.v;
  $('speed').textContent = String(Math.round(Math.abs(v) * 3.6));
  $('gear').textContent = v < -0.3 ? 'R' : Math.abs(v) < 0.3 ? 'N' : String(carGear(Math.abs(v)).n);
  const now = performance.now();
  if (toastUntil && now > toastUntil) { $('toast').className = ''; toastUntil = 0; }
  if (bigUntil && now > bigUntil) { $('big').className = ''; bigUntil = 0; }
  roadAcc += dt;
  if (roadAcc > 0.25 && roadNet) {
    roadAcc = 0;
    const w = roadNet.nearestNamed(fcar.x, fcar.z);
    const key = w ? w.nm + '|' + (w.en || '') : '';
    if (key !== roadShown) {
      roadShown = key;
      const el = $('road');
      el.innerHTML = '';
      if (w?.nm) {
        const b = document.createElement('b');
        b.textContent = w.nm;
        el.appendChild(b);
        if (w.en) { const sm = document.createElement('small'); sm.textContent = shortEn(w.en); el.appendChild(sm); }
      }
      el.className = w ? 'show' : '';
    }
    const navInfo = nav?.path && !taxiOn() && !(sr?.active) ? { route: nav.path, next: [nav.x, nav.z] as [number, number], rivals: [], flags: [] } : undefined;
    const base = taxiOn() ? { ...taxi!.mapInfo, rivals: [], flags: [] } : navInfo ?? sr?.mapInfo;
    const cops = police?.mapDots ?? [];
    minimap?.draw(fcar.x, fcar.z, fcar.h, cops.length ? { route: null, next: null, flags: [], ...base, rivals: [...(base?.rivals ?? []), ...cops] } : base);
    updateWantedHud();
    updateDamageHud();
    updateDriftHud();
    updateNav(dt);
    playTrafficHonks();
    playScreams();
    updateTaxiHud();
    updateSrHud();
  }
  // 接近地標時跳出名稱（同一個地標 60 秒內不重複）
  lmAcc += dt;
  if (lmAcc > 0.5) {
    lmAcc = 0;
    for (const l of landmarks) {
      if (Math.hypot(l.x - fcar.x, l.z - fcar.z) > l.r + 30) continue;
      if (l.nm === lmLast && now - lmAt < 60000) break;
      lmLast = l.nm;
      lmAt = now;
      toast('📍 ' + l.nm, '');
      break;
    }
  }
}

// ---------------------------------------------------------------- 畫質：選單設定、自動調整（只在選「自動」時）
// 比賽、自由駕駛中每 4 秒量一次平均 FPS：連兩次低於 30 → 降一級（光暈、陰影、解析度、可視距離、霧、賽道的樹與旗子，不用重新載入）；
// 已經是「低」還是卡 → 再降渲染解析度（最低 0.7 倍）；很順（55 以上）就慢慢把解析度加回這一級的上限
let fpsT = 0, fpsN = 0, slowWin = 0, dynRatio = 1;
const updatePixelRatio = () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio) * dynRatio);
  composer?.setPixelRatio(renderer.getPixelRatio());
};
/** 賽道場景的細節跟著畫質（函式裡才不會被 TS 當成「一定是 null」） */
function circuitDetail(lv: Level) { circuitEnv?.setDetail(lv); }
const showQualityNow = () => { $('quality-now').textContent = `目前：${LEVEL_NAME[level]}${dynRatio < 1 ? `（解析度 ${Math.round(dynRatio * 100)}%）` : ''}`; };
function watchFps() {
  // 用真實時間量（每格的 dt 有上限，很卡的時候加起來會比實際短，量出來的 FPS 會太樂觀）
  const now = performance.now();
  if (BOT || qPref !== 'auto' || (state !== 'free' && state !== 'race')) { fpsT = fpsN = 0; return; }
  if (!fpsT) { fpsT = now; fpsN = 0; return; }
  fpsN++;
  if (now - fpsT < 4000) return;
  const fps = (fpsN * 1000) / (now - fpsT);
  fpsT = now; fpsN = 0;
  slowWin = fps < 30 ? slowWin + 1 : 0;
  if (slowWin >= 2) {
    slowWin = 0;
    if (level !== 'low') {
      level = LOWER[level];
      Object.assign(Q, qualityFor(level));
      if (!Q.bloom) { composer = null; bloom = null; }
      if (!Q.shadows) { world.sun.castShadow = false; renderer.shadowMap.enabled = false; }
      circuitDetail(level);
      applyWeather(); // 霧的距離跟著新的畫質
      updatePixelRatio();
      try { localStorage.setItem(KEY + '-auto-level', level); } catch { /* 不重要 */ }
      toast(`畫面有點卡（${fps.toFixed(0)} fps），已自動調成「${LEVEL_NAME[level]}」畫質`, '');
    } else if (dynRatio > 0.7) {
      dynRatio = Math.max(0.7, +(dynRatio - 0.1).toFixed(2));
      updatePixelRatio();
    }
  } else if (fps > 55 && dynRatio < 1) {
    dynRatio = Math.min(1, +(dynRatio + 0.05).toFixed(2));
    updatePixelRatio();
  }
  showQualityNow();
}
{
  // 上次自動降過級就沿用
  try {
    const autoLv = localStorage.getItem(KEY + '-auto-level') as Level | null;
    if (qPref === 'auto' && autoLv && autoLv !== level && ['high', 'medium', 'low'].includes(autoLv)) {
      const order: Level[] = ['high', 'medium', 'low'];
      if (order.indexOf(autoLv) > order.indexOf(level)) {
        level = autoLv;
        const nq = qualityFor(level);
        Object.assign(Q, nq);
        renderer.setPixelRatio(Math.min(devicePixelRatio, nq.pixelRatio));
        renderer.shadowMap.enabled = nq.shadows;
        world.sun.castShadow = nq.shadows;
        (scene.fog as THREE.Fog).far = nq.fogFar;
        circuitDetail(level);
      }
    }
  } catch { /* 不重要 */ }
}
if (Q.bloom) setupBloom();
const qSel = $<HTMLSelectElement>('opt-quality');
qSel.value = qPref;
showQualityNow();
qSel.addEventListener('change', () => {
  save.quality = qSel.value as Level | 'auto';
  try { localStorage.removeItem(KEY + '-auto-level'); } catch { /* 不重要 */ }
  writeSave();
  location.reload(); // 陰影、車流數量要重新建立，直接重新載入最單純
});

// ---------------------------------------------------------------- 主迴圈
const clock = new THREE.Clock();
let fpsN2 = 0, fpsT2 = 0, cullAcc = 1;
let acc = 0; // （保留給同步模擬用）
void acc;
car.placeAt(track, 1);
showMenu(false);
// ?phys：汽車物理測試（加速、轉彎半徑、撞牆後能不能脫困），結果寫在標題
if (new URLSearchParams(location.search).has('phys')) void cityLoad.then(() => { mode = 'free'; hideMenu(); beginFree(); document.title = physicsTest(fcar, collider, traffic, breakables); });

// ?free：直接進自由駕駛（加 &bot&sim=N 會油門全開直行 N 秒，測碰撞用）
const FREE = new URLSearchParams(location.search).has('free');
const FREE_SIM = FREE && BOT;
const IDLE = new URLSearchParams(location.search).has('idle'); // 測車流：玩家停在原地
const NO_TRAFFIC = new URLSearchParams(location.search).has('notraffic'); // 測路線用：關掉車流
const SR_TEST = new URLSearchParams(location.search).get('sr');
const TAXI_TEST = new URLSearchParams(location.search).has('taxi'); // ?free&bot&taxi&sim=N：自動跑計程車任務
/** 測試用：照計程車導航路線開，快到目標就減速停下 */
/** 測試用：開巡邏車直接衝向嫌犯 */
function chaseBot() {
  const s = police?.suspect?.car;
  if (!s) return { steer: 0, brake: true, throttle: false };
  let e = Math.atan2(s.x + s.vx * 0.5 - fcar.x, s.z + s.vz * 0.5 - fcar.z) - fcar.h;
  e = Math.atan2(Math.sin(e), Math.cos(e));
  const back = Math.abs(e) > 2.2 && Math.hypot(s.x - fcar.x, s.z - fcar.z) < 15;
  return { steer: Math.max(-1, Math.min(1, (back ? 1 : -1) * e * 2.2)), brake: back, throttle: !back };
}
function taxiBot() {
  const path = taxi?.route, tg = taxi?.target;
  if (!path || !tg || path.length < 2) return { steer: 0, brake: true, throttle: false };
  let bi = 0, bd = Infinity;
  for (let i = 0; i < path.length; i++) { const d = (path[i][0] - fcar.x) ** 2 + (path[i][1] - fcar.z) ** 2; if (d < bd) { bd = d; bi = i; } }
  const j = Math.min(path.length - 1, bi + 4 + Math.round(Math.abs(fcar.v) * 0.25));
  let e = Math.atan2(path[j][0] - fcar.x, path[j][1] - fcar.z) - fcar.h;
  e = Math.atan2(Math.sin(e), Math.cos(e));
  const dist = Math.hypot(tg.x - fcar.x, tg.z - fcar.z);
  const want = dist < 7 ? 0 : Math.min(16, 3 + dist * 0.25) * (Math.abs(e) > 0.6 ? 0.5 : 1);
  return { steer: Math.max(-1, Math.min(1, -e * 2.2)), brake: fcar.v > want + 1, throttle: fcar.v < want };
} // 測街頭飆車：?free&bot&sr=0&sim=N 自動接受第 0 個挑戰，玩家照路線開
if (BOT && !FREE) void cityLoad.then(() => {
  mode = 'race';
  raceKind = new URLSearchParams(location.search).has('gp') ? 'gp' : 'tt';
  const lapQ = new URLSearchParams(location.search).get('laps'); // 測試：?bot&gp&laps=6
  if (lapQ) $<HTMLSelectElement>('opt-laps').value = lapQ;
  hideMenu();
  if (raceKind === 'gp' && QUALI_TEST) startQuali(); else beginCountdown(); // ?bot&gp&quali：先跑排位賽
  runSim();
});
if (FREE) void cityLoad.then(() => {
  mode = 'free';
  hideMenu();
  beginFree();
  if (FREE_SIM) {
    if (TAXI_TEST) taxi?.start(fcar.x, fcar.z);
    if (SR_TEST != null && sr?.challenges[+SR_TEST]) acceptChallenge(sr.challenges[+SR_TEST], new URLSearchParams(location.search).has('duel'));
    for (let n = 0; n < SIM / STEP; n++) freeStep(STEP);
    if (TAXI_TEST && taxi) { roadAcc = lmAcc = 1; updateFreeHud(0); document.title = `TAXI 趟數${taxi.trips} 收入${taxi.money} 狀態${taxi.phase} 目標${taxi.target?.nm} 剩${Math.round(taxi.timeLeft)}s 地點數${(taxi as unknown as { places: unknown[] }).places.length} 車${fcar.x.toFixed(0)},${fcar.z.toFixed(0)} 速${(fcar.v * 3.6).toFixed(0)} 路線${taxi.route?.length ?? 0}點 距目標${taxi.target ? Math.hypot(taxi.target.x - fcar.x, taxi.target.z - fcar.z).toFixed(0) : "-"}m`; return; }
    if (SR_TEST != null && sr) { if (!document.title.startsWith('DUEL')) document.title = `SR ${sr.active?.def.title} 長${sr.active?.length.toFixed(0)}m 檢查點${sr.next}/${sr.active?.checkpoints.length} 玩家${sr.playerDone?.toFixed(1)} 對手${sr.rivalDone?.toFixed(1)} 對手進度${sr.rivalS.toFixed(0)} 挑戰數${sr.challenges.length} 對手最大被撞開${sr.maxKnock.toFixed(1)}m`; return; }
    breakables?.update(1, fcar.x, fcar.z); // 同步模擬沒有跑畫面，把倒下動畫直接推到底，截圖才看得到
    roadAcc = lmAcc = 1;
    updateFreeHud(0);
    if (HONK_TEST) { document.title = `HONK 讓路${honkYield}台 按喇叭${honkBack}次 被擋${traffic?.agents.filter((a) => a.blockT > 0).length} 玩家前後40m同向${traffic?.agents.filter((a) => a.alive && Math.hypot(a.x - fcar.x, a.z - fcar.z) < 40 && Math.cos(a.h - fcar.h) > 0.6).length} 車頭${fcar.h.toFixed(2)}`; return; }
    if (WANTED_TEST || PURSUIT_TEST) { document.title = `POLICE 星${police?.stars} 警車${police?.units.length} 路障${police?.blocks.length} 直升機${police?.heli.on ? "有" : "無"} 嫌犯${police?.suspect ? Math.round(police.suspectHp) + '%' : '-'} 嫌犯撞車${police?.suspectBumps} 疊住${police?.suspectOverlap} 錢${money()} ｜ ${policeLog.join(' / ')}`; return; }
    document.title = `FREE 積水${rainfx?.count}灘 水花${rainfx?.splashes} 尖叫${peds?.screamCount} 列車${trains?.count} 車損${Math.round(damage.value * 100)}% x=${fcar.x.toFixed(0)} z=${fcar.z.toFixed(0)} v=${(fcar.v * 3.6).toFixed(0)}km/h traffic=${traffic?.stats()} 行人${peds?.count}（人行道${peds?.sidewalks}段 斑馬線${peds?.crossingCount} 正在過${peds?.crossingNow} 等紅燈${peds?.waitingNow}）`;
  }
});
// ?bot&sim=N：不等畫面，直接同步模擬 N 秒（無頭瀏覽器測一圈用），結果寫在 document.title
const SIM = Number(new URLSearchParams(location.search).get('sim')) || 0;
function runSim() {
  if (!SIM) return;
  state = 'race';
  // ?bot&gp&solo：只留第一台 AI 在賽道上（其他車移走），量它自己一個人的圈速
  if (raceKind === 'gp' && new URLSearchParams(location.search).has('solo')) {
    field.racers.forEach((r, k) => { if (k > 0) { r.car.x = 1e5 + k * 100; r.car.z = 1e5; } });
    for (let n = 0; n < SIM / STEP; n++) field.update(STEP, true);
    const r0 = field.racers[0];
    const pr = r0.profile!;
    let pmin = Infinity, tmin = Infinity;
    for (let i = 0; i < pr.length; i++) { pmin = Math.min(pmin, pr[i]); tmin = Math.min(tmin, track.vTarget[i]); }
    document.title = `SOLO ${r0.name} 圈${r0.laps} 最快${r0.bestLap?.toFixed(2)} 撞牆${field.aiHits} 曲線最低${(pmin * 3.6).toFixed(0)} 建議最低${(tmin * 3.6).toFixed(0)} 曲線長${pr.length}/${track.N}`;
    return;
  }
  for (let n = 0; n < SIM / STEP; n++) {
    if ((state as State) === 'countdown') state = 'race'; // 排位賽跑完接正賽：測試不等五燈
    if ((state as State) !== 'race') break; // 完賽就停（不然計時賽的計圈會覆寫結果）
    step(STEP);
    if ((state as State) === 'race' && raceKind === 'gp') { radioTick(STEP); radio.update(STEP); }
  }
  // ?…&replay=秒數：直接進回放並停在那一刻（截圖檢查回放鏡頭）
  const rq = new URLSearchParams(location.search).get('replay');
  if (rq && (state as State) === 'results') { startReplay(); replaySpeed = 0; replayT = +rq; camMode = (new URLSearchParams(location.search).get('cam2') as 'tv' | 'chase' | 'heli') ?? 'tv'; camCut = 99; replayFrame(0); }
  if (raceKind === 'gp' && !document.title.startsWith('GP')) {
    // 正賽還沒跑完：印出每台車跑了幾圈、最快圈，方便找問題
    document.title = 'GP-RUN ' + field.standings().map((r) => `${r.name}:${r.laps}圈/${r.bestLap?.toFixed(1) ?? '-'}`).join(' ') + ` hits=${botHits}`;
  } else if (!/^(BOT|GP)/.test(document.title)) document.title = `BOT no lap; s=${car.pos.s.toFixed(0)} v=${car.v.toFixed(1)} hits=${botHits}`;
}
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mapOpen && bigmap) bigmap.draw(fcar.x, fcar.z, fcar.h, nav, nav?.path ?? null);
  if ((state === 'race' || state === 'free') && dt > 0 && !mapOpen) {
    // 每一幀剛好把物理推進到這一幀的時間：切成 n 小步（每步 ≤ 1/120 秒）。
    // 之前固定 1/120 秒一步、剩下的留到下一幀，幀率不是 60/120 時每幀步數忽多忽少，畫面會一頓一頓。
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6)), sub = dt / n;
    for (let k = 0; k < n; k++) { if (state === 'race') step(sub); else if (state === 'free') freeStep(sub); }
  } else {
    if (state === 'countdown') updateCountdown(dt);
  }
  if (state === 'replay') replayFrame(dt); else updateVisuals(dt);
  if (state === 'podium') { podiumFrame(dt); circuitEnv?.crowd.cheer(1); }
  circuitEnv?.crowd.tick(dt, camera.position.x, camera.position.z); // 看台觀眾：鏡頭靠近時興奮一點
  if (state === 'race' && raceKind === 'gp' && !SIM) { radioTick(dt); radio.update(dt); }
  cityStream?.tick(dt); // 新載入的城市區塊長起來
  // 車庫分頁看得到時才畫 3D 預覽；烤漆照遊戲裡那台
  garage3d.frame(dt, !menu.classList.contains('hidden') && !!document.querySelector('.m-pane.on[data-pane="garage"]'), (playerCars.get(preview.id as VehicleId)?.model.root.userData.paint as THREE.MeshStandardMaterial | undefined)?.color ?? null);
  // FPS 顯示（選單可開）：每 0.5 秒更新一次平均幀率與每幀毫秒數
  fpsN2++; fpsT2 += dt;
  cullAcc += dt;
  if (cullAcc > 0.4 && cityCull) {
    cullAcc = 0;
    cityCull(camera.position.x, camera.position.z, Q.viewDist); // 遠的城市區塊不畫
    if (cityReady) cityStream?.update(camera.position.x, camera.position.z, Q.viewDist); // 載入前方的區塊、卸掉遠的
  }
  if (fpsT2 >= 0.5) {
    const el = $('fps');
    el.style.display = opts.fps ? '' : 'none';
    if (opts.fps) el.textContent = `${Math.round(fpsN2 / fpsT2)} FPS · ${((fpsT2 / fpsN2) * 1000).toFixed(1)} ms · ${LEVEL_NAME[level]}`;
    fpsN2 = 0; fpsT2 = 0;
  }
  if (state === 'race' || state === 'countdown') updateDrsButton();
  weather.update(dt, camera.position);
  if (cityReady) tickCycle(dt);
  tickStats(dt);
  if (holdRender) return;
  if (composer) composer.render(); else renderer.render(scene, camera);
  watchFps();
});

// 離線快取：只在正式版註冊（npm run dev 時不要，否則改了程式碼看不到）
if (import.meta.env.PROD && 'serviceWorker' in navigator && !BOT) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// 讓 Chrome 截圖測試或除錯時可以從外部看狀態
(window as unknown as { __gp: unknown }).__gp = { car, track, renderer, scene, input, damage, fcar, get trains() { return trains; }, get peds() { return peds; }, get stream() { return cityStream; }, sound, field, get pedzones() { return pedzones; }, camera, get breakables() { return breakables; }, get collider() { return collider; }, drift, step: (dt: number) => step(dt), get state() { return state; } };
