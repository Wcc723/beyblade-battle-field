<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import ArenaAdmin from "../components/ArenaAdmin.vue";
import { localArenaApi, createRemoteArenaApi, type ArenaStoreApi } from "../store/adminBackend";

const router = useRouter();
const mode = ref<"online" | "local">("online");
let remoteApi: ArenaStoreApi | null = null;

function storeFor(m: "online" | "local"): ArenaStoreApi {
  if (m === "local") return localArenaApi;
  remoteApi ??= createRemoteArenaApi(); // 第一次切到線上才載入
  return remoteApi;
}
</script>

<template>
  <div class="mode-bar">
    <button :class="{ active: mode === 'online' }" @click="mode = 'online'">🌐 線上設定（D1）</button>
    <button :class="{ active: mode === 'local' }" @click="mode = 'local'">💻 本機測試（localStorage）</button>
    <span class="mode-hint">
      {{ mode === "online" ? "正式線上對戰用的全域場地（所有玩家共用）" : "測試頁（🧪 / 📱）用的本機場地" }}
    </span>
  </div>
  <!-- :key 讓切換資料源時重掛元件 → 編輯器草稿不會殘留另一邊的內容。
       線上模式藏「回對戰場試打」：測試頁吃本機 localStorage，不是這裡改的 D1。 -->
  <ArenaAdmin
    :key="mode"
    :store="storeFor(mode)"
    :show-go-battle="mode === 'local'"
    @go-battle="router.push('/test/battle')"
  />
</template>

<style scoped>
.mode-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.mode-bar button {
  background: var(--panel);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 7px 13px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.mode-bar button.active {
  background: var(--blue);
  color: #07121d;
  border-color: var(--blue);
}
.mode-hint {
  color: var(--muted);
  font-size: 12px;
}
</style>
