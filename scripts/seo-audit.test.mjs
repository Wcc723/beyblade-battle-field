// scripts/seo-audit.mjs 的 mutation tests（node --test，零依賴 → npm run test:seo）。
//
// 重點不是「好檔案會過」，而是「壞檔案一定擋得下來」：每一條契約都配一個壞 fixture，
// 確認 gate 是 fail-closed、而且不是寬鬆 substring（註解／屬性值／跨元素拆開都不算過關）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EXPECTED_TITLE,
  EXPECTED_LANG,
  EXPECTED_LOGIN_HINT,
  LEGACY_TITLES,
  LOGIN_HINT_TOKENS,
  auditHtmlDocument,
  auditLoginView,
  extractVisibleText,
  extractHtmlLang,
  extractMetaContents,
  extractTitles,
  EXPECTED_DESCRIPTION,
  CANONICAL_URL,
  OG_IMAGE_URL,
  HUB_LINKS,
  HUB_INTRO_URL,
  LANDING_CTA_TEXT,
  auditShellDocument,
  auditLandingDocument,
  audit404Document,
  auditRobotsTxt,
  auditSitemapXml,
  extractAnchors,
  extractImages,
  extractLinkHrefs,
  hasNoindex,
  pngSize,
} from "./seo-audit.mjs";

const codes = (result) => result.problems.map((p) => p.code);
const repo = (rel) => new URL(`../${rel}`, import.meta.url);

const TITLE_TAG = `<title>${EXPECTED_TITLE}</title>`;
const OG_TAG = `<meta property="og:title" content="${EXPECTED_TITLE}" />`;
const TW_TAG = `<meta name="twitter:title" content="${EXPECTED_TITLE}" />`;

const goodHtml = () => `<!DOCTYPE html>
<html lang="${EXPECTED_LANG}">
  <head>
    <meta charset="UTF-8" />
    <script>
      gtag("config", "G-XXXX");
    </script>
    ${TITLE_TAG}
    ${OG_TAG}
    ${TW_TAG}
  </head>
  <body><div id="app"></div></body>
</html>`;

const goodLogin = () => `<script setup lang="ts">
const label = "戰鬥陀螺";
</script>

<template>
  <div class="login">
    <!-- 六角徽 + wordmark -->
    <h1 class="wordmark">戰鬥陀螺</h1>
    <p class="wordmark-sub">BURST FORGE / ONLINE VS</p>
    <p class="hint">
      ${EXPECTED_LOGIN_HINT}
    </p>
    <button class="f-btn">使用 Google 登入</button>
    <nav class="legal"><a href="${HUB_LINKS.privacy}">隱私權政策</a></nav>
  </div>
</template>

<style scoped>
.wordmark { font-size: 27px; }
</style>`;

// ---------------------------------------------------------------- 契約本身

test("標題契約＝19 個 unicode code points（機械對帳）", () => {
  assert.equal([...EXPECTED_TITLE].length, 19);
});

test("契約不得夾帶免登入／排名等不實承諾", () => {
  for (const banned of ["免登入", "免註冊", "不用登入", "第一", "最好玩", "最快", "排名"]) {
    assert.ok(!EXPECTED_TITLE.includes(banned), `title 不該出現 ${banned}`);
    assert.ok(!EXPECTED_LOGIN_HINT.includes(banned), `登入提示不該出現 ${banned}`);
  }
});

// ---------------------------------------------------------------- 好 fixture 與真實檔案

test("好 fixture 零問題", () => {
  assert.deepEqual(codes(auditHtmlDocument(goodHtml())), []);
  assert.deepEqual(codes(auditLoginView(goodLogin())), []);
});

test("repo 內的 index.html 與 LoginView.vue 符合契約", async () => {
  const html = await readFile(repo("index.html"), "utf8");
  const login = await readFile(repo("src/views/LoginView.vue"), "utf8");
  assert.deepEqual(codes(auditHtmlDocument(html)), []);
  assert.deepEqual(codes(auditLoginView(login)), []);
});

test("title 前後空白／換行不算違規（逐字比對前先 trim）", () => {
  const html = goodHtml().replace(TITLE_TAG, `<title>\n      ${EXPECTED_TITLE}\n    </title>`);
  assert.deepEqual(codes(auditHtmlDocument(html)), []);
});

