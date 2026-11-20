import type {RoomSnapshot} from '../shared/multiplayer-protocol';
import type {MultiplayerClient} from './multiplayer-client';
import {ATLAS_AI_LEVELS,type AtlasAiLevel} from '../shared/atlas-racing';
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const names:Record<AtlasAiLevel,string>={relaxed:'休閒',standard:'標準',competitive:'競技'};
export class AtlasRacingPanel{
 private panel=make('section');private level=make('select');private damage=make('input');private flags=make('input');private apply=make('button','套用 AI／車損／旗號');private live=make('p');private key='';
 constructor(private getClient:()=>MultiplayerClient|null){
  this.panel.id='mp-atlas-settings';this.panel.className='mp-series-section';const title=make('h3','AI 難度、車損與旗號'),label=make('label','AI 難度');label.className='mp-field';this.level.id='mp-atlas-ai-level';for(const id of ATLAS_AI_LEVELS){const option=make('option',names[id]);option.value=id;this.level.append(option);}label.append(this.level);
  const damage=make('label','輕度車損：碰撞會影響性能，可進站修復'),flags=make('label','黃旗／藍旗與界線警告（僅提示、不罰秒）');damage.className=flags.className='summit-check';this.damage.type=this.flags.type='checkbox';this.damage.id='mp-atlas-damage';this.flags.id='mp-atlas-flags';damage.prepend(this.damage);flags.prepend(this.flags);this.apply.id='mp-atlas-apply';const help=make('p','限一般單場，可搭配排位週末、AI 與耐久。AI 使用同一車輛物理，不依玩家進度加速。黃旗表示前方低速車，藍旗提示快車即將套圈，均不判定肇責。');help.className='mp-hint';this.panel.append(title,label,damage,flags,this.apply,help);document.getElementById('mp-room')?.append(this.panel);
  this.live.id='mp-atlas-status';this.live.setAttribute('role','status');document.getElementById('mp-summit-live')?.append(this.live);
  this.apply.onclick=()=>this.getClient()?.setAtlas({aiLevel:this.level.value as AtlasAiLevel,damage:this.damage.checked,flags:this.flags.checked});this.panel.hidden=this.live.hidden=true;
 }
 render(room:RoomSnapshot|null,selfId:string|null,connected:boolean,busy:boolean){
  const state=room?.atlas,a=room?.players.find(p=>p.id===selfId)?.atlas,key=JSON.stringify([room?.code,room?.hostManagement?.lobbyRevision,state?.settings]);this.panel.hidden=!room?.capabilities?.atlasRacing||room.phase!=='lobby';
  if(this.key!==key){this.key=key;this.level.value=state?.settings.aiLevel??'standard';this.damage.checked=!!state?.settings.damage;this.flags.checked=!!state?.settings.flags;}
  const compatible=!room?.series&&room?.evolution?.mode==='race'&&!Object.values(room?.horizon??{}).some(Boolean)&&(room?.arena?.mode??'off')==='off';for(const control of[this.level,this.damage,this.flags,this.apply])control.disabled=!connected||busy||!compatible||room?.hostId!==selfId;
  this.live.hidden=!room||!['racing','countdown'].includes(room.phase)||!state||!a||!(state.settings.damage||state.settings.flags);
  const parts:string[]=[];if(state?.settings.damage)parts.push(`車損 ${Math.round((a?.damage??0)*100)}%${room?.summit?.stage==='qualifying'?'（排位停用）':''}`);if(a?.yellow)parts.push('🟨 前方低速車輛，請減速留意');if(a?.blue)parts.push('🟦 快車即將套圈，請保持可預測路線');if(a?.boundary)parts.push('賽道界線外');if(state?.settings.flags)parts.push(`界線警告 ${a?.warnings??0}（不罰秒）`);const text=parts.join(' · ');if(this.live.textContent!==text)this.live.textContent=text;
 }
}
