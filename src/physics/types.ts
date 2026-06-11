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

/**
 * 護牆分區（P1）：對「邊緣某個角度範圍」覆寫護牆特性。
 * 未被任何段涵蓋的角度 = 一般護牆（用 arena 的全域 wallBounce / ringOutSpeed）。
 * 角度為世界座標弧度（+y 朝上為 +π/2），段涵蓋 [angle - half, angle + half]。
 */
export interface RimSegment {
  /** 段中心角（世界座標弧度） */
  angle: number;
  /** 段半寬（弧度） */
  half: number;
  /**
   * 類型（決定預設值與視覺）：
   *  - wall   一般牆（score 1，物理同全域）
   *  - pocket 高分區（score 2，物理同一般牆 → 相容舊「缺口只計分」）
   *  - break  真·物理破口（ringOutSpeed 預設 0：一碰邊就出界，score 2）
   * 預設 wall。
   */
  kind?: "wall" | "pocket" | "break";
  /** 反彈係數覆寫（未設依 kind 預設 → 全域 wallBounce） */
  wallBounce?: number;
  /** 出界門檻覆寫（未設依 kind 預設：wall/pocket=全域、break=0） */
  ringOutSpeed?: number;
  /** 從此段飛出的計分（未設依 kind 預設：wall=1、pocket/break=2） */
  score?: number;
}

/**
 * 加速軌道（參考實體陀螺場地常見的環形加速帶）。
 * 陀螺中心落在 radius ± band 的環帶上時，沿自旋方向獲得切向加速（越轉越猛），
 * 並可額外被拉向中心 → 更容易加速、撞更兇，但本身不會把陀螺推出場。
 */
export interface AcceleratorRail {
  /** 軌道半徑（陀螺中心離原點的距離） */
  radius: number;
  /** 軌道作用半寬：|dist - radius| ≤ band 才生效 */
  band: number;
  /** 切向加速度（沿自旋方向），實際施加量 ∝ 自旋比例 */
  boost: number;
  /** 上軌時額外的向心加速（把陀螺拉向中心 → 撞向對手）。可選 */
  inward?: number;
  /** 上軌最低自旋比例門檻 0~1（太慢上不了軌）。可選，預設 0 */
  minSpin?: number;
}

/**
 * 方形邊界（參考實體陀螺場地的正方形場）。設了 box → 邊界改用「軸對齊方框」而非圓：
 *  - 四條邊（上下左右）= 會反彈的牆：垂直分量反彈、切向分量保留 → 斜撞會沿牆滑向角落。
 *  - 四個角 = 出界口：被推進角落開口即 Ring-out。
 * 未設 = 沿用圓形邊界（radius + rim），既有場地不受影響。
 */
export interface BoxBoundary {
  /** 半邊長：場地中心到邊的距離（x/y 對稱的正方形） */
  half: number;
  /** 角落開口大小：從角往兩邊各延伸這麼長的範圍沒有牆 → 可摔出去 */
  cornerGap: number;
  /** 邊牆反彈係數（未設用 arena.wallBounce） */
  wallBounce?: number;
  /** 從角落摔出的計分（未設 2） */
  cornerScore?: number;
}

/**
 * 綠色內牆（M 形內牆，參考實體陀螺場地）。一條閉合曲線，做為「box 的內層實體牆」：
 *  - 形狀：手繪 M —— 基準圓 radius 的外圈大弧 + 兩條從接縫「相切」到圓拱頂的直線腿 + 兩個外凸圓拱
 *    + 頂端兩拱間的水平凹底線段（凹口在 topAngle）。為星形曲線，仍以 r(θ) 介面供查詢。
 *  - 實體牆：陀螺撞牆沿「界線段外法線」反彈、保留切向（沿牆滑）；**只在貼地（z ≤ wallHeight）時阻擋**。
 *  - 越牆（唯一出綠框的方式）：被碰撞**擊飛到空中**（z > wallHeight）→ 飛越綠牆進「外圈」，交給方框 box（飛到四角才出界 / 撞四邊反彈）。
 *  - 頂部加速區：凹口弧段內、夠快的陀螺獲得切向爆發 + 沿內法線向心拉。
 * 引擎（碰撞）與 ArenaSvg（描繪）共用 src/physics/arena.ts 的同一份 M 形界線（sampleSoftWall）→ 畫面與物理同源。
 * 未設（undefined）= 無內牆，既有場地完全不受影響。所有欄位除 radius 外皆可選。
 */
