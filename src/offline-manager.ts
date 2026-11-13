import type { TileIndex } from './citydata';

export interface OfflineTile { url: string; bytes: number; sha256: string }
export interface OfflineRegion { id: string; name: string; tiles: OfflineTile[] }
export interface OfflineRegionState { id: string; name: string; total: number; cached: number; bytes: number; cachedBytes: number }
export interface OfflineProgress { done: number; total: number; downloadedBytes: number; current: string }
interface TileIntegrity { files: Record<string, { bytes: number; sha256: string }> }
interface OfflineDependencies {
  fetch: typeof fetch;
  digest: (bytes: ArrayBuffer) => Promise<string>;
  isCurrent?: () => boolean;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  requestTimeoutMs?: number;
}
const READY = '/__taipei-gp-offline-ready__';
const hexDigest = async (bytes: ArrayBuffer): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function abortError() { return new DOMException('下載已取消，已完成的區塊仍保留。', 'AbortError'); }

/** 依目前版本 city.json 的座標切九區；名稱只表示地圖方位，不假設行政區邊界。 */
export function offlineRegions(index: TileIndex, integrity: unknown): OfflineRegion[] {
  if (!index || !Array.isArray(index.list) || index.list.length > 2000 || index.list.length === 0 || !Number.isFinite(index.size) || index.size <= 0) throw new Error('離線區塊索引無效。');
  if (!integrity || typeof integrity !== 'object' || !(integrity as TileIntegrity).files) throw new Error('本版本缺少區塊驗證資料，請連線更新後重新載入。');
  const files = (integrity as TileIntegrity).files;
  for (const tile of index.list) if (!Array.isArray(tile) || tile.length < 3 || !Number.isSafeInteger(tile[0]) || !Number.isSafeInteger(tile[1]) || !Number.isSafeInteger(tile[2]) || tile[2] <= 0 || tile[2] > 20_000_000) throw new Error('離線區塊索引無效。');
  const xs = index.list.map((t) => t[0]), zs = index.list.map((t) => t[1]);
  const minX = Math.min(...xs), spanX = Math.max(...xs) - minX + 1, minZ = Math.min(...zs), spanZ = Math.max(...zs) - minZ + 1;
  const groups = new Map<string, OfflineRegion>(), seen = new Set<string>();
  for (const [x, z] of index.list) {
    const col = Math.min(2, Math.floor((x - minX) * 3 / spanX)), row = Math.min(2, Math.floor((z - minZ) * 3 / spanZ));
    const id = `${row}-${col}`, name = `${['北部', '中部', '南部'][row]}${['西區', '中區', '東區'][col]}`, url = `/data/tiles/${x}_${z}.json`, file = files[url];
    // city.tiles 第三值是舊工具的 json.length（UTF-16字元數）；含中文字時不等於下載位元組。
    // 真正大小與完整性一律以本版預快取的 SHA256 manifest 為準。
    if (seen.has(url) || !file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 20_000_000 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('本版本的區塊驗證資料不完整，請連線更新後重新載入。');
    seen.add(url);
    const group = groups.get(id) ?? { id, name, tiles: [] };
    group.tiles.push({ url, bytes: file.bytes, sha256: file.sha256 }); groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** cache 僅可來自目前 controller 的 READY 版本；刪除限索引內 tiles，不觸碰核心、上一版或玩家存檔。 */
export class OfflineRegionManager {
  private controller: AbortController | null = null;
  private deleting = false;
  constructor(readonly regions: OfflineRegion[], private cache: Cache, private deps: OfflineDependencies) {}
  get busy() { return this.controller !== null || this.deleting; }
  get downloading() { return this.controller !== null; }
  cancel() { this.controller?.abort(); }
  private assertCurrent() { if (this.deps.isCurrent && !this.deps.isCurrent()) throw new Error('離線版本已更新，請重新載入後管理區域。'); }
  private selected(ids: readonly string[]) {
    const wanted = new Set(ids);
    return this.regions.filter((r) => wanted.has(r.id)).flatMap((r) => r.tiles);
  }
  private async verified(tile: OfflineTile) {
    const response = await this.cache.match(tile.url, { ignoreSearch: true });
    if (!response?.ok) return false;
    try { const body = await response.arrayBuffer(); return body.byteLength === tile.bytes && await this.deps.digest(body) === tile.sha256; }
    catch { return false; }
  }
  async snapshot(): Promise<OfflineRegionState[]> {
    this.assertCurrent();
    const rows = await Promise.all(this.regions.map(async (r) => {
      const valid = await Promise.all(r.tiles.map((t) => this.verified(t)));
      return { id: r.id, name: r.name, total: r.tiles.length, cached: valid.filter(Boolean).length, bytes: r.tiles.reduce((n, t) => n + t.bytes, 0), cachedBytes: r.tiles.reduce((n, t, i) => n + (valid[i] ? t.bytes : 0), 0) };
    }));
    this.assertCurrent(); return rows;
  }
  private async fetchBytes(tile: OfflineTile, signal: AbortSignal): Promise<ArrayBuffer> {
    const transfer = new AbortController();
    let stop!: () => void, timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      stop = () => { transfer.abort(); reject(abortError()); };
      signal.addEventListener('abort', stop, { once: true });
      timer = setTimeout(() => { transfer.abort(); reject(new Error('區塊下載逾時，已完成的區塊仍保留。請稍後重試。')); }, this.deps.requestTimeoutMs ?? 30000);
    });
    try {
      if (signal.aborted) throw abortError();
      return await Promise.race([interrupted, (async () => {
        const response = await this.deps.fetch(tile.url, { signal: transfer.signal, cache: 'no-store', headers: { 'X-Taipei-GP-Offline-Download': '1' } });
        if (!response.ok) throw new Error(`區塊下載失敗（HTTP ${response.status}），已完成的區塊仍保留。`);
        return response.arrayBuffer();
      })()]);
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
  }
  async download(ids: readonly string[], progress: (state: OfflineProgress) => void = () => {}): Promise<{ downloaded: number; cancelled: boolean }> {
    if (this.busy) throw new Error('請先等待目前操作完成。');
    this.assertCurrent();
    const controller = new AbortController(); this.controller = controller;
    let downloaded = 0, downloadedBytes = 0;
    try {
      const tiles: OfflineTile[] = [];
      for (const tile of this.selected(ids)) {
        if (controller.signal.aborted) throw abortError();
        if (!(await this.verified(tile))) tiles.push(tile);
      }
      const estimate = await this.deps.estimate?.().catch(() => undefined), needed = tiles.reduce((n, t) => n + t.bytes, 0);
      if (estimate?.quota != null && estimate.usage != null && estimate.quota - estimate.usage < needed * 1.15) throw new Error(`儲存空間不足，選區約需 ${mb(needed)}。請先刪除不需要的區域。`);
      for (const tile of tiles) {
        this.assertCurrent();
        if (controller.signal.aborted) throw abortError();
        progress({ done: downloaded, total: tiles.length, downloadedBytes, current: tile.url });
        const body = await this.fetchBytes(tile, controller.signal);
        if (controller.signal.aborted) throw abortError();
        if (body.byteLength !== tile.bytes || await this.deps.digest(body) !== tile.sha256) throw new Error('區塊版本與本頁不一致，尚未存入。請更新並重新載入後重試。');
        this.assertCurrent();
        if (controller.signal.aborted) throw abortError();
        await this.cache.put(tile.url, new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        downloaded++; downloadedBytes += tile.bytes;
        progress({ done: downloaded, total: tiles.length, downloadedBytes, current: tile.url });
      }
      return { downloaded, cancelled: controller.signal.aborted };
    } catch (error) {
      if (controller.signal.aborted) return { downloaded, cancelled: true };
      if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') throw new Error('瀏覽器儲存空間不足，已完成的區塊仍保留。請先刪除不需要的區域。');
      throw error;
    } finally { if (this.controller === controller) this.controller = null; }
  }
  async remove(ids: readonly string[]): Promise<number> {
    if (this.busy) throw new Error('請先取消下載並等待目前操作完成。');
    this.assertCurrent(); this.deleting = true;
    try {
      let removed = 0;
      for (const tile of this.selected(ids)) { this.assertCurrent(); if (await this.cache.delete(tile.url, { ignoreSearch: true })) removed++; }
      return removed;
    } finally { this.deleting = false; }
  }
}

export async function currentOfflineVersion(worker: ServiceWorker): Promise<{ cache: string; version: string }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('目前離線版本尚未支援區域管理，請連線更新並重新載入。')); }, 2500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer); channel.port1.close();
      const data = event.data;
      if (data?.type === 'taipei-gp-offline-version' && data.ready === true && typeof data.version === 'string' && /^[a-f0-9]{12}$/.test(data.version) && data.cache === `taipei-gp-${data.version}`) resolve({ cache: data.cache, version: data.version });
      else reject(new Error('離線核心資料尚未完成，請先連線更新。'));
    };
    try { worker.postMessage({ type: 'taipei-gp-offline-version' }, [channel.port2]); }
    catch (error) { clearTimeout(timer); channel.port1.close(); reject(error); }
  });
}

