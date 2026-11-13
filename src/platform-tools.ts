import type { Input } from './input';
import type { Sound, SoundPreview } from './audio';

function liveStatus() {
  const p = document.createElement('p'); p.setAttribute('role', 'status'); p.setAttribute('aria-live', 'polite'); return p;
}
function button(label: string) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; }

/** 讀真實感測資料；未收到有效樣本時不宣稱可用，也不允許把零值誤存為校正值。 */
export function mountTiltTools(container: HTMLElement, input: Input, onCalibrated: (zero: number) => void): () => void {
  const status = liveStatus(), testStatus = liveStatus(), test = button('檢查傾斜感測'), calibrate = button('以目前握姿校正');
  const meter = document.createElement('meter'); meter.min = -45; meter.max = 45; meter.value = 0; meter.setAttribute('aria-label', '相對中立角度');
  container.replaceChildren(status, meter, test, calibrate, testStatus);
  let testing = false, pending = false, base: number | null = null, left = false, right = false;
  const update = () => {
    const state = input.getTiltState();
    const message = state.message;
    if (status.textContent !== message) status.textContent = message;
    meter.value = state.raw === null ? 0 : Math.max(-45, Math.min(45, state.raw - input.tiltZero));
    calibrate.disabled = pending || !state.canCalibrate; test.disabled = pending;
    if (!testing || pending) return;
    if (state.status !== 'ready' || state.raw === null) { testStatus.textContent = state.message; return; }
    base ??= state.raw;
    left ||= state.raw < base - 4; right ||= state.raw > base + 4;
    testStatus.textContent = left && right ? '已收到兩個方向的有效變化。回到自然握姿後可按校正。' : `請將手機向左右各輕轉至少 4°：左 ${left ? '✓' : '待確認'}／右 ${right ? '✓' : '待確認'}。`;
    if (left && right) testing = false;
  };
  test.addEventListener('click', async () => {
    if (pending) return;
    testing = false; pending = true; base = null; left = right = false; update();
    const ok = await input.enableTilt();
    pending = false; testing = ok;
    testStatus.textContent = ok ? '請輕轉手機，等待有效感測資料。' : input.getTiltState().message;
    update();
  });
  calibrate.addEventListener('click', () => {
    const result = input.calibrateTilt();
    if (!result.ok) testStatus.textContent = result.error;
    else { onCalibrated(result.zero); testStatus.textContent = `已將 ${result.zero}° 設為中立握姿。`; }
    update();
  });
  const timer = setInterval(update, 350); update();
  return () => clearInterval(timer);
}

export function mountSoundTools(container: HTMLElement, sound: Sound): () => void {
  const status = liveStatus(), feedback = liveStatus(), retry = button('重新啟用音效'), controls = document.createElement('div');
  const labels: Record<SoundPreview, string> = { master: '主音量', engine: '自己的引擎', others: '其他車輛', ambient: '環境', fx: '音效' };
  const previews: HTMLButtonElement[] = [];
  for (const kind of Object.keys(labels) as SoundPreview[]) {
    const b = button(`試聽${labels[kind]}`); previews.push(b); controls.append(b);
    b.addEventListener('click', () => {
      const ok = sound.preview(kind);
      feedback.textContent = ok ? `已送出${labels[kind]}短音，使用目前音量設定。若沒有聲音，請確認裝置音量及上方播放狀態。` : sound.getStatus().message;
      update();
    });
  }
  container.replaceChildren(status, controls, retry, feedback);
  const update = () => {
    const state = sound.getStatus();
    if (status.textContent !== state.message) status.textContent = state.message;
    for (const b of previews) b.disabled = !sound.enabled;
    retry.disabled = !sound.enabled || !state.canRetry;
  };
  retry.addEventListener('click', () => { sound.retry(); feedback.textContent = '已嘗試重新啟用，請確認播放狀態後試聽。'; update(); });
  const timer = setInterval(update, 500); update();
  return () => clearInterval(timer);
}
