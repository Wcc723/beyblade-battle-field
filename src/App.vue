<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="title-row">
        <h1>⚔️ 戰鬥陀螺</h1>
        <nav class="tabs">
          <RouterLink to="/">🏟️ 大廳</RouterLink>
          <RouterLink to="/settings">👤 個人設定</RouterLink>
          <RouterLink to="/admin/arena">⚙️ 場地後台</RouterLink>
          <RouterLink to="/admin/beyblade">🌀 陀螺後台</RouterLink>
          <RouterLink to="/test/battle">🧪 測試對戰</RouterLink>
          <RouterLink to="/test/mobile">📱 測試手機版</RouterLink>
        </nav>
      </div>
    </header>
    <RouterView />
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  --bg: #0e1116;
  --panel: #1a1f29;
  --panel-2: #232a36;
  --line: #2e3645;
  --text: #e6e9ef;
  --muted: #9aa4b2;
  --accent: #ffd166;
  --red: #ff5d5d;
  --blue: #5db4ff;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Noto Sans TC", system-ui, -apple-system, "PingFang TC",
    "Microsoft JhengHei", sans-serif;
}
.page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px 18px 60px;
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.page-header h1 {
  margin: 0;
  font-size: 22px;
}
.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tabs a {
  background: var(--panel);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.tabs a.router-link-active {
  background: var(--accent);
  color: #1a1207;
  border-color: var(--accent);
}
</style>
