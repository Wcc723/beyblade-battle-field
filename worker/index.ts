/**
 * Cloudflare Worker 入口。
 *
 * 路由策略（見 wrangler.jsonc）：
 * - /api/*  → run_worker_first，一律進到這裡處理
 * - 其餘    → Workers static assets 直接出（SPA fallback 回 index.html）
 *
 * 之後階段：
 * - Phase 2: /api/auth/*（Google OAuth）、/api/me
 * - Phase 3: /api/settings、/api/admin/*（D1）
 * - Phase 4: /api/room/*（轉發 Battle Room Durable Object）
 * - Phase 5: /api/lobby（轉發 Lobby Durable Object）
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "beyblade-battle-field" });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // run_worker_first 只涵蓋 /api/*，理論上不會走到這裡；保險起見回退到靜態資產
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
