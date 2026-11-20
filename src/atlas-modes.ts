export type AtlasGroup = 'solo' | 'online' | 'coop' | 'local';
export const ATLAS_MODE_KEY = 'taipei-gp-mode-browser-v1';
export interface AtlasMode { id: string; name: string; group: AtlasGroup; players: string; devices: string; duration: string; target: string; section?: string; cityOnly?: boolean }
export const ATLAS_MODES: readonly AtlasMode[] = [
  { id:'free', name:'自由駕駛', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'不限時', target:'btn-free' },
  { id:'taxi', name:'計程車載客', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'依行程', target:'btn-taxi' },
  { id:'street', name:'街頭對決', group:'solo', players:'1人＋AI', devices:'鍵盤／觸控／手把', duration:'約3～10分鐘', target:'btn-duel' },
  { id:'gp', name:'大獎賽', group:'solo', players:'1人＋AI', devices:'鍵盤／觸控／手把', duration:'依圈數', target:'btn-gp' },
  { id:'weekend', name:'GP 衝刺週末', group:'solo', players:'1人＋AI', devices:'鍵盤／觸控／手把', duration:'依圈數', target:'btn-horizon-weekend' },
  { id:'tt', name:'計時賽', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'不限時', target:'btn-start' },
  { id:'season', name:'賽季模式', group:'solo', players:'1人＋AI', devices:'鍵盤／觸控／手把', duration:'可分次完成', target:'btn-season' },
  { id:'drift', name:'甩尾限時挑戰', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'60／90秒', target:'btn-drift-challenge' },
  { id:'city-challenges', name:'路段甩尾／易碎貨物配送', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'依路線', target:'btn-city-challenges', cityOnly:true },
  { id:'passport', name:'城市探索護照', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'不限時', target:'btn-passport' },
  { id:'school', name:'互動駕校', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'短關挑戰', target:'btn-city-challenges', section:'horizon-school-entry', cityOnly:true },
  { id:'workshop', name:'城市挑戰工坊', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'自訂', target:'btn-nexus-workshop' },
  { id:'duty', name:'公車勤務／道路救援', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'依路線', target:'btn-summit-duty' },
  { id:'race', name:'連線賽道競速', group:'online', players:'1～4人（可AI補位）', devices:'鍵盤／觸控／手把', duration:'依房規', target:'btn-multiplayer' },
  { id:'city-race', name:'城市路線連線競速', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'最多10分鐘', target:'btn-summit-city-race' },
  { id:'coop', name:'城市合作配送', group:'coop', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'最多20分鐘', target:'btn-nexus-coop' },
  { id:'split', name:'同機雙人分割畫面', group:'local', players:'2人', devices:'鍵盤＋手把／雙手把', duration:'1／3／5圈', target:'btn-splitscreen' },
];
export interface AtlasModePreferences { v:1; favorites:string[]; recent:string[] }
const ids = new Set(ATLAS_MODES.map(m=>m.id));
export function parseModePreferences(v:unknown):AtlasModePreferences|null {
  if (!v || typeof v!=='object' || Array.isArray(v)) return null;
  const x=v as AtlasModePreferences;
  if(x.v!==1 || !Array.isArray(x.favorites)||!Array.isArray(x.recent)||x.favorites.length>ATLAS_MODES.length||x.recent.length>8) return null;
  if([x.favorites,x.recent].some(a=>new Set(a).size!==a.length||a.some(id=>typeof id!=='string'||!ids.has(id)))) return null;
  return {v:1,favorites:[...x.favorites],recent:[...x.recent]};
}
export function findAtlasModes(query:string, group:string, prefs:AtlasModePreferences) {
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows=ATLAS_MODES.filter(m=>(group==='all'||group==='favorites'&&prefs.favorites.includes(m.id)||group==='recent'&&prefs.recent.includes(m.id)||m.group===group)&&words.every(w=>`${m.name} ${m.players} ${m.devices}`.toLocaleLowerCase().includes(w)));
  return group==='recent' ? rows.sort((a,b)=>prefs.recent.indexOf(a.id)-prefs.recent.indexOf(b.id)) : rows;
}
