import { ref, readonly } from "vue";

/**
 * 登入狀態（/api/me）。模組層單例：所有元件共享同一份狀態。
 * 登入流程是整頁跳轉（/api/auth/login → Google → callback 302 回 /），
 * 所以每次頁面載入後第一次 ensureLoaded() 就會拿到最新狀態。
 */
export interface MeUser {
  email: string;
  name: string;
  picture: string;
}

const user = ref<MeUser | null>(null);
const isAdmin = ref(false);
const loaded = ref(false);

async function refresh(): Promise<void> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) throw new Error(`/api/me ${res.status}`);
    const data = (await res.json()) as { user: MeUser | null; isAdmin: boolean };
    user.value = data.user;
    isAdmin.value = !!data.isAdmin;
    loaded.value = true; // 只有「拿到確定答案」才算載入完成
  } catch {
    // 暫時性失敗（弱網/伺服器重啟）：不設 loaded → 下一次導航會重試，
    // 不會把其實持有有效 session 的使用者永久誤判成未登入
    user.value = null;
    isAdmin.value = false;
  }
}

let inflight: Promise<void> | null = null;
async function ensureLoaded(): Promise<void> {
  if (loaded.value) return;
  inflight ??= refresh().finally(() => {
    inflight = null;
  });
  await inflight;
}

async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
  user.value = null;
  isAdmin.value = false;
}

export function useAuth() {
  return { user: readonly(user), isAdmin: readonly(isAdmin), loaded: readonly(loaded), refresh, ensureLoaded, logout };
}
