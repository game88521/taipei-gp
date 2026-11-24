/** Rex <game88521@gmail.com>. Public reading preference; never stores a room or private seat. */
export const HARBOR_READING_KEY='taipei-gp-harbor-reading-v1';
export const HARBOR_READING_SCALES=[100,125,150] as const;
export interface HarborReading {v:1;scale:typeof HARBOR_READING_SCALES[number]}
export interface HarborPreferenceStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export function parseHarborReading(raw:unknown):HarborReading|null {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const value=raw as Record<string,unknown>;
 return Object.keys(value).sort().join(',')==='scale,v'&&value.v===1&&HARBOR_READING_SCALES.includes(value.scale as HarborReading['scale'])?{v:1,scale:value.scale as HarborReading['scale']}:null;
}
/** Compare the exact raw value before every write, including null and invalid legacy values. */
export class HarborReadingStore {
 value:HarborReading={v:1,scale:100};warning='';blocked=false;private expected:string|null=null;
 constructor(private storage:HarborPreferenceStorage|null){this.reload();}
 reload(){this.warning='';this.blocked=false;this.value={v:1,scale:100};try{if(!this.storage)throw Error();this.expected=this.storage.getItem(HARBOR_READING_KEY);if(this.expected!==null){const value=this.expected.length<=1024?parseHarborReading(JSON.parse(this.expected)):null;if(!value){this.blocked=true;this.warning='閱讀設定格式無法讀取，原文保留；重新載入前停止寫入。';}else this.value=value;}}catch{this.blocked=true;this.warning='無法讀取閱讀設定；暫用預設，原資料保留。';}}
 save(raw:unknown){const value=parseHarborReading(raw);if(!value)return false;if(this.blocked||!this.storage){this.warning||='閱讀設定目前無法保存，原資料保留。';return false;}
  try{if(this.storage.getItem(HARBOR_READING_KEY)!==this.expected){this.blocked=true;this.warning='閱讀設定已在其他頁面變更，已停止寫入；請重新載入。';return false;}const text=JSON.stringify(value);this.storage.setItem(HARBOR_READING_KEY,text);if(this.storage.getItem(HARBOR_READING_KEY)!==text){this.blocked=true;this.warning='閱讀設定保存核對失敗，請重新載入。';return false;}this.expected=text;this.value=value;this.warning='';return true;}catch{this.warning='無法保存閱讀設定；原資料未主動覆寫，請檢查瀏覽器儲存權限。';return false;}
 }
}

export interface HarborViewport {width:number;height:number;left:number;top:number;scale:number}
export function harborViewport(layout:{width:number;height:number},visual?:Partial<HarborViewport>|null):HarborViewport {
 const dimension=(n:unknown,fallback:number)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:fallback;
 const offset=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,n):0;
 return{width:dimension(visual?.width,dimension(layout.width,1)),height:dimension(visual?.height,dimension(layout.height,1)),left:offset(visual?.left),top:offset(visual?.top),scale:dimension(visual?.scale,1)};
}

/** Isolate siblings along the active modal's ancestor path, including lazy nested panels. */
export function harborIsolationBranches<T>(top:T,root:T,parent:(node:T)=>T|null,children:(node:T)=>readonly T[]):T[]{
 const result:T[]=[];let branch:T|null=top;const seen=new Set<T>();
 while(branch&&branch!==root&&!seen.has(branch)){seen.add(branch);const owner=parent(branch);if(!owner)break;for(const sibling of children(owner))if(sibling!==branch)result.push(sibling);branch=owner;}
 return branch===root?result:[];
}
/** Restoration is driven by current visibility, never just by whether a source still exists. */
export function harborFocusTarget<T>(previous:T|null,top:T|null,history:readonly T[],usable:(node:T)=>boolean,inside:(owner:T,node:T)=>boolean,fallback:()=>T|null):T|null {
 if(previous&&usable(previous)&&(!top||inside(top,previous)))return previous;
 for(let i=history.length-1;i>=0;i--){const node=history[i];if(usable(node)&&(!top||inside(top,node)))return node;}
 const value=fallback();return value&&usable(value)&&(!top||inside(top,value))?value:null;
}
