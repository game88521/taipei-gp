import {ATLAS_BACKUP_SLOTS,type AtlasBackup} from './atlas-backup';
import {planSelectiveRestore,type SelectiveRestoreOptions,type RestoreChoice} from './aurora-backup';
import './aurora-platform.css';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',id='')=>{const e=document.createElement(tag);e.textContent=text;if(id)e.id=id;return e;};
export function mountRestoreSelection(host:HTMLElement,incoming:AtlasBackup,before:AtlasBackup,onChange:()=>void){
 const options:SelectiveRestoreOptions={slots:{},replays:'replace',replayIds:incoming.replays.map(r=>(r as {id:string}).id)};
 const controls=new Map<string,HTMLSelectElement>(),actions=el('div');actions.className='aurora-backup-actions';
 const selectAll=el('button','選擇備份全部分類','aurora-backup-all'),keepAll=el('button','全部保留本機','aurora-backup-none');for(const b of[selectAll,keepAll])b.type='button';actions.append(selectAll,keepAll);
 const table=el('table'),head=el('tr');head.append(el('th','分類'),el('th','本機／備份'),el('th','還原方式'));table.append(head);
 const summary=el('p','','aurora-backup-selection-status');summary.setAttribute('role','status');
 function refresh(){try{const plan=planSelectiveRestore(incoming,before,options);summary.textContent=`將變更${plan.selectedKeys.length}個分類；${plan.replaceReplays?`回放庫改為${plan.backup.replays.length}場`:'保留本機回放庫'}。未選分類保持原文。${plan.notes.join('')}`;summary.dataset.valid='true';}catch(e){summary.textContent=String(e);summary.dataset.valid='false';}onChange();}
 for(const[key,name]of ATLAS_BACKUP_SLOTS){const next=incoming.slots.find(s=>s.key===key),old=before.slots.find(s=>s.key===key),row=el('tr'),select=el('select','','aurora-restore-'+key);select.className='aurora-backup-select';select.setAttribute('aria-label',name+'還原方式');
  for(const[value,label]of[['local','保留本機'],['incoming','使用備份'],...(key==='taipei-gp-v2'?[['best','備份主進度＋較佳PB']]:[])]){const o=el('option',label);o.value=value;select.append(o);}
  select.value=next?'incoming':'local';select.disabled=!next;if(next)options.slots[key]='incoming';controls.set(key,select);select.onchange=()=>{options.slots[key]=select.value as RestoreChoice;refresh();};
  const describe=(raw:string|null|undefined)=>raw==null?'空白':`${new Blob([raw]).size.toLocaleString()} bytes`;
  row.append(el('td',name),el('td',`${describe(old?.raw)} ／ ${next?describe(next.raw):'舊版未包含'}${next?.raw===old?.raw?'（相同）':''}`));const cell=el('td');cell.append(select);row.append(cell);table.append(row);
 }
 const replayMode=el('select','','aurora-restore-replays');replayMode.setAttribute('aria-label','回放還原方式');replayMode.className='aurora-backup-select';for(const[value,label]of[['local','保留本機回放'],['replace','以勾選回放取代回放庫'],['merge','加入勾選回放，同ID保留本機']]){const o=el('option',label);o.value=value;replayMode.append(o);}replayMode.value=options.replays;replayMode.onchange=()=>{options.replays=replayMode.value as SelectiveRestoreOptions['replays'];refresh();};
 const replays=el('fieldset');replays.append(el('legend',`指定回放（本機${before.replays.length}場／備份${incoming.replays.length}場，上限5場）`),replayMode);
 for(const r of incoming.replays){const row=r as {id:string;trackId?:string;durationMs?:number},input=el('input');input.type='checkbox';input.checked=true;input.dataset.replayId=row.id;const label=el('label',`${row.trackId??'賽事'} · ${row.id.slice(0,18)}${before.replays.some(x=>(x as {id:string}).id===row.id)?'（本機已有同ID）':''}`);label.className='aurora-backup-choice';label.prepend(input);replays.append(label);input.onchange=()=>{options.replayIds=input.checked?[...options.replayIds,row.id]:options.replayIds.filter(id=>id!==row.id);refresh();};}
 selectAll.onclick=()=>{for(const[key,c]of controls)if(!c.disabled){c.value='incoming';options.slots[key]='incoming';}replayMode.value=options.replays='replace';refresh();};
 keepAll.onclick=()=>{for(const[key,c]of controls){c.value='local';if(key in options.slots)options.slots[key]='local';}replayMode.value=options.replays='local';refresh();};
 host.replaceChildren(el('p',`來源版本 ${incoming.build} · ${incoming.at}`),actions,table,replays,summary);refresh();return ()=>structuredClone(options);
}
