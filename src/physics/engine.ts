/**
 * 戰鬥陀螺物理引擎 —— 確定性批次模擬。
 *
 * simulate() 一次算完整場對戰，回傳完整軌跡 (frames) 與勝負。
 * 同一份程式碼可跑在瀏覽器（視覺化）與 Durable Object（伺服器權威）。
 */
import type {
  ArenaConfig,
  BeybladeInit,
  BeybladeStats,
  BodyFrame,
  Frame,
  LaunchParams,
  SimConfig,
  SimResult,
  SpecialConfig,
  SpecialEvent,
  SpecialKind,
  WinReason,
} from "./types";
import { makeRng } from "./prng";
import { rimAt, softWallRadiusAt, softWallNormalAt, softWallAccelAt } from "./arena";

/** 必殺技數值（集中可調，可被 SimConfig.special 覆寫） */
export const DEFAULT_SPECIAL: SpecialConfig = {
  rushChance: 0.2,
  rushRange: 110,
  rushSpeed: 300,
  rushDamage: 320,
  rushCooldown: 2.0,
  blastChance: 0.35,
  blastImpactMin: 70,
  blastPush: 360,
  blastDamage: 300,
};

/** 血量（耐久條）基準預設：maxHp = hpBase × 重量 */
export const HP_BASE = 1250;
export function maxHpFor(stats: BeybladeStats, hpBase: number = HP_BASE): number {
  return hpBase * Math.max(0.2, stats.weight);
}

/** 內部可變狀態（模擬過程中使用，不對外輸出） */
interface Body {
  id: string;
  color: string;
  attack: number;
  defense: number;
  stamina: number;
  mass: number;
  radius: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  spin: number;
  hp: number;
  maxHp: number;
  spinDir: number;
  angle: number;
  alive: boolean;
  deadAtStep: number;
  deathReason: WinReason | null;
  special: SpecialKind | "";
  prevInRange: boolean;
  rushReadyT: number;
  ringOutAngle: number;
}

/** 力道 / 自旋的換算上限 */
export const DEFAULT_SCALES = {
  maxSpeed: 340,
  maxSpin: 3000,
};

/** 預設場地參數（手感基準，可在 UI 即時調整） */
export const DEFAULT_ARENA: ArenaConfig = {
  radius: 300,
  centerPull: 90,
  friction: 0.5,
  swirl: 110,
  spinDecayBase: 70,
  restitution: 0.6,
  collisionSpinLoss: 0.45,
  knockback: 1.5,
  oppSpinBonus: 1.5,
  spinKnockback: 0.1,
  wallBounce: 0.7,
  wallSpinLoss: 0.12,
  ringOutSpeed: 190,
  gravity: 900,
  jumpPop: 0.15,
  jumpOverHeight: 34,
  hpBase: HP_BASE,
};

/**
 * Beyblade X 風「Xtreme Stadium」內建場地（正方形場 + 綠色 M 形軟牆）：
 *  - 方形邊界 box：四邊會反彈、四個角 = 出界口（計分 2）。
 *  - 綠色軟牆 softWall（M 形 Xtreme Line）：內層半透膜，頂部凹口把陀螺導向中心逼對撞；
 *    撞夠猛（沿真實法線向外速 > passThroughSpeed）才穿過綠牆進外圈 → 被甩進四角才出界。
 *  - 頂部加速區（Xtreme Dash）：凹口弧段內爆發加速 + 向心拉。
 * ⚠ 物理手感（出界率等）為起點值，需 `npm run balance` 的 XTREME 探針再校。
 */
