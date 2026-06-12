/**
 * 弧壁競技場（ARC WALL STADIUM，超橢圓邊界）測試：
 *  - 幾何：r(θ) 對角正規化（對角 = radius、四邊中段內縮）、法線為單位向量。
 *  - 確定性：同輸入同 seed → 完全一致的 frames。
 *  - 邊界反彈不穿牆：多 seed 隨機對戰，存活陀螺恆在 r(θ) 邊界內（含容差）。
 *  - 對角扇區可出界（rim pocket 門檻 220，較四邊 420 低）→ ring-out、roundPoints = 2。
 *  - 四邊中段門檻極高 → 反彈牆（中速衝牆不出界）。
 *  - 出界只發生在「貼上邊界且外速超門檻」：中速貼著對角繞行不出界（迴歸，原門檻 150 太鬆）。
 */
import { describe, it, expect } from "vitest";
import { simulate, buildInit, ARC_WALL_STADIUM } from "../src/physics/engine";
import { boundaryRadiusAt, boundaryNormalAt, rimScoreAt } from "../src/physics/arena";
import { roundPoints } from "../src/game/scoring";
import { STAT_PRESETS } from "../src/physics/presets";
import type { BeybladeInit, SimConfig } from "../src/physics/types";

const ARENA = ARC_WALL_STADIUM;

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

