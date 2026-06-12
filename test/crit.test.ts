/**
 * 會心一擊 (crit) 與必殺強度 (specialPower) 的驗證：
 *  - 會心：每次碰撞、每側獨立擲骰（機率 = 攻擊者 stats.crit，預設 0.05），中了再 50/50 決定效果——
 *    "dmg"＝受擊側該次傷害 ×1.5（CRIT_DMG_MUL，在 ±10% 浮動與 AGGRESSOR split 之後乘）；"kb"＝受擊側擊退 ×2（能量夾制後補推）。
 *  - rng 消耗固定（每碰撞 4 次、沒中也消耗）→ crit 參數不同不位移 rng 流，
 *    同 seed 的 crit=0 對照組傷害基值逐位元相同 → 可精準驗「恰為 1.5x」。
 *  - specialPower s：必殺冷卻 ×(2−s)、rush/blast/clone 傷害 ×s；dash 回血/回轉、vortex 吸轉不吃 s。
 */
import { describe, it, expect } from "vitest";
import { simulate, HP_BASE } from "../src/physics/engine";
import type { ArenaConfig, BeybladeInit, BeybladeStats } from "../src/physics/types";

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

function stats(over: Partial<BeybladeStats> = {}): BeybladeStats {
  return { attack: 1, defense: 1, stamina: 1, weight: 1, ...over };
}

function body(over: Partial<BeybladeInit> & { id: string }): BeybladeInit {
  return {
    color: "#fff",
    stats: stats(),
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    spin: 1000,
    radius: 20,
    ...over,
  };
}

/** 小場反覆對撞（不出界、不停轉、無碰撞扣血）→ 大量 collisionEvents 取樣用 */
const tightArena = () =>
  neutralArena({ radius: 60, centerPull: 150, swirl: 15, ringOutSpeed: 1e9, friction: 0.3, spinDecayBase: 4 });