export const XTREME_STADIUM: ArenaConfig = {
  ...DEFAULT_ARENA,
  wallBounce: 0.6,
  // ⚠ 暫定「看得到對撞」手感（centerPull 高 + swirl 低 → 收斂對撞）。
  // 註：大軟牆會壓制出界 → 純猜拳平衡無法成立（attack 缺勝條件），平衡抉擇待定（見對話）。
  centerPull: 155,
  swirl: 45,
  friction: 0.5,
  // 擊飛越牆出界的關鍵 jump 物理：jumpPop 強(0.7)+ 低重力(350，滯空夠久飛得到角落)，
  // 越牆後 centerPull 關閉做彈道飛行（見 integrate）。實測 ~3% 罕見出界、飛行高度受控（p95 z≈100）。
  // 這幾個值 + softWall.wallHeight 是「出界難度」的調校桿；DEFAULT_ARENA 不受影響（無 softWall）。
  jumpPop: 0.7,
  gravity: 350,
  box: { half: 230, cornerGap: 60, wallBounce: 0.6, cornerScore: 2 },
  softWall: {
    radius: 208, // 放大到快貼邊線（box half 230；拱峰 ~1.07R≈223 + 綠帶 仍在頂邊 230 內）
    bandHalf: 7, // 細綠帶（比照參考圖）
    topAngle: Math.PI / 2,
    // 形狀 = 手繪定案 M（直腿相切 + 圓弧拱 + 水平凹底），用 arena.ts 的 DEFAULT_MNOTCH 預設；
    // 如需微調可加 crownRadius / crownSep / crownHeight / seamAngle / notchHalf。
    wallHeight: 10, // 綠牆高度：陀螺 z 超過此值才飛越（被擊飛才出得去）
    wallBounce: 0.6, // 實體牆反彈（同四邊）
    spinLoss: 0.12,
    accelBoost: 150,
    accelInward: 110,
    accelMinSpin: 0.12,
  },
};

