import {PARTY_MODES,PARTY_LABELS,PARTY_ROUND_LIMIT,type PartyMode} from '../shared/aurora-social';
import type {ExpeditionSocialClient} from './expedition-social-client';
/** Rex <game88521@gmail.com>. This panel shares the existing lobby and never creates another connection. */
export function mountAuroraParty(client:ExpeditionSocialClient){
 const root=document.createElement('section');root.id='aurora-party';root.setAttribute('aria-label','好友派對連玩');
 const title=document.createElement('h2');title.textContent='好友派對連玩';const note=document.createElement('p');note.textContent='同房碼保留原隊伍，全部投票後房主切下一玩法。啟用後鎖定這次隊伍；原席可續接。最多20場，活動分只留本房，離房前可下載。';
 const status=document.createElement('p');status.id='aurora-party-status';status.setAttribute('role','status');const standings=document.createElement('ol');standings.id='aurora-party-scores';const rounds=document.createElement('details'),roundList=document.createElement('ol'),summary=document.createElement('summary');summary.textContent='本次各場積分';rounds.append(summary,roundList);let choiceKey='';
 const makeButton=(id:string,text:string,fn:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='ghost-btn';b.id=id;b.textContent=text;b.style.minHeight='44px';b.onclick=fn;return b;};
 const enable=makeButton('aurora-party-enable','啟用好友派對',()=>client.party('party-enable'));
 const choice=document.createElement('select');choice.id='aurora-party-mode';choice.setAttribute('aria-label','下一場投票玩法');for(const mode of PARTY_MODES){const opt=document.createElement('option');opt.value=mode;opt.textContent=PARTY_LABELS[mode];choice.append(opt);}
 const vote=makeButton('aurora-party-vote','投票／更改選擇',()=>{const p=client.room?.party;if(p)client.party('party-vote',{mode:choice.value,ballot:p.ballot});});
 const next=makeButton('aurora-party-next','依投票結果切換下一場',()=>client.party('party-next'));
 const finish=makeButton('aurora-party-finish','結束這段自由巡航',()=>client.party('party-finish'));
 const end=makeButton('aurora-party-end','結束派對並開放新隊員',()=>{if(confirm('結束後會清除本房活動分；需要保留時請先下載。確定結束？'))client.party('party-end');});
 const download=makeButton('aurora-party-export','下載活動積分JSON',()=>{const r=client.room;if(!r?.party)return;const blob=new Blob([JSON.stringify({app:'taipei-gp-party-results',v:1,party:r.party},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='taipei-party-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
 const scoring=document.createElement('p');scoring.textContent='王冠名次5／3／1分（同分同名次）；警匪勝方3、另一方1分；全隊巡遊完成各3分；巡航不計分。中斷／退出不加分。同票依巡航、巡遊、王冠、警匪固定順序決定。切場後全部重新準備。';
 root.append(title,note,status,enable,choice,vote,next,finish,download,end,standings,rounds,scoring);
 function render(){const r=client.room,p=r?.party,host=r?.hostId===client.selfId,idle=r&&['lobby','finished'].includes(r.phase),gated=client.controlGated||client.status!=='connected';root.hidden=!r;
  enable.hidden=!!p||!host;enable.disabled=gated||!idle||!client.partySupported||r?.mode==='tandem'||(r?.players.length??0)<2;
  for(const e of[choice,vote,next,finish,download,end,standings,rounds,scoring])e.hidden=!p;
  if(!p){status.textContent=client.partySupported?'先邀請2～4人進同房，再由房主啟用派對。雙人追走仍從原入口獨立進行。':'目前後端尚未宣告好友派對，原玩法仍可使用。';return;}
  const me=r!.players.find(q=>q.id===client.selfId),mine=p.votes.find(v=>v.slot===me?.slot),key=p.ballot+':'+(mine?.mode??'');if(key!==choiceKey){choiceKey=key;if(mine)choice.value=mine.mode;}
  choice.disabled=vote.disabled=gated||!idle||p.rounds.length>=PARTY_ROUND_LIMIT;next.hidden=!host;next.disabled=gated||!idle||r!.players.length<2||r!.players.some(q=>!q.connected)||p.votes.length!==r!.players.length||p.rounds.length>=PARTY_ROUND_LIMIT;
  finish.hidden=!host||r!.mode!=='cruise'||r!.phase!=='running';finish.disabled=gated||r!.players.some(q=>Math.hypot(q.pose.vx,q.pose.vz)>2);end.hidden=!host;end.disabled=gated||!idle;download.disabled=false;
  status.textContent='活動已完成 '+p.rounds.length+'/20場 · 投票 '+p.votes.length+'/'+r!.players.length+(p.selected?' · 目前結果：'+PARTY_LABELS[p.selected]:' · 等待選擇')+(r!.players.some(q=>!q.connected)?' · 等候原席續接，暫不切場。':idle?' · 可更改投票，全部投票後房主切換。':' · 本場結束後開放投票。');
  standings.replaceChildren();for(const row of[...p.scores].sort((a,b)=>b.points-a.points||a.slot-b.slot)){const li=document.createElement('li');li.textContent='席位'+(row.slot+1)+' '+(r!.players.find(q=>q.slot===row.slot)?.name??'原隊員')+' · '+row.points+'分';standings.append(li);}
  roundList.replaceChildren();for(const row of p.rounds){const li=document.createElement('li');li.textContent='第'+row.number+'場 '+PARTY_LABELS[row.mode as PartyMode]+' · '+row.awards.map(a=>'席位'+(a.slot+1)+' +'+a.points).join('／');roundList.append(li);}
 }
 return{root,render};
}
