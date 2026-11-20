import { CONTROL_ACTIONS, CONTROL_KEY, connectedStandardPad, controlCodeLabel, isInteractiveTarget, type ControlAction, type ControlPreferences, type Input } from './input';

export type HintDevice = 'keyboard' | 'touch' | 'gamepad';
export type TouchSteering = 'buttons' | 'drag' | 'tilt';
export interface ControlHintState { device: HintDevice; controls: ControlPreferences; steering: TouchSteering; tiltInverted?: boolean }
const PAD_HINTS: Record<ControlAction, string> = {
  left: '左搖桿向左', right: '左搖桿向右', throttle: '右扳機／下方鍵', brake: '左扳機／右方鍵', handbrake: '左方鍵',
};
export function controlHint(state: ControlHintState, action: ControlAction): string {
  if (state.device === 'gamepad') return PAD_HINTS[state.controls.gamepad.inverted && (action === 'left' || action === 'right') ? action === 'left' ? 'right' : 'left' : action];
  if (state.device === 'keyboard') return state.controls.keys[action].map(controlCodeLabel).join('／');
  if (action === 'left' || action === 'right') {
    if (state.steering === 'tilt') return (action === 'left') !== !!state.tiltInverted ? '手機向左傾斜' : '手機向右傾斜';
    if (state.steering === 'drag') return action === 'left' ? '滑桿向左拖曳' : '滑桿向右拖曳';
    return action === 'left' ? '◀' : '▶';
  }
  return { throttle: '油門按鈕', brake: '煞車按鈕', handbrake: '🌀 按鈕' }[action];
}
export function drivingHint(state: ControlHintState, autoThrottle = false): string {
  const label = (action: ControlAction) => controlHint(state, action);
  return `${autoThrottle ? '自動油門' : `${label('throttle')} 油門`}；${label('left')}／${label('right')} 轉向；${label('brake')} 煞車${autoThrottle ? '' : '（停住再按可倒車）'}。`;
}
export function tutorialPages(state: ControlHintState): string[][] {
  const keys = state.device === 'keyboard', label = (action: ControlAction) => controlHint(state, action);
  return [
    ['🚗 開車', `${drivingHint(state)}${keys ? 'Esc 暫停。' : '右上 ❚❚ 暫停。'}${state.device === 'gamepad' ? '標準手把重新連接或回到駕駛時，先放開按鍵並讓搖桿回中。' : ''}`],
    ['📷 視角與地圖', `${keys ? 'C 切換車後／車內視角，M' : '點右上 📷 切換車後／車內視角，🗺'} 打開大地圖：點一下就能導航過去。右上 ⟲ 卡住時回到路上。`],
    ['📯 喇叭與甩尾', `${keys ? 'H' : '點 📯'} 按喇叭，前面的車會讓路。高速轉彎時按住 ${label('handbrake')} 甩尾，甩越久分數越高；撞到東西分數歸零。車子受損時停車可以 🔧 修車。`],
    ['🚨 小心警察', `撞車、撞人、闖紅燈會被通緝。離警車 110 m 以外撐 7 秒就甩掉，停在警車旁邊會被抓。開巡邏車${keys ? '按 G' : '點追緝按鈕'}可以追緝嫌犯。`],
    ['🏁 玩法', `路上的橘色光柱是街頭飆車挑戰${keys ? '（Enter 接受）' : ''}；選單還有計程車、街頭對決、正賽和計時賽。街道賽油門自動；正賽${keys ? ' Ctrl／E 開 DRS、B 進站' : '點 DRS 或進站按鈕'}。${state.device === 'gamepad' ? '手把功能鍵預設RB開DRS、LB進站、Y切鏡頭、Menu暫停，可在設定調整；選單用十字鍵、A確認／B返回。地圖仍可使用畫面按鈕。更換畫面先放開所有按鈕並回中立。' : ''}`],
  ];
}

