import { SummitLazy } from './summit-lazy';
type WorkshopMount = typeof import('./nexus-workshop-ui').mountNexusWorkshop;
type CoopMount = typeof import('./nexus-coop-ui').mountNexusCoop;

function lazyCity<T extends object>(options: {
  id: string; text: string; insert(button: HTMLButtonElement): void;
  load(): Promise<(hooks: never) => T>; hooks: object; notify(message: string): void;
  fallback: Record<string, unknown>; prime?: () => void;
}): T {
  let mounted: T | null = null, disposed = false;
  const button = document.createElement('button'); button.type = 'button'; button.id = options.id;
  button.className = 'ghost-btn'; button.textContent = options.text; options.insert(button);
  const loader = new SummitLazy(options.load);
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ghost-btn'; cancel.textContent = '取消載入'; cancel.hidden = true; button.after(cancel);
  const refresh = () => { button.disabled = loader.loading; button.setAttribute('aria-busy', String(loader.loading)); button.textContent = loader.loading ? '正在載入…' : options.text; cancel.hidden = !loader.loading; };
  cancel.onclick = () => { loader.cancel(); refresh(); button.focus(); };
  const open = async () => {
    if (disposed || loader.loading) return;
    if (mounted) return (mounted as { open?: () => unknown }).open?.();
    options.prime?.();
    const job = loader.open(async mount => {
      if (disposed) return;
      button.remove(); cancel.remove(); mounted = mount(options.hooks as never);
      await (mounted as { open?: () => unknown }).open?.();
    });
    refresh(); await job; refresh();
    if (loader.error) { if (!mounted && !disposed) options.insert(button); options.notify(`功能載入失敗：${loader.error}。請再試一次。`); }
  };
  button.onclick = () => { void open(); };
  return new Proxy({} as T, { get(_target, key) {
    if (key === 'then') return undefined;
    if (key === 'lazyMetrics') return { attempts: loader.attempts, downloadMs: loader.downloadMs, mounted: !!mounted, loading: loader.loading };
    if (key === 'open') return open;
    if (['close','stop','leave','dispose'].includes(String(key))) return (...args: unknown[]) => {
      loader.cancel(); refresh(); if (key === 'dispose') { disposed = true; button.remove(); cancel.remove(); }
      const fn = mounted && Reflect.get(mounted, key); return typeof fn === 'function' ? fn.apply(mounted, args) : false;
    };
    if (mounted) { const value = Reflect.get(mounted, key); return typeof value === 'function' ? value.bind(mounted) : value; }
    if (key === 'busy') return loader.loading;
    return options.fallback[String(key)];
  }});
}

export const mountNexusWorkshop: WorkshopMount = hooks => {
  let prepared: Promise<boolean> | null = null;
  const originalPrepare = hooks.prepare.bind(hooks);
  const copy = { ...hooks, prepare: () => { const value = prepared; prepared = null; return value ?? originalPrepare(); } };
  return lazyCity<ReturnType<WorkshopMount>>({
    id: 'btn-nexus-workshop', text: '🛠 城市挑戰工坊：自訂賽道／分享挑戰', hooks: copy,
    insert: button => document.querySelector('.m-pane[data-pane="play"] .m-modes')?.after(button),
    load: async () => (await import('./nexus-workshop-ui')).mountNexusWorkshop,
    prime: () => { if (hooks.isCity && hooks.canEnter()) prepared ??= originalPrepare().catch(() => false); },
    notify: hooks.notify,
    fallback: { ownsDriving: false, visible: false, run: null, library: null, history: null, roads: null, route: null, vehicleId: null, refreshHud() {}, invalidate() {}, step() {}, navInfo: () => null },
  });
};
export const mountNexusCoop: CoopMount = hooks => lazyCity<ReturnType<CoopMount>>({
  id: 'btn-nexus-coop', text: '📦 城市合作配送 · 2～4人分工', hooks,
  insert: button => hooks.host.append(button), load: async () => (await import('./nexus-coop-ui')).mountNexusCoop,
  notify: hooks.notify, fallback: { active: false, opened: false, client: null, frame() {}, returnDepot() {} },
});
