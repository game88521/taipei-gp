import type {AtlasBackup} from './atlas-backup';
export type RestoreChoice='local'|'incoming'|'best';
export interface SelectiveRestoreOptions {slots:Record<string,RestoreChoice>;replays:'local'|'replace'|'merge';replayIds:string[]}
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const better=(a:unknown,b:unknown)=>typeof a==='number'&&Number.isFinite(a)&&a>0&&(typeof b!=='number'||b<=0||a<b);
function mergeRecord(local:Record<string,unknown>,incoming:Record<string,unknown>,stamp='v') {
 // Different geometry/rules are not comparable. Preserve the local record and its ghost together.
 if(local[stamp]!==incoming[stamp]||typeof local[stamp]!=='string')return {...local};
 const out={...incoming};if(better(local.best,incoming.best)){out.best=local.best;out.ghost=local.ghost??null;}
 if(better(local.gpBest,incoming.gpBest))out.gpBest=local.gpBest;
 if(Array.isArray(local.sectors)&&Array.isArray(incoming.sectors)&&local.sectors.length===3&&incoming.sectors.length===3)out.sectors=incoming.sectors.map((v,i)=>better((local.sectors as unknown[])[i],v)?(local.sectors as unknown[])[i]:v);
 return out;
}
export function mergeMainBest(localRaw:string|null,incomingRaw:string|null):string|null {
 if(!localRaw)return incomingRaw;if(!incomingRaw)return localRaw;
 const local:unknown=JSON.parse(localRaw),incoming:unknown=JSON.parse(incomingRaw);if(!obj(local)||!obj(incoming))throw Error('主存檔無法比較。');
 const merged=mergeRecord(local,incoming,'trackV');
 // Only PB-related fields may come from local. Economy, careers and settings follow the selected backup.
 const result={...incoming};for(const k of['best','gpBest','sectors','ghost','trackV'])if(k in merged)result[k]=merged[k];
 for(const key of['records','circuits']){const a=local[key],b=incoming[key];if(!obj(a)&&!obj(b))continue;const rows:Record<string,unknown>={...(obj(b)?b:{})};if(obj(a))for(const [id,record]of Object.entries(a)){if(!obj(record))continue;rows[id]=obj(rows[id])?mergeRecord(record,rows[id] as Record<string,unknown>):structuredClone(record);}result[key]=rows;}
 return JSON.stringify(result);
}
const replayId=(x:unknown)=>obj(x)&&typeof x.id==='string'?x.id:'';
export function planSelectiveRestore(incoming:AtlasBackup,before:AtlasBackup,options:SelectiveRestoreOptions) {
 const backup=structuredClone(incoming),selectedKeys:string[]=[],notes:string[]=[];
 const keys=new Set(incoming.slots.map(s=>s.key));for(const key of Object.keys(options.slots))if(!keys.has(key)||!['local','incoming','best'].includes(options.slots[key]))throw Error('選擇了備份未包含的分類。');
 for(const slot of backup.slots){const choice=options.slots[slot.key]??'local';if(choice==='local')continue;if(choice==='best'&&slot.key!=='taipei-gp-v2')throw Error('此分類不支援PB比較，請明確選擇本機或備份。');selectedKeys.push(slot.key);if(choice==='best'){slot.raw=mergeMainBest(before.slots.find(s=>s.key===slot.key)?.raw??null,slot.raw);notes.push('主進度使用備份；同版本PB保留較佳者，異版本PB保留本機，不合併金錢。');}}
 if(new Set(options.replayIds).size!==options.replayIds.length||options.replayIds.some(id=>!incoming.replays.some(r=>replayId(r)===id)))throw Error('回放選擇無效或重複。');
 const selectedReplays=incoming.replays.filter(r=>options.replayIds.includes(replayId(r)));
 if(options.replays==='local')backup.replays=structuredClone(before.replays);
 else if(options.replays==='replace')backup.replays=structuredClone(selectedReplays);
 else if(options.replays==='merge'){backup.replays=structuredClone(before.replays);for(const r of selectedReplays)if(!backup.replays.some(old=>replayId(old)===replayId(r)))backup.replays.push(structuredClone(r));}
 else throw Error('回放還原方式無效。');
 if(backup.replays.length>5)throw Error(`合併後共${backup.replays.length}場，超過5場上限。請減少勾選或選擇取代回放庫。`);
 if(!selectedKeys.length&&options.replays==='local')throw Error('請至少選擇一個分類或回放。');
 return {backup,selectedKeys,replaceReplays:options.replays!=='local',notes};
}