// ---------------------------------------------------------------- HTML mutations

test("<title> 重複 → title-count", () => {
  const html = goodHtml().replace(TITLE_TAG, `${TITLE_TAG}\n    ${TITLE_TAG}`);
  assert.ok(codes(auditHtmlDocument(html)).includes("title-count"));
});

test("<title> 缺失 → title-count", () => {
  const html = goodHtml().replace(TITLE_TAG, "");
  assert.ok(codes(auditHtmlDocument(html)).includes("title-count"));
});

test("<title> 文字錯一個字 → title-mismatch", () => {
  const html = goodHtml().replace(TITLE_TAG, "<title>玩戰鬥陀螺線上對戰｜免費瀏覽器雙人遊戯</title>");
  assert.ok(codes(auditHtmlDocument(html)).includes("title-mismatch"));
});

test("正確 title 只寫在註解裡不算數 → title-count", () => {
  const html = goodHtml().replace(TITLE_TAG, `<!-- ${TITLE_TAG} -->`);
  assert.ok(codes(auditHtmlDocument(html)).includes("title-count"));
});

test("og:title 缺失／錯值／重複 → og-title-*", () => {
  assert.ok(codes(auditHtmlDocument(goodHtml().replace(OG_TAG, ""))).includes("og-title-count"));
  assert.ok(
    codes(auditHtmlDocument(goodHtml().replace(OG_TAG, `${OG_TAG}\n    ${OG_TAG}`))).includes("og-title-count"),
  );
  assert.ok(
    codes(
      auditHtmlDocument(goodHtml().replace(OG_TAG, `<meta property="og:title" content="戰鬥陀螺" />`)),
    ).includes("og-title-mismatch"),
  );
});

test("twitter:title 缺失／錯值 → twitter-title-*", () => {
  assert.ok(codes(auditHtmlDocument(goodHtml().replace(TW_TAG, ""))).includes("twitter-title-count"));
  assert.ok(
    codes(
      auditHtmlDocument(goodHtml().replace(TW_TAG, `<meta name="twitter:title" content="不一樣的標題" />`)),
    ).includes("twitter-title-mismatch"),
  );
});

test("html lang 錯值或缺失 → lang-mismatch", () => {
  assert.ok(codes(auditHtmlDocument(goodHtml().replace(`lang="${EXPECTED_LANG}"`, 'lang="zh-TW"'))).includes("lang-mismatch"));
  assert.ok(codes(auditHtmlDocument(goodHtml().replace(` lang="${EXPECTED_LANG}"`, ""))).includes("lang-mismatch"));
});

test("舊 title 殘留（含 script 字串）→ legacy-title-present", () => {
  const legacy = LEGACY_TITLES[0];
  assert.ok(codes(auditHtmlDocument(goodHtml().replace(TITLE_TAG, `<title>${legacy}</title>`))).includes("legacy-title-present"));
  assert.ok(
    codes(auditHtmlDocument(goodHtml().replace('gtag("config", "G-XXXX");', `document.title = "${legacy}";`))).includes(
      "legacy-title-present",
    ),
  );
});

test("壞 fixture 一律 fail-closed（problems 非空）", () => {
  const broken = [
    goodHtml().replace(TITLE_TAG, ""),
    goodHtml().replace(OG_TAG, ""),
    goodHtml().replace(TW_TAG, ""),
    goodHtml().replace(`lang="${EXPECTED_LANG}"`, 'lang="en"'),
    "",
    "<html><head></head><body></body></html>",
  ];
  for (const html of broken) assert.ok(auditHtmlDocument(html).problems.length > 0);
});

// ---------------------------------------------------------------- LoginView mutations

test("h1 退回 h2 → login-h2-wordmark + login-h1-missing", () => {
  const src = goodLogin().replace('<h1 class="wordmark">戰鬥陀螺</h1>', '<h2 class="wordmark">戰鬥陀螺</h2>');
  const c = codes(auditLoginView(src));
  assert.ok(c.includes("login-h2-wordmark"));
  assert.ok(c.includes("login-h1-missing"));
});

