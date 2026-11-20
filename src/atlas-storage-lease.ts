// All current entry pages hold a shared lease; a complete restore needs exclusivity.
const LOCK='taipei-gp-full-profile-pages-v1';
let release:(()=>void)|null=null;
let released:Promise<void>|null=null;
let acquiring:Promise<void>|null=null;
let usable=true;
export async function acquireAtlasPageLease() {
  if(release)return;
  if(acquiring)return acquiring;
  acquiring=(async()=>{
  try{if(!navigator.locks?.request){usable=false;return;}
  await new Promise<void>((resolve,reject)=>{
    const request=navigator.locks.request(LOCK,{mode:'shared'},async()=>{await new Promise<void>(done=>{release=done;resolve();});});
    released=request.then(()=>{},()=>{});void request.catch(reject);
  });
  }catch{usable=false;}
  })();
  try{await acquiring;}finally{acquiring=null;}
}
export async function withAtlasRestoreLease<T>(run:()=>Promise<T>):Promise<T> {
  if(!usable||!navigator.locks?.request)throw Error('此瀏覽器無法鎖定整包還原。可匯出整包備份，或使用各模式原有的匯入功能。');
  const previous=released;release?.();release=null;released=null;
  // Resolving the callback alone does not mean the browser has released the lock.
  // Wait for the shared request to settle before making an ifAvailable request.
  await previous;
  try{return await navigator.locks.request(LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock)throw Error('請先關閉其他遊戲分頁，再還原整包備份。');return run();});}
  finally{await acquireAtlasPageLease();}
}
if(typeof addEventListener==='function'){
  addEventListener('pagehide',event=>{if(!event.persisted){release?.();release=null;}});
  addEventListener('pageshow',event=>{if(event.persisted)void acquireAtlasPageLease();});
}
