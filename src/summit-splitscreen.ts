import * as THREE from 'three';
import {acquireAtlasPageLease} from './atlas-storage-lease';
import './summit-splitscreen.css';
import { SummitSplitRace, SPLIT_STEP } from './summit-split-race';
import { SummitSplitInput, type SplitBinding } from './summit-split-input';
import { loadMultiplayerTrack } from './multiplayer-track-loader';
import { MULTIPLAYER_TRACKS } from '../shared/multiplayer-tracks';
import { buildWorld } from './world';
import { buildCircuitEnv } from './circuitenv';
import { surfaceY, bankRoll } from './track';
import { makeF1 } from './f1model';
import { disposeMultiplayerScene } from './multiplayer-scene-resources';
import type { CarModel } from './carModel';
import type { PadSample } from './input';

await acquireAtlasPageLease();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $('split-menu'), form = $<HTMLFormElement>('split-form'), status = $('split-status'), running = $('split-running'), results = $('split-results'), huds = $('split-huds');
const map = $<HTMLSelectElement>('split-map'), laps = $<HTMLSelectElement>('split-laps');
const devices = [$<HTMLSelectElement>('split-device1'), $<HTMLSelectElement>('split-device2')];
const input = new SummitSplitInput(), cameras = [new THREE.PerspectiveCamera(65,1,.4,3500),new THREE.PerspectiveCamera(65,1,.4,3500)];
const cameraTargets = [new THREE.Vector3(),new THREE.Vector3()];
let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene | null = null, models: CarModel[] = [];
let race: SummitSplitRace | null = null, controller: AbortController | null = null, generation = 0, loading = false, saved = false, disposed = false;
let last = performance.now(), accumulator = 0;
const pads = (): (PadSample | null)[] => { try { return Array.from(navigator.getGamepads?.() ?? []); } catch { return []; } };
const fmt = (s: number) => `${Math.floor(s/60)}:${(s%60).toFixed(2).padStart(5,'0')}`;
const requiredSeats = () => race?.drivers.map(d=>!d.dnf&&d.finish===null) ?? [true,true];
for (const track of MULTIPLAYER_TRACKS) { const o = document.createElement('option'); o.value = track.id; o.textContent = `${track.flag} ${track.name}`; map.append(o); }

function refreshDevices() {
  const all = pads().filter((p): p is PadSample => !!p?.connected && p.mapping === 'standard');
  devices.forEach((select,index) => {
    const previous = select.value; select.replaceChildren();
    const keyboard = document.createElement('option'); keyboard.value = 'keyboard'; keyboard.textContent = '鍵盤 WASD'; select.append(keyboard);
    for (const pad of all) { const option = document.createElement('option'); option.value = String(pad.index); option.textContent = `手把 ${pad.index+1}（標準配置）`; select.append(option); }
    if ([...select.options].some(o=>o.value===previous) && previous !== '') select.value = previous;
    else select.value = index === 1 && all.length ? String(all[0].index) : 'keyboard';
  });
  status.textContent = all.length ? `偵測到 ${all.length} 支標準手把。每席選不同裝置，先放開搖桿和按鈕再起跑。` : '尚未偵測到標準手把。請先在手把按任一按鈕，再重新偵測；此模式至少需要一支手把。';
}
$('split-refresh').onclick = refreshDevices;
addEventListener('gamepadconnected', () => { if (!race && !loading) refreshDevices(); });
addEventListener('gamepaddisconnected', () => { if (race && race.phase !== 'results') { if(input.read(pads(),true,requiredSeats()).missing)pause('手把已斷線。請接回原裝置，放開所有按鈕後繼續。'); } else if (!loading) refreshDevices(); });
refreshDevices();

