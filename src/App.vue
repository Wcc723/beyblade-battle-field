<script setup lang="ts">
import { ref } from "vue";
import BattleViz from "./components/BattleViz.vue";
import ArenaAdmin from "./components/ArenaAdmin.vue";
import BeybladeAdmin from "./components/BeybladeAdmin.vue";

const view = ref<"battle" | "arena" | "beyblade">("battle");
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="title-row">
        <h1>⚔️ 戰鬥陀螺 — 物理引擎原型</h1>
        <nav class="tabs">
          <button :class="{ active: view === 'battle' }" @click="view = 'battle'">對戰場</button>
          <button :class="{ active: view === 'arena' }" @click="view = 'arena'">⚙️ 場地後台</button>
          <button :class="{ active: view === 'beyblade' }" @click="view = 'beyblade'">🌀 陀螺後台</button>
        </nav>
      </div>
      <p class="subtitle">
        拖曳發射（手機優先）：紅藍分開瞄準發射 → 伺服器（此處本機）統一運算 → 回放軌跡。
        場地參數可在「場地後台」存多組切換；陀螺攻防續重可在「陀螺後台」調整。
      </p>
    </header>
    <BattleViz v-if="view === 'battle'" />
    <ArenaAdmin v-else-if="view === 'arena'" @go-battle="view = 'battle'" />
    <BeybladeAdmin v-else @go-battle="view = 'battle'" />
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
}
.page-header h1 {
  margin: 0;
  font-size: 22px;
}
.tabs {
  display: flex;
  gap: 8px;
}
.tabs button {
  background: var(--panel);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tabs button.active {
  background: var(--accent);
  color: #1a1207;
  border-color: var(--accent);
}
.subtitle {
  margin: 10px 0 18px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
</style>
