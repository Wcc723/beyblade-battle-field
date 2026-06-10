/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// 一般單元測試設定（npm test）。
// 刻意不重用 vite.config.ts：那邊掛了 @cloudflare/vite-plugin，測試不需要 worker runtime。
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
