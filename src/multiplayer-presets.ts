import { parseRoomPreset, type RoomPreset } from '../shared/multiplayer-horizon.ts';
export const MULTIPLAYER_PRESETS_KEY='taipei-gp-multiplayer-presets-v1';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export class MultiplayerPresets {
  entries: RoomPreset[]=[]; error=''; private blocked=false;
  private storage:Store|null;
  constructor(storage:Store|null){this.storage=storage;this.read();}
  private read(){
    try{
      const raw=this.storage?.getItem(MULTIPLAYER_PRESETS_KEY);if(!raw)return;
      if(raw.length>40000)throw Error();const data:unknown=JSON.parse(raw);
      if(!data||typeof data!=='object'||!('schema' in data)||data.schema!==1||!('entries' in data)||!Array.isArray(data.entries)||data.entries.length>10)throw Error();
      const rows=data.entries.map(parseRoomPreset);if(rows.some(p=>!p)||new Set(rows.map(p=>p!.name)).size!==rows.length)throw Error();
      this.entries=rows as RoomPreset[];
    }catch{this.blocked=true;this.error='範本資料無法讀取，原資料已保留；可明確清除後重新保存。';}
  }
  save(value:unknown){
    const p=parseRoomPreset(value);if(this.blocked||!p){this.error=this.blocked?this.error:'範本設定無效。';return false;}
    const next=[p,...this.entries.filter(e=>e.name!==p.name)];if(next.length>10){this.error='最多保存十份範本，請先刪除一份。';return false;}
    return this.commit(next);
  }
  remove(name:string){return !this.blocked&&this.commit(this.entries.filter(e=>e.name!==name));}
  clear(){try{if(!this.storage)throw Error();this.storage.removeItem(MULTIPLAYER_PRESETS_KEY);this.entries=[];this.error='';this.blocked=false;return true;}catch{this.error='無法清除範本，請檢查瀏覽器儲存權限。';return false;}}
  private commit(next:RoomPreset[]){try{if(!this.storage)throw Error();this.storage.setItem(MULTIPLAYER_PRESETS_KEY,JSON.stringify({schema:1,entries:next}));this.entries=next;this.error='';return true;}catch{this.error='無法保存範本，請檢查瀏覽器儲存權限。';return false;}}
}
