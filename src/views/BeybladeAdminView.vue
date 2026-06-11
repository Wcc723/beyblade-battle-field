<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import BeybladeAdmin from "../components/BeybladeAdmin.vue";
import { localTuningApi, createRemoteTuningApi, type TuningStoreApi } from "../store/adminBackend";

const router = useRouter();
const mode = ref<"online" | "local">("online");
let remoteApi: TuningStoreApi | null = null; // 此 view 實例存活期間共用（離開路由即銷毀重建）

function tuningFor(m: "online" | "local"): TuningStoreApi {
  if (m === "local") return localTuningApi;
  remoteApi ??= createRemoteTuningApi(); // 第一次切到線上才載入
  return remoteApi;
}

// 離開頁面把 debounce 中的寫入立刻送出（不然 600ms 內導航會掉最後一筆）
onBeforeUnmount(() => remoteApi?.dispose?.());
</script>

<template>
  <div class="mode-bar">
    <button :class="{ active: mode === 'online' }" @click="mode = 'online'">線上設定（D1）</button>
    <button :class="{ active: mode === 'local' }" @click="mode = 'local'">本機測試（localStorage）</button>
    <span class="mode-hint">
      {{ mode === "online" ? "正式線上對戰用的全域屬性/必殺技（所有玩家共用）" : "測試頁用的本機數值" }}
    </span>
  </div>
  <BeybladeAdmin
    :key="mode"
    :tuning="tuningFor(mode)"
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
