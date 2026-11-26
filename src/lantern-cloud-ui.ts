import type {AtlasPlatformHooks} from './atlas-platform';
import {captureAtlasBackup,parseAtlasBackup,type AtlasBackup} from './atlas-backup';
import {validateAtlasBackup} from './atlas-backup-validators';
import {AtlasProfileDb} from './atlas-profile-db';
import {lanternApi,lanternError,syncCredentials,setSyncCredentials,parseSyncCode,syncCode,type SyncCredentials} from './lantern-cloud-client';
import {randomUuid} from './identity';
import './lantern-online.css';
interface CloudState {revision:number;updatedAt:string;backup:AtlasBackup|null}
const el=<K extends keyof HTMLElementTagNameMap>(t:K,text='',id='')=>{const e=document.createElement(t);e.textContent=text;if(id)e.id=id;return e;};
async function build(){const s=await(await fetch('/sw.js',{cache:'no-store'})).text(),b=s.match(/const VERSION = '([a-f0-9]{12})'/)?.[1];if(!b)throw Error('請重新載入後重試。');return b;}
export function mountLanternCloud(host:HTMLElement,h:AtlasPlatformHooks,preview:(backup:AtlasBackup)=>Promise<void>){
 if(host.childElementCount)return;
 const intro=el('p','用個人同步帳戶在電腦與手機交換整包進度。上傳與還原都需手動確認；不會自動覆蓋。雲端上限3MB，大型回放請保留本機檔案。'),status=el('p','','lantern-cloud-status');status.setAttribute('role','status');
 const code=el('input','','lantern-cloud-code');code.type='password';code.autocomplete='off';code.spellcheck=false;code.maxLength=80;code.setAttribute('aria-label','私人同步代碼，請勿分享給朋友');code.placeholder='貼上自己的私人同步代碼';
 const remember=el('input','','lantern-cloud-remember');remember.type='checkbox';const rememberLabel=el('label','僅在自己的裝置記住同步帳戶');rememberLabel.prepend(remember);
 const reveal=el('input','','lantern-cloud-reveal');reveal.type='checkbox';const revealLabel=el('label','顯示私人代碼（請勿分享或截圖）');revealLabel.prepend(reveal);reveal.onchange=()=>code.type=reveal.checked?'text':'password';
 const create=el('button','建立個人同步帳戶','lantern-cloud-create'),link=el('button','連結這台裝置','lantern-cloud-link'),forget=el('button','登出這台裝置','lantern-cloud-forget'),read=el('button','讀取雲端版本','lantern-cloud-read'),upload=el('button','上傳目前進度','lantern-cloud-upload'),restore=el('button','預覽雲端還原','lantern-cloud-preview'),download=el('button','下載私人同步代碼','lantern-cloud-key-download'),remove=el('button','刪除雲端帳戶','lantern-cloud-delete');
 const consent=el('input','','lantern-cloud-consent');consent.type='checkbox';const consentLabel=el('label','我已比較雲端版本，確認以上傳本機整包進度取代它');consentLabel.prepend(consent);
 const buttons=[create,link,forget,read,upload,restore,download,remove];for(const b of buttons)b.type='button';
 const actions=el('div');actions.className='lantern-online-actions';actions.append(create,link,download,forget);
 const details=el('dl','','lantern-cloud-summary');host.classList.add('lantern-online');host.append(intro,code,revealLabel,rememberLabel,actions,status,details,read,consentLabel,upload,restore,remove);
 let busy=false,remote:CloudState|null=null,remoteAccount:string|null=null,pending:{expectedRevision:number;operationId:string;backup:AtlasBackup}|null=null,generation=0;
 const db=new AtlasProfileDb();
 const controls=()=>{const c=syncCredentials(),matched=c&&remoteAccount===c.accountId;for(const b of buttons)b.disabled=busy;read.disabled=forget.disabled=download.disabled=!c||busy;create.disabled=!!c||busy;upload.disabled=busy||!matched||!remote||!consent.checked;restore.disabled=busy||!matched||!remote?.backup;remove.disabled=busy||!matched||!remote;code.disabled=remember.disabled=busy;};
 const changed=()=>{generation++;remote=null;remoteAccount=null;pending=null;consent.checked=false;details.replaceChildren();const c=syncCredentials();code.value=c?syncCode(c):'';status.textContent=c?'已連結此裝置；先讀取雲端版本，再選擇上傳或還原。':'尚未連結同步帳戶；離線仍可使用本機存檔與備份。';controls();};
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;busy=true;controls();try{await fn();}catch(e){status.textContent=lanternError(e);}finally{busy=false;controls();}};
 const show=(value:CloudState,accountId:string)=>{if(!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.updatedAt!=='string')throw Error();if(value.backup){value.backup=parseAtlasBackup(JSON.stringify(value.backup));validateAtlasBackup(value.backup,h.parseMain);}remote=value;remoteAccount=accountId;details.replaceChildren();for(const[label,text]of[['雲端版本',String(value.revision)],['更新時間',new Date(value.updatedAt).toLocaleString()],['內容',value.backup?`${value.backup.slots.filter(s=>s.raw!==null).length}類進度、${value.backup.replays.length}場回放`:'尚未上傳進度']])details.append(el('dt',label),el('dd',text));};
 create.onclick=()=>void run(async()=>{const token=generation,c=await lanternApi<SyncCredentials>('/api/cloud','POST',{action:'create'},false);if(token!==generation){status.textContent='同步帳戶已在其他頁面變更，已保留現在的連結，沒有自動切換帳戶。';return;}setSyncCredentials(c,remember.checked);status.textContent='同步帳戶已建立，請下載私人同步代碼並妥善保存；遺失後無法找回。';});
 link.onclick=()=>void run(async()=>{const c=parseSyncCode(code.value),token=generation;if(!c){status.textContent='同步代碼格式無效，請貼上完整私人代碼。';return;}const value=await lanternApi<CloudState>('/api/cloud','GET',undefined,true,c);if(token!==generation)return;setSyncCredentials(c,remember.checked);show(value,c.accountId);status.textContent='同步帳戶已確認；本機進度未改動。';});
 forget.onclick=()=>{if(!busy)setSyncCredentials(null);};
 download.onclick=()=>{const c=syncCredentials();if(!c)return;const url=URL.createObjectURL(new Blob([syncCode(c)],{type:'text/plain'})),a=el('a');a.href=url;a.download='taipei-gp-private-sync-code.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='已產生私人同步代碼下載；請確認檔案已保存，勿分享。';};
 read.onclick=()=>void run(async()=>{const token=generation,c=syncCredentials();if(!c)return;const value=await lanternApi<CloudState>('/api/cloud','GET',undefined,true,c);if(token!==generation||syncCredentials()?.accountId!==c.accountId)return;show(value,c.accountId);pending=null;consent.checked=false;status.textContent='已讀取雲端版本；本機進度未改動。';});
 consent.onchange=controls;
 upload.onclick=()=>void run(async()=>{const c=syncCredentials(),token=generation;if(!remote||!consent.checked||!c||remoteAccount!==c.accountId)return;if(!pending){const revision=remote.revision;if(!h.flush())throw Error('尚未存檔。');const backup=await captureAtlasBackup(localStorage,db,await build());validateAtlasBackup(backup,h.parseMain);if(token!==generation||syncCredentials()?.accountId!==c.accountId)return;if(new TextEncoder().encode(JSON.stringify(backup)).length>3_000_000){status.textContent='雲端上限3MB；目前進度過大，請先使用本機整包備份保存。';return;}pending={expectedRevision:revision,operationId:randomUuid(),backup};}const operation=pending;const receipt=await lanternApi<{revision:number;updatedAt:string}>('/api/cloud','PUT',operation,true,c);if(token!==generation||syncCredentials()?.accountId!==c.accountId)return;show({...receipt,backup:operation.backup},c.accountId);pending=null;consent.checked=false;status.textContent='雲端寫入完成，版本已確認；本機進度未改動。';});
 restore.onclick=()=>void run(async()=>{if(!remote?.backup)return;await preview(remote.backup);status.textContent='已開啟既有逐類還原預覽。請核對、下載還原前備份，再明確確認還原。';});
 remove.onclick=()=>void run(async()=>{const c=syncCredentials(),token=generation;if(!remote||!c||remoteAccount!==c.accountId||!confirm('刪除雲端帳戶與雲端進度？此裝置本機存檔保留，其他裝置將無法再同步。'))return;await lanternApi('/api/cloud','DELETE',{expectedRevision:remote.revision},true,c);if(token!==generation)return;setSyncCredentials(null);status.textContent='雲端帳戶已刪除，本機存檔保留。';});
 addEventListener('lantern-sync-account',changed);addEventListener('pagehide',()=>{generation++;db.close();removeEventListener('lantern-sync-account',changed);},{once:true});changed();
}
