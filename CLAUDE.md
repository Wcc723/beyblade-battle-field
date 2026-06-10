# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

網頁版雙人對戰戰鬥陀螺。Vite + Vue 3 + TypeScript + Cloudflare Workers。單機物理引擎原型已完成（保留在 `/test/*` 當測試頁），正在進行**雙人線上對戰化**（Cloudflare Worker + Durable Object + D1 + Google OAuth，規劃見下方「線上化路線」）。請用**繁體中文**溝通。

## Commands

```bash
npm run dev        # Vite dev server（含 Worker，@cloudflare/vite-plugin）→ http://localhost:5173
npm test           # vitest（引擎單元測試）
npm run test:watch # vitest watch
npm run balance    # 平衡分析：四類型互打數千場，輸出勝率/勝負原因/猜拳矩陣
npm run build      # Vite build（注意：build 不做型別檢查）
npm run typecheck  # 型別檢查：vue-tsc（前端）+ tsc -p tsconfig.worker.json（worker，改完務必跑）
npm run deploy     # build + wrangler deploy
npm run cf-typegen # wrangler types → 重新產生 worker-configuration.d.ts（改 wrangler.jsonc 後要跑）
```

跑單一測試：`npx vitest run -t "確定性"`（用 `-t` 比對 describe/it 名稱，名稱是中文）。

改完物理引擎或屬性/場地數值後，慣例是：`npm run typecheck` → `npm test` → 動到平衡時再 `npm run balance`。

## 核心架構：確定性批次模擬

整個遊戲圍繞一個關鍵決策——**伺服器一次算完整場、前端只播放**：

- `src/physics/engine.ts` 的 `simulate(inits, config)` 一次模擬整場對戰，回傳含**完整軌跡 `frames[]`** 的 `SimResult`。**對戰中沒有玩家輸入**（發射參數定生死）。
- 引擎是**純函式、零瀏覽器/Cloudflare 相依** → 同一份程式碼可跑在瀏覽器與（未來的）Durable Object。
- **確定性**：用 seeded PRNG（`prng.ts`）+ 固定時間步。同輸入同 seed → 完全一致的 frames。因為只有伺服器算、前端只重播 frames，所以**沒有跨平台浮點數一致性問題**。
- `BattleViz.vue` 的 `runServerSimulation()` 就是未來搬進 **Battle Room Durable Object** 的邊界：收齊雙方發射輸入 → `simulate()` → 廣播軌跡。

`simulate` 的每步固定流程（1/60s）：`integrate → resolveCollisions → resolveWalls → applySpecials → checkDeaths`，沿途記錄 `frames`、`slowmoCues`、`specialEvents`。勝負在「分出勝負那一步」鎖定（`followThroughTime` 讓模擬多跑幾秒做收尾演出：出界陀螺飛出、勝方續轉）。

## 雙資源戰鬥模型

每顆陀螺有兩條獨立資源（前端兩條血條 續/血）：

- **自旋 `spin`（續航條）**：隨時間衰減（`stamina` 越高衰減越慢）→ 歸零即 **停轉 spin-out**。碰撞**不**直接扣自旋。
- **血量 `hp`（耐久條）**：`maxHp = arena.hpBase × weight`；碰撞扣血 → 歸零即 **擊破 ko**。

四圍屬性分工（`presets.ts` 的 `STAT_PRESETS`）：**攻擊**=扣血+擊退、**防禦**=減傷+減擊退、**重量**=血量上限+抗出界、**續航**=自旋衰減慢。勝負條件：`ring-out / spin-out / ko / timeout`。

## 前端對戰流程（`BattleViz.vue`）

狀態機 `aim-A → aim-B → playing`：兩種拖曳發射模式（`flick` 甩動＝放手瞬間游標速度決定動能 / `sling` 拉弓＝拉的距離）→ 紅藍**分開依序發射** → `runServerSimulation()` 統一運算 → 回放。回放用**相鄰幀內插**（`lerpFrame`，慢動作才滑順）+ 終結慢動作（`slowmoCues`）+ 必殺技特效。多回合**先到 3 分**（`roundPoints`：擊破/出界護牆缺口 2 分、停轉 1 分；`POCKET_ANGLES` 定義高分缺口）。

## 設定與後台（localStorage）

三個 store 都設計成「之後可無痛換成 D1 / DO SQLite」，介面不變：

- `arenaStore.ts` — 場地參數（可存多組、切換套用）→ **場地後台**
- `statStore.ts` — 四類型屬性覆寫 → **陀螺後台**
- `specialStore.ts` — 必殺技數值（`SpecialConfig`）→ **陀螺後台**

`simulate` 吃 `config.arena` 與 `config.special` 覆寫。

## 線上化路線（進行中）