export const DEFAULT_SIM: Omit<SimConfig, "arena"> = {
  dt: 1 / 60,
  maxTime: 60,
  seed: 1,
  sampleEvery: 1,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 由「發射參數」換算成引擎初始化資料 */
export function buildInit(
  p: LaunchParams,
  arena: ArenaConfig,
  scales = DEFAULT_SCALES,
): BeybladeInit {
  const startR = arena.radius * 0.5;
  const sa = (p.startAngleDeg * Math.PI) / 180;
  const aim = (p.angleDeg * Math.PI) / 180;
  const speed = clamp(p.power, 0, 1) * scales.maxSpeed;
  const spin = clamp(p.spinPower, 0, 1) * scales.maxSpin;
  return {
    id: p.id,
    color: p.color,
    stats: p.stats,
    position: { x: Math.cos(sa) * startR, y: Math.sin(sa) * startR },
    velocity: { x: Math.cos(aim) * speed, y: Math.sin(aim) * speed },
    spin,
    radius: p.radius ?? 26,
    spinDir: p.spinDir ?? 1,
  };
}

function snapshot(t: number, bodies: Body[]): Frame {
  const out: BodyFrame[] = bodies.map((b) => ({
    id: b.id,
    x: b.px,
    y: b.py,
    z: b.z,
    angle: b.angle,
    spin: Math.max(0, b.spin),
    hp: Math.max(0, b.hp),
    alive: b.alive,
  }));
  return { t, bodies: out };
}

/**
 * 執行一場對戰模擬。
 * @param inits 參戰陀螺（目前玩法為 2 顆，引擎本身支援 N 顆）
 */
export function simulate(inits: BeybladeInit[], config: SimConfig): SimResult {
  const arena = config.arena;
  const dt = config.dt;
  const sampleEvery = Math.max(1, Math.floor(config.sampleEvery ?? 1));
  const maxSteps = Math.max(1, Math.ceil(config.maxTime / dt));

  const bodies: Body[] = inits.map((b) => ({
    id: b.id,
    color: b.color,
    attack: b.stats.attack,
    defense: b.stats.defense,
    stamina: b.stats.stamina,
    mass: Math.max(0.05, b.stats.weight),
    radius: b.radius,
    px: b.position.x,
    py: b.position.y,
    vx: b.velocity.x,
    vy: b.velocity.y,
    z: b.z ?? 0,
    vz: 0,
    spin: b.spin,
    hp: maxHpFor(b.stats, arena.hpBase),
    maxHp: maxHpFor(b.stats, arena.hpBase),
    spinDir: b.spinDir ?? 1,
    angle: 0,
    alive: true,
    deadAtStep: -1,
    deathReason: null,
    special: b.special ?? "",
    prevInRange: false,
    rushReadyT: 0,
    ringOutAngle: NaN,
  }));

  const frames: Frame[] = [snapshot(0, bodies)];
  const slowmoCues: number[] = [];
  const specialEvents: SpecialEvent[] = [];
  const rng = makeRng(config.seed ?? 1);
  const sc: SpecialConfig = { ...DEFAULT_SPECIAL, ...config.special };
  const followSteps = Math.max(0, Math.round((config.followThroughTime ?? 0) / dt));
  let step = 0;
  let t = 0;
  let decidedStep = -1;
  let outcome: ReturnType<typeof determineOutcome> | null = null;

  for (step = 1; step <= maxSteps; step++) {
    t = step * dt;
    integrate(bodies, arena, dt);
    resolveCollisions(bodies, arena, sc, rng, t, specialEvents);
    resolveWalls(bodies, arena, step);
    applySpecials(bodies, sc, rng, t, specialEvents);
    checkDeaths(bodies, arena, step);

    // 慢動作只在「終結瞬間」觸發：本步發生淘汰（出界 / 停轉）
    for (const b of bodies) {
      if (b.deadAtStep === step) {
        slowmoCues.push(t);
        break;
      }
    }

    if (step % sampleEvery === 0) frames.push(snapshot(t, bodies));

    const aliveCount = bodies.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
    // 第一次分出勝負 → 鎖定結果（後續演出不再改變勝負）
    if (decidedStep < 0 && aliveCount <= 1) {
      decidedStep = step;
      outcome = determineOutcome(bodies);
    }
    // 已分勝負且後續演出跑完 → 結束
    if (decidedStep >= 0 && step - decidedStep >= followSteps) break;
  }

  // 確保最後狀態一定有被記錄到（避免 break 當步剛好不是取樣步）
  const last = frames[frames.length - 1];
  if (last.t !== t) frames.push(snapshot(t, bodies));

  // 從未分出勝負（timeout）→ 以結束時狀態判定
  if (!outcome) outcome = determineOutcome(bodies);

  // 出界角度（敗方），供落點分區計分
  const loserBody = bodies.find((b) => b.id === outcome!.loserId);
  const ringOutAngle =
    outcome.reason === "ring-out" && loserBody && Number.isFinite(loserBody.ringOutAngle)
      ? loserBody.ringOutAngle
      : null;

  return {
    winnerId: outcome.winnerId,
    loserId: outcome.loserId,
    reason: outcome.reason,
    frames,
    steps: step > maxSteps ? maxSteps : step,
    duration: t,
    slowmoCues,
    specialEvents,
    ringOutAngle,
  };
}

function integrate(bodies: Body[], arena: ArenaConfig, dt: number): void {
  for (const b of bodies) {
    if (!b.alive) {
      // 死亡後殘餘運動（後續演出）：
      //  - 被擊出界 → 照常飛出（低阻尼）
      //  - 停轉 / 爆裂 → 失去旋轉穩定，急速停下、幾乎不位移（不會慢慢飄出場）
      const damp =
        b.deathReason === "ring-out"
          ? Math.max(0, 1 - arena.friction * dt)
          : Math.max(0, 1 - 7 * dt);
      b.vx *= damp;
      b.vy *= damp;
      b.px += b.vx * dt;
      b.py += b.vy * dt;
      // 轉速快速歸零 → 視覺上停止旋轉
      b.spin = Math.max(0, b.spin * (1 - 4 * dt));
      b.angle += b.spinDir * (b.spin / DEFAULT_SCALES.maxSpin) * 32 * dt;
      b.vz -= arena.gravity * dt;
      b.z += b.vz * dt;
      if (b.z <= 0) {
        b.z = 0;
        b.vz = 0;
      }
      continue;
    }

    const r = Math.hypot(b.px, b.py) || 1e-6;
    const nx = b.px / r;
    const ny = b.py / r;

    // 進動基底（自旋繞圈方向）先算好：碗面力 / 軌道 / 加速區都會用到
    const spinNorm = b.spin / DEFAULT_SCALES.maxSpin;
    const tx = -ny * b.spinDir;
    const ty = nx * b.spinDir;

    // 碗面力（朝心吸引 + 進動繞圈）只在「貼著碗面」時作用；被碰撞擊飛、越過綠牆（z > wallHeight）
    // → 離開碗面做彈道飛行（只剩重力），不再被拉回中心 → 這才是「被擊飛才飛得到角落出界」的關鍵。
    // 只在有 softWall 的場地有此區別；無 softWall（如 DEFAULT_ARENA）→ airborneOverWall 恆 false → 與改前逐位元相同。
    const swForce = arena.softWall;
    const airborneOverWall = !!swForce && b.z > (swForce.wallHeight ?? 20);
    if (!airborneOverWall) {
      // 1) 朝中心的固定吸引力（碗的斜度）
      b.vx -= nx * arena.centerPull * dt;
      b.vy -= ny * arena.centerPull * dt;
      // 2) 自旋造成的繞圈力（進動）：方向與半徑垂直，大小正比於自旋，方向依旋向
      b.vx += tx * arena.swirl * spinNorm * dt;
      b.vy += ty * arena.swirl * spinNorm * dt;
    }

    // 2.5) 加速軌道（Xtreme Line）：在環帶上 → 沿自旋方向切向加速 + 可選向心拉。
    // 只在 arena.rail 存在時生效 → 既有場地完全不受影響。施加量 ∝ 自旋，隨自旋衰減而遞減。
    const rail = arena.rail;
    if (rail && spinNorm >= (rail.minSpin ?? 0) && Math.abs(r - rail.radius) <= rail.band) {
      b.vx += tx * rail.boost * spinNorm * dt;
      b.vy += ty * rail.boost * spinNorm * dt;
      if (rail.inward) {
        b.vx -= nx * rail.inward * dt;
        b.vy -= ny * rail.inward * dt;
      }
    }

    // 2.6) 綠色軟牆頂部加速區（Xtreme Dash）：在頂端凹口弧段、貼牆且夠快 →
    // 沿自旋方向切向爆發 + 沿「真實內法線」向心拉（凹口法線指向中心 → funnel 逼對撞）。
    // 只在 arena.softWall.accelBoost 存在時生效，施加量 ∝ 自旋 → 隨自旋衰減、不會變發射器。
    // 與 resolveWalls 的綠牆一致：跟著 softWall 走（不綁 box），方形/圓形場皆可；貼地時才作用。
    const sw = arena.softWall;
    if (!airborneOverWall && sw?.accelBoost && spinNorm >= (sw.accelMinSpin ?? 0.12)) {
      const acc = softWallAccelAt(sw, b.px, b.py, b.radius);
      if (acc.onZone) {
        // 切向爆發：沿自旋繞圈方向（與軌道 rail 同基底 tx/ty）
        b.vx += tx * sw.accelBoost * spinNorm * dt;
        b.vy += ty * sw.accelBoost * spinNorm * dt;
        // 向心拉：沿綠牆「真實內法線」（凹口處指向中心 → funnel）
        const iN = sw.accelInward ?? 70;
        b.vx -= acc.nx * iN * dt; // acc.n 為外法線 → 減去 = 沿內法線拉
        b.vy -= acc.ny * iN * dt;
      }
    }

    // 3) 線性阻尼
    const damp = Math.max(0, 1 - arena.friction * dt);
    b.vx *= damp;
    b.vy *= damp;

    // 4) 位移
    b.px += b.vx * dt;
    b.py += b.vy * dt;

    // 5) 自旋（血量）衰減，續航越高衰減越慢
    b.spin -= (arena.spinDecayBase * dt) / Math.max(0.1, b.stamina);

    // 6) 視覺旋轉角度累積（依旋向）
    b.angle += b.spinDir * (b.spin / DEFAULT_SCALES.maxSpin) * 32 * dt;

    // 7) 垂直運動（2.5D 高度）：重力下墜、落地歸零
    b.vz -= arena.gravity * dt;
    b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      b.vz = 0;
    }
  }
}

