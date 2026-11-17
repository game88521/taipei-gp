export type NoticeRect = { left: number; top: number; width: number; height: number };
const area = (a: NoticeRect, b: NoticeRect, gap: number) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width + gap) - Math.max(a.left, b.left - gap)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height + gap) - Math.max(a.top, b.top - gap));

/** Keep a driving warning inside the viewport and away from visible panels. */
export function placeHudNotice(width: number, height: number, size: { width: number; height: number }, obstacles: NoticeRect[]): NoticeRect {
  const w = Math.max(1, Number.isFinite(width) ? width : 1), h = Math.max(1, Number.isFinite(height) ? height : 1);
  const inset = Math.min(8, w / 4, h / 4), gap = 8;
  const rw = Math.min(Math.max(1, size.width || 1), w - inset * 2), rh = Math.min(Math.max(1, size.height || 1), h - inset * 2);
  const px = (w - rw) / 2, py = h * .46;
  const clean = obstacles.filter(r => [r.left, r.top, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0);
  const xs = [px, inset, w - rw - inset, ...clean.flatMap(r => [r.left - rw - gap, r.left + r.width + gap])];
  const ys = [py, inset, h - rh - inset, ...clean.flatMap(r => [r.top - rh - gap, r.top + r.height + gap])];
  let best: NoticeRect = { left: inset, top: inset, width: rw, height: rh }, bestScore = Infinity;
  for (const x of xs) for (const y of ys) {
    const r = { left: Math.max(inset, Math.min(w - rw - inset, x)), top: Math.max(inset, Math.min(h - rh - inset, y)), width: rw, height: rh };
    const overlap = clean.reduce((n, obstacle) => n + area(r, obstacle, gap), 0);
    const score = overlap * (w * w + h * h + 1) + (r.left - px) ** 2 + (r.top - py) ** 2;
    if (score < bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/** Runs on changes and resize, never as part of simulation or every rendered frame. */
export function mountHudNotices(hud: HTMLElement, warning: HTMLElement, strategy: HTMLElement, rotate: HTMLElement) {
  let pending = 0, disposed = false;
  const panels = [strategy, rotate, ...hud.querySelectorAll<HTMLElement>('#pad, #steer-btns, #brake, #drs, #pit, .tl, .tc, .tr, .gp-panel, .speedo, #minimap, #tyre, #batt, #radio, #pit-tyre, #drs-ind')];
  const reset = () => { for (const property of ['position', 'left', 'top', 'transform', 'max-width']) warning.style.removeProperty(property); };
  const update = () => {
    pending = 0;
    if (disposed) return;
    if (hud.dataset.mode !== 'race' || hud.dataset.kind !== 'gp' || !warning.classList.contains('show') || !warning.getClientRects().length) { reset(); return; }
    const viewport = window.visualViewport;
    const offsetLeft = viewport?.offsetLeft ?? 0, offsetTop = viewport?.offsetTop ?? 0;
    const obstacles: NoticeRect[] = [];
    for (const element of panels) {
      const style = getComputedStyle(element), r = element.getBoundingClientRect();
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && r.width && r.height) obstacles.push({ left: r.left - offsetLeft, top: r.top - offsetTop, width: r.width, height: r.height });
    }
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    warning.style.maxWidth = `${Math.max(1, width - 16)}px`;
    const size = warning.getBoundingClientRect(), r = placeHudNotice(width, height, size, obstacles);
    warning.style.position = 'fixed'; warning.style.transform = 'none';
    warning.style.left = `${r.left + offsetLeft}px`;
    warning.style.top = `${r.top + offsetTop}px`;
  };
  const schedule = () => { if (!pending && !disposed) pending = requestAnimationFrame(update); };
  const mutation = new MutationObserver(schedule);
  mutation.observe(warning, { attributes: true, attributeFilter: ['class'], childList: true });
  mutation.observe(hud, { attributes: true, attributeFilter: ['class', 'data-mode', 'data-kind'] });
  mutation.observe(strategy, { attributes: true, attributeFilter: ['open'] });
  const resize = new ResizeObserver(schedule);
  for (const element of [warning, ...panels]) resize.observe(element);
  addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
  schedule();
  return { refresh: schedule, dispose() { disposed = true; if (pending) cancelAnimationFrame(pending); mutation.disconnect(); resize.disconnect(); removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); reset(); } };
}
