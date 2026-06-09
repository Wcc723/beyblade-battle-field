/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// 平衡分析專用設定（npm run balance），與一般 npm test 分離
export default defineConfig({
  test: {
    // 基礎平衡（四類型互打、不裝必殺）+ 必殺技平衡（裝必殺後的偏移）
    include: ["test/balance.bench.ts", "test/balance-special.bench.ts"],
    environment: "node",
    fileParallelism: false, // 兩支依序跑 → console 輸出不交錯
  },
});
