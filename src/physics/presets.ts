import type { BeybladeStats } from "./types";

/**
 * 四種經典陀螺類型的屬性預設。
 * ⚠ 數值是與 DEFAULT_ARENA（hpBase/collisionSpinLoss/spinDecayBase）一起校的：
 * 各對局的「擊破所需時間」與「停轉時間」刻意拉開差距——差距收斂的快攻對局會大量同步雙亡（平手）。
 * 動任何一項後務必 `npm run balance` 驗證（勝率帶 45~55、猜拳三角、平手率）。
 */
export const STAT_PRESETS: Record<string, BeybladeStats> = {
  // 攻擊型：高攻擊、皮薄，靠快速擊破與撞出界取勝（剋持久；防禦型啃不動會被反殺）
  attack: { attack: 1.5, defense: 0.8, stamina: 0.95, weight: 1.0 },
  // 防禦型：重、超耐打、抗出界，攻擊極低（剋攻擊：扛住爆發後磨死對方）
  defense: { attack: 0.55, defense: 1.7, stamina: 0.98, weight: 1.35 },
  // 持久型：續航最長 + 高防低攻（剋防禦：防禦型在它停轉前先轉完）
  stamina: { attack: 0.6, defense: 1.8, stamina: 1.25, weight: 1.06 },
  // 平衡型：偏重偏防的萬金油（對攻擊五五開、小輸防禦、小贏持久）
  balance: { attack: 0.65, defense: 1.5, stamina: 1.05, weight: 1.26 },
};

export const PRESET_LABELS: Record<string, string> = {
  attack: "攻擊型",
  defense: "防禦型",
  stamina: "持久型",
  balance: "平衡型",
};
