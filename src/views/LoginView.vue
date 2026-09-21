<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import BbIcon from "../components/ui/BbIcon.vue";

const route = useRoute();

// 整頁跳轉進 OAuth flow（不是 fetch）：/api/auth/login → Google 同意畫面 → callback 302 回原頁
function loginWithGoogle() {
  const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
  window.location.href = `/api/auth/login?redirect=${encodeURIComponent(redirect)}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "你取消了 Google 授權，未完成登入。",
  state_mismatch: "登入流程逾時或狀態不符，請再試一次。",
  token_exchange_failed: "與 Google 連線失敗，請稍後再試。",
  invalid_token: "Google 回傳的憑證無效，請再試一次。",
  server_error: "伺服器發生錯誤，請稍後再試。",
};
const errorMsg = computed(() =>
  typeof route.query.error === "string" ? (ERROR_MESSAGES[route.query.error] ?? "登入失敗，請再試一次。") : "",
);
</script>

<template>
  <div class="login">
    <!-- 機殼卡：plate--flush 讓頂部警示斜紋滿版貼齊 -->
    <section class="plate plate--flush plate--rivets shell">
      <div class="hazard" aria-hidden="true"></div>
      <div class="shell-in">
        <!-- 六角徽 + wordmark -->
        <span class="emblem" aria-hidden="true"><BbIcon name="lightning" :size="24" /></span>
        <h1 class="wordmark">戰鬥陀螺</h1>
        <p class="wordmark-sub">BURST FORGE / ONLINE VS</p>

        <div class="split" aria-hidden="true"></div>

        <p class="hint">
          免費的瀏覽器雙人線上對戰需要 Google 帳號登入（對戰暱稱由系統指派、可在個人設定修改，頭像取自 Google 帳號）。
        </p>

        <p v-if="errorMsg" class="error">
          <span class="f-badge f-badge--red">登入失敗</span>{{ errorMsg }}
        </p>

        <button class="f-btn f-btn--primary google" @click="loginWithGoogle">
          <BbIcon name="google" :size="18" />使用 Google 登入
        </button>

        <p class="hint small">測試頁（測試對戰／測試手機版）不需登入。</p>
        <!-- 整頁導航（不是 RouterLink）：未登入造訪 / 由 worker 回公開介紹頁 -->
        <p class="hint small">登入會儲存哪些資料，請看<a href="/#privacy">資料與隱私</a>。</p>
      </div>
    </section>

    <nav class="legal" aria-label="相關連結">
      <a href="/">認識戰鬥陀螺</a>
      <a href="https://www.pocketool.app/privacy">隱私權政策</a>
      <a href="https://www.pocketool.app/terms">服務條款</a>
      <a href="https://www.pocketool.app/contact">聯絡</a>
      <a href="https://www.pocketool.app/">口袋工具</a>
    </nav>
  </div>
</template>

<style scoped>
.login {
  max-width: 420px;
  margin: 36px auto 0;
}
.shell-in {
  padding: 28px 22px 24px;
  text-align: center;
}

/* ---- 六角徽：慢轉能量符號 ---- */
.emblem {
  width: 54px;
  height: 54px;
  margin: 0 auto;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: radial-gradient(circle at 50% 30%, #3a4150, #181b22 70%);
  clip-path: polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
  filter: drop-shadow(0 0 14px rgba(255, 122, 24, 0.3));
}
.emblem svg {
  animation: emblemSpin 9s linear infinite;
}
@keyframes emblemSpin {
  to {
    transform: rotate(360deg);
  }
}

/* ---- wordmark：斜切熔岩漸層字 ---- */
.wordmark {
  margin: 13px 0 0;
  font-family: var(--f-b);
  font-weight: 900;
  font-size: 27px;
  letter-spacing: 0.16em;
  text-indent: 0.16em;
  transform: skewX(-6deg);
  background: linear-gradient(100deg, #ffe9c4 10%, var(--accent) 38%, var(--lava) 72%, #d8490e);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 6px rgba(255, 122, 24, 0.35));
}
.wordmark-sub {
  margin: 7px 0 0;
  font-family: var(--f-d);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.42em;
  text-indent: 0.42em;
  color: var(--muted);
}
.split {
  width: 72%;
  height: 1px;
  margin: 20px auto 0;
  background: linear-gradient(90deg, transparent, rgba(170, 180, 196, 0.3), transparent);
}

.hint {
  margin: 16px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.hint.small {
  margin-top: 14px;
  font-size: 11.5px;
  letter-spacing: 0.04em;
}
.hint a {
  color: var(--accent);
}

/* ---- 頁尾連結（隱私權政策等，連到口袋工具主站） ---- */
.legal {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 16px;
  margin: 18px 0 0;
  font-size: 12.5px;
}
.legal a {
  color: var(--muted);
}
.legal a:hover {
  color: var(--accent);
}

/* ---- 錯誤列：紅章 + 文案 ---- */
.error {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 0;
  padding: 9px 12px;
  font-size: 12.5px;
  color: var(--text);
  background: rgba(232, 68, 46, 0.07);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  box-shadow: inset 0 0 0 1px rgba(232, 68, 46, 0.35);
}

/* ---- Google 登入機台鍵 ---- */
.google {
  width: 100%;
  margin-top: 16px;
  min-height: 50px;
  font-size: 16px;
  letter-spacing: 0.18em;
  text-indent: 0.06em;
  gap: 10px;
}
</style>
