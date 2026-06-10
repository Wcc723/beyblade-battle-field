<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

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
    <section class="card">
      <h2>🔐 登入</h2>
      <p class="hint">線上對戰需要 Google 帳號登入（暱稱與頭像預設取自 Google，可在個人設定修改）。</p>
      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
      <button class="google" @click="loginWithGoogle">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        使用 Google 登入
      </button>
      <p class="hint small">測試頁（🧪 測試對戰 / 📱 測試手機版）不需登入。</p>
    </section>
  </div>
</template>

<style scoped>
.login {
  max-width: 420px;
  margin: 40px auto 0;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 24px;
  text-align: center;
}
.card h2 {
  margin: 0 0 8px;
}
.hint {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.hint.small {
  font-size: 12px;
  margin-top: 16px;
}
.error {
  color: var(--red);
  font-size: 13px;
  background: rgba(255, 93, 93, 0.08);
  border: 1px solid rgba(255, 93, 93, 0.3);
  border-radius: 8px;
  padding: 8px 12px;
}
.google {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  color: #1f1f1f;
  border: none;
  border-radius: 10px;
  padding: 12px 22px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  margin: 14px 0 4px;
}
.google:hover {
  background: #f1f3f4;
}
</style>
