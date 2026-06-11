import { describe, it, expect } from "vitest";
import { simulate, buildInit, DEFAULT_ARENA } from "../src/physics/engine";
import type { ArenaConfig, BeybladeInit, SimConfig } from "../src/physics/types";
import { STAT_PRESETS } from "../src/physics/presets";
import { rimAt, rimScoreAt, softWallRadiusAt, softWallNormalAt, sampleSoftWall } from "../src/physics/arena";

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
        { dt: 1 / 60, maxTime: 1, arena: neutralArena({ restitution: 0.5, radius: 1e6 }), seed, special: { graceTime: 0 } },
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
        { dt: 1 / 60, maxTime: 3, arena: neutralArena({ radius: 5000 }), seed: s, special: { graceTime: 0 } },
      );
      if (r.specialEvents.some((e) => e.kind === "rush" && e.id === "A")) fired++;
    }
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(N);
  });
});

describe("邊緣分區 (rim segments, P1)", () => {
  it("break 破口：一般牆會反彈的速度，在破口處直接出界", () => {
    // 全域 ringOutSpeed 很高 + wallBounce 1 → 一般牆只反彈；+x 放 break（門檻預設 0）→ 同速直接出界
    const make = (rim: ArenaConfig["rim"]) =>
      simulate(
        [
          body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 200, y: 0 }, spin: 1e9, radius: 20 }),
          body({ id: "B", position: { x: 0, y: -150 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 4, arena: neutralArena({ radius: 300, ringOutSpeed: 5000, wallBounce: 1, rim }) },
      );
    // 整圈一般牆（rim []）→ A 反彈、存活
    const wall = make([]);
    const wallA = wall.frames[wall.frames.length - 1].bodies.find((x) => x.id === "A")!;
    expect(wallA.alive).toBe(true);
    // +x 處放 break 破口 → A 出界落敗
    const broken = make([{ angle: 0, half: 0.4, kind: "break" }]);
    expect(broken.reason).toBe("ring-out");
    expect(broken.winnerId).toBe("B");
    expect(broken.loserId).toBe("A");
    expect(Math.abs(broken.ringOutAngle as number)).toBeLessThan(0.4); // 從 +x 破口飛出
  });

  it("pocket 高分區：物理數值（出界門檻/反彈）與一般牆相同", () => {
    const arena = neutralArena({ radius: 300, ringOutSpeed: 123, wallBounce: 0.55 });
    const top = rimAt({ ...arena, rim: [{ angle: Math.PI / 2, half: 0.42, kind: "pocket", score: 2 }] }, Math.PI / 2);
    expect(top.kind).toBe("pocket");
    expect(top.score).toBe(2);
    expect(top.ringOutSpeed).toBe(123); // 物理門檻沿用全域 → 不改變平衡
    expect(top.wallBounce).toBeCloseTo(0.55); // 反彈沿用全域
  });

  it("rim 未設 → 相容舊行為：上下兩高分缺口、側邊一般牆", () => {
    const arena = neutralArena({ radius: 300 });
    expect(rimScoreAt(arena, Math.PI / 2)).toBe(2); // 上方缺口
    expect(rimScoreAt(arena, -Math.PI / 2)).toBe(2); // 下方缺口
    expect(rimScoreAt(arena, 0)).toBe(1); // 右側一般牆
    expect(rimScoreAt(arena, null)).toBe(1); // 無效角度
  });

  it("rim 設為 [] → 整圈一般牆，出界皆 1 分（無高分缺口）", () => {
    const arena = neutralArena({ radius: 300, rim: [] });
    expect(rimScoreAt(arena, Math.PI / 2)).toBe(1);
    expect(rimScoreAt(arena, 0)).toBe(1);
  });

  it("段重疊時取最具體（半寬最小）的段", () => {
    const arena = neutralArena({
      radius: 300,
      rim: [
        { angle: 0, half: 1.0, kind: "pocket", score: 2 },
        { angle: 0, half: 0.2, kind: "break", score: 3 },
      ],
    });
    expect(rimAt(arena, 0).kind).toBe("break"); // 較窄者勝出
    expect(rimAt(arena, 0).score).toBe(3);
    expect(rimAt(arena, 0.5).kind).toBe("pocket"); // 只落在寬段內
  });
});

