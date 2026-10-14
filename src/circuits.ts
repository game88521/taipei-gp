// 各國大獎賽賽道（2026 賽曆 23 站）：中心線在 public/data/circuits/{id}.json（tools/build-circuits.mjs 產生）
// 網址 ?circuit=suzuka 進入「賽道模式」：不載入台北街景，改成通用的賽道場景（circuitenv.ts）；換賽道＝重新載入頁面
// 名稱用地名；含贊助商名稱的賽道不用原名（例：Red Bull Ring → 史匹堡）

import type { TimeKind } from './weather';
import type { Bank } from './track';

export type Biome = 'grass' | 'desert' | 'tropical' | 'street';
export interface CircuitMeta {
  id: string;
  gp: string; // 大獎賽名稱
  name: string; // 賽道名稱（中文）
  place: string; // 地點
  flag: string;
  biome: Biome; // 周圍環境：草地、沙漠、熱帶、街道賽（四周蓋城市方塊）
  time: TimeKind; // 預設時段：夜賽就是晚上
  banner: string[]; // 護牆廣告看板的字
  drs?: number; // 實際的 DRS 區數量（近年賽季）；沒填 = 照長直線自動找
  bank?: Bank[]; // 傾斜彎（贊德沃特 T3 Hugenholtz 19°、T14 Arie Luyendijk 18°）
}

