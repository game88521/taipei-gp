/** Rex <game88521@gmail.com>. SVG previews never load or switch the driving scene. */
import previews from '../shared/lantern-ui-track-previews.json';
import {CATALOG_STAMP} from '../shared/multiplayer-tracks';
import './lantern-track-picker.css';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
function svg(row: typeof previews.tracks[number]) {
  const ns='http://www.w3.org/2000/svg',root=document.createElementNS(ns,'svg'),line=document.createElementNS(ns,'path'),start=document.createElementNS(ns,'circle');
  root.setAttribute('viewBox','0 0 200 128');root.setAttribute('aria-hidden','true');root.setAttribute('focusable','false');
  line.setAttribute('d',row.path);start.setAttribute('cx',String(row.start[0]));start.setAttribute('cy',String(row.start[1]));start.setAttribute('r','4');root.append(line,start);return root;
}
export function mountLanternTrackPicker(select:HTMLSelectElement) {
  const root=el('section'),selected=el('div'),details=el('details'),summary=el('summary','瀏覽全部 24 張路線'),search=el('input'),searchLabel=el('label','搜尋地圖或地點'),grid=el('div'),empty=el('p','沒有符合的路線。');
  root.id=select.id+'-lantern-picker';root.className='lantern-track-picker';root.setAttribute('aria-label','地圖路線預覽');selected.className='lantern-track-selected';grid.className='lantern-track-grid';
  search.type='search';search.id=select.id+'-lantern-search';search.placeholder='輸入地圖或地點';searchLabel.htmlFor=search.id;searchLabel.append(search);
  const valid=previews.catalogStamp===CATALOG_STAMP;
  const buttons=previews.tracks.map(row=>{const b=el('button');b.type='button';b.id=select.id+'-lantern-'+row.id;b.dataset.trackId=row.id;b.setAttribute('aria-label',`選擇 ${row.name}，${row.place}`);const name=el('strong',row.flag+' '+row.name),place=el('span',row.place);b.append(svg(row),name,place);b.onclick=()=>{if(select.matches(':disabled')||!select.options.length)return;select.value=row.id;select.dispatchEvent(new Event('change',{bubbles:true}));refresh();};grid.append(b);return b;});
  const note=el('small','依賽道資料中心線繪製，圓點表示資料起點；非街景或煞車指示。');
  details.append(summary,searchLabel,grid,empty);root.append(selected,details,note);select.closest('label')?.after(root);
  let key='';
  function refresh(){
    const disabled=select.matches(':disabled')||!select.options.length,query=search.value.trim().toLocaleLowerCase(),row=previews.tracks.find(r=>r.id===select.value),next=[row?.id,query,disabled,valid].join('|');
    if(next===key)return;key=next;
    if(row&&valid){selected.replaceChildren(svg(row),el('strong',row.flag+' '+row.name),el('span',row.place+` · 約 ${row.lengthKm.toFixed(2)} km`));}
    else selected.replaceChildren(el('p',valid?'等待地圖選單就緒。':'路線預覽版本待更新，請使用上方選單。'));
    details.hidden=!valid;
    buttons.forEach((b,i)=>{const r=previews.tracks[i];b.disabled=disabled;b.hidden=!!query&&!`${r.name} ${r.place}`.toLocaleLowerCase().includes(query);b.setAttribute('aria-pressed',String(r.id===select.value));});
    empty.hidden=buttons.some(b=>!b.hidden);
  }
  search.oninput=refresh;select.addEventListener('change',refresh);
  const observer=new MutationObserver(refresh);observer.observe(select,{attributes:true,childList:true});
  // Quick-room fieldsets are disabled as a unit while a submit is in progress.
  const fieldset=select.closest('fieldset');if(fieldset)observer.observe(fieldset,{attributes:true,attributeFilter:['disabled']});
  const description=select.id==='mp-room-track'?document.getElementById('mp-room-description'):null;if(description)observer.observe(description,{childList:true,characterData:true,subtree:true});
  refresh();return{refresh,dispose(){observer.disconnect();select.removeEventListener('change',refresh);root.remove();}};
}
