import './style.css';
import * as THREE from 'three';
import { buildTrack, VMAX } from './track';
import { buildWorld } from './world';
import { loadCity } from './city';
import { makeCar, makeSedan } from './carModel';
import { FreeCar, CAR_VMAX } from './freecar';
import { Collider, RoadNet } from './citydata';
import { shortEn, type Landmark } from './decor';
import { Minimap } from './minimap';
import { Traffic } from './traffic';
import { Car } from './car';
import { Input } from './input';
import { Sound } from './audio';

// ---------------------------------------------------------------- 存檔
interface Ghost { t: number[]; s: number[]; x: number[]; z: number[]; h: number[] }
interface Save { best: number | null; sectors: (number | null)[]; ghost: Ghost | null; opts: Record<string, boolean> }
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
const renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 5000);
const track = buildTrack();
const world = buildWorld(scene, track);
let cityReady = false;
let collider: Collider | null = null, roadNet: RoadNet | null = null, minimap: Minimap | null = null;
let landmarks: Landmark[] = [];
let traffic: Traffic | null = null;
const MOBILE = matchMedia('(pointer: coarse)').matches;
const cityLoad = loadCity(scene, track).then((c) => {
  collider = new Collider(c.data);
  roadNet = new RoadNet(c.data);
  minimap = new Minimap($<HTMLCanvasElement>('minimap'), roadNet);
  landmarks = c.landmarks;
  traffic = new Traffic(scene, c.data, MOBILE);
  cityReady = true;
  if (state === 'menu') showMenu(false);
}).catch((e) => {
  console.error(e);
  cityReady = true; // 街景載入失敗也讓人能玩（只剩賽道）
  $('menu-best').textContent = '街景載入失敗，請檢查網路後重新整理';
});

const carModel = makeCar('#d81e2a');
scene.add(carModel.root);
const ghostModel = makeCar('#7fe8ff', true);
ghostModel.root.visible = false;
scene.add(ghostModel.root);

const sedanModel = makeSedan('#f2f2f0');
sedanModel.root.visible = false;
scene.add(sedanModel.root);

const car = new Car(); // 街道賽的 F1
const fcar = new FreeCar(); // 自由駕駛的汽車
type Mode = 'free' | 'race';
let mode: Mode = 'free';
const veh = () => (mode === 'race' ? car : fcar);
const input = new Input($('pad'), $('pad-dot'), $('brake'), $('gas'));
const sound = new Sound();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
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
type State = 'menu' | 'countdown' | 'race' | 'free' | 'paused';
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
  const impact = car.update(dt, track, inp.steer, inp.brake);
  if (impact) { sound.hit(impact); botHits++; }
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
  model.root.position.set(vc.x, 0, vc.z);
  model.root.rotation.y = vc.h;
  model.body.rotation.z = vc.steer * Math.min(1, Math.abs(vc.v) / 40) * (mode === 'race' ? 0.04 : 0.06);
  for (const w of model.steer) w.rotation.y = -vc.steer * 0.45;
  for (const w of model.spin) w.rotation.x += (vc.v / 0.35) * dt;

  // 影子車
  const g = save.ghost;
  const showGhost = opts.ghost && g && g.t.length > 1 && state === 'race';
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

  // HUD
  if (state === 'free') updateFreeHud(dt);
  if (state === 'race' || state === 'countdown') {
    $('time').textContent = fmt(lapTime);
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
  hideMenu();
  beginCountdown();
});
$('btn-free').addEventListener('click', async () => {
  await userStart();
  mode = 'free';
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
  const inp = FREE_SIM ? { steer: 0, brake: false, throttle: !IDLE } : input.read();
  let impact = fcar.update(dt, inp.steer, inp.throttle, inp.brake, collider);
  if (traffic) {
    traffic.update(dt, fcar);
    impact = Math.max(impact, traffic.collidePlayer(fcar));
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
    minimap?.draw(fcar.x, fcar.z, fcar.h);
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

// ---------------------------------------------------------------- 主迴圈
const clock = new THREE.Clock();
let acc = 0;
car.placeAt(track, 1);
showMenu(false);
// ?free：直接進自由駕駛（加 &bot&sim=N 會油門全開直行 N 秒，測碰撞用）
const FREE = new URLSearchParams(location.search).has('free');
const FREE_SIM = FREE && BOT;
const IDLE = new URLSearchParams(location.search).has('idle'); // 測車流：玩家停在原地
if (BOT && !FREE) void cityLoad.then(() => { mode = 'race'; hideMenu(); beginCountdown(); runSim(); });
if (FREE) void cityLoad.then(() => {
  mode = 'free';
  hideMenu();
  beginFree();
  if (FREE_SIM) {
    for (let n = 0; n < SIM / STEP; n++) freeStep(STEP);
    roadAcc = lmAcc = 1;
    updateFreeHud(0);
    document.title = `FREE x=${fcar.x.toFixed(0)} z=${fcar.z.toFixed(0)} v=${(fcar.v * 3.6).toFixed(0)}km/h traffic=${traffic?.stats()}`;
  }
});
// ?bot&sim=N：不等畫面，直接同步模擬 N 秒（無頭瀏覽器測一圈用），結果寫在 document.title
const SIM = Number(new URLSearchParams(location.search).get('sim')) || 0;
function runSim() {
  if (!SIM) return;
  state = 'race';
  for (let n = 0; n < SIM / STEP; n++) step(STEP);
  if (!document.title.startsWith('BOT')) document.title = `BOT no lap; s=${car.pos.s.toFixed(0)} v=${car.v.toFixed(1)} hits=${botHits}`;
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
  renderer.render(scene, camera);
});

// 離線快取：只在正式版註冊（npm run dev 時不要，否則改了程式碼看不到）
if (import.meta.env.PROD && 'serviceWorker' in navigator && !BOT) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// 讓 Chrome 截圖測試或除錯時可以從外部看狀態
(window as unknown as { __gp: unknown }).__gp = { car, track, get state() { return state; } };