function releaseMap() { if (scene) disposeMultiplayerScene(scene); scene = null; models = []; renderer?.renderLists.dispose(); }
function ensureRenderer() {
  if (renderer?.getContext().isContextLost()) { renderer.dispose(); renderer.domElement.remove(); renderer = null; }
  if (renderer) return renderer;
  const value = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  value.setPixelRatio(Math.min(devicePixelRatio,1.25)); value.setSize(innerWidth,innerHeight); value.setScissorTest(true); value.toneMapping = THREE.ACESFilmicToneMapping;
  $('split-stage').append(value.domElement); value.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); if(renderer!==value)return; pause('3D 畫面已中斷，請重新選圖。'); $('split-resume').setAttribute('disabled',''); });
  renderer = value; return value;
}
function showMenu() { menu.hidden = false; input.reset(); accumulator = 0; }
function pause(reason: string) {
  if (!race || race.phase === 'results') return;
  race.pause(reason); showMenu(); form.hidden = true; running.hidden = false;
  $('split-reason').textContent = reason; $('split-new').hidden = false; $('split-resume').focus();
}
function finish() {
  if (!race || race.phase !== 'results' || saved) return;
  saved = true; showMenu(); form.hidden = true; running.hidden = true; results.hidden = false; $('split-new').hidden = false;
  const list = $('split-result-list'); list.replaceChildren();
  const record = { at: Date.now(), track: map.value, laps: race.laps, drivers: race.order.map(d => ({ id: d.id, finish: d.finish, dnf: d.dnf, laps: d.laps })) };
  for (const [index, d] of race.order.entries()) { const li = document.createElement('li'); li.textContent = `${index+1}. ${d.id} · ${d.dnf ? `未完賽（${d.laps} 圈）` : fmt(d.finish!)} · 撞牆 ${d.hits} 次`; list.append(li); }
  try {
    const raw = localStorage.getItem('taipei-gp-split-results-v1');
    const old: unknown = raw && raw.length < 32000 ? JSON.parse(raw) : [];
    localStorage.setItem('taipei-gp-split-results-v1', JSON.stringify([record,...(Array.isArray(old) ? old : [])].slice(0,20)));
  } catch { const p = document.createElement('p'); p.textContent = '本機成績無法保存；本場結果仍可查看。'; list.append(p); }
  $('split-result-title').focus();
}
async function start() {
  if (loading || disposed) return;
  const bindings = devices.map(s => s.value === 'keyboard' ? 'keyboard' : Number(s.value)) as [SplitBinding,SplitBinding];
  try { input.bind(bindings); const sample=input.read(pads(),true); if (sample.missing) throw Error('選取的手把不在連線中，請重新偵測。'); }
  catch (error) { status.textContent = (error as Error).message; return; }
  const token = ++generation; controller?.abort(); controller = new AbortController();
  loading = true; $('split-start').setAttribute('disabled',''); status.textContent = '正在載入賽道…';
  releaseMap(); race = null; results.hidden = true; saved = false;
  try {
    const loaded = await loadMultiplayerTrack(map.value,{signal:controller.signal});
    if (token !== generation || disposed) return;
    const value = ensureRenderer(), draft = new THREE.Scene(); scene = draft;
    draft.background = new THREE.Color('#8fa9bc'); draft.fog = new THREE.Fog('#8fa9bc',250,1800);
    const world=buildWorld(draft,loaded.track,loaded.descriptor.circuit?.banner); world.race.visible=true;
    if (loaded.descriptor.circuit) { const environment=buildCircuitEnv(draft,loaded.track,loaded.descriptor.circuit,world); environment.setDetail('low'); }
    // Shared closed-circuit scenery keeps the two views within one GPU context.
    models = ['#39bedc','#f2a543'].map((color,index) => { const m=makeF1({main:color,accent:'#f5f7fa',accent2:'#27364b',helmet:'#fff09a',number:index+1}); draft.add(m.root); return m; });
    race = new SummitSplitRace(loaded.track,Number(laps.value));
    for (const camera of cameras) { const d=race.drivers[cameras.indexOf(camera)]; camera.position.set(d.car.x-Math.sin(d.car.h)*9, surfaceY(loaded.track,d.car.pos.i,d.car.pos.lat)+4,d.car.z-Math.cos(d.car.h)*9); }
    await value.compileAsync(draft,cameras[0]);
    if (token !== generation || disposed) return;
    input.reset(); accumulator=0; last=performance.now(); menu.hidden=true; huds.hidden=false; running.hidden=true; $('split-resume').removeAttribute('disabled');
  } catch (error) {
    if (token === generation) { releaseMap(); race=null; status.textContent = `載入失敗：${(error as Error).message}。可再試一次。`; }
  } finally { if (token === generation) { loading=false; $('split-start').removeAttribute('disabled'); } }
}
form.onsubmit=event=>{event.preventDefault();void start();};
$('split-pause').onclick=()=>pause('比賽已暫停，放開油門後繼續。');
$('split-resume').onclick=()=>{
  const required=requiredSeats(),sample=input.read(pads(),true,required);
  if (sample.missing || sample.ready.some(r=>!r) || sample.controls.some((c,i)=>required[i]&&(c.throttle||c.steer!==0||c.brake))) { $('split-reason').textContent='請接回原手把，放開搖桿、油門及煞車，再按繼續。'; return; }
  race?.resume(); menu.hidden=true; accumulator=0; last=performance.now();
};
for (const [index,id] of ['split-retire1','split-retire2'].entries()) $(id).onclick=()=>{race?.retire(`P${index+1}`);finish();};
$('split-end').onclick=()=>{race?.retire('P1');race?.retire('P2');finish();};
$('split-new').onclick=()=>{
  generation++; controller?.abort(); loading=false; race=null; releaseMap(); input.reset(); huds.hidden=true; form.hidden=false; running.hidden=true; results.hidden=true; $('split-new').hidden=true; $('split-start').removeAttribute('disabled'); refreshDevices(); map.focus();
};
addEventListener('keydown', event=>{
  if (event.code==='Escape') { if (race && race.phase!=='paused' && race.phase!=='results') { event.preventDefault(); pause('比賽已暫停。'); } return; }
  if (!menu.hidden || event.repeat || !['KeyW','KeyA','KeyS','KeyD','Space'].includes(event.code)) return;
  event.preventDefault();input.key(event.code,true);
});
addEventListener('keyup', event=>input.key(event.code,false));
addEventListener('blur',()=>pause('視窗失去焦點，比賽已暫停。'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('遊戲已切至背景，比賽已暫停。');});
addEventListener('resize',()=>{renderer?.setSize(innerWidth,innerHeight);accumulator=0;});
menu.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const nodes=[...menu.querySelectorAll<HTMLElement>('a[href],button,select')].filter(n=>!n.hasAttribute('disabled')&&n.getClientRects().length);
  const at=nodes.indexOf(document.activeElement as HTMLElement);
  if(event.shiftKey&&at<=0){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&at===nodes.length-1){event.preventDefault();nodes[0]?.focus();}
});

