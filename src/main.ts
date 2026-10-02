import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { qualityFor, defaultLevel, LOWER, LEVEL_NAME, type Level } from './quality';
import { buildTrack, VMAX } from './track';
import { buildWorld } from './world';
import { loadCity } from './city';
import { makeSedan } from './carModel';
import { makeF1 } from './f1model';
import { FreeCar, CAR_VMAX } from './freecar';
import { Collider, RoadNet } from './citydata';
import { shortEn, type Landmark } from './decor';
import { Minimap } from './minimap';
import { Traffic } from './traffic';
import { Pedestrians } from './peds';
import { RaceField, LAPS, PLAYER_LIVERY } from './rivals';
import { StreetRace, type Challenge } from './streetrace';
import { Car } from './car';
import { Input } from './input';
import { Sound } from './audio';

// ---------------------------------------------------------------- 存檔
interface Ghost { t: number[]; s: number[]; x: number[]; z: number[]; h: number[] }
interface Save { best: number | null; sectors: (number | null)[]; ghost: Ghost | null; opts: Record<string, boolean>; street?: Record<string, number>; quality?: Level | 'auto' }
const KEY = 'taipei-gp-v2'; // v2 = 真實街道賽道（舊賽道的紀錄與影子車不適用）
function loadSave(): Save {
  const empty: Save = { best: null, sectors: [null, null, null], ghost: null, opts: {} };
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return empty; }
}
function writeSave() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* 無痕模式存不了就算了 */ }
}
const save = loadSave();

