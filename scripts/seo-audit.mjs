#!/usr/bin/env node
// 標題／登入頁可見文案的 fail-closed gate（零依賴，掛在 npm postbuild）。
//
// 為什麼要有這支：正式站早就是可玩的線上對戰產品，但 <title> 曾長期停在
// 「物理引擎原型」這種過時 metadata。這支把「對外標題契約」與「登入頁誠實文案」
// 變成建置時會擋下來的硬規則——source 與 build 產物兩邊都驗。
//
// 管的範圍：
// - 標題三件套（title / og:title / twitter:title）+ html lang：SPA 殼與公開介紹頁都驗。
// - SPA 殼 index.html：所有 deep route（登入頁、大廳、對戰房、設定、後台、測試頁）共用這份，
//   所以必須 noindex、且不得有 canonical / og:url（會把所有 deep route 錯指到首頁）。
// - 公開介紹頁 public/landing.html（未登入造訪 / 時由 worker/pages.ts 回這份）：可索引，
//   canonical、description、OG 分享卡、登入 CTA、資料與隱私、頁尾連結、截圖 alt 都是契約。
// - public/404.html（資產層 not_found_handling）、robots.txt、sitemap.xml。
// - 登入頁可見契約（h1 + 誠實的登入提示 + 隱私權政策連結）。
// 不做 JSON-LD（沒有需要的 rich result）。
//
// 純比對函式（audit* / extract*）與 CLI 分離，方便 scripts/seo-audit.test.mjs 直接 import 驗。
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---- 契約常數（唯一事實來源）----
export const EXPECTED_TITLE = "玩戰鬥陀螺線上對戰｜免費瀏覽器雙人遊戲";
export const EXPECTED_LANG = "zh-Hant";
/** 過時 metadata：不得在任何輸出殘留（註解除外）。 */
export const LEGACY_TITLES = ["戰鬥陀螺 — 物理引擎原型"];
export const EXPECTED_WORDMARK = "戰鬥陀螺";
export const EXPECTED_LOGIN_HINT =
  "免費的瀏覽器雙人線上對戰需要 Google 帳號登入（對戰暱稱由系統指派、可在個人設定修改，頭像取自 Google 帳號）。";
/** 提示文案必須誠實涵蓋的關鍵語（缺任一＝文案與 title 定位脫鉤）。 */
export const LOGIN_HINT_TOKENS = ["免費", "瀏覽器", "雙人", "需要 Google 帳號登入"];

export const SITE_ORIGIN = "https://beyblade.pocketool.app";
/** 唯一可索引的網址：首頁（未登入看到公開介紹頁）。sitemap 只能列這些。 */
export const INDEXABLE_PATHS = ["/"];
export const CANONICAL_URL = `${SITE_ORIGIN}/`;
/** SPA 殼與介紹頁共用（殼的那份給分享房間連結時的預覽卡用）。 */
export const EXPECTED_DESCRIPTION =
  "免費的瀏覽器戰鬥陀螺雙人對戰：用 Google 帳號登入後，可以用房號找朋友、快速配對或跟 BOT 練習。拖曳發射陀螺，伺服器算完整個回合後雙方看同一段回放，先拿 3 分獲勝。";
export const OG_IMAGE_URL = `${SITE_ORIGIN}/og.png`;
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };
export const TWITTER_CARD = "summary_large_image";
/** 口袋工具主站連結（隱私權政策會說明各工具的登入資料）。 */
export const HUB_LINKS = {
  privacy: "https://www.pocketool.app/privacy",
  terms: "https://www.pocketool.app/terms",
  contact: "https://www.pocketool.app/contact",
  home: "https://www.pocketool.app/",
};
export const HUB_INTRO_URL = "https://www.pocketool.app/tools/beyblade";
export const LANDING_CTA_TEXT = "用 Google 登入開始對戰";
export const LANDING_CTA_HREF_PREFIX = "/api/auth/login";
export const LANDING_SCREENSHOTS = { min: 2, max: 4, pathPrefix: "/screens/" };
/** 介紹頁可見中文字下限：防止退化成薄內容空殼（目前約 1,100 字）。 */
export const LANDING_MIN_CJK = 600;
/** 使用者可見文字（含 alt）不得出現：破折號（站長文案規則）與原作商標（去 IP 規則）。 */
export const BANNED_VISIBLE = ["——", "beyblade", "xtreme"];
/** 不實承諾：本站必須登入才能對戰。 */
export const BANNED_CLAIMS = ["免登入", "免註冊", "不用登入", "不需登入即可對戰"];

