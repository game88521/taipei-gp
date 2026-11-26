export interface SyncCredentials {accountId:string;recoveryKey:string}
const KEY='taipei-gp-lantern-private-sync-v1';
const valid=(v:unknown):v is SyncCredentials=>!!v&&typeof v==='object'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test((v as SyncCredentials).accountId)&&/^[A-Za-z0-9_-]{43}$/.test((v as SyncCredentials).recoveryKey);
export function syncCredentials():SyncCredentials|null{for(const key of['sessionStorage','localStorage'] as const)try{const v=JSON.parse(window[key].getItem(KEY)??'null');if(valid(v))return v;}catch{}return null;}
export function setSyncCredentials(c:SyncCredentials|null,remember=false){
 if(c&&!valid(c))throw Error('同步代碼格式無效。');
 const before=[sessionStorage.getItem(KEY),localStorage.getItem(KEY)],stores=[sessionStorage,localStorage];
 try{if(c){const target=remember?1:0;stores[target].setItem(KEY,JSON.stringify({accountId:c.accountId,recoveryKey:c.recoveryKey}));stores[1-target].removeItem(KEY);}else for(const s of stores)s.removeItem(KEY);}
 catch(e){for(let i=0;i<stores.length;i++)try{if(before[i]===null)stores[i].removeItem(KEY);else stores[i].setItem(KEY,before[i]!);}catch{}throw e;}
 dispatchEvent(new Event('lantern-sync-account'));
}
export function parseSyncCode(text:string):SyncCredentials|null{const[accountId,recoveryKey,...rest]=text.trim().split('.'),c={accountId,recoveryKey};return!rest.length&&valid(c)?c:null;}
export const syncCode=(c:SyncCredentials)=>c.accountId+'.'+c.recoveryKey;
export class LanternApiError extends Error{constructor(readonly status:number,readonly code:string){super(code);}}
const active=new Set<AbortController>();
export async function lanternApi<T>(url:string,method='GET',body?:unknown,auth=true,explicit?:SyncCredentials|null):Promise<T>{
 const control=new AbortController();active.add(control);const timer=setTimeout(()=>control.abort(),12000),credentials=auth?(explicit===undefined?syncCredentials():explicit):null;
 try{
  const response=await fetch(url,{method,cache:'no-store',credentials:'same-origin',signal:control.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(credentials?{'X-Sync-Account':credentials.accountId,Authorization:'Bearer '+credentials.recoveryKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();if(text.length>3_300_000)throw Error('回應過大。');let data;try{data=JSON.parse(text);}catch{throw Error('服務回應格式無效。');}if(!response.ok)throw new LanternApiError(response.status,data.error??'unavailable');return data as T;
 }finally{clearTimeout(timer);active.delete(control);}
}
export function lanternError(e:unknown):string{if(e instanceof LanternApiError){const errors:Record<string,string>={'not-configured':'服務尚未設定持久資料庫，請先使用本機備份。','unauthorized':'同步代碼無效或帳戶已刪除，請重新連結。','revision-conflict':'另一台裝置已更新雲端；請重新讀取、比較，原資料未覆寫。','idempotency-conflict':'這次操作內容已變更，請重新讀取後再確認。','payload-too-large':'雲端上限3MB；請先下載本機整包備份，並移除過大的回放後再試。','slow-down':'操作太頻繁，請稍候再試。','cup-closed':'這一週已截止，成績僅供查看；請建立本週好友盃。','cup-full':'好友盃已達16人。','not-member':'請先加入這個好友盃。','cup-not-found':'找不到好友盃，請檢查邀請碼。','track-version-changed':'賽道版本已更新，這站暫停提交；請建立新版賽期。','attempt':'本次挑戰已過期或尚未完成；請重新啟用挑戰並完成一圈。','proof':'本圈軌跡未通過合理性檢查，請重新跑有效計時圈。','cup-changed':'榜單剛更新，請重新讀取後再試。'};return errors[e.code]??`服務暫時無法完成（HTTP ${e.status}），可稍後重試。`;}return e instanceof DOMException&&e.name==='AbortError'?'請求逾時或已取消；請先讀取確認狀態，再決定重試。':'目前無法連線，原有進度仍留在本機。';}
addEventListener('pagehide',()=>{for(const c of active)c.abort();active.clear();});
addEventListener('storage',e=>{if(e.key===KEY||e.key===null)dispatchEvent(new Event('lantern-sync-account'));});
