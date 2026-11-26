/** Rex <game88521@gmail.com>. Reuses real state; never starts or modifies a game. */
import type {LanternRuleState} from '../shared/lantern-ui-rules';
export {socialLanternRuleState,dutyLanternRuleState,racingLanternRuleState} from '../shared/lantern-ui-rules';
import './lantern-rules.css';
export function collapseLanternRuleText(text:HTMLElement){const details=document.createElement('details'),summary=document.createElement('summary');details.className='lantern-rule-full';summary.textContent='完整規則與限制';text.before(details);details.append(summary,text);return details;}
export function mountLanternRules(host:HTMLElement,id:string,liveHost?:HTMLElement){
 const root=document.createElement('section'),details=document.createElement('details'),summary=document.createElement('summary'),grid=document.createElement('dl'),phase=document.createElement('p'),hint=document.createElement('p');
 root.id=id;root.className='lantern-rules';summary.textContent='玩法重點：目標、職責與計分';details.open=true;grid.className='lantern-rule-cards';phase.className='lantern-rule-phase';phase.setAttribute('role','status');phase.setAttribute('aria-live','polite');hint.className='lantern-rule-next';
 const values=['這場目標','你的職責','怎麼計分'].map(label=>{const card=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;card.append(dt,dd);grid.append(card);return dd;});
 details.append(summary,grid);root.append(details,phase,hint);host.append(root);
 const live=liveHost?document.createElement('p'):null;if(live){live.id=id+'-live';live.className='lantern-rule-live';live.setAttribute('aria-live','off');liveHost!.append(live);}
 let key='';return{root,update(state:LanternRuleState){const next=JSON.stringify(state);if(next===key)return;key=next;values[0].textContent=state.objective;values[1].textContent=state.role;values[2].textContent=state.scoring;phase.textContent=state.mode+' · '+state.phase;hint.textContent='現在要做：'+state.hint;if(live)live.textContent=state.hint;},dispose(){root.remove();live?.remove();}};
}
