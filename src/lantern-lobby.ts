/** Rex <game88521@gmail.com>. Presentation only: retain every original room control. */
import './lantern-lobby.css';
import {mountLanternTrackPicker} from './lantern-track-picker';

export function mountLanternLobby(room = document.getElementById('mp-room')) {
  if (!room || room.dataset.lanternLobby) return;
  room.dataset.lanternLobby = 'true';
  const media = matchMedia('(max-width: 640px)'), tabs = document.createElement('nav');
  tabs.className = 'lantern-lobby-tabs'; tabs.setAttribute('aria-label', '房間設定分類');
  const sections = ['players', 'rules', 'events'] as const;
  type Section = typeof sections[number];
  const labels = {players:'玩家', rules:'房規', events:'賽事'};
  const panels = new Map<Section, HTMLElement>(), buttons = new Map<Section, HTMLButtonElement>();
  let selected: Section = 'players';
  const apply = () => {
    tabs.setAttribute('role', media.matches ? 'tablist' : 'navigation');
    for (const key of sections) {
      const panel = panels.get(key)!, button = buttons.get(key)!;
      panel.hidden = media.matches && key !== selected;
      if (media.matches) {
        panel.setAttribute('role','tabpanel'); button.setAttribute('role','tab');
        button.setAttribute('aria-selected',String(key === selected)); button.tabIndex = key === selected ? 0 : -1;
      } else {
        panel.removeAttribute('role'); button.removeAttribute('role'); button.removeAttribute('aria-selected'); button.tabIndex = 0;
      }
    }
    placeDock();
  };
  let dock:HTMLElement|null=null;
  function placeDock(){if(!dock)return;const floating=media.matches&&innerHeight>450&&document.documentElement.dataset.harborKeyboard!=='true';if(floating){if(dock.parentElement!==document.body)document.body.append(dock);}else if(dock.parentElement!==room)room!.append(dock);dock.hidden=room!.hidden||!!room!.closest('[hidden]');}
  for (const key of sections) {
    const button = document.createElement('button'), panel = document.createElement('section'), title = document.createElement('h3');
    button.type='button'; button.id='lantern-lobby-tab-'+key; button.textContent=labels[key];
    panel.id='lantern-lobby-'+key; panel.className='lantern-lobby-section'; panel.setAttribute('aria-labelledby',button.id);
    button.setAttribute('aria-controls',panel.id); title.textContent=labels[key]; title.className='lantern-lobby-title'; panel.append(title);
    button.onclick=()=>{selected=key;apply();if(!media.matches)panel.scrollIntoView({block:'start',behavior:'smooth'});};
    button.onkeydown=event=>{if(!media.matches||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const i=sections.indexOf(key);selected=event.key==='Home'?'players':event.key==='End'?'events':sections[(i+(event.key==='ArrowRight'?1:2))%3];apply();buttons.get(selected)?.focus();};
    tabs.append(button);panels.set(key,panel);buttons.set(key,button);
  }
  dock = document.getElementById('mp-ready')?.parentElement??null;
  if(dock){dock.id='lantern-lobby-actions';dock.classList.add('lantern-lobby-actions');dock.setAttribute('aria-label','準備與起跑操作');dock.setAttribute('data-harbor-reading-surface','');}
  const readiness=document.createElement('p');readiness.id='lantern-lobby-readiness';readiness.className='lantern-lobby-readiness';readiness.setAttribute('aria-live','polite');dock?.prepend(readiness);
  const updateReadiness=()=>{const players=document.getElementById('mp-players'),states=players?[...players.querySelectorAll('li > b')].map(b=>b.textContent??''):[],ready=states.filter(s=>s==='已準備').length,loading=states.filter(s=>s==='載入地圖中').length,reconnecting=states.filter(s=>s==='等待重連').length;const next=states.length?`${states.length} 位車手 · 已準備 ${ready}/${states.length}${loading?' · 載圖 '+loading:''}${reconnecting?' · 續接 '+reconnecting:''}`:'等待車手與載圖狀態同步。';if(readiness.textContent!==next)readiness.textContent=next;};
  const roster=document.getElementById('mp-players');if(roster)new MutationObserver(updateReadiness).observe(roster,{childList:true,subtree:true,characterData:true});updateReadiness();
  if(dock)new ResizeObserver(()=>room.style.setProperty('--lantern-dock-height',dock!.getBoundingClientRect().height+'px')).observe(dock);
  const classify = (node: HTMLElement): Section | null => {
    if(node===tabs||node===dock||[...panels.values()].includes(node)||node.classList.contains('mp-room-top'))return null;
    if(['mp-players','mp-map-status','mp-grid-order','mp-viewers','mp-claim-seat','mp-host-controls'].includes(node.id))return 'players';
    if(['mp-room-description','mp-rules-description','mp-room-rules','mp-room-laps-field','mp-map-policy','harbor-network-config','mp-horizon-settings'].includes(node.id)||node.classList.contains('mp-track-field'))return 'rules';
    if(node.classList.contains('mp-invite-actions')||node.classList.contains('mp-invite-field')||node.id==='mp-invite-help'||node.id.startsWith('aurora-mp-invite'))return 'players';
    return 'events';
  };
  const group = () => {for(const node of [...room.children]){if(!(node instanceof HTMLElement))continue;const target=classify(node);if(target)panels.get(target)!.append(node);}};
  // A few advanced panels mount after the page lease resolves. Route them once on insertion.
  const observer=new MutationObserver(group);observer.observe(room,{childList:true});
  group();const heading=room.querySelector('.mp-room-top');if(heading)heading.after(tabs);else room.prepend(tabs);
  for(const panel of panels.values())room.insertBefore(panel,dock??null);
  room.addEventListener('lantern-reveal',event=>{const target=event.target;if(!(target instanceof Element))return;for(const[key,panel]of panels)if(panel.contains(target)){selected=key;apply();break;}});
  media.addEventListener('change',apply);apply();
  const visibility=new MutationObserver(placeDock);visibility.observe(room,{attributes:true,attributeFilter:['hidden']});if(room.parentElement)visibility.observe(room.parentElement,{attributes:true,attributeFilter:['hidden']});visibility.observe(document.documentElement,{attributes:true,attributeFilter:['data-harbor-keyboard']});addEventListener('resize',placeDock);
}

mountLanternLobby();
for(const id of ['mp-track','mp-room-track']){const select=document.getElementById(id);if(select instanceof HTMLSelectElement)mountLanternTrackPicker(select);}