// ---------------------------------------------------------------- 場景
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MOBILE = matchMedia('(pointer: coarse)').matches; // 觸控裝置（手機、平板）
const qPref = save.quality ?? 'auto';
let level: Level = qPref === 'auto' ? defaultLevel(MOBILE) : qPref;
const Q = qualityFor(level);
const renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 2 && !Q.bloom, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 5000);
const track = buildTrack();
const world = buildWorld(scene, track);
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
// 環境反射：用天空漸層＋夕陽做一張反射貼圖，車漆、玻璃帷幕會映出晚霞
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(world.sky.geometry, world.sky.material));
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(160, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2.6) }));
  sunBall.position.copy(world.sunDir).multiplyScalar(2000);
  env.add(sunBall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshBasicMaterial({ color: '#2e2b29' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -20;
  env.add(floor);
  scene.environment = pmrem.fromScene(env, 0.03, 0.1, 6000).texture;
  scene.environmentIntensity = 0.75; // 不要讓反光蓋過原本的顏色
  pmrem.dispose();
}
// 光暈（Bloom）：霓虹招牌、亮燈的窗戶、路燈、車燈、紅綠燈會暈開；最後加一點暗角與暖色調
let composer: EffectComposer | null = null, bloom: UnrealBloomPass | null = null;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.42 }, saturation: { value: 1.1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation) * vec3(1.03, 1.0, 0.96);
      float d = length((vUv - 0.5) * vec2(1.0, 0.8));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, d), vignette);
      gl_FragColor = c;
    }`,
};
function setupBloom() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * Q.bloomScale, innerHeight * Q.bloomScale), 0.55, 0.45, 0.82);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());
}
/** 平面（路面、綠地、地面）只接受陰影；有厚度的東西（建築、樹、車、人）才投射 */
function applyShadowFlags() {
  if (!Q.shadows) return;
  const box = new THREE.Box3(), size = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.shadowDone) return;
    o.userData.shadowDone = true;
    const mat0 = Array.isArray(m.material) ? m.material[0] : m.material;
    const lambert = mat0 instanceof THREE.MeshLambertMaterial || mat0 instanceof THREE.MeshStandardMaterial; // 有打光的材質
    if (!lambert) return;
    m.receiveShadow = true;
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) { m.castShadow = true; return; }
    box.setFromObject(m).getSize(size);
    m.castShadow = size.y > 0.3 && size.y < 1000;
  });
}
let cityReady = false;
let collider: Collider | null = null, roadNet: RoadNet | null = null, minimap: Minimap | null = null;
let landmarks: Landmark[] = [];
let traffic: Traffic | null = null;
let peds: Pedestrians | null = null;
let sr: StreetRace | null = null;
const cityLoad = loadCity(scene, track, Q).then((c) => {
  collider = new Collider(c.data);
  roadNet = new RoadNet(c.data);
  minimap = new Minimap($<HTMLCanvasElement>('minimap'), roadNet);
  landmarks = c.landmarks;
  traffic = new Traffic(scene, c.data, Q.traffic);
  peds = new Pedestrians(scene, c.data, collider, Q.peds);
  sr = new StreetRace(scene, c.data, c.landmarks);
  applyShadowFlags();
  cityReady = true;
  if (state === 'menu') showMenu(false);
}).catch((e) => {
  console.error(e);
  cityReady = true; // 街景載入失敗也讓人能玩（只剩賽道）
  $('menu-best').textContent = '街景載入失敗，請檢查網路後重新整理';
});

const carModel = makeF1(PLAYER_LIVERY); // 玩家：躍馬紅（紅白黑）
scene.add(carModel.root);
const ghostModel = makeF1(PLAYER_LIVERY, true);
ghostModel.root.visible = false;
scene.add(ghostModel.root);

const sedanModel = makeSedan('#f2f2f0');
sedanModel.root.visible = false;
scene.add(sedanModel.root);

const car = new Car(); // 街道賽的 F1
const field = new RaceField(scene, track, car); // 正賽的 7 台 AI 對手
let raceKind: 'gp' | 'tt' = 'tt'; // 正賽 or 計時賽
const fcar = new FreeCar(); // 自由駕駛的汽車
type Mode = 'free' | 'race';
let mode: Mode = 'free';
const veh = () => (mode === 'race' ? car : fcar);
const input = new Input($('pad'), $('pad-dot'), $('brake'), $('gas'));
const sound = new Sound();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
  bloom?.resolution.set(innerWidth * Q.bloomScale, innerHeight * Q.bloomScale);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- 選項
const opts = {
  tilt: save.opts.tilt ?? false,
  assist: save.opts.assist ?? true,
  ghost: save.opts.ghost ?? true,
  sound: save.opts.sound ?? true,
};
for (const k of Object.keys(opts) as (keyof typeof opts)[]) {
  const el = $<HTMLInputElement>('opt-' + k);
  el.checked = opts[k];
  el.addEventListener('change', () => { opts[k] = el.checked; save.opts = { ...opts }; writeSave(); applyOpts(); });
}
function applyOpts() {
  world.assist.visible = opts.assist;
  sound.enabled = opts.sound;
  input.tilt = opts.tilt;
}
applyOpts();

// ---------------------------------------------------------------- 比賽狀態
type State = 'menu' | 'countdown' | 'race' | 'free' | 'paused' | 'results';
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
  sectorDone(2, t - sectorStart);
  lastLap = t;
  $('last').textContent = fmt(t);
  if (save.best == null || t < save.best) {
    const first = save.best == null;
    save.best = t;
    save.ghost = rec;
    $('best').textContent = fmt(t);
    toast(first ? `完成第一圈！${fmt(t)}` : `最快圈！${fmt(t)}`, 'purple');
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
  let impact = car.update(dt, track, inp.steer, inp.brake);
  if (raceKind === 'gp') {
    impact = Math.max(impact, field.update(dt, true));
    field.playerLap(prevS);
    const me = field.racers.find((r) => r.isPlayer)!;
    if (me.finish != null && state === 'race') { showResults(); return; }
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

  const gear = gearOf(car.v);
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
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camH = 0;

function updateVisuals(dt: number) {
  // 車子
  const vc = veh(), model = mode === 'race' ? carModel : sedanModel;
  carModel.root.visible = mode === 'race';
  sedanModel.root.visible = mode === 'free';
  world.race.visible = mode === 'race';
  if (traffic) {
    traffic.visible = mode === 'free';
    if (mode === 'free') traffic.render(dt);
  }
  if (mode === 'race' && raceKind === 'gp') field.render(dt);
  if (sr && mode === 'free') sr.render(dt);
  if (peds) {
    peds.visible = mode === 'free';
    if (mode === 'free') peds.render();
  }
  model.root.position.set(vc.x, 0, vc.z);
  model.root.rotation.y = vc.h;
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
    ghostModel.root.position.set(g.x[a] + (g.x[b] - g.x[a]) * f, 0.02, g.z[a] + (g.z[b] - g.z[a]) * f);
    ghostModel.root.rotation.y = g.h[a] + dh * f;
    if (lapTime > g.t[g.t.length - 1]) ghostModel.root.visible = false;
  }

  // 追蹤鏡頭：車頭方向平滑跟隨，速度越快視野越寬
  let d = vc.h - camH;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  camH += camSnap ? d : d * Math.min(1, dt * 7);
  const fx = Math.sin(camH), fz = Math.cos(camH);
  const back = mode === 'race' ? 8 : 7.5, up = mode === 'race' ? 2.9 : 3.3;
  const target = new THREE.Vector3(vc.x - fx * back, up, vc.z - fz * back);
  const look = new THREE.Vector3(vc.x + fx * 6, 1.2, vc.z + fz * 6);
  if (camSnap) { camPos.copy(target); camLook.copy(look); camSnap = false; }
  const k = Math.min(1, dt * 10);
  camPos.lerp(target, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  const fov = 62 + (Math.abs(vc.v) / (mode === 'race' ? VMAX : CAR_VMAX)) * 14;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (CAM) { camera.position.set(CAM[0], CAM[1], CAM[2]); camera.lookAt(CAM[3], CAM[4], CAM[5]); }
  world.sky.position.copy(camera.position);
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
    if (lit > 0) sound.beep(440);
  }
  sound.engine(0.25 + (lit / 5) * 0.3, 0.4, true);
  if (countdown >= lightsOutAt) {
    lights.forEach((l) => l.classList.remove('on'));
    $('lights').classList.add('go');
    setTimeout(() => $('lights').classList.remove('go'), 900);
    sound.beep(880, 0.35);
    state = 'race';
  }
}

function beginCountdown() {
  resetRace();
  if (raceKind === 'gp') {
    field.setup(5); // 玩家從第 6 格起跑
    $('lap').textContent = `0/${LAPS}`;
  } else field.hide();
  hud.dataset.kind = raceKind;
  countdown = 0;
  litShown = 0;
  lightsOutAt = 5.4 + Math.random() * 1.2; // 五燈全亮後隨機停一下才熄，跟真的一樣
  state = 'countdown';
}

// ---------------------------------------------------------------- 選單
const menu = $('menu'), hud = $('hud');
function showMenu(paused: boolean) {
  $('menu-best').textContent = save.best != null ? `街道賽最快圈 ${fmt(save.best)}` : '';
  const free = $<HTMLButtonElement>('btn-free'), race = $<HTMLButtonElement>('btn-start');
  free.disabled = race.disabled = !cityReady;
  $('btn-resume').style.display = paused ? '' : 'none';
  free.textContent = !cityReady ? '載入台北街景中…' : '自由駕駛';
  race.style.display = cityReady ? '' : 'none';
  for (const id of ['btn-gp', 'btn-duel']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = !cityReady;
    b.style.display = cityReady ? '' : 'none';
  }
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
  if (opts.tilt) {
    const ok = await input.enableTilt();
    if (!ok) toast('無法使用陀螺儀，改用觸控轉向', '');
  }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (!document.fullscreenElement && el.requestFullscreen && matchMedia('(pointer: coarse)').matches) {
      await el.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    }
  } catch { /* iPhone 沒有全螢幕 API，略過 */ }
}
$('btn-start').addEventListener('click', async () => {
  await userStart();
  mode = 'race';
  raceKind = 'tt';
  hideMenu();
  beginCountdown();
});
$('btn-gp').addEventListener('click', async () => {
  await userStart();
  mode = 'race';
  raceKind = 'gp';
  hideMenu();
  beginCountdown();
});
$('btn-again').addEventListener('click', async () => {
  await userStart();
  $('results').classList.add('hidden');
  hideMenu();
  beginCountdown();
});
$('btn-menu').addEventListener('click', () => {
  $('results').classList.add('hidden');
  state = 'menu';
  sound.engine(0, 0, false);
  showMenu(false);
});

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
  $('lap').textContent = `${Math.min(LAPS, Math.max(1, mine.laps))}/${LAPS}`;
  const lead = field.progress(st[0]);
  const ol = $('board');
  ol.innerHTML = '';
  st.forEach((r, k) => {
    const li = document.createElement('li');
    if (r.isPlayer) li.className = 'me';
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
  const st = field.standings();
  const winner = st[0].finish ?? field.raceTime;
  const tb = $('res-table');
  tb.innerHTML = '<tr><th>名次</th><th>車手</th><th>車隊</th><th>成績</th><th>最快圈</th></tr>';
  st.forEach((r, k) => {
    const tr = document.createElement('tr');
    if (r.isPlayer) tr.className = 'me';
    const time = r.finish != null ? (k === 0 ? fmt(r.finish) : `+${(r.finish - winner).toFixed(3)}`) : `差 ${Math.max(1, LAPS + 1 - r.laps)} 圈內`;
    for (const v of [String(k + 1), r.name, r.team, time, fmt(r.bestLap)]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  const me = st.findIndex((r) => r.isPlayer) + 1;
  $('res-title').textContent = me === 1 ? '🏆 冠軍！' : me <= 3 ? `第 ${me} 名，上頒獎台！` : `第 ${me} 名`;
  $('results').classList.remove('hidden');
  if (BOT) document.title = `GP P${me} ${st.map((r) => r.name + ':' + (r.finish?.toFixed(1) ?? '-')).join(' ')}`;
}
$('btn-free').addEventListener('click', async () => {
  await userStart();
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
  pausedFrom = state;
  state = 'paused';
  sound.engine(0, 0, false);
  showMenu(true);
}
$('btn-pause').addEventListener('click', pause);
$('btn-reset').addEventListener('click', () => {
  if (state === 'race') car.placeAt(track, car.pos.i);
  if (state === 'free') unstick();
});
addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
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
  if (BOT) document.title = `DUEL ${c.def.title} P${place} ` + st.map((r) => `${r.name}:${r.done != null && isFinite(r.done) ? r.done.toFixed(1) : '-'}`).join(' ');
  if (win && me != null) {
    save.street = save.street || {};
    if (!save.street[c.def.id] || me < save.street[c.def.id]) save.street[c.def.id] = me;
    writeSave();
  }
  $('sr-res-title').textContent = sr.duel ? (place === 1 ? '🏆 街頭之王！' : `第 ${place} 名`) : win ? `🏆 你贏了 ${c.def.rival}！` : `${c.def.rival} 贏了`;
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
  // 從 101 前的信義路出發
  fcar.place(track.px[1], track.pz[1], Math.atan2(track.tx[1], track.tz[1]));
  unstick(); // 對齊到真實車道中心
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
  let g = 0;
  while (g < CAR_GEARS.length - 1 && v >= CAR_GEARS[g + 1]) g++;
  const lo = CAR_GEARS[g], hi = g === CAR_GEARS.length - 1 ? CAR_VMAX : CAR_GEARS[g + 1];
  return { n: g + 1, rpm: Math.min(1, (v - lo) / (hi - lo)) };
}
function freeStep(dt: number) {
  let inp = FREE_SIM ? (SR_TEST ? srBot() : { steer: 0, brake: false, throttle: !IDLE }) : input.read();
  if (sr?.phase === 'count') { inp = { steer: 0, brake: false, throttle: false }; fcar.vx = fcar.vz = fcar.w = 0; } // 倒數時原地不動（按煞車會變倒車）
  let impact = fcar.update(dt, inp.steer, inp.throttle, inp.brake, collider);
  if (sr) {
    const msg = sr.update(dt, fcar, traffic);
    if (msg) { bigMsg(msg); if (msg.length <= 3) sound.beep(msg === 'GO!' ? 880 : 520, 0.25); }
    impact = Math.max(impact, sr.collide(fcar));
    if (sr.phase === 'done' && !srShown) showStreetResult();
    if (sr.phase === 'idle' || sr.phase === 'offer') updateOffer(sr.checkOffer(fcar.x, fcar.z, fcar.v));
  }
  if (traffic && !NO_TRAFFIC) {
    traffic.update(dt, fcar, sr?.obstacle() ?? []);
    impact = Math.max(impact, traffic.collidePlayer(fcar));
  }
  if (peds && peds.update(dt, fcar)) {
    fcar.v *= 0.7; // 碰到行人：車子也被擋一下
    sound.hit(6);
  }
  if (impact) sound.hit(impact * 2.5);
  sound.engine(0.15 + 0.55 * carGear(Math.abs(fcar.v)).rpm, inp.throttle ? 1 : 0.2, true);
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
    minimap?.draw(fcar.x, fcar.z, fcar.h, sr?.mapInfo);
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

// ---------------------------------------------------------------- 畫質：選單設定、開局太卡自動降一級
let fpsT = 0, fpsN = 0, fpsChecked = false;
function watchFps(dt: number) {
  if (fpsChecked || BOT || (state !== 'free' && state !== 'race')) return;
  fpsT += dt;
  fpsN++;
  if (fpsT < 6) return;
  fpsChecked = true;
  const fps = fpsN / fpsT;
  if (fps >= 32 || level === 'low' || qPref !== 'auto') return;
  // 先做不用重新載入就能生效的：關光暈、降解析度、關陰影
  level = LOWER[level];
  const nq = qualityFor(level);
  if (!nq.bloom) { composer = null; bloom = null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, nq.pixelRatio));
  if (!nq.shadows) { world.sun.castShadow = false; renderer.shadowMap.enabled = false; }
  save.quality = 'auto';
  save.opts = { ...opts };
  try { localStorage.setItem(KEY + '-auto-level', level); } catch { /* 不重要 */ }
  toast(`畫面有點卡（${fps.toFixed(0)} fps），已自動調成「${LEVEL_NAME[level]}」畫質`, '');
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
      }
    }
  } catch { /* 不重要 */ }
}
if (Q.bloom) setupBloom();
const qSel = $<HTMLSelectElement>('opt-quality');
qSel.value = qPref;
$('quality-now').textContent = `目前：${LEVEL_NAME[level]}`;
qSel.addEventListener('change', () => {
  save.quality = qSel.value as Level | 'auto';
  try { localStorage.removeItem(KEY + '-auto-level'); } catch { /* 不重要 */ }
  writeSave();
  location.reload(); // 陰影、車流數量要重新建立，直接重新載入最單純
});

// ---------------------------------------------------------------- 主迴圈
const clock = new THREE.Clock();
let acc = 0;
car.placeAt(track, 1);
showMenu(false);
// ?phys：汽車物理測試（加速、轉彎半徑、撞牆後能不能脫困），結果寫在標題
function physicsTest() {
  const out: string[] = [];
  const c = new FreeCar();
  // 1) 0→100 km/h
  c.place(0, 0, 0);
  let t = 0;
  while (c.v < 27.8 && t < 30) { c.update(STEP, 0, true, false, null); t += STEP; }
  out.push(`0-100:${t.toFixed(1)}s`);
  // 2) 60 km/h 方向盤打滿的迴轉半徑
  c.place(0, 0, 0);
  while (c.v < 16.7) c.update(STEP, 0, true, false, null);
  for (let k = 0; k < 240; k++) c.update(STEP, 1, c.v < 16.7, false, null);
  out.push(`R60:${(Math.abs(c.v / c.w)).toFixed(1)}m`);
  // 3) 120 km/h 打滿
  c.place(0, 0, 0);
  while (c.v < 33.3) c.update(STEP, 0, true, false, null);
  for (let k = 0; k < 240; k++) c.update(STEP, 1, c.v < 33.3, false, null);
  out.push(`R120:${(Math.abs(c.v / c.w)).toFixed(1)}m`);
  // 4) 撞牆：從起點直衝，記錄撞擊、反彈後速度，再倒車 1.5 秒、打方向加油 3 秒看能不能脫困
  if (collider) {
    c.place(fcar.x, fcar.z, fcar.h);
    let hitAt = -1, maxImpact = 0, bounce = 0;
    for (let k = 0; k < 120 * 40 && hitAt < 0; k++) {
      const imp = c.update(STEP, 0, true, false, collider);
      if (imp > 0) { hitAt = k; maxImpact = imp; }
    }
    for (let k = 0; k < 30; k++) { c.update(STEP, 0, false, false, collider); bounce = Math.min(bounce, c.v); }
    const x0 = c.x, z0 = c.z;
    for (let k = 0; k < 180; k++) c.update(STEP, 0, false, true, collider);
    const back = Math.hypot(c.x - x0, c.z - z0);
    const x1 = c.x, z1 = c.z;
    for (let k = 0; k < 360; k++) c.update(STEP, 1, true, false, collider);
    const away = Math.hypot(c.x - x1, c.z - z1);
    out.push(`撞擊:${(maxImpact * 3.6).toFixed(0)}km/h 反彈:${(bounce * 3.6).toFixed(1)}km/h 倒車退:${back.toFixed(1)}m 轉向開走:${away.toFixed(1)}m`);
  }
  document.title = 'PHYS ' + out.join(' ');
}
if (new URLSearchParams(location.search).has('phys')) void cityLoad.then(() => { mode = 'free'; hideMenu(); beginFree(); physicsTest(); });

// ?free：直接進自由駕駛（加 &bot&sim=N 會油門全開直行 N 秒，測碰撞用）
const FREE = new URLSearchParams(location.search).has('free');
const FREE_SIM = FREE && BOT;
const IDLE = new URLSearchParams(location.search).has('idle'); // 測車流：玩家停在原地
const NO_TRAFFIC = new URLSearchParams(location.search).has('notraffic'); // 測路線用：關掉車流
const SR_TEST = new URLSearchParams(location.search).get('sr'); // 測街頭飆車：?free&bot&sr=0&sim=N 自動接受第 0 個挑戰，玩家照路線開
if (BOT && !FREE) void cityLoad.then(() => {
  mode = 'race';
  raceKind = new URLSearchParams(location.search).has('gp') ? 'gp' : 'tt';
  hideMenu();
  beginCountdown();
  runSim();
});
if (FREE) void cityLoad.then(() => {
  mode = 'free';
  hideMenu();
  beginFree();
  if (FREE_SIM) {
    if (SR_TEST != null && sr?.challenges[+SR_TEST]) acceptChallenge(sr.challenges[+SR_TEST], new URLSearchParams(location.search).has('duel'));
    for (let n = 0; n < SIM / STEP; n++) freeStep(STEP);
    if (SR_TEST != null && sr) { if (!document.title.startsWith('DUEL')) document.title = `SR ${sr.active?.def.title} 長${sr.active?.length.toFixed(0)}m 檢查點${sr.next}/${sr.active?.checkpoints.length} 玩家${sr.playerDone?.toFixed(1)} 對手${sr.rivalDone?.toFixed(1)} 對手進度${sr.rivalS.toFixed(0)} 挑戰數${sr.challenges.length} 對手最大被撞開${sr.maxKnock.toFixed(1)}m`; return; }
    roadAcc = lmAcc = 1;
    updateFreeHud(0);
    document.title = `FREE x=${fcar.x.toFixed(0)} z=${fcar.z.toFixed(0)} v=${(fcar.v * 3.6).toFixed(0)}km/h traffic=${traffic?.stats()} 行人${peds?.count}（人行道${peds?.sidewalks}段）`;
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
  for (let n = 0; n < SIM / STEP && state === 'race'; n++) step(STEP); // 完賽就停（不然計時賽的計圈會覆寫結果）
  if (raceKind === 'gp' && !document.title.startsWith('GP')) {
    // 正賽還沒跑完：印出每台車跑了幾圈、最快圈，方便找問題
    document.title = 'GP-RUN ' + field.standings().map((r) => `${r.name}:${r.laps}圈/${r.bestLap?.toFixed(1) ?? '-'}`).join(' ') + ` hits=${botHits}`;
  } else if (!/^(BOT|GP)/.test(document.title)) document.title = `BOT no lap; s=${car.pos.s.toFixed(0)} v=${car.v.toFixed(1)} hits=${botHits}`;
}
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state === 'race' || state === 'free') {
    acc += dt;
    while (acc >= STEP) { if (state === 'race') step(STEP); else freeStep(STEP); acc -= STEP; }
  } else {
    acc = 0;
    if (state === 'countdown') updateCountdown(dt);
  }
  updateVisuals(dt);
  if (composer) composer.render(); else renderer.render(scene, camera);
  watchFps(dt);
});

// 離線快取：只在正式版註冊（npm run dev 時不要，否則改了程式碼看不到）
if (import.meta.env.PROD && 'serviceWorker' in navigator && !BOT) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// 讓 Chrome 截圖測試或除錯時可以從外部看狀態
(window as unknown as { __gp: unknown }).__gp = { car, track, get state() { return state; } };
