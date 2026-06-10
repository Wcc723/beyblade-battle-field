<script setup lang="ts">
import { useRoute } from "vue-router";

const route = useRoute();
const code = String(route.params.code ?? "").toUpperCase();
</script>

<template>
  <div class="room">
    <section class="card">
      <h2>⚔️ 對戰廳 <span class="code">#{{ code }}</span></h2>
      <p class="hint">
        線上對戰廳將以手機版對戰介面為基準改造（Phase 4：Battle Room Durable Object +
        雙方並行瞄準 + 伺服器統一模擬）。
      </p>
      <RouterLink to="/" class="back">← 回大廳</RouterLink>
    </section>
  </div>
</template>

<style scoped>
.room {
  max-width: 560px;
  margin: 0 auto;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
}
.card h2 {
  margin: 0 0 8px;
}
.code {
  color: var(--accent);
  letter-spacing: 2px;
}
.hint {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.back {
  color: var(--blue);
  font-size: 14px;
  text-decoration: none;
}
</style>
