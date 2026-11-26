import {CUP_CODE} from '../shared/lantern-weekly';
import {CIRCUIT} from './circuits';
import {selectedRecordRules,type Ghost} from './save';
import {createLapProof,type LapProof} from './lap-proof';
import {lanternApi,lanternError,syncCredentials} from './lantern-cloud-client';
import {randomUuid} from './identity';
let attempt:{attempt:string;expiresAt:number;stamp:string}|null=null,candidate:{time:number;proof:LapProof;operationId:string}|null=null;
let pending:{action:string;cup:string;track:string;attempt:string;time:number;proof:LapProof;operationId:string}|null=null,expiresOnClock=0;
let status:HTMLElement|null=null,submit:HTMLButtonElement|null=null,notify:(s:string)=>void=()=>{},busy=false,gen=0;
const cup=new URLSearchParams(location.search).get('weekly'),track=CIRCUIT?.id??'taipei';
export function captureLanternWeeklyLap(time:number,ghost:Ghost,stamp:string){
 if(!attempt||!cup||selectedRecordRules()!=='classic'||stamp!==attempt.stamp||busy||pending||performance.now()>=expiresOnClock)return;
 const proof=createLapProof(ghost,stamp,time);if(!proof)return;
 if(!candidate||time<candidate.time){candidate={time,proof,operationId:randomUuid()};if(status)status.textContent=`已保存本次挑戰 ${time.toFixed(3)}秒；請回選單確認提交。`;if(submit)submit.disabled=false;notify('本週挑戰圈已保存，回選單可提交好友盃。');}
}
export function mountLanternWeeklyRun(toast:(text:string)=>void){
 if(!cup||!CUP_CODE.test(cup))return;notify=toast;const host=document.querySelector('[data-pane="play"] .m-modes');if(!host)return;
 const box=document.createElement('section');box.id='lantern-weekly-session';box.className='feature-card lantern-online';const title=document.createElement('h3');title.textContent='本週好友盃挑戰';status=document.createElement('p');status.id='lantern-weekly-run-status';status.setAttribute('role','status');status.textContent='先加入好友盃，再啟用挑戰，最後以經典規則完成有效單人計時圈。';
 const arm=document.createElement('button');arm.id='lantern-weekly-arm';arm.type='button';arm.textContent='啟用本週挑戰（最長1小時）';submit=document.createElement('button');submit.type='button';submit.id='lantern-weekly-submit';submit.textContent='提交本次有效圈';submit.disabled=true;const open=document.createElement('button');open.type='button';open.id='lantern-weekly-view';open.textContent='開啟好友盃／加入';open.onclick=()=>{const d=document.getElementById('lantern-weekly-tools') as HTMLDetailsElement|null;if(d)d.open=true;document.getElementById('lantern-weekly-open')?.click();d?.scrollIntoView({block:'start'});};box.append(title,status,arm,submit,open);host.before(box);
 arm.onclick=async()=>{if(busy)return;const credentials=syncCredentials();if(!credentials){status!.textContent='請先開啟個人同步帳戶並加入好友盃。';return;}if(selectedRecordRules()!=='classic'){status!.textContent='本週固定經典規則，請先在選單切換為經典。';return;}if(candidate&&!confirm('重新啟用會放棄尚未確認的本次提交；若先前逾時，建議先重送同份或查看榜單。確定繼續？'))return;const token=++gen;busy=true;arm.disabled=submit!.disabled=true;try{const sentAt=performance.now(),next=await lanternApi<{attempt:string;expiresAt:number;stamp:string;serverTime:number}>('/api/weekly','POST',{action:'start',cup,track},true,credentials);if(token!==gen)return;attempt=next;candidate=pending=null;expiresOnClock=sentAt+Math.max(0,next.expiresAt-next.serverTime);status!.textContent=`已啟用，有效至 ${new Date(next.expiresAt).toLocaleString()}。請按「計時賽」完成有效圈，再回選單確認提交。`;submit!.textContent='提交本次有效圈';}catch(e){if(token===gen)status!.textContent=lanternError(e);}finally{busy=false;arm.disabled=false;submit!.disabled=!candidate;}};
 submit.onclick=async()=>{if(busy||!attempt||!candidate)return;const credentials=syncCredentials();if(!credentials)return;if(!pending)pending={...candidate,action:'submit',cup,track,attempt:attempt.attempt};const operation=pending,token=gen;busy=true;arm.disabled=submit!.disabled=true;try{await lanternApi('/api/weekly','POST',operation,true,credentials);if(token!==gen)return;candidate=pending=null;attempt=null;status!.textContent='本次成績已確認，好友盃保留本站較佳圈；可開啟榜單查看。';submit!.textContent='提交本次有效圈';}catch(e){if(token===gen){status!.textContent=lanternError(e)+' 再次提交會沿用同一筆操作。';submit!.textContent='重送同份成績';}}finally{busy=false;arm.disabled=false;submit!.disabled=!candidate;}};
 const clear=()=>{gen++;attempt=candidate=pending=null;expiresOnClock=0;if(submit)submit.disabled=true;if(status)status.textContent='同步帳戶已變更，請重新啟用挑戰。';};addEventListener('lantern-sync-account',clear);addEventListener('pagehide',()=>{clear();removeEventListener('lantern-sync-account',clear);},{once:true});
}
