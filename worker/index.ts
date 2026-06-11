/**
 * Cloudflare Worker 入口。
 *
 * 路由策略（見 wrangler.jsonc）：
 * - /api/*  → run_worker_first，一律進到這裡處理
 * - 其餘    → Workers static assets 直接出（SPA fallback 回 index.html）
 *
 * 之後階段：
 * - Phase 3: /api/settings、/api/admin/*（D1 全域設定 CRUD）
 * - Phase 4: /api/room/*（轉發 Battle Room Durable Object）
 * - Phase 5: /api/lobby（轉發 Lobby Durable Object）
 */
import { handleLogin, handleCallback, handleLogout, isAdminEmail } from "./auth";
import { getSession } from "./session";
import { handleGetConfig, handlePutAdminConfig, handleGetSettings, handlePutSettings } from "./api";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return Response.json({ ok: true, service: "beyblade-battle-field" });
    }

    // --- 認證 ---
    // 設定缺漏要早爆且指名（部署漏打 wrangler secret put 時，不要讓使用者
    // 走完 Google 流程才在最後一步 500 / 或帶 client_id=undefined 去 Google）
    if (path.startsWith("/api/auth/")) {
      const missing = (["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET"] as const).filter(
        (k) => !env[k],
      );
      if (missing.length) {
        console.error(`缺少必要設定：${missing.join(", ")}（本地放 .env；部署用 wrangler secret put）`);
        return Response.json({ error: "server_misconfigured", missing }, { status: 503 });
      }
    }
    if (path === "/api/auth/login" && request.method === "GET") return handleLogin(request, env);
    if (path === "/api/auth/callback" && request.method === "GET") return handleCallback(request, env);
    if (path === "/api/auth/logout" && request.method === "POST") return handleLogout(request);

    if (path === "/api/me") {
      const session = await getSession(request, env.SESSION_SECRET);
      if (!session) return Response.json({ user: null, isAdmin: false });
      return Response.json({
        user: { email: session.email, name: session.name, picture: session.picture },
        isAdmin: isAdminEmail(session.email, env),
      });
    }

    // --- 全域遊戲設定（登入即可讀）/ 個人設定 ---
    if (path === "/api/config" || path === "/api/settings") {
      const session = await getSession(request, env.SESSION_SECRET);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (path === "/api/config" && request.method === "GET") return handleGetConfig(env);
      if (path === "/api/settings" && request.method === "GET") return handleGetSettings(env, session);
      if (path === "/api/settings" && request.method === "PUT") return handlePutSettings(request, env, session);
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    // --- 管理員區（真閘門在這裡，前端隱藏入口只是 UX）---
    if (path.startsWith("/api/admin/")) {
      const session = await getSession(request, env.SESSION_SECRET);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (!isAdminEmail(session.email, env)) return Response.json({ error: "forbidden" }, { status: 403 });
      if (path === "/api/admin/ping") return Response.json({ ok: true, admin: session.email });
      const configKey = path.match(/^\/api\/admin\/config\/([a-z]+)$/)?.[1];
      if (configKey && request.method === "PUT") return handlePutAdminConfig(request, env, configKey);
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (path.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // run_worker_first 只涵蓋 /api/*，理論上不會走到這裡；保險起見回退到靜態資產
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
