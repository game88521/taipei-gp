// 引擎聲音色（public/engine-worklet.js 的參數）：每種引擎的汽缸數、點火順序、排氣管共鳴、怠速／紅線。
// 遊戲裡的 rpm 是 0~1 的比例（gearOf／carGear），這裡換算成真的轉速：idle + rpm × (redline − idle)

export interface EngineVoice {
  /** 每個汽缸的點火角度（0 ~ 720°，曲軸兩圈） */
  fire: number[];
  /** 每個汽缸屬於哪一排排氣（V 型引擎左右兩排；直列全部 0） */
  bank: number[];
  /** 兩排排氣管的音色差（共鳴頻率偏移比例） */
  bankMix: number;
  /** 燃燒的隨機程度：強弱、偶爾失火感（大排氣量、改裝車高） */
  rough: number;
  /** 排氣管兩個共鳴頻率（Hz）與 Q：管越長越低沉 */
  res1: number; res2: number; q1: number; q2: number;
  /** 一次燃燒脈衝的衰減時間（秒）：大缸徑長、高轉速引擎短 */
  decay: number;
  /** 脈衝裡噪音的比例（柴油的喀啦聲高） */
  noise: number;
  intake: number; mech: number;
  /** 放油回火的機率（0 = 不會） */
  backfire: number;
  /** 渦輪嘯聲音量（F1 混動） */
  turbo?: number;
  /** 怠速、紅線轉速 */
  idle: number; redline: number;
  /** 整體音量 */
  gain: number;
}

const evenFire = (n: number) => Array.from({ length: n }, (_, k) => (k * 720) / n);
const inline = (n: number) => Array.from({ length: n }, () => 0);

export const VOICES: Record<string, EngineVoice> = {
  // 一般轎車：直四，聲音乾淨、不大聲
  sedan: { fire: evenFire(4), bank: inline(4), bankMix: 0, rough: 0.1, res1: 150, res2: 460, q1: 3, q2: 2.5, decay: 0.0035, noise: 0.22, intake: 0.2, mech: 0.05, backfire: 0, idle: 800, redline: 6500, gain: 0.9 },
  // 計程車：一樣是直四，排氣管比較悶（原廠消音器）
  taxi: { fire: evenFire(4), bank: inline(4), bankMix: 0, rough: 0.12, res1: 130, res2: 400, q1: 3.2, q2: 2.6, decay: 0.0038, noise: 0.25, intake: 0.18, mech: 0.06, backfire: 0, idle: 750, redline: 6000, gain: 0.85 },
  // 美式肌肉車：cross-plane V8，點火順序 1-8-4-3-6-5-7-2，均勻 90°；左右排各自的排氣不均勻 → 招牌的「轟轟」
  muscle: { fire: evenFire(8), bank: [0, 1, 1, 0, 1, 0, 0, 1], bankMix: 0.06, rough: 0.22, res1: 90, res2: 300, q1: 4, q2: 3, decay: 0.0065, noise: 0.18, intake: 0.22, mech: 0.04, backfire: 1, idle: 700, redline: 6800, gain: 1.35 },
  // 巡邏車：也是 V8，但比較收斂（警用版的消音器）
  police: { fire: evenFire(8), bank: [0, 1, 1, 0, 1, 0, 0, 1], bankMix: 0.04, rough: 0.14, res1: 105, res2: 340, q1: 3.6, q2: 2.8, decay: 0.0055, noise: 0.18, intake: 0.2, mech: 0.05, backfire: 0.2, idle: 650, redline: 6200, gain: 1.15 },
  // 超跑：V12，十二缸均勻點火 → 圓滑高亢
  super: { fire: evenFire(12), bank: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], bankMix: 0.03, rough: 0.07, res1: 240, res2: 850, q1: 2.6, q2: 2, decay: 0.0026, noise: 0.14, intake: 0.16, mech: 0.08, backfire: 0.4, idle: 1000, redline: 8800, gain: 1.1 },
  // 發財車：柴油直四，低轉、喀啦喀啦（燃燒噪音多、粗糙）
  pickup: { fire: evenFire(4), bank: inline(4), bankMix: 0, rough: 0.28, res1: 110, res2: 360, q1: 2.2, q2: 2, decay: 0.006, noise: 0.55, intake: 0.12, mech: 0.12, backfire: 0, idle: 650, redline: 4200, gain: 1.05 },
  // F1：1.6 L V6 渦輪混動，15,000 rpm 紅線；高轉尖嘯＋渦輪嘯聲
  f1: { fire: evenFire(6), bank: [0, 1, 0, 1, 0, 1], bankMix: 0.02, rough: 0.05, res1: 420, res2: 1400, q1: 2, q2: 1.8, decay: 0.0015, noise: 0.1, intake: 0.1, mech: 0.1, backfire: 0, turbo: 0.06, idle: 4000, redline: 15000, gain: 0.95 },
  // 車流的一般小車（其他車用，比主角的轎車更遠、更悶）
  traffic: { fire: evenFire(4), bank: inline(4), bankMix: 0, rough: 0.14, res1: 140, res2: 420, q1: 3, q2: 2.5, decay: 0.004, noise: 0.25, intake: 0.18, mech: 0.05, backfire: 0, idle: 800, redline: 6000, gain: 0.8 },
  // 公車：柴油直六，低沉
  bus: { fire: evenFire(6), bank: inline(6), bankMix: 0, rough: 0.25, res1: 75, res2: 240, q1: 2.4, q2: 2, decay: 0.008, noise: 0.5, intake: 0.14, mech: 0.1, backfire: 0, idle: 600, redline: 2600, gain: 1.2 },
  // 機車：單缸，每兩圈只點火一次 → 「噗噗噗」
  scooter: { fire: [0], bank: [0], bankMix: 0, rough: 0.18, res1: 220, res2: 700, q1: 2.5, q2: 2, decay: 0.005, noise: 0.35, intake: 0.15, mech: 0.08, backfire: 0, idle: 1500, redline: 8500, gain: 0.7 },
};

/** 遊戲裡的 0~1 轉速比例 → 真實 rpm */
export const realRpm = (v: EngineVoice, frac: number) => v.idle + Math.max(0, Math.min(1.05, frac)) * (v.redline - v.idle);
