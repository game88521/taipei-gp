/** 捕捉後續操作，只撤銷等待授權的意圖；不停止已開始的練習。 */
export function bindPracticeCancellation(doc: EventTarget, win: EventTarget, isStart: (target: EventTarget | null) => boolean, cancel: () => void) {
  const pointer = (event: Event) => { if (!isStart(event.target)) cancel(); };
  const key = (event: Event) => { if ((event as KeyboardEvent).key === 'Escape') cancel(); };
  for (const type of ['pointerdown', 'click', 'change']) doc.addEventListener(type, pointer, true);
  doc.addEventListener('keydown', key, true); win.addEventListener('pagehide', cancel);
  return () => { for (const type of ['pointerdown', 'click', 'change']) doc.removeEventListener(type, pointer, true); doc.removeEventListener('keydown', key, true); win.removeEventListener('pagehide', cancel); };
}