export const CIRCUITS: CircuitMeta[] = [
  { id: 'australia', gp: '澳洲大獎賽', name: 'Albert Park', place: '澳洲 墨爾本', flag: '🇦🇺', biome: 'street', time: 'day', banner: ['MELBOURNE', '墨爾本', 'ALBERT PARK', 'G\'DAY'] },
  { id: 'china', gp: '中國大獎賽', name: '上海國際賽車場', place: '中國 上海', flag: '🇨🇳', biome: 'grass', time: 'day', banner: ['SHANGHAI', '上海', '小籠包', 'GRAND PRIX'], drs: 2 },
  { id: 'japan', gp: '日本大獎賽', name: '鈴鹿賽道', place: '日本 三重縣鈴鹿市', flag: '🇯🇵', biome: 'grass', time: 'day', banner: ['SUZUKA', '鈴鹿', '130R', 'S字'], drs: 1 },
  { id: 'miami', gp: '邁阿密大獎賽', name: 'Miami International Autodrome', place: '美國 邁阿密花園市', flag: '🇺🇸', biome: 'tropical', time: 'day', banner: ['MIAMI', '邁阿密', 'SOUTH BEACH', 'GRAND PRIX'], drs: 3 },
  { id: 'canada', gp: '加拿大大獎賽', name: 'Gilles Villeneuve 賽道', place: '加拿大 蒙特婁', flag: '🇨🇦', biome: 'grass', time: 'day', banner: ['MONTRÉAL', '蒙特婁', 'ÎLE NOTRE-DAME', 'GRAND PRIX'], drs: 3 },
  { id: 'monaco', gp: '摩納哥大獎賽', name: '摩納哥街道賽道', place: '摩納哥 蒙地卡羅', flag: '🇲🇨', biome: 'street', time: 'day', banner: ['MONACO', '摩納哥', 'MONTE CARLO', 'LA RASCASSE'], drs: 1 },
  { id: 'barcelona', gp: '巴塞隆納-加泰隆尼亞大獎賽', name: '巴塞隆納-加泰隆尼亞賽道', place: '西班牙 蒙梅洛', flag: '🇪🇸', biome: 'grass', time: 'day', banner: ['CATALUNYA', '巴塞隆納', 'MONTMELÓ', 'GRAND PRIX'], drs: 2 },
  { id: 'austria', gp: '奧地利大獎賽', name: '史匹堡賽道', place: '奧地利 史匹堡', flag: '🇦🇹', biome: 'grass', time: 'day', banner: ['SPIELBERG', '史匹堡', 'STYRIA', 'GRAND PRIX'], drs: 3 },
  { id: 'britain', gp: '英國大獎賽', name: '銀石賽道', place: '英國 銀石', flag: '🇬🇧', biome: 'grass', time: 'day', banner: ['SILVERSTONE', '銀石', 'COPSE', 'MAGGOTTS'], drs: 2 },
  { id: 'belgium', gp: '比利時大獎賽', name: '斯帕-法蘭柯香賽道', place: '比利時 斯塔沃', flag: '🇧🇪', biome: 'grass', time: 'day', banner: ['SPA', '斯帕', 'EAU ROUGE', 'RAIDILLON'], drs: 2 },
  { id: 'hungary', gp: '匈牙利大獎賽', name: 'Hungaroring', place: '匈牙利 莫焦羅德', flag: '🇭🇺', biome: 'grass', time: 'day', banner: ['HUNGARORING', '布達佩斯', 'MOGYORÓD', 'GRAND PRIX'], drs: 2 },
  { id: 'netherlands', gp: '荷蘭大獎賽', name: '贊德沃特賽道', place: '荷蘭 贊德沃特', flag: '🇳🇱', biome: 'grass', time: 'day', banner: ['ZANDVOORT', '贊德沃特', 'TARZAN', 'ORANJE'], drs: 2, bank: [{ at: 0.2184, deg: 19, len: 200 }, { at: 0.912, deg: 18, len: 320 }] },
  { id: 'italy', gp: '義大利大獎賽', name: '蒙札賽道', place: '義大利 蒙札', flag: '🇮🇹', biome: 'grass', time: 'day', banner: ['MONZA', '蒙札', 'PARABOLICA', 'TEMPLE OF SPEED'], drs: 2 },
  { id: 'madrid', gp: '西班牙大獎賽', name: 'Madring', place: '西班牙 馬德里', flag: '🇪🇸', biome: 'street', time: 'day', banner: ['MADRID', '馬德里', 'MADRING', 'IFEMA'] },
  { id: 'azerbaijan', gp: '亞塞拜然大獎賽', name: '巴庫街道賽道', place: '亞塞拜然 巴庫', flag: '🇦🇿', biome: 'street', time: 'day', banner: ['BAKU', '巴庫', 'OLD CITY', 'CASPIAN'], drs: 2 },
  { id: 'malaysia', gp: '巴林大獎賽（雪邦）', name: '雪邦國際賽車場', place: '馬來西亞 雪邦', flag: '🇲🇾', biome: 'tropical', time: 'day', banner: ['SEPANG', '雪邦', 'KUALA LUMPUR', 'GRAND PRIX'], drs: 2 },
  { id: 'singapore', gp: '新加坡大獎賽', name: '濱海灣街道賽道', place: '新加坡', flag: '🇸🇬', biome: 'street', time: 'night', banner: ['SINGAPORE', '新加坡', 'MARINA BAY', 'NIGHT RACE'] },
  { id: 'usa', gp: '美國大獎賽', name: '美洲賽道 COTA', place: '美國 德州奧斯汀', flag: '🇺🇸', biome: 'grass', time: 'day', banner: ['AUSTIN', '奧斯汀', 'TEXAS', 'GRAND PRIX'], drs: 2 },
  { id: 'mexico', gp: '墨西哥城大獎賽', name: 'Hermanos Rodríguez', place: '墨西哥 墨西哥城', flag: '🇲🇽', biome: 'grass', time: 'day', banner: ['MÉXICO', '墨西哥城', 'FORO SOL', 'GRAND PRIX'], drs: 3 },
  { id: 'brazil', gp: '聖保羅大獎賽', name: 'Interlagos', place: '巴西 聖保羅', flag: '🇧🇷', biome: 'tropical', time: 'day', banner: ['INTERLAGOS', '聖保羅', 'S DO SENNA', 'GRAND PRIX'], drs: 2 },
  { id: 'lasvegas', gp: '拉斯維加斯大獎賽', name: '拉斯維加斯街道賽道', place: '美國 拉斯維加斯', flag: '🇺🇸', biome: 'street', time: 'night', banner: ['LAS VEGAS', '拉斯維加斯', 'THE STRIP', 'NIGHT RACE'], drs: 2 },
  { id: 'qatar', gp: '卡達大獎賽', name: 'Lusail 國際賽車場', place: '卡達 盧賽爾', flag: '🇶🇦', biome: 'desert', time: 'night', banner: ['LUSAIL', '卡達', 'DOHA', 'NIGHT RACE'], drs: 1 },
  { id: 'abudhabi', gp: '阿布達比大獎賽', name: 'Yas Marina', place: '阿聯 阿布達比', flag: '🇦🇪', biome: 'desert', time: 'dusk', banner: ['YAS MARINA', '阿布達比', 'TWILIGHT', 'SEASON FINALE'], drs: 2 },
];

/** 這次是哪條賽道（網址 ?circuit=…）；null = 台北信義街道賽 */
export const CIRCUIT: CircuitMeta | null = CIRCUITS.find((c) => c.id === new URLSearchParams(location.search).get('circuit')) ?? null;

export interface CircuitData {
  id: string;
  points: [number, number][];
  elev?: number[]; // 高度（相對起跑線，公尺）
  alt?: number; // 賽道平均海拔（公尺；空氣密度）
  lengthM: number;
  direction: 'clockwise' | 'anticlockwise';
  info: { lengthKm: number | null; turns: number | null; firstGp: number | null; lapRecord: { time: string; driver: string; year: number } | null; corners: string[] | null; fact: string | null; source: string };
}

export async function loadCircuitData(): Promise<CircuitData | null> {
  if (!CIRCUIT) return null;
  const r = await fetch(`/data/circuits/${CIRCUIT.id}.json`);
  if (!r.ok) throw new Error(`賽道資料 HTTP ${r.status}`);
  return r.json();
}
