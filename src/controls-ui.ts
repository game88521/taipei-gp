import { Input, CONTROL_KEY, CONTROL_ACTIONS, CONTROL_LABELS, controlCodeLabel, defaultControls, parseControls, readControlPreferences, rebindControl, storeControlPreferences, connectedStandardPad, padSteering, type ControlAction, type ControlPreferences } from './input';

/** Same-origin settings are shared by single-player and multiplayer, independently of career saves. */
export function mountControlSettings(host: HTMLElement, input: Input) {
  const section = document.createElement('details'); section.className = 'control-settings';
  const title = document.createElement('summary'); title.textContent = '自訂按鍵與手把';
  const body = document.createElement('div'); body.className = 'control-settings-body';
  const note = document.createElement('p'); note.textContent = '點選動作後按新按鍵；同一按鍵不能分配兩個動作。DRS E、進站 B、地圖 M、鏡頭 C、暫停 Esc／P 等快捷鍵保留。';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.className = 'controls-status'; status.textContent = readControlPreferences().warning;
  const list = document.createElement('div'); list.className = 'control-key-list';
  const buttons = new Map<ControlAction, HTMLButtonElement>();
  let config = input.getControls(), capture: ControlAction | null = null, timer: ReturnType<typeof setTimeout> | undefined, generation = 0;
  const visible = () => section.open && !document.hidden && host.isConnected && host.getClientRects().length > 0;
  const stopCapture = () => { capture = null; clearTimeout(timer); refreshKeys(); };
  const refreshKeys = () => { for (const [action, button] of buttons) button.textContent = capture === action ? '請按新按鍵（Esc 取消）' : config.keys[action].map(controlCodeLabel).join(' ／ '); };
  const apply = (value: ControlPreferences) => {
    generation++;
    const next = parseControls(value); if (!next) { status.textContent = '設定無效，未套用。'; return; }
    config = next; input.setControls(next);
    status.textContent = storeControlPreferences(next) ? '操控設定已保存，單人與連線對戰共用。' : '本次設定已套用，但瀏覽器無法保存；重新載入後可能恢復原設定。';
    stopCapture(); syncPad();
  };
  for (const action of CONTROL_ACTIONS) {
    const label = document.createElement('label'); label.textContent = CONTROL_LABELS[action];
    const button = document.createElement('button'); button.type = 'button'; button.dataset.controlAction = action;
    button.setAttribute('aria-label', `重設${CONTROL_LABELS[action]}按鍵`);
    button.addEventListener('click', () => { generation++; stopCapture(); capture = action; refreshKeys(); status.textContent = '等待按鍵，10 秒後自動取消。'; timer = setTimeout(() => { stopCapture(); status.textContent = '已取消等待按鍵，設定未變。'; }, 10000); });
    buttons.set(action, button); label.appendChild(button); list.appendChild(label);
  }
  const onKey = (event: KeyboardEvent) => {
    if (!capture) return;
    if (!visible()) { stopCapture(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.code === 'Escape') { stopCapture(); status.textContent = '已取消，設定未變。'; return; }
    if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const result = rebindControl(config, capture, event.code);
    if (!result.ok) { status.textContent = result.message; return; }
    apply(result.config);
  };
  document.addEventListener('keydown', onKey, true);
  const onOutsideClick = (event: MouseEvent) => { if (event.target instanceof Node && !section.contains(event.target)) { generation++; stopCapture(); } };
  document.addEventListener('click', onOutsideClick, true);
  const onBlur = () => { generation++; if (capture) { stopCapture(); status.textContent = '畫面已離開，取消等待按鍵。'; } };
  addEventListener('blur', onBlur);
  const onHidden = () => { if (document.hidden) onBlur(); }; document.addEventListener('visibilitychange', onHidden);
  section.addEventListener('toggle', () => { if (!section.open) onBlur(); });
  const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.dataset.control = 'gamepad-enabled';
  const enabledLabel = document.createElement('label'); enabledLabel.textContent = '使用標準手把'; enabledLabel.appendChild(enabled);
  const inverse = document.createElement('input'); inverse.type = 'checkbox'; inverse.dataset.control = 'gamepad-inverted';
  const inverseLabel = document.createElement('label'); inverseLabel.textContent = '反轉手把左右轉向'; inverseLabel.appendChild(inverse);
  const deadzone = document.createElement('input'); deadzone.type = 'range'; deadzone.min = '0.05'; deadzone.max = '0.4'; deadzone.step = '0.01'; deadzone.dataset.control = 'gamepad-deadzone';
  const deadzoneLabel = document.createElement('label'); const deadzoneValue = document.createElement('output'); deadzoneLabel.append('搖桿死區 ', deadzoneValue, deadzone);
  const padState = document.createElement('p'); padState.className = 'controls-pad-status'; padState.setAttribute('aria-live', 'off');
  const padNote = document.createElement('p'); padNote.textContent = '左搖桿轉向；右扳機／下方按鈕為油門，左扳機／右方按鈕為煞車，左方按鈕甩尾。連接、返回遊戲或改設定後，先放開按鈕並讓搖桿回中才能駕駛。競速模式沿用自動油門。';
  const syncPad = () => { enabled.checked = config.gamepad.enabled; inverse.checked = config.gamepad.inverted; deadzone.value = String(config.gamepad.deadzone); deadzoneValue.textContent = `${Math.round(config.gamepad.deadzone * 100)}%`; };
  enabled.addEventListener('change', () => apply({ ...config, gamepad: { ...config.gamepad, enabled: enabled.checked } }));
  inverse.addEventListener('change', () => apply({ ...config, gamepad: { ...config.gamepad, inverted: inverse.checked } }));
  deadzone.addEventListener('input', () => apply({ ...config, gamepad: { ...config.gamepad, deadzone: Number(deadzone.value) } }));
  const actions = document.createElement('div'); actions.className = 'control-settings-actions';
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '還原預設操控'; reset.dataset.control = 'reset'; reset.addEventListener('click', () => apply(defaultControls()));
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = '匯出操控設定'; exportButton.dataset.control = 'export';
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
  const importButton = document.createElement('button'); importButton.type = 'button'; importButton.textContent = '匯入操控設定'; importButton.dataset.control = 'import';
  exportButton.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'taipei-gp-controls', version: 1, config }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'taipei-gp-controls.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '已送出操控設定下載；請確認瀏覽器下載結果。';
  });
  importButton.addEventListener('click', () => { generation++; stopCapture(); file.value = ''; file.click(); });
  file.addEventListener('change', async () => {
    const selected = file.files?.[0], current = ++generation; if (!selected) return;
    if (selected.size > 4096) { status.textContent = '操控設定檔過大，未套用。'; return; }
    try {
      const parsed = JSON.parse(await selected.text()); if (current !== generation || !visible()) return;
      const next = parsed?.app === 'taipei-gp-controls' && parsed.version === 1 ? parseControls(parsed.config) : null;
      if (!next) { status.textContent = '這不是有效的操控設定檔，未套用。'; return; }
      apply(next);
    } catch { if (current === generation) status.textContent = '無法讀取操控設定檔，未套用。'; }
  });
  const onStored = () => { generation++; stopCapture(); config = input.getControls(); refreshKeys(); syncPad(); };
  addEventListener('gp-controls-updated', onStored);
  const onStorage = (event: StorageEvent) => { if (event.key !== CONTROL_KEY && event.key !== null) return; generation++; stopCapture(); config = readControlPreferences().config; input.setControls(config); refreshKeys(); syncPad(); }; addEventListener('storage', onStorage);
  const live = setInterval(() => {
    if (!section.open || document.hidden) return;
    const pad = connectedStandardPad();
    padState.textContent = !config.gamepad.enabled ? '手把輸入已停用。' : !pad ? '未偵測到標準手把；連接後先輕按任一手把按鈕。' : `已偵測到標準手把 · 轉向 ${Math.round(padSteering(pad.axes[0], config.gamepad.deadzone) * (config.gamepad.inverted ? -1 : 1) * 100)}% · 開始駕駛前先回中並放開按鈕。`;
  }, 250);
  const cleanup = () => { generation++; stopCapture(); clearInterval(live); document.removeEventListener('keydown', onKey, true); document.removeEventListener('click', onOutsideClick, true); document.removeEventListener('visibilitychange', onHidden); removeEventListener('blur', onBlur); removeEventListener('storage', onStorage); removeEventListener('gp-controls-updated', onStored); removeEventListener('pagehide', onPageHide); };
  const onPageHide = (event: PageTransitionEvent) => { generation++; stopCapture(); input.release(); if (!event.persisted) cleanup(); };
  addEventListener('pagehide', onPageHide);
  actions.append(reset, exportButton, importButton, file); body.append(note, list, enabledLabel, inverseLabel, deadzoneLabel, padState, padNote, actions, status); section.append(title, body); host.appendChild(section);
  refreshKeys(); syncPad(); return cleanup;
}
