/** 邀請只攜帶房碼；不複製部署工具、登入參數或網址片段。 */
const MAX_INVITE_URL_LENGTH = 8192;
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export type MultiplayerInviteResult =
  | { status: 'absent'; code: null }
  | { status: 'valid'; code: string }
  | { status: 'invalid'; code: null; message: string };

/** 只接受 ASCII 六碼；不讓 Unicode 大寫展開成另一個有效房碼。 */
export function normalizeMultiplayerRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[a-zA-Z2-9]{6}$/.test(text)) return null;
  const code = text.toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

function multiplayerPage(value: string): URL | null {
  if (typeof value !== 'string' || value.length > MAX_INVITE_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !url.pathname.endsWith('/multiplayer.html')) return null;
    return url;
  } catch { return null; }
}

/** 回傳預填建議，呼叫端仍須由玩家確認暱稱並按下加入，不自動入房。 */
export function parseMultiplayerInvite(pageUrl: string): MultiplayerInviteResult {
  const url = multiplayerPage(pageUrl);
  if (!url) return { status: 'invalid', code: null, message: '邀請連結無效，請手動輸入六碼房間碼。' };
  const rooms = [...url.searchParams.entries()].filter(([key]) => key.toLowerCase() === 'room');
  if (!rooms.length) return { status: 'absent', code: null };
  if (rooms.length !== 1) return { status: 'invalid', code: null, message: '邀請連結包含重複房間碼，請向朋友確認六碼房間碼。' };
  const [key, value] = rooms[0], code = normalizeMultiplayerRoomCode(value);
  if (key !== 'room' || !code) return { status: 'invalid', code: null, message: '邀請連結的房間碼格式不正確，請手動輸入六碼房間碼。' };
  return { status: 'valid', code };
}

/** 保留目前公開頁面的 origin/path，重建一份只有 room 參數的連結。 */
export function buildMultiplayerInviteUrl(pageUrl: string, value: unknown): string | null {
  const page = multiplayerPage(pageUrl), code = normalizeMultiplayerRoomCode(value);
  if (!page || !code) return null;
  const invite = new URL(page.origin + page.pathname);
  invite.searchParams.set('room', code);
  return invite.href;
}

export interface InviteDeliveryResult {
  status: 'copied' | 'shared' | 'cancelled' | 'manual' | 'invalid';
  message: string;
  url: string | null;
}
export interface InviteShareData { title: string; text: string; url: string }
function cleanInvite(value: string): string | null {
  const parsed = parseMultiplayerInvite(value);
  return parsed.status === 'valid' ? buildMultiplayerInviteUrl(value, parsed.code) : null;
}
const invalidDelivery = (): InviteDeliveryResult => ({ status: 'invalid', message: '邀請連結尚未就緒，請使用上方六碼房間碼。', url: null });

/** 由點擊事件傳入 clipboard 寫入函式；失敗時讓 UI 保留可選取連結。 */
export async function copyMultiplayerInvite(value: string, writeText?: (text: string) => Promise<void>): Promise<InviteDeliveryResult> {
  const url = cleanInvite(value);
  if (!url) return invalidDelivery();
  try {
    if (!writeText) throw new Error('Clipboard unavailable');
    await writeText(url);
    return { status: 'copied', message: '邀請連結已複製。朋友開啟後確認暱稱並按「加入房間」即可。', url };
  } catch {
    return { status: 'manual', message: '無法自動複製。請長按或選取下方邀請連結複製，也可傳送六碼房間碼。', url };
  }
}

/** 分享由玩家點擊觸發；取消不會再自動複製或開啟其他分享方式。 */
export async function shareMultiplayerInvite(value: string, share?: (data: InviteShareData) => Promise<void>): Promise<InviteDeliveryResult> {
  const url = cleanInvite(value);
  if (!url) return invalidDelivery();
  try {
    if (!share) throw new Error('Share unavailable');
    await share({ title: '台北街道賽｜私人房邀請', text: '一起加入私人房競速；開啟後確認暱稱並按「加入房間」。', url });
    return { status: 'shared', message: '已開啟分享；朋友開啟連結後仍需確認加入房間。', url };
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      return { status: 'cancelled', message: '已取消分享。仍可複製下方邀請連結或六碼房間碼。', url };
    }
    return { status: 'manual', message: '目前無法開啟分享。請選取下方邀請連結複製，或使用「複製邀請連結」。', url };
  }
}
