export type AtlasGroup = 'solo' | 'online' | 'coop' | 'local';
export const ATLAS_MODE_KEY = 'taipei-gp-mode-browser-v1';
export interface AtlasMode { id: string; name: string; group: AtlasGroup; players: string; devices: string; duration: string; target: string; section?: string; cityOnly?: boolean; variant?:string; keywords?:string }
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
  { id:'cruise', name:'城市多人自由巡航', group:'online', players:'1～4人', devices:'鍵盤／觸控／手把', duration:'最多30分鐘', target:'btn-expedition-social', variant:'cruise' },
  { id:'chase', name:'多人警匪追逐', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'3分鐘', target:'btn-expedition-social', variant:'chase' },
  { id:'tandem', name:'雙人追走甩尾', group:'online', players:'2人', devices:'鍵盤／觸控／手把', duration:'兩段各60秒', target:'btn-expedition-social', variant:'tandem' },
  { id:'convoy', name:'車隊巡遊任務', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'3～5站／最多30分鐘', target:'btn-expedition-social', variant:'convoy' },
  { id:'crown', name:'移動王冠爭奪戰', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'3分鐘', target:'btn-expedition-social', variant:'crown' },
  { id:'crew', name:'多事故合作道路救援', group:'coop', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'1～3件／每件最多30分鐘', target:'btn-expedition-duty', variant:'crew' },
  { id:'friend-rally', name:'好友定速拉力', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'最多10分鐘', target:'btn-frontier-rally' },
  { id:'tandem-practice', name:'追走單人陪練', group:'solo', players:'1人＋領跑鬼車', devices:'鍵盤／觸控／手把', duration:'每段10～120秒', target:'btn-frontier-tandem-practice' },
  { id:'rally', name:'城市定速拉力', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'依路線', target:'btn-expedition-duty', variant:'rally' },
  { id:'daily', name:'每日固定條件挑戰', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'一圈情境挑戰', target:'btn-expedition-daily' },
  { id:'coop', name:'城市合作配送', group:'coop', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'最多20分鐘', target:'btn-nexus-coop' },
  { id:'split', name:'同機雙人分割畫面', group:'local', players:'2人', devices:'鍵盤＋手把／雙手把', duration:'1／3／5圈', target:'btn-splitscreen' },
  { id:'tandem-rotation', name:'三四人追走輪賽', group:'online', players:'3～4人', devices:'鍵盤／觸控／手把', duration:'3人6段／4人12段，各60秒', target:'btn-expedition-social', variant:'tandem-rotation', keywords:'輪替 領跑 追走 甩尾' },
  { id:'navigator', name:'雙人領航拉力', group:'coop', players:'2人', devices:'鍵盤／觸控／手把', duration:'依路線／最多10分鐘', target:'btn-frontier-rally', variant:'navigator', keywords:'司機 領航 路書 報彎' },
  { id:'endurance', name:'四人兩隊耐久接力', group:'online', players:'4人', devices:'鍵盤／觸控／手把', duration:'8／10分鐘＋最多2分鐘完賽寬限', target:'btn-multiplayer', variant:'relay-endurance', keywords:'換棒 交棒 輪胎 車損 隊友' },
  { id:'championship', name:'跨圖排位錦標賽', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'3～5站，每站排位／可選衝刺／正賽', target:'btn-multiplayer', variant:'championship', keywords:'大獎賽 多地圖 積分 跨日 續局' },
  { id:'cup', name:'四人好友淘汰盃', group:'online', players:'4人', devices:'鍵盤／觸控／手把', duration:'四場單挑，依圈數', target:'btn-multiplayer', variant:'cup', keywords:'準決賽 冠軍 季軍 觀戰' },
  { id:'league', name:'好友循環盃與三戰兩勝決賽', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'循環單挑＋決賽，依圈數', target:'btn-multiplayer', variant:'league', keywords:'BO3 排名 單挑 聯賽' },
  { id:'party', name:'好友派對連玩', group:'online', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'自行選擇場數，最多20場', target:'btn-expedition-social', variant:'party', keywords:'投票 巡航 巡遊 王冠 警匪 活動分 續局' },
  { id:'story', name:'NG3 單人多階段任務', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'依自訂劇本，可中途續玩', target:'btn-nexus-workshop', variant:'story', keywords:'裝卸 精準停靠 支線 工坊 續玩' },
  { id:'story-coop', name:'NG3 好友合作劇本', group:'coop', players:'2～4人', devices:'鍵盤／觸控／手把', duration:'依自訂劇本', target:'btn-nexus-workshop', variant:'story-coop', keywords:'裝卸 領航 警戒 分工 城市任務' },
  { id:'hunt-solo', name:'城市照片尋寶・單人', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'三站線索，依找路速度', target:'btn-nexus-workshop', variant:'hunt-solo', keywords:'拍照 路牌 線索 探索 離線' },
  { id:'hunt-friends', name:'城市照片尋寶・好友合作', group:'coop', players:'1～4人', devices:'鍵盤／觸控／手把', duration:'三站線索，依找路速度', target:'btn-nexus-workshop', variant:'hunt-friends', keywords:'拍照 路牌 線索 探索' },
  { id:'weekly-cup', name:'每週好友異步盃', group:'online', players:'1～16人（不同時間參賽）', devices:'鍵盤／觸控／手把', duration:'每週三站，截止前可分次挑戰', target:'btn-lantern-weekly', keywords:'異步 排行榜 每週 好友 不同時間 雲端 三站 積分' },
  { id:'ctf', name:'2對2城市搶旗', group:'online', players:'4人', devices:'鍵盤／觸控／手把', duration:'3分鐘', target:'btn-expedition-social', variant:'ctf', keywords:'紅藍 搶旗 護送 基地' },
  { id:'branch-story', name:'NG4 分支城市劇情', group:'solo', players:'1人', devices:'鍵盤／觸控／手把', duration:'依劇本，可中途續玩', target:'btn-nexus-workshop', variant:'branch-story', keywords:'二選一 劇情 結局 分支 NG4' },
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
export interface AtlasModePlanning { players:number|null; minutes:number|null }
const single=new Set(['free','taxi','street','gp','weekend','tt','season','drift','city-challenges','passport','school','workshop','duty','tandem-practice','rally','daily','story','hunt-solo','branch-story']);
export function atlasPlayerRange(mode:AtlasMode):readonly[number,number] {
  if(single.has(mode.id))return[1,1];
  if(['split','tandem','navigator'].includes(mode.id))return[2,2];
  if(['endurance','cup','ctf'].includes(mode.id))return[4,4];
  if(mode.id==='tandem-rotation')return[3,4];
  if(mode.id==='weekly-cup')return[1,16];
  return ['race','cruise','hunt-friends'].includes(mode.id)?[1,4]:[2,4];
}
/** A planning aid, not a measured completion-time promise. Unknown rules remain unranked. */
export function atlasPlanningMinutes(mode:AtlasMode,players:number|null):number|null {
  if(['free','tt','passport'].includes(mode.id))return 5; // Player may stop at any time.
  if(['drift','school','tandem-practice'].includes(mode.id))return 5;
  if(['chase','crown','tandem','ctf'].includes(mode.id))return 5;
  if(mode.id==='tandem-rotation')return players===3?10:20;
  if(['navigator','friend-rally','city-race'].includes(mode.id))return 15;
  if(mode.id==='endurance')return 15;
  if(mode.id==='coop')return 30;
  return null;
}
export function atlasBudgetLabel(mode:AtlasMode,planning:AtlasModePlanning):string {
  if(planning.minutes===null)return '';
  const minutes=atlasPlanningMinutes(mode,planning.players);
  if(minutes===null)return '時長依路線／房規，請先核對';
  if(['free','tt','passport'].includes(mode.id))return '可自行結束，適合短時間遊玩';
  return minutes<=planning.minutes?'符合時間規劃估計':'建議預留更長時間';
}
export function findAtlasModes(query:string, group:string, prefs:AtlasModePreferences,planning:AtlasModePlanning={players:null,minutes:null}) {
  const words=query.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows=ATLAS_MODES.filter(m=>{const range=atlasPlayerRange(m);return(group==='all'||group==='favorites'&&prefs.favorites.includes(m.id)||group==='recent'&&prefs.recent.includes(m.id)||m.group===group)&&(planning.players===null||planning.players>=range[0]&&planning.players<=range[1])&&words.every(w=>`${m.name} ${m.players} ${m.devices} ${m.keywords??''} ${Array.from({length:range[1]-range[0]+1},(_,i)=>`${range[0]+i}人`).join(' ')}`.normalize('NFKC').toLocaleLowerCase().includes(w));});
  if(planning.minutes!==null&&group!=='recent'){const budget=planning.minutes;rows.sort((a,b)=>{const rank=(m:AtlasMode)=>{const n=atlasPlanningMinutes(m,planning.players);return n===null?1:n<=budget?0:2;};return rank(a)-rank(b);});}
  return group==='recent' ? rows.sort((a,b)=>prefs.recent.indexOf(a.id)-prefs.recent.indexOf(b.id)) : rows;
}
