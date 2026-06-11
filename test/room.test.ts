import { describe, it, expect } from "vitest";
import {
  sanitizeAim,
  buildInitFromAim,
  defaultAim,
  mergeLoadout,
  randomBotAim,
  randomBotLoadout,
  sideSpinDir,
  type AimInput,
} from "../src/game/room";
import { roundPoints, WIN_SCORE } from "../src/game/scoring";
import { DEFAULT_ARENA, DEFAULT_SCALES, simulate } from "../src/physics/engine";
import { STAT_PRESETS } from "../src/physics/presets";
import type { ArenaConfig } from "../src/physics/types";

const arena: ArenaConfig = { ...DEFAULT_ARENA };

describe("sanitizeAim（伺服器端發射消毒）", () => {
  it("正常輸入：方向正規化、值保留", () => {
    const a = sanitizeAim({ x: 50, y: -80, dirX: 3, dirY: 4, power: 0.8 }, arena)!;
    expect(a.x).toBe(50);
    expect(Math.hypot(a.dirX, a.dirY)).toBeCloseTo(1);
    expect(a.power).toBe(0.8);
  });

  it("落點超出場外 → 夾回 0.9 半徑內", () => {
    const a = sanitizeAim({ x: 9999, y: 0, dirX: 1, dirY: 0, power: 0.5 }, arena)!;
    expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(arena.radius * 0.9 + 1e-6);
  });

  it("力道作弊（power 100）→ 夾到 1", () => {
    const a = sanitizeAim({ x: 0, y: 0, dirX: 1, dirY: 0, power: 100 }, arena)!;
    expect(a.power).toBe(1);
  });

  it("非有限值 / 零方向 → null", () => {
    expect(sanitizeAim({ x: NaN, y: 0, dirX: 1, dirY: 0, power: 0.5 }, arena)).toBeNull();
    expect(sanitizeAim({ x: 0, y: 0, dirX: 0, dirY: 0, power: 0.5 }, arena)).toBeNull();
    expect(sanitizeAim({ x: 0, y: 0, dirX: Infinity, dirY: 0, power: 0.5 }, arena)).toBeNull();
    expect(sanitizeAim({ x: 0, y: 0, dirX: 1, dirY: 0, power: "x" as unknown as number }, arena)).toBeNull();
  });
});

describe("buildInitFromAim（與前端 makeInit 同公式）", () => {
  it("速度/自旋依 power 換算、id 與顏色固定", () => {
    const aim: AimInput = { x: 10, y: 20, dirX: 0, dirY: -1, power: 0.5 };
    const init = buildInitFromAim("B", { type: "attack", spinDir: -1, special: "blast" }, STAT_PRESETS.attack, aim);
    expect(init.id).toBe("B");
    expect(init.velocity.y).toBeCloseTo(-0.5 * DEFAULT_SCALES.maxSpeed);
    expect(init.spin).toBeCloseTo((0.55 + 0.45 * 0.5) * DEFAULT_SCALES.maxSpin);
    expect(init.spinDir).toBe(-1);
    expect(init.special).toBe("blast");
  });

  it("special 空字串 → undefined（不裝必殺）", () => {
    const init = buildInitFromAim(
      "A",
      { type: "balance", spinDir: 1, special: "" },
      STAT_PRESETS.balance,
      defaultAim("A", arena),
    );
    expect(init.special).toBeUndefined();
  });
});

describe("defaultAim（瞄準逾時自動發射）", () => {
  it("落在場內、朝中心、可直接跑模擬", () => {
    const a = defaultAim("A", arena);
    const b = defaultAim("B", arena);
    expect(Math.hypot(a.x, a.y)).toBeLessThan(arena.radius);
    const r = simulate(
      [
        buildInitFromAim("A", { type: "balance", spinDir: 1, special: "" }, STAT_PRESETS.balance, a),
        buildInitFromAim("B", { type: "attack", spinDir: -1, special: "" }, STAT_PRESETS.attack, b),
      ],
      { dt: 1 / 60, maxTime: 60, arena, seed: 42, sampleEvery: 100000 },
    );
    expect(["A", "B", null]).toContain(r.winnerId);
    expect(roundPoints(arena, r)).toBeGreaterThanOrEqual(0);
    expect(roundPoints(arena, r)).toBeLessThanOrEqual(3);
  });
});

describe("mergeLoadout（client 配置更新驗證）", () => {
  const base = { type: "balance", spinDir: 1 as const, special: "" as const };
  it("合法更新生效", () => {
    const next = mergeLoadout(base, { type: "attack", spinDir: -1, special: "clone" }, Object.keys(STAT_PRESETS));
    expect(next).toEqual({ type: "attack", spinDir: -1, special: "clone" });
  });
  it("非法值整段忽略（type 不在清單 / spinDir 亂給 / special 亂給）", () => {
    const next = mergeLoadout(
      base,
      { type: "god-mode", spinDir: 99 as unknown as 1, special: "nuke" as unknown as "" },
      Object.keys(STAT_PRESETS),
    );
    expect(next).toEqual(base);
  });
});

describe("WIN_SCORE", () => {
  it("先到 3 分", () => {
    expect(WIN_SCORE).toBe(3);
  });
});

describe("sideSpinDir（線上旋向固定）", () => {
  it("先手 A 右旋、後手 B 左旋（永遠反向）", () => {
    expect(sideSpinDir("A")).toBe(1);
    expect(sideSpinDir("B")).toBe(-1);
    expect(sideSpinDir("A")).not.toBe(sideSpinDir("B"));
  });
});

describe("內建 BOT（randomBotAim / randomBotLoadout）", () => {
  it("各種 rng 值的發射都通過伺服器消毒", () => {
    // 掃過 rng 極值與中間值：產出的 aim 一定要 sanitize 得過（否則 BOT 開局就壞）
    for (const v of [0, 0.001, 0.25, 0.5, 0.75, 0.999]) {
      for (const side of ["A", "B"] as const) {
        const aim = randomBotAim(side, arena, () => v);
        const ok = sanitizeAim(aim, arena);
        expect(ok, `rng=${v} side=${side}`).not.toBeNull();
        expect(Math.hypot(ok!.x, ok!.y)).toBeLessThanOrEqual(arena.radius * 0.9 + 1e-6);
        expect(ok!.power).toBeGreaterThan(0);
        expect(ok!.power).toBeLessThanOrEqual(1);
      }
    }
  });

  it("loadout 隨機值都合法", () => {
    const types = Object.keys(STAT_PRESETS);
    for (const v of [0, 0.3, 0.6, 0.999]) {
      const l = randomBotLoadout(types, () => v);
      expect(types).toContain(l.type);
      expect([1, -1]).toContain(l.spinDir);
      expect(["", "rush", "blast", "dash", "vortex", "clone"]).toContain(l.special);
    }
  });
});