// ---- 小工具 ----
const problem = (code, detail) => ({ code, detail });

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
/** 移掉 <script>/<style> 內文（GA inline script 不該被當成標記掃描）。 */
const stripRawText = (s) => s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "<$1></$1>");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, k) => ENTITIES[k]);

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
/** 把 tag 內的屬性字串解析成 { name: value }（無值屬性 → ""）。 */
export function parseAttrs(attrString) {
  const out = {};
  for (const m of attrString.matchAll(ATTR_RE)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** 回傳所有 <title> 的文字內容（不含註解與 script/style 內的假陽性）。 */
export function extractTitles(html) {
  const markup = stripRawText(stripComments(html));
  return [...markup.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => decodeEntities(m[1]).trim());
}

/** 回傳所有 meta 的 content，key 比對 property 與 name 兩種寫法（重複寫法也會被計數）。 */
export function extractMetaContents(html, key) {
  const markup = stripRawText(stripComments(html));
  const wanted = key.toLowerCase();
  const out = [];
  for (const m of markup.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = parseAttrs(m[1]);
    const id = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (id === wanted) out.push((attrs.content ?? "").trim());
  }
  return out;
}

/** <html lang="...">，缺 lang 或缺 <html> 回 null。 */
export function extractHtmlLang(html) {
  const m = stripComments(html).match(/<html\b([^>]*)>/i);
  if (!m) return null;
  const attrs = parseAttrs(m[1]);
  return attrs.lang ?? null;
}

/** 元素之間的文字節點（屬性值與註解都不算「可見」）。 */
export function extractVisibleText(markup) {
  return stripRawText(stripComments(markup))
    .split(/<[^>]*>/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function checkSingleton(values, label, codePrefix) {
  if (values.length !== 1) {
    return [problem(`${codePrefix}-count`, `${label} 應恰好一個，實際 ${values.length} 個`)];
  }
  if (values[0] !== EXPECTED_TITLE) {
    return [problem(`${codePrefix}-mismatch`, `${label} = ${JSON.stringify(values[0])}，契約為 ${JSON.stringify(EXPECTED_TITLE)}`)];
  }
  return [];
}

/**
 * 驗一份 HTML 文件（source index.html 或 dist 產物）。
 * 回傳 { problems, facts }；problems 非空＝fail-closed。
 */
export function auditHtmlDocument(html) {
  const titles = extractTitles(html);
  const og = extractMetaContents(html, "og:title");
  const tw = extractMetaContents(html, "twitter:title");
  const lang = extractHtmlLang(html);

  const problems = [
    ...checkSingleton(titles, "<title>", "title"),
    ...checkSingleton(og, "og:title", "og-title"),
    ...checkSingleton(tw, "twitter:title", "twitter-title"),
  ];

  if (lang !== EXPECTED_LANG) {
    problems.push(problem("lang-mismatch", `html lang = ${JSON.stringify(lang)}，契約為 ${JSON.stringify(EXPECTED_LANG)}`));
  }

  // 註解不算殘留；但 script 字串裡的舊標題算（可能被 document.title 蓋回去）。
  const body = stripComments(html);
  for (const legacy of LEGACY_TITLES) {
    if (body.includes(legacy)) {
      problems.push(problem("legacy-title-present", `舊標題殘留：${JSON.stringify(legacy)}`));
    }
  }

  return {
    problems,
    facts: { titles, ogTitles: og, twitterTitles: tw, lang },
  };
}

/** 取 SFC 最外層 <template> 區塊；找不到回 null。 */
export function extractSfcTemplate(source) {
  const start = source.search(/<template(\s[^>]*)?>/);
  const end = source.lastIndexOf("</template>");
  if (start === -1 || end === -1 || end <= start) return null;
  return source.slice(source.indexOf(">", start) + 1, end);
}

/**
 * 驗登入頁：可見 h1.wordmark + 可見誠實提示文案。
 * 只看 <template> 的文字節點——註解、屬性值、script 內字串一律不算過關。
 */
export function auditLoginView(source) {
  const template = extractSfcTemplate(source);
  if (template === null) {
    return { problems: [problem("login-template-missing", "找不到 <template> 區塊")], facts: {} };
  }
  const markup = stripComments(template);
  const problems = [];

  const headings = (level) =>
    [...markup.matchAll(new RegExp(`<h${level}\\b([^>]*)>([\\s\\S]*?)</h${level}>`, "gi"))]
      .map((m) => ({ attrs: parseAttrs(m[1]), text: m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() }))
      .filter((h) => (h.attrs.class ?? "").split(/\s+/).includes("wordmark"));

  const h1s = headings(1);
  const h2s = headings(2);
  if (h2s.length > 0) {
    problems.push(problem("login-h2-wordmark", `wordmark 退回 <h2>（${h2s.length} 個）——頁面主標題必須是 <h1>`));
  }
  if (h1s.length !== 1) {
    problems.push(problem("login-h1-missing", `可見 h1.wordmark 應恰好一個，實際 ${h1s.length} 個`));
  } else if (h1s[0].text !== EXPECTED_WORDMARK) {
    problems.push(problem("login-h1-text", `h1.wordmark = ${JSON.stringify(h1s[0].text)}，契約為 ${JSON.stringify(EXPECTED_WORDMARK)}`));
  }

  const visible = extractVisibleText(markup);
  if (!visible.includes(EXPECTED_LOGIN_HINT)) {
    problems.push(problem("login-hint-missing", `找不到可見的完整登入提示：${JSON.stringify(EXPECTED_LOGIN_HINT)}`));
  }
  for (const token of LOGIN_HINT_TOKENS) {
    if (!visible.some((t) => t.includes(token))) {
      problems.push(problem("login-hint-token-missing", `可見文案缺少關鍵語：${JSON.stringify(token)}`));
    }
  }

  // 登入頁是未登入者最常落地的 SPA 畫面：要看得到隱私權政策（說明登入會存哪些資料）
  if (!extractAnchors(markup).some((a) => a.href === HUB_LINKS.privacy)) {
    problems.push(problem("login-privacy-link-missing", `登入頁缺隱私權政策連結 ${HUB_LINKS.privacy}`));
  }

  return {
    problems,
    facts: { h1Texts: h1s.map((h) => h.text), hint: visible.find((t) => t.includes("Google 帳號登入")) ?? null },
  };
}

// ---- SEO 基礎建設（SPA 殼 / 介紹頁 / 404 / robots / sitemap）----

const markupOf = (html) => stripRawText(stripComments(html));
const plainText = (s) => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/** 所有 <link> 中 rel 含指定值者的 href。 */
export function extractLinkHrefs(html, rel) {
  const wanted = rel.toLowerCase();
  const out = [];
  for (const m of markupOf(html).matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = parseAttrs(m[1]);
    if ((attrs.rel ?? "").toLowerCase().split(/\s+/).includes(wanted)) out.push(attrs.href ?? "");
  }
  return out;
}

/** 所有 <a>：{ href, rel, text }（text＝去標籤後的可見文字）。 */
export function extractAnchors(html) {
  return [...markupOf(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => {
    const attrs = parseAttrs(m[1]);
    return { href: attrs.href ?? null, rel: attrs.rel ?? "", text: plainText(m[2]) };
  });
}

/** 所有 <img>：{ src, alt, width, height, loading }（alt 缺＝null，空字串＝""）。 */
export function extractImages(html) {
  return [...markupOf(html).matchAll(/<img\b([^>]*)>/gi)].map((m) => {
    const attrs = parseAttrs(m[1]);
    return {
      src: attrs.src ?? null,
      alt: "alt" in attrs ? attrs.alt : null,
      width: attrs.width ?? null,
      height: attrs.height ?? null,
    };
  });
}

/** 指定層級標題的可見文字。 */
export function extractHeadings(html, level) {
  return [...markupOf(html).matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "gi"))].map((m) =>
    plainText(m[1]),
  );
}

/** 任一 meta robots（name=robots）含 noindex。 */
export function hasNoindex(html) {
  return extractMetaContents(html, "robots").some((c) => c.toLowerCase().split(/[\s,]+/).includes("noindex"));
}

const countCjk = (s) => (s.match(/[㐀-鿿]/g) ?? []).length;

function checkExactlyOne(values, expected, label, codePrefix) {
  if (values.length !== 1) return [problem(`${codePrefix}-count`, `${label} 應恰好一個，實際 ${values.length} 個`)];
  if (values[0] !== expected) {
    return [problem(`${codePrefix}-mismatch`, `${label} = ${JSON.stringify(values[0])}，契約為 ${JSON.stringify(expected)}`)];
  }
  return [];
}

function checkBannedVisible(texts, where) {
  const problems = [];
  const joined = texts.join("\n").toLowerCase();
  for (const banned of BANNED_VISIBLE) {
    if (joined.includes(banned)) problems.push(problem("banned-visible-text", `${where}出現禁用字串 ${JSON.stringify(banned)}`));
  }
  return problems;
}

/** description / og:description / og:image / twitter:card / favicon：殼與介紹頁共用的分享卡契約。 */
export function auditShareMeta(html) {
  const description = extractMetaContents(html, "description");
  const problems = [
    ...checkExactlyOne(description, EXPECTED_DESCRIPTION, "meta description", "description"),
    ...checkExactlyOne(extractMetaContents(html, "og:description"), EXPECTED_DESCRIPTION, "og:description", "og-description"),
    ...checkExactlyOne(extractMetaContents(html, "og:image"), OG_IMAGE_URL, "og:image", "og-image"),
    ...checkExactlyOne(extractMetaContents(html, "og:image:width"), String(OG_IMAGE_SIZE.width), "og:image:width", "og-image-width"),
    ...checkExactlyOne(extractMetaContents(html, "og:image:height"), String(OG_IMAGE_SIZE.height), "og:image:height", "og-image-height"),
    ...checkExactlyOne(extractMetaContents(html, "twitter:card"), TWITTER_CARD, "twitter:card", "twitter-card"),
  ];
  if (extractLinkHrefs(html, "icon").length === 0) problems.push(problem("favicon-missing", "缺 <link rel=\"icon\">"));
  for (const d of description) {
    for (const banned of [...BANNED_VISIBLE, ...BANNED_CLAIMS]) {
      if (d.toLowerCase().includes(banned)) problems.push(problem("description-banned", `description 含禁用字串 ${JSON.stringify(banned)}`));
    }
  }
  return {
    problems,
    facts: { description: description[0] ?? null, ogImage: extractMetaContents(html, "og:image")[0] ?? null },
  };
}

/** SPA 殼 index.html：標題契約 + 分享卡 + noindex + 不得有 canonical / og:url。 */
export function auditShellDocument(html) {
  const base = auditHtmlDocument(html);
  const share = auditShareMeta(html);
  const problems = [...base.problems, ...share.problems];
  if (!hasNoindex(html)) problems.push(problem("shell-indexable", "SPA 殼必須 <meta name=\"robots\" content=\"noindex\">"));
  const canonicals = extractLinkHrefs(html, "canonical");
  if (canonicals.length > 0) {
    problems.push(problem("shell-canonical", `SPA 殼不得有 canonical（deep route 共用這份），實際 ${JSON.stringify(canonicals)}`));
  }
  if (extractMetaContents(html, "og:url").length > 0) problems.push(problem("shell-og-url", "SPA 殼不得有 og:url"));
  return { problems, facts: { ...base.facts, ...share.facts, noindex: hasNoindex(html), canonicals } };
}

/** 公開介紹頁 landing.html：可索引、canonical、內容與連結契約。 */
export function auditLandingDocument(html) {
  const base = auditHtmlDocument(html);
  const share = auditShareMeta(html);
  const problems = [...base.problems, ...share.problems];

  if (hasNoindex(html)) problems.push(problem("landing-noindex", "介紹頁不得 noindex"));
  const canonicals = extractLinkHrefs(html, "canonical");
  problems.push(...checkExactlyOne(canonicals, CANONICAL_URL, "canonical", "landing-canonical"));
  problems.push(...checkExactlyOne(extractMetaContents(html, "og:url"), CANONICAL_URL, "og:url", "landing-og-url"));

  const h1s = extractHeadings(html, 1).filter(Boolean);
  if (h1s.length !== 1) problems.push(problem("landing-h1-count", `h1 應恰好一個且有文字，實際 ${h1s.length} 個`));

  const anchors = extractAnchors(html);
  const ctas = anchors.filter((a) => a.text.includes(LANDING_CTA_TEXT));
  if (ctas.length === 0) {
    problems.push(problem("landing-cta-missing", `找不到可見的登入 CTA「${LANDING_CTA_TEXT}」`));
  }
  for (const a of ctas) {
    if (!(a.href ?? "").startsWith(LANDING_CTA_HREF_PREFIX)) {
      problems.push(problem("landing-cta-href", `登入 CTA 應連到 ${LANDING_CTA_HREF_PREFIX}，實際 ${JSON.stringify(a.href)}`));
    }
    if (!a.rel.split(/\s+/).includes("nofollow")) problems.push(problem("landing-cta-nofollow", "登入 CTA 要 rel=\"nofollow\"（/api/ 不給爬）"));
  }
  const hrefs = new Set(anchors.map((a) => a.href));
  for (const [name, href] of Object.entries({ ...HUB_LINKS, intro: HUB_INTRO_URL })) {
    if (!hrefs.has(href)) problems.push(problem("landing-link-missing", `缺少連結 ${name}：${href}`));
  }

  const visible = extractVisibleText(html);
  if (!visible.some((t) => t.includes("資料與隱私"))) problems.push(problem("landing-privacy-missing", "缺少「資料與隱私」段落"));
  for (const claim of BANNED_CLAIMS) {
    if (visible.some((t) => t.includes(claim))) problems.push(problem("landing-false-claim", `可見文案含不實承諾 ${JSON.stringify(claim)}`));
  }
  const cjk = countCjk(visible.join(""));
  if (cjk < LANDING_MIN_CJK) problems.push(problem("landing-thin", `可見中文字 ${cjk} < ${LANDING_MIN_CJK}（內容過薄）`));

  const images = extractImages(html);
  const shots = images.filter((img) => (img.src ?? "").startsWith(LANDING_SCREENSHOTS.pathPrefix));
  if (shots.length < LANDING_SCREENSHOTS.min || shots.length > LANDING_SCREENSHOTS.max) {
    problems.push(
      problem("landing-screenshot-count", `截圖應 ${LANDING_SCREENSHOTS.min}~${LANDING_SCREENSHOTS.max} 張，實際 ${shots.length} 張`),
    );
  }
  for (const img of images) {
    if (!img.alt || !img.alt.trim()) problems.push(problem("landing-img-alt", `圖片缺 alt：${JSON.stringify(img.src)}`));
    if (!img.width || !img.height) problems.push(problem("landing-img-size", `圖片缺 width/height（CLS）：${JSON.stringify(img.src)}`));
  }
  problems.push(...checkBannedVisible([...visible, ...images.map((i) => i.alt ?? "")], "介紹頁可見文字／alt "));

  return {
    problems,
    facts: {
      ...base.facts,
      ...share.facts,
      canonicals,
      h1: h1s[0] ?? null,
      cjk,
      screenshots: shots.map((s) => s.src),
    },
  };
}

/** 404 頁：noindex、無 canonical、有回首頁與隱私權政策連結。 */
export function audit404Document(html) {
  const problems = [];
  if (extractHtmlLang(html) !== EXPECTED_LANG) problems.push(problem("404-lang", `html lang 應為 ${EXPECTED_LANG}`));
  if (!hasNoindex(html)) problems.push(problem("404-indexable", "404 頁必須 noindex"));
  if (extractLinkHrefs(html, "canonical").length > 0) problems.push(problem("404-canonical", "404 頁不得有 canonical"));
  const titles = extractTitles(html);
  if (titles.length !== 1 || !titles[0].includes("找不到")) {
    problems.push(problem("404-title", `404 頁 <title> 應恰好一個且含「找不到」，實際 ${JSON.stringify(titles)}`));
  }
  const hrefs = new Set(extractAnchors(html).map((a) => a.href));
  if (!hrefs.has("/")) problems.push(problem("404-home-link", "404 頁缺回首頁連結 href=\"/\""));
  if (!hrefs.has(HUB_LINKS.privacy)) problems.push(problem("404-privacy-link", "404 頁缺隱私權政策連結"));
  problems.push(...checkBannedVisible(extractVisibleText(html), "404 頁"));
  return { problems, facts: { titles } };
}

/** robots.txt：純文字、放行首頁、擋 /api/、Sitemap 指向本站 sitemap.xml。 */
export function auditRobotsTxt(text) {
  const problems = [];
  if (/^\s*</.test(text)) {
    return { problems: [problem("robots-html", "robots.txt 內容是 HTML（落到 SPA / 404 fallback？）")], facts: {} };
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return i < 0 ? { key: l.toLowerCase(), value: "" } : { key: l.slice(0, i).trim().toLowerCase(), value: l.slice(i + 1).trim() };
    });
  const values = (key) => lines.filter((l) => l.key === key).map((l) => l.value);
  if (!values("user-agent").includes("*")) problems.push(problem("robots-ua", "缺 User-agent: *"));
  const disallow = values("disallow");
  if (!disallow.includes("/api/")) problems.push(problem("robots-api", "缺 Disallow: /api/"));
  if (disallow.includes("/")) problems.push(problem("robots-block-all", "Disallow: / 會擋掉整站"));
  for (const p of INDEXABLE_PATHS) {
    if (disallow.some((d) => d !== "" && p.startsWith(d) && d !== "/api/")) {
      problems.push(problem("robots-blocks-indexable", `Disallow 擋到可索引頁 ${p}`));
    }
  }
  const sitemaps = values("sitemap");
  if (!sitemaps.includes(`${SITE_ORIGIN}/sitemap.xml`)) {
    problems.push(problem("robots-sitemap", `缺 Sitemap: ${SITE_ORIGIN}/sitemap.xml`));
  }
  return { problems, facts: { disallow, sitemaps } };
}

/** sitemap.xml：合法 urlset、只列本站可索引網址。 */
export function auditSitemapXml(xml) {
  const problems = [];
  if (!/^\s*<\?xml\b/.test(xml)) problems.push(problem("sitemap-prolog", "缺 <?xml ...?> 宣告（落到 HTML fallback？）"));
  if (!/<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(xml)) {
    problems.push(problem("sitemap-urlset", "缺 <urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"));
  }
  if (/<html\b/i.test(xml)) problems.push(problem("sitemap-html", "sitemap 內容含 <html>"));
  if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml)) problems.push(problem("sitemap-unescaped-amp", "有未跳脫的 &"));
  const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
  if (locs.length === 0) problems.push(problem("sitemap-empty", "沒有任何 <loc>"));
  if (new Set(locs).size !== locs.length) problems.push(problem("sitemap-duplicate", "有重複的 <loc>"));
  for (const loc of locs) {
    let url;
    try {
      url = new URL(loc);
    } catch {
      problems.push(problem("sitemap-bad-loc", `不是合法網址：${JSON.stringify(loc)}`));
      continue;
    }
    if (url.origin !== SITE_ORIGIN) problems.push(problem("sitemap-foreign-loc", `不是本站網址：${loc}`));
    else if (!INDEXABLE_PATHS.includes(url.pathname) || url.search || url.hash) {
      problems.push(problem("sitemap-non-indexable", `列了不可索引的網址：${loc}`));
    }
  }
  if (!locs.includes(CANONICAL_URL)) problems.push(problem("sitemap-missing-home", `缺首頁 ${CANONICAL_URL}`));
  return { problems, facts: { locs } };
}

