// Rex <game88521@gmail.com>. Sequential bounded downloads; no storage or credentials.
import {CITY_REPLAY_CHUNK_CHARS,CITY_REPLAY_MAX_CHARS,decodeCityReplay,parseCityReplayDescriptor,type CityReplayArchive,type CityReplayDescriptor} from '../shared/frontier-city-replay';
type Request={type:'city-replay-chunk';key:string;offset:number};
interface Transfer {
 meta:CityReplayDescriptor;parts:string[];offset:number;total:number|null;
 resolve(value:CityReplayArchive):void;reject(error:Error):void;
 idle:ReturnType<typeof setTimeout>|null;deadline:ReturnType<typeof setTimeout>|null;scheduled:ReturnType<typeof setTimeout>|null;
}
export class CityReplayDownload {
 private transfer:Transfer|null=null;
 constructor(private send:(message:Request)=>boolean,private changed:()=>void=()=>{},private timing:{idleMs:number;totalMs:number;nextChunkMs?:number}={idleMs:15000,totalMs:60000}){}
 get busy(){return this.transfer!==null;}
 start(value:CityReplayDescriptor):Promise<CityReplayArchive>{
  if(this.transfer)return Promise.reject(Error('正在取得城市回放，請等候或先取消。'));
  const meta=parseCityReplayDescriptor(value);if(!meta?.ready)return Promise.reject(Error('本場城市回放尚未完成。'));
  return new Promise((resolve,reject)=>{
   const transfer:Transfer={meta,parts:[],offset:0,total:null,resolve,reject,idle:null,deadline:null,scheduled:null};this.transfer=transfer;
   transfer.deadline=setTimeout(()=>{if(this.transfer===transfer)this.cancel('城市回放下載超過總期限，請稍後手動重試。');},this.timing.totalMs);
   this.changed();this.pull(transfer);
  });
 }
 /** Call on every room/descriptor update, including leaving or starting a new round. */
 observe(value:CityReplayDescriptor|null){
  const transfer=this.transfer;if(!transfer)return;
  const meta=parseCityReplayDescriptor(value);
  if(!meta?.ready||JSON.stringify(meta)!==JSON.stringify(transfer.meta))this.cancel('房間或場次已更新，已取消舊城市回放下載。');
 }
 private pull(transfer:Transfer){
  if(this.transfer!==transfer)return;
  if(transfer.idle!==null)clearTimeout(transfer.idle);
  transfer.idle=setTimeout(()=>{if(this.transfer===transfer)this.cancel('城市回放分塊等候逾時，已清除未完成資料。');},this.timing.idleMs);
  try{if(!this.send({type:'city-replay-chunk',key:transfer.meta.key,offset:transfer.offset}))this.cancel('城市回放連線未就緒，沒有自動重試。');}
  catch{this.cancel('城市回放連線已中斷，未完成資料已清除。');}
 }
 receive(value:unknown):boolean{
  if(!value||typeof value!=='object'||Array.isArray(value)||(value as Record<string,unknown>).type!=='city-replay-part')return false;
  const m=value as Record<string,unknown>,transfer=this.transfer;if(!transfer||m.key!==transfer.meta.key)return true;
  const fields=['type','key','offset','totalChars','text'];
  if(Object.keys(m).length!==fields.length||Object.keys(m).some(k=>!fields.includes(k))||
   !Number.isSafeInteger(m.offset)||Number(m.offset)<0||Number(m.offset)%CITY_REPLAY_CHUNK_CHARS!==0||
   !Number.isSafeInteger(m.totalChars)||Number(m.totalChars)<1||Number(m.totalChars)>CITY_REPLAY_MAX_CHARS||
   typeof m.text!=='string'||m.text.length<1||m.text.length>CITY_REPLAY_CHUNK_CHARS||
   Number(m.offset)+m.text.length>Number(m.totalChars)||
   transfer.total!==null&&transfer.total!==m.totalChars||
   Number(m.offset)+m.text.length<Number(m.totalChars)&&m.text.length!==CITY_REPLAY_CHUNK_CHARS){
   this.cancel('城市回放分塊無效或順序不符，未完成資料已清除。');return true;
  }
  // Cancelling and immediately requesting the same immutable recording can leave
  // its earlier response in flight. Consume only a byte-identical accepted part;
  // it never advances progress, requests another part, or extends either timer.
  if(Number(m.offset)<transfer.offset&&transfer.total===m.totalChars&&transfer.parts[Number(m.offset)/CITY_REPLAY_CHUNK_CHARS]===m.text)return true;
  if(m.offset!==transfer.offset){this.cancel('城市回放分塊無效或順序不符，未完成資料已清除。');return true;}
  if(transfer.idle!==null)clearTimeout(transfer.idle);transfer.total=Number(m.totalChars);transfer.parts.push(m.text);transfer.offset+=m.text.length;
  // Keep large localhost downloads below the existing room message rate limits.
  if(transfer.offset<transfer.total){transfer.scheduled=setTimeout(()=>{transfer.scheduled=null;this.pull(transfer);},this.timing.nextChunkMs??25);return true;}
  let archive:CityReplayArchive;
  try{archive=decodeCityReplay(transfer.parts.join(''));if(archive.frames.length!==transfer.meta.frames||archive.durationMs!==transfer.meta.durationMs||archive.recordedMs!==transfer.meta.recordedMs||archive.truncated!==transfer.meta.truncated)throw Error('回放摘要不符');}
  catch{this.cancel('城市回放格式、城市版本或內容無效，沒有保留未驗證資料。');return true;}
  this.clear(transfer);transfer.resolve(archive);this.changed();return true;
 }
 cancel(reason='已取消城市回放下載。'){
  const transfer=this.transfer;if(!transfer)return;this.clear(transfer);transfer.reject(Error(reason));this.changed();
 }
 private clear(transfer:Transfer){
  if(transfer.idle!==null)clearTimeout(transfer.idle);if(transfer.deadline!==null)clearTimeout(transfer.deadline);if(transfer.scheduled!==null)clearTimeout(transfer.scheduled);
  transfer.parts.length=0;transfer.idle=transfer.deadline=transfer.scheduled=null;if(this.transfer===transfer)this.transfer=null;
 }
}
