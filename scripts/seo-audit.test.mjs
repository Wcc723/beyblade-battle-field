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
    "免費的瀏覽器雙人線上對戰<span>需要 Google 帳號登入（暱稱與頭像預設取自 Google，可在個人設定修改）。</span>",
  );
  const c = codes(auditLoginView(src));
  assert.ok(c.includes("login-hint-missing"));
  assert.ok(!c.includes("login-hint-token-missing"), "關鍵語仍在，只是不成一句 → 只該報 hint-missing");
});

test("提示缺「免費」→ login-hint-token-missing", () => {
  const src = goodLogin().replace(
    EXPECTED_LOGIN_HINT,
    "瀏覽器雙人線上對戰需要 Google 帳號登入（暱稱與頭像預設取自 Google，可在個人設定修改）。",
  );
  const c = codes(auditLoginView(src));
  assert.ok(c.includes("login-hint-missing"));
  assert.ok(c.includes("login-hint-token-missing"));
  assert.ok(auditLoginView(src).problems.some((p) => p.detail.includes("免費")));
});

test("提示缺「瀏覽器」→ login-hint-token-missing", () => {
  const src = goodLogin().replace(
    EXPECTED_LOGIN_HINT,
    "免費的雙人線上對戰需要 Google 帳號登入（暱稱與頭像預設取自 Google，可在個人設定修改）。",
  );
  assert.ok(auditLoginView(src).problems.some((p) => p.code === "login-hint-token-missing" && p.detail.includes("瀏覽器")));
});

test("提示缺「雙人」→ login-hint-token-missing", () => {
  const src = goodLogin().replace(
    EXPECTED_LOGIN_HINT,
    "免費的瀏覽器線上對戰需要 Google 帳號登入（暱稱與頭像預設取自 Google，可在個人設定修改）。",
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
