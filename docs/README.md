# beyblade-arena — 戰鬥陀螺線上對戰

網頁版雙人線上對戰戰鬥陀螺：**伺服器（Durable Object）一次算完整場、廣播輕量「重跑包」，兩端用同一份確定性引擎重跑、前端只回放**。建構在 Vite + Vue 3 + TypeScript + Cloudflare Workers/Durable Objects/D1/R2 全端之上。

## 核心特色

- **確定性批次模擬**：`src/physics/engine.ts` 的 `simulate()` 是純函式（零瀏覽器/Cloudflare 相依）+ seeded PRNG + 固定時間步（1/60s）。對戰中**沒有玩家輸入**——發射參數一定生死。伺服器只廣播 `inits + seed + config`（約 2KB），兩端各自重跑得到完全一致的軌跡，不傳 1.5MB frames，也沒有跨平台浮點數一致性問題。
- **固定名冊角色**：四種陀螺類型（攻擊/防禦/重量/續航），屬性集中在 `presets.ts` 的 `STAT_PRESETS`；中二命名系統（`src/game/names.ts`）由 uid 穩定 hash 產生暱稱與陀螺名，前後端一致、名池已凍結（checksum 鎖）。
- **雙資源戰鬥 + 必殺技**：每顆陀螺有自旋（續航條，歸零＝停轉）與血量（耐久條，歸零＝擊破）兩條獨立資源；五招 opt-in 必殺技（rush/blast/dash/vortex/clone）seeded 機率觸發，刻意設計成裝技強於不裝。
- **三場地隨機池**：熔核競技場（圓形）、弧壁競技場（超橢圓 r(θ) + 對角 rim pocket）等，由管理員啟用的全域組決定；同一組陀螺換場勝率天差地遠（平衡是「場地 × 屬性」共同決定）。
- **金屬鍛造風 UI（BURST FORGE）**：設計系統在 `src/styles/forge.css`，全站渲染字串零 emoji，圖示一律走 `BbIcon.vue` inline SVG；音效為純合成「街機誇張」引擎（`src/audio/sfx.ts`）。

## 技術棧

| 層 | 技術 |
| --- | --- |
| 前端框架 | Vue 3（`<script setup>`）+ TypeScript |
| 建構工具 | Vite 6 + `@cloudflare/vite-plugin`（dev/build 內含 Worker runtime） |
| 路由 | vue-router 4（history mode，SPA fallback） |
| 後端 | Cloudflare Workers（`worker/index.ts` 入口，`/api/*` 走 `run_worker_first`） |
| 即時狀態 | Durable Objects：`BattleRoomDO`（對戰權威狀態機）+ `LobbyDO`（單一全域大廳：presence/配對/公開房） |
| 資料庫 | Cloudflare D1（SQLite）：`users` / `user_settings` / `global_config` / `matches` 等（`migrations/`） |
| 物件儲存 | Cloudflare R2（`SFX` bucket，音效取樣管線保留但目前未使用） |
| 登入 | Google OAuth（自寫 `worker/auth.ts` + `session.ts` + `jwt.ts`，session 走簽名 cookie） |
| 測試 | Vitest（引擎單元測試 + 平衡分析 bench） |

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數：複製範本後填值
cp .env.example .env
```

`.env` 需要以下變數（`.env` 已被 `.gitignore`，僅供本地開發；不要另建 `.dev.vars`，它存在時 wrangler 會整個忽略 `.env`）：

| 變數 | 說明 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → OAuth 2.0 用戶端 ID（重新導向 URI 加 `http://localhost:5173/api/auth/callback`） |
| `GOOGLE_CLIENT_SECRET` | 對應的用戶端密鑰 |
| `SESSION_SECRET` | session cookie 簽名密鑰（長亂數，例：`openssl rand -hex 32`） |
| `ADMIN_EMAILS` | 管理員 Google email（逗號分隔）→ 場地/陀螺後台權限 |