test("h1 不是 wordmark／文字錯 → login-h1-*", () => {
  assert.ok(
    codes(auditLoginView(goodLogin().replace('<h1 class="wordmark">戰鬥陀螺</h1>', "<h1>戰鬥陀螺</h1>"))).includes(
      "login-h1-missing",
    ),
  );
  assert.ok(
    codes(auditLoginView(goodLogin().replace(">戰鬥陀螺</h1>", ">BURST FORGE</h1>"))).includes("login-h1-text"),
  );
});

test("缺 <template> → login-template-missing", () => {
  assert.ok(codes(auditLoginView("const a = 1;")).includes("login-template-missing"));
});

test("登入提示只寫在註解裡 → login-hint-missing", () => {
  const src = goodLogin().replace(EXPECTED_LOGIN_HINT, `</p><!-- ${EXPECTED_LOGIN_HINT} --><p>`);
  assert.ok(codes(auditLoginView(src)).includes("login-hint-missing"));
});

test("登入提示只寫在屬性值（隱藏字）→ login-hint-missing", () => {
  const src = goodLogin().replace(
    `<p class="hint">\n      ${EXPECTED_LOGIN_HINT}\n    </p>`,
    `<p class="hint" title="${EXPECTED_LOGIN_HINT}" aria-label="${EXPECTED_LOGIN_HINT}"></p>`,
  );
  assert.ok(codes(auditLoginView(src)).includes("login-hint-missing"));
});

test("登入提示被拆成兩個元素 → login-hint-missing（不是寬鬆 substring）", () => {
  const src = goodLogin().replace(
    EXPECTED_LOGIN_HINT,
    EXPECTED_LOGIN_HINT.replace("需要 Google 帳號登入", "<span>需要 Google 帳號登入") + "</span>",
  );
  const c = codes(auditLoginView(src));
  assert.ok(c.includes("login-hint-missing"));
  assert.ok(!c.includes("login-hint-token-missing"), "關鍵語仍在，只是不成一句 → 只該報 hint-missing");
});

test("提示缺「免費」→ login-hint-token-missing", () => {
  const src = goodLogin().replace(
    EXPECTED_LOGIN_HINT,
    EXPECTED_LOGIN_HINT.replace("免費的", ""),
  );
  const c = codes(auditLoginView(src));
  assert.ok(c.includes("login-hint-missing"));
  assert.ok(c.includes("login-hint-token-missing"));
  assert.ok(auditLoginView(src).problems.some((p) => p.detail.includes("免費")));
});

test("提示缺「瀏覽器」→ login-hint-token-missing", () => {
  const src = goodLogin().replace(
    EXPECTED_LOGIN_HINT,
    EXPECTED_LOGIN_HINT.replace("瀏覽器", ""),
  );
  assert.ok(auditLoginView(src).problems.some((p) => p.code === "login-hint-token-missing" && p.detail.includes("瀏覽器")));
});

test("提示缺「雙人」→ login-hint-token-missing", () => {
  const src = goodLogin().replace(
    EXPECTED_LOGIN_HINT,
    EXPECTED_LOGIN_HINT.replace("雙人", ""),
  );
  assert.ok(auditLoginView(src).problems.some((p) => p.code === "login-hint-token-missing" && p.detail.includes("雙人")));
});

test("提示改成暗示免登入（拿掉「需要 Google 帳號登入」）→ login-hint-token-missing", () => {
  const src = goodLogin()
    .replace(EXPECTED_LOGIN_HINT, "免費的瀏覽器雙人線上對戰，打開就能玩。")
    .replace("使用 Google 登入", "開始遊戲");
  assert.ok(
    auditLoginView(src).problems.some(
      (p) => p.code === "login-hint-token-missing" && p.detail.includes("需要 Google 帳號登入"),
    ),
  );
});

test("四個關鍵語各自都有被檢查", () => {
  for (const token of LOGIN_HINT_TOKENS) {
    const src = goodLogin().replace(EXPECTED_LOGIN_HINT, EXPECTED_LOGIN_HINT.split(token).join(""));
    assert.ok(
      auditLoginView(src).problems.some((p) => p.code === "login-hint-token-missing" && p.detail.includes(token)),
      `刪掉「${token}」應該要被抓到`,
    );
  }
});

// ---------------------------------------------------------------- 純函式行為

