/**
 * 戰鬥陀螺物理引擎 — 型別定義
 *
 * 設計原則：
 *  - 純資料 / 純函式，不依賴任何瀏覽器或 Cloudflare API，
 *    因此同一份引擎可同時跑在「瀏覽器視覺化」與「Durable Object 伺服器」。
 *  - 採「確定性批次模擬」：給定相同輸入 + 相同 seed → 輸出完全一致的軌跡。
 *    伺服器算完整場、輸出 frames，前端只負責播放，無需重算（也就沒有跨平台浮點數問題）。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 陀螺四圍屬性（建議各值落在 ~0.5 ~ 1.8 之間，1.0 為基準） */
export interface BeybladeStats {
  /** 攻擊：碰撞時對對手造成的擊退與續航傷害 */
  attack: number;
  /** 防禦：減少自身受到的擊退與續航傷害 */
  defense: number;
  /** 續航：越高，自旋（≈血量）衰減越慢 */
  stamina: number;
  /** 重量：質量，影響動量與被擊退/出界的難度 */
  weight: number;
}

/** 引擎實際吃的初始化資料（已換算成世界座標 / 速度 / 自旋量） */
export interface BeybladeInit {
  id: string;
  color: string;
  stats: BeybladeStats;
  /** 世界座標起始位置（場地中心為原點 0,0） */
  position: Vec2;
  /** 起始速度向量（單位/秒） */
  velocity: Vec2;
  /** 起始自旋量（同時當作「血量」，歸零即停轉判負） */
  spin: number;
  /** 碰撞半徑 */
  radius: number;
  /** 旋向：+1 = 逆時針（右旋），-1 = 順時針（左旋）。預設 +1 */
  spinDir?: 1 | -1;
  /** 起始高度（2.5D，可選，預設 0） */
  z?: number;
  /** 必殺技（可選，未設 = 無） */
  special?: SpecialKind;
}

/** 場地（碗形 stadium）參數 —— 決定整體手感，原型可即時調 */
export interface ArenaConfig {
  /** 出界邊界半徑：陀螺中心離原點超過此值即 Ring-out */
  radius: number;
  /** 朝中心的固定吸引加速度（碗的斜度）。越大越不易被打出界 */
  centerPull: number;
  /** 線性速度阻尼（每秒衰減比例 0~1） */
  friction: number;
  /** 旋轉造成的繞圈力（陀螺進動效果）：越大越會繞著中心轉 */
  swirl: number;
  /** 自旋基礎衰減量（每秒），實際衰減會再除以該陀螺的 stamina */
  spinDecayBase: number;
  /** 碰撞反彈係數 0~1 */
  restitution: number;
  /** 碰撞造成的自旋（血量）損耗係數 */
  collisionSpinLoss: number;
  /** 碰撞擊退倍率：放大碰撞時彈開的力道（>1 更猛） */
  knockback: number;
  /** 反向旋轉（左右旋對撞）時的傷害 / 擊退加成；同向為 1.0 基準 */
  oppSpinBonus: number;
  /** 轉速擊退加成：攻擊方自旋（轉速）越高，把對手彈得越遠的係數（0 = 關閉）。可選 */
  spinKnockback?: number;
  /** 牆壁反彈係數 0~1：撞到場地護牆時的反彈強度 */
  wallBounce: number;
  /** 撞牆造成的自旋（血量）損耗係數 */
  wallSpinLoss: number;
  /** 出界門檻：撞牆瞬間「向外速度」超過此值才會衝出護牆 Ring-out，否則反彈 */
  ringOutSpeed: number;
  /** 重力（2.5D）：每秒往下的加速度，越大跳得越短 */
  gravity: number;
  /** 碰撞彈跳：猛烈碰撞時把雙方頂向空中的係數 */
  jumpPop: number;
  /** 掠過高度差：兩者高度差超過此值時，視為一方在空中、不發生碰撞（跳過對手） */
  jumpOverHeight: number;
  /** 血量基準（耐久條）：每顆 maxHp = hpBase × 重量。可選，未設用引擎預設 HP_BASE */
  hpBase?: number;
}

