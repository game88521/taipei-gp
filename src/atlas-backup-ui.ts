import {ATLAS_BACKUP_SLOTS,ATLAS_BACKUP_LIMIT,AtlasRestoreError,captureAtlasBackup,parseAtlasBackup,restoreAtlasBackup,type AtlasBackup} from './atlas-backup';
import {AtlasProfileDb,ATLAS_PENDING_RESTORE} from './atlas-profile-db';
import {validateAtlasBackup} from './atlas-backup-validators';
import {withAtlasRestoreLease} from './atlas-storage-lease';
import type {AtlasPlatformHooks} from './atlas-platform';
import {parseSaveFile} from './save';
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',id='')=>{const e=document.createElement(tag);e.textContent=text;if(id)e.id=id;return e;};
function download(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=make('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function buildId(){const text=await(await fetch('/sw.js',{cache:'no-store'})).text(),v=text.match(/const VERSION = '([a-f0-9]{12})'/)?.[1];if(!v)throw Error('無法確認目前建置版本，請重新載入後重試。');return v;}
export function mountAtlasBackup(host:HTMLElement,h:AtlasPlatformHooks) {
  if(host.childElementCount)return;
  const db=new AtlasProfileDb(),intro=make('p','包含主進度、獨立模式紀錄、設定與最多5場回放。還原會取代列出的分類；空白分類會清除。房間憑證與地圖下載不在備份內。');
  const exportButton=make('button','下載全模式整包備份','atlas-backup-export');exportButton.type='button';
  const file=make('input','','atlas-backup-file');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','選擇全模式整包備份，最大40MB');
  const status=make('p','','atlas-backup-status');status.setAttribute('role','status');const preview=make('div','','atlas-backup-preview');
  const confirm=make('input','','atlas-backup-confirm');confirm.type='checkbox';const label=make('label','以這份備份取代列出的全部分類');label.prepend(confirm);
  const apply=make('button','確認還原並重新載入','atlas-backup-restore');apply.type='button';apply.disabled=true;
  const old=make('button','下載還原前整包備份','atlas-backup-before');old.type='button';old.disabled=true;
  host.append(intro,exportButton,file,status,preview,label,old,apply);
  let incoming:AtlasBackup|null=null,before:AtlasBackup|null=null,generation=0,busy=false;
  const invalidate=()=>{generation++;incoming=before=null;preview.replaceChildren();confirm.checked=false;apply.disabled=old.disabled=true;};
  const busyState=(on:boolean)=>{busy=on;file.disabled=exportButton.disabled=on;apply.disabled=on||!incoming||!confirm.checked;old.disabled=on||!before;};
  exportButton.onclick=async()=>{if(busy)return;busyState(true);try{if(!h.flush())throw Error('存檔尚未保存，請先處理儲存提示。');const value=await captureAtlasBackup(localStorage,db,await buildId());download(value,'taipei-gp-full-backup.json');status.textContent='已產生整包備份下載；請確認檔案已保存。';}catch(e){status.textContent=String(e);}finally{busyState(false);}};
  file.onchange=async()=>{if(busy)return;invalidate();const token=generation,f=file.files?.[0];if(!f)return;busyState(true);try{if(f.size>ATLAS_BACKUP_LIMIT)throw Error('整包備份上限40MB。');const value=parseAtlasBackup(await f.text());validateAtlasBackup(value,h.parseMain);if(token!==generation)return;if(!h.flush())throw Error('目前存檔尚未保存，已停止預覽。');const current=await captureAtlasBackup(localStorage,db,await buildId());if(token!==generation)return;
      incoming=value;before=current;const table=make('table'),head=make('tr');head.append(make('th','分類'),make('th','備份內容'),make('th','還原動作'));table.append(head);
      for(const[key,name]of ATLAS_BACKUP_SLOTS){const slot=value.slots.find(s=>s.key===key),prev=current.slots.find(s=>s.key===key)!.raw,next=slot?slot.raw:prev,row=make('tr');row.append(make('td',name),make('td',!slot?'舊版備份未包含':next===null?'空白':`${new Blob([next]).size.toLocaleString()} bytes`),make('td',!slot?'保留此分類':next===prev?'相同':next===null?'清除此分類':'取代此分類'));table.append(row);}
      const row=make('tr');row.append(make('td','賽事回放'),make('td',`${value.replays.length}場`),make('td','取代回放庫'));table.append(row);preview.append(make('p',`來源版本 ${value.build} · ${value.at}`),table);status.textContent='格式檢查通過。請檢查清單，並先下載還原前備份。';
    }catch(e){status.textContent=String(e);incoming=before=null;}finally{busyState(false);}};
  confirm.onchange=()=>{apply.disabled=busy||!incoming||!confirm.checked;};old.onclick=()=>{if(before)download(before,'taipei-gp-before-full-restore.json');};
  apply.onclick=async()=>{if(busy||!incoming||!before||!confirm.checked)return;busyState(true);const value=incoming,original=before;let guard:ReturnType<AtlasPlatformHooks['beginRestore']>=null;
    try{await withAtlasRestoreLease(async()=>{guard=h.beginRestore();if(!guard)throw Error('存檔寫入權已變更，請重新載入。');try{await restoreAtlasBackup(localStorage,db,value,original);guard.finish(true,false);}catch(e){guard.finish(false,e instanceof AtlasRestoreError&&e.rollbackComplete);throw e;}});status.textContent='整包還原完成，正在重新載入。';location.reload();}
    catch(e){status.textContent=String(e);if(e instanceof AtlasRestoreError&&!e.rollbackComplete){file.disabled=exportButton.disabled=apply.disabled=true;old.disabled=false;return;}invalidate();busyState(false);}
  };
  addEventListener('pagehide',()=>{generation++;db.close();},{once:true});
}
/** A durable marker prevents normal game writes after a crash during cross-store restore. */
export async function recoverAtlasProfileIfNeeded():Promise<void> {
  let pending=false;try{pending=localStorage.getItem(ATLAS_PENDING_RESTORE)==='1';}catch{}if(!pending)return;
  const db=new AtlasProfileDb(),overlay=make('section');overlay.className='atlas-recovery';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');const card=make('div'),title=make('h1','上一份整包還原尚未確認完成'),status=make('p','遊戲已停止啟動。請先下載還原前資料，再選擇恢復或保留目前內容。');
  const save=make('button','下載還原前資料','atlas-recovery-download'),restore=make('button','恢復還原前資料','atlas-recovery-restore'),keep=make('button','保留目前資料並繼續','atlas-recovery-keep');for(const b of[save,restore,keep])b.type='button';restore.disabled=save.disabled=true;card.append(title,status,save,restore,keep);overlay.append(card);document.body.append(overlay);keep.focus();
  let previous:AtlasBackup|null=null,rawPrevious:unknown=null;try{rawPrevious=await db.previous();if(rawPrevious){save.disabled=false;const parsed=parseAtlasBackup(JSON.stringify(rawPrevious));validateAtlasBackup(parsed,parseSaveFile);previous=parsed;restore.disabled=false;}else status.textContent='找不到還原前資料庫。請保留下載過的備份；可保留目前內容，再使用原有存檔救援。';}catch(e){status.textContent=`還原前資料未通過格式檢查，已停用恢復；仍可下載原文保存。${String(e)}`;}
  save.onclick=()=>{if(rawPrevious)download(rawPrevious,'taipei-gp-interrupted-restore-before.json');};
  restore.onclick=async()=>{if(!previous)return;save.disabled=restore.disabled=keep.disabled=true;try{await withAtlasRestoreLease(async()=>{const current=await captureAtlasBackup(localStorage,db,previous!.build);await restoreAtlasBackup(localStorage,db,previous!,current,{preserveJournal:true});});db.close();location.reload();}catch(e){status.textContent=String(e);save.disabled=restore.disabled=keep.disabled=false;}};
  keep.onclick=async()=>{save.disabled=restore.disabled=keep.disabled=true;try{await withAtlasRestoreLease(async()=>{localStorage.removeItem(ATLAS_PENDING_RESTORE);});db.close();location.reload();}catch(e){status.textContent=String(e);save.disabled=restore.disabled=keep.disabled=false;}};
  await new Promise<never>(()=>{});
}