/** Read-only presentation: never polls Input.read(), arms a controller, or changes bindings. */
export function mountControlHints(input: Pick<Input, 'getControls' | 'tilt' | 'tiltInvert'>, options: {
  multiplayer?: boolean; steering?: () => TouchSteering;
} = {}) {
  let device: HintDevice = document.documentElement.classList.contains('touch') ? 'touch' : 'keyboard';
  let fallback: HintDevice = device, focused = document.hasFocus(), disposed = false, suspended = false;
  let timer: ReturnType<typeof setInterval> | undefined, last = '', padIdentity = '', padValues = '';
  const subscribers = new Set<() => void>();
  const removers: (() => void)[] = [];
  const listen = (target: EventTarget, type: string, callback: EventListener) => {
    target.addEventListener(type, callback); removers.push(() => target.removeEventListener(type, callback));
  };
  const state = (): ControlHintState => ({ device, controls: input.getControls(), steering: options.steering?.() ?? (input.tilt ? 'tilt' : 'buttons'), tiltInverted: input.tiltInvert });
  const setText = (id: string, text: string) => { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
  const actionElements: [string, ControlAction, string][] = options.multiplayer
    ? [['mp-left', 'left', '左轉'], ['mp-right', 'right', '右轉'], ['mp-gas', 'throttle', '油門'], ['mp-brake', 'brake', '煞車']]
    : [['steer-l', 'left', '左轉'], ['steer-r', 'right', '右轉'], ['gas', 'throttle', '油門'], ['brake', 'brake', '煞車／倒車'], ['btn-drift', 'handbrake', '甩尾（按住）']];
  function render() {
    const current = state(), signature = JSON.stringify(current);
    if (signature === last) return;
    last = signature;
    setText('control-current-device', ({ keyboard: '鍵盤', touch: '觸控', gamepad: '標準手把' })[device]);
    setText('control-current-hint', drivingHint(current));
    setText('control-keyboard-hint', `${drivingHint({ ...current, device: 'keyboard' })} ${controlHint({ ...current, device: 'keyboard' }, 'handbrake')} 甩尾；Ctrl／E 開 DRS、B 進站、Esc 暫停。`);
    setText('control-touch-hint', `${drivingHint({ ...current, device: 'touch' })} 按住 🌀 甩尾。`);
    setText('mp-driving-hint', drivingHint(current, true));
    for (const [id, action, name] of actionElements) {
      const el = document.getElementById(id); if (!el) continue;
      const description = `${name}：${controlHint(current, action)}`;
      el.title = description; el.setAttribute('aria-label', description);
      if (device === 'keyboard') el.setAttribute('aria-keyshortcuts', current.controls.keys[action].map(code => ({ Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift' }[code] ?? code.replace(/^Key/, '').replace(/^Numpad/, 'Numpad'))).join(' '));
      else el.removeAttribute('aria-keyshortcuts');
    }
    for (const [id, name, shortcut] of [['btn-map', '大地圖', 'M'], ['btn-cam', '切換視角', 'C'], ['btn-pause', '暫停', 'Escape'], ['btn-horn', '喇叭', 'H']]) {
      const el = document.getElementById(id); if (!el) continue;
      el.title = `${name}${device === 'keyboard' ? `（${shortcut === 'Escape' ? 'Esc' : shortcut}）` : '（點選）'}`;
    }
    for (const subscriber of subscribers) subscriber();
  }
  function poll() {
    if (disposed || suspended || document.hidden || !focused) return;
    const config = input.getControls(), pad = config.gamepad.enabled ? connectedStandardPad() : null;
    const identity = pad ? `${pad.index}:${pad.mapping}` : '';
    const values = pad ? JSON.stringify([pad.axes[0], ...[0, 1, 2, 6, 7].map(i => [pad.buttons[i]?.pressed, pad.buttons[i]?.value])]) : '';
    const active = !!pad && (Math.abs(pad.axes[0] ?? 0) > config.gamepad.deadzone || [0, 1, 2, 6, 7].some(i => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) >= 0.4));
    if (identity && (identity !== padIdentity || active && values !== padValues)) device = 'gamepad';
    if (!identity && device === 'gamepad') device = fallback;
    padIdentity = identity; padValues = values; render();
  }
  function start() { if (!timer && !disposed && !suspended && !document.hidden && focused) timer = setInterval(poll, 250); }
  function stop() { if (timer !== undefined) clearInterval(timer); timer = undefined; }
  listen(window, 'keydown', event => {
    const e = event as KeyboardEvent;
    if (e.isComposing || e.metaKey || e.altKey || isInteractiveTarget(e.target)) return;
    const config = input.getControls();
    if (!CONTROL_ACTIONS.some(action => config.keys[action].includes(e.code)) && !['Escape', 'Enter', 'KeyB', 'KeyC', 'KeyE', 'KeyG', 'KeyH', 'KeyM', 'KeyP'].includes(e.code)) return;
    fallback = device = 'keyboard'; render();
  });
  listen(window, 'pointerdown', event => {
    if (!['touch', 'pen'].includes((event as PointerEvent).pointerType)) return;
    fallback = device = 'touch'; render();
  });
  listen(window, 'gp-controls-updated', () => poll());
  listen(window, 'storage', event => { const e = event as StorageEvent; if (e.key === CONTROL_KEY || e.key === null) poll(); });
  listen(window, 'gamepadconnected', () => poll());
  listen(window, 'gamepaddisconnected', () => poll());
  listen(window, 'blur', () => { focused = false; stop(); });
  listen(window, 'focus', () => { focused = true; poll(); start(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) stop(); else { poll(); start(); } });
  listen(window, 'pagehide', event => { if ((event as PageTransitionEvent).persisted) { suspended = true; stop(); } else dispose(); });
  listen(window, 'pageshow', () => { suspended = false; focused = document.hasFocus(); poll(); start(); });
  function dispose() { if (disposed) return; disposed = true; stop(); for (const remove of removers) remove(); subscribers.clear(); }
  // Initial render is independent of focus; polling pauses while another application has focus.
  render(); poll(); start();
  return { state, label: (action: ControlAction) => controlHint(state(), action), refresh: poll,
    subscribe(callback: () => void) { subscribers.add(callback); return () => subscribers.delete(callback); }, dispose };
}