describe("方形邊界 (box: 四邊反彈 / 四角出界)", () => {
  const boxArena = (over: Partial<ArenaConfig> = {}) =>
    neutralArena({ radius: 300, box: { half: 200, cornerGap: 60, wallBounce: 1 }, ...over });

  it("正面撞邊牆 → 反彈回場內、不出界", () => {
    // A 從中心往 +x 直直撞右邊牆中段（y=0，遠離角落）→ 應反彈、存活
    const inits = [
      body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 300, y: 0 }, spin: 1e9, radius: 20 }),
      body({ id: "B", position: { x: 0, y: -120 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 3, arena: boxArena() });
    const lastA = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!;
    const maxX = Math.max(...r.frames.map((f) => f.bodies.find((x) => x.id === "A")!.x));
    expect(lastA.alive).toBe(true); // 沒出界
    expect(maxX).toBeLessThanOrEqual(200 - 20 + 1); // 沒穿牆（lim = half - radius）
    expect(lastA.x).toBeLessThan(maxX); // 反彈回場內
  });

  it("被推進角落 → 從角落出界（記下角落角度）", () => {
    // A 直直朝右上角飛 → 進角落開口 → 出界，角度約 +45°
    const inits = [
      body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 220, y: 220 }, spin: 1e9, radius: 20 }),
      body({ id: "B", position: { x: -120, y: -120 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 4, arena: boxArena() });
    expect(r.reason).toBe("ring-out");
    expect(r.loserId).toBe("A");
    const ang = r.ringOutAngle as number; // 右上角 ≈ π/4
    expect(ang).toBeGreaterThan(0.4);
    expect(ang).toBeLessThan(1.2);
  });

  it("切向速度保留：斜撞邊牆後 y 方向動量不被反彈吃掉", () => {
    // A 在 y=0 往右偏上撞右牆中段（遠離角落）→ vx 反彈、vy 應保留 → 撞牆後仍持續往 +y
    const inits = [
      body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 300, y: 80 }, spin: 1e9, radius: 20 }),
      body({ id: "B", position: { x: -150, y: 0 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 1.2, arena: boxArena() });
    const ys = r.frames.map((f) => f.bodies.find((x) => x.id === "A")!.y);
    expect(Math.max(...ys)).toBeGreaterThan(60); // 撞牆後 y 持續增加（切向保留）
  });

  it("圓形場（無 box）行為不變：仍走半徑出界判定", () => {
    const inits = [
      body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 3000, y: 0 }, spin: 1e9, radius: 20 }),
      body({ id: "B", position: { x: 0, y: 40 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 2, arena: neutralArena({ radius: 300, ringOutSpeed: 100 }) });
    expect(r.reason).toBe("ring-out");
    expect(r.loserId).toBe("A");
  });
});

