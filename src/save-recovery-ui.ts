import { getSaveRecovery, exportRecoveryOriginal, restoreLastGoodSave, createNewSave, parseSaveFile, writeImported } from './save';
import { bootFail } from './boot';

/** 讀不到原存檔時，在建立3D場景前停下，避免暫時空進度進入遊戲。 */
export function showSaveRecovery(): boolean {
  const recovery = getSaveRecovery();
  if (!recovery.blocked) return false;
  bootFail('存檔需要救援，已停止自動覆寫。', false);
  document.getElementById('boot')?.classList.add('hidden');
  const panel = document.getElementById('save-recovery')!;
  for (const sibling of document.body.children) if (sibling !== panel && sibling instanceof HTMLElement) sibling.inert = true;
  const message = document.getElementById('save-recovery-message')!;
  const status = document.getElementById('save-recovery-status')!;
  const downloaded = document.getElementById('save-recovery-exported') as HTMLInputElement;
  const restore = document.getElementById('save-recovery-restore') as HTMLButtonElement;
  const file = document.getElementById('save-recovery-file') as HTMLInputElement;
  message.textContent = recovery.reason === 'unreadable'
    ? '目前無法讀取瀏覽器裡的存檔。請先檢查儲存權限，再重試；原進度不會被自動覆寫。'
    : recovery.reason === 'partial'
      ? `存檔中有部分進度資料異常：${recovery.dropped.join('、')}。遊戲已停止自動保存，避免把可用快照替換成缺少資料的進度。請先下載原始內容，再選擇還原方式。`
      : '目前的存檔無法讀取。遊戲已暫停自動保存；請下載原始內容，或選擇下方方式恢復。';
  restore.disabled = !recovery.hasSnapshot;
  restore.textContent = recovery.hasSnapshot ? '恢復最近可用的存檔' : '沒有可用的自動快照';
  status.textContent = recovery.hasSnapshot && recovery.snapshotAt != null
    ? `可用快照：${new Date(recovery.snapshotAt).toLocaleString('zh-TW')}`
    : '若有自行下載的備份，可以選檔還原。';
  const options = () => ({ originalExported: downloaded.checked && !downloaded.disabled });
  const finish = (result: { ok: true } | { ok: false; error: string }) => {
    if (!result.ok) { status.textContent = result.error; return; }
    for (const button of panel.querySelectorAll('button')) button.disabled = true;
    status.textContent = '存檔已恢復，正在重新載入…';
    location.reload();
  };
  document.getElementById('save-recovery-export')!.addEventListener('click', () => {
    const result = exportRecoveryOriginal();
    if (!result.ok) { status.textContent = result.error; return; }
    const url = URL.createObjectURL(new Blob([result.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `taipei-gp-original-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    downloaded.disabled = false;
    downloaded.closest('label')!.classList.remove('hidden');
    status.textContent = '已請瀏覽器下載原始檔。請確認檔案確實保留後，再勾選下方確認。';
  });
  restore.addEventListener('click', () => {
    if (confirm('恢復最近可用的存檔？快照之後的進度可能不在其中；目前原始內容會先保留副本。')) finish(restoreLastGoodSave(options()));
  });
  document.getElementById('save-recovery-new')!.addEventListener('click', () => {
    if (confirm('確定建立新的遊戲進度？這不會復原舊進度，原始內容會先保留副本。')) finish(createNewSave(options()));
  });
  document.getElementById('save-recovery-import')!.addEventListener('click', () => file.click());
  let reading = false;
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; file.value = '';
    if (!selected || reading) return;
    if (selected.size > 8_000_000) { status.textContent = '備份檔太大，請選擇遊戲匯出的備份。'; return; }
    reading = true;
    try {
      const parsed = parseSaveFile(await selected.text());
      if (!parsed.ok) { status.textContent = `無法還原：${parsed.why}`; return; }
      const dropped = parsed.dropped.length ? `\n其中無效欄位會略過：${parsed.dropped.join('、')}。請確認可以接受這些資料缺漏。` : '';
      if (!confirm(`以「${selected.name}」還原遊戲？目前原始內容會先保留副本。${dropped}`)) return;
      finish(writeImported(parsed.save, options()) ? { ok: true } : { ok: false, error: '備份或寫入失敗，尚未套用還原。請先下載並確認保留原始檔，或檢查瀏覽器空間與權限。' });
    } catch { status.textContent = '無法讀取備份檔，請重新選擇。'; }
    finally { reading = false; }
  });
  document.getElementById('save-recovery-retry')!.addEventListener('click', () => location.reload());
  panel.classList.remove('hidden');
  document.getElementById('save-recovery-title')!.focus();
  return true;
}