describe("弧壁競技場：超橢圓幾何", () => {
  it("對角正規化：對角恰為 radius、四邊中段內縮、p=2 退化為圓", () => {
    const p = ARENA.superellipse!.power;
    // 對角（45°）為最遠點 = radius
    expect(boundaryRadiusAt(ARENA, Math.PI / 4)).toBeCloseTo(ARENA.radius, 9);
    expect(boundaryRadiusAt(ARENA, (-3 * Math.PI) / 4)).toBeCloseTo(ARENA.radius, 9);
    // 四邊中段（軸向）內縮為 radius·2^(1/p − 1/2)
    const side = ARENA.radius * Math.pow(2, 1 / p - 0.5);
    expect(boundaryRadiusAt(ARENA, 0)).toBeCloseTo(side, 9);
    expect(boundaryRadiusAt(ARENA, Math.PI / 2)).toBeCloseTo(side, 9);
    expect(side).toBeLessThan(ARENA.radius);
    // p = 2 → 圓
    const circle = { ...ARENA, superellipse: { power: 2 } };
    for (const a of [0, 0.7, Math.PI / 4, 2.2]) {
      expect(boundaryRadiusAt(circle, a)).toBeCloseTo(ARENA.radius, 9);
    }
  });

  it("法線為單位向量；軸向 / 對角方向法線正確", () => {
    for (const a of [0, 0.3, Math.PI / 4, 1.2, Math.PI / 2, -2.5]) {
      const n = boundaryNormalAt(ARENA, a);
      expect(Math.hypot(n.nx, n.ny)).toBeCloseTo(1, 9);
    }
    // θ=0（+x 邊中段）→ 法線 (1, 0)
    const n0 = boundaryNormalAt(ARENA, 0);
    expect(n0.nx).toBeCloseTo(1, 9);
    expect(n0.ny).toBeCloseTo(0, 9);
    // θ=45°（對角）→ 法線沿對角（對稱）
    const nd = boundaryNormalAt(ARENA, Math.PI / 4);
    expect(nd.nx).toBeCloseTo(nd.ny, 9);
    expect(nd.nx).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe("弧壁競技場：確定性", () => {
  it("相同輸入 + 相同 seed → 完全一致的軌跡", () => {
    const cfg: SimConfig = { dt: 1 / 60, maxTime: 30, arena: ARENA, seed: 1234, sampleEvery: 1 };
    const inits = [
      buildInit(
        { id: "A", color: "#f00", stats: STAT_PRESETS.attack, angleDeg: 10, power: 0.85, spinPower: 0.9, startAngleDeg: 180 },
        ARENA,
      ),
      buildInit(
        { id: "B", color: "#00f", stats: STAT_PRESETS.stamina, angleDeg: 195, power: 0.75, spinPower: 0.95, startAngleDeg: 0 },
        ARENA,
      ),
    ];
    const r1 = simulate(inits, cfg);
    const r2 = simulate(inits, cfg);
    expect(r1.winnerId).toBe(r2.winnerId);
    expect(r1.reason).toBe(r2.reason);
    expect(JSON.stringify(r1.frames)).toBe(JSON.stringify(r2.frames));
  });
});

describe("弧壁競技場：邊界反彈不穿牆", () => {
  it("多 seed 隨機對戰：存活陀螺恆在 r(θ) 邊界內（含容差）", () => {
    const radiusById = new Map<string, number>();
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 42]) {
      const inits = [
        buildInit(
          { id: "A", color: "#f00", stats: STAT_PRESETS.attack, angleDeg: (seed * 37) % 360, power: 1, spinPower: 0.9, startAngleDeg: 180 },
          ARENA,
        ),
        buildInit(
          { id: "B", color: "#00f", stats: STAT_PRESETS.defense, angleDeg: (180 + seed * 53) % 360, power: 1, spinPower: 0.9, startAngleDeg: 0 },
          ARENA,
        ),
      ];
      for (const init of inits) radiusById.set(init.id, init.radius);
      const r = simulate(inits, { dt: 1 / 60, maxTime: 45, arena: ARENA, seed, sampleEvery: 1 });
      for (const f of r.frames) {
        for (const bf of f.bodies) {
          if (!bf.alive) continue; // 出界淘汰後的後續演出（飛出場外）不在此限
          const dist = Math.hypot(bf.x, bf.y);
          const bound = boundaryRadiusAt(ARENA, Math.atan2(bf.y, bf.x)) - (radiusById.get(bf.id) ?? 0);
          expect(dist).toBeLessThanOrEqual(bound + 0.01);
        }
      }
    }
  });
});

describe("弧壁競技場：對角出界扇區", () => {
  it("高速衝向對角（45°）→ ring-out、落點在 2 分扇區、roundPoints = 2", () => {
    const inits = [
      // A 朝 45 度對角猛衝（沿法線向外速 ≈ 600+ > 扇區門檻 220）。
      // spin 用 3000（spinNorm = 1）：spin 過大時 swirl ∝ spinNorm 會產生巨大切向力、毀掉定向。
      body({ id: "A", velocity: { x: 500, y: 500 }, spin: 3000 }),
      // B 遠離戰場、高續航 → 不會先停轉
      body({ id: "B", position: { x: -120, y: -120 }, spin: 3000, stats: { attack: 1, defense: 1, stamina: 5, weight: 1 } }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 3, arena: ARENA, seed: 7 });
    expect(r.reason).toBe("ring-out");
    expect(r.loserId).toBe("A");
    expect(r.winnerId).toBe("B");
    // 出界角度落在對角 pocket 扇區（中心 45°、半寬 0.32）
    expect(r.ringOutAngle).not.toBeNull();
    expect(Math.abs(r.ringOutAngle! - Math.PI / 4)).toBeLessThanOrEqual(0.32);
    // rim 落點計分 2 分 + 回合計分新制（出界一律 2 分）皆成立
    expect(rimScoreAt(ARENA, r.ringOutAngle)).toBe(2);
    expect(roundPoints(ARENA, r)).toBe(2);
  });

  it("中速衝向對角（45°）→ 反彈、不出界（迴歸：原門檻 150 此速度會直接飛出）", () => {
    // 對角初速 440：實測分水嶺——舊門檻 150 出界、新門檻 220 反彈；480+ 新舊皆出界
    // （上一個測試的 707 全力衝刺即是）→「輕碰/中速不出、被強力擊飛才出」。
    const vc = 440 / Math.SQRT2;
    const inits = [
      body({ id: "A", velocity: { x: vc, y: vc }, spin: 3000 }),
      body({ id: "B", position: { x: -120, y: -120 }, spin: 3000, stats: { attack: 1, defense: 1, stamina: 5, weight: 1 } }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 3, arena: ARENA, seed: 7 });
    expect(r.reason).not.toBe("ring-out");
  });

  it("中速衝向四邊中段（0°）→ 門檻極高必反彈、不出界", () => {
    const inits = [
      body({ id: "A", velocity: { x: 400, y: 0 }, spin: 3000 }),
      body({ id: "B", position: { x: -120, y: -120 }, spin: 3000 }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 2, arena: ARENA, seed: 7 });
    expect(r.reason).not.toBe("ring-out");
    // 全程（雙方都存活）不穿牆
    for (const f of r.frames) {
      for (const bf of f.bodies) {
        if (!bf.alive) continue;
        const dist = Math.hypot(bf.x, bf.y);
        expect(dist).toBeLessThanOrEqual(boundaryRadiusAt(ARENA, Math.atan2(bf.y, bf.x)) - 20 + 0.01);
      }
    }
  });

  it("中速貼著對角繞行 → 不出界（迴歸：原門檻 150 時繞行掠過 pocket 就飛出）", () => {
    // A 貼牆起步（θ=0、距弧壁 6 單位）、切向中速 280 逆時針繞行 → 路徑會貼牆滑過 45° pocket。
    // 繞行/輕碰的沿法線外速遠低於門檻 220 → 只該反彈導向、不該出界。
    const theta0 = 0;
    const r0 = boundaryRadiusAt(ARENA, theta0) - 20 - 6;
    const inits = [
      body({
        id: "A",
        position: { x: r0 * Math.cos(theta0), y: r0 * Math.sin(theta0) },
        velocity: { x: 0, y: 280 }, // 切向（逆時針，與 spinDir +1 的 swirl 同向）
        spin: 3000,
      }),
      // B 擺場中央、高續航 → 不參與碰撞、也不會先停轉
      body({ id: "B", position: { x: 0, y: 0 }, spin: 3000, stats: { attack: 1, defense: 1, stamina: 5, weight: 1 } }),
    ];
    const r = simulate(inits, { dt: 1 / 60, maxTime: 4, arena: ARENA, seed: 11 });
    expect(r.reason).not.toBe("ring-out");
    // 確認測試非空泛：A 確實曾「貼著牆」通過對角 pocket 扇區（中心 45°、半寬 0.32）
    let passedPocket = false;
    for (const f of r.frames) {
      for (const bf of f.bodies) {
        if (bf.id !== "A" || !bf.alive) continue;
        const dist = Math.hypot(bf.x, bf.y);
        const ang = Math.atan2(bf.y, bf.x);
        const bound = boundaryRadiusAt(ARENA, ang);
        // 全程不穿牆
        expect(dist).toBeLessThanOrEqual(bound - 20 + 0.01);
        if (Math.abs(ang - Math.PI / 4) <= 0.32 && dist >= bound - 80) passedPocket = true;
      }
    }
    expect(passedPocket).toBe(true);
  });
});
