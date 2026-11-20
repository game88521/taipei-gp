import { GP_CHALLENGES, challengeRecordKey, type GpChallenge, type GpChallengeRun, type ChallengeRecords } from './evolution-challenges';
import { GhostImportIntent, exportSharedGhost, parseSharedGhost, ghostSpeedTrace, type GhostContext, type SharedGhost } from './evolution-ghost-share';
import { interpolateCoach, type TtCoach } from './tt-coach';
import type { Ghost } from './save';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const e = document.createElement(tag); e.textContent = text; return e; };
const button = (id: string, label: string, fn: () => void) => { const b = el('button', label); b.type = 'button'; b.id = id; b.className = 'ghost-btn'; b.addEventListener('click', fn); return b; };
export function mountGpChallenges(host: HTMLElement, callbacks: { start: (d: GpChallenge) => void; retry: () => void; exit: () => void; records: ChallengeRecords; stamp: string }) {
  const panel = el('details'); panel.className = 'feature-card'; panel.id = 'gp-challenges'; panel.append(el('summary', 'GP 情境挑戰 · 固定種子短關'));
  panel.append(el('p', '在目前賽道挑戰，固定經典規則／簡單 AI／安全並排 v1；滾動起跑。只保存獨立通關時間，不更新正式圈速、賽季、錢包或成就。'));
  const records = new Map<string, HTMLElement>();
  for (const def of GP_CHALLENGES) {
    const row = el('section'); row.append(el('h4', def.title), el('p', `${def.description} 固定種子 ${def.seed}；扶正／重置判失敗。`));
    const record = el('p'); records.set(def.id, record); row.append(record, button(`gp-challenge-${def.id}`, '開始挑戰', () => callbacks.start(def))); panel.append(row);
  }
  host.append(panel);
  const hud = el('div'); hud.id = 'gp-challenge-hud'; hud.hidden = true;
  hud.style.cssText = 'position:fixed;left:50%;bottom:95px;transform:translateX(-50%);z-index:85;width:min(640px,92vw);max-height:38vh;overflow:auto;background:#101826ed;color:white;border:1px solid #65c6ff;border-radius:12px;padding:10px;pointer-events:auto;font:14px system-ui';
  const status = el('p'); status.id = 'gp-challenge-progress'; status.setAttribute('role', 'status');
  const retry = button('gp-challenge-retry', '重試同一關', callbacks.retry), exit = button('gp-challenge-exit', '退出挑戰', callbacks.exit);
  hud.append(status, retry, exit); document.body.append(hud);
  function refresh() { for (const def of GP_CHALLENGES) { const r = callbacks.records.get(challengeRecordKey(callbacks.stamp, def.id)); records.get(def.id)!.textContent = r ? `獨立紀錄：通關 ${r.wins} 次／最快 ${r.best.toFixed(3)} 秒` : '獨立紀錄：尚未通關'; } }
  refresh();
  return { panel, hud, status, refresh, render(run: GpChallengeRun, progress: string) { hud.hidden = !run.active; status.textContent = run.result ? `${run.result.success ? '挑戰成功' : '挑戰失敗'} ｜ ${run.result.reason} ｜ P${run.result.rank} ｜ ${run.result.elapsed.toFixed(3)} 秒 ｜ 重撞 ${run.result.hits} 次` : progress; retry.hidden = !run.result; } };
}
export function mountGhostShare(host: HTMLElement, options: { context: () => GhostContext; own: () => { time: number | null; ghost: Ghost | null }; coach: TtCoach; changed: () => void }) {
  let friend: SharedGhost | null = null, useFriend = false;
  const intent = new GhostImportIntent(), panel = el('details'); panel.id = 'tt-ghost-share'; panel.className = 'feature-card';
  document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('.m-mode,#btn-resume,#practice-start,#gp-challenges button')) intent.invalidate(); }, { capture: true });
  panel.append(el('summary', 'TT 影子分享與好友挑戰'));
  panel.append(el('p', '下載自己的有效 PB 影子，或選檔／貼上好友影子。須同賽道版本、規則、方程式車種。好友影子只留本分頁作參考；匯入不更動 PB、不送排行榜。影子沒有煞車遙測，速度由座標推算。'));
  const status = el('p', '目前使用自己的 PB 影子。'), comparison = el('p'); status.id = 'tt-ghost-share-status'; status.setAttribute('role', 'status'); comparison.id = 'tt-friend-coach';
  const selector = el('select'); selector.id = 'tt-ghost-source'; selector.setAttribute('aria-label', 'TT 影子參考來源');
  for (const [value, label] of [['own', '自己的 PB 影子'], ['friend', '好友影子']]) { const o = el('option', label); o.value = value; selector.append(o); }
  const signature = () => { const c = options.context(); return `${c.circuit}:${c.stamp}:${c.rules}:${c.car}`; };
  const notify = () => { selector.value = useFriend ? 'friend' : 'own'; options.changed(); };
  function accept(raw: string) { const parsed = parseSharedGhost(raw, options.context()); friend = parsed; useFriend = true; status.textContent = `好友影子已驗證：${parsed.rules === 'classic' ? '經典' : '2026'}／${parsed.points} 點／${parsed.time.toFixed(3)} 秒。僅作挑戰參考。`; notify(); }
  const file = el('input'); file.type = 'file'; file.id = 'tt-ghost-file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', '選擇好友 TT 影子 JSON');
  file.addEventListener('click', () => { intent.invalidate(); file.value = ''; });
  file.addEventListener('change', async () => { const chosen = file.files?.[0]; if (!chosen) return; try { const raw = await intent.read(chosen, signature(), signature); if (raw !== null) accept(raw); } catch (e) { status.textContent = `匯入失敗：${e instanceof Error ? e.message : String(e)}`; } });
  const paste = el('textarea'); paste.id = 'tt-ghost-paste'; paste.rows = 3; paste.maxLength = 2 * 1024 * 1024; paste.placeholder = '在這裡貼上好友影子 JSON'; paste.setAttribute('aria-label', '貼上好友影子 JSON'); paste.style.cssText = 'width:100%;box-sizing:border-box'; paste.addEventListener('input', () => intent.invalidate());
  selector.addEventListener('change', () => { intent.invalidate(); useFriend = selector.value === 'friend' && !!friend; status.textContent = useFriend ? `使用好友影子 ${friend!.time.toFixed(3)} 秒；自己的 PB 保留。` : '目前使用自己的 PB 影子。'; notify(); });
  panel.append(button('tt-ghost-download', '下載自己的 PB 影子', () => { intent.invalidate(); try { const own = options.own(), raw = exportSharedGhost(options.context(), own.time, own.ghost), blob = new Blob([raw], { type: 'application/json' }), url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = `taipei-gp-${options.context().circuit}-${options.context().rules}-ghost.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = '已下載獨立影子 JSON。'; } catch (e) { status.textContent = `無法下載：${e instanceof Error ? e.message : String(e)}`; } }), file, paste,
    button('tt-ghost-import-paste', '匯入貼上的影子', () => { intent.invalidate(); try { accept(paste.value); } catch (e) { status.textContent = `匯入失敗：${e instanceof Error ? e.message : String(e)}`; } }), selector,
    button('tt-ghost-clear', '取消好友影子', () => { intent.invalidate(); friend = null; useFriend = false; comparison.textContent = ''; status.textContent = '已取消好友影子，使用自己的 PB 影子。'; notify(); }), status, comparison);
  host.append(panel);
  let friendTrace: ReturnType<typeof ghostSpeedTrace> | null = null, previous: SharedGhost | null = null, lastUpdate = -1;
  return {
    get active() { if (!useFriend || !friend) return null; const c = options.context(); return friend.rules === c.rules && friend.stamp === c.stamp && friend.circuit === c.circuit ? friend.ghost : null; },
    invalidate() { intent.invalidate(); },
    update(s: number, speed: number, time: number) {
      if (time >= lastUpdate && time - lastUpdate < .25) return;
      lastUpdate = time;
      if (!useFriend || !friend) { comparison.textContent = ''; return; }
      const c = options.context(); if (friend.rules !== c.rules || friend.stamp !== c.stamp) { friend = null; useFriend = false; notify(); status.textContent = '規則已變更，好友影子已清除；請匯入相符版本。'; return; }
      if (previous !== friend) { previous = friend; friendTrace = ghostSpeedTrace(friend); }
      const reference = interpolateCoach(friendTrace, s), own = interpolateCoach(options.coach.current(), s);
      comparison.textContent = reference ? `好友同距離對照 ${Math.round(s)} m：${(time - reference.t) >= 0 ? '+' : ''}${(time - reference.t).toFixed(3)} 秒 ｜ 速度差 ${(((own?.v ?? speed) - reference.v) * 3.6).toFixed(1)} km/h（好友為位置推算速度；無煞車資料）` : '好友影子目前位置資料不足。';
    },
  };
}
