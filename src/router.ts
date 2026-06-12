import { createRouter, createWebHistory } from "vue-router";
import { useAuth } from "./store/authStore";

/**
 * 路由規劃（線上對戰版）：
 * - /            大廳（找人 / 線上人數 / 房號加入）— 需登入
 * - /room/:code  對戰廳（以手機版為基準）— 需登入
 * - /roster      陀螺庫（出賽陣容 + 全名冊六維雷達）— 需登入
 * - /settings    個人設定 — 需登入
 * - /admin/*     管理員後台 — 需登入 + ADMIN_EMAILS（後端 /api/admin/* 才是真閘門）
 * - /login       Google 登入
 * - /test/*      原型測試頁（保留現有單機頁面、繼續吃 localStorage）— 不設防
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "lobby", component: () => import("./views/LobbyView.vue"), meta: { requiresAuth: true } },
    {
      path: "/room/:code",
      name: "room",
      component: () => import("./views/BattleRoomView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/roster",
      name: "roster",
      component: () => import("./views/RosterView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("./views/SettingsView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/admin/arena",
      name: "admin-arena",
      component: () => import("./views/ArenaAdminView.vue"),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: "/admin/beyblade",
      name: "admin-beyblade",
      component: () => import("./views/BeybladeAdminView.vue"),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: "/admin/special",
      name: "admin-special",
      component: () => import("./views/SpecialAdminView.vue"),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
    { path: "/test/battle", name: "test-battle", component: () => import("./components/BattleViz.vue") },
    { path: "/test/mobile", name: "test-mobile", component: () => import("./components/MobileBattle.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!to.meta.requiresAuth) return true;
  await auth.ensureLoaded();
  if (!auth.user.value) return { name: "login", query: { redirect: to.fullPath } };
  if (to.meta.requiresAdmin && !auth.isAdmin.value) return { name: "lobby" };
  return true;
});