function resolveCollisions(
  bodies: Body[],
  arena: ArenaConfig,
  sc: SpecialConfig,
  rng: () => number,
  t: number,
  events: SpecialEvent[],
): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (!a.alive || !b.alive) continue;

      const dx = b.px - a.px;
      const dy = b.py - a.py;
      const dist = Math.hypot(dx, dy) || 1e-6;
      const minDist = a.radius + b.radius;
      if (dist >= minDist) continue;

      // 一方躍起、兩者高度差過大 → 從上方掠過，不發生碰撞
      if (Math.abs(a.z - b.z) > arena.jumpOverHeight) continue;

      const nx = dx / dist;
      const ny = dy / dist;

      // 位置修正：依質量比例把兩者推開，消除重疊
      const overlap = minDist - dist;
      const total = a.mass + b.mass;
      a.px -= nx * overlap * (b.mass / total);
      a.py -= ny * overlap * (b.mass / total);
      b.px += nx * overlap * (a.mass / total);
      b.py += ny * overlap * (a.mass / total);

      // 法線方向相對速度
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const velAlongNormal = rvx * nx + rvy * ny;
      if (velAlongNormal > 0) continue; // 正在分離，不處理

      // 反向旋轉（左右旋對撞）→ 接觸點切線速度相加，撞擊更猛；同向為基準
      const clash = a.spinDir === b.spinDir ? 1 : arena.oppSpinBonus;

      const e = arena.restitution;
      const jImpulse =
        (-(1 + e) * velAlongNormal) / (1 / a.mass + 1 / b.mass);
      // 擊退倍率 + 旋向加成，讓彈開更有力
      const knock = arena.knockback * clash;
      const jx = jImpulse * nx * knock;
      const jy = jImpulse * ny * knock;

      // 攻防修正：對手攻擊放大受擊，自身防禦減少受擊
      const aRecv = clamp(b.attack / Math.max(0.2, a.defense), 0.2, 4);
      const bRecv = clamp(a.attack / Math.max(0.2, b.defense), 0.2, 4);

      a.vx -= (jx / a.mass) * aRecv;
      a.vy -= (jy / a.mass) * aRecv;
      b.vx += (jx / b.mass) * bRecv;
      b.vy += (jy / b.mass) * bRecv;

      // 能量夾制：碰撞後「分離速度」不得超過「接近速度」（等效反彈係數 ≤ 1）。
      // 防止 knockback × oppSpinBonus × 攻防 造成超彈性 → 邊緣連環撞越撞越快 → 噴出場外。
      const approach = -velAlongNormal; // 接近速度（>0）
      const newVAN = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; // 分離速度
      if (newVAN > approach) {
        const jc = (newVAN - approach) / (1 / a.mass + 1 / b.mass);
        a.vx += (jc / a.mass) * nx;
        a.vy += (jc / a.mass) * ny;
        b.vx -= (jc / b.mass) * nx;
        b.vy -= (jc / b.mass) * ny;
      }

      // 碰撞傷害扣「血量（耐久）」：攻擊 / 防禦 + 旋向加成參與。
      // 自旋只隨時間衰減，碰撞不直接扣自旋 → 攻擊型靠撞擊扣血、但需在自己續航耗盡前擊破。
      const impact = Math.abs(velAlongNormal);
      const dmg = impact * arena.collisionSpinLoss * clash;
      a.hp -= dmg * clamp(b.attack / Math.max(0.2, a.defense), 0.2, 4);
      b.hp -= dmg * clamp(a.attack / Math.max(0.2, b.defense), 0.2, 4);

      // 猛烈碰撞把雙方頂向空中（2.5D 彈跳）
      const pop = impact * arena.jumpPop * clash;
      a.vz += pop;
      b.vz += pop;

      // 轉速擊退加成（夾制之後的額外推力）：攻擊方自旋越高 → 把對手沿法線推得越遠。
      // 隨自旋衰減而遞減，所以不會像超彈性那樣無限暴衝；係數可在場地後台調。
      const spinK = arena.spinKnockback ?? 0;
      if (spinK > 0) {
        const maxSpin = DEFAULT_SCALES.maxSpin;
        const aSpinN = Math.max(0, a.spin) / maxSpin; // a 的轉速 → 推 b
        const bSpinN = Math.max(0, b.spin) / maxSpin; // b 的轉速 → 推 a
        b.vx += nx * impact * spinK * aSpinN;
        b.vy += ny * impact * spinK * aSpinN;
        a.vx -= nx * impact * spinK * bSpinN;
        a.vy -= ny * impact * spinK * bSpinN;
      }

      // 必殺技【衝擊】：裝備者打出夠猛的一擊 → 機率把對手彈開一段距離 + 造成傷害
      if (impact > sc.blastImpactMin) {
        // a 衝擊 b：把 b 沿法線（遠離 a）方向彈開
        if (a.special === "blast" && b.alive && rng() < sc.blastChance) {
          b.vx += nx * sc.blastPush;
          b.vy += ny * sc.blastPush;
          b.hp -= sc.blastDamage;
          events.push({ t, id: a.id, kind: "blast" });
        }
        // b 衝擊 a：把 a 沿 -法線（遠離 b）方向彈開
        if (b.special === "blast" && a.alive && rng() < sc.blastChance) {
          a.vx -= nx * sc.blastPush;
          a.vy -= ny * sc.blastPush;
          a.hp -= sc.blastDamage;
          events.push({ t, id: b.id, kind: "blast" });
        }
      }
    }
  }
}

