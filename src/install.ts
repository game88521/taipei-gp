// 「加到主畫面」提示：加了之後像 App 一樣全螢幕開、離線也能玩（Service Worker 已經有了）
// - Android／電腦的 Chrome、Edge：攔下 beforeinstallprompt，選單裡放一張「安裝」卡片，點了才跳出系統的安裝視窗
// - iPhone／iPad 的 Safari：沒有這個事件，改成教學「點分享 → 加入主畫面」
// - 已經是從主畫面開的、或按過 ×（14 天內）就不顯示

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

const KEY = 'gp-install-hide';
const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const hiddenRecently = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < 14 * 864e5; } catch { return false; } };
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function setupInstall(card: HTMLElement) {
  const btn = card.querySelector<HTMLButtonElement>('.m-inst-go')!, text = card.querySelector<HTMLElement>('.m-inst-txt small')!;
  card.querySelector<HTMLButtonElement>('.m-inst-x')!.addEventListener('click', () => {
    card.hidden = true;
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* 無痕模式 */ }
  });
  if (standalone() || hiddenRecently()) return;
  let deferred: InstallEvent | null = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 不要瀏覽器自己跳的小橫幅，改用選單裡的卡片
    if (isIOS()) return; // iPhone 上的其他瀏覽器：一樣只能走 Safari 的「加入主畫面」
    deferred = e as InstallEvent;
    btn.hidden = false;
    card.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') card.hidden = true;
  });
  addEventListener('appinstalled', () => { card.hidden = true; });
  if (isIOS()) {
    text.textContent = '點 Safari 下方的「分享」⬆️，再點「加入主畫面」';
    btn.hidden = true;
    card.hidden = false;
  }
}
