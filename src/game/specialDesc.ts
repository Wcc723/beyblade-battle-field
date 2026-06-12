/**
 * 必殺技顯示名與一句話描述（純模組：零 Env、零 DOM——worker 與前端皆可 import）。
 *
 * 文案承襲 useBattle.specialInfo 的觸發條件語彙改寫精煉：
 * 每招一句話講清楚「何時觸發 + 做什麼」；數值（機率/冷卻/次數）依設定浮動，
 * 不寫死在這裡——要看即時數值請用 specialInfo()。
 */

/** 必殺技識別子（"" ＝未裝備） */
export type SpecialDescKey = "" | "rush" | "blast" | "dash" | "vortex" | "clone";

export interface SpecialDesc {
  /** 顯示名（select 選項 / 標題用） */
  name: string;
  /** 一句話描述：觸發條件 + 效果 */
  desc: string;
}

/** select 選項固定順序（"" 在最前） */
export const SPECIAL_ORDER: readonly SpecialDescKey[] = ["", "rush", "blast", "dash", "vortex", "clone"];

export const SPECIAL_DESCS: Record<SpecialDescKey, SpecialDesc> = {
  "": {
    name: "（無）",
    desc: "不裝備必殺技，純靠基礎屬性與發射技巧作戰。",
  },
  rush: {
    name: "衝刺突進",
    desc: "逼近對手時機率引爆推進，瞬間加速衝撞並直接削減對手血量。",
  },
  blast: {
    name: "衝擊",
    desc: "打出夠猛的一擊時機率觸發，把對手轟飛並追加傷害，可順勢擊出場外。",
  },
  dash: {
    name: "高速移動",
    desc: "自旋偏低時機率觸發，瞬間加速並回復轉速與少量血量，絕境翻盤用。",
  },
  vortex: {
    name: "旋渦",
    desc: "對手進入範圍時機率展開旋渦，持續吸附並削減其轉速，發動期間自身更沉穩、不易被擊飛。",
  },
  clone: {
    name: "分身",
    desc: "對手進入範圍時機率召出分身連續衝撞，攻勢次數多但單發傷害低。",
  },
};

/** 安全查表：未知 key（不可信任來源）一律回落「（無）」 */
export function getSpecialDesc(kind: string): SpecialDesc {
  return SPECIAL_DESCS[kind as SpecialDescKey] ?? SPECIAL_DESCS[""];
}
