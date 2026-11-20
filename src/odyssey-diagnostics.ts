import { PROTOCOL_VERSION, PHYSICS_VERSION, CATALOG_STAMP } from '../shared/multiplayer-protocol';
import { COOP_VERSION } from '../shared/nexus-coop';
import { CITY_RACE_VERSION } from '../shared/summit-city-race';
import './odyssey-network.css';
const localProtocol = { version: PROTOCOL_VERSION, physics: PHYSICS_VERSION, catalogStamp: CATALOG_STAMP, coopVersion: COOP_VERSION, cityRaceVersion: CITY_RACE_VERSION };
export type DiagnosticCode = 'CONFIGURATION' | 'UNREADABLE' | 'SERVICE_HTTP' | 'ORIGIN_DENIED' | 'VERSION_MISMATCH' | 'WS_UNCONFIRMED' | 'PASS' | 'CANCELLED';
export interface DiagnosticReport { schema: 1; time: string; pageOrigin: string; serviceOrigin: string; code: DiagnosticCode; local: typeof localProtocol; remote?: typeof localProtocol }
export function diagnosticEndpoints(endpoint: string, secure: boolean) {
  try { const u = new URL(endpoint); if (!['ws:', 'wss:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || secure && u.protocol !== 'wss:') return null;
    u.pathname = '/ws'; const ws = u.href; u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; u.pathname = '/diagnostics'; return { http: u.href, ws, origin: u.origin };
  } catch { return null; }
}
export function parseDiagnostic(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>, p = v.protocol as Record<string, unknown> | undefined;
  if (v.schema !== 1 || v.status !== 'ok' || typeof v.originAllowed !== 'boolean' || !p || typeof p !== 'object' || Array.isArray(p) || !Number.isSafeInteger(p.version) || Number(p.version) < 1 || !Number.isSafeInteger(p.coopVersion) || Number(p.coopVersion) < 1 || !['physics', 'catalogStamp', 'cityRaceVersion'].every(k => typeof p[k] === 'string' && (p[k] as string).length > 0 && (p[k] as string).length <= 180)) return null;
  // Select known fields only; never export an untrusted body or arbitrary service text.
  return { allowed: v.originAllowed, protocol: { version: Number(p.version), physics: String(p.physics), catalogStamp: String(p.catalogStamp), coopVersion: Number(p.coopVersion), cityRaceVersion: String(p.cityRaceVersion) } };
}
const labels: Record<DiagnosticCode, string> = {
  CONFIGURATION: '對戰服務網址尚未設定或格式不符，請核對前端部署設定。', UNREADABLE: '未能讀取服務回應，原因尚未確認。可能仍在啟動，亦可能是網路、CORS 或舊版服務；稍後可重試。',
  SERVICE_HTTP: '服務已回應，但診斷介面尚未就緒或請求過多；請稍後再試並核對後端版本。', ORIGIN_DENIED: '服務可達；目前遊戲網址尚未獲後端放行。請將此頁的 Origin 加入服務設定後重新部署後端。', VERSION_MISMATCH: '服務可達，但前後端版本不一致，請同步更新前後端並重新載入。',
  WS_UNCONFIRMED: '診斷介面可達、來源及版本相符，但 WebSocket 尚未確認；可能是網路或服務負載，不能據此判定為 403。', PASS: '來源獲放行、前後端版本相符，WebSocket 握手成功。此檢查未建立房間，實際雙人賽仍需另行確認。', CANCELLED: '已取消診斷。',
};
export async function runDiagnostic(endpoint: string, pageOrigin: string, signal: AbortSignal): Promise<DiagnosticReport> {
  const urls = diagnosticEndpoints(endpoint, pageOrigin.startsWith('https:'));
  const report: DiagnosticReport = { schema: 1, time: new Date().toISOString(), pageOrigin, serviceOrigin: urls?.origin ?? '', code: 'CONFIGURATION', local: { ...localProtocol } };
  if (!urls) return report;
  if (signal.aborted) return { ...report, code: 'CANCELLED' };
  try {
    const response = await fetch(urls.http, { signal, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) return { ...report, code: 'SERVICE_HTTP' };
    const text = await response.text(); if (text.length > 4096) return { ...report, code: 'SERVICE_HTTP' };
    const parsed = parseDiagnostic(JSON.parse(text)); if (!parsed) return { ...report, code: 'SERVICE_HTTP' };
    report.remote = parsed.protocol;
    if (!parsed.allowed) return { ...report, code: 'ORIGIN_DENIED' };
    if (Object.keys(localProtocol).some(k => parsed.protocol[k as keyof typeof localProtocol] !== localProtocol[k as keyof typeof localProtocol])) return { ...report, code: 'VERSION_MISMATCH' };
    report.code = 'WS_UNCONFIRMED';
    const okay = await new Promise<boolean>(resolve => {
      let ws: WebSocket | null = null, done = false;
      const finish = (pass: boolean) => { if (done) return; done = true; signal.removeEventListener('abort', aborted); if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} } resolve(pass); };
      const aborted = () => finish(false); signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) { finish(false); return; }
      try { const sentAt = Date.now(); ws = new WebSocket(urls.ws); ws.onopen = () => ws?.send(JSON.stringify({ type: 'ping', sentAt })); ws.onerror = ws.onclose = () => finish(false); ws.onmessage = e => { if (typeof e.data !== 'string' || e.data.length > 4096) { finish(false); return; } try { const m = JSON.parse(e.data); finish(m.type === 'pong' && m.sentAt === sentAt && Number.isFinite(m.serverTime)); } catch { finish(false); } }; } catch { finish(false); }
    });
    return { ...report, code: signal.aborted ? 'CANCELLED' : okay ? 'PASS' : 'WS_UNCONFIRMED' };
  } catch { return { ...report, code: signal.aborted ? 'CANCELLED' : 'UNREADABLE' }; }
}
export function mountDiagnostics(host: HTMLElement, endpoint: string, id: string) {
  const root = document.createElement('details'); root.id = id; root.className = 'odyssey-diagnostics';
  const summary = document.createElement('summary'); summary.textContent = '連線自助診斷';
  const note = document.createElement('p'); note.textContent = '按下才檢查，最多等待8秒；不會建立房間。診斷檔不含暱稱、房碼或續接憑證。';
  const status = document.createElement('p'); status.id = `${id}-status`; status.setAttribute('role', 'status');
  const check = document.createElement('button'); check.type = 'button'; check.id = `${id}-check`; check.textContent = '開始檢查';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消檢查'; cancel.id = `${id}-cancel`; cancel.hidden = true;
  const save = document.createElement('button'); save.type = 'button'; save.id = `${id}-save`; save.textContent = '下載診斷結果'; save.disabled = true;
  root.append(summary, note, check, cancel, save, status); host.append(root);
  let controller: AbortController | null = null, disposed = false, report: DiagnosticReport | null = null;
  check.onclick = async () => { if (controller || disposed) return; const own = new AbortController(); controller = own; check.disabled = true; save.disabled = true; cancel.hidden = false; status.textContent = '正在檢查服務與版本…'; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; own.abort(); }, 8000);
    try { const result = await runDiagnostic(endpoint, location.origin, own.signal); if (disposed) return; if (timedOut && result.code === 'CANCELLED') result.code = result.remote ? 'WS_UNCONFIRMED' : 'UNREADABLE'; report = result; status.textContent = labels[result.code]; save.disabled = false; }
    finally { clearTimeout(timer); if (controller === own) controller = null; if (!disposed) { check.disabled = false; cancel.hidden = true; } }
  };
  cancel.onclick = () => controller?.abort();
  save.onclick = () => { if (!report) return; const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'taipei-gp-connection-diagnostic.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return { cancel() { controller?.abort(); }, dispose() { disposed = true; controller?.abort(); root.remove(); } };
}
