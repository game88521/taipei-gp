import { SummitLazy } from './summit-lazy';
type Mount = typeof import('./nexus-replay-ui').mountMultiplayerReplay;

export const mountMultiplayerReplay: Mount = getClient => {
  let api: ReturnType<Mount> | null = null;
  const loader = new SummitLazy(async () => (await import('./nexus-replay-ui')).mountMultiplayerReplay);
  const panel = document.createElement('details'); panel.id = 'mp-replay-library'; panel.className = 'nexus-replay-library';
  const summary = document.createElement('summary'); summary.textContent = '多人回放庫';
  const status = document.createElement('p'); status.setAttribute('role','status'); status.textContent = '開啟時載入回放工具；未開啟不建立回放場景。'; panel.append(summary,status);
  const history = document.getElementById('mp-history'); if (history) history.before(panel); else document.getElementById('mp-menu')?.append(panel);
  const result = document.createElement('section'), fetchButton = document.createElement('button'); result.className = 'nexus-replay-result';
  fetchButton.type = 'button'; fetchButton.id = 'mp-replay-fetch'; fetchButton.textContent = '取得本場回放'; fetchButton.disabled = true; result.append(fetchButton); document.getElementById('mp-results')?.append(result);
  function sync() { const client=getClient(),room=client?.room; fetchButton.disabled=loader.loading || client?.status!=='connected' || room?.phase!=='results' || !room.capabilities?.replay || !room.replay?.ready; }
  const unsubscribe = getClient()?.subscribe(sync);
  async function load(action: 'library' | 'fetch' | 'api') {
    if (api) return api;
    const ok = await loader.open(mount => {
      panel.remove(); result.remove(); unsubscribe?.(); api=mount(getClient);
      if (action==='library') { const actual=document.getElementById('mp-replay-library') as HTMLDetailsElement|null; if(actual)actual.open=true; }
      if (action==='fetch') document.getElementById('mp-replay-fetch')?.click();
    });
    if (!ok && loader.error) { status.textContent=`回放工具載入失敗：${loader.error}。關閉後再開啟可重試。`; sync(); }
    return api;
  }
  panel.addEventListener('toggle',()=>{if(panel.open){status.textContent='正在載入回放工具…';void load('library');}else if(!api)loader.cancel();});
  fetchButton.onclick=()=>{void load('fetch');}; sync();
  return {
    get current(){return api?.current??null;}, get active(){return api?.active??false;}, get ready(){return api?.ready??false;}, get at(){return api?.at??0;},
    seek(at:number){api?.seek(at);}, async play(value){const mounted=await load('api');if(!mounted)throw Error(loader.error||'回放工具尚未載入。');return mounted.play(value);},
  };
};