test("extractVisibleText 排除註解、屬性值與 script 內文", () => {
  const chunks = extractVisibleText(
    `<div class="可見? 不可見" title="屬性字"><!-- 註解字 -->文字節點<script>"腳本字"</script></div>`,
  );
  assert.deepEqual(chunks, ["文字節點"]);
});

test("extractTitles / extractMetaContents / extractHtmlLang 精確取值", () => {
  const html = goodHtml();
  assert.deepEqual(extractTitles(html), [EXPECTED_TITLE]);
  assert.deepEqual(extractMetaContents(html, "og:title"), [EXPECTED_TITLE]);
  assert.deepEqual(extractMetaContents(html, "twitter:title"), [EXPECTED_TITLE]);
  assert.deepEqual(extractMetaContents(html, "description"), []);
  assert.equal(extractHtmlLang(html), EXPECTED_LANG);
});

// ================================================================ SEO 基礎建設（殼 / 介紹頁 / 404 / robots / sitemap）

const SHARE_META = `
    <meta name="description" content="${EXPECTED_DESCRIPTION}" />
    <meta property="og:description" content="${EXPECTED_DESCRIPTION}" />
    <meta property="og:image" content="${OG_IMAGE_URL}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />`;

const NOINDEX_TAG = `<meta name="robots" content="noindex" />`;
const CANONICAL_TAG = `<link rel="canonical" href="${CANONICAL_URL}" />`;
const OG_URL_TAG = `<meta property="og:url" content="${CANONICAL_URL}" />`;

const goodShell = () => goodHtml().replace(TW_TAG, `${TW_TAG}\n    ${NOINDEX_TAG}${SHARE_META}`);

const CTA = `<a class="btn" href="/api/auth/login?redirect=%2F" rel="nofollow">${LANDING_CTA_TEXT}</a>`;
const shot = (n) => `<img src="/screens/s${n}.webp" width="600" height="900" alt="第 ${n} 張遊戲畫面截圖" />`;
const FILLER = "在瀏覽器裡跟朋友比一場陀螺對戰，拖曳發射後看回放。".repeat(40);

const goodLanding = () =>
  goodHtml()
    .replace(TW_TAG, `${TW_TAG}\n    ${CANONICAL_TAG}\n    ${OG_URL_TAG}${SHARE_META}`)
    .replace(
      '<body><div id="app"></div></body>',
      `<body>
  <main>
    <h1>戰鬥陀螺線上對戰</h1>
    <p>${FILLER}</p>
    ${CTA}
    ${shot(1)}${shot(2)}${shot(3)}
    <section id="privacy"><h2>資料與隱私</h2><p>完整說明請看<a href="${HUB_LINKS.privacy}">隱私權政策</a>。</p></section>
  </main>
  <footer>
    <a href="${HUB_LINKS.privacy}">隱私權政策</a>
    <a href="${HUB_LINKS.terms}">服務條款</a>
    <a href="${HUB_LINKS.contact}">聯絡</a>
    <a href="${HUB_LINKS.home}">口袋工具</a>
    <a href="${HUB_INTRO_URL}">介紹頁</a>
  </footer>
</body>`,
    );

const good404 = () => `<!DOCTYPE html>
<html lang="${EXPECTED_LANG}">
  <head>${NOINDEX_TAG}<title>找不到這個頁面｜戰鬥陀螺</title></head>
  <body><h1>找不到這個頁面</h1><a href="/">回首頁</a><a href="${HUB_LINKS.privacy}">隱私權政策</a></body>
</html>`;

const goodRobots = () => `User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://beyblade.pocketool.app/sitemap.xml
`;

const goodSitemap = (locs = [CANONICAL_URL]) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <url><loc>${l}</loc></url>`).join("\n")}
</urlset>
`;

test("好 fixture（殼 / 介紹頁 / 404 / robots / sitemap）零問題", () => {
  assert.deepEqual(codes(auditShellDocument(goodShell())), []);
  assert.deepEqual(codes(auditLandingDocument(goodLanding())), []);
  assert.deepEqual(codes(audit404Document(good404())), []);
  assert.deepEqual(codes(auditRobotsTxt(goodRobots())), []);
  assert.deepEqual(codes(auditSitemapXml(goodSitemap())), []);
});

