export const ATLAS_BACKUP_LIMIT=40_000_000;
export const ATLAS_BACKUP_SLOTS:readonly [string,string,number][]=[
  ['taipei-gp-v2','主存檔',8_000_000],['taipei-gp-controls-v1','鍵位與手把',4096],
  ['taipei-gp-workshop-v1','工坊草稿與紀錄',250000],['taipei-gp-replay-bookmarks-v1','回放書籤',200000],
  ['taipei-gp-summit-duty-v1','公車與救援勤務',1_000_000],['taipei-gp-split-results-v1','同機雙人成績',32000],
  ['taipei-gp-city-coop-results-v1','合作配送成績',16000],['taipei-gp-scenarios-v1','GP情境成績',60000],
  ['taipei-gp-multiplayer-history-v1','多人戰績',200000],['taipei-gp-multiplayer-presets-v1','房間範本',40000],
  ['taipei-gp-pit-calibration-v1','進站校準',60000],['taipei-gp-multiplayer-quality-v1','多人畫質',100],
  ['taipei-gp-multiplayer-fps-v1','多人幀率',100],['taipei-gp-mode-browser-v1','收藏與最近玩法',4096],
  ['taipei-gp-v2-last-good','主進度救援快照',8_500_000],
  ['taipei-gp-voyager-comfort-v1','HUD 與畫面舒適設定',4096],
  ['taipei-gp-voyager-workshop-ghost-v1','工坊最佳幽靈車',2_000_000],
  ['taipei-gp-odyssey-pad-v1','手把功能鍵',1024],
  ['taipei-gp-odyssey-road-duty-v1','一般道路公車紀錄',1_000_000],
];
export interface AtlasBackup {type:'taipei-gp-full-backup';v:1;at:string;build:string;slots:{key:string;raw:string|null}[];replays:unknown[]}
export interface AtlasStorage {getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void}
export interface AtlasReplayPort {read():Promise<unknown[]>;replace(value:unknown[],expected:unknown[]):Promise<void>;journal(value:AtlasBackup):Promise<void>;clearJournal():Promise<void>}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function bounded(value:unknown,depth=0):boolean {
  if(depth>40)return false;
  if(value===null||typeof value==='boolean'||typeof value==='string')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.length<=200000&&value.every(v=>bounded(v,depth+1));
  return obj(value)&&Object.keys(value).length<=10000&&Object.entries(value).every(([k,v])=>!['__proto__','prototype','constructor','token','secret','credentials','resumeToken'].includes(k)&&bounded(v,depth+1));
}
export function parseAtlasBackup(text:string):AtlasBackup {
  if(typeof text!=='string'||text.length>ATLAS_BACKUP_LIMIT)throw Error('整包備份上限40MB。');
  const v:unknown=JSON.parse(text);
  if(!obj(v)||v.type!=='taipei-gp-full-backup'||v.v!==1||typeof v.at!=='string'||!Number.isFinite(Date.parse(v.at))||typeof v.build!=='string'||!/^[a-f0-9]{12}$/.test(v.build)||!Array.isArray(v.slots)||![15,17,ATLAS_BACKUP_SLOTS.length].includes(v.slots.length)||!Array.isArray(v.replays)||v.replays.length>5)throw Error('不是支援的整包備份版本。');
  if(Object.keys(v).some(k=>!['type','v','at','build','slots','replays'].includes(k)))throw Error('整包備份含不支援的欄位。');
  const seen=new Set<string>();
  const slots=v.slots.map(row=>{if(!obj(row)||typeof row.key!=='string'||seen.has(row.key)||Object.keys(row).some(k=>!['key','raw'].includes(k)))throw Error('備份分類重複或無效。');const spec=ATLAS_BACKUP_SLOTS.find(s=>s[0]===row.key);if(!spec||!(row.raw===null||typeof row.raw==='string'&&row.raw.length<=spec[2]))throw Error('備份包含未允許的資料或分類過大。');seen.add(row.key);if(row.raw!==null){let value:unknown;try{value=row.key==='taipei-gp-multiplayer-quality-v1'?row.raw:JSON.parse(row.raw as string);}catch{throw Error(`${spec[1]}不是有效JSON，原資料尚未改動。`);}if(!bounded(value))throw Error(`${spec[1]}包含不支援的資料。`);}return {key:row.key,raw:row.raw as string|null};});
  if(!bounded(v.replays))throw Error('回放內容包含不支援的資料。');
  if(ATLAS_BACKUP_SLOTS.slice(0,v.slots.length).some(([key])=>!seen.has(key)))throw Error('備份分類不完整。');
  return {type:v.type,v:1,at:v.at,build:v.build,slots,replays:v.replays};
}
export async function captureAtlasBackup(storage:AtlasStorage,port:AtlasReplayPort,build:string):Promise<AtlasBackup> {
  const slots=ATLAS_BACKUP_SLOTS.map(([key,,limit])=>{const raw=storage.getItem(key);if(raw!==null&&raw.length>limit)throw Error(`資料過大，請先使用該模式的匯出功能：${key}`);return{key,raw};});
  const replays=await port.read();
  if(slots.some(s=>storage.getItem(s.key)!==s.raw))throw Error('資料在讀取時變更，請暫停遊戲後重試。');
  const value:AtlasBackup={type:'taipei-gp-full-backup',v:1,at:new Date().toISOString(),build,slots,replays};
  if(JSON.stringify(value).length>ATLAS_BACKUP_LIMIT)throw Error('整包備份超過40MB，請分別匯出回放。');
  return value;
}
export class AtlasRestoreError extends Error {constructor(message:string,readonly rollbackComplete:boolean){super(message);}}
export async function restoreAtlasBackup(storage:AtlasStorage,port:AtlasReplayPort,incoming:AtlasBackup,before:AtlasBackup,options:{preserveJournal?:boolean}={}) {
  const put=(slot:{key:string;raw:string|null})=>slot.raw===null?storage.removeItem(slot.key):storage.setItem(slot.key,slot.raw);
  const unchanged=()=>{if(before.slots.some(s=>storage.getItem(s.key)!==s.raw))throw Error('目前資料已變更，請重新預覽；尚未還原。');};
  unchanged();if(!options.preserveJournal)await port.journal(before);let changedReplays=false;const attempted:string[]=[];
  try {
    unchanged();await port.replace(incoming.replays,before.replays);changedReplays=true;unchanged();
    for(const slot of incoming.slots){attempted.push(slot.key);put(slot);}
    if(incoming.slots.some(s=>storage.getItem(s.key)!==s.raw))throw Error('寫入後核對失敗。');
  } catch(error) {
    let recovered=true;
    try{if(changedReplays)await port.replace(before.replays,incoming.replays);}catch{recovered=false;}
    try{for(const key of attempted.reverse()){const old=before.slots.find(s=>s.key===key)!,next=incoming.slots.find(s=>s.key===key)!,current=storage.getItem(key);if(current!==old.raw&&current!==next.raw){recovered=false;continue;}put(old);if(storage.getItem(key)!==old.raw)recovered=false;}}catch{recovered=false;}
    if(recovered&&!options.preserveJournal)await port.clearJournal().catch(()=>{});
    throw new AtlasRestoreError(recovered?`還原失敗，已回復原資料：${String(error)}`:'還原未完成；原資料已保存在還原前備份，請下載後重新載入並復原。',recovered);
  }
  await port.clearJournal().catch(()=>{});
}
