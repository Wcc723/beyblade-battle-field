import { createRouter, createWebHistory } from "vue-router";

/**
 * 路由規劃（線上對戰版）：
 * - /            大廳（找人 / 線上人數 / 房號加入）
 * - /room/:code  對戰廳（以手機版為基準）
 * - /settings    個人設定
 * - /admin/*     管理員後台（之後加權限閘門）
 * - /test/*      原型測試頁（保留現有單機頁面，繼續吃 localStorage）
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "lobby", component: () => import("./views/LobbyView.vue") },
    { path: "/room/:code", name: "room", component: () => import("./views/BattleRoomView.vue") },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/admin/arena", name: "admin-arena", component: () => import("./views/ArenaAdminView.vue") },
    { path: "/admin/beyblade", name: "admin-beyblade", component: () => import("./views/BeybladeAdminView.vue") },
    { path: "/test/battle", name: "test-battle", component: () => import("./components/BattleViz.vue") },
    { path: "/test/mobile", name: "test-mobile", component: () => import("./components/MobileBattle.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