function draw(dt: number) {
  if (!renderer || !scene || !race || renderer.getContext().isContextLost()) return;
  const vertical = innerWidth <= 700;
  for(const[index,d]of race.drivers.entries()){
    const model=models[index];if(!model)continue;
    const y=surfaceY(race.track,d.car.pos.i,d.car.pos.lat);
    model.root.position.set(d.car.x,y,d.car.z);model.root.rotation.set(0,d.car.h,bankRoll(race.track,d.car.pos.i,d.car.pos.lat));
    for(const wheel of model.steer)wheel.rotation.y=-d.car.steer*.4;
    for(const wheel of model.spin)wheel.rotation.x+=d.car.v*dt/.36;
    const camera=cameras[index],factor=1-Math.exp(-dt*7);
    camera.position.lerp(cameraTargets[index].set(d.car.x-Math.sin(d.car.h)*9,y+3.7,d.car.z-Math.cos(d.car.h)*9),factor);
    camera.lookAt(d.car.x+Math.sin(d.car.h)*8,y+1.1,d.car.z+Math.cos(d.car.h)*8);
    const width=vertical?innerWidth:innerWidth/2,height=vertical?innerHeight/2:innerHeight;
    const x=vertical?0:index*width, bottom=vertical?(1-index)*height:0;
    camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setViewport(x,bottom,width,height);renderer.setScissor(x,bottom,width,height);renderer.render(scene,camera);
    const rank=race.order.findIndex(p=>p===d)+1;
    $(`split-p${index+1}`).textContent=`${d.id} · 第 ${rank} 名 · ${d.dnf?'未完賽':d.finish!==null?'完賽':`${Math.min(race.laps,d.laps+1)}／${race.laps} 圈`}\n${Math.round(d.car.v*3.6)} km/h · ${fmt(d.finish??race.elapsed)}${race.phase==='countdown'?`\n準備起跑 ${Math.ceil(race.countdown)}`:''}`;
  }
}
function frame(now: number) {
  if (disposed) return;
  const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
  if (!document.hidden && race) {
    const sample=input.read(pads(),!loading,requiredSeats());
    if (sample.pause && menu.hidden) pause('手把已暫停比賽。放開按鈕後可繼續。');
    if (sample.missing && race.phase!=='paused'&&race.phase!=='results') pause('手把已斷線，接回原裝置後可繼續。');
    if (menu.hidden && sample.ready.every(Boolean)) {
      accumulator=Math.min(.1,accumulator+dt);
      while(accumulator>=SPLIT_STEP){race.step(sample.controls);accumulator-=SPLIT_STEP;}
    } else accumulator=0;
    if (menu.hidden && sample.ready.some(r=>!r)) $('split-p1').textContent='請先放開手把按鈕與搖桿，準備起跑。';
    if(menu.hidden)draw(dt);finish();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('pagehide',()=>{disposed=true;generation++;controller?.abort();releaseMap();renderer?.dispose();input.reset();},{once:true});
// Same read-only local diagnostics pattern as __gp / __mp; no network or finish shortcut.
(window as unknown as {__split:unknown}).__split={get race(){return race;},get input(){return input;},get resources(){return renderer?.info.memory??null;},get loading(){return loading;},get scenes(){return scene?1:0;}};