describe("加速軌道 (Xtreme Line rail)", () => {
  it("上軌沿自旋方向加速；離軌 / 無軌道則不變", () => {
    const run = (over: { rail?: ArenaConfig["rail"]; x?: number }) =>
      simulate(
        [
          body({ id: "A", position: { x: over.x ?? 100, y: 0 }, velocity: { x: 0, y: 0 }, spin: 1500, radius: 20, spinDir: 1 }),
          body({ id: "B", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 0.3, arena: neutralArena({ radius: 5000, rail: over.rail }) },
      );
    const lastY = (r: ReturnType<typeof simulate>) =>
      r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!.y;
    const rail = { radius: 100, band: 20, boost: 500, minSpin: 0 };
    // A 在 (100,0)、spinDir 1 → 切向為 +y。上軌 → 明顯往 +y 位移
    expect(lastY(run({ rail }))).toBeGreaterThan(1);
    expect(lastY(run({}))).toBeCloseTo(0, 5); // 無軌道 → 不動
    expect(lastY(run({ rail, x: 300 }))).toBeCloseTo(0, 5); // 在環帶外 → 不受影響
  });
});

describe("綠色軟牆幾何 (手繪 M：直腿相切圓弧拱 + 水平凹底)", () => {
  const R = 200;
  const SW = { radius: R, topAngle: Math.PI / 2 };
  it("側面/底部 = 基準圓；頂部凹口外凸、兩拱峰高於凹口", () => {
    expect(softWallRadiusAt(SW, 0)).toBeCloseTo(R, 0); // 右側基準圓
    expect(softWallRadiusAt(SW, -Math.PI / 2)).toBeCloseTo(R, 0); // 底部基準圓
    expect(softWallRadiusAt(SW, Math.PI)).toBeCloseTo(R, 0); // 左側基準圓
    const notch = softWallRadiusAt(SW, Math.PI / 2); // 正上 = 水平凹底
    const humpR = softWallRadiusAt(SW, Math.PI / 2 - 0.35); // 右拱峰
    const humpL = softWallRadiusAt(SW, Math.PI / 2 + 0.35); // 左拱峰
    expect(notch).toBeGreaterThan(R); // 凹口仍外凸（手繪 M 整個頂部凸出基準圓）
    expect(humpR).toBeGreaterThan(notch); // 凹口低於右拱峰
    expect(humpL).toBeGreaterThan(notch); // 凹口低於左拱峰（M 的兩個峰）
    expect(humpR).toBeCloseTo(humpL, 1); // 左右對稱
  });
  it("法線：單位向量、凹底水平→外法線朝 +y、右側→外法線徑向朝右", () => {
    const nTop = softWallNormalAt(SW, Math.PI / 2);
    expect(Math.hypot(nTop.nx, nTop.ny)).toBeCloseTo(1, 6);
    expect(nTop.ny).toBeGreaterThan(0.9); // 凹底水平 → 外法線朝上
    const nRight = softWallNormalAt(SW, 0);
    expect(Math.hypot(nRight.nx, nRight.ny)).toBeCloseTo(1, 6);
    expect(nRight.nx).toBeGreaterThan(0.9); // 右側基準圓 → 外法線徑向朝右
  });
  it("sampleSoftWall 閉合、凹口在世界 +y、最高點 x≈0", () => {
    const pts = sampleSoftWall(SW);
    expect(pts.length).toBeGreaterThan(50);
    const topMost = pts.reduce((a, b) => (b.y > a.y ? b : a)); // 最高點 = 拱頂一帶
    expect(topMost.y).toBeGreaterThan(0); // 凹口在 +y
    expect(Math.abs(topMost.x)).toBeLessThan(R * 0.35);
  });
  it("WeakMap 快取跨物件確定性：同數值不同物件 → r/法線/取樣逐位元相同", () => {
    // 鎖住「buildSwOutline 為純函式、快取依物件 identity 但數值不可區分」這個確定性不變量。
    const a = { radius: R, topAngle: Math.PI / 2 };
    const b = { radius: R, topAngle: Math.PI / 2 }; // 欄位相同、參照不同
    for (let i = 0; i < 360; i++) {
      const th = (i / 360) * Math.PI * 2;
      expect(softWallRadiusAt(a, th)).toBe(softWallRadiusAt(b, th)); // toBe = Object.is → 逐位元
      const na = softWallNormalAt(a, th);
      const nb = softWallNormalAt(b, th);
      expect(na.nx).toBe(nb.nx);
      expect(na.ny).toBe(nb.ny);
    }
    const pa = sampleSoftWall(a);
    const pb = sampleSoftWall(b);
    expect(pa.length).toBe(pb.length);
    for (let i = 0; i < pa.length; i++) {
      expect(pa[i].x).toBe(pb[i].x);
      expect(pa[i].y).toBe(pb[i].y);
    }
  });
});

describe("綠色實體內牆 (撞牆反彈 / 貼地擋・騰空越 / 四角出界)", () => {
  const swArena = (over: Partial<ArenaConfig["softWall"] & object> = {}) =>
    neutralArena({
      box: { half: 280, cornerGap: 60, wallBounce: 1 },
      softWall: { radius: 200, bandHalf: 16, wallHeight: 20, wallBounce: 0.5, ...over },
    });

  it("貼地高速撞綠牆 → 反彈、留在綠牆內（實體牆，不靠速度穿越）", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 400, y: 0 }, spin: 1e9, radius: 20 }), // 高速也不穿
        body({ id: "B", position: { x: 0, y: -150 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 3, arena: swArena() },
    );
    const A = r.frames.map((f) => f.bodies.find((x) => x.id === "A")!);
    const maxR = Math.max(...A.map((b) => Math.hypot(b.x, b.y)));
    expect(A[A.length - 1].alive).toBe(true);
    expect(maxR).toBeLessThan(195); // 中心從未抵達綠牆中心線(200) → 被實體牆擋住、沒穿過
  });

  it("貼地擋 vs 騰空越：z 超過 wallHeight 才飛得過綠牆", () => {
    const mk = (z: number) =>
      simulate(
        [
          body({ id: "A", position: { x: 150, y: 0 }, velocity: { x: 300, y: 0 }, spin: 1e9, radius: 20, z }),
          body({ id: "B", position: { x: 0, y: -150 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 2, arena: swArena() }, // neutralArena gravity=0 → z 不衰減，騰空持續
      );
    const maxRof = (r: ReturnType<typeof simulate>) =>
      Math.max(...r.frames.map((f) => Math.hypot(f.bodies.find((x) => x.id === "A")!.x, f.bodies.find((x) => x.id === "A")!.y)));
    expect(maxRof(mk(0))).toBeLessThan(200); // 貼地 → 被綠牆擋在內
    expect(maxRof(mk(60))).toBeGreaterThan(240); // 騰空(z=60>20) → 飛越綠牆、衝到外圈(box 邊)
  });

  it("騰空衝向角落 → 飛越綠牆後出界", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: 140, y: 140 }, velocity: { x: 350, y: 350 }, spin: 1e9, radius: 20, z: 60 }), // 騰空、朝右上角
        body({ id: "B", position: { x: -140, y: -140 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 4, arena: swArena() },
    );
    expect(r.reason).toBe("ring-out");
    expect(r.loserId).toBe("A");
  });

  it("圓形場（無 box）也能套綠牆：貼地擋、騰空飛越（與 box 解耦）", () => {
    const circ = neutralArena({ radius: 300, softWall: { radius: 200, bandHalf: 16, wallHeight: 20, wallBounce: 0.5 } });
    const mk = (z: number) =>
      simulate(
        [
          body({ id: "A", position: { x: 150, y: 0 }, velocity: { x: 300, y: 0 }, spin: 1e9, radius: 20, z }),
          body({ id: "B", position: { x: 0, y: -150 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 2, arena: circ },
      );
    const maxRof = (r: ReturnType<typeof simulate>) =>
      Math.max(...r.frames.map((f) => Math.hypot(f.bodies.find((x) => x.id === "A")!.x, f.bodies.find((x) => x.id === "A")!.y)));
    expect(maxRof(mk(0))).toBeLessThan(200); // 貼地 → 被綠牆擋在內（圓形場也擋）
    expect(maxRof(mk(60))).toBeGreaterThan(210); // 騰空(z=60>20) → 飛越綠牆、衝到外圈
  });

  it("貼地往正上方（凹口中央）衝 → 撞綠牆(實體)反彈、不出界", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 0, y: 300 }, spin: 1e9, radius: 20 }), // z=0 貼地
        body({ id: "B", position: { x: -120, y: 0 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 1.5, arena: swArena() },
    );
    const A = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!;
    expect(A.alive).toBe(true); // 貼地 → 被綠牆實體擋下、彈回，不出界
  });

  it("確定性：含 softWall 同輸入同 seed → 完全一致", () => {
    const mk = () =>
      simulate(
        [
          body({ id: "A", position: { x: 10, y: 0 }, velocity: { x: 200, y: 120 }, spin: 1e6, radius: 20 }),
          body({ id: "B", position: { x: -10, y: 0 }, velocity: { x: -150, y: 90 }, spin: 1e6, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 3, arena: swArena(), seed: 7 },
      );
    expect(JSON.stringify(mk().frames)).toBe(JSON.stringify(mk().frames));
  });
});

describe("綠色加速區 (Xtreme Dash)", () => {
  const swArena = () =>
    neutralArena({
      box: { half: 280, cornerGap: 60 },
      softWall: { radius: 200, depth: 0.35, accelBoost: 150, accelInward: 70, accelMinSpin: 0.1 },
    });

  it("在頂部加速區 → 切向加速 + 向心拉", () => {
    const r = simulate(
      [
        // 手繪 M 整個頂部外凸（凹底 ~1.01R），加速帶在牆附近 → 球放 y=160（牆內、貼帶）
        body({ id: "A", position: { x: 0, y: 160 }, velocity: { x: 0, y: 0 }, spin: 1500, radius: 20, spinDir: 1 }),
        body({ id: "B", position: { x: 0, y: -150 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 0.2, arena: swArena() },
    );
    const A1 = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!;
    expect(A1.x).toBeLessThan(-0.5); // 切向（spinDir=1 在頂部 → −x）加速
    expect(A1.y).toBeLessThan(160); // 向心拉 → 往中心（−y）
  });

  it("自旋低於門檻 → 不加速", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: 0, y: 160 }, velocity: { x: 0, y: 0 }, spin: 100, radius: 20, spinDir: 1 }), // spinNorm≈0.033 < 0.1
        body({ id: "B", position: { x: 0, y: -150 }, velocity: { x: 0, y: 0 }, spin: 1e9, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 0.2, arena: swArena() },
    );
    const A1 = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "A")!;
    expect(Math.abs(A1.x)).toBeLessThan(0.5);
    expect(Math.abs(A1.y - 160)).toBeLessThan(0.5);
  });
});