test("repo 內的殼、介紹頁、404、robots、sitemap 符合契約", async () => {
  const read = (p) => readFile(repo(p), "utf8");
  assert.deepEqual(codes(auditShellDocument(await read("index.html"))), []);
  assert.deepEqual(codes(auditLandingDocument(await read("public/landing.html"))), []);
  assert.deepEqual(codes(audit404Document(await read("public/404.html"))), []);
  assert.deepEqual(codes(auditRobotsTxt(await read("public/robots.txt"))), []);
  assert.deepEqual(codes(auditSitemapXml(await read("public/sitemap.xml"))), []);
});

test("repo 的 og.png 是 1200x630 PNG；非 PNG 回 null", async () => {
  assert.deepEqual(pngSize(await readFile(repo("public/og.png"))), { width: 1200, height: 630 });
  assert.equal(pngSize(Buffer.from("<!DOCTYPE html>")), null);
});

// ---------------------------------------------------------------- SPA 殼 mutations

test("殼少了 noindex → shell-indexable", () => {
  assert.ok(codes(auditShellDocument(goodShell().replace(NOINDEX_TAG, ""))).includes("shell-indexable"));
});

test("殼加了 canonical / og:url → shell-canonical / shell-og-url（deep route 共用這份）", () => {
  const withCanon = goodShell().replace(NOINDEX_TAG, `${NOINDEX_TAG}\n    ${CANONICAL_TAG}`);
  assert.ok(codes(auditShellDocument(withCanon)).includes("shell-canonical"));
  const withOgUrl = goodShell().replace(NOINDEX_TAG, `${NOINDEX_TAG}\n    ${OG_URL_TAG}`);
  assert.ok(codes(auditShellDocument(withOgUrl)).includes("shell-og-url"));
});

