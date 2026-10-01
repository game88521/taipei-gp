import './style.css';
import * as THREE from 'three';
import { buildTrack, VMAX } from './track';
import { buildWorld } from './world';
import { loadCity } from './city';
import { makeCar } from './carModel';
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
const cityLoad = loadCity(scene, track).then(() => {
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

const car = new Car();
const input = new Input($('pad'), $('pad-dot'), $('brake'));
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
type State = 'menu' | 'countdown' | 'race' | 'paused';
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
  carModel.root.position.set(car.x, 0, car.z);
  carModel.root.rotation.y = car.h;
  carModel.body.rotation.z = car.steer * Math.min(1, car.v / 40) * 0.04;
  for (const w of carModel.steer) w.rotation.y = -car.steer * 0.35;
  for (const w of carModel.spin) w.rotation.x += (car.v / 0.36) * dt;

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
  let d = car.h - camH;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  camH += camSnap ? d : d * Math.min(1, dt * 7);
  const fx = Math.sin(camH), fz = Math.cos(camH);
  const target = new THREE.Vector3(car.x - fx * 8, 2.9, car.z - fz * 8);
  const look = new THREE.Vector3(car.x + fx * 6, 1.1, car.z + fz * 6);
  if (camSnap) { camPos.copy(target); camLook.copy(look); camSnap = false; }
  const k = Math.min(1, dt * 10);
  camPos.lerp(target, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  const fov = 62 + (car.v / VMAX) * 16;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (CAM) { camera.position.set(CAM[0], CAM[1], CAM[2]); camera.lookAt(CAM[3], CAM[4], CAM[5]); }
  world.sky.position.copy(camera.position);

  // HUD
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
  $('menu-best').textContent = save.best != null ? `最快圈 ${fmt(save.best)}` : '還沒有紀錄';
  const btn = $<HTMLButtonElement>('btn-start');
  btn.disabled = !cityReady;
  btn.textContent = !cityReady ? '載入台北街景中…' : paused ? '繼續' : '開始';
  $('btn-restart').style.display = paused ? '' : 'none';
  menu.classList.remove('hidden');
  hud.classList.add('hidden');
}
function hideMenu() {
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
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
  hideMenu();
  if (state === 'paused') { state = pausedFrom; clock.getDelta(); }
  else beginCountdown();
});
$('btn-restart').addEventListener('click', async () => {
  await userStart();
  hideMenu();
  beginCountdown();
});
let pausedFrom: State = 'race';
function pause() {
  if (state !== 'race' && state !== 'countdown') return;
  pausedFrom = state;
  state = 'paused';
  sound.engine(0, 0, false);
  showMenu(true);
}
$('btn-pause').addEventListener('click', pause);
$('btn-reset').addEventListener('click', () => { if (state === 'race') car.placeAt(track, car.pos.i); });
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

// ---------------------------------------------------------------- 主迴圈
const clock = new THREE.Clock();
let acc = 0;
car.placeAt(track, 1);
showMenu(false);
if (BOT) void cityLoad.then(() => { hideMenu(); beginCountdown(); runSim(); });
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
  if (state === 'race') {
    acc += dt;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
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
