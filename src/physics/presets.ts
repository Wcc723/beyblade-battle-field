import type { BeybladeStats } from "./types";

/** 四種經典陀螺類型的屬性預設 */
export const STAT_PRESETS: Record<string, BeybladeStats> = {
  // 攻擊型：高攻擊、機動，靠撞擊與出界取勝（剋持久）
  attack: { attack: 1.55, defense: 0.8, stamina: 0.95, weight: 1.0 },
  // 防禦型：重、耐打、抗出界，攻擊偏低（剋攻擊）
  defense: { attack: 0.78, defense: 1.5, stamina: 0.98, weight: 1.5 },
  // 持久型：續航長但輕、怕被撞飛（剋防禦）
  stamina: { attack: 0.8, defense: 1.0, stamina: 1.25, weight: 0.88 },
  // 平衡型：四圍均衡、略高於 1（樣樣通、無明顯弱點）
  balance: { attack: 1.03, defense: 1.03, stamina: 1.03, weight: 1.03 },
};

export const PRESET_LABELS: Record<string, string> = {
  attack: "攻擊型",
  defense: "防禦型",
  stamina: "持久型",
  balance: "平衡型",
};