export function mountOfflineManager(container: HTMLElement): () => void {
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = document.createElement('div'), controls = document.createElement('div'), capacity = document.createElement('p');
  const action = (label: string) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; controls.append(b); return b; };
  const refresh = action('重新整理'), all = action('選取全部'), download = action('下載選區'), cancel = action('取消下載'), remove = action('刪除選區');
  container.replaceChildren(status, list, controls, capacity);
  let manager: OfflineRegionManager | null = null, worker: ServiceWorker | null = null, disposed = false, loading = false;
  const selected = new Set<string>();
  const buttons = () => {
    const busy = loading || !!manager?.busy, usable = !!manager && !!worker && navigator.serviceWorker.controller === worker;
    download.disabled = remove.disabled = !usable || busy || selected.size === 0;
    refresh.disabled = busy; all.disabled = busy || !usable;
    cancel.disabled = !manager?.downloading || loading;
    for (const input of list.querySelectorAll('input')) input.disabled = busy;
  };
  const render = async () => {
    if (!manager || disposed) return;
    const rows = await manager.snapshot();
    if (disposed) return;
    list.replaceChildren();
    for (const row of rows) {
      const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(row.id);
      check.addEventListener('change', () => { if (check.checked) selected.add(row.id); else selected.delete(row.id); buttons(); });
      label.append(check, document.createTextNode(` ${row.name}：已驗證 ${row.cached}/${row.total} 塊，${mb(row.cachedBytes)} / ${mb(row.bytes)}`));
      label.style.display = 'block'; list.append(label);
    }
    const cacheBytes = rows.reduce((n, r) => n + r.cachedBytes, 0), totalBytes = rows.reduce((n, r) => n + r.bytes, 0);
    let suffix = '；瀏覽器可能自動清理快取，出發前可重新確認。';
    try { const e = await navigator.storage?.estimate?.(); if (e?.quota != null && e.usage != null) suffix = `；本站共用空間已用 ${mb(e.usage)} / ${mb(e.quota)}。`; } catch { /* 仍顯示已知區塊大小 */ }
    capacity.textContent = `本版地圖 ${mb(cacheBytes)} / ${mb(totalBytes)}${suffix}區域只含城市建築、樹木與路邊機車；離線核心及道路另由遊戲保存。`;
    buttons();
  };
  const initialize = async () => {
    if (loading || manager?.busy || disposed) return;
    loading = true; buttons(); status.textContent = '正在確認本版離線區域…';
    try {
      if (!('caches' in window) || !navigator.serviceWorker || !crypto.subtle) throw new Error('此瀏覽器未提供離線快取或資料驗證功能。');
      worker = navigator.serviceWorker.controller;
      if (!worker) throw new Error('離線核心尚未啟用，請先連線開啟遊戲，再重新載入。');
      const owner = worker, version = await currentOfflineVersion(owner);
      if (!(await caches.keys()).includes(version.cache)) throw new Error('本版離線快取尚未完成。');
      const cache = await caches.open(version.cache);
      if (!(await cache.match(READY))) throw new Error('本版離線核心尚未完成。');
      const [city, hashes] = await Promise.all([cache.match('/data/city.json'), cache.match('/data/offline-tiles.json')]);
      if (!city || !hashes) throw new Error('本版缺少離線區域清單，請連線更新並重新載入。');
      const regions = offlineRegions((await city.json()).tiles, await hashes.json());
      manager = new OfflineRegionManager(regions, cache, { fetch: window.fetch.bind(window), digest: hexDigest, isCurrent: () => navigator.serviceWorker.controller === owner, estimate: async () => navigator.storage?.estimate ? navigator.storage.estimate() : {} });
      await render(); status.textContent = '請選擇要離線使用的地圖區域。刪除只移除所選區塊，保留核心與遊戲進度。';
    } catch (error) { manager = null; list.replaceChildren(); status.textContent = errorText(error); }
    finally { loading = false; buttons(); }
  };
  refresh.addEventListener('click', () => { void initialize(); });
  all.addEventListener('click', () => { for (const region of manager?.regions ?? []) selected.add(region.id); void render().catch((error) => { status.textContent = errorText(error); }); });
  cancel.addEventListener('click', () => { manager?.cancel(); status.textContent = '正在取消下載，已完成的區塊仍保留。'; });
  download.addEventListener('click', async () => {
    if (!manager) return;
    const active = manager;
    try {
      const task = active.download([...selected], (p) => { status.textContent = `正在下載 ${p.done}/${p.total} 塊，已完成 ${mb(p.downloadedBytes)}…`; buttons(); });
      buttons(); const result = await task;
      status.textContent = result.cancelled ? `已取消，本次已完成 ${result.downloaded} 塊。` : `下載完成，本次新增 ${result.downloaded} 塊。`;
    } catch (error) { status.textContent = errorText(error); }
    finally { try { await render(); } catch (error) { status.textContent = errorText(error); } buttons(); }
  });
  remove.addEventListener('click', async () => {
    if (!manager || !confirm('刪除所選地圖區域的離線資料？再次連線行經這裡時會重新下載。遊戲進度及離線核心會保留。')) return;
    try { const task = manager.remove([...selected]); buttons(); status.textContent = `已刪除 ${await task} 塊離線地圖資料。`; }
    catch (error) { status.textContent = errorText(error); }
    finally { try { await render(); } catch (error) { status.textContent = errorText(error); } buttons(); }
  });
  const changed = () => { manager?.cancel(); status.textContent = '離線版本已更新，請重新載入後確認區域狀態。'; buttons(); };
  navigator.serviceWorker?.addEventListener('controllerchange', changed);
  const hide = () => manager?.cancel(); window.addEventListener('pagehide', hide);
  buttons(); void initialize();
  return () => { disposed = true; manager?.cancel(); navigator.serviceWorker?.removeEventListener('controllerchange', changed); window.removeEventListener('pagehide', hide); };
}
