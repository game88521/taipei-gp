/** Rex <game88521@gmail.com>. Editors load on demand; observations stay synchronous. */
import {AuroraStrategySession,type AuroraActualLap,type AuroraStrategyContext} from './aurora-strategy';
import type {AuroraStrategyHooks} from './aurora-strategy-ui';
import type {mountAuroraDirector} from './aurora-director-ui';
type Director=ReturnType<typeof mountAuroraDirector>;
function shell(id:string,title:string){const panel=document.createElement('details');panel.id=id;const summary=document.createElement('summary');summary.textContent=title;const status=document.createElement('p');status.setAttribute('role','status');status.textContent='展開時載入工具。';panel.append(summary,status);return{panel,status};}
export function mountMeridianLazyStrategy(host:HTMLElement,hooks:AuroraStrategyHooks){
 const {panel,status}=shell('aurora-strategy','GP 長程策略沙盒 · 多停A/B比較'),session=new AuroraStrategySession();host.append(panel);
 let editor:ReturnType<typeof import('./aurora-strategy-ui').mountAuroraStrategy>|null=null,pending:Promise<void>|null=null,disposed=false;
 async function load(){if(disposed||editor||pending)return pending;status.textContent='正在載入策略工具…';pending=import('./aurora-strategy-ui').then(m=>{if(disposed)return;editor=m.mountAuroraStrategy(host,hooks,session);editor.element.open=panel.open;panel.replaceWith(editor.element);editor.update();}).catch(()=>{if(!disposed)status.textContent='載入失敗，收合後再展開即可重試。';}).finally(()=>{pending=null;});return pending;}
 panel.ontoggle=()=>{if(panel.open)void load();};
 return{session,get element(){return editor?.element??panel;},load,update(){editor?.update();},observe(c:Pick<AuroraStrategyContext,'trackId'|'trackStamp'|'rules'|'laps'>,s:AuroraActualLap){return editor?editor.observe(c,s):session.observe(c,s);},finish(){return editor?editor.finish():session.finish();},reset(){if(editor)editor.reset();else session.clear();},dispose(){disposed=true;editor?.dispose();panel.remove();}};
}
export function mountMeridianLazyDirector(options:Parameters<typeof mountAuroraDirector>[0]){
 const {panel,status}=shell('aurora-director','城市回放導演：自動精華／多段剪輯／影片下載');
 const caption=document.createElement('div');caption.hidden=true;
 let editor:Director|null=null,pending:Promise<Director|null>|null=null,disposed=false,generation=0,archive:{ms:number;actors:number;events:Parameters<Director['setArchive']>[2]}|null=null;
 async function load():Promise<Director|null>{if(disposed)return null;if(editor)return editor;if(pending)return pending;status.textContent='正在載入影片工具…';pending=import('./aurora-director-ui').then(m=>{if(disposed)return null;editor=m.mountAuroraDirector(options);if(archive)editor.setArchive(archive.ms,archive.actors,archive.events);editor.panel.open=panel.open;panel.replaceWith(editor.panel);caption.replaceWith(editor.caption);return editor;}).catch(()=>{if(!disposed)status.textContent='載入失敗，收合後再展開即可重試。';return null;}).finally(()=>{pending=null;});return pending;}
 panel.ontoggle=()=>{if(panel.open)void load();};
 return{get panel(){return editor?.panel??panel;},get caption(){return editor?.caption??caption;},get active(){return editor?.active??false;},get recording(){return editor?.recording??false;},get clips(){return editor?.clips??[];},load,
 setArchive(ms:number,actors:number,events:Parameters<Director['setArchive']>[2]=[]){generation++;archive={ms,actors,events};editor?.setArchive(ms,actors,events);},
 add(at?:number){const ticket=generation;panel.open=true;void load().then(e=>{if(e&&ticket===generation&&!disposed){e.panel.open=true;e.add(at);}});},
 frame(dt:number){return editor?.frame(dt)??null;},capture(){editor?.capture();},stop(){generation++;editor?.stop();},dispose(){disposed=true;generation++;editor?.dispose();panel.remove();caption.remove();}};
}