/**
 * 必殺技【衝刺突進】：alive 且裝備 rush 的陀螺，在「剛進入對手攻擊距離」時，
 * 機率朝對手爆發加速（製造猛撞 / 擊飛）+ 直接扣對手血量 rushDamage。
 */
function applySpecials(bodies: Body[], sc: SpecialConfig, rng: () => number, t: number, events: SpecialEvent[]): void {
  for (const b of bodies) {
    if (!b.alive || b.special !== "rush") {
      b.prevInRange = false;
      continue;
    }
    // 找最近的另一顆存活陀螺當目標
    let opp: Body | null = null;
    let best = Infinity;
    for (const o of bodies) {
      if (o === b || !o.alive) continue;
      const d = Math.hypot(o.px - b.px, o.py - b.py);
      if (d < best) {
        best = d;
        opp = o;
      }
    }
    const inRange = opp !== null && best < sc.rushRange;
    // 只在「剛進入射程」且過了冷卻時擲骰
    if (inRange && opp && !b.prevInRange && t >= b.rushReadyT) {
      if (rng() < sc.rushChance) {
        const dx = opp.px - b.px;
        const dy = opp.py - b.py;
        const d = Math.hypot(dx, dy) || 1e-6;
        b.vx += (dx / d) * sc.rushSpeed;
        b.vy += (dy / d) * sc.rushSpeed;
        opp.hp -= sc.rushDamage; // 直接傷害
        b.rushReadyT = t + sc.rushCooldown;
        events.push({ t, id: b.id, kind: "rush" });
      } else {
        b.rushReadyT = t + 0.5; // 沒中也短暫冷卻，避免邊界抖動狂擲
      }
    }
    b.prevInRange = inRange;
  }
}

