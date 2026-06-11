/**
 * 引擎核心改造的驗證：傷害浮動 ±10%、CollisionEvent 擴充（aId/bId/dmgA/dmgB）、
 * 必殺技開場緩衝 graceTime、dash 回血夾制、計分新制 roundPoints。
 */
import { describe, it, expect } from "vitest";
import { simulate, DEFAULT_ARENA, HP_BASE } from "../src/physics/engine";
import type { ArenaConfig, BeybladeInit, SimResult, WinReason } from "../src/physics/types";
import { roundPoints } from "../src/game/scoring";

/** 把場地參數清成「中性」，方便單獨驗證某一條規則 */
function neutralArena(overrides: Partial<ArenaConfig> = {}): ArenaConfig {
  return {
    radius: 300,
    centerPull: 0,
    friction: 0,
    swirl: 0,
    spinDecayBase: 0,
    restitution: 0,
    collisionSpinLoss: 0,
    knockback: 1,
    oppSpinBonus: 1,
    wallBounce: 0,
    wallSpinLoss: 0,
    ringOutSpeed: 100,
    gravity: 0,
    jumpPop: 0,
    jumpOverHeight: 9999,
    ...overrides,
  };
}

function body(over: Partial<BeybladeInit> & { id: string }): BeybladeInit {
  return {
    color: "#fff",
    stats: { attack: 1, defense: 1, stamina: 1, weight: 1 },
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    spin: 1000,
    radius: 20,
    ...over,
  };
}