export interface SoftWall {
  /** 中心線基準半徑（world）。 */
  radius: number;
  /** 牆視覺半厚（world，描邊寬用；不影響碰撞接觸點）。預設 16。 */
  bandHalf?: number;
  /** 凹口中心角（world 弧度）。預設 +π/2（正上方）。 */
  topAngle?: number;
  /* —— M 形手繪幾何（直腿相切圓弧拱 + 水平凹底）；比例相對 radius，未設用手繪定案預設 —— */
  /** 圓拱半徑（相對 radius）。預設 ≈0.404。 */
  crownRadius?: number;
  /** 圓拱圓心離中軸 x 偏移（相對 radius）。預設 ≈0.263。 */
  crownSep?: number;
  /** 圓拱圓心往凹口方向的高（相對 radius）。預設 ≈0.667。 */
  crownHeight?: number;
  /** 外圈接縫離凹口中心半張角（弧度，腿從此相切到圓拱）。預設 ≈0.942（54°）。 */
  seamAngle?: number;
  /** 頂端水平凹底線段半長（相對 radius，~5% 直徑）。預設 0.05。 */
  notchHalf?: number;
  /* —— 以下舊 r(θ) raised-cosine 參數已停用（改手繪 M 後不生效），保留僅為相容舊存檔 —— */
  /** @deprecated 舊 r(θ) 谷底平段半張角（已停用）。 */
  valleyFlatHalf?: number;
  /** @deprecated 舊 r(θ) 谷底圓肩半張角（已停用）。 */
  valleyShoulder?: number;
  /** @deprecated 舊 r(θ) 谷底內凹深度（已停用）。 */
  depth?: number;
  /** @deprecated 舊 r(θ) 拱峰中心半張角（已停用）。 */
  archCenter?: number;
  /** @deprecated 舊 r(θ) 拱峰半寬（已停用）。 */
  archHalf?: number;
  /** @deprecated 舊 r(θ) 拱峰外凸比例（已停用）。 */
  archLift?: number;
  /** 實體牆反彈係數 0~1。預設 arena.wallBounce。 */
  wallBounce?: number;
  /** 撞牆扣自旋係數。預設 arena.wallSpinLoss。 */
  spinLoss?: number;
  /** 綠牆「高度」：陀螺 z 超過此值才能飛越綠牆（被擊飛才出得去）。預設 20。 */
  wallHeight?: number;
  /** @deprecated 舊「軟牆半透膜」越牆門檻（已停用，改為實體牆 + 擊飛越牆）。 */
  passThroughSpeed?: number;
  /** 頂部加速區半張角。預設 archCenter + archHalf（涵蓋整個凹口）。 */
  accelHalf?: number;
  /** 切向加速量 ∝ 自旋（0 或未設 = 無加速區）。 */
  accelBoost?: number;
  /** 沿真實內法線的向心拉（funnel 主力）。預設 70。 */
  accelInward?: number;
  /** 加速區最低自旋比例門檻 0~1。預設 0.12。 */
  accelMinSpin?: number;
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
  /**
   * 邊緣分區（P1）：每段可獨立設定反彈 / 出界門檻 / 計分。
   * 未設（undefined）= 相容舊行為：上(+y)、下(-y) 兩個高分缺口（半寬 0.42、計分 2、物理同牆）。
   * 設為 [] = 整圈無任何分區（一般牆、出界皆 1 分）。可選。
   */
  rim?: RimSegment[];
  /** 加速軌道（環形加速帶）。未設 = 無軌道（不影響既有場地）。可選。 */
  rail?: AcceleratorRail;
  /** 方形邊界（四角出界、四邊反彈）。設了就改用方框邊界、忽略圓形 rim 邊界。可選。 */
  box?: BoxBoundary;
  /** 綠色軟牆（M 形內牆 + 頂部加速區），內層半透膜。未設 = 無（不影響既有場地）。可選。 */
  softWall?: SoftWall;
  /**
   * 超橢圓邊界（弧壁場）：邊界改用 r(θ) = radius·2^(1/p−1/2) / (|cosθ|^p + |sinθ|^p)^(1/p)。
   * power（p）≈ 3~4 → 方中帶弧、四邊外凸、對角最遠；採「對角正規化」——最遠點（對角）恰為
   * arena.radius → 邊界恆在外接圓內，前端以 radius 為縮放基準的畫面/瞄準邏輯不必改。
   * 對角出界扇區用既有 rim 分區機制設定（pocket 門檻低 → 可出界、2 分）。
   * 未設 = 圓形邊界（既有場地/舊存檔不受影響）；box 優先於本欄位。可選。
   */
  superellipse?: { power: number };
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
  /** 是否為分身（前端用：暗色半透明繪製、用主人顏色、不畫血條） */
  isClone?: boolean;
  /** 分身主人 id（前端上色用） */
  ownerId?: string;
  /** 分身淡出比例 0~1（1=完整，接近 despawn → 0，做「慢慢消失」） */
  cloneFade?: number;
}

