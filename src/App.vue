<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuth } from "./store/authStore";

const auth = useAuth();
const router = useRouter();

onMounted(() => auth.ensureLoaded());

async function onLogout() {
  await auth.logout();
  router.push("/login");
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="title-row">
        <h1>⚔️ 戰鬥陀螺</h1>
        <nav class="tabs">
          <RouterLink to="/">🏟️ 大廳</RouterLink>
          <RouterLink to="/settings">👤 個人設定</RouterLink>
          <RouterLink to="/test/battle">🧪 測試對戰</RouterLink>
          <RouterLink to="/test/mobile">📱 測試手機版</RouterLink>
          <!-- 管理員分頁放最後：載入完才插入，不會把其他分頁往右推 -->
          <template v-if="auth.isAdmin.value">
            <RouterLink to="/admin/arena">⚙️ 場地後台</RouterLink>
            <RouterLink to="/admin/beyblade">🌀 陀螺後台</RouterLink>
          </template>
        </nav>
        <!-- 等 /api/me 回來再渲染，避免已登入者先閃一下「登入」鈕 -->
        <div class="auth-box" v-if="auth.loaded.value">
          <template v-if="auth.user.value">
            <img v-if="auth.user.value.picture" :src="auth.user.value.picture" class="avatar" alt="" referrerpolicy="no-referrer" />
            <span class="uname">{{ auth.user.value.name || auth.user.value.email }}</span>
            <button class="logout" @click="onLogout">登出</button>
          </template>
          <RouterLink v-else class="login-link" to="/login">登入</RouterLink>
        </div>
        <div class="auth-box" v-else></div>
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
.auth-box {
  display: flex;
  align-items: center;
  gap: 8px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--line);
}
.uname {
  color: var(--muted);
  font-size: 13px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.logout,
.login-link {
  background: var(--panel);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.logout:hover,
.login-link:hover {
  color: var(--text);
}
</style>
