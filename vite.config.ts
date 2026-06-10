import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { cloudflare } from "@cloudflare/vite-plugin";

// 注意：vitest 設定在 vitest.config.ts（不含 cloudflare plugin，測試不啟動 worker runtime）
export default defineConfig({
  plugins: [vue(), cloudflare()],
});
