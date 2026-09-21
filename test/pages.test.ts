import { describe, it, expect } from "vitest";
// ?raw / import.meta.glob：root tsconfig 沒有 node 型別，檔案一律經 Vite 讀
import wranglerJsonc from "../wrangler.jsonc?raw";
import routerSource from "../src/router.ts?raw";
import { classifyPage, handlePage, SPA_ROUTES, LANDING_ASSET_PATH, type AssetFetcher } from "../worker/pages";
import { signSession } from "../worker/session";

/**
 * 頁面路由的三方對帳：src/router.ts（前端路由）× wrangler.jsonc（run_worker_first）× worker/pages.ts。
 * assets.not_found_handling = "404-page" 之後，漏掉任何一邊的路由都會變成 404，這裡先擋。
 */

const SECRET = "pages-test-secret-0123456789abcdef";

/** 與 Cloudflare 資產路由相同的比對法：`*` → `.*`，整段錨定。 */
function globMatch(rule: string, pathname: string): boolean {
  const re = "^" + rule.split("*").map((s) => s.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")).join(".*") + "$";
  return new RegExp(re).test(pathname);
}

function readWranglerAssets(): { not_found_handling: string; run_worker_first: string[] } {
  // wrangler.jsonc 的註解都是整行註解：去掉後即為合法 JSON
  const raw = wranglerJsonc
    .split("\n")
    .filter((line: string) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(raw).assets;
}

const assets = readWranglerAssets();
const workerRules = assets.run_worker_first.filter((r) => !r.startsWith("!"));
const routedToWorker = (p: string) => workerRules.some((r) => globMatch(r, p));

/** router.ts 裡宣告的 path（catch-all 除外），`:param` 代入範例值 */
function routerPaths(): string[] {
  return [...routerSource.matchAll(/path:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => !p.includes("pathMatch"))
    .map((p) => p.replace(/:\w+/g, "ABC234"));
}

describe("路由三方對帳", () => {
  it("assets 設定：真 404 + 頁面先進 worker", () => {
    expect(assets.not_found_handling).toBe("404-page");
    expect(workerRules).toContain("/api/*");
    expect(workerRules).toContain("/");
  });

  it("router.ts 的每條路由都會進 worker，且 worker 認得（不會被 404 掉）", () => {
    const paths = routerPaths();
    expect(paths.length).toBeGreaterThanOrEqual(10);
    for (const p of paths) {
      expect(routedToWorker(p), `run_worker_first 漏了 ${p}`).toBe(true);
      expect(classifyPage(p), `worker/pages.ts 不認得 ${p}`).toBe(p === "/" ? "root" : "spa");
      if (p !== "/") {
        // vue-router 預設 strict:false，尾斜線版本也要能開
        expect(routedToWorker(`${p}/`), `run_worker_first 漏了 ${p}/`).toBe(true);
        expect(classifyPage(`${p}/`)).toBe("spa");
      }
    }
  });

  it("SPA_ROUTES 每一條都對得到 router.ts 的某條路由（沒有多餘的假路由）", () => {
    const paths = routerPaths();
    for (const re of SPA_ROUTES) {
      expect(
        paths.some((p) => re.test(p)),
        `${re} 在 router.ts 找不到對應路由`,
      ).toBe(true);
    }
  });

  it("不存在的路徑：不是交給資產層 404，就是 worker 判 not-found", () => {
    for (const p of ["/nonexistent-xyz", "/admin", "/admin/nope", "/room/", "/room/A/B", "/test/xyz", "/index.php"]) {
      if (routedToWorker(p)) expect(classifyPage(p), p).toBe("not-found");
    }
    for (const p of ["/nonexistent-xyz", "/index.php", "/robots.txt", "/sitemap.xml", "/og.png"]) {
      expect(routedToWorker(p), `${p} 不該先進 worker`).toBe(false);
    }
  });

  it("public/ 的實體檔不會被 run_worker_first 搶走（介紹頁 landing.html 除外，它只在 / 提供）", () => {
    // 只取檔名清單（lazy glob 不會真的載入檔案）
    const files = Object.keys(import.meta.glob("../public/**/*"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const served = file.replace(/^\.\.\/public/, "");
      const pretty = served.replace(/\.html$/, "");
      if (pretty === LANDING_ASSET_PATH) continue;
      expect(routedToWorker(served), `${served} 被 run_worker_first 攔截`).toBe(false);
      expect(routedToWorker(pretty), `${pretty} 被 run_worker_first 攔截`).toBe(false);
    }
  });
});

/* ---------------- handlePage 行為（假資產層） ---------------- */

function fakeAssets() {
  const calls: Request[] = [];
  const fetcher: AssetFetcher = {
    async fetch(req: Request) {
      calls.push(req);
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response("<shell>", { headers: { "Content-Type": "text/html", ETag: '"shell"' } });
      if (path === LANDING_ASSET_PATH) {
        return new Response("<landing>", { headers: { "Content-Type": "text/html", ETag: '"landing"' } });
      }
      return new Response("<404>", { status: 404, headers: { "Content-Type": "text/html" } });
    },
  };
  return { fetcher, calls };
}

async function sessionCookie(expOffset = 3600): Promise<string> {
  const token = await signSession(
    { uid: 7, email: "p@example.com", name: "P", picture: "", exp: Math.floor(Date.now() / 1000) + expOffset },
    SECRET,
  );
  return `bb_session=${token}`;
}

const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://beyblade.pocketool.app${path}`, { method, headers });

describe("handlePage", () => {
  it("未登入造訪 / → 公開介紹頁（可索引、不共用快取、Vary: Cookie）", async () => {
    const { fetcher, calls } = fakeAssets();
    const res = await handlePage(get("/"), { assets: fetcher, sessionSecret: SECRET });
    expect(await res.text()).toBe("<landing>");
    expect(new URL(calls[0].url).pathname).toBe(LANDING_ASSET_PATH);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    expect(res.headers.get("Vary")).toContain("Cookie");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("已登入造訪 / → SPA 殼（大廳），加 noindex", async () => {
    const { fetcher, calls } = fakeAssets();
    const res = await handlePage(get("/", { Cookie: await sessionCookie() }), { assets: fetcher, sessionSecret: SECRET });
    expect(await res.text()).toBe("<shell>");
    expect(new URL(calls[0].url).pathname).toBe("/");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("過期／偽造的 session、或伺服器沒設 SESSION_SECRET → 當作未登入", async () => {
    const expired = await sessionCookie(-10);
    for (const [headers, secret] of [
      [{ Cookie: expired }, SECRET],
      [{ Cookie: "bb_session=forged.token" }, SECRET],
      [{ Cookie: await sessionCookie() }, undefined],
    ] as const) {
      const { fetcher } = fakeAssets();
      const res = await handlePage(get("/", headers), { assets: fetcher, sessionSecret: secret });
      expect(await res.text()).toBe("<landing>");
    }
  });

  it("SPA 路由（含 query）→ SPA 殼 + noindex，不管有沒有登入", async () => {
    for (const path of ["/login?error=access_denied", "/room/ABC234?bot=1", "/roster/", "/admin/special", "/test/mobile"]) {
      const { fetcher, calls } = fakeAssets();
      const res = await handlePage(get(path), { assets: fetcher, sessionSecret: SECRET });
      expect(res.status, path).toBe(200);
      expect(await res.text()).toBe("<shell>");
      expect(new URL(calls[0].url).pathname).toBe("/");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    }
  });

  it("直接打 /landing → 301 回首頁（介紹頁只在 / 提供）", async () => {
    const { fetcher, calls } = fakeAssets();
    const res = await handlePage(get("/landing"), { assets: fetcher, sessionSecret: SECRET });
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/");
    expect(calls).toHaveLength(0);
  });

  it("worker 不認得的路徑 → 原請求交給資產層（回 404 頁）", async () => {
    const { fetcher, calls } = fakeAssets();
    const res = await handlePage(get("/room/A/B"), { assets: fetcher, sessionSecret: SECRET });
    expect(res.status).toBe(404);
    expect(new URL(calls[0].url).pathname).toBe("/room/A/B");
  });

  it("HEAD 與條件式請求標頭照樣轉給資產層；非 GET/HEAD 原樣交給資產層", async () => {
    const { fetcher, calls } = fakeAssets();
    await handlePage(get("/settings", { "If-None-Match": '"shell"' }, "HEAD"), { assets: fetcher, sessionSecret: SECRET });
    expect(calls[0].method).toBe("HEAD");
    expect(calls[0].headers.get("If-None-Match")).toBe('"shell"');

    const post = fakeAssets();
    await handlePage(get("/roster", {}, "POST"), { assets: post.fetcher, sessionSecret: SECRET });
    expect(new URL(post.calls[0].url).pathname).toBe("/roster");
    expect(post.calls[0].method).toBe("POST");
  });
});