/**
 * 場地護牆：陀螺碰到邊界時反彈回場內；
 * 只有撞牆瞬間「向外速度」超過 ringOutSpeed（被打得夠猛）才會衝出護牆 Ring-out。
 */
function resolveWalls(bodies: Body[], arena: ArenaConfig, step: number): void {
  const box = arena.box;
  const sw = arena.softWall;
  for (const b of bodies) {
    if (!b.alive) continue;

    // 綠色實體內牆（M 形 Xtreme Line）：內層實體牆，方形場(box)與圓形場皆適用（與 box 解耦）。
    // 撞到沿外法線反彈、保留切向（沿牆滑）；只在「貼地（z ≤ wallHeight）」才阻擋；
    // 被碰撞擊飛到空中（z > wallHeight）→ 略過＝飛越綠牆，落到外層邊界判定
    // （方形場：四角出界/四邊反彈；圓形場：radius+rim 出界/反彈）。＝唯一出綠框的方式就是被打飛起來。
    if (sw && b.z <= (sw.wallHeight ?? 20)) {
      const sr = Math.hypot(b.px, b.py) || 1e-6;
      const stheta = Math.atan2(b.py, b.px);
      const contact = softWallRadiusAt(sw, stheta) - b.radius;
      if (sr > contact) {
        const n = softWallNormalAt(sw, stheta);
        const vn = b.vx * n.nx + b.vy * n.ny; // 沿外法線速度（>0 向外）
        if (vn > 0) {
          const e = sw.wallBounce ?? arena.wallBounce;
          b.vx -= (1 + e) * vn * n.nx; // 反射法向、保留切向（沿牆滑）
          b.vy -= (1 + e) * vn * n.ny;
          b.spin -= vn * (sw.spinLoss ?? arena.wallSpinLoss);
        }
        const pen = sr - contact; // 沿法線推回牆內（與反射同軸 → 不殘留外速、不抖動）
        b.px -= n.nx * pen;
        b.py -= n.ny * pen;
      }
    }

    // 方形邊界：四邊反彈（保留切向 → 滑向角落）、四角開口出界
    if (box) {
      const H = box.half;
      const lim = H - b.radius;
      const g = box.cornerGap;
      const e = box.wallBounce ?? arena.wallBounce;
      const nearCornerX = Math.abs(b.px) > H - g;
      const nearCornerY = Math.abs(b.py) > H - g;
      const overX = b.px > lim ? 1 : b.px < -lim ? -1 : 0;
      const overY = b.py > lim ? 1 : b.py < -lim ? -1 : 0;
      // 越過邊界、且落在角落開口（該段沒有牆）→ 出界
      if ((overX !== 0 && nearCornerY) || (overY !== 0 && nearCornerX)) {
        b.alive = false;
        b.deadAtStep = step;
        b.deathReason = "ring-out";
        b.ringOutAngle = Math.atan2(b.py, b.px);
        continue;
      }
      // 撞到邊牆（非角落開口）→ 反彈：只反射垂直分量、保留切向速度（沿牆滑）
      if (overX !== 0 && !nearCornerY) {
        b.px = overX > 0 ? lim : -lim;
        const outward = b.vx * overX;
        if (outward > 0) {
          b.spin -= outward * arena.wallSpinLoss;
          b.vx = -b.vx * e;
        }
      }
      if (overY !== 0 && !nearCornerX) {
        b.py = overY > 0 ? lim : -lim;
        const outward = b.vy * overY;
        if (outward > 0) {
          b.spin -= outward * arena.wallSpinLoss;
          b.vy = -b.vy * e;
        }
      }
      continue;
    }

    const r = Math.hypot(b.px, b.py);
    const limit = arena.radius - b.radius; // 陀螺邊緣貼到護牆的中心距離
    if (r <= limit) continue;

    const nx = b.px / (r || 1e-6);
    const ny = b.py / (r || 1e-6);
    const radialVel = b.vx * nx + b.vy * ny; // 向外為正

    // 依「撞牆角度」查所在分區（破口門檻低/反彈不同），未分區處退回全域數值
    const ang = Math.atan2(b.py, b.px);
    const rp = rimAt(arena, ang);

    // 被打得夠猛 → 衝出護牆，判定出界（記下出界角度供計分分區用）
    if (radialVel > rp.ringOutSpeed) {
      b.alive = false;
      b.deadAtStep = step;
      b.deathReason = "ring-out";
      b.ringOutAngle = ang;
      continue;
    }

    // 否則撞牆反彈：拉回界內、反射向外的速度分量、扣少量自旋
    b.px = nx * limit;
    b.py = ny * limit;
    if (radialVel > 0) {
      const e = rp.wallBounce;
      b.vx -= (1 + e) * radialVel * nx;
      b.vy -= (1 + e) * radialVel * ny;
      b.spin -= radialVel * arena.wallSpinLoss;
    }
  }
}

