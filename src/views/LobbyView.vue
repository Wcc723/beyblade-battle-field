<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const roomCode = ref("");
const codeError = ref("");

function joinByCode() {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) return;
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    codeError.value = "房號格式：6 位英數（例：AB12CD）";
    return;
  }
  codeError.value = "";
  // 具名路由 + params → 自動 URL 編碼，不會拼出壞路徑
  router.push({ name: "room", params: { code } });
}
</script>

<template>
  <div class="lobby">
    <section class="card">
      <h2>🏟️ 對戰大廳</h2>
      <p class="hint">線上人數、快速配對與公開房間列表將在後續階段接上（Lobby Durable Object）。</p>
      <div class="join-row">
        <input
          v-model="roomCode"
          placeholder="輸入房號加入（例：AB12CD）"
          maxlength="6"
          @keyup.enter="joinByCode"
        />
        <button :disabled="!roomCode.trim()" @click="joinByCode">加入房間</button>
      </div>
      <p v-if="codeError" class="error">{{ codeError }}</p>
      <div class="actions">
        <button class="primary" disabled>⚡ 快速配對（即將推出）</button>
        <button disabled>➕ 開新房間（即將推出）</button>
      </div>
    </section>
    <section class="card">
      <h3>公開房間</h3>
      <p class="hint">尚無公開房間。</p>
    </section>
  </div>
</template>

<style scoped>
.lobby {
  display: grid;
  gap: 16px;
  max-width: 560px;
  margin: 0 auto;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
}
.card h2,
.card h3 {
  margin: 0 0 8px;
}
.hint {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.join-row {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.error {
  color: var(--red);
  font-size: 13px;
  margin: -4px 0 10px;
}
.join-row input {
  flex: 1;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text);
  padding: 10px 12px;
  font-size: 15px;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.join-row button,
.actions button {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.join-row button:disabled,
.actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.actions .primary {
  background: var(--accent);
  color: #1a1207;
  border-color: var(--accent);
}
</style>