describe("回放特效事件 (碰撞/淘汰)", () => {
  it("碰撞 → collisionEvents(含位置/impact>25)；停轉 → deathEvents(含 reason)", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: -40, y: 0 }, velocity: { x: 300, y: 0 }, spin: 200, radius: 20 }), // 低自旋→停轉
        body({ id: "B", position: { x: 40, y: 0 }, velocity: { x: -300, y: 0 }, spin: 3000, radius: 20 }),
      ],
      { dt: 1 / 60, maxTime: 8, arena: DEFAULT_ARENA },
    );
    expect(r.collisionEvents.length).toBeGreaterThan(0);
    const ce = r.collisionEvents[0];
    expect(ce.impact).toBeGreaterThan(25);
    expect(Number.isFinite(ce.x) && Number.isFinite(ce.y)).toBe(true);
    expect(r.deathEvents.length).toBeGreaterThan(0);
    expect(["ring-out", "spin-out", "ko"]).toContain(r.deathEvents.at(-1)!.reason);
  });
  it("確定性：同 seed → collisionEvents / deathEvents 逐位元一致", () => {
    const mk = () =>
      simulate(
        [
          body({ id: "A", position: { x: -40, y: 0 }, velocity: { x: 280, y: 30 }, spin: 5000, radius: 20 }),
          body({ id: "B", position: { x: 40, y: 0 }, velocity: { x: -280, y: -30 }, spin: 5000, radius: 20 }),
        ],
        { dt: 1 / 60, maxTime: 5, arena: DEFAULT_ARENA, seed: 9 },
      );
    const a = mk(), b = mk();
    expect(JSON.stringify(a.collisionEvents)).toBe(JSON.stringify(b.collisionEvents));
    expect(JSON.stringify(a.deathEvents)).toBe(JSON.stringify(b.deathEvents));
  });
});

