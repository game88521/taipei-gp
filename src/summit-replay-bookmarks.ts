export const SUMMIT_BOOKMARKS_KEY='taipei-gp-replay-bookmarks-v1';
export interface ReplayBookmark{id:string;at:number;label:string}
type Saved={replayId:string;duration:number;marks:ReplayBookmark[]}[];
const valid=(v:unknown):v is Saved=>Array.isArray(v)&&v.length<=20&&new Set(v.map(r=>r?.replayId)).size===v.length&&v.every(r=>r&&typeof r==='object'&&typeof r.replayId==='string'&&/^[\w-]{1,64}$/.test(r.replayId)&&typeof r.duration==='number'&&Number.isFinite(r.duration)&&r.duration>=0&&r.duration<=720000&&Array.isArray(r.marks)&&r.marks.length<=64&&new Set(r.marks.map((m:ReplayBookmark)=>m?.id)).size===r.marks.length&&r.marks.every((m:ReplayBookmark)=>m&&typeof m==='object'&&typeof m.id==='string'&&/^[\w-]{1,64}$/.test(m.id)&&typeof m.at==='number'&&Number.isFinite(m.at)&&m.at>=0&&m.at<=r.duration&&typeof m.label==='string'&&m.label.trim().length>0&&m.label.length<=40&&!/[\u0000-\u001f\u007f<>]/.test(m.label)));
/** Local annotations remain separate from the authoritative, shareable replay file. */
export class ReplayBookmarks{
 private rows:Saved=[];error='';private blocked=false;private storage:Pick<Storage,'getItem'|'setItem'>|null;
 constructor(storage:Pick<Storage,'getItem'|'setItem'>|null){this.storage=storage;try{const raw=storage?.getItem(SUMMIT_BOOKMARKS_KEY);if(raw){const value:unknown=JSON.parse(raw);if(raw.length>200000||!valid(value)){this.blocked=true;this.error='舊書籤格式無效，原資料已保留；新書籤僅留在本頁。';}else this.rows=value;}}catch{this.error='瀏覽器無法保存書籤，本頁仍可使用。';}}
 list(replayId:string){return structuredClone(this.rows.find(r=>r.replayId===replayId)?.marks??[]).sort((a,b)=>a.at-b.at);}
 add(replayId:string,duration:number,at:number,label:string){const current=this.rows.find(r=>r.replayId===replayId),marks=current?.marks??[];if(marks.length>=64)throw Error('每場最多64筆書籤，請先刪除部分書籤。');const mark={id:crypto.randomUUID(),at:Math.max(0,Math.min(duration,at)),label:label.trim().slice(0,40)||`書籤 ${marks.length+1}`};const row={replayId,duration,marks:[...marks,mark]};if(!valid([row]))throw Error('書籤時間或名稱無效。');this.rows=[row,...this.rows.filter(r=>r.replayId!==replayId)].slice(0,20);this.save();return mark;}
 remove(replayId:string,id:string){const row=this.rows.find(r=>r.replayId===replayId);if(row)row.marks=row.marks.filter(m=>m.id!==id);this.save();}
 private save(){if(this.blocked)return;try{if(!this.storage)throw Error();this.storage.setItem(SUMMIT_BOOKMARKS_KEY,JSON.stringify(this.rows));this.error='';}catch{this.error='書籤尚未寫入瀏覽器，本頁仍可使用，重新載入可能遺失。';}}
}
