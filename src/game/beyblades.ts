/**
 * 陀螺名冊（純模組：零 Env、零 DOM——worker 與前端共用）。
 *
 * - BEYBLADES：全服固定 roster（id/name 永不可變，受 test/beyblades.test.ts 凍結鎖保護）。
 * - 名字取自 names.ts 的 BEYBLADE_POOL 風格（硬編碼、不 import pool——roster 是獨立真相，
 *   pool 凍結不動）；嚴禁任何官方戰鬥陀螺詞彙。
 * - mods 是「乘在類型基礎屬性上」的小幅個體差（0.92~1.08）：同類型兩顆要有手感差，
 *   不可有全維度優勢顆（高 crit 配低 specialPower 之類的取捨）。
 * - 數值（mods/crit/specialPower）可調平衡，不入凍結鎖；id/name 入鎖。
 */
import type { BeybladeStats } from "../physics/types";

export interface BeyDef {
  /** 穩定識別子（kebab-case，存 DB/協定用，永不改） */
  id: string;
  /** 中二名（固定、不可因部署變動） */
  name: string;
  type: "attack" | "defense" | "stamina" | "balance";
  /** 乘在類型基礎屬性上的個體差（缺欄 = 1；範圍 0.92~1.08） */
  mods: { attack?: number; defense?: number; stamina?: number; weight?: number };
  /** 會心機率（絕對值；基準 0.05、roster 範圍 0.03~0.08） */
  crit: number;
  /** 必殺強度（1.0 基準、範圍 0.9~1.2）：冷卻×(2-s)、必殺傷害×s */
  specialPower: number;
}

/** 全服固定名冊：每類型至少 2 顆（現行 攻3 / 防3 / 持2 / 平2） */
export const BEYBLADES: readonly BeyDef[] = [
  // --- 攻擊型 ---
  {
    // 玻璃大砲：火力最高、皮最薄，必殺也兇
    id: "scarlet-blaze-wheel",
    name: "赤霄焚輪",
    type: "attack",
    mods: { attack: 1.08, defense: 0.93 },
    crit: 0.05,
    specialPower: 1.1,
  },
  {
    // 會心刺客：全 roster 最高會心，代價是輕量化與最弱必殺
    id: "sky-rending-claw",
    name: "撕天利爪",
    type: "attack",
    mods: { attack: 1.03, weight: 0.95 },
    crit: 0.08,
    specialPower: 0.9,
  },
  {
    // 重斬處刑：難得的重量級攻擊型，續航換壓場
    id: "judgment-guillotine",
    name: "斷罪鍘刃",
    type: "attack",
    mods: { weight: 1.05, stamina: 0.93 },
    crit: 0.06,
    specialPower: 1.0,
  },
  // --- 防禦型 ---
  {
    // 鐵壁大招：最硬+全 roster 最強必殺，幾乎不出會心
    id: "abyss-heavy-armor",
    name: "玄冥重甲",
    type: "defense",
    mods: { defense: 1.07, stamina: 0.94 },
    crit: 0.03,
    specialPower: 1.2,
  },
  {
    // 反擊之盾：帶刃的防禦型，犧牲一點硬度換反打火力
    id: "prison-steel-saw",
    name: "獄鋼斬輪",
    type: "defense",
    mods: { attack: 1.06, defense: 0.96 },
    crit: 0.06,
    specialPower: 0.95,
  },
  {
    // 隕鐵重坦：極限配重抗出界，拳頭軟
    id: "fallen-star-armor",
    name: "隕星墜甲",
    type: "defense",
    mods: { weight: 1.08, attack: 0.94 },
    crit: 0.04,
    specialPower: 1.05,
  },
  // --- 持久型 ---
  {
    // 永動冰輪：純粹的轉到你停，幾乎放棄火力
    id: "frost-fang-orbit",
    name: "霜牙迴天",
    type: "stamina",
    mods: { stamina: 1.07, attack: 0.93 },
    crit: 0.04,
    specialPower: 1.1,
  },
  {
    // 削旋風暴：會咬人的持久型，續航上限略低
    id: "hurricane-vortex-core",
    name: "颶風渦核",
    type: "stamina",
    mods: { attack: 1.05, stamina: 0.96 },
    crit: 0.06,
    specialPower: 0.95,
  },
  // --- 平衡型 ---
  {
    // 穩重全能：配重取向的平衡型，站得穩但收尾慢
    id: "celestial-pivot-quake",
    name: "天璇地破",
    type: "balance",
    mods: { weight: 1.06, stamina: 0.95 },
    crit: 0.05,
    specialPower: 1.0,
  },
  {
    // 靈巧搶攻：輕快帶會心的平衡型，必殺最弱檔
    id: "violet-thunder-blade",
    name: "紫宸雷刃",
    type: "balance",
    mods: { attack: 1.06, weight: 0.94 },
    crit: 0.07,
    specialPower: 0.9,
  },
];

/** 依 id 查名冊（查無回 undefined；id 來自 DB/協定，不可信任時務必判空） */
export function getBey(id: string): BeyDef | undefined {
  return BEYBLADES.find((b) => b.id === id);
}

const TYPE_LABEL: Record<BeyDef["type"], string> = {
  attack: "攻擊型",
  defense: "防禦型",
  stamina: "持久型",
  balance: "平衡型",
};

/** 顯示全名：「{name}-{類型中文}」如「獄鋼斬輪-防禦型」 */
export function beyFullName(bey: BeyDef): string {
  return `${bey.name}-${TYPE_LABEL[bey.type]}`;
}

/** 3 格新手預設陣容（三顆不同類型；special 可 ""＝未裝備） */
export const DEFAULT_LINEUP: readonly { beyId: string; special: string }[] = [
  { beyId: "scarlet-blaze-wheel", special: "rush" },
  { beyId: "abyss-heavy-armor", special: "blast" },
  { beyId: "frost-fang-orbit", special: "dash" },
];

/**
 * 把個體差套到類型基礎屬性上：base 四欄 × mods（缺欄 = 1），
 * 並附上 crit / specialPower 兩欄（引擎端可選欄位，預設 0.05 / 1.0）。
 */
export function resolveBeyStats(bey: BeyDef, base: BeybladeStats): BeybladeStats {
  const out = {
    attack: base.attack * (bey.mods.attack ?? 1),
    defense: base.defense * (bey.mods.defense ?? 1),
    stamina: base.stamina * (bey.mods.stamina ?? 1),
    weight: base.weight * (bey.mods.weight ?? 1),
    crit: bey.crit,
    specialPower: bey.specialPower,
  };
  return out;
}
