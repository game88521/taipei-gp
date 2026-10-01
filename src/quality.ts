// 畫質等級：手機預設「中」，電腦預設「高」；開局太卡會自動降一級（main.ts）

export type Level = 'high' | 'medium' | 'low';

export interface Quality {
  level: Level;
  shadows: boolean;
  shadowSize: number; // 陰影貼圖解析度
  shadowRange: number; // 陰影涵蓋玩家周圍幾公尺
  bloom: boolean;
  bloomScale: number; // 光暈的解析度比例（越小越省）
  pixelRatio: number; // 上限
  traffic: number; // 車流台數
  peds: number; // 行人數
  fogFar: number;
  treeKeep: number; // 離賽道遠的樹保留比例
  parked: boolean; // 路邊停的機車
  rooftops: boolean; // 頂樓水塔、鐵皮加蓋
}

const TABLE: Record<Level, Omit<Quality, 'level'>> = {
  high: { shadows: true, shadowSize: 2048, shadowRange: 140, bloom: true, bloomScale: 1, pixelRatio: 1.75, traffic: 90, peds: 130, fogFar: 2400, treeKeep: 0.6, parked: true, rooftops: true },
  medium: { shadows: true, shadowSize: 1024, shadowRange: 100, bloom: true, bloomScale: 0.5, pixelRatio: 1.3, traffic: 55, peds: 70, fogFar: 1900, treeKeep: 0.35, parked: true, rooftops: true },
  low: { shadows: false, shadowSize: 512, shadowRange: 80, bloom: false, bloomScale: 0.5, pixelRatio: 1, traffic: 35, peds: 40, fogFar: 1300, treeKeep: 0.15, parked: false, rooftops: false },
};

export function qualityFor(level: Level): Quality {
  return { level, ...TABLE[level] };
}

export function defaultLevel(mobile: boolean): Level {
  return mobile ? 'medium' : 'high';
}

export const LOWER: Record<Level, Level> = { high: 'medium', medium: 'low', low: 'low' };
export const LEVEL_NAME: Record<Level, string> = { high: '高', medium: '中', low: '低' };