/** PNG 寬高（讀 IHDR）；不是 PNG 回 null。 */
export function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!buf || buf.length < 24 || !sig.every((b, i) => buf[i] === b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---- CLI ----
// assetRoot：該 HTML 引用的站內資源（og:image、截圖）要在哪個目錄找得到實體檔。
const TARGETS = [
  { kind: "shell", path: "index.html", label: "SPA 殼 source", assetRoot: "public" },
  { kind: "shell", path: "dist/client/index.html", label: "SPA 殼 build 產物", assetRoot: "dist/client" },
  { kind: "landing", path: "public/landing.html", label: "公開介紹頁 source", assetRoot: "public" },
  { kind: "landing", path: "dist/client/landing.html", label: "公開介紹頁 build 產物", assetRoot: "dist/client" },
  { kind: "404", path: "public/404.html", label: "404 頁 source" },
  { kind: "404", path: "dist/client/404.html", label: "404 頁 build 產物" },
  { kind: "robots", path: "public/robots.txt", label: "robots source" },
  { kind: "robots", path: "dist/client/robots.txt", label: "robots build 產物" },
  { kind: "sitemap", path: "public/sitemap.xml", label: "sitemap source" },
  { kind: "sitemap", path: "dist/client/sitemap.xml", label: "sitemap build 產物" },
  { kind: "login", path: "src/views/LoginView.vue", label: "登入頁" },
];

const AUDITS = {
  shell: auditShellDocument,
  landing: auditLandingDocument,
  404: audit404Document,
  robots: auditRobotsTxt,
  sitemap: auditSitemapXml,
  login: auditLoginView,
};

const q = (v) => (v === null || v === undefined ? "(缺)" : JSON.stringify(v));
const cp = (s) => (typeof s === "string" ? [...s].length : 0);

/** 站內資源（og:image、截圖）必須真的存在；og:image 還要是 1200x630 PNG。 */
async function checkAssets(target, source, root) {
  const problems = [];
  const read = (sitePath) => readFile(new URL(`${target.assetRoot}${sitePath}`, pathToFileURL(root)));
  for (const url of extractMetaContents(source, "og:image")) {
    if (!url.startsWith(`${SITE_ORIGIN}/`)) continue; // 網址錯誤由 audit 本身報
    try {
      const size = pngSize(await read(new URL(url).pathname));
      if (!size || size.width !== OG_IMAGE_SIZE.width || size.height !== OG_IMAGE_SIZE.height) {
        problems.push(problem("og-image-dimensions", `${url} 應為 ${OG_IMAGE_SIZE.width}x${OG_IMAGE_SIZE.height} PNG，實際 ${q(size)}`));
      }
    } catch {
      problems.push(problem("og-image-missing", `${target.assetRoot} 找不到 ${url}`));
    }
  }
  for (const img of extractImages(source)) {
    if (!img.src?.startsWith("/")) continue;
    try {
      await read(img.src);
    } catch {
      problems.push(problem("img-missing", `${target.assetRoot} 找不到 ${img.src}`));
    }
  }
  return problems;
}

function printFacts(kind, facts) {
  if (kind === "shell" || kind === "landing") {
    console.log(`  title        : ${q(facts.titles[0])}${facts.titles.length === 1 ? "" : ` (${facts.titles.length} 個)`}`);
    console.log(`  og:title     : ${q(facts.ogTitles[0])}${facts.ogTitles.length === 1 ? "" : ` (${facts.ogTitles.length} 個)`}`);
    console.log(`  twitter:title: ${q(facts.twitterTitles[0])}${facts.twitterTitles.length === 1 ? "" : ` (${facts.twitterTitles.length} 個)`}`);
    console.log(`  html lang    : ${q(facts.lang)}`);
    console.log(`  description  : ${cp(facts.description)} code points`);
    console.log(`  og:image     : ${q(facts.ogImage)}`);
  }
  if (kind === "shell") console.log(`  noindex      : ${facts.noindex}（canonical ${facts.canonicals.length} 個）`);
  if (kind === "landing") {
    console.log(`  canonical    : ${q(facts.canonicals[0])}`);
    console.log(`  h1           : ${q(facts.h1)}`);
    console.log(`  可見中文字   : ${facts.cjk}`);
    console.log(`  截圖         : ${facts.screenshots.length} 張`);
  }
  if (kind === "404") console.log(`  title        : ${q(facts.titles?.[0])}`);
  if (kind === "robots") console.log(`  Disallow     : ${q(facts.disallow)}；Sitemap ${q(facts.sitemaps)}`);
  if (kind === "sitemap") console.log(`  loc          : ${q(facts.locs)}`);
  if (kind === "login") {
    console.log(`  h1.wordmark  : ${q(facts.h1Texts?.[0])}`);
    console.log(`  可見登入提示 : ${q(facts.hint)}`);
  }
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let failed = 0;

  console.log(`[seo-audit] 標題契約 = ${JSON.stringify(EXPECTED_TITLE)}（${cp(EXPECTED_TITLE)} code points）`);

  for (const target of TARGETS) {
    console.log(`\n[seo-audit] ${target.path}（${target.label}）`);
    let source;
    try {
      source = await readFile(new URL(target.path, pathToFileURL(root)), "utf8");
    } catch (err) {
      // 讀不到就是不通過：postbuild 時 dist 必須存在。
      console.error(`  ✗ file-unreadable: ${err.message}`);
      failed++;
      continue;
    }

    const { problems, facts } = AUDITS[target.kind](source);
    if (target.assetRoot) problems.push(...(await checkAssets(target, source, root)));
    printFacts(target.kind, facts);

    for (const p of problems) console.error(`  ✗ ${p.code}: ${p.detail}`);
    failed += problems.length;
    if (problems.length === 0) console.log("  ✓ 通過");
  }

  if (failed > 0) {
    console.error(`\n[seo-audit] 不通過：${failed} 項`);
    process.exit(1);
  }
  console.log("\n[seo-audit] 全數通過");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[seo-audit] 執行失敗：${err?.stack ?? err}`);
    process.exit(1);
  });
}