function checkDeaths(bodies: Body[], arena: ArenaConfig, step: number): void {
  for (const b of bodies) {
    if (!b.alive) continue;

    // 血量歸零 → 擊破 KO
    if (b.hp <= 0) {
      b.hp = 0;
      b.alive = false;
      b.deadAtStep = step;
      b.deathReason = "ko";
      continue;
    }

    // 停轉判負
    if (b.spin <= 0) {
      b.spin = 0;
      b.alive = false;
      b.deadAtStep = step;
      b.deathReason = "spin-out";
      continue;
    }

    // 出界判負（圓形場：中心離原點超過半徑）。方形場由 resolveWalls 處理角落出界，這裡略過。
    if (!arena.box) {
      const distFromCenter = Math.hypot(b.px, b.py);
      if (distFromCenter > arena.radius) {
        b.alive = false;
        b.deadAtStep = step;
        b.deathReason = "ring-out";
      }
    }
  }
}

function determineOutcome(bodies: Body[]): {
  winnerId: string | null;
  loserId: string | null;
  reason: WinReason;
} {
  const alive = bodies.filter((b) => b.alive);

  if (alive.length === 1) {
    const winner = alive[0];
    const loser = bodies.find((b) => b !== winner) ?? null;
    return {
      winnerId: winner.id,
      loserId: loser?.id ?? null,
      reason: loser?.deathReason ?? "draw",
    };
  }

  if (alive.length === 0) {
    // 都陣亡：較晚陣亡者獲勝；同一步陣亡則平手
    const sorted = [...bodies].sort((x, y) => y.deadAtStep - x.deadAtStep);
    const [first, second] = sorted;
    if (!second || first.deadAtStep === second.deadAtStep) {
      return { winnerId: null, loserId: null, reason: "draw" };
    }
    return {
      winnerId: first.id,
      loserId: second.id,
      reason: second.deathReason ?? "draw",
    };
  }

  // 多者存活（timeout）：比剩餘體力（續航 + 血量，各自正規化後相加）
  const health = (b: Body) => b.spin / DEFAULT_SCALES.maxSpin + b.hp / Math.max(1, b.maxHp);
  const sorted = [...alive].sort((x, y) => health(y) - health(x));
  const [top, runner] = sorted;
  if (runner && Math.abs(health(top) - health(runner)) < 1e-6) {
    return { winnerId: null, loserId: null, reason: "draw" };
  }
  return {
    winnerId: top.id,
    loserId: runner?.id ?? null,
    reason: "timeout",
  };
}
