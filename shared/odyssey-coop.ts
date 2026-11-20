export const COOP_QUICK_PHRASES = { pickup: '我去取貨', wait: '請等我', handoff: '需要接貨', deliver: '我去送貨', help: '需要支援', thanks: '謝謝隊友' } as const;
export type CoopQuickPhrase = keyof typeof COOP_QUICK_PHRASES;
export const COOP_QUICK_MS = 20_000, COOP_QUICK_COOLDOWN_MS = 3_000, COOP_QUICK_LIMIT = 8;
export interface CoopQuick { id: string; from: string; to: string | null; cargoId: string | null; phrase: CoopQuickPhrase; createdAt: number; expiresAt: number; acks: string[] }
export function parseCoopQuick(raw: unknown, now: number, players: {id: string; connected: boolean}[], cargo: {id: string}[]): CoopQuick[] | null {
  if (!Array.isArray(raw) || raw.length > COOP_QUICK_LIMIT) return null;
  const result: CoopQuick[] = [], seen = new Set<string>();
  const connected = (id: unknown): id is string => typeof id === 'string' && players.some(p => p.id === id && p.connected);
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const m = value as Record<string, unknown>;
    if (typeof m.id !== 'string' || !/^[a-f0-9]{16}$/.test(m.id) || seen.has(m.id) || !connected(m.from) || !(m.to === null || connected(m.to) && m.to !== m.from) || !(m.cargoId === null || cargo.some(c => c.id === m.cargoId)) || typeof m.phrase !== 'string' || !Object.hasOwn(COOP_QUICK_PHRASES, m.phrase) || typeof m.createdAt !== 'number' || !Number.isFinite(m.createdAt) || m.createdAt > now || m.createdAt < now - COOP_QUICK_MS || m.expiresAt !== m.createdAt + COOP_QUICK_MS || Number(m.expiresAt) <= now || !Array.isArray(m.acks) || m.acks.length > 3 || new Set(m.acks).size !== m.acks.length || m.acks.some(id => !connected(id) || id === m.from || m.to !== null && id !== m.to)) return null;
    seen.add(m.id); result.push({ id: m.id, from: m.from, to: m.to as string | null, cargoId: m.cargoId as string | null, phrase: m.phrase as CoopQuickPhrase, createdAt: m.createdAt, expiresAt: Number(m.expiresAt), acks: [...m.acks] as string[] });
  }
  return result;
}