export interface Frame {
  /** 此幀的模擬時間（秒） */
  t: number;
  bodies: BodyFrame[];
}

/** 必殺技種類（空字串/未設 = 無） */
export type SpecialKind = "rush" | "blast" | "dash" | "vortex" | "clone";

/** 必殺技發動事件（供回放特效用） */
export interface SpecialEvent {
  t: number;
  id: string;
  kind: SpecialKind;
  /** 發動位置（世界座標），供停格特效定位 */
  x: number;
  y: number;
  /** dash 回血量（實際回復值，夾制後；僅 dash 事件帶）。可選 */
  heal?: number;
}

/** 碰撞事件（供回放火花特效用，強度依 impact） */
export interface CollisionEvent {
  t: number;
  /** 接觸點（世界座標） */
  x: number;
  y: number;
  /** 撞擊強度（沿法線接近速度）→ 決定火花強弱 */
  impact: number;
  /** 事件中第一顆陀螺 id（可選，向後相容舊回放資料） */
  aId?: string;
  /** 事件中第二顆陀螺 id（可選） */
  bId?: string;
  /** A 實際扣血量（含 ±10% 浮動後的最終值）。可選 */
  dmgA?: number;
  /** B 實際扣血量（含 ±10% 浮動後的最終值）。可選 */
  dmgB?: number;
}

/** 淘汰事件（供回放擊破/出界特效用） */
export interface DeathEvent {
  t: number;
  id: string;
  x: number;
  y: number;
  reason: "ring-out" | "spin-out" | "ko";
}

/** 必殺技數值（集中可調，每招獨立設定）。觸發模型＝冷卻 + 每回合限次 + 機率。 */
export interface SpecialConfig {
  /** 開場緩衝（秒）：t 小於此值時所有必殺技一律不得觸發（統一閘門） */
  graceTime: number;
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
  /** 衝刺：每回合最多發動次數 */
  rushMaxUses: number;
  /** 衝擊：觸發機率 0~1 */
  blastChance: number;
  /** 衝擊：撞擊強度門檻（夠猛的一擊才觸發） */
  blastImpactMin: number;
  /** 衝擊：把對手彈開的速度量 */
  blastPush: number;
  /** 衝擊：對對手造成的血量傷害 */
  blastDamage: number;
  /** 衝擊：發動後冷卻秒數 */
  blastCooldown: number;
  /** 衝擊：每回合最多發動次數 */
  blastMaxUses: number;

  /* —— 高速移動 dash：自旋偏低時觸發 → 回補自旋 + 一段時間移動加速 —— */
  dashChance: number;
  dashCooldown: number;
  dashMaxUses: number;
  /** 自旋比例（spin/maxSpin）低於此值才觸發 */
  dashTriggerSpin: number;
  /** 回補的自旋量 */
  dashSpinRestore: number;
  /** 加速持續秒數 */
  dashDuration: number;
  /** 加速期間沿移動方向的額外加速度 */
  dashAccel: number;
  /** 加速期間速度上限 = maxSpeed × 此倍率（夾住 → 不會把自己噴出界） */
  dashMaxSpeedMul: number;
  /** 觸發時回復血量 = maxHp × 此比例（夾制不超過 maxHp） */
  dashHealFrac: number;

  /* —— 旋渦 vortex：對手進範圍觸發 → 持續數秒把對手往自己拉 + 抽乾對手自旋（重型/防禦磨人） —— */
  vortexChance: number;
  vortexCooldown: number;
  vortexMaxUses: number;
  /** 持續期間每秒抽乾對手的自旋量（削弱：逼對手停轉） */
  vortexSpinDrain: number;
  /** 對手進入此距離才觸發 */
  vortexRange: number;
  /** 吸引對手的力道 */
  vortexPull: number;
  /** 吸引持續秒數 */
  vortexDuration: number;

  /* —— 分身 clone：生一個暫時分身（低傷、會撞會扣血、不計勝負、x秒消失） —— */
  cloneChance: number;
  cloneCooldown: number;
  cloneMaxUses: number;
  /** 對手進入此距離才召喚 */
  cloneRange: number;
  /** 分身持續秒數 */
  cloneDuration: number;
  /** 分身攻擊力 = 本體攻擊 × 此倍率（低傷） */
  cloneAttackMul: number;
  /** 分身的自旋量 */
  cloneSpin: number;
  /** 分身朝對手追擊的加速度 */
  cloneHoming: number;
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
  /** 碰撞事件（供回放火花特效，強度依 impact） */
  collisionEvents: CollisionEvent[];
  /** 淘汰事件（供回放擊破/出界特效） */
  deathEvents: DeathEvent[];
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
