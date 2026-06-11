import type { BeybladeStats } from "./types";

/**
 * 四種經典陀螺類型的屬性預設。
 * ⚠ 數值是與 DEFAULT_ARENA（hpBase/collisionSpinLoss/spinDecayBase）與引擎的
 * 速度主導傷害分配（AGGRESSOR_DMG_SPLIT、SPLIT_IMPACT_MIN/FULL、DMG_RECV_SOFT）一起校的：
 * 同步雙 KO＝平手（不比超殺深度），靠「致命重擊天然不對稱 + 擊殺時間脫鉤」讓平手罕見。
 * 刀口參數（動了必重跑 `npm run balance`）：
 *  - defense.attack（防禦磨血 ko 攻擊型的窗口，0.50~0.60 區間勝率可大幅擺動）
 *  - attack.stamina（攻擊型的「保險絲」：防禦型熬過爆發靠它贏 → 直接控制 d→a 腿）
 *  - stamina.attack（壓低 = 持久型靠熬不靠殺；太高會在 split 加持下中期屠殺攻擊型）
 */
export const STAT_PRESETS: Record<string, BeybladeStats> = {
  // 攻擊型：高攻擊、皮薄、續航短（短跑手）：開場爆發擊破/撞出界，拖久必輸（剋持久；被防禦熬死）
  attack: { attack: 1.7, defense: 0.8, stamina: 0.82, weight: 1.0 },
  // 防禦型：重、超耐打、抗出界，攻擊低（剋攻擊：扛住爆發後磨死短續航的攻擊型）
  defense: { attack: 0.575, defense: 1.7, stamina: 0.98, weight: 1.4 },
  // 持久型：續航最長 + 高防低攻（剋防禦：防禦型在它停轉前先轉完；攻擊壓低＝靠熬不靠殺）
  stamina: { attack: 0.55, defense: 1.8, stamina: 1.25, weight: 1.06 },
  // 平衡型：偏重偏防的萬金油（對攻擊五五開、小輸防禦、小贏持久）
  balance: { attack: 0.65, defense: 1.5, stamina: 1.05, weight: 1.26 },
};

export const PRESET_LABELS: Record<string, string> = {
  attack: "攻擊型",
  defense: "防禦型",
  stamina: "持久型",
  balance: "平衡型",
};