describe("傷害浮動 ±10% (damage variance)", () => {
  // 等屬性 + 同旋向 + collisionSpinLoss=1 → 基準傷害 = impact × 1 × 1，
  // 浮動後 dmg / impact 必落在 [0.9, 1.1]。
  const mk = (seed: number) =>
    simulate(
      [
        body({ id: "A", position: { x: -30, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6, radius: 20 }),
        body({ id: "B", position: { x: 30, y: 0 }, velocity: { x: -200, y: 0 }, spin: 1e6, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 1, arena: neutralArena({ restitution: 0.5, collisionSpinLoss: 1, radius: 1e6 }), seed },
    );

  it("多 seed 取樣：dmg/基準值 全部落在 0.9~1.1，且確實有浮動分佈", () => {
    const ratios: number[] = [];
    let asymmetric = false;
    for (let s = 1; s <= 40; s++) {
      for (const e of mk(s).collisionEvents) {
        ratios.push(e.dmgA! / e.impact);
        ratios.push(e.dmgB! / e.impact);
        if (Math.abs(e.dmgA! - e.dmgB!) > 1e-9) asymmetric = true;
      }
    }
    expect(ratios.length).toBeGreaterThan(0);
    for (const r of ratios) {
      expect(r).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(r).toBeLessThanOrEqual(1.1 + 1e-9);
    }
    // 不是恆等於 1：低/高側都有取樣到（證明浮動真的在動）
    expect(Math.min(...ratios)).toBeLessThan(0.98);
    expect(Math.max(...ratios)).toBeGreaterThan(1.02);
    // 兩側各自獨立擲骰 → 完全對稱輸入也會打出不對稱傷害（避免完全平手）
    expect(asymmetric).toBe(true);
  });

  it("確定性：同 seed 同輸入 → collisionEvents 的 dmg 序列完全一致", () => {
    const a = mk(7);
    const b = mk(7);
    expect(a.collisionEvents.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.collisionEvents)).toBe(JSON.stringify(b.collisionEvents));
    // dmg 序列逐位元一致（toBe = Object.is）
    for (let i = 0; i < a.collisionEvents.length; i++) {
      expect(a.collisionEvents[i].dmgA).toBe(b.collisionEvents[i].dmgA);
      expect(a.collisionEvents[i].dmgB).toBe(b.collisionEvents[i].dmgB);
    }
  });

  it("CollisionEvent 帶 aId/bId（A=事件中第一顆）", () => {
    const r = mk(3);
    const e = r.collisionEvents[0];
    expect(e.aId).toBe("A");
    expect(e.bId).toBe("B");
    expect(e.dmgA).toBeGreaterThan(0);
    expect(e.dmgB).toBeGreaterThan(0);
  });
});

describe("必殺技開場緩衝 (graceTime)", () => {
  // A=blast（resolveCollisions 內的閘門）、B=dash（applySpecials 內的閘門），必中設定 + 小場反覆對撞。
  const GRACE = 1.0;
  const run = (graceTime: number) =>
    simulate(
      [
        body({ id: "A", position: { x: -25, y: 0 }, velocity: { x: 200, y: 60 }, spin: 5000, radius: 20, special: "blast" }),
        body({ id: "B", position: { x: 25, y: 0 }, velocity: { x: -200, y: -60 }, spin: 200, radius: 20, special: "dash" }),
      ],
      {
        dt: 1 / 60,
        maxTime: 6,
        arena: neutralArena({ radius: 60, centerPull: 150, swirl: 15, ringOutSpeed: 1e9, friction: 0.3, spinDecayBase: 4 }),
        seed: 4,
        special: {
          graceTime,
          blastChance: 1, blastImpactMin: 5, blastPush: 0, blastDamage: 0, blastCooldown: 0.05, blastMaxUses: 99,
          dashChance: 1, dashTriggerSpin: 0.3, dashCooldown: 0.05, dashMaxUses: 99, dashAccel: 0, dashSpinRestore: 0,
        },
      },
    );

  it("對照組 graceTime=0：blast 與 dash 都在開場 1 秒內發動", () => {
    const r = run(0);
    expect(r.specialEvents.some((e) => e.kind === "blast" && e.t < GRACE)).toBe(true);
    expect(r.specialEvents.some((e) => e.kind === "dash" && e.t < GRACE)).toBe(true);
  });

  it("graceTime 內無任何 specialEvents；緩衝結束後照常觸發", () => {
    const r = run(GRACE);
    expect(r.specialEvents.some((e) => e.kind === "blast")).toBe(true); // 緩衝後照常觸發
    expect(r.specialEvents.some((e) => e.kind === "dash")).toBe(true);
    for (const e of r.specialEvents) expect(e.t).toBeGreaterThanOrEqual(GRACE); // 緩衝內零事件
  });
});

describe("dash 回血 (heal)", () => {
  const maxHp = HP_BASE; // weight 1 × HP_BASE

  it("滿血觸發 → heal 夾到 0、血量不超過 maxHp", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: -500, y: 0 }, spin: 200, radius: 20, special: "dash" }), // 低自旋直接觸發
        body({ id: "B", position: { x: 500, y: 0 }, spin: 1e6, radius: 20 }),
      ],
      {
        dt: 1 / 60,
        maxTime: 1,
        arena: neutralArena({ radius: 5000 }),
        seed: 1,
        special: { graceTime: 0, dashChance: 1, dashTriggerSpin: 0.3, dashMaxUses: 1, dashAccel: 0 },
      },
    );
    const ev = r.specialEvents.find((e) => e.kind === "dash" && e.id === "A");
    expect(ev).toBeDefined();
    expect(ev!.heal).toBe(0); // 滿血 → 夾制後回 0
    for (const f of r.frames) {
      expect(f.bodies.find((x) => x.id === "A")!.hp).toBeLessThanOrEqual(maxHp + 1e-9); // 永不超過 maxHp
    }
  });

  it("先受傷再觸發 → 回復 10% maxHp、事件帶 heal 欄位、不超過 maxHp", () => {
    // 先對撞掉血（impact ~400 → 扣 ~400），A 自旋 1s 後降到門檻下 → dash 觸發回血
    const r = simulate(
      [
        body({ id: "A", position: { x: -30, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1500, radius: 20, special: "dash" }),
        body({ id: "B", position: { x: 30, y: 0 }, velocity: { x: -200, y: 0 }, spin: 1e9, radius: 20 }),
      ],
      {
        dt: 1 / 60,
        maxTime: 2,
        arena: neutralArena({ restitution: 0.5, collisionSpinLoss: 1, radius: 1e6, spinDecayBase: 600 }),
        seed: 2,
        special: { graceTime: 0, dashChance: 1, dashTriggerSpin: 0.3, dashMaxUses: 1, dashAccel: 0, dashSpinRestore: 0 },
      },
    );
    const ev = r.specialEvents.find((e) => e.kind === "dash" && e.id === "A");
    expect(ev).toBeDefined();
    expect(ev!.heal).toBeGreaterThan(0); // 有缺血 → 真的回了
    expect(ev!.heal).toBeLessThanOrEqual(maxHp * 0.1 + 1e-9); // 回血上限 = 10% maxHp
    const hpA = (i: number) => r.frames[i].bodies.find((x) => x.id === "A")!.hp;
    const evIdx = r.frames.findIndex((f) => f.t >= ev!.t);
    expect(hpA(evIdx)).toBeGreaterThan(hpA(evIdx - 1)); // 觸發瞬間血量跳升
    for (const f of r.frames) {
      expect(f.bodies.find((x) => x.id === "A")!.hp).toBeLessThanOrEqual(maxHp + 1e-9); // 永不超過 maxHp
    }
  });
});