頁面用 vue-router（`src/router.ts`）：`/` 大廳、`/room/:code` 對戰廳、`/settings` 個人設定、`/admin/*` 後台、`/test/battle`+`/test/mobile`＝**原單機頁面原樣保留**（繼續吃 localStorage、不受線上化影響）。

Cloudflare 端：`worker/index.ts`（入口，`/api/*` 走 `run_worker_first`）+ `wrangler.jsonc`（SPA fallback）。規格細節（已拍板）：大廳＝房號+快速配對+公開房列表；全站 Google OAuth（`ADMIN_EMAILS` env var 管後台權限）；場地用管理員啟用的全域組、玩家各自選陀螺；線上設定存 D1、房間暫態在 Battle Room DO；seed 由 DO 在雙方提交後產生（防離線暴搜）；R2 第一階段不用。

分階段：✅P1 骨架（router+worker+vite-plugin）→ ✅P2 OAuth+權限（`worker/auth.ts`+`session.ts`+`jwt.ts`、D1 `users`、`/api/me`、router 守衛；環境變數走 `.env`，見 `.env.example`）→ P3 個人設定+後台搬 D1 → P4 Battle Room DO+對戰廳（以 `MobileBattle.vue` 為基底）→ P5 大廳 DO+戰績。

線上化雷區：worker 端被單元測試 import 的模組（`session.ts`/`jwt.ts`）必須**零 `Env` 全域型別相依**（root tsconfig 沒有 workers runtime 型別）；OAuth callback 是整頁導航，**失敗一律 302 回 `/login?error=<code>`** 不可回裸 JSON；JWT/任何 base64 的 UTF-8 內容不能 `JSON.parse(atob(...))`（中文會亂碼）。

## 必殺技

兩招、opt-in（每顆獨立裝備）、seeded 機率觸發、**不影響基礎平衡**（平衡工具不裝必殺技）：

- **rush（衝刺突進）**：逼近對手時機率爆發加速 + 直接扣血。
- **blast（衝擊）**：打出夠猛的一擊時機率把對手彈開 + 扣血（可順勢擊出界）。

所有數值集中在 `engine.ts` 的 `DEFAULT_SPECIAL`，每招獨立觸發機率（`rushChance` / `blastChance`）。

## 平衡（很重要）

**平衡是「場地 × 屬性」共同決定的**——同一組陀螺換個場地勝率天差地遠。靠時間/停轉決勝 → 續航為王；靠碰撞/出界決勝 → 攻防/重量才有用。現行預設已校到接近**猜拳**（攻擊剋持久、持久剋防禦、防禦剋攻擊），四類型勝率約 46~55%。**動到 `STAT_PRESETS`、`DEFAULT_ARENA`、`HP_BASE`、`DEFAULT_SPECIAL` 後一定要 `npm run balance` 驗證。** 工具在 `test/balance.bench.ts`（用 `vitest.balance.config.ts`，不混進一般 `npm test`）。

## 容易踩的雷

- **`build` 不做型別檢查**：要 `npm run typecheck`（涵蓋前端 vue-tsc 與 worker tsc 兩套）。
- **vitest 設定刻意與 vite.config.ts 分離**：`vite.config.ts` 掛了 `@cloudflare/vite-plugin`（dev/build 用）；測試走 `vitest.config.ts`（不含該 plugin，避免測試啟動 worker runtime）。改 vite 設定時兩邊都要想到。
- **`tsconfig.worker.json` 連同 `src/physics` 一起檢查**（lib 只有 ESNext、無 DOM）→ 引擎一旦混入瀏覽器相依，typecheck 就會擋下來。
- **`arena.collisionSpinLoss` 名實不符**：它現在是「碰撞扣**血量**」的係數（語意改過、為相容舊存檔沒改名）。
- **`ArenaConfig` 新欄位設成可選**（如 `hpBase`、`spinKnockback`）：舊 localStorage 場地沒這些欄位，引擎用 `?? 預設` 處理；新增欄位時設可選，否則測試的 `neutralArena()` 也要補。
- **不要靠「升 localStorage 版本鍵」來套用新預設**（會讓使用者既有資料讀不到）；改用「可選欄位 + 合併預設」。
- **碰撞能量夾制**：`resolveCollisions` 把碰撞後分離速度夾到 ≤ 接近速度（防超彈性無限暴衝）。需要「比彈性更強的擊退」（如 `spinKnockback`、blast）要做成**夾制之後的額外推力**，否則會被夾掉。
- **Vue DOM 更新是非同步的**：用瀏覽器自動化/JS 改了狀態後，別在同一個同步區塊讀 DOM（會讀到舊值）；改用截圖或 `nextTick`。
- 美術原始檔在 `art/`（已被 `.gitignore`，可重新處理）；對戰實際用的是 `public/beyblades/*.webp`。
