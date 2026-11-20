/** Rex <game88521@gmail.com>. Explicit local summaries only; full samples and credentials never enter this store. */
import {parsePerformanceSummary,type PerformanceSummary} from './expedition-performance';

export const PERFORMANCE_HISTORY_KEY='taipei-gp-frontier-performance-v1';
export const PERFORMANCE_HISTORY_BYTES=100_000;
export const PERFORMANCE_HISTORY_LIMIT=5;
type PerformanceStorage=Pick<Storage,'getItem'|'setItem'>;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const boundedRaw=(raw:string)=>raw.length<=PERFORMANCE_HISTORY_BYTES&&new TextEncoder().encode(raw).length<=PERFORMANCE_HISTORY_BYTES;

/** null is an empty slot; malformed or oversized source text stays untouched. */
export function parsePerformanceHistory(raw:string|null):PerformanceSummary[]|null{
  if(raw===null)return [];
  if(typeof raw!=='string'||!boundedRaw(raw))return null;
  let value:unknown;try{value=JSON.parse(raw);}catch{return null;}
  if(!object(value)||Object.keys(value).length!==2||!Object.keys(value).every(key=>['v','records'].includes(key))||value.v!==1||!Array.isArray(value.records)||value.records.length>PERFORMANCE_HISTORY_LIMIT)return null;
  const records:PerformanceSummary[]=[],ids=new Set<string>();
  for(const row of value.records){const parsed=parsePerformanceSummary(row);if(!parsed||ids.has(parsed.id))return null;ids.add(parsed.id);records.push(parsed);}
  return structuredClone(records);
}

export class PerformanceHistory{
  error='';blocked=false;
  private value:PerformanceSummary[]=[];
  private raw:string|null=null;
  constructor(private readonly storage:PerformanceStorage|null){
    if(!storage){this.blocked=true;this.error='瀏覽器無法保存效能摘要；本輪採樣仍保留在本頁，可下載。';return;}
    try{this.raw=storage.getItem(PERFORMANCE_HISTORY_KEY);const parsed=parsePerformanceHistory(this.raw);if(!parsed)throw Error('invalid');this.value=parsed;}
    catch{this.blocked=true;this.error='舊效能摘要無法讀取，已保留原文；本輪採樣仍可下載。';}
  }
  get records():PerformanceSummary[]{return structuredClone(this.value);}
  /** true means the validated summary was written and read back successfully. */
  add(summary:PerformanceSummary):boolean{
    const parsed=parsePerformanceSummary(summary);
    if(!parsed){this.error='本輪效能摘要格式無效，沒有寫入；完整採樣仍留在本頁。';return false;}
    if(this.blocked||!this.storage)return false;
    if(this.value.some(row=>row.id===parsed.id)){this.error='本次摘要已保存，沒有重複寫入。';return false;}
    const next=[parsed,...this.value].slice(0,PERFORMANCE_HISTORY_LIMIT),raw=JSON.stringify({v:1,records:next});
    if(!boundedRaw(raw)||!parsePerformanceHistory(raw)){this.error='效能摘要超過容量或格式上限，沒有寫入；本輪採樣仍可下載。';return false;}
    try{
      if(this.storage.getItem(PERFORMANCE_HISTORY_KEY)!==this.raw){this.blocked=true;this.error='效能摘要已被其他頁面變更，本頁停止寫回以保留原資料；本輪仍可下載。';return false;}
      this.storage.setItem(PERFORMANCE_HISTORY_KEY,raw);
      if(this.storage.getItem(PERFORMANCE_HISTORY_KEY)!==raw){this.blocked=true;this.error='效能摘要寫入後資料已變更，本頁停止寫回；本輪採樣仍可下載。';return false;}
      this.raw=raw;this.value=structuredClone(next);this.error='';return true;
    }catch{this.error='效能摘要儲存失敗，沒有更新本頁歷史清單；本輪採樣仍可下載。';return false;}
  }
}
