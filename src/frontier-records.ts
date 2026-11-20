/** Rex <game88521@gmail.com>. Bounded local records; compare original text before writing and verify readback. */
export class FrontierRecords<T extends{id:string}>{
 error='';blocked=false;private value:T[]=[];private raw:string|null=null;
 constructor(private key:string,private parse:(v:unknown)=>T[]|null,private storage:Pick<Storage,'getItem'|'setItem'>|null,private max=30,private bytes=100000){
  try{if(!storage)throw Error();this.raw=storage.getItem(key);if(this.raw!==null){if(!this.fits(this.raw))throw Error();const parsed=parse(JSON.parse(this.raw));if(!parsed)throw Error();this.value=parsed;}}
  catch{this.blocked=true;this.error='本機紀錄無法讀取，已保留原文；本場仍可下載。';}
 }
 private fits(raw:string){return raw.length<=this.bytes&&new TextEncoder().encode(raw).length<=this.bytes;}
 get records(){return structuredClone(this.value);}
 add(record:T):boolean{
  if(this.blocked||!this.storage)return false;if(!record||typeof record!=='object'||typeof record.id!=='string'){this.error='本場資料不符合紀錄格式，未寫入。';return false;}if(this.value.some(row=>row.id===record.id))return false;
  const parsed=this.parse([record,...this.value].slice(0,this.max));if(!parsed){this.error='本場資料不符合紀錄格式，未寫入。';return false;}const raw=JSON.stringify(parsed);if(!this.fits(raw)){this.error='紀錄超過容量限制，未寫入；本場仍可下載。';return false;}
  try{if(this.storage.getItem(this.key)!==this.raw){this.blocked=true;this.error='其他頁面已變更紀錄，本頁停止寫回；本場仍可下載。';return false;}this.storage.setItem(this.key,raw);if(this.storage.getItem(this.key)!==raw){this.blocked=true;this.error='寫入後紀錄已變更，本頁停止寫回；請先下載本場。';return false;}this.raw=raw;this.value=structuredClone(parsed);this.error='';return true;}
  catch{this.error='本機紀錄儲存失敗，本場仍可下載。';return false;}
 }
}
