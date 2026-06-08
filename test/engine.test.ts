import { describe, it, expect } from "vitest";
import { simulate, buildInit, DEFAULT_ARENA } from "../src/physics/engine";
import type { ArenaConfig, BeybladeInit, SimConfig } from "../src/physics/types";
import { STAT_PRESETS } from "../src/physics/presets";

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

describe("確定性 (determinism)", () => {
  it("相同輸入 + 相同 seed → 完全一致的軌跡", () => {
    const arena = DEFAULT_ARENA;
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 30, arena, seed: 42, sampleEvery: 1 };
    const inits = [
      buildInit(
        { id: "A", color: "#f00", stats: STAT_PRESETS.attack, angleDeg: 0, power: 0.8, spinPower: 0.9, startAngleDeg: 180 },
        arena,
      ),
      buildInit(
        { id: "B", color: "#00f", stats: STAT_PRESETS.defense, angleDeg: 180, power: 0.7, spinPower: 0.9, startAngleDeg: 0 },
        arena,
      ),
    ];
    const r1 = simulate(inits, cfg);
    const r2 = simulate(inits, cfg);
    expect(r1.winnerId).toBe(r2.winnerId);
    expect(r1.reason).toBe(r2.reason);
    expect(JSON.stringify(r1.frames)).toBe(JSON.stringify(r2.frames));
  });
});

describe("停轉判負 (spin-out)", () => {
  it("自旋先歸零的一方落敗", () => {
    const arena = neutralArena({ spinDecayBase: 100 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 5, arena };
    // 兩者相距很遠不會碰撞；A 自旋少 → 先停轉
    const inits = [
      body({ id: "A", position: { x: -1000, y: 0 }, spin: 50 }),
      body({ id: "B", position: { x: 1000, y: 0 }, spin: 5000 }),
    ];
    const r = simulate(inits, { ...cfg, arena: neutralArena({ spinDecayBase: 100, radius: 5000 }) });
    expect(r.winnerId).toBe("B");
    expect(r.loserId).toBe("A");
    expect(r.reason).toBe("spin-out");
  });
});

describe("出界判負 (ring-out)", () => {
  it("被打出場地半徑的一方落敗", () => {
    const arena = neutralArena({ radius: 300 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 2, arena };
    // A 以高速往 +x 飛出界；B 靜止在中心附近，自旋極高不會停轉
    const inits = [
      body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 2000, y: 0 }, spin: 100000 }),
      body({ id: "B", position: { x: 0, y: 40 }, velocity: { x: 0, y: 0 }, spin: 100000 }),
    ];
    const r = simulate(inits, cfg);
    expect(r.winnerId).toBe("B");
    expect(r.loserId).toBe("A");
    expect(r.reason).toBe("ring-out");
    // A 往 +x 飛出 → 出界角度 ~0（供落點分區計分）
    expect(r.ringOutAngle).not.toBeNull();
    expect(Math.abs(r.ringOutAngle as number)).toBeLessThan(0.3);
  });
});

describe("護牆反彈 (wall bounce)", () => {
  it("向外速度低於門檻時撞牆反彈、不出界", () => {
    const arena = neutralArena({ radius: 300, ringOutSpeed: 5000, wallBounce: 1 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 4, arena };
    const inits = [
      body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1_000_000, radius: 20 }),
      body({ id: "B", position: { x: 0, y: -150 }, velocity: { x: 0, y: 0 }, spin: 1_000_000, radius: 20 }),
    ];
    const r = simulate(inits, cfg);
    const limit = 300 - 20;
    const xs = r.frames.map((f) => f.bodies.find((x) => x.id === "A")!.x);
    const maxX = Math.max(...xs);
    const lastA = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!;
    expect(lastA.alive).toBe(true); // 沒有出界
    expect(maxX).toBeLessThanOrEqual(limit + 1); // 沒有穿牆
    expect(maxX).toBeGreaterThan(limit - 10); // 確實有撞到牆
    expect(lastA.x).toBeLessThan(maxX); // 反彈回場內
  });
});

describe("後續演出 (follow-through)", () => {
  it("出界後繼續演算，敗方持續飛出、勝負已鎖定，且有慢動作觸發點", () => {
    const arena = neutralArena({ radius: 300, ringOutSpeed: 100 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 2, arena, followThroughTime: 1 };
    const inits = [
      body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 2000, y: 0 }, spin: 1e9 }),
      body({ id: "B", position: { x: 0, y: 40 }, velocity: { x: 0, y: 0 }, spin: 1e9 }),
    ];
    const r = simulate(inits, cfg);
    const lastA = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!;
    expect(r.winnerId).toBe("B"); // 勝負鎖定，不因後續演出改變
    expect(r.reason).toBe("ring-out");
    expect(lastA.alive).toBe(false);
    expect(lastA.x).toBeGreaterThan(500); // 出界後仍持續飛出（殘餘運動）
    expect(r.slowmoCues.length).toBeGreaterThan(0); // 終結瞬間有記錄慢動作觸發點
    expect(r.duration).toBeGreaterThan(0.3); // 含後續演出時長
  });
});

