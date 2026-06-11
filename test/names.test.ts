import { describe, it, expect } from "vitest";
import { NICKNAME_POOL, BEYBLADE_POOL, autoNickname, beybladeName } from "../src/game/names";

/** 官方戰鬥陀螺禁詞（陀螺名/角色名，中英都掃）——池子任何名字都不可沾到 */
const BANNED = [
  "爆烈",
  "瓦爾基里",
  "朗基努斯",
  "斯普利根",
  "法夫納",
  "阿基里斯",
  "貝爾",
  "戰鬥陀螺",
  "valkyrie",
  "longinus",
  "spriggan",
  "fafnir",
  "achilles",
  "belial",
  "valt",
  "beyblade",
];

describe("名字池（規模與品質）", () => {
  it("暱稱池 ≥100、陀螺名池 ≥60", () => {
    expect(NICKNAME_POOL.length).toBeGreaterThanOrEqual(100);
    expect(BEYBLADE_POOL.length).toBeGreaterThanOrEqual(60);
  });

  it("各池內無重複", () => {
    expect(new Set(NICKNAME_POOL).size).toBe(NICKNAME_POOL.length);
    expect(new Set(BEYBLADE_POOL).size).toBe(BEYBLADE_POOL.length);
  });

  it("暱稱池與陀螺名池不重疊", () => {
    const beySet = new Set(BEYBLADE_POOL);
    const overlap = NICKNAME_POOL.filter((n) => beySet.has(n));
    expect(overlap).toEqual([]);
  });

  it("禁詞掃描：全池不得含官方戰鬥陀螺詞彙", () => {
    for (const name of [...NICKNAME_POOL, ...BEYBLADE_POOL]) {
      const lower = name.toLowerCase();
      for (const banned of BANNED) {
        expect(lower.includes(banned), `「${name}」含禁詞「${banned}」`).toBe(false);
      }
    }
  });

  it("名字非空且無前後空白", () => {
    for (const name of [...NICKNAME_POOL, ...BEYBLADE_POOL]) {
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("autoNickname（穩定 hash）", () => {
  it("確定性：同 uid 永遠同名", () => {
    for (const uid of [1, 7, 42, 9999, 123456789]) {
      expect(autoNickname(uid)).toBe(autoNickname(uid));
    }
  });

  it("結果一定出自暱稱池", () => {
    for (let uid = 0; uid < 300; uid++) {
      expect(NICKNAME_POOL).toContain(autoNickname(uid));
    }
  });

  it("不同 uid 有足夠變化（200 個 uid 至少命中 50 種名字）", () => {
    const names = new Set<string>();
    for (let uid = 1; uid <= 200; uid++) names.add(autoNickname(uid));
    expect(names.size).toBeGreaterThanOrEqual(50);
  });
});

describe("beybladeName（uid + 類型穩定 hash）", () => {
  it("確定性：同 uid + 同 type 永遠同名", () => {
    for (const uid of [1, 7, 42, 9999]) {
      for (const type of ["attack", "defense", "stamina", "balance"]) {
        expect(beybladeName(uid, type)).toBe(beybladeName(uid, type));
      }
    }
  });

  it("結果一定出自陀螺名池", () => {
    for (let uid = 0; uid < 100; uid++) {
      expect(BEYBLADE_POOL).toContain(beybladeName(uid, "attack"));
    }
  });

  it("同 uid 不同 type 通常不同名（100 個 uid 中 attack≠defense 至少 80 個）", () => {
    let diff = 0;
    for (let uid = 1; uid <= 100; uid++) {
      if (beybladeName(uid, "attack") !== beybladeName(uid, "defense")) diff++;
    }
    expect(diff).toBeGreaterThanOrEqual(80);
  });
});