describe("必殺技：冷卻 + 每回合限次", () => {
  // 小場、不出界、慢衰減 → 兩顆被困在小環裡反覆對撞；blastPush/Damage=0 不分開不死 → 純測「次數上限」
  const tight = neutralArena({ radius: 60, centerPull: 150, swirl: 15, ringOutSpeed: 1e9, friction: 0.3, spinDecayBase: 4 });
  const countBlasts = (maxUses: number) =>
    simulate(
      [
        body({ id: "A", position: { x: -25, y: 0 }, velocity: { x: 200, y: 60 }, spin: 5000, radius: 20, special: "blast" }),
        body({ id: "B", position: { x: 25, y: 0 }, velocity: { x: -200, y: -60 }, spin: 5000, radius: 20 }),
      ],
      {
        dt: 1 / 60,
        maxTime: 6,
        arena: tight,
        seed: 4,
        special: { graceTime: 0, blastChance: 1, blastMaxUses: maxUses, blastImpactMin: 20, blastPush: 0, blastDamage: 0, blastCooldown: 0.05 },
      },
    ).specialEvents.filter((e) => e.kind === "blast" && e.id === "A").length;

  it("無上限會多次發動（同場景作為對照）", () => {
    expect(countBlasts(99)).toBeGreaterThan(1);
  });
  it("blastMaxUses=1 → 只發動一次（上限生效）", () => {
    expect(countBlasts(1)).toBe(1);
  });
  it("blastMaxUses=3 → 最多 3 次", () => {
    expect(countBlasts(3)).toBeLessThanOrEqual(3);
    expect(countBlasts(3)).toBeGreaterThan(0);
  });
});

