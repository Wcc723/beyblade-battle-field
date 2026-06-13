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
import { getSession, type SessionData } from "./session";
import { handleGetConfig, handlePutAdminConfig, handleGetSettings, handlePutSettings, handleGetMatches } from "./api";
import { genRoomCode } from "../src/game/room";
import type { JoinUser } from "./battleRoomDO";

export { BattleRoomDO } from "./battleRoomDO";
export { LobbyDO } from "./lobbyDO";

const ROOM_CODE_RE = /^\/api\/room\/([A-Z0-9]{6})\/ws$/;

/** 對戰顯示用暱稱：user_settings 優先，fallback Google 名/email */
async function nicknameOf(env: Env, session: SessionData): Promise<string> {
  const row = await env.DB.prepare("SELECT nickname FROM user_settings WHERE user_id = ?1")
    .bind(session.uid)
    .first<{ nickname: string }>();
  return (row?.nickname || session.name || session.email.split("@")[0]).slice(0, 20);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return Response.json({ ok: true, service: "beyblade-battle-field" });
    }

    // --- 音效取樣與 BGM（R2，公開資產不需登入）---
    // 檔名白名單（hit-l-0.wav / bgm-0.mp3 之類）防奇形怪狀 key；R2 缺檔回 404，前端自動回退。
    // BGM mp3 較大 → 支援 Range 請求（<audio> 串流/拖曳進度需要）。
    if (path.startsWith("/api/sfx/") && request.method === "GET") {
      const key = path.slice("/api/sfx/".length);
      const m = /^[a-z0-9-]+\.(wav|mp3)$/.exec(key);
      if (!m) return new Response("bad key", { status: 400 });
      const type = m[1] === "mp3" ? "audio/mpeg" : "audio/wav";
      const range = request.headers.get("Range");
      const rangeMatch = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (rangeMatch) {
        const obj = await env.SFX.get(key);
        if (!obj) return new Response("not found", { status: 404 });
        const total = obj.size;
        const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
        const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : total - 1;
        if (start >= total || start > end) return new Response("range not satisfiable", { status: 416 });
        const ranged = await env.SFX.get(key, { range: { offset: start, length: end - start + 1 } });
        return new Response(ranged?.body ?? null, {
          status: 206,
          headers: {
            "Content-Type": type,
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      const obj = await env.SFX.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "Content-Type": type,
          "Accept-Ranges": "bytes",
          // 內容不可變（改音效會換檔名）→ 瀏覽器與 CDN 都可長快取
          "Cache-Control": "public, max-age=31536000, immutable",
          ...(obj.httpEtag ? { ETag: obj.httpEtag } : {}),
        },
      });
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

    // --- 大廳（presence / 快速配對 / 公開房列表） ---
    if (path === "/api/lobby/ws") {
      const session = await getSession(request, env.SESSION_SECRET);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (request.headers.get("Upgrade") !== "websocket") {
        return Response.json({ error: "expected_websocket" }, { status: 426 });
      }
      const stub = env.LOBBY.get(env.LOBBY.idFromName("global"));
      const fwd = new Request(new URL("/ws", "https://lobby"), request);
      fwd.headers.set("X-BB-User", JSON.stringify({ uid: session.uid, nickname: await nicknameOf(env, session) }));
      return stub.fetch(fwd);
    }

    // --- 對戰房 ---
    if (path === "/api/room/create" && request.method === "POST") {
      const session = await getSession(request, env.SESSION_SECRET);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      const body = (await request.json().catch(() => ({}))) as { public?: boolean };
      const code = genRoomCode();
      // 公開房：掛上大廳列表（房間開打/棄置時 Battle Room DO 會通知下架）
      if (body.public === true) {
        try {
          const stub = env.LOBBY.get(env.LOBBY.idFromName("global"));
          await stub.fetch("https://lobby/register-room", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, host: await nicknameOf(env, session) }),
          });
        } catch (err) {
          console.error("lobby register failed", err); // 大廳掛了不擋開房
        }
      }
      return Response.json({ code });
    }

    // --- 戰績 ---
    if (path === "/api/me/matches" && request.method === "GET") {
      const session = await getSession(request, env.SESSION_SECRET);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      return handleGetMatches(env, session);
    }
    const roomMatch = path.match(ROOM_CODE_RE);
    if (roomMatch) {
      const session = await getSession(request, env.SESSION_SECRET);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (request.headers.get("Upgrade") !== "websocket") {
        return Response.json({ error: "expected_websocket" }, { status: 426 });
      }
      // 進房預設配置取個人設定（暱稱/預設陀螺）；DO 內仍可改
      const row = await env.DB.prepare(
        "SELECT nickname, default_type, default_spin, default_special FROM user_settings WHERE user_id = ?1",
      )
        .bind(session.uid)
        .first<{ nickname: string; default_type: string; default_spin: string; default_special: string }>();
      const user: JoinUser = {
        uid: session.uid,
        nickname: (row?.nickname || session.name || session.email.split("@")[0]).slice(0, 20),
        picture: session.picture,
        loadout: {
          type: row?.default_type ?? "balance",
          spinDir: row?.default_spin === "left" ? -1 : 1,
          special: (row?.default_special ?? "") as JoinUser["loadout"]["special"],
        },
      };
      const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(roomMatch[1]));
      const fwd = new Request(request);
      fwd.headers.set("X-BB-User", JSON.stringify(user));
      // ?bot=1：BOT 房（內建 AI 對手自動入座另一側）
      fwd.headers.set("X-BB-Bot", url.searchParams.get("bot") === "1" ? "1" : "0");
      fwd.headers.set("X-BB-Room", roomMatch[1]); // DO 不知道自己的名字：戰績/大廳通知用
      return stub.fetch(fwd);
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
