import { describe, it, expect } from "vitest";
import {
  BEYBLADES,
  getBey,
  beyFullName,
  resolveBeyStats,
  DEFAULT_LINEUP,
  type BeyDef,
} from "../src/game/beyblades";
import type { BeybladeStats } from "../src/physics/types";

const TYPES = ["attack", "defense", "stamina", "balance"] as const;
/** lineup 可裝備的必殺（"" = 未裝備） */
const SPECIALS = ["", "rush", "blast", "dash", "vortex", "clone"];

describe("陀螺名冊（規模與唯一性）", () => {
  it("至少 9 顆", () => {
    expect(BEYBLADES.length).toBeGreaterThanOrEqual(9);
  });

  it("id / name 全池唯一", () => {
    expect(new Set(BEYBLADES.map((b) => b.id)).size).toBe(BEYBLADES.length);
    expect(new Set(BEYBLADES.map((b) => b.name)).size).toBe(BEYBLADES.length);
  });

  it("id 為 kebab-case、name 非空且無前後空白", () => {
    for (const b of BEYBLADES) {
      expect(b.id, b.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(b.name.trim()).toBe(b.name);
      expect(b.name.length).toBeGreaterThan(0);
    }
  });

  it("type 合法、每類型至少 2 顆", () => {
    const count: Record<string, number> = {};
    for (const b of BEYBLADES) {
      expect(TYPES).toContain(b.type);
      count[b.type] = (count[b.type] ?? 0) + 1;
    }
    for (const t of TYPES) {
      expect(count[t] ?? 0, `${t} 類型不足兩顆`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("個體差數值（contract 範圍）", () => {
  it("mods 只允許四圍欄位、值在 0.92~1.08、每顆 1~2 個欄位偏移", () => {
    for (const b of BEYBLADES) {
      const keys = Object.keys(b.mods);
      expect(keys.length, `${b.id} mods 欄位數`).toBeGreaterThanOrEqual(1);
      expect(keys.length, `${b.id} mods 欄位數`).toBeLessThanOrEqual(2);
      for (const [k, v] of Object.entries(b.mods)) {
        expect(["attack", "defense", "stamina", "weight"]).toContain(k);
        expect(v, `${b.id}.mods.${k}`).toBeGreaterThanOrEqual(0.92);
        expect(v, `${b.id}.mods.${k}`).toBeLessThanOrEqual(1.08);
      }
    }
  });

  it("crit 0.03~0.08、specialPower 0.9~1.2", () => {
    for (const b of BEYBLADES) {
      expect(b.crit, `${b.id}.crit`).toBeGreaterThanOrEqual(0.03);
      expect(b.crit, `${b.id}.crit`).toBeLessThanOrEqual(0.08);
      expect(b.specialPower, `${b.id}.specialPower`).toBeGreaterThanOrEqual(0.9);
      expect(b.specialPower, `${b.id}.specialPower`).toBeLessThanOrEqual(1.2);
    }
  });

  it("無全維度優勢顆：mods 全為正向加成者，crit 或 specialPower 必須有一項低於基準", () => {
    for (const b of BEYBLADES) {
      const allUp = Object.values(b.mods).every((v) => v >= 1);
      if (allUp) {
        expect(
          b.crit < 0.05 || b.specialPower < 1.0,
          `${b.id} mods 全正向卻無 crit/specialPower 取捨`,
        ).toBe(true);
      }
    }
  });
});

describe("getBey / beyFullName", () => {
  it("getBey：存在的 id 取回同一筆、查無回 undefined", () => {
    for (const b of BEYBLADES) expect(getBey(b.id)).toBe(b);
    expect(getBey("no-such-bey")).toBeUndefined();
    expect(getBey("")).toBeUndefined();
  });

  it("beyFullName：「{name}-{類型中文}」", () => {
    const label: Record<BeyDef["type"], string> = {
      attack: "攻擊型",
      defense: "防禦型",
      stamina: "持久型",
      balance: "平衡型",
    };
    for (const b of BEYBLADES) {
      expect(beyFullName(b)).toBe(`${b.name}-${label[b.type]}`);
    }
    // contract 範例釘死一筆
    expect(beyFullName(getBey("prison-steel-saw")!)).toBe("獄鋼斬輪-防禦型");
  });
});

describe("DEFAULT_LINEUP（新手預設陣容）", () => {
  it("恰 3 格、beyId 都存在於名冊", () => {
    expect(DEFAULT_LINEUP.length).toBe(3);
    for (const slot of DEFAULT_LINEUP) {
      expect(getBey(slot.beyId), slot.beyId).toBeDefined();
    }
  });

  it("三顆不同類型、special 合法", () => {
    const types = DEFAULT_LINEUP.map((s) => getBey(s.beyId)!.type);
    expect(new Set(types).size).toBe(3);
    for (const slot of DEFAULT_LINEUP) {
      expect(SPECIALS).toContain(slot.special);
    }
  });
});

describe("resolveBeyStats（個體差套用）", () => {
  const base: BeybladeStats = { attack: 1.0, defense: 0.8, stamina: 1.2, weight: 1.1 };

  it("base 四欄 × mods（缺欄 = 1）", () => {
    const bey = getBey("scarlet-blaze-wheel")!; // mods: attack 1.08, defense 0.93
    const r = resolveBeyStats(bey, base);
    expect(r.attack).toBeCloseTo(1.0 * 1.08, 10);
    expect(r.defense).toBeCloseTo(0.8 * 0.93, 10);
    expect(r.stamina).toBeCloseTo(1.2, 10); // 缺欄不變
    expect(r.weight).toBeCloseTo(1.1, 10); // 缺欄不變
  });

  it("附上 crit / specialPower 欄位", () => {
    for (const bey of BEYBLADES) {
      const r = resolveBeyStats(bey, base) as BeybladeStats & {
        crit?: number;
        specialPower?: number;
      };
      expect(r.crit).toBe(bey.crit);
      expect(r.specialPower).toBe(bey.specialPower);
    }
  });

  it("不改動 base（純函式）", () => {
    const frozen = { ...base };
    resolveBeyStats(getBey("fallen-star-armor")!, base);
    expect(base).toEqual(frozen);
  });
});

describe("名冊凍結鎖（id/name 永不可變；mods/數值可調不入鎖）", () => {
  // 同 names.test.ts 慣例：id/name 存 DB 與線上協定 → 插入/刪除/重排/改名都會讓
  // 既有玩家的陣容指向錯亂。要動 roster 只准「追加新顆」或修數值；若真要改 id/name，
  // 此鎖會逼你有意識地更新常數並處理既有資料遷移。
  function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  it("條目數凍結（10）", () => {
    expect(BEYBLADES.length).toBe(10);
  });
  it("id+name checksum 凍結", () => {
    const joined = BEYBLADES.map((b) => `${b.id}:${b.name}`).join("\n");
    expect(fnv1a(joined).toString(16)).toBe("44f8b176");
  });
});