describe("超時比續航 (timeout)", () => {
  it("時間到雙方仍在場上，剩餘自旋多者勝", () => {
    const arena = neutralArena({ radius: 5000, spinDecayBase: 100 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 1, arena };
    const inits = [
      body({ id: "A", position: { x: -2000, y: 0 }, spin: 1000, stats: { attack: 1, defense: 1, stamina: 2, weight: 1 } }),
      body({ id: "B", position: { x: 2000, y: 0 }, spin: 1000, stats: { attack: 1, defense: 1, stamina: 1, weight: 1 } }),
    ];
    const r = simulate(inits, cfg);
    expect(r.reason).toBe("timeout");
    // A 續航高 → 衰減慢 → 剩餘自旋多 → 勝
    expect(r.winnerId).toBe("A");
  });
});

describe("碰撞分離 (collision)", () => {
  it("正面對撞後兩者被彈開、不再重疊", () => {
    const arena = neutralArena({ restitution: 1 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 0.5, arena: neutralArena({ restitution: 1, radius: 5000 }) };
    const inits = [
      body({ id: "A", position: { x: -15, y: 0 }, velocity: { x: 100, y: 0 }, spin: 100000, radius: 20 }),
      body({ id: "B", position: { x: 15, y: 0 }, velocity: { x: -100, y: 0 }, spin: 100000, radius: 20 }),
    ];
    const r = simulate(inits, cfg);
    const last = r.frames[r.frames.length - 1];
    const a = last.bodies.find((b) => b.id === "A")!;
    const b = last.bodies.find((b) => b.id === "B")!;
    // 對撞後 A 應往 -x、B 往 +x 分離
    expect(a.x).toBeLessThan(-15);
    expect(b.x).toBeGreaterThan(15);
    // 不再重疊
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    expect(dist).toBeGreaterThanOrEqual(40 - 1e-6);
    void arena;
  });
});

describe("攻防影響 (stats)", () => {
  it("高攻擊陀螺對撞低防禦對手，造成更多自旋傷害", () => {
    const arena = neutralArena({ restitution: 0.5, collisionSpinLoss: 1, radius: 5000 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 0.5, arena };
    const inits = [
      body({
        id: "ATK",
        position: { x: -15, y: 0 },
        velocity: { x: 200, y: 0 },
        spin: 1000,
        stats: { attack: 2, defense: 1, stamina: 1, weight: 1 },
      }),
      body({
        id: "DEF",
        position: { x: 15, y: 0 },
        velocity: { x: -200, y: 0 },
        spin: 1000,
        stats: { attack: 0.5, defense: 0.5, stamina: 1, weight: 1 },
      }),
    ];
    const r = simulate(inits, cfg);
    const last = r.frames[r.frames.length - 1];
    const atk = last.bodies.find((b) => b.id === "ATK")!;
    const def = last.bodies.find((b) => b.id === "DEF")!;
    // 低防禦的一方應損失較多血量（碰撞改扣血量）
    expect(def.hp).toBeLessThan(atk.hp);
  });
});

describe("旋向 (spin direction)", () => {
  it("反向旋轉對撞造成的自旋傷害大於同向", () => {
    const cfg = (over = {}) =>
      ({ dt: 1 / 60, maxTime: 0.5, arena: neutralArena({ restitution: 0.5, collisionSpinLoss: 1, oppSpinBonus: 2, radius: 5000, ...over }) }) as const;
    const make = (dirB: 1 | -1) => [
      body({ id: "A", position: { x: -15, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1000, spinDir: 1 }),
      body({ id: "B", position: { x: 15, y: 0 }, velocity: { x: -200, y: 0 }, spin: 1000, spinDir: dirB }),
    ];
    const same = simulate(make(1), cfg());
    const opp = simulate(make(-1), cfg());
    const hpOf = (r: typeof same, id: string) =>
      r.frames[r.frames.length - 1].bodies.find((x) => x.id === id)!.hp;
    // 反向（一正一反）剩餘血量應低於同向（傷害更大）
    expect(hpOf(opp, "A")).toBeLessThan(hpOf(same, "A"));
    expect(hpOf(opp, "B")).toBeLessThan(hpOf(same, "B"));
  });
});

describe("2.5D 彈跳 (jump)", () => {
  it("猛烈碰撞會把陀螺頂上天 (z > 0)，且最終落回地面", () => {
    const arena = neutralArena({ restitution: 0.5, gravity: 800, jumpPop: 1, jumpOverHeight: 9999, radius: 5000 });
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 3, arena };
    const inits = [
      body({ id: "A", position: { x: -15, y: 0 }, velocity: { x: 250, y: 0 }, spin: 1_000_000, radius: 20 }),
      body({ id: "B", position: { x: 15, y: 0 }, velocity: { x: -250, y: 0 }, spin: 1_000_000, radius: 20 }),
    ];
    const r = simulate(inits, cfg);
    const maxZ = Math.max(...r.frames.map((f) => f.bodies.find((x) => x.id === "A")!.z));
    const lastZ = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!.z;
    expect(maxZ).toBeGreaterThan(0); // 有跳起來
    expect(lastZ).toBe(0); // 重力把它拉回地面
  });

  it("高度差過大時兩者互不碰撞（從上方掠過）", () => {
    // gravity 0 讓高度維持；A 墊高到 100、jumpOverHeight 10 → 不應碰撞
    const arena = (jumpOverHeight: number) =>
      neutralArena({ restitution: 1, gravity: 0, jumpOverHeight, radius: 5000 });
    const cfg = (joh: number): SimConfig => ({ dt: 1 / 60, maxTime: 0.5, arena: arena(joh) });
    const make = () => [
      body({ id: "A", position: { x: -15, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6, radius: 20, z: 100 }),
      body({ id: "B", position: { x: 15, y: 0 }, velocity: { x: 0, y: 0 }, spin: 1e6, radius: 20, z: 0 }),
    ];
    const xOf = (r: ReturnType<typeof simulate>, id: string) =>
      r.frames[r.frames.length - 1].bodies.find((x) => x.id === id)!.x;
    const passOver = simulate(make(), cfg(10)); // 高度差 100 > 10 → 掠過
    const collide = simulate(make(), cfg(9999)); // 視為同層 → 碰撞
    expect(xOf(passOver, "B")).toBeCloseTo(15, 1); // B 沒被碰到，原地不動
    expect(xOf(collide, "B")).toBeGreaterThan(15); // B 被撞開
  });
});

describe("必殺技 (specials)", () => {
  it("衝擊：猛擊機率把對手彈開 + 扣血（記錄事件、同 seed 確定）", () => {
    const mk = (seed: number) =>
      simulate(
        [
          body({ id: "A", position: { x: -15, y: 0 }, velocity: { x: 300, y: 0 }, spin: 1e6, radius: 20, special: "blast" }),
          body({ id: "B", position: { x: 15, y: 0 }, velocity: { x: -300, y: 0 }, spin: 1e6, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 1, arena: neutralArena({ restitution: 0.5, radius: 1e6 }), seed },
      );
    let fired = 0;
    const N = 60;
    for (let s = 1; s <= N; s++) if (mk(s).specialEvents.some((e) => e.kind === "blast" && e.id === "A")) fired++;
    expect(fired).toBeGreaterThan(0); // 有觸發
    expect(fired).toBeLessThan(N); // 機率性，非必中
    expect(JSON.stringify(mk(7))).toBe(JSON.stringify(mk(7))); // 同 seed 一致
  });

  it("衝擊：未裝備時不觸發", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: -15, y: 0 }, velocity: { x: 300, y: 0 }, spin: 1e6, radius: 20 }),
        body({ id: "B", position: { x: 15, y: 0 }, velocity: { x: -300, y: 0 }, spin: 1e6, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 1, arena: neutralArena({ restitution: 0.5, radius: 1e6 }), seed: 3 },
    );
    expect(r.specialEvents.some((e) => e.kind === "blast")).toBe(false);
  });

  it("衝刺突進：逼近對手時機率觸發並記錄事件", () => {
    let fired = 0;
    const N = 60;
    for (let s = 1; s <= N; s++) {
      const r = simulate(
        [
          body({ id: "A", position: { x: -300, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e6, radius: 20, special: "rush" }),
          body({ id: "B", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, spin: 1e6, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 3, arena: neutralArena({ radius: 5000 }), seed: s },
      );
      if (r.specialEvents.some((e) => e.kind === "rush" && e.id === "A")) fired++;
    }
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(N);
  });
});

describe("基本輸出形狀", () => {
  it("frames 連續、結果欄位齊全", () => {
    const arena = DEFAULT_ARENA;
    const inits = [
      buildInit({ id: "A", color: "#f00", stats: STAT_PRESETS.balance, angleDeg: 10, power: 0.7, spinPower: 0.8, startAngleDeg: 180 }, arena),
      buildInit({ id: "B", color: "#00f", stats: STAT_PRESETS.balance, angleDeg: 190, power: 0.7, spinPower: 0.8, startAngleDeg: 0 }, arena),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 60, arena });
    expect(r.frames.length).toBeGreaterThan(1);
    expect(r.frames[0].t).toBe(0);
    expect(["ring-out", "spin-out", "timeout", "draw", "burst", "ko"]).toContain(r.reason);
    expect(r.frames[0].bodies).toHaveLength(2);
  });
});
