/**
 * 必殺技平衡分析：在 DEFAULT_ARENA 上量測每個必殺技對平衡的影響。
 * 基礎平衡（四類型互打、刻意不裝必殺）見 balance.bench.ts；此處專測「裝了必殺技」之後的偏移。
 * 執行：npm run balance（與基礎平衡一起跑，已設 fileParallelism:false 確保輸出不交錯）
 *
 * 實驗 B 必殺增益：同型鏡像，一方裝技、一方不裝 → 裝技方勝率（>50%=增益，<50%=拖累）。
 *                  按四型分欄 → 看「哪招適合哪型」。
 * 實驗 C 必殺互打：balance 型雙方各裝一招 → 招 vs 招矩陣（誰剋誰）。
 * 兩實驗皆 side-averaged（紅藍對調抵銷位置偏差）。
 */
import { it } from "vitest";
import { simulate, buildInit, DEFAULT_ARENA } from "../src/physics/engine";
import type { ArenaConfig, BeybladeInit } from "../src/physics/types";
import { STAT_PRESETS } from "../src/physics/presets";
import { makeRng } from "../src/physics/prng";

const TYPES = ["attack", "defense", "stamina", "balance"] as const;
type T = (typeof TYPES)[number];
const SPECIALS = ["rush", "blast", "dash", "vortex", "clone"] as const;
type S = (typeof SPECIALS)[number];
const SP_ZH: Record<S, string> = { rush: "突進", blast: "衝擊", dash: "高速", vortex: "旋渦", clone: "分身" };

const N = 120; // 每方向場數（side-averaged → 每格 2N 場）
let seedCounter = 1; // 遞增 seed：讓 seeded 必殺機率觸發在各場間有變異

function mkInit(id: string, type: T, side: 0 | 1, dir: 1 | -1, special: "" | S, arena: ArenaConfig, rng: () => number): BeybladeInit {
  const startAngleDeg = (side === 0 ? 180 : 0) + (rng() * 40 - 20);
  const angleDeg = (side === 0 ? 0 : 180) + (rng() * 60 - 30);
  const power = 0.45 + rng() * 0.45;
  const spinPower = 0.85 + rng() * 0.15;
  const init = buildInit(
    { id, color: "#fff", stats: STAT_PRESETS[type], angleDeg, power, spinPower, startAngleDeg, spinDir: dir },
    arena,
  );
  if (special) init.special = special; // buildInit 不帶 special，這裡補上
  return init;
}

function match(redType: T, redSp: "" | S, blueType: T, blueSp: "" | S, rng: () => number) {
  const dirRed: 1 | -1 = rng() < 0.5 ? 1 : -1;
  return simulate(
    [mkInit("R", redType, 0, dirRed, redSp, DEFAULT_ARENA, rng), mkInit("B", blueType, 1, dirRed === 1 ? -1 : 1, blueSp, DEFAULT_ARENA, rng)],
    { dt: 1 / 60, maxTime: 60, arena: DEFAULT_ARENA, followThroughTime: 0, seed: seedCounter++ },
  );
}

/** side-averaged：A 配置 vs B 配置，回傳 A 方勝率%。 */
function winRate(aType: T, aSp: "" | S, bType: T, bSp: "" | S, rng: () => number): number {
  let aWins = 0;
  let games = 0;
  for (let k = 0; k < N; k++) {
    const r = match(aType, aSp, bType, bSp, rng);
    if (r.winnerId === "R") aWins++;
    if (r.winnerId) games++;
  }
  for (let k = 0; k < N; k++) {
    const r = match(bType, bSp, aType, aSp, rng); // 對調紅藍
    if (r.winnerId === "B") aWins++;
    if (r.winnerId) games++;
  }
  return games ? (aWins / games) * 100 : 50;
}

const cell = (v: number) => (v.toFixed(0) + "%").padStart(8);

it("balance-special", () => {
  const rng = makeRng(70260608);

  console.log("\n【必殺技平衡】場地=DEFAULT_ARENA，每格 " + 2 * N + " 場（side-averaged）");
  console.log("招式：rush=突進 blast=衝擊 dash=高速移動 vortex=旋渦 clone=分身\n");

  // ---- 實驗 B：必殺增益（同型鏡像，裝技方勝率）----
  console.log("=== 實驗 B 必殺增益：同型鏡像，裝技方勝率%（>50=變強 <50=拖累）===");
  console.log("        " + TYPES.map((t) => t.padStart(8)).join("") + "      平均");
  const liftAvg: Record<S, number> = {} as Record<S, number>;
  for (const s of SPECIALS) {
    const row = TYPES.map((t) => winRate(t, s, t, "", rng));
    const avg = row.reduce((a, b) => a + b, 0) / row.length;
    liftAvg[s] = avg;
    console.log(s.padEnd(8) + row.map(cell).join("") + "   " + avg.toFixed(1) + "%");
  }

  // ---- 實驗 C：必殺互打（balance 型雙方各裝一招）----
  console.log("\n=== 實驗 C 必殺互打：balance 型，列 vs 欄（列方勝率%）===");
  const spH2h: Record<string, Record<string, number>> = {};
  for (const a of SPECIALS) spH2h[a] = {};
  for (let i = 0; i < SPECIALS.length; i++) {
    for (let j = i; j < SPECIALS.length; j++) {
      const a = SPECIALS[i];
      const b = SPECIALS[j];
      const wr = i === j ? 50 : winRate("balance", a, "balance", b, rng);
      spH2h[a][b] = wr;
      if (a !== b) spH2h[b][a] = 100 - wr;
    }
  }
  console.log("        " + SPECIALS.map((s) => s.padStart(8)).join(""));
  for (const a of SPECIALS) {
    console.log(a.padEnd(8) + SPECIALS.map((b) => (a === b ? "—".padStart(8) : cell(spH2h[a][b]))).join(""));
  }

  // ---- 招式強度排行（依實驗 B 平均增益）----
  console.log("\n=== 必殺技強度排行（依實驗 B 平均增益，50%=中性）===");
  [...SPECIALS]
    .sort((a, b) => liftAvg[b] - liftAvg[a])
    .forEach((s, i) => console.log(`  ${i + 1}. ${s.padEnd(7)} ${SP_ZH[s]}  ${liftAvg[s].toFixed(1)}%`));
}, 120_000);