test("分享卡：description 錯／og:image 相對路徑／缺 twitter:card／缺 favicon 都擋", () => {
  const c = (html) => codes(auditShellDocument(html));
  assert.ok(c(goodShell().replace(`name="description" content="${EXPECTED_DESCRIPTION}"`, 'name="description" content="戰鬥陀螺"')).includes("description-mismatch"));
  assert.ok(c(goodShell().replace(`property="og:description" content="${EXPECTED_DESCRIPTION}"`, "")).includes("og-description-count"));
  assert.ok(c(goodShell().replace(OG_IMAGE_URL, "/og.png")).includes("og-image-mismatch"));
  assert.ok(c(goodShell().replace('<meta name="twitter:card" content="summary_large_image" />', "")).includes("twitter-card-count"));
  assert.ok(c(goodShell().replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />', "")).includes("favicon-missing"));
});

// ---------------------------------------------------------------- 介紹頁 mutations

test("介紹頁被 noindex → landing-noindex", () => {
  const html = goodLanding().replace(CANONICAL_TAG, `${CANONICAL_TAG}\n    ${NOINDEX_TAG}`);
  assert.ok(codes(auditLandingDocument(html)).includes("landing-noindex"));
});

test("介紹頁 canonical 缺／錯／重複 → landing-canonical-*", () => {
  const c = (html) => codes(auditLandingDocument(html));
  assert.ok(c(goodLanding().replace(CANONICAL_TAG, "")).includes("landing-canonical-count"));
  assert.ok(c(goodLanding().replace(CANONICAL_TAG, `${CANONICAL_TAG}${CANONICAL_TAG}`)).includes("landing-canonical-count"));
  assert.ok(
    c(goodLanding().replace(CANONICAL_TAG, '<link rel="canonical" href="https://beyblade.pocketool.app/login" />')).includes(
      "landing-canonical-mismatch",
    ),
  );
  assert.ok(c(goodLanding().replace(OG_URL_TAG, "")).includes("landing-og-url-count"));
});

test("登入 CTA 缺／連錯地方／沒 nofollow → landing-cta-*", () => {
  const c = (html) => codes(auditLandingDocument(html));
  assert.ok(c(goodLanding().replace(CTA, "")).includes("landing-cta-missing"));
  assert.ok(c(goodLanding().replace("/api/auth/login?redirect=%2F", "/login")).includes("landing-cta-href"));
  assert.ok(c(goodLanding().replace(' rel="nofollow"', "")).includes("landing-cta-nofollow"));
});

test("CTA 文字只寫在屬性值（aria-label）不算 → landing-cta-missing", () => {
  const html = goodLanding().replace(CTA, `<a href="/api/auth/login" rel="nofollow" aria-label="${LANDING_CTA_TEXT}">GO</a>`);
  assert.ok(codes(auditLandingDocument(html)).includes("landing-cta-missing"));
});

test("介紹頁缺隱私權政策／條款／聯絡／主站／介紹頁連結 → landing-link-missing", () => {
  for (const href of [...Object.values(HUB_LINKS), HUB_INTRO_URL]) {
    const html = goodLanding().split(`href="${href}"`).join('href="https://example.com/"');
    assert.ok(
      auditLandingDocument(html).problems.some((p) => p.code === "landing-link-missing" && p.detail.includes(href)),
      `拿掉 ${href} 應該要被抓到`,
    );
  }
});

test("介紹頁缺「資料與隱私」段落 → landing-privacy-missing", () => {
  const html = goodLanding().replace("<h2>資料與隱私</h2>", "<h2>其他</h2>");
  assert.ok(codes(auditLandingDocument(html)).includes("landing-privacy-missing"));
});

test("截圖太少／太多、缺 alt、缺尺寸 → landing-screenshot-count / landing-img-*", () => {
  const c = (html) => codes(auditLandingDocument(html));
  assert.ok(c(goodLanding().replace(`${shot(2)}${shot(3)}`, "")).includes("landing-screenshot-count"));
  assert.ok(c(goodLanding().replace(shot(3), `${shot(3)}${shot(4)}${shot(5)}`)).includes("landing-screenshot-count"));
  assert.ok(c(goodLanding().replace('alt="第 2 張遊戲畫面截圖"', 'alt=""')).includes("landing-img-alt"));
  assert.ok(c(goodLanding().replace(' alt="第 2 張遊戲畫面截圖"', "")).includes("landing-img-alt"));
  assert.ok(c(goodLanding().replace(shot(1), '<img src="/screens/s1.webp" alt="截圖" />')).includes("landing-img-size"));
});

test("可見文字或 alt 出現破折號／原作商標 → banned-visible-text", () => {
  const c = (html) => codes(auditLandingDocument(html));
  assert.ok(c(goodLanding().replace("<h1>戰鬥陀螺線上對戰</h1>", "<h1>戰鬥陀螺——線上對戰</h1>")).includes("banned-visible-text"));
  assert.ok(c(goodLanding().replace('alt="第 1 張遊戲畫面截圖"', 'alt="Beyblade 對戰畫面"')).includes("banned-visible-text"));
  // 網址（屬性值）裡的子網域不算可見文字
  assert.ok(!c(goodLanding()).includes("banned-visible-text"));
});

test("暗示免登入 → landing-false-claim", () => {
  const html = goodLanding().replace("<h1>戰鬥陀螺線上對戰</h1>", "<h1>戰鬥陀螺線上對戰</h1><p>免登入馬上玩</p>");
  assert.ok(codes(auditLandingDocument(html)).includes("landing-false-claim"));
});

test("內容退化成空殼 → landing-thin；h1 兩個 → landing-h1-count", () => {
  assert.ok(codes(auditLandingDocument(goodLanding().replace(FILLER, "短"))).includes("landing-thin"));
  assert.ok(
    codes(auditLandingDocument(goodLanding().replace("<h1>戰鬥陀螺線上對戰</h1>", "<h1>A</h1><h1>B</h1>"))).includes(
      "landing-h1-count",
    ),
  );
});

// ---------------------------------------------------------------- 404 / robots / sitemap mutations

test("404 頁：缺 noindex／有 canonical／標題不對／缺回首頁連結", () => {
  const c = (html) => codes(audit404Document(html));
  assert.ok(c(good404().replace(NOINDEX_TAG, "")).includes("404-indexable"));
  assert.ok(c(good404().replace(NOINDEX_TAG, `${NOINDEX_TAG}${CANONICAL_TAG}`)).includes("404-canonical"));
  assert.ok(c(good404().replace("<title>找不到這個頁面｜戰鬥陀螺</title>", "<title>戰鬥陀螺</title>")).includes("404-title"));
  assert.ok(c(good404().replace('<a href="/">回首頁</a>', "")).includes("404-home-link"));
  assert.ok(c(good404().replace(`<a href="${HUB_LINKS.privacy}">隱私權政策</a>`, "")).includes("404-privacy-link"));
});

test("robots.txt 落到 HTML（線上舊問題）→ robots-html", () => {
  assert.ok(codes(auditRobotsTxt("<!DOCTYPE html><html><div id=\"app\"></div></html>")).includes("robots-html"));
});

test("robots.txt：缺 /api/、擋整站、缺或錯 Sitemap 都擋", () => {
  const c = (t) => codes(auditRobotsTxt(t));
  assert.ok(c(goodRobots().replace("Disallow: /api/\n", "")).includes("robots-api"));
  assert.ok(c(goodRobots().replace("Allow: /", "Disallow: /")).includes("robots-block-all"));
  assert.ok(c(goodRobots().replace(/Sitemap:.*\n/, "")).includes("robots-sitemap"));
  assert.ok(c(goodRobots().replace("https://beyblade.pocketool.app/sitemap.xml", "https://www.pocketool.app/sitemap.xml")).includes("robots-sitemap"));
  assert.ok(c(goodRobots().replace("User-agent: *", "User-agent: Googlebot")).includes("robots-ua"));
});

test("sitemap 落到 HTML（線上舊問題）→ sitemap-prolog / sitemap-urlset / sitemap-html", () => {
  const c = codes(auditSitemapXml('<!DOCTYPE html><html lang="zh-Hant"><div id="app"></div></html>'));
  for (const code of ["sitemap-prolog", "sitemap-urlset", "sitemap-html", "sitemap-empty"]) assert.ok(c.includes(code), code);
});

test("sitemap 只能列可索引的本站網址", () => {
  const c = (locs) => codes(auditSitemapXml(goodSitemap(locs)));
  assert.ok(c([CANONICAL_URL, "https://beyblade.pocketool.app/room/ABC234"]).includes("sitemap-non-indexable"));
  assert.ok(c([CANONICAL_URL, "https://beyblade.pocketool.app/login"]).includes("sitemap-non-indexable"));
  assert.ok(c([CANONICAL_URL, "https://www.pocketool.app/tools/beyblade"]).includes("sitemap-foreign-loc"));
  assert.ok(c(["https://beyblade.pocketool.app/?x=1"]).includes("sitemap-missing-home"));
  assert.ok(c([CANONICAL_URL, CANONICAL_URL]).includes("sitemap-duplicate"));
  assert.ok(c(["http://beyblade.pocketool.app/"]).includes("sitemap-foreign-loc"));
  assert.ok(codes(auditSitemapXml(goodSitemap().replace("</urlset>", "<!-- a & b --></urlset>"))).includes("sitemap-unescaped-amp"));
});

// ---------------------------------------------------------------- 登入頁連結

test("登入頁缺隱私權政策連結 → login-privacy-link-missing", () => {
  const src = goodLogin().replace(`<a href="${HUB_LINKS.privacy}">隱私權政策</a>`, "");
  assert.ok(codes(auditLoginView(src)).includes("login-privacy-link-missing"));
});

// ---------------------------------------------------------------- 新純函式

test("extractAnchors / extractImages / extractLinkHrefs / hasNoindex 精確取值", () => {
  const html = `<head><link rel="canonical" href="https://a/"><link rel="icon" href="/f.svg">
<meta name="robots" content="noindex, follow"></head>
<body><!-- <a href="/ghost">x</a> --><a href="/x" rel="nofollow"><b>去</b> 吧</a><img src="/i.webp" alt="圖"><img src="/j.webp"></body>`;
  assert.deepEqual(extractAnchors(html), [{ href: "/x", rel: "nofollow", text: "去 吧" }]);
  assert.deepEqual(
    extractImages(html).map((i) => [i.src, i.alt]),
    [
      ["/i.webp", "圖"],
      ["/j.webp", null],
    ],
  );
  assert.deepEqual(extractLinkHrefs(html, "canonical"), ["https://a/"]);
  assert.equal(hasNoindex(html), true);
  assert.equal(hasNoindex('<meta name="robots" content="index, follow">'), false);
});
