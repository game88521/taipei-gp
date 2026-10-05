import * as THREE from 'three';
import { makeSedan, makeFromGeo, type CarModel } from './carModel';
import { makeF1 } from './f1model';
import { PLAYER_LIVERY } from './rivals';
import { muscleGeo, superGeo, policeGeo, pickupGeo } from './models';
import { DEFAULT_SPEC, type CarSpec } from './freecar';

// 自由駕駛／計程車可選的車：外型＋性能。名稱都是虛構的（不用真實車廠、車隊的名字與標誌）

export type VehicleId = 'sedan' | 'taxi' | 'muscle' | 'f1' | 'super' | 'police' | 'pickup';

export interface Vehicle {
  id: VehicleId;
  name: string;
  note: string; // 選單上的一句話介紹
  color: string; // 選單上的色點
  spec: CarSpec;
  sign: [number, number]; // 計程車模式頂燈的位置（y, z）；小黃本身就有
  build: () => CarModel;
}

export const VEHICLES: Vehicle[] = [
  {
    id: 'sedan', name: '白色轎車', note: '好開、穩定，什麼都普普通通', color: '#f2f2f0',
    spec: DEFAULT_SPEC, sign: [1.58, -0.3], build: () => makeSedan('#f2f2f0'),
  },
  {
    id: 'taxi', name: '小黃', note: '台北街頭最常見的車，載客專用', color: '#f5c518',
    spec: { ...DEFAULT_SPEC, mass: 1.05 }, sign: [0, 0], build: () => makeSedan('#f5c518', true),
  },
  {
    id: 'muscle', name: '紫電 GT', note: '美式肌肉跑車：長車頭、雙白條紋，馬力大、車尾容易甩', color: '#6a2bd1',
    spec: { engine: 10.5, vmax: 64, brake: 15, grip: 12.5, mass: 1.15 }, sign: [1.5, -0.3],
    build: () => makeFromGeo(muscleGeo(), '#5b1fc0', { rim: '#2a2a2e', tyreW: 0.3, blob: [2.6, 5.8], metal: 0.55 }),
  },
  {
    id: 'f1', name: '躍馬紅 F1', note: '街道賽同款：加速、煞車、過彎都是最強，但很輕、一撞就飛', color: '#d40000',
    spec: { engine: 15, vmax: 88, brake: 30, grip: 24, mass: 0.55 }, sign: [1.14, -0.5],
    build: () => makeF1(PLAYER_LIVERY),
  },
  {
    id: 'super', name: '雷霆 V12', note: '楔形超跑：低趴、極速快，過彎抓地力很好', color: '#9bd800',
    spec: { engine: 13, vmax: 80, brake: 22, grip: 18, mass: 1.05 }, sign: [1.26, -0.45],
    build: () => makeFromGeo(superGeo(), '#8cc800', { rim: '#1b1b1d', tyreW: 0.32, blob: [2.7, 5.5], metal: 0.6 }),
  },
  {
    id: 'police', name: '巡邏車', note: '車頂紅藍警示燈會閃，車身重、撞人不吃虧', color: '#1c4fc9',
    spec: { engine: 10, vmax: 58, brake: 18, grip: 15, mass: 1.25 }, sign: [1.62, -0.75],
    build: () => makeFromGeo(policeGeo(), '#f4f5f7'),
  },
  {
    id: 'pickup', name: '發財車', note: '台灣味小貨車，載滿水果：慢、重，撞車流最有份量', color: '#2f6fb5',
    spec: { engine: 6.5, vmax: 33, brake: 12, grip: 11, mass: 1.5 }, sign: [2.02, 1.55],
    build: () => makeFromGeo(pickupGeo(), '#2f6fb5', { rim: '#d0d3d8', blob: [2.3, 5.2] }),
  },
];

export const vehicleById = (id: string | undefined) => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];

/** 計程車頂燈（白底、黑字的 TAXI 燈箱） */
function taxiSign(): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128; c.height = 40;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff8d8'; x.fillRect(0, 0, 128, 40);
  x.fillStyle = '#111'; x.font = '900 30px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('TAXI', 64, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), side = new THREE.MeshBasicMaterial({ color: '#fff8d8', toneMapped: false });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.3), [side, side, side, side, face, face]));
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.34).translate(0, -0.13, 0), new THREE.MeshLambertMaterial({ color: '#222' }));
  g.add(base);
  return g;
}

export interface PlayerVehicle {
  v: Vehicle;
  model: CarModel;
  taxiSign: THREE.Object3D | null; // 計程車模式才顯示
  tick: (t: number) => void; // 每格呼叫（警示燈閃爍）
}

/** 建好一台玩家車（含計程車頂燈、警車的警示燈） */
export function buildPlayerVehicle(v: Vehicle): PlayerVehicle {
  const model = v.build();
  model.root.userData.dynamic = true; // 會投射即時陰影
  let sign: THREE.Object3D | null = null;
  if (v.id !== 'taxi') {
    sign = taxiSign();
    sign.position.set(0, v.sign[0], v.sign[1]);
    sign.visible = false;
    model.body.add(sign);
  }
  let tick = (_t: number) => {};
  if (v.id === 'police') {
    // 紅藍警示燈：左紅右藍輪流亮
    const red = new THREE.MeshBasicMaterial({ color: '#ff2020', toneMapped: false }), blue = new THREE.MeshBasicMaterial({ color: '#2a5cff', toneMapped: false });
    const geo = new THREE.BoxGeometry(0.5, 0.12, 0.2);
    const l = new THREE.Mesh(geo, red), r = new THREE.Mesh(geo, blue);
    l.position.set(-0.3, 1.62, -0.25);
    r.position.set(0.3, 1.62, -0.25);
    model.body.add(l, r);
    const dimR = new THREE.Color('#4a0808'), dimB = new THREE.Color('#0a1240'), onR = new THREE.Color('#ff2020'), onB = new THREE.Color('#3a6cff');
    tick = (t) => {
      const ph = Math.floor(t * 8) % 8; // 紅閃兩下、藍閃兩下
      red.color.copy(ph === 0 || ph === 2 ? onR : dimR);
      blue.color.copy(ph === 4 || ph === 6 ? onB : dimB);
    };
  }
  return { v, model, taxiSign: sign, tick };
}