describe("同步雙亡 tie-break（超殺深度）", () => {
  /** 兩顆等屬性對撞的共用組裝：對稱輸入，差異只來自傷害 ±10% 獨立浮動 */
  const pair = (spin: number) => [
    body({ id: "A", position: { x: -30, y: 0 }, velocity: { x: 200, y: 0 }, spin }),
    body({ id: "B", position: { x: 30, y: 0 }, velocity: { x: -200, y: 0 }, spin }),
  ];
  /** 各方累計承受傷害（aId 恆為 "A"：dmgA 扣 A、dmgB 扣 B） */
  const dmgTaken = (r: SimResult) => {
    let a = 0;
    let b = 0;
    for (const e of r.collisionEvents) {
      a += e.dmgA ?? 0;
      b += e.dmgB ?? 0;
    }
    return { a, b };
  };

  it("同步雙擊破：不再平手，hp/maxHp 較高（較不負＝承傷較少）者勝、reason 維持 ko", () => {
    // collisionSpinLoss=4 → 單次對撞 dmg ≈ 400×4×(0.9~1.1) = 1440~1760 > maxHp 1100 → 同一步雙雙歸零
    let draws = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = simulate(pair(1e6), {
        dt: 1 / 60,
        maxTime: 2,
        arena: neutralArena({ restitution: 0.5, collisionSpinLoss: 4, radius: 1e6 }),
        seed,
      });
      // 確實是同一步雙亡（兩筆死亡事件、同時刻、皆 ko）
      expect(r.deathEvents.length).toBe(2);
      expect(r.deathEvents[0].t).toBe(r.deathEvents[1].t);
      expect(r.reason).toBe("ko");
      if (!r.winnerId) {
        draws++;
        continue;
      }
      // 勝者與超殺深度一致：等 maxHp 滿血開局 → 承傷較少者 hp 較高（較不負）→ 獲勝
      const d = dmgTaken(r);
      expect(d.a).not.toBe(d.b); // ±10% 獨立浮動 → 兩側承傷必然不同
      expect(r.winnerId).toBe(d.a < d.b ? "A" : "B");
      expect(r.loserId).toBe(d.a < d.b ? "B" : "A");
    }
    expect(draws).toBe(0); // 平手率趨近 0（浮動下兩側 hp 完全相等是理論事件）
  });

  it("同步雙停轉：比剩餘血量比例（承傷較少者勝）、reason 維持 spin-out", () => {
    // 等續航等初始自旋 + 純時間衰減 → 必然同一步雙停轉；先對撞一次製造 hp 差
    let draws = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = simulate(pair(1000), {
        dt: 1 / 60,
        maxTime: 5,
        arena: neutralArena({ restitution: 0.5, collisionSpinLoss: 1, radius: 1e6, spinDecayBase: 600 }),
        seed,
      });
      expect(r.deathEvents.length).toBe(2);
      expect(r.deathEvents[0].t).toBe(r.deathEvents[1].t);
      expect(r.reason).toBe("spin-out");
      if (!r.winnerId) {
        draws++;
        continue;
      }
      const d = dmgTaken(r);
      expect(r.winnerId).toBe(d.a < d.b ? "A" : "B");
    }
    expect(draws).toBe(0);
  });

  it("同步雙出界：以 hp 比例 tie-break、reason 維持 ring-out（勝者得 2 分）", () => {
    // restitution=1 → 對撞後對稱彈開各 200，同一步衝出護牆；對撞傷害 ±10% 製造 hp 差
    let draws = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = simulate(pair(1e6), {
        dt: 1 / 60,
        maxTime: 5,
        arena: neutralArena({ restitution: 1, collisionSpinLoss: 1, radius: 300, ringOutSpeed: 5 }),
        seed,
      });
      expect(r.deathEvents.length).toBe(2);
      expect(r.deathEvents[0].t).toBe(r.deathEvents[1].t);
      expect(r.reason).toBe("ring-out");
      if (!r.winnerId) {
        draws++;
        continue;
      }
      const d = dmgTaken(r);
      expect(r.winnerId).toBe(d.a < d.b ? "A" : "B");
      expect(roundPoints(DEFAULT_ARENA, r)).toBe(2); // winnerId 有值 → ring-out 2 分語意由 scoring 自然處理
    }
    expect(draws).toBe(0);
  });

  it("確定性：tie-break 不引入新隨機 → 同 seed 同輸入結果完全一致", () => {
    const cfg = {
      dt: 1 / 60,
      maxTime: 2,
      arena: neutralArena({ restitution: 0.5, collisionSpinLoss: 4, radius: 1e6 }),
      seed: 11,
    };
    const r1 = simulate(pair(1e6), cfg);
    const r2 = simulate(pair(1e6), cfg);
    expect(r1.winnerId).toBe(r2.winnerId);
    expect(r1.loserId).toBe(r2.loserId);
    expect(r1.reason).toBe(r2.reason);
    expect(JSON.stringify(r1.frames)).toBe(JSON.stringify(r2.frames));
  });
});

