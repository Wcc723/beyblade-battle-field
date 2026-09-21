/**
 * 頁面路由（非 /api 的導航請求）。零 `Env` 全域型別相依：worker 與單元測試共用。
 *
 * 靜態資產設定（wrangler.jsonc）：`not_found_handling: "404-page"`。
 * → 不在 `run_worker_first` 名單、也不是實體檔案的路徑，一律由資產層回 public/404.html（HTTP 404），
 *   不再像以前那樣把任何網址都當 SPA 回 200（soft 404）。
 * → 因此 vue-router 的每條路由都必須同時出現在兩處，test/pages.test.ts 會交叉比對：
 *     1. 這裡的 SPA_ROUTES（worker 據此回 SPA 殼 index.html）
 *     2. wrangler.jsonc 的 `run_worker_first`（請求才會先進 worker，不被資產層 404 掉）
 *
 * 首頁 `/` 依登入狀態分流（同一個網址、對所有未登入訪客與爬蟲一視同仁）：
 * - 未登入 → 公開介紹頁 public/landing.html（可索引、有 canonical）
 * - 已登入 → SPA 殼（vue-router 的大廳）
 * 登入頁、大廳、對戰房、設定、後台、測試頁都回 SPA 殼並加 `X-Robots-Tag: noindex`。
 */
import { getSession } from "./session";

/** 公開介紹頁在資產層的路徑（public/landing.html；資產層 html_handling 會把 .html 去掉） */
export const LANDING_ASSET_PATH = "/landing";
/** SPA 殼（Vite 入口 index.html）在資產層的路徑 */
export const SPA_SHELL_ASSET_PATH = "/";

/**
 * vue-router 的路由（src/router.ts）＝會回 SPA 殼的路徑。不含 `/`（首頁另外分流）。
 * 尾斜線可有可無（vue-router 預設 strict: false，`/roster/` 也會對到 `/roster`）。
 */
export const SPA_ROUTES: readonly RegExp[] = [
  /^\/login\/?$/,
  /^\/roster\/?$/,
  /^\/settings\/?$/,
  /^\/room\/[^/]+\/?$/,
  /^\/admin\/(?:arena|beyblade|special)\/?$/,
  /^\/test\/(?:battle|mobile)\/?$/,
];

export type PageKind = "root" | "landing-alias" | "spa" | "not-found";

export function classifyPage(pathname: string): PageKind {
  if (pathname === "/") return "root";
  if (pathname === LANDING_ASSET_PATH || pathname === `${LANDING_ASSET_PATH}/`) return "landing-alias";
  return SPA_ROUTES.some((re) => re.test(pathname)) ? "spa" : "not-found";
}

/** env.ASSETS 的最小介面（測試可塞假的） */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface PageDeps {
  assets: AssetFetcher;
  /** 缺值（部署漏設 secret）時一律視為未登入 → 首頁回介紹頁 */
  sessionSecret?: string;
}

async function hasValidSession(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  try {
    return (await getSession(request, secret)) !== null;
  } catch {
    return false;
  }
}

/** 向資產層要另一個路徑的檔案（沿用原請求的 method 與標頭：條件式請求 / 壓縮協商照常運作） */
function assetRequest(request: Request, pathname: string): Request {
  return new Request(new URL(pathname, request.url), { method: request.method, headers: request.headers });
}

function withHeaders(res: Response, set: Record<string, string>, varyCookie = false): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(set)) out.headers.set(k, v);
  if (varyCookie) out.headers.append("Vary", "Cookie");
  return out;
}

const NOINDEX = { "X-Robots-Tag": "noindex" };
/** 首頁內容隨登入 cookie 而異：不給共用快取存、瀏覽器每次重新驗證 */
const PER_USER = { "Cache-Control": "private, no-cache" };

export async function handlePage(request: Request, deps: PageDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return deps.assets.fetch(request);
  const url = new URL(request.url);

  switch (classifyPage(url.pathname)) {
    case "root": {
      const loggedIn = await hasValidSession(request, deps.sessionSecret);
      const res = await deps.assets.fetch(
        assetRequest(request, loggedIn ? SPA_SHELL_ASSET_PATH : LANDING_ASSET_PATH),
      );
      return withHeaders(res, loggedIn ? { ...PER_USER, ...NOINDEX } : PER_USER, true);
    }
    case "landing-alias":
      // 介紹頁只在 / 提供：直接打 /landing 的一律導回首頁（避免重複網址）
      return new Response(null, { status: 301, headers: { Location: "/" } });
    case "spa":
      return withHeaders(await deps.assets.fetch(assetRequest(request, SPA_SHELL_ASSET_PATH)), NOINDEX);
    case "not-found":
      // 原請求交給資產層：不存在的路徑由 not_found_handling 回 404.html（HTTP 404）
      return deps.assets.fetch(request);
  }
}
