import type {AtlasBackup,AtlasReplayPort} from './atlas-backup';
export const ATLAS_PENDING_RESTORE='taipei-gp-full-backup-pending-v1';
const open=(name:string,store:string)=>new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(name,1);let ended=false;
  const timer=setTimeout(()=>{ended=true;reject(Error('資料庫開啟逾時；請先關閉其他遊戲分頁。'));},5000);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,store==='replays'?{keyPath:'id'}:undefined);};
  request.onerror=()=>{clearTimeout(timer);reject(Error('瀏覽器無法開啟回放／備份資料庫。'));};
  request.onblocked=()=>{clearTimeout(timer);ended=true;reject(Error('資料庫被其他分頁使用，請先關閉後重試。'));};
  request.onsuccess=()=>{clearTimeout(timer);if(ended){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
});
const normalized=(rows:unknown[])=>JSON.stringify([...rows].sort((a,b)=>String((a as {id?:unknown})?.id).localeCompare(String((b as {id?:unknown})?.id))));
export class AtlasProfileDb implements AtlasReplayPort {
  private replay:IDBDatabase|null=null;private recovery:IDBDatabase|null=null;
  private async db(){return this.replay??=await open('taipei-gp-multiplayer-replays-v1','replays');}
  private async journalDb(){return this.recovery??=await open('taipei-gp-full-backup-v1','journal');}
  async read():Promise<unknown[]>{const db=await this.db();return new Promise((resolve,reject)=>{const tx=db.transaction('replays','readonly'),request=tx.objectStore('replays').getAll(undefined,6);request.onsuccess=()=>{if(request.result.length>5)reject(Error('回放數量異常，請先分別匯出。'));else resolve(request.result);};request.onerror=()=>reject(Error('回放讀取失敗。'));});}
  async replace(value:unknown[],expected:unknown[]) {const db=await this.db();return new Promise<void>((resolve,reject)=>{let reason='回放寫入失敗。';const tx=db.transaction('replays','readwrite'),store=tx.objectStore('replays'),req=store.getAll(undefined,6);req.onsuccess=()=>{if(normalized(req.result)!==normalized(expected)){reason='回放已被其他頁面變更；尚未覆寫。';tx.abort();return;}store.clear();for(const row of value)store.put(row);};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(Error(reason));tx.onerror=()=>{};});}
  async journal(value:AtlasBackup){const db=await this.journalDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('journal','readwrite');tx.objectStore('journal').put(value,'before');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(Error('無法保存還原前資料，已取消還原。'));tx.onerror=()=>{};});localStorage.setItem(ATLAS_PENDING_RESTORE,'1');}
  async previous():Promise<AtlasBackup|null>{const db=await this.journalDb();return new Promise((resolve,reject)=>{const req=db.transaction('journal','readonly').objectStore('journal').get('before');req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(Error('無法讀取還原前資料。'));});}
  async clearJournal(){localStorage.removeItem(ATLAS_PENDING_RESTORE);const db=await this.journalDb();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('journal','readwrite');tx.objectStore('journal').delete('before');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(Error('備份清理失敗。'));tx.onerror=()=>{};});}
  close(){this.replay?.close();this.recovery?.close();this.replay=this.recovery=null;}
}