describe("計分新制 (roundPoints)", () => {
  const res = (winnerId: string | null, reason: WinReason): SimResult => ({
    winnerId,
    loserId: winnerId ? "B" : null,
    reason,
    frames: [],
    steps: 0,
    duration: 0,
    slowmoCues: [],
    specialEvents: [],
    collisionEvents: [],
    deathEvents: [],
    ringOutAngle: reason === "ring-out" ? Math.PI / 2 : null,
  });

  it("擊破 ko = 1 分", () => {
    expect(roundPoints(DEFAULT_ARENA, res("A", "ko"))).toBe(1);
  });

  it("停轉 spin-out = 1 分", () => {
    expect(roundPoints(DEFAULT_ARENA, res("A", "spin-out"))).toBe(1);
  });

  it("出界 ring-out 一律 2 分（不吃 box.cornerScore / rim 落點）", () => {
    expect(roundPoints(DEFAULT_ARENA, res("A", "ring-out"))).toBe(2);
    // 方形場 cornerScore 設 3 也不影響（一律 2）
    const boxArena: ArenaConfig = { ...DEFAULT_ARENA, box: { half: 230, cornerGap: 60, cornerScore: 3 } };
    expect(roundPoints(boxArena, res("A", "ring-out"))).toBe(2);
    // 圓形場高分缺口（rim pocket score 3）也不影響（一律 2）
    const rimArena: ArenaConfig = { ...DEFAULT_ARENA, rim: [{ angle: Math.PI / 2, half: 0.42, kind: "pocket", score: 3 }] };
    expect(roundPoints(rimArena, res("A", "ring-out"))).toBe(2);
  });

  it("timeout 有勝者 = 1 分", () => {
    expect(roundPoints(DEFAULT_ARENA, res("A", "timeout"))).toBe(1);
  });

  it("平手（無勝者）= 0 分", () => {
    expect(roundPoints(DEFAULT_ARENA, res(null, "draw"))).toBe(0);
    expect(roundPoints(DEFAULT_ARENA, res(null, "ring-out"))).toBe(0); // 同步雙亡等無勝者情境也是 0
  });
});
