/** 非同步裝置授權期間，只允許仍停留在原頁面的那一次接單／選賽。 */
export class CityEntryIntent {
  private intent: { owner: object } | null = null;
  get pending() { return this.intent !== null; }
  owns(owner: object | null) { return this.intent?.owner === owner; }
  invalidate() { this.intent = null; }
  begin(owner: object, valid: () => boolean) {
    if (this.intent) return null;
    const intent = this.intent = { owner };
    return {
      current: () => this.intent === intent && valid(),
      release: () => { if (this.intent === intent) this.intent = null; },
    };
  }
}
export function bindCityEntryCancellation(guard: CityEntryIntent, doc: Document, win: Window) {
  const interaction = (event: Event) => {
    const owner = (event.target as Element | null)?.closest?.('button, input, select, a') ?? null;
    if (!guard.owns(owner)) guard.invalidate();
  };
  doc.addEventListener('pointerdown', interaction, true);
  doc.addEventListener('click', interaction, true);
  doc.addEventListener('change', () => guard.invalidate(), true);
  doc.addEventListener('keydown', (event) => {
    if (['Escape', 'KeyP', 'KeyM'].includes(event.code)) guard.invalidate();
  }, true);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) guard.invalidate(); });
  win.addEventListener('pagehide', () => guard.invalidate());
}
