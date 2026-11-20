import {parseMultiplayerReplay, type MultiplayerReplay} from '../shared/nexus-replay';
export const REPLAY_LIBRARY_LIMIT=5;
export interface ReplayLibraryRow {id:string;createdAt:number;trackId:string;drivers:string[];durationMs:number;truncated:boolean}
export type ReplaySaveResult='saved'|'full'|'changed'|'unavailable';
export interface ReplayReplacement {id:string;expected:MultiplayerReplay}
export function planReplaySave(all:readonly MultiplayerReplay[],replay:MultiplayerReplay,replacement?:ReplayReplacement):{result:ReplaySaveResult;write?:boolean;replaceId?:string}{
 const same=all.find(v=>v.id===replay.id),chosen=replacement&&all.find(v=>v.id===replacement.id),expected=replacement&&parseMultiplayerReplay(replacement.expected);
 if(all.length>REPLAY_LIBRARY_LIMIT||all.some(v=>!parseMultiplayerReplay(v))||new Set(all.map(v=>v.id)).size!==all.length)return {result:'changed'};
 if(replacement&&(!expected||expected.id!==replacement.id||!chosen||JSON.stringify(parseMultiplayerReplay(chosen))!==JSON.stringify(expected)))return {result:'changed'};
 if(same&&JSON.stringify(parseMultiplayerReplay(same))===JSON.stringify(replay))return {result:'saved'};
 if(same&&replacement?.id!==same.id)return {result:'changed'};
 if(all.length>=REPLAY_LIBRARY_LIMIT&&!same&&!replacement)return {result:'full'};
 return {result:'saved',write:true,...(!same&&all.length>=REPLAY_LIBRARY_LIMIT&&replacement?{replaceId:replacement.id}:{})};
}
const row=(r:MultiplayerReplay):ReplayLibraryRow=>({id:r.id,createdAt:r.createdAt,trackId:r.trackId,drivers:r.drivers.map(d=>d.name),durationMs:r.recordedMs,truncated:r.truncated});
/** Separate database. Quota failures roll back the entire save/eviction transaction. */
export class ReplayLibrary {
  private connection:Promise<IDBDatabase|null>|null=null;
  private open(){
    if(this.connection)return this.connection;
    return this.connection=new Promise<IDBDatabase|null>(resolve=>{
      if(typeof indexedDB==='undefined'){resolve(null);return;}
      let request:IDBOpenDBRequest;try{request=indexedDB.open('taipei-gp-multiplayer-replays-v1',1);}catch{resolve(null);return;}
      let settled=false;const done=(db:IDBDatabase|null)=>{if(settled){db?.close();return;}settled=true;clearTimeout(timer);resolve(db);};
      const timer=setTimeout(()=>done(null),4000);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('replays'))request.result.createObjectStore('replays',{keyPath:'id'});};
      request.onerror=()=>done(null);request.onblocked=()=>done(null);request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();done(request.result);};
    });
  }
  async list():Promise<ReplayLibraryRow[]>{
    const db=await this.open();if(!db)return[];
    return new Promise(resolve=>{try{const tx=db.transaction('replays','readonly'),req=tx.objectStore('replays').getAll(undefined,REPLAY_LIBRARY_LIMIT+1);
      req.onsuccess=()=>resolve((req.result as unknown[]).map(parseMultiplayerReplay).filter((v):v is MultiplayerReplay=>!!v).sort((a,b)=>b.createdAt-a.createdAt).slice(0,REPLAY_LIBRARY_LIMIT).map(row));req.onerror=()=>resolve([]);}catch{resolve([]);}});
  }
  async get(id:string):Promise<MultiplayerReplay|null>{const db=await this.open();if(!db)return null;return new Promise(resolve=>{try{const req=db.transaction('replays','readonly').objectStore('replays').get(id);req.onsuccess=()=>resolve(parseMultiplayerReplay(req.result));req.onerror=()=>resolve(null);}catch{resolve(null);}});}
  async save(value:MultiplayerReplay):Promise<boolean>{return await this.saveSelected(value)==='saved';}
  /** Read, compare the chosen full record, put and eviction share one serialized transaction. */
  async saveSelected(value:MultiplayerReplay,replacement?:ReplayReplacement):Promise<ReplaySaveResult>{
    const replay=parseMultiplayerReplay(value),db=await this.open();if(!db||!replay)return 'unavailable';
    const expected=replacement&&parseMultiplayerReplay(replacement.expected);if(replacement&&(!expected||expected.id!==replacement.id))return 'changed';
    return new Promise(resolve=>{try{const tx=db.transaction('replays','readwrite'),store=tx.objectStore('replays'),req=store.getAll(undefined,REPLAY_LIBRARY_LIMIT+1);let result:ReplaySaveResult='unavailable';
      req.onsuccess=()=>{try{const plan=planReplaySave(req.result as MultiplayerReplay[],replay,replacement);result=plan.result;if(plan.write){store.put(replay);if(plan.replaceId)store.delete(plan.replaceId);}}catch{result='unavailable';tx.abort();}
      };
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>resolve('unavailable');tx.onerror=()=>{};
    }catch{resolve('unavailable');}});
  }
  async remove(id:string){const db=await this.open();if(!db)return false;return new Promise<boolean>(resolve=>{try{const tx=db.transaction('replays','readwrite');tx.objectStore('replays').delete(id);tx.oncomplete=()=>resolve(true);tx.onabort=()=>resolve(false);tx.onerror=()=>{};}catch{resolve(false);}});}
}