describe("會心一擊 (crit)", () => {
  /** 等屬性正面對撞（單次碰撞後分開、不再相撞）：crit 為兩側共同的會心機率 */
  const headOn = (crit: number, seed: number) =>
    simulate(
      [
        body({ id: "A", position: { x: -30, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6, stats: stats({ crit }) }),
        body({ id: "B", position: { x: 30, y: 0 }, velocity: { x: -200, y: 0 }, spin: 1e6, stats: stats({ crit }) }),
      ],
      { dt: 1 / 60, maxTime: 1, arena: neutralArena({ restitution: 0.5, collisionSpinLoss: 1, radius: 1e6 }), seed },
    );

  it("確定性：同 seed 同輸入 → critA/critB 序列與 frames 完全一致", () => {
    const mk = (seed: number) =>
      simulate(
        [
          body({ id: "A", position: { x: -25, y: 0 }, velocity: { x: 200, y: 60 }, spin: 5000, stats: stats({ crit: 0.5 }) }),
          body({ id: "B", position: { x: 25, y: 0 }, velocity: { x: -200, y: -60 }, spin: 5000, stats: stats({ crit: 0.5 }) }),
        ],
        { dt: 1 / 60, maxTime: 6, arena: tightArena(), seed },
      );
    const r1 = mk(7);
    const r2 = mk(7);
    // crit 0.5 + 大量碰撞 → 序列裡確實有會心（測試才有鑑別力）
    expect(r1.collisionEvents.some((e) => e.critA || e.critB)).toBe(true);
    expect(JSON.stringify(r1.collisionEvents)).toBe(JSON.stringify(r2.collisionEvents));
    expect(JSON.stringify(r1.frames)).toBe(JSON.stringify(r2.frames));
  });

  it("crit=1.0 極端值：全部會心；dmg 型恰為 crit=0 對照組的 1.5x、kb 型傷害不變", () => {
    let sawDmg = 0;
    let sawKb = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const exp = headOn(1.0, seed);
      const ctrl = headOn(0, seed); // 同 seed 對照組：rng 消耗固定 → 第一次碰撞傷害基值逐位元相同
      // crit=1 → 每筆事件兩側都會心
      for (const e of exp.collisionEvents) {
        expect(e.critA).toBeDefined();
        expect(e.critB).toBeDefined();
      }
      // 只比第一筆事件（之後 kb 會心改變軌跡 → 兩組後續碰撞不可比）
      const e = exp.collisionEvents[0];
      const c = ctrl.collisionEvents[0];
      expect(e).toBeDefined();
      expect(c).toBeDefined();
      expect(e.impact).toBe(c.impact); // 碰撞前軌跡相同 → impact 逐位元一致
      if (e.critA === "dmg") {
        expect(e.dmgA).toBe(c.dmgA! * 1.5); // 浮動之後 ×1.5 → 恰為對照組 1.5 倍（浮動值同 seed 同位置）
        sawDmg++;
      } else {
        expect(e.dmgA).toBe(c.dmgA); // kb 型不動傷害
        sawKb++;
      }
      if (e.critB === "dmg") {
        expect(e.dmgB).toBe(c.dmgB! * 1.5);
        sawDmg++;
      } else {
        expect(e.dmgB).toBe(c.dmgB);
        sawKb++;
      }
    }
    // 50/50 擲骰 → 兩種效果都要取樣到
    expect(sawDmg).toBeGreaterThan(0);
    expect(sawKb).toBeGreaterThan(0);
  });

  it("kb 型會心：受擊側被彈得更遠（夾制後補推）；dmg 型不影響軌跡", () => {
    const lastX = (r: ReturnType<typeof headOn>, id: string) =>
      r.frames[r.frames.length - 1].bodies.find((x) => x.id === id)!.x;
    let checkedKb = 0;
    let checkedDmg = 0;
    for (let seed = 1; seed <= 40 && (checkedKb < 3 || checkedDmg < 3); seed++) {
      const exp = headOn(1.0, seed);
      const ctrl = headOn(0, seed);
      const e = exp.collisionEvents[0];
      // A 朝 +x 撞、會心擊退沿 -x → A 吃 kb 會心會被彈得更靠 -x（單次碰撞場景、無後續干擾）
      if (e.critA === "kb") {
        expect(lastX(exp, "A")).toBeLessThan(lastX(ctrl, "A") - 5);
        checkedKb++;
      } else {
        // A 只吃 dmg 會心 → A 自身運動完全不變（傷害不回饋物理）
        expect(lastX(exp, "A")).toBe(lastX(ctrl, "A"));
        checkedDmg++;
      }
    }
    expect(checkedKb).toBeGreaterThan(0);
    expect(checkedDmg).toBeGreaterThan(0);
  });

  it("crit=0 → 多 seed 大量碰撞零會心事件", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = simulate(
        [
          body({ id: "A", position: { x: -25, y: 0 }, velocity: { x: 200, y: 60 }, spin: 5000, stats: stats({ crit: 0 }) }),
          body({ id: "B", position: { x: 25, y: 0 }, velocity: { x: -200, y: -60 }, spin: 5000, stats: stats({ crit: 0 }) }),
        ],
        { dt: 1 / 60, maxTime: 6, arena: tightArena(), seed },
      );
      expect(r.collisionEvents.length).toBeGreaterThan(0);
      for (const e of r.collisionEvents) {
        expect(e.critA).toBeUndefined();
        expect(e.critB).toBeUndefined();
      }
    }
  });

  it("預設機率 0.05：大樣本（多 seed 單次碰撞）會心率落在 3%~7%", () => {
    // 單次正面對撞 × 2000 seeds → 每場恰好兩側各擲一次（乾淨的 Bernoulli 取樣，4000 側）
    let sides = 0;
    let crits = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const r = simulate(
        [
          // 未設 crit → 引擎預設 0.05
          body({ id: "A", position: { x: -30, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6 }),
          body({ id: "B", position: { x: 30, y: 0 }, velocity: { x: -200, y: 0 }, spin: 1e6 }),
        ],
        { dt: 1 / 60, maxTime: 0.25, arena: neutralArena({ restitution: 0.5, radius: 1e6 }), seed },
      );
      const e = r.collisionEvents[0];
      expect(e).toBeDefined();
      sides += 2; // 每筆事件兩側各擲一次
      if (e.critA) crits++;
      if (e.critB) crits++;
    }
    expect(sides).toBe(4000); // p=0.05、N=4000 → 標準差 ≈0.34pp，3%~7% 是 ±5.8σ（不靠運氣）
    const rate = crits / sides;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.07);
  });
});

