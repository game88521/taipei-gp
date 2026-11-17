import { CIRCUITS } from './circuits';
import { makeSeasonCalendar } from './season';
export type CalendarRead = { ok: true; calendar: number | string[]; custom: boolean } | { ok: false; error: string };
export function validateCustomCalendar(ids: readonly string[]): string | null {
  if (!ids.length || ids.length > CIRCUITS.length) return `請選擇 1～${CIRCUITS.length} 條大獎賽賽道。`;
  if (new Set(ids).size !== ids.length) return '同一賽道不能重複加入。';
  if (ids.some(id => !CIRCUITS.some(c => c.id === id))) return '賽曆包含無法使用的賽道。';
  return null;
}
export function mountSeasonEditor(host: HTMLElement) {
  const box = document.createElement('details'); box.className = 'feature-card'; box.id = 'season-calendar-editor';
  const title = document.createElement('summary'); title.textContent = '自訂賽季地圖與順序';
  const label = document.createElement('label'), enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.id = 'season-custom-enabled';
  label.append(enabled, ' 使用自訂賽曆');
  const note = document.createElement('p'); note.className = 'sub';
  note.textContent = '可選 1～23 條不同 GP 賽道並排序；整季開始後固定。獎金按站數／23 計算；自訂季不計完整賽季成就。預設賽季規則不變。';
  const controls = document.createElement('div'), select = document.createElement('select'), add = document.createElement('button');
  controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap'; select.id = 'season-add-circuit'; select.setAttribute('aria-label', '要加入的賽道'); select.style.cssText = 'min-height:44px;min-width:0;max-width:100%;flex:1';
  add.type = 'button'; add.id = 'season-add-map'; add.textContent = '加入賽道'; add.style.minHeight = '44px'; controls.append(select, add);
  const list = document.createElement('ol'); list.id = 'season-custom-order'; list.style.cssText = 'max-height:260px;overflow:auto;padding-left:24px';
  const status = document.createElement('p'); status.id = 'season-calendar-status'; status.className = 'sub'; status.setAttribute('aria-live', 'polite');
  let ids = makeSeasonCalendar(3);
  function render() {
    list.replaceChildren(); select.replaceChildren(); controls.hidden = list.hidden = !enabled.checked;
    for (const c of CIRCUITS.filter(c => !ids.includes(c.id))) { const option = document.createElement('option'); option.value = c.id; option.textContent = `${c.flag} ${c.gp}`; select.append(option); }
    add.disabled = select.disabled = !select.options.length;
    ids.forEach((id, i) => {
      const row = document.createElement('li'), name = document.createElement('span');
      row.dataset.circuit = id;
      name.textContent = `${CIRCUITS.find(c => c.id === id)?.gp ?? id} `; row.append(name);
      for (const [text, hint, action, disabled] of [
        ['↑', '往前移一站', () => { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; }, i === 0],
        ['↓', '往後移一站', () => { [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; }, i === ids.length - 1],
        ['移除', '移除此站', () => { ids.splice(i, 1); }, false],
      ] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.disabled = disabled;
        button.setAttribute('aria-label', `${name.textContent}${hint}`); button.style.cssText = 'min-width:44px;min-height:44px;margin:2px';
        button.addEventListener('click', () => { action(); render(); }); row.append(button);
      }
      list.append(row);
    });
    status.textContent = enabled.checked ? validateCustomCalendar(ids) ?? `自訂 ${ids.length} 站；獎金 ${ids.length}/23，完整賽季成就不適用。` : '使用上方選定的預設賽季長度。';
  }
  enabled.addEventListener('change', render); add.addEventListener('click', () => { if (select.value && !ids.includes(select.value)) ids.push(select.value); render(); });
  box.append(title, label, note, controls, list, status); host.append(box); render();
  return {
    element: box,
    reset(preset = 23) { enabled.checked = false; ids = makeSeasonCalendar(preset); box.open = false; render(); },
    readCalendar(preset: number): CalendarRead {
      if (!enabled.checked) return { ok: true, calendar: preset, custom: false };
      const error = validateCustomCalendar(ids); return error ? { ok: false, error } : { ok: true, calendar: [...ids], custom: true };
    },
  };
}
