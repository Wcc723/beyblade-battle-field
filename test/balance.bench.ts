/**
 * 平衡分析工具：四類型互打，統計勝率、勝負原因與對戰矩陣（已抵銷紅藍位置偏差）。
 * 執行： npm run balance
 * 讀取目前的 STAT_PRESETS 與 DEFAULT_ARENA，調完數值重跑即可看新平衡。
 */
import { it } from "vitest";
import { simulate, buildInit, DEFAULT_ARENA } from "../src/physics/engine";
import type { ArenaConfig } from "../src/physics/types";
import { STAT_PRESETS } from "../src/physics/presets";
import { makeRng } from "../src/physics/prng";

const TYPES = ["attack", "defense", "stamina", "balance"] as const;
type T = (typeof TYPES)[number];
const N = 150; // 每個對局每個方向的場數

function match(redType: T, blueType: T, arena: ArenaConfig, rng: () => number) {
  const mk = (id: string, type: T, side: 0 | 1, dir: 1 | -1) => {
    const startAngleDeg = (side === 0 ? 180 : 0) + (rng() * 40 - 20);
    const angleDeg = (side === 0 ? 0 : 180) + (rng() * 60 - 30);
    const power = 0.45 + rng() * 0.45;
    const spinPower = 0.85 + rng() * 0.15;
    return buildInit(
      { id, color: "#fff", stats: STAT_PRESETS[type], angleDeg, power, spinPower, startAngleDeg, spinDir: dir },
      arena,
    );
  };
  const dirRed: 1 | -1 = rng() < 0.5 ? 1 : -1;
  return simulate([mk("R", redType, 0, dirRed), mk("B", blueType, 1, (dirRed === 1 ? -1 : 1))], {
    dt: 1 / 60,
    maxTime: 60,
    arena,
    followThroughTime: 0,
  });
}

it("balance", () => {
  const rng = makeRng(20260608);
  const reasons: Record<string, number> = { "ring-out": 0, "spin-out": 0, timeout: 0, draw: 0, ko: 0, burst: 0 };
  // 平手構成診斷：雙KO / 雙停轉(hp 完全相等) / 雙出界 / 混合同步（死法不同）/ 其他（timeout 同分等）
  const drawKinds: Record<string, number> = { "雙ko": 0, "雙spin-out": 0, "雙ring-out": 0, "混合同步": 0, "其他": 0 };
  const classifyDraw = (r: ReturnType<typeof match>) => {
    const [d1, d2] = r.deathEvents;
    if (d1 && d2) {
      drawKinds[d1.reason === d2.reason ? `雙${d1.reason}` : "混合同步"]++;
    } else {
      drawKinds["其他"]++;
    }
  };
  // h2h[x][y] = x 對 y 的勝率（side-averaged）
  const h2h: Record<string, Record<string, number>> = {};
  for (const x of TYPES) h2h[x] = {};
  // 每組對局的勝負原因分解（診斷用：看「哪種對局靠什麼分勝負」）
  const pairReasons: Array<{ pair: string; r: Record<string, number>; n: number }> = [];

  for (let i = 0; i < TYPES.length; i++) {
    for (let j = i; j < TYPES.length; j++) {
      const x = TYPES[i];
      const y = TYPES[j];
      let xWins = 0;
      let games = 0;
      const pr: Record<string, number> = { "ring-out": 0, "spin-out": 0, timeout: 0, draw: 0, ko: 0 };
      // x 當紅、y 當藍
      for (let k = 0; k < N; k++) {
        const r = match(x, y, DEFAULT_ARENA, rng);
        reasons[r.reason]++;
        pr[r.reason]++;
        if (!r.winnerId) classifyDraw(r);
        if (r.winnerId === "R") xWins++;
        if (r.winnerId) games++;
      }
      // y 當紅、x 當藍（抵銷位置偏差）
      for (let k = 0; k < N; k++) {
        const r = match(y, x, DEFAULT_ARENA, rng);
        reasons[r.reason]++;
        pr[r.reason]++;
        if (!r.winnerId) classifyDraw(r);
        if (r.winnerId === "B") xWins++;
        if (r.winnerId) games++;
      }
      pairReasons.push({ pair: `${x} vs ${y}`, r: pr, n: N * 2 });
      const xRate = games ? (xWins / games) * 100 : 50;
      h2h[x][y] = xRate;
      if (x !== y) h2h[y][x] = 100 - xRate;
      else h2h[x][y] = 50;
    }
  }

  const overall: Record<string, number> = {};
  for (const x of TYPES) {
    const opp = TYPES.filter((y) => y !== x);
    overall[x] = opp.reduce((s, y) => s + h2h[x][y], 0) / opp.length;
  }

  let total = 0;
  for (const k of Object.keys(reasons)) total += reasons[k];

  console.log("\n=== 各類型整體勝率（對其他三類型平均）===");
  for (const x of TYPES) console.log(`  ${x.padEnd(8)} ${overall[x].toFixed(1)}%`);
  console.log("\n=== 勝負原因分佈 ===");
  for (const k of Object.keys(reasons)) console.log(`  ${k.padEnd(9)} ${((reasons[k] / total) * 100).toFixed(1)}%`);
  console.log("\n=== 平手構成（佔全部場數 %）===");
  for (const k of Object.keys(drawKinds)) console.log(`  ${k.padEnd(12)} ${((drawKinds[k] / total) * 100).toFixed(2)}%（${drawKinds[k]} 場）`);
  console.log("\n=== 對戰勝率矩陣（列 vs 欄，列的勝率%）===");
  console.log("          " + TYPES.map((t) => t.padStart(9)).join(""));
  for (const x of TYPES) {
    console.log(x.padEnd(9) + TYPES.map((y) => (x === y ? "    —" : h2h[x][y].toFixed(0) + "%").padStart(9)).join(""));
  }

  console.log("\n=== 每組對局勝負原因（%）===");
  for (const { pair, r, n } of pairReasons) {
    const parts = ["ko", "spin-out", "ring-out", "timeout", "draw"]
      .map((k) => `${k} ${((r[k] / n) * 100).toFixed(0)}%`)
      .join("  ");
    console.log(`  ${pair.padEnd(22)} ${parts}`);
  }
}, 120_000);