export interface SimConfig {
  /** 固定時間步長（秒），例如 1/60 */
  dt: number;
  /** 模擬上限秒數，超過即 timeout（比續航） */
  maxTime: number;
  arena: ArenaConfig;
  /** 亂數種子（目前引擎為純確定性，保留供未來加入發射抖動等用途） */
  seed?: number;
  /** 每 N 步記錄一幀（1 = 每步都記）。產品環境可調大以縮小回放資料 */
  sampleEvery?: number;
  /** 勝負鎖定後再多模擬幾秒「後續演出」（出界陀螺飛出去、勝方續轉）。預設 0 */
  followThroughTime?: number;
  /** 必殺技數值（可部分覆寫，未給的用預設） */
  special?: Partial<SpecialConfig>;
}

/** 單一陀螺在某一幀的狀態 */
export interface BodyFrame {
  id: string;
  x: number;
  y: number;
  /** 高度（2.5D），0 = 貼地 */
  z: number;
  /** 視覺旋轉角度（弧度），供前端畫旋轉用 */
  angle: number;
  /** 剩餘自旋量（續航條） */
  spin: number;
  /** 剩餘血量（耐久條） */
  hp: number;
  alive: boolean;
}

export interface Frame {
  /** 此幀的模擬時間（秒） */
  t: number;
  bodies: BodyFrame[];
}

/** 必殺技種類（空字串/未設 = 無） */
export type SpecialKind = "rush" | "blast";

/** 必殺技發動事件（供回放特效用） */
export interface SpecialEvent {
  t: number;
  id: string;
  kind: SpecialKind;
}

/** 必殺技數值（集中可調，每招獨立設定） */
export interface SpecialConfig {
  /** 衝刺：觸發機率 0~1 */
  rushChance: number;
  /** 衝刺：進入此距離才可能觸發 */
  rushRange: number;
  /** 衝刺：朝對手爆發加速量 */
  rushSpeed: number;
  /** 衝刺：命中時直接扣對手血量的傷害 */
  rushDamage: number;
  /** 衝刺：發動後冷卻秒數 */
  rushCooldown: number;
  /** 衝擊：觸發機率 0~1 */
  blastChance: number;
  /** 衝擊：撞擊強度門檻（夠猛的一擊才觸發） */
  blastImpactMin: number;
  /** 衝擊：把對手彈開的速度量 */
  blastPush: number;
  /** 衝擊：對對手造成的血量傷害 */
  blastDamage: number;
}

export type WinReason = "ring-out" | "spin-out" | "timeout" | "draw" | "ko";

/** 一場對戰的完整結果（伺服器算完後推播給前端的內容） */
export interface SimResult {
  /** 勝者 id，平手為 null */
  winnerId: string | null;
  /** 敗者 id，平手為 null */
  loserId: string | null;
  /** 結束原因 */
  reason: WinReason;
  /** 完整軌跡，供前端播放 */
  frames: Frame[];
  /** 實際模擬步數 */
  steps: number;
  /** 對戰實際時長（秒，含後續演出） */
  duration: number;
  /** 慢動作（子彈時間）觸發時間（秒）：僅在終結／淘汰瞬間 */
  slowmoCues: number[];
  /** 必殺技發動事件（供回放特效） */
  specialEvents: SpecialEvent[];
  /** 出界角度（弧度，僅 ring-out 時有值），供「落點分區計分」用 */
  ringOutAngle: number | null;
}

/** 給上層 / UI 用的「發射參數」，再由 buildInit 換算成 BeybladeInit */
export interface LaunchParams {
  id: string;
  color: string;
  stats: BeybladeStats;
  /** 發射方向（度，0 = +x 方向，逆時針為正） */
  angleDeg: number;
  /** 力道 0~1 → 換算成速度大小 */
  power: number;
  /** 自旋強度 0~1 → 換算成起始自旋量 */
  spinPower: number;
  /** 起始落點：在以中心為圓心的圓上，沿此角度（度）擺放 */
  startAngleDeg: number;
  /** 碰撞半徑（可選，預設 26） */
  radius?: number;
  /** 旋向：+1 = 逆時針（右旋），-1 = 順時針（左旋）。預設 +1 */
  spinDir?: 1 | -1;
}