describe("必殺強度 (specialPower)", () => {
  it("dash 冷卻 ×(2−s)：s=1.2 → 事件間隔縮為 0.8 倍、發動次數變多", () => {
    // 自旋恆低於門檻 + 必中 + 無次數限制 → dash 每過冷卻就發動 → 事件間隔 = 冷卻長度（確定性量測）
    const run = (specialPower: number) =>
      simulate(
        [
          body({ id: "A", position: { x: -800, y: 0 }, spin: 200, special: "dash", stats: stats({ specialPower }) }),
          body({ id: "B", position: { x: 800, y: 0 }, spin: 1e6 }),
        ],
        {
          dt: 1 / 60,
          maxTime: 9,
          arena: neutralArena({ radius: 5000 }),
          seed: 1,
          special: { graceTime: 0, dashChance: 1, dashTriggerSpin: 0.3, dashMaxUses: 99, dashCooldown: 2, dashSpinRestore: 0, dashAccel: 0 },
        },
      );
    const gaps = (s: number) => {
      const ts = run(s).specialEvents.filter((e) => e.kind === "dash" && e.id === "A").map((e) => e.t);
      expect(ts.length).toBeGreaterThan(2);
      return ts.slice(1).map((t, i) => t - ts[i]);
    };
    const dt = 1 / 60;
    for (const g of gaps(1.0)) expect(Math.abs(g - 2.0)).toBeLessThanOrEqual(dt + 1e-9); // 基準：間隔 = 冷卻 2s
    for (const g of gaps(1.2)) expect(Math.abs(g - 1.6)).toBeLessThanOrEqual(dt + 1e-9); // s=1.2 → 2×(2−1.2)=1.6s
    expect(gaps(1.2).length).toBeGreaterThan(gaps(1.0).length); // 冷卻短 → 同時長內發動更多次
  });

  it("rush 傷害 ×s：s=1.2 對 s=1.0 的扣血比例 ≈ 1.2", () => {
    // rushSpeed=0（不動物理）+ collisionSpinLoss=0（碰撞零傷）+ crit=0 → B 的失血只來自 rushDamage×s
    const run = (specialPower: number) =>
      simulate(
        [
          body({ id: "A", position: { x: -300, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6, special: "rush", stats: stats({ crit: 0, specialPower }) }),
          body({ id: "B", position: { x: 0, y: 0 }, spin: 1e6, stats: stats({ crit: 0 }) }),
        ],
        {
          dt: 1 / 60,
          maxTime: 3,
          arena: neutralArena({ radius: 5000 }),
          seed: 5,
          special: { graceTime: 0, rushChance: 1, rushRange: 110, rushSpeed: 0, rushDamage: 100, rushMaxUses: 1 },
        },
      );
    const lossB = (s: number) => {
      const r = run(s);
      expect(r.specialEvents.filter((e) => e.kind === "rush" && e.id === "A").length).toBe(1);
      return HP_BASE - r.frames[r.frames.length - 1].bodies.find((x) => x.id === "B")!.hp;
    };
    expect(lossB(1.0)).toBeCloseTo(100, 6);
    expect(lossB(1.2)).toBeCloseTo(120, 6);
    expect(lossB(1.2) / lossB(1.0)).toBeCloseTo(1.2, 6);
  });

  it("blast 傷害 ×s：s=1.2 對 s=1.0 的扣血比例 ≈ 1.2", () => {
    // blastPush=0（不動物理）+ collisionSpinLoss=0 + crit=0 → B 的失血只來自 blastDamage×s
    const run = (specialPower: number) =>
      simulate(
        [
          body({ id: "A", position: { x: -30, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6, special: "blast", stats: stats({ crit: 0, specialPower }) }),
          body({ id: "B", position: { x: 30, y: 0 }, velocity: { x: -200, y: 0 }, spin: 1e6, stats: stats({ crit: 0 }) }),
        ],
        {
          dt: 1 / 60,
          maxTime: 1,
          arena: neutralArena({ restitution: 0.5, radius: 1e6 }),
          seed: 3,
          special: { graceTime: 0, blastChance: 1, blastImpactMin: 50, blastPush: 0, blastDamage: 100, blastMaxUses: 1 },
        },
      );
    const lossB = (s: number) => {
      const r = run(s);
      expect(r.specialEvents.filter((e) => e.kind === "blast" && e.id === "A").length).toBe(1);
      return HP_BASE - r.frames[r.frames.length - 1].bodies.find((x) => x.id === "B")!.hp;
    };
    expect(lossB(1.0)).toBeCloseTo(100, 6);
    expect(lossB(1.2)).toBeCloseTo(120, 6);
  });

  it("s=1.0 與未設 specialPower → 行為完全一致（預設不變既有平衡）", () => {
    const run = (st: BeybladeStats) =>
      simulate(
        [
          body({ id: "A", position: { x: -300, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6, special: "rush", stats: st }),
          body({ id: "B", position: { x: 0, y: 0 }, spin: 1e6 }),
        ],
        { dt: 1 / 60, maxTime: 3, arena: neutralArena({ radius: 5000 }), seed: 9, special: { graceTime: 0, rushChance: 1 } },
      );
    const a = run(stats()); // 未設 → 預設 1.0
    const b = run(stats({ specialPower: 1.0 }));
    expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames));
    expect(JSON.stringify(a.specialEvents)).toBe(JSON.stringify(b.specialEvents));
    expect(JSON.stringify(a.collisionEvents)).toBe(JSON.stringify(b.collisionEvents));
  });
});
