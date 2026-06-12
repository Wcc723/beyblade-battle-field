<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { useAuth } from "./store/authStore";
import BbIcon from "./components/ui/BbIcon.vue";

const auth = useAuth();
const router = useRouter();
const route = useRoute();

onMounted(() => auth.ensureLoaded());

async function onLogout() {
  await auth.logout();
  router.push("/login");
}

// 行動版 Tab Bar：對戰廳與測試頁要沉浸，整條隱藏
const hideTabbar = computed(() =>
  ["room", "test-battle", "test-mobile"].includes(String(route.name ?? "")),
);

// 無頭像時的縮寫字母圓徽（取名稱或信箱首字）
const initial = computed(() => {
  const u = auth.user.value;
  const s = (u?.name || u?.email || "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
});
</script>

<template>
  <div class="page" :class="{ 'with-tabbar': !hideTabbar }">
    <header class="forge-header plate plate--rivets">
      <div class="brand">
        <span class="emblem" aria-hidden="true">
          <!-- 自繪陀螺標記：外環 + 軸心 + 四向動勢線 -->
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="12" cy="12" r="8.2" />
            <circle cx="12" cy="12" r="2.6" />
            <path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6" />
          </svg>
        </span>
        <span class="brand-txt">
          <b>戰鬥陀螺</b>
          <em>BURST FORGE / ONLINE VS</em>
        </span>
      </div>
      <!-- 桌機水平導覽：一般玩家只有大廳/個人設定，測試與後台入口僅管理員可見 -->
      <nav class="top-nav">
        <RouterLink to="/">大廳</RouterLink>
        <RouterLink to="/roster">陀螺庫</RouterLink>
        <RouterLink to="/settings">個人設定</RouterLink>
        <template v-if="auth.isAdmin.value">
          <RouterLink to="/test/battle">測試對戰</RouterLink>
          <RouterLink to="/test/mobile">測試手機版</RouterLink>
          <RouterLink to="/admin/arena">場地後台</RouterLink>
          <RouterLink to="/admin/beyblade">陀螺後台</RouterLink>
        </template>
      </nav>
      <!-- 等 /api/me 回來再渲染，避免已登入者先閃一下「登入」鈕 -->
      <div class="auth-box" v-if="auth.loaded.value">
        <template v-if="auth.user.value">
          <img
            v-if="auth.user.value.picture"
            :src="auth.user.value.picture"
            class="avatar"
            alt=""
            referrerpolicy="no-referrer"
          />
          <span v-else class="avatar avatar-fallback">{{ initial }}</span>
          <span class="uname">{{ auth.user.value.name || auth.user.value.email }}</span>
          <button class="logout f-btn f-btn--ghost" title="登出" @click="onLogout">
            <BbIcon name="box-arrow-right" :size="15" />
            <span class="logout-txt">登出</span>
          </button>
        </template>
        <RouterLink v-else class="login-link f-btn f-btn--primary" to="/login">登入</RouterLink>
      </div>
      <div class="auth-box" v-else></div>
    </header>
    <RouterView />
  </div>

  <!-- 行動版固定底部 Tab Bar（桌機隱藏；對戰/測試頁沉浸不顯示） -->
  <nav v-if="!hideTabbar" class="tabbar" aria-label="主要導覽">
    <RouterLink to="/" class="tab" :class="{ on: route.name === 'lobby' }">
      <BbIcon name="house" :size="20" />
      <span>大廳</span>
    </RouterLink>
    <RouterLink to="/roster" class="tab" :class="{ on: route.name === 'roster' }">
      <BbIcon name="shield" :size="20" />
      <span>陀螺</span>
    </RouterLink>
    <RouterLink to="/settings" class="tab" :class="{ on: route.name === 'settings' }">
      <BbIcon name="person" :size="20" />
      <span>個人設定</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.page {
  max-width: 1180px; /* admin / test 頁要寬 */
  margin: 0 auto;
  padding: 20px 18px 60px;
}

/* ---- Header：切角金屬殼 + 一次淡入下滑進場 ---- */
.forge-header {
  --cut: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 18px;
  animation: headerIn 0.5s cubic-bezier(0.16, 0.9, 0.3, 1) both;
}
@keyframes headerIn {
  from {
    opacity: 0;
    transform: translateY(-14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ---- 標誌 ---- */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.emblem {
  width: 38px;
  height: 38px;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: radial-gradient(circle at 50% 30%, #3a4150, #181b22 70%);
  clip-path: polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.emblem svg {
  animation: emblemSpin 9s linear infinite;
}
@keyframes emblemSpin {
  to {
    transform: rotate(360deg);
  }
}
.brand-txt {
  line-height: 1.02;
}
.brand-txt b {
  display: block;
  font-family: var(--f-d);
  font-weight: 900;
  font-size: 19px;
  letter-spacing: 0.14em;
  transform: skewX(-6deg);
  background: linear-gradient(100deg, #ffe9c4 10%, var(--accent) 38%, var(--lava) 72%, #d8490e);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 6px rgba(255, 122, 24, 0.35));
}
.brand-txt em {
  display: block;
  font-style: normal;
  font-family: var(--f-d);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.42em;
  color: var(--muted);
  margin-top: 2px;
}

/* ---- 桌機水平導覽（行動版隱藏，走 Tab Bar） ---- */
.top-nav {
  display: none;
}
@media (min-width: 768px) {
  .top-nav {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    flex: 1;
    justify-content: center;
  }
}
.top-nav a {
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: var(--muted);
  text-decoration: none;
  padding: 9px 13px;
  background: linear-gradient(180deg, var(--panel-2), #171a20);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: color 0.15s;
}
.top-nav a:hover {
  color: var(--text);
}
.top-nav a.router-link-exact-active {
  color: #1a0d02;
  background: linear-gradient(180deg, #ffd97a, var(--accent) 45%, var(--lava));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 -3px 5px rgba(160, 60, 0, 0.5);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
}

/* ---- 右側：頭像 + 登出 ---- */
.auth-box {
  display: flex;
  align-items: center;
  gap: 8px;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
  border: 2px solid #3a4150;
  box-shadow: 0 0 0 2px #0a0c10, inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
.avatar-fallback {
  display: grid;
  place-items: center;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 14px;
  color: var(--white-hot);
  background: radial-gradient(circle at 35% 28%, #454d5d, #1d2129 68%);
}
.uname {
  color: var(--muted);
  font-size: 13px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 機台鍵縮小版（覆寫 .f-btn 尺寸） */
.logout,
.login-link {
  min-height: 34px;
  padding: 6px 12px;
  font-size: 13px;
  letter-spacing: 0.1em;
  gap: 6px;
}

/* ---- 行動版固定底部 Tab Bar ---- */
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: none;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 10px 14px calc(9px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, #262b34, #15181e 45%, #0d0f14);
  clip-path: polygon(0 14px, 14px 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
  filter: drop-shadow(0 -8px 20px rgba(0, 0, 0, 0.5));
}
.tabbar::before {
  /* 上緣警示斜紋 */
  content: "";
  position: absolute;
  top: 0;
  left: 14px;
  right: 14px;
  height: 3px;
  background: repeating-linear-gradient(-45deg, var(--accent) 0 8px, #14161b 8px 16px);
  opacity: 0.55;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 48px;
  padding: 6px 4px 4px;
  color: var(--muted);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  text-decoration: none;
  clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 100%, 0 100%);
  transition: color 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.tab.on {
  color: var(--accent);
  background: linear-gradient(180deg, rgba(255, 122, 24, 0.16), transparent 75%);
  text-shadow: 0 0 10px rgba(255, 179, 31, 0.4);
}
.tab.on::after {
  content: "";
  width: 26px;
  height: 2.5px;
  margin-top: 2px;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}

/* ---- 行動版（<768px）：header 精簡 + Tab Bar 顯示 + 內容讓位 ---- */
@media (max-width: 767.98px) {
  .page {
    padding: 14px 12px 40px;
  }
  .page.with-tabbar {
    padding-bottom: calc(92px + env(safe-area-inset-bottom));
  }
  .tabbar {
    display: grid;
  }
  .uname,
  .logout-txt {
    display: none;
  }
  .brand-txt b {
    font-size: 17px;
  }
  .brand-txt em {
    font-size: 9px;
    letter-spacing: 0.3em;
  }
}
</style>
