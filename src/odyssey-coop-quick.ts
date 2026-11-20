import type {CoopRoom} from '../shared/nexus-coop';
import {COOP_QUICK_PHRASES, COOP_QUICK_COOLDOWN_MS} from '../shared/odyssey-coop';
import './odyssey-network.css';
export function mountCoopQuick(host: HTMLElement, command: (type: 'quick' | 'ack-quick', fields: Record<string, unknown>) => void) {
  const root = document.createElement('section'); root.className = 'odyssey-quick'; root.id = 'odyssey-coop-quick'; root.setAttribute('aria-label', '合作快捷通訊');
  const heading = document.createElement('b'); heading.textContent = '隊友快捷通訊';
  function select(id: string, label: string) { const l = document.createElement('label'); l.textContent = label; const s = document.createElement('select'); s.id = id; l.append(s); root.append(l); return s; }
  root.append(heading);
  const to = select('odyssey-quick-to', '傳給 '), cargo = select('odyssey-quick-cargo', '相關貨單 ');
  const actions = document.createElement('div'), list = document.createElement('ol'), hint = document.createElement('p'); hint.id = 'odyssey-quick-hint'; hint.textContent = '固定短句每三秒一則、20秒到期。確認收到只表示已讀，不會自動領貨或交接。'; list.id = 'odyssey-quick-messages'; list.setAttribute('aria-label', '有效訊息與確認狀態'); root.append(actions, hint, list); host.append(root);
  let room: CoopRoom | null = null, self = '', available = false, key = '', listKey = '', runId = '', sentAt = -Infinity;
  const baseHint = hint.textContent;
  const buttons = Object.entries(COOP_QUICK_PHRASES).map(([phrase, label]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.phrase = phrase; b.textContent = label; b.onclick = () => { sentAt = performance.now(); command('quick', { phrase, to: to.value || null, cargoId: cargo.value || null }); }; actions.append(b); return b; });
  function options(s: HTMLSelectElement, rows: [string, string][]) { const old = s.value; s.replaceChildren(...rows.map(([value, label]) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; })); if (rows.some(r => r[0] === old)) s.value = old; }
  function update(value: CoopRoom | null, id: string, connected: boolean, busy: boolean) {
    room = value; self = id; available = connected && !busy && room?.phase === 'running'; root.hidden = !room;
    if (runId !== room?.runId) { runId = room?.runId ?? ''; sentAt = -Infinity; }
    const next = JSON.stringify([self, room?.runId, room?.players.map(p => [p.id, p.name, p.connected]), room?.cargo.map(c => [c.id, c.destination, c.state])]);
    if (next !== key) { key = next; options(to, [['', '所有隊友'], ...(room?.players.filter(p => p.id !== self && p.connected).map(p => [p.id, p.name] as [string, string]) ?? [])]); options(cargo, [['', '不指定'], ...(room?.cargo.filter(c => c.state !== 'delivered').map(c => [c.id, c.id] as [string, string]) ?? [])]); }
    const last = (room?.dispatch.quick ?? []).filter(q => q.from === self).reduce((n, q) => Math.max(n, q.createdAt), -Infinity), remaining = Math.max(0, COOP_QUICK_COOLDOWN_MS - (performance.now() - sentAt), room ? COOP_QUICK_COOLDOWN_MS - (room.serverTime - last) : 0), cooling = remaining > 0;
    hint.textContent = `${baseHint}${!connected ? ' 目前未連線。' : room?.phase !== 'running' ? ' 開始配送後可使用。' : cooling ? ` 可再發送：${Math.ceil(remaining / 1000)}秒。` : (room.dispatch.quick?.length ?? 0) >= 8 ? ' 目前8則已滿，請等待訊息到期。' : ''}`;
    buttons.forEach(b => { b.disabled = !available || cooling || (room?.dispatch.quick?.length ?? 0) >= 8; }); to.disabled = cargo.disabled = !available;
    const items = (room?.dispatch.quick ?? []).filter(q => q.to === null || q.to === self || q.from === self);
    const lk = JSON.stringify([available, self, items, room?.players.map(p => [p.id,p.name])]); if (lk === listKey) return; listKey = lk; list.replaceChildren();
    const name = (id: string) => room?.players.find(p => p.id === id)?.name ?? '隊友';
    for (const q of items) { const li = document.createElement('li'); li.textContent = `${name(q.from)} → ${q.to ? name(q.to) : '所有隊友'}：${COOP_QUICK_PHRASES[q.phrase]}${q.cargoId ? `（${q.cargoId}）` : ''} · ${q.acks.length ? `${q.acks.map(name).join('、')} 已確認` : '等待確認'} `;
      if (q.from !== self) { const b = document.createElement('button'); b.type = 'button'; b.textContent = q.acks.includes(self) ? '已確認收到' : '確認收到'; b.disabled = !available || q.acks.includes(self); b.onclick = () => command('ack-quick', { id: q.id }); li.append(b); } list.append(li);
    }
    if (!items.length) { const li = document.createElement('li'); li.textContent = '目前沒有有效訊息。'; list.append(li); }
  }
  return { root, update, dispose() { root.remove(); room = null; } };
}
