import { getSaveWriterState, exportSave } from './save';
import { bootFail } from './boot';

let wired = false;
/** 有衝突時只保留下載與重讀入口，不能用本頁舊記憶體強行接管。 */
export function showSaveWriterConflict(): boolean {
  const state = getSaveWriterState();
  if (state.phase !== 'blocked') return false;
  // bootDone 會移除載入DOM；執行中衝突不能再讓 bootFail 存取已不存在的文字節點。
  const boot = document.getElementById('boot');
  if (boot) { bootFail('存檔已停止寫入，請重新讀取進度。', false); boot.classList.add('hidden'); }
  const panel = document.getElementById('save-conflict')!;
  for (const sibling of document.body.children) if (sibling !== panel && sibling instanceof HTMLElement) sibling.inert = true;
  document.getElementById('save-conflict-message')!.textContent = state.message;
  if (!wired) {
    wired = true;
    document.getElementById('save-conflict-reload')!.addEventListener('click', () => location.reload());
    document.getElementById('save-conflict-export')!.addEventListener('click', () => {
      const status = document.getElementById('save-conflict-status')!;
      try {
        const url = URL.createObjectURL(new Blob([exportSave()], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `taipei-gp-this-tab-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        status.textContent = '已請瀏覽器下載本頁進度。請確認檔案已保留；這份備份可能與目前已儲存的進度不同。';
      } catch { status.textContent = '下載失敗，請檢查瀏覽器的下載權限後再試。'; }
    });
  }
  panel.classList.remove('hidden');
  document.getElementById('save-conflict-title')!.focus();
  return true;
}
