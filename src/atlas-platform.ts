import './atlas-platform.css';
import {ATLAS_MODES,ATLAS_MODE_KEY,parseModePreferences,findAtlasModes,type AtlasModePreferences} from './atlas-modes';
export interface AtlasPlatformHooks {flush():boolean;parseMain(text:string):{ok:boolean;dropped?:string[]};beginRestore():{finish(success:boolean,rollbackComplete:boolean):void}|null;openCityChallenges(section?:string):Promise<boolean>}
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',id='')=>{const e=document.createElement(tag);e.textContent=text;if(id)e.id=id;return e;};
export function mountAtlasPlatform(h:AtlasPlatformHooks) {
  const host=document.querySelector('[data-pane="play"] .m-modes');if(!host)return;
  const box=make('details','','atlas-modes');box.className='feature-card atlas-tools';const summary=make('summary','玩法搜尋・收藏・最近遊玩');box.append(summary);
  const query=make('input','','atlas-mode-search');query.type='search';query.maxLength=100;query.placeholder='搜尋玩法或控制裝置';query.setAttribute('aria-label','搜尋所有玩法');
  const group=make('select','','atlas-mode-filter');group.setAttribute('aria-label','玩法分類');for(const[value,label]of[['all','全部玩法'],['solo','單人'],['online','線上競速'],['coop','合作'],['local','同機'],['favorites','我的收藏'],['recent','最近開啟']]){const o=make('option',label);o.value=value;group.append(o);}
  const bar=make('div');bar.className='atlas-row';bar.append(query,group);const status=make('p','','atlas-mode-status');status.setAttribute('role','status');const list=make('div','','atlas-mode-list');box.append(bar,status,list);host.before(box);
  let prefs:AtlasModePreferences={v:1,favorites:[],recent:[]},blocked=false,opening=false,forwarding:Element|null=null;
  try{const raw=localStorage.getItem(ATLAS_MODE_KEY);if(raw){const p=parseModePreferences(JSON.parse(raw));if(!p)throw Error();prefs=p;}}catch{blocked=true;}
  const persist=()=>{if(blocked)return;try{localStorage.setItem(ATLAS_MODE_KEY,JSON.stringify(prefs));}catch{blocked=true;}};
  const remember=(id:string)=>{prefs.recent=[id,...prefs.recent.filter(old=>old!==id)].slice(0,8);persist();render();};
  function render(){list.replaceChildren();const rows=findAtlasModes(query.value,group.value,prefs);status.textContent=`${rows.length}種玩法${blocked?'；收藏暫留本頁，原資料未覆寫。':''}`;
    for(const m of rows){const row=make('div');row.className='atlas-mode-row';const launch=make('button','','atlas-launch-'+m.id);launch.type='button';launch.className='atlas-launch';launch.disabled=opening;launch.append(make('strong',m.name),make('small',`${m.players} · ${m.duration} · ${m.devices}`));launch.onclick=async()=>{
      if(opening)return;
      const target=document.getElementById(m.target) as HTMLButtonElement|HTMLAnchorElement|null;
      if(!target||target instanceof HTMLButtonElement&&target.disabled){status.textContent='這個模式還在準備，請稍後重試。';return;}
      if(m.cityOnly&&target.hidden){const back=make('a','回台北選擇此玩法','atlas-mode-city-link');back.href='/';status.replaceChildren(document.createTextNode('此玩法需回台北。'),back);return;}
      if(m.cityOnly){opening=true;launch.disabled=true;status.textContent='正在準備城市玩法…';try{forwarding=target;let pending:Promise<boolean>;try{pending=h.openCityChallenges(m.section);}finally{forwarding=null;}if(await pending)remember(m.id);else status.textContent='這次沒有開啟玩法，請稍後重試。';}catch{status.textContent='城市玩法載入失敗，請稍後重試。';}finally{opening=false;for(const button of list.querySelectorAll<HTMLButtonElement>('.atlas-launch'))button.disabled=false;}return;}
      remember(m.id);forwarding=target;try{target.click();}finally{forwarding=null;}
    };
    const favorite=make('button',prefs.favorites.includes(m.id)?'★':'☆','atlas-favorite-'+m.id);favorite.type='button';favorite.setAttribute('aria-label',`${prefs.favorites.includes(m.id)?'取消收藏':'收藏'}${m.name}`);favorite.setAttribute('aria-pressed',String(prefs.favorites.includes(m.id)));favorite.onclick=()=>{prefs.favorites=prefs.favorites.includes(m.id)?prefs.favorites.filter(id=>id!==m.id):[...prefs.favorites,m.id];persist();render();document.getElementById(favorite.id)?.focus();};row.append(launch,favorite);list.append(row);}
  }
  query.oninput=render;group.onchange=render;render();
  const onClick=(e:Event)=>{const target=(e.target as Element).closest('button,a');if(!target||box.contains(target)||target===forwarding)return;const m=ATLAS_MODES.find(m=>m.target===target.id);if(m)remember(m.id);};document.addEventListener('click',onClick);
  const backup=make('details','','atlas-backup-tools');backup.className='feature-card atlas-tools';backup.append(make('summary','全模式整包備份與還原'));const load=make('button','開啟整包備份工具','atlas-backup-open');load.type='button';const body=make('div','','atlas-backup-body');backup.append(load,body);document.getElementById('bk-save')?.closest('section')?.append(backup);
  load.onclick=async()=>{load.disabled=true;try{const m=await import('./atlas-backup-ui');m.mountAtlasBackup(body,h);load.remove();}catch{load.disabled=false;load.textContent='載入失敗，按此重試';}};
  addEventListener('pagehide',()=>document.removeEventListener('click',onClick),{once:true});
}
