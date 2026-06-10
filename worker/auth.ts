/**
 * Google OAuth 2.0（authorization code flow）。
 *
 * - GET /api/auth/login    → 設 state cookie（含登入後回跳路徑）、302 到 Google 同意畫面
 * - GET /api/auth/callback → 驗 state、code 換 token、upsert user（D1）、發 session cookie、302 回原頁
 * - POST /api/auth/logout  → 清 session cookie
 *
 * redirect_uri 一律用「目前 origin + /api/auth/callback」推導 →
 * localhost 與正式站共用同一份程式碼（兩個 URI 都要登錄在 Google Console）。
 *
 * id_token 直接走 TLS 從 Google token endpoint 拿到（不是瀏覽器轉交），
 * 因此只驗 payload 的 iss/aud/exp，不需驗 JWT 簽章。
 *
 * callback 是「整頁導航」（Google 302 回來），所有失敗一律 302 回 /login?error=<code>
 * 由登入頁顯示訊息——不能回裸 JSON（使用者會卡在死路）。
 */
import {
  signSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  parseCookies,
  SESSION_TTL_SECONDS,
  type SessionData,
} from "./session";
import { decodeJwtPayload } from "./jwt";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_COOKIE = "bb_oauth_state";
const TOKEN_TIMEOUT_MS = 10_000;

function redirectUriOf(request: Request): string {
  return `${new URL(request.url).origin}/api/auth/callback`;
}

function randomHex(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 只接受站內路徑（防 open redirect：要 "/" 開頭、不能 "//" 開頭）。 */
function safeRedirectPath(p: string | null | undefined): string {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/";
}

function stateCookieHeader(value: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STATE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** 失敗一律 302 回登入頁（帶錯誤碼）並清掉一次性 state cookie。 */
function loginErrorRedirect(request: Request, code: string): Response {
  const headers = new Headers({ Location: `/login?error=${code}` });
  headers.append("Set-Cookie", stateCookieHeader("", request, 0));
  return new Response(null, { status: 302, headers });
}

export function handleLogin(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const redirect = safeRedirectPath(url.searchParams.get("redirect"));
  const state = randomHex();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriOf(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${GOOGLE_AUTH_URL}?${params}`,
      // state cookie 同時夾帶登入後回跳路徑（encodeURIComponent 保證 cookie-safe）
      "Set-Cookie": stateCookieHeader(`${state}.${encodeURIComponent(redirect)}`, request, 600),
    },
  });
}

export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // state cookie：<state>.<encodeURIComponent(回跳路徑)>
  const rawCookie = parseCookies(request)[STATE_COOKIE] ?? "";
  const dot = rawCookie.indexOf(".");
  const cookieState = dot >= 0 ? rawCookie.slice(0, dot) : rawCookie;
  let redirectPath = "/";
  if (dot >= 0) {
    try {
      redirectPath = safeRedirectPath(decodeURIComponent(rawCookie.slice(dot + 1)));
    } catch {
      redirectPath = "/";
    }
  }

  // 使用者在 Google 同意畫面按「取消」→ error=access_denied（沒有 code）
  if (url.searchParams.get("error")) {
    return loginErrorRedirect(request, "access_denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !cookieState || state !== cookieState) {
    return loginErrorRedirect(request, "state_mismatch");
  }

  // code 換 token（網路層失敗 / 非 JSON 回應都不能炸成 1101 錯誤頁）
  let tokens: { id_token?: string };
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUriOf(request),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!tokenRes.ok) {
      console.error("google token exchange failed", tokenRes.status, await tokenRes.text());
      return loginErrorRedirect(request, "token_exchange_failed");
    }
    tokens = (await tokenRes.json()) as { id_token?: string };
  } catch (err) {
    console.error("google token exchange error", err);
    return loginErrorRedirect(request, "token_exchange_failed");
  }

  const payload = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
  if (
    !payload ||
    payload.aud !== env.GOOGLE_CLIENT_ID ||
    (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") ||
    payload.exp * 1000 < Date.now() ||
    !payload.email ||
    payload.email_verified === false
  ) {
    return loginErrorRedirect(request, "invalid_token");
  }

  // upsert user → 取 id
  let row: { id: number } | null;
  try {
    row = await env.DB.prepare(
      `INSERT INTO users (google_sub, email, name, picture, last_login_at)
       VALUES (?1, ?2, ?3, ?4, datetime('now'))
       ON CONFLICT(google_sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         picture = excluded.picture,
         last_login_at = excluded.last_login_at
       RETURNING id`,
    )
      .bind(payload.sub, payload.email, payload.name ?? "", payload.picture ?? "")
      .first<{ id: number }>();
  } catch (err) {
    console.error("user upsert failed", err);
    return loginErrorRedirect(request, "server_error");
  }
  if (!row) return loginErrorRedirect(request, "server_error");

  const session: SessionData = {
    uid: row.id,
    email: payload.email,
    name: payload.name ?? "",
    picture: payload.picture ?? "",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signSession(session, env.SESSION_SECRET);
  const headers = new Headers({ Location: redirectPath });
  headers.append("Set-Cookie", sessionCookieHeader(token, request));
  headers.append("Set-Cookie", stateCookieHeader("", request, 0)); // 清掉一次性 state cookie
  return new Response(null, { status: 302, headers });
}

export function handleLogout(request: Request): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": clearSessionCookieHeader(request) },
  });
}

/** 管理員判定：email 在 ADMIN_EMAILS（逗號分隔、不分大小寫）內。 */
export function isAdminEmail(email: string, env: Env): boolean {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
