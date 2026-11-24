/** Rex <game88521@gmail.com>. A draft is local until the explicit atomic create. */
import {DEFAULT_MULTIPLAYER_TRACK_ID,getMultiplayerTrack} from './multiplayer-tracks.ts';
import {defaultHorizon,parseRoomPreset,type RoomPreset} from './multiplayer-horizon.ts';
import {defaultMeridianAdvanced} from './meridian-presets.ts';
import type {VoyagerWeather} from './voyager-racing.ts';

export const HARBOR_QUICK_MODES = [
  {id:'race',name:'一般圈數競速',description:'完成指定圈數，比誰先抵達終點；可用 AI 補位。'},
  {id:'time-trial',name:'限時最快圈',description:'3 或 5 分鐘內拚最快有效圈；固定無碰撞，只限真人。'},
  {id:'pursuit',name:'讓秒追逐',description:'依共同起跑時鐘比先後；朋友入房後，再逐人設定讓秒。'},
  {id:'items',name:'補給道具賽',description:'圈數競速中取得加速或護盾；只限真人。'},
] as const;
export type HarborQuickMode = typeof HARBOR_QUICK_MODES[number]['id'];
export interface HarborQuickDraft {
  mode:HarborQuickMode;trackId:string;laps:1|3|5;durationSeconds:180|300;
  plannedHumans:1|2|3|4;ai:0|1|2|3;weather:VoyagerWeather;
  damage:boolean;collisions:boolean;finishGraceSeconds:30|60|120;
}
export const newHarborQuickDraft=(trackId=DEFAULT_MULTIPLAYER_TRACK_ID):HarborQuickDraft=>({
  mode:'race',trackId:getMultiplayerTrack(trackId)?trackId:DEFAULT_MULTIPLAYER_TRACK_ID,
  laps:3,durationSeconds:180,plannedHumans:2,ai:0,weather:'legacy',damage:false,collisions:true,finishGraceSeconds:60,
});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseHarborQuickDraft(value:unknown):HarborQuickDraft|null {
  if(!object(value))return null;
  const keys=Object.keys(newHarborQuickDraft());
  if(Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||
    !HARBOR_QUICK_MODES.some(m=>m.id===value.mode)||typeof value.trackId!=='string'||!getMultiplayerTrack(value.trackId)||
    ![1,3,5].includes(value.laps as number)||![180,300].includes(value.durationSeconds as number)||
    ![1,2,3,4].includes(value.plannedHumans as number)||![0,1,2,3].includes(value.ai as number)||
    !['legacy','clear','rain','dry-rain'].includes(value.weather as string)||typeof value.damage!=='boolean'||
    typeof value.collisions!=='boolean'||![30,60,120].includes(value.finishGraceSeconds as number))return null;
  return {...value} as unknown as HarborQuickDraft;
}
export interface HarborQuickPreview {preset:RoomPreset|null;errors:string[];lines:string[];notes:string[]}
export function previewHarborQuickRoom(value:unknown):HarborQuickPreview {
  const d=parseHarborQuickDraft(value);
  if(!d)return{preset:null,errors:['房間草稿格式無效，請重新選擇。'],lines:[],notes:[]};
  const errors:string[]=[],notes:string[]=[],mode=HARBOR_QUICK_MODES.find(m=>m.id===d.mode)!;
  if(d.plannedHumans+d.ai>4)errors.push('真人與 AI 合計最多 4 車；AI 會占用車手席位。');
  if(d.plannedHumans+d.ai<2)errors.push('開始比賽至少需要 2 車，請增加預計真人或 AI。');
  if(d.mode!=='race'){
    if(d.ai)errors.push('這個玩法只限真人；請將 AI 設為 0。');
    if(d.weather!=='legacy')errors.push('自訂天候只搭配一般圈數競速；請改用預設乾地。');
    if(d.damage)errors.push('車損只搭配一般圈數競速；請關閉車損。');
  }
  const collisions=d.mode==='time-trial'?false:d.collisions;
  const weather={legacy:'預設乾地',clear:'固定晴天',rain:'固定雨天','dry-rain':'2 分鐘後轉雨'}[d.weather];
  const lines=[`玩法：${mode.name}`,`地圖：${getMultiplayerTrack(d.trackId)!.name}`,
    `預計 ${d.plannedHumans} 位真人 ＋ ${d.ai} 輛 AI（最多 4 車）`,
    d.mode==='time-trial'?`計時：${d.durationSeconds/60} 分鐘，依最快有效圈排名`:`圈數：${d.laps} 圈，依共同起跑時鐘先完賽者優先`,
    `碰撞：${collisions?'開啟':'關閉'}${d.mode==='time-trial'?'（此玩法固定）':''}`,
    `完賽寬限：${d.finishGraceSeconds} 秒`,
    `天候：${weather}；車損：${d.damage?'開啟':'關閉'}`];
  notes.push('預計真人數用來檢查席位，朋友仍須自行入房；建房不會自動準備或起跑。');
  if(d.ai)notes.push(`建房時加入 ${d.ai} 輛 AI，最多還可容納 ${4-d.ai} 位真人。`);
  if(d.mode==='pursuit')notes.push('建房時尚未指定個別讓秒；全員入房後，房主須在「玩法設定」選擇各車手延遲並明確套用。預設每人 0 秒。');
  if(d.mode==='items')notes.push('道具為加速與護盾；本次不混用 AI、天候、車損、系列或其他進階賽制。');
  const advanced=defaultMeridianAdvanced();advanced.summit.ai=d.ai;advanced.atlas.damage=d.damage;
  advanced.voyager.weather=d.weather;advanced.arena=d.mode==='items'?'items':'off';
  const preset=parseRoomPreset({schema:2,name:`快速開房・${mode.name}`,trackId:d.trackId,laps:d.laps,
    mode:d.mode==='items'?'race':d.mode,durationSeconds:d.durationSeconds,
    roomRules:{collisions,finishGraceSeconds:d.finishGraceSeconds},trackIds:[],horizon:defaultHorizon(),advanced});
  if(!preset&&!errors.length)errors.push('目前組合不符合房規，請調整後再建立。');
  return{preset:errors.length?null:preset,errors,lines,notes};
}
export interface HarborQuickRoomState {hasRoom:boolean;busy:boolean;ready:boolean}
export interface HarborQuickRoomDependencies {
  getState:()=>HarborQuickRoomState;
  /** Resolve only after the authority confirms the new room; reject on failure. */
  create:(preset:RoomPreset)=>Promise<void>;
  initialTrackId?:string;
}
/** UI-independent lifecycle, including duplicate-click and stale-state guards. */
export class HarborQuickRoomFlow {
  opened=false;step:1|2|3=1;submitting=false;message='';private disposed=false;
  private value:HarborQuickDraft;
  constructor(private dependencies:HarborQuickRoomDependencies){this.value=newHarborQuickDraft(dependencies.initialTrackId);}
  get draft(){return structuredClone(this.value);}
  get preview(){return previewHarborQuickRoom(this.value);}
  get state(){return this.dependencies.getState();}
  open(){if(this.disposed||this.state.hasRoom||this.state.busy||this.submitting)return false;this.opened=true;this.step=1;this.message='';return true;}
  update(patch:Partial<HarborQuickDraft>){if(!this.opened||this.submitting||this.disposed)return false;const parsed=parseHarborQuickDraft({...this.value,...patch});if(!parsed)return false;this.value=parsed;this.message='';return true;}
  next(){if(!this.opened||this.submitting||this.disposed||this.step===3)return false;this.step++;this.message='';return true;}
  back(){if(!this.opened||this.submitting||this.disposed||this.step===1)return false;this.step--;this.message='';return true;}
  cancel(){if(this.submitting||this.disposed)return false;this.opened=false;this.step=1;this.value=newHarborQuickDraft(this.dependencies.initialTrackId);this.message='已取消，沒有建立房間。';return true;}
  resetRules(){return this.update({ai:0,weather:'legacy',damage:false,collisions:true,plannedHumans:2});}
  async submit(){
    if(this.disposed||!this.opened||this.step!==3||this.submitting)return false;
    const state=this.state,preview=this.preview;
    if(state.hasRoom||state.busy||!state.ready||!preview.preset){this.message=state.hasRoom?'你已在房間內，請使用目前大廳。':state.busy?'其他房間操作尚未完成，請稍候。':!state.ready?'賽道尚未就緒，請稍候。':preview.errors.join(' ');return false;}
    this.submitting=true;this.message='正在建立房間…';
    try{
      // No connect, room mutation, ready or start command exists before this call.
      await this.dependencies.create(preview.preset);
      if(!this.state.hasRoom)throw Error('服務尚未確認新房間，請查看連線訊息後重試。');
      if(!this.disposed){this.opened=false;this.message='房間已建立；請確認大廳房規，再等全員準備。';}
      return true;
    }catch(error){if(!this.disposed)this.message=error instanceof Error?error.message:'建立未完成，草稿已保留，可調整後重試。';return false;}
    finally{this.submitting=false;}
  }
  dispose(){this.disposed=true;this.opened=false;}
}
