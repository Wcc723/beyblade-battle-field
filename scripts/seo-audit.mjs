#!/usr/bin/env node
// 標題／登入頁可見文案的 fail-closed gate（零依賴，掛在 npm postbuild）。
//
// 為什麼要有這支：正式站早就是可玩的線上對戰產品，但 <title> 曾長期停在
// 「物理引擎原型」這種過時 metadata。這支把「對外標題契約」與「登入頁誠實文案」
// 變成建置時會擋下來的硬規則——source 與 build 產物兩邊都驗。
//
// 刻意只管標題三件套（title / og:title / twitter:title）+ html lang + 登入頁可見契約，
// 不碰 description / canonical / JSON-LD：本站是 SPA，全站共用一份 index.html，
// 補 canonical 會把所有 deep route 錯誤指向 root。
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
  "免費的瀏覽器雙人線上對戰需要 Google 帳號登入（暱稱與頭像預設取自 Google，可在個人設定修改）。";
/** 提示文案必須誠實涵蓋的關鍵語（缺任一＝文案與 title 定位脫鉤）。 */
export const LOGIN_HINT_TOKENS = ["免費", "瀏覽器", "雙人", "需要 Google 帳號登入"];

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

  return {
    problems,
    facts: { h1Texts: h1s.map((h) => h.text), hint: visible.find((t) => t.includes("Google 帳號登入")) ?? null },
  };
}

// ---- CLI ----
const TARGETS = [
  { kind: "html", path: "index.html", label: "source" },
  { kind: "html", path: "dist/client/index.html", label: "build 產物" },
  { kind: "login", path: "src/views/LoginView.vue", label: "登入頁" },
];

const q = (v) => (v === null || v === undefined ? "(缺)" : JSON.stringify(v));
const cp = (s) => (typeof s === "string" ? [...s].length : 0);

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

    const { problems, facts } =
      target.kind === "html" ? auditHtmlDocument(source) : auditLoginView(source);

    if (target.kind === "html") {
      console.log(`  title        : ${q(facts.titles[0])}${facts.titles.length === 1 ? "" : ` (${facts.titles.length} 個)`}`);
      console.log(`  og:title     : ${q(facts.ogTitles[0])}${facts.ogTitles.length === 1 ? "" : ` (${facts.ogTitles.length} 個)`}`);
      console.log(`  twitter:title: ${q(facts.twitterTitles[0])}${facts.twitterTitles.length === 1 ? "" : ` (${facts.twitterTitles.length} 個)`}`);
      console.log(`  html lang    : ${q(facts.lang)}`);
    } else {
      console.log(`  h1.wordmark  : ${q(facts.h1Texts?.[0])}`);
      console.log(`  可見登入提示 : ${q(facts.hint)}`);
    }

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