```bash
# 3. 初始化本地 D1（dev server 沒在跑時才執行）
npm run db:migrate

# 4. 啟動開發伺服器（含 Worker）
npm run dev
# → http://localhost:5173
```

提示：

- **登入**：首頁需登入，用 Google 帳號（須在 Google Console 設好上面的重新導向 URI）。
- **BOT 房快速試打**：開房網址帶 `?bot=1`（如 `/room/ABCD?bot=1`），AI 會入座另一側、自動配置與發射，單人也能打整場。
- **全自動測試**：`node scripts/bot-player.mjs`（BOT 客戶端打整場）、`node scripts/lobby-test.mjs`（兩 token 排隊驗證配到同房）。
- **單機原型測試頁**：`/test/battle`、`/test/mobile` 原樣保留、繼續吃 localStorage、不設防、不受線上化影響。

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | Vite dev server（含 Worker，`@cloudflare/vite-plugin`）→ http://localhost:5173 |
| `npm run build` | Vite build（**注意：build 不做型別檢查**） |
| `npm run typecheck` | 型別檢查：vue-tsc（前端）+ `tsc -p tsconfig.worker.json`（worker）——改完務必跑 |
| `npm test` | Vitest 引擎單元測試（單測：`npx vitest run -t "確定性"`，`-t` 比對中文 describe/it 名） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run balance` | 平衡分析（`vitest.balance.config.ts`）：四類型互打數千場，輸出勝率/勝負原因/猜拳矩陣——動數值後必跑 |
| `npm run deploy:ci` | 正式環境 D1 migrations + deploy（Cloudflare Git 部署的「部署命令」用它；新 migration 推上即自動套用） |
| `npm run deploy` | build + `wrangler deploy`（本機手動部署用） |
| `npm run cf-typegen` | `wrangler types` → 重新產生 `worker-configuration.d.ts`（改 `wrangler.jsonc` 後要跑） |
| `npm run db:migrate` | 本地 D1 套用 migrations（**dev server 跑著時不要執行**，兩個 miniflare 開同一 SQLite 會 WAL 不同步） |
| `npm run db:migrate:remote` | 正式 D1 套用 migrations |

慣例流程：改物理引擎或屬性/場地數值 → `npm run typecheck` → `npm test` → 動到平衡時再 `npm run balance`。

## 文件索引

| 文件 | 內容 |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系統架構：確定性批次模擬、Battle Room / Lobby DO、D1 schema、重跑包協定、前後端共用模組邊界 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 開發指南：本地環境、目錄結構、雙資料源後台、踩雷清單、貢獻流程 |
| [FEATURES.md](./FEATURES.md) | 功能說明：對戰流程、雙資源戰鬥模型、必殺技、場地、計分規則、UI 風格 |
| [TESTING.md](./TESTING.md) | 測試：引擎單元測試、平衡分析工具、BOT/大廳測試腳本 |
| [CHANGELOG.md](./CHANGELOG.md) | 變更紀錄與分階段進度（P1 骨架 → P5 大廳/戰績） |

> 想深入單一主題前，最佳事實來源是根目錄的 **`CLAUDE.md`**（最完整、最即時的開發約定與校準數值），再深讀對應原始碼。

## 部署

採 **Cloudflare Git 自動部署**：推上 git 後，Cloudflare 以 `npm run deploy:ci` 作為部署命令——先對正式 D1 套用 `migrations/` 內的新 migration（推上去即自動套用），再 `wrangler deploy`。

部署前須以 `wrangler secret put` 在正式環境設定三個 secret（`wrangler deploy` 不會上傳 `.env`），漏打時 `/api/auth/*` 會回 503 並在 log 指名缺哪個：

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

Worker 名稱 `beyblade-battle-field`，正式 D1 同名（`wrangler.jsonc`）；正式環境 OAuth 重新導向 URI 須對應正式網域的 `/api/auth/callback`。
