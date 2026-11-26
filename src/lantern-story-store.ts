/** Rex <game88521@gmail.com>. One bounded CAS write settles NG4 and clears its continuation. */
import {LANTERN_STORY_KEY,decodeBranch,parseBranchCheckpoint,type BranchCheckpoint,type BranchRun} from './lantern-story';
export interface BranchPending{code:string;stamp:string;pose:{x:number;y:number;z:number;h:number};run:BranchCheckpoint;at:number}
export interface BranchRecord{code:string;at:number;success:boolean;ending:string;seconds:number;score:number;path:number[];timedOut:number[]}
export interface BranchSave{v:1;drafts:string[];pending:BranchPending|null;records:BranchRecord[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,s:string)=>Object.keys(v).sort().join(',')===s;
const n=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
export function parseBranchSave(raw:unknown):BranchSave|null{try{
 if(!obj(raw)||!keys(raw,'drafts,pending,records,v')||raw.v!==1||!Array.isArray(raw.drafts)||raw.drafts.length>12||!raw.drafts.every(c=>typeof c==='string'&&!!decodeBranch(c))||!Array.isArray(raw.records)||raw.records.length>40)return null;
 if(raw.pending!==null){const p=raw.pending;if(!obj(p)||!keys(p,'at,code,pose,run,stamp')||typeof p.code!=='string'||!decodeBranch(p.code)||typeof p.stamp!=='string'||!/^[a-f0-9]{8}$/.test(p.stamp)||!obj(p.pose)||!keys(p.pose,'h,x,y,z')||!n(p.pose.x,-12000,12000)||!n(p.pose.z,-12000,12000)||!n(p.pose.y,-120,600)||!n(p.pose.h,-10000,10000)||!n(p.at,0,8.64e15)||!parseBranchCheckpoint(p.run))return null;}
 for(const r of raw.records){if(!obj(r)||!keys(r,'at,code,ending,path,score,seconds,success,timedOut')||typeof r.code!=='string'||typeof r.success!=='boolean'||typeof r.ending!=='string'||r.ending.length>180||/[\x00-\x1f\x7f<>]/.test(r.ending)||!n(r.at,0,8.64e15)||!n(r.seconds,0,1800)||!Number.isInteger(r.score)||!n(r.score,0,100)||!Array.isArray(r.path)||r.path.length>11||!Array.isArray(r.timedOut)||r.timedOut.length>11)return null;const def=decodeBranch(r.code),path=r.path as unknown[];if(path.some((x,i)=>!Number.isInteger(x)||!n(x,0,def.stages.length-1)||i>0&&Number(x)<=Number(path[i-1]))||r.timedOut.some((x,i,a)=>!path.includes(x)||i>0&&Number(x)<=Number(a[i-1]))||!r.success&&r.score!==0)return null;}
 return structuredClone(raw)as unknown as BranchSave;
 }catch{return null;}}
export class BranchStore{
 value:BranchSave={v:1,drafts:[],pending:null,records:[]};error='';private expected:string|null=null;private blocked=false;
 constructor(private storage:Pick<Storage,'getItem'|'setItem'>|null,private canWrite:()=>boolean=()=>true){try{this.expected=storage?.getItem(LANTERN_STORY_KEY)??null;if(this.expected!==null){if(this.expected.length>1400000)throw Error();const p=parseBranchSave(JSON.parse(this.expected));if(!p)throw Error();this.value=p;}}catch{this.blocked=true;this.error='NG4存檔無法讀取，保留原文；可試玩與複製劇本。';}}
 commit(next:BranchSave){if(this.blocked||!this.storage||!this.canWrite()){this.error='目前無法保存NG4，原文未覆寫；可複製分享碼。';return false;}try{if(this.storage.getItem(LANTERN_STORY_KEY)!==this.expected){this.blocked=true;throw Error('另一頁或還原已變更NG4，請備份本頁後重新載入');}const clean=parseBranchSave(next);if(!clean)throw Error('NG4資料格式無效');const raw=JSON.stringify(clean);if(raw.length>1400000)throw Error('NG4存檔超過1.4MB');this.storage.setItem(LANTERN_STORY_KEY,raw);if(this.storage.getItem(LANTERN_STORY_KEY)!==raw){this.blocked=true;throw Error('NG4寫入後核對失敗');}this.expected=raw;this.value=clean;this.error='';return true;}catch(e){this.error=e instanceof Error?e.message:'NG4保存失敗';return false;}}
 draft(code:string){decodeBranch(code);return this.commit({...this.value,drafts:[code,...this.value.drafts.filter(c=>c!==code)].slice(0,12)});}
 checkpoint(pending:BranchPending){return this.commit({...this.value,pending});}
 settle(code:string,run:BranchRun,at:number){if(!run.result||this.value.records.some(r=>r.code===code&&r.at===at))return false;return this.commit({...this.value,pending:null,records:[{code,at,...run.result},...this.value.records].slice(0,40)});}
 abandon(){return this.commit({...this.value,pending:null});}
 restore(raw:string){if(raw.length>1400000)throw Error('NG4備份超過1.4MB');const clean=parseBranchSave(JSON.parse(raw));if(!clean)throw Error('NG4備份格式無效，原資料保留');if(!this.storage||!this.canWrite())throw Error('目前無法寫入，原資料保留');if(this.storage.getItem(LANTERN_STORY_KEY)!==this.expected)throw Error('另一頁已變更NG4，請重新載入後再還原');const next=JSON.stringify(clean);this.storage.setItem(LANTERN_STORY_KEY,next);if(this.storage.getItem(LANTERN_STORY_KEY)!==next)throw Error('還原後核對失敗，請保留備份再重載');this.value=clean;this.expected=next;this.blocked=false;this.error='';return true;}
 original(){try{return this.storage?.getItem(LANTERN_STORY_KEY)??this.expected??JSON.stringify(this.value);}catch{return this.expected??JSON.stringify(this.value);}}
}
