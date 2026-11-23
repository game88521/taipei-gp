import type { MultiplayerClient } from './multiplayer-client';
import { defaultHorizon, parseRoomPreset, type RoomPreset } from '../shared/multiplayer-horizon';
import { MultiplayerPresets } from './multiplayer-presets';
import './multiplayer-horizon.css';
import {defaultMeridianAdvanced} from '../shared/meridian-presets';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export class MultiplayerHorizonPanel {
  readonly presets:MultiplayerPresets; private key=''; private configKey=''; private message='';
  constructor(private client:()=>MultiplayerClient|null, private run:(fn:()=>Promise<unknown>)=>unknown, watch:()=>void, create:(preset:RoomPreset)=>void){
    let storage:Storage|null=null;try{storage=localStorage;}catch{}this.presets=new MultiplayerPresets(storage);
    $('mp-horizon-connect').addEventListener('click',()=>this.run(async()=>{await this.client()?.connect();}));
    $('mp-watch').addEventListener('click',watch);
    $('mp-preset-create').addEventListener('click',()=>{const p=this.presets.entries.find(e=>e.name===$<HTMLSelectElement>('mp-presets').value);if(p)create(p);});
    $('mp-preset-delete').addEventListener('click',()=>{const name=$<HTMLSelectElement>('mp-presets').value;if(name&&confirm(`刪除範本「${name}」？`)){this.presets.remove(name);this.refresh();}});
    $('mp-preset-clear').addEventListener('click',()=>{if(confirm('清除這個瀏覽器的全部房間範本？不影響戰績或車手憑證。')){this.presets.clear();this.refresh();}});
    $('mp-preset-save').addEventListener('click',()=>{
      const r=this.client()?.room;if(!r||!r.capabilities?.horizon)return;
      if(r.cup){this.message='好友盃含固定原席與賽程，請使用跨日站間續局；不會另存成一般房間範本。';this.refresh();return;}
      const tracks=r.series?.trackIds??[];
      const advanced=defaultMeridianAdvanced();advanced.summit=r.summit?.settings??advanced.summit;advanced.atlas=r.atlas?.settings??advanced.atlas;advanced.voyager=r.voyager?.settings??advanced.voyager;advanced.odyssey=r.odyssey?.settings??advanced.odyssey;advanced.expedition=r.expedition?.settings??advanced.expedition;advanced.arena=r.arena?.mode??'off';advanced.meridian=r.meridian?.settings??advanced.meridian;
      const selectedTrack=r.meridian?.settings.mode==='championship'?r.meridian.settings.trackIds[0]:tracks[0]??r.trackId;
      const preset=parseRoomPreset({schema:2,advanced,name:$<HTMLInputElement>('mp-preset-name').value,trackId:selectedTrack,laps:r.meridian?.raceLaps??r.odyssey?.weekend?.raceLaps??r.laps,roomRules:r.roomRules,
        mode:r.evolution?.mode??'race',durationSeconds:r.evolution?.durationSeconds??180,trackIds:tracks,horizon:r.horizon??defaultHorizon()});
      this.message=preset&&this.presets.save(preset)?'已保存純設定範本；下次建房需全員重新準備。':this.presets.error||'請輸入範本名稱並確認設定。';this.refresh();
    });
    $('mp-horizon-apply').addEventListener('click',()=>this.client()?.setHorizon({antiBlock:$<HTMLInputElement>('mp-anti-block').checked,reverseGrid:$<HTMLInputElement>('mp-reverse-grid').checked,elimination:$<HTMLInputElement>('mp-elimination').checked}));
    $('mp-claim-seat').addEventListener('click',()=>this.run(async()=>{await this.client()?.claimSpectatorSeat();}));
    $('mp-block-recover').addEventListener('click',()=>this.client()?.recoverBlock());
    this.refresh();
  }
  private refresh(){
    const key=JSON.stringify(this.presets.entries.map(e=>e.name));if(key!==this.key){this.key=key;const select=$<HTMLSelectElement>('mp-presets');select.replaceChildren();for(const p of this.presets.entries){const o=document.createElement('option');o.value=p.name;o.textContent=p.name;select.append(o);}}
    $('mp-preset-status').textContent=this.presets.error||this.message||`已保存 ${this.presets.entries.length} / 10 份；範本只含房間設定。`;
  }
  render(busy:boolean){
    const c=this.client(),r=c?.room,h=r?.horizon,me=r?.players.find(p=>p.id===c?.selfId),viewer=!!c?.isSpectator,cap=r?.capabilities?.horizon===true;
    const connected=c?.status==='connected',host=r?.hostId===c?.selfId,editable=cap&&host&&r?.phase==='lobby'&&!r.series?.locked&&!busy&&connected;
    $('mp-horizon-connect').hidden=!!r;$<HTMLButtonElement>('mp-horizon-connect').disabled=busy||!c;
    $('mp-horizon-entry').hidden=!!r||!c?.horizonAvailable;
    for(const id of ['mp-watch','mp-preset-create','mp-preset-delete','mp-preset-clear'])$<HTMLButtonElement>(id).disabled=busy||!c||id==='mp-preset-create'&&!this.presets.entries.length;
    $('mp-horizon-settings').hidden=!cap||r?.phase!=='lobby';
    const configKey=JSON.stringify([r?.code,r?.hostManagement?.lobbyRevision,h]);
    if(h&&configKey!==this.configKey){this.configKey=configKey;$<HTMLInputElement>('mp-anti-block').checked=h.antiBlock;$<HTMLInputElement>('mp-reverse-grid').checked=h.reverseGrid;$<HTMLInputElement>('mp-elimination').checked=h.elimination;}
    for(const id of ['mp-anti-block','mp-reverse-grid','mp-elimination','mp-horizon-apply'])$<HTMLInputElement|HTMLButtonElement>(id).disabled=!editable;
    $('mp-preset-save-row').hidden=!cap||viewer;$<HTMLButtonElement>('mp-preset-save').disabled=busy||!connected;
    $('mp-claim-seat').hidden=!viewer||r?.phase!=='lobby';$<HTMLButtonElement>('mp-claim-seat').disabled=!connected||busy||!!r?.series?.locked||(r?.players.length??4)>=4;
    if(viewer){$('mp-ready').hidden=true;$('mp-start').hidden=true;$('mp-controls').hidden=true;$('mp-evolution').hidden=true;$('mp-series-setup').hidden=true;}
    else $('mp-ready').hidden=false;
    $('mp-controls').hidden=viewer||!!me&&(me.dnf||me.finishMs!==null||!!me.timeTrialDone||!!me.eliminated||!!me.eliminationWinner||!!me.block?.ghost||me.arena?.active===false||me.cup?.active===false);
    $('mp-viewers').textContent=cap?`觀眾 ${r?.spectators?.length??0} / 8${viewer?' · 你正在觀戰，不佔車手席；下局有空位時可選擇參賽。':''}`:'';
    $('mp-grid-order').textContent=h?.reverseGrid?`發車格序：${[...(r?.players??[])].sort((a,b)=>(a.gridIndex??0)-(b.gridIndex??0)).map(p=>`${(p.gridIndex??0)+1}. ${p.name}`).join(' → ')}。後排依實際距離由共同終點線後起跑。`:'';
    if(viewer){$('mp-map-status').textContent=connected?'觀戰中；地圖載好後可切換追看。':'觀戰連線已中斷，請離開後重新觀戰。';$('mp-race-message').textContent=connected?'觀戰中，不參與本場排名。':'觀戰連線已中斷，請離開後重新觀戰。';}
    const block=me?.block,elimination=h?.elimination;
    $('mp-horizon-race').textContent=block?.ghost?`暫時無碰撞並凍結：${block.reason==='reverse'?'持續逆向':'長期停車'}。${block.recoveryAt===null?'請選擇安全恢復。':'等待兩秒並確認車身分離後恢復。'}`
      :block?.warningAt!==null&&block?.warningAt!==undefined?`防堵路警告：${block.reason==='reverse'?'請恢復正向行駛':'請離開行車動線'}；持續三秒將暫時凍結。`
      :elimination&&r?.phase==='racing'?me?.eliminated?`已淘汰，第 ${me.eliminationRank} 名，現在可觀戰。`:`末位淘汰倒數 ${Math.max(0,Math.ceil(((r.elimination?.nextAt??0)-(c?.serverNow()??0))/1000))} 秒；同進度依固定席位決勝。`:'';
    $('mp-horizon-race').hidden=!r||!['countdown','racing'].includes(r.phase)||!$('mp-horizon-race').textContent;
    $('mp-block-recover').hidden=!block?.ghost;$<HTMLButtonElement>('mp-block-recover').disabled=!connected||block?.recoveryAt!==null;
    if(cap&&elimination){$('mp-room-description').textContent='定時末位淘汰 · 2～4人 · 起跑45秒後每45秒淘汰一人，圈數不作終止條件。';$('mp-result-event').textContent='末位淘汰；淘汰名次獨立分類，不是一般DNF，也不提供一般完賽時間。';$('mp-lap').textContent=`已跑 ${me?.completedLaps??0} 圈`;}
    this.refresh();
  }
}