describe("必殺技新招：dash / vortex / clone", () => {
  const open = neutralArena({ radius: 400, ringOutSpeed: 1e9, spinDecayBase: 0 });

  it("dash 高速移動：自旋偏低時回補自旋 + 發動事件", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: -120, y: 0 }, velocity: { x: 40, y: 0 }, spin: 200, radius: 20, special: "dash" }),
        body({ id: "B", position: { x: 200, y: 0 }, velocity: { x: 0, y: 0 }, spin: 1500, radius: 20 }),
      ],
      {
        dt: 1 / 60,
        maxTime: 1,
        arena: open,
        seed: 1,
        special: { graceTime: 0, dashChance: 1, dashTriggerSpin: 0.5, dashMaxUses: 1, dashSpinRestore: 1500, dashDuration: 1, dashAccel: 0 },
      },
    );
    expect(r.specialEvents.filter((e) => e.kind === "dash" && e.id === "A").length).toBe(1);
    const aSpins = r.frames.map((f) => f.bodies.find((x) => x.id === "A")!.spin);
    expect(Math.max(...aSpins)).toBeGreaterThan(1000); // 從 200 回補後遠高於起始
  });

  it("vortex 旋渦：對手進範圍 → 被往自己拉近", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, spin: 3000, radius: 20, special: "vortex" }),
        body({ id: "B", position: { x: 200, y: 0 }, velocity: { x: 0, y: 0 }, spin: 3000, radius: 20 }),
      ],
      {
        dt: 1 / 60,
        maxTime: 0.6,
        arena: open,
        seed: 1,
        special: { graceTime: 0, vortexChance: 1, vortexRange: 250, vortexMaxUses: 1, vortexPull: 400, vortexDuration: 1 },
      },
    );
    expect(r.specialEvents.filter((e) => e.kind === "vortex" && e.id === "A").length).toBe(1);
    const bxStart = r.frames[0].bodies.find((x) => x.id === "B")!.x;
    const bxEnd = r.frames[r.frames.length - 1].bodies.find((x) => x.id === "B")!.x;
    expect(bxEnd).toBeLessThan(bxStart - 5); // 被拉向 A（左）
  });

  it("clone 分身：召喚分身(isClone)、不計勝負、x秒後消失", () => {
    const r = simulate(
      [
        body({ id: "A", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, spin: 3000, radius: 20, special: "clone" }),
        body({ id: "B", position: { x: 150, y: 0 }, velocity: { x: 0, y: 0 }, spin: 3000, radius: 20 }),
      ],
      {
        dt: 1 / 60,
        maxTime: 3,
        arena: open,
        seed: 1,
        special: { graceTime: 0, cloneChance: 1, cloneRange: 200, cloneMaxUses: 1, cloneDuration: 1, cloneSpin: 2000, cloneAttackMul: 0.4, cloneHoming: 0 },
      },
    );
    expect(r.specialEvents.filter((e) => e.kind === "clone" && e.id === "A").length).toBe(1);
    expect(r.frames.some((f) => f.bodies.some((bd) => bd.isClone && bd.alive))).toBe(true); // 曾出現存活分身
    expect(["A", "B", null]).toContain(r.winnerId); // 勝負只算本體
    expect(["A", "B", null]).toContain(r.loserId);
    const last = r.frames[r.frames.length - 1];
    expect(last.bodies.some((bd) => bd.isClone && bd.alive)).toBe(false); // 時間到已消失
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
