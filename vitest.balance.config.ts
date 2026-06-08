/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// 平衡分析專用設定（npm run balance），與一般 npm test 分離
export default defineConfig({
  test: {
    include: ["test/balance.bench.ts"],
    environment: "node",
  },
});
