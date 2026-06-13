# 開發規範（DEVELOPMENT）

本文件是 beyblade-arena 的開發者守則：**確定性鐵則、命名規則、模組系統、環境變數、新增功能的逐項流程、UI 慣例、凍結鎖機制、計畫歸檔流程**。
寫程式前請先讀 `CLAUDE.md`（最權威的架構與雷區事實來源）+ 本文件。所有溝通與文件一律**繁體中文**。

---

## 0. 黃金規則速查（最常踩的雷）

| 規則 | 為什麼 |
| --- | --- |
| **`npm run build` 不做型別檢查** | build 只打包；型別要另跑 `npm run typecheck`（vue-tsc 前端 + tsc worker 兩套） |
| **`src/physics` 與 `src/game` 禁瀏覽器 API** | 引擎/共用協定要能跑在 Durable Object；`tsconfig.worker.json` 連這些目錄一起檢查（lib 只有 ESNext、無 DOM） |
| **worker 被單元測試 import 的模組要零 `Env` 全域型別相依** | root tsconfig 沒有 Workers runtime 型別，測試 import 到 `Env` 會編不過 |
| **改 `STAT_PRESETS`/`DEFAULT_ARENA`/`HP_BASE`/`DEFAULT_SPECIAL` 後一定 `npm run balance`** | 平衡是「場地 × 屬性」共同決定，數值牽一髮動全身 |
| **改數值後要寫對應 migration 清 D1 `global_config`** | D1 blob 會蓋過程式碼預設，不清＝正式站讀到舊值 |
| **名冊/名池有 checksum 凍結鎖，只准原位替換** | id/name 存 DB 與線上協定，重排/增刪會洗牌全服資料 |
| **全站渲染字串零 emoji，圖示走 `BbIcon.vue`** | 設計系統一致性（BURST FORGE） |
| **`.env` 與 `.dev.vars` 不可並存** | `.dev.vars` 存在時 wrangler 會整個忽略 `.env` |

慣用順序：改引擎/屬性/場地 → `npm run typecheck` → `npm test` → 動到平衡再 `npm run balance`。

---

## 1. 確定性鐵則（最高優先級）

整個遊戲的安全與一致性都建立在「**伺服器一次算完整場、廣播輕量重跑包、兩端用同一份純函式引擎重跑、前端只回放**」之上。要維護這個性質：

### 1.1 `src/physics`（引擎）與 `src/game`（共用協定）禁用瀏覽器 / Cloudflare 相依

- **禁止**：`window`、`document`、`localStorage`、`fetch`、`crypto`（除非確認在 Worker runtime 也有）、`Date.now()` / `performance.now()`（時鐘）、`Math.random()`（亂數）出現在**影響模擬結果的程式路徑**。
- **亂數一律走 `src/physics/prng.ts` 的 seeded PRNG**：同 seed + 同輸入 → 完全一致的 `frames[]`。seed 由 Battle Room DO 在雙方提交瞄準後才產生（防離線暴搜發射參數）。
- **時間一律走固定時間步 1/60s**：`simulate` 內不可讀牆鐘。
- 唯一例外：**純呈現層**（`src/audio/sfx.ts`、回放特效、傷害數字抖動）與模擬結果無關 → 可用 `Math.random()`。

> 為什麼能省掉跨平台浮點數一致性問題：因為兩端跑的是「同一份 JS 引擎 + 同 seed + 同輸入」，輸出位元級一致；DO 與瀏覽器都是 V8，沒有 C++/不同語言重算的浮點漂移風險。

### 1.2 `tsconfig.worker.json` 是這條鐵則的自動哨兵

```jsonc
// tsconfig.worker.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ESNext"], "types": [] }, // 無 DOM、無 vite/client
  "include": ["worker", "worker-configuration.d.ts", "src/physics"]
}
```

- `include` 涵蓋 `worker` 與 `src/physics`（注意：`src/game` 透過 worker 的 import 鏈一起被檢查）。
- 一旦 `src/physics`／`src/game` 混入 DOM 型別（如 `HTMLElement`、`window`），`npm run typecheck` 的 worker 那輪會直接擋下。
- **這就是把「引擎不可碰瀏覽器」做成編譯期保證的機制**——別把 worker tsconfig 的 `lib` 加回 `DOM`。

### 1.3 改了會影響確定性的東西，務必確認

- 引擎裡新增的隨機行為 → 必須消耗 PRNG（即使「沒中」也要消耗固定次數的 rng，否則調機率會位移整條 rng 流；參考會心 crit「每碰撞固定消耗 4 次 rng」的設計）。
- 改引擎後跑 `npm test`（`test/engine.test.ts` 有確定性測試：`npx vitest run -t "確定性"`）。

---

## 2. 命名規則對照表

| 種類 | 規則 | 範例 |
| --- | --- | --- |
| **Vue 元件檔** | PascalCase `.vue` | `BattleViz.vue`、`ArenaSvg.vue`、`BbIcon.vue` |
| **頁面 View** | PascalCase + `View` 後綴，放 `src/views/` | `LobbyView.vue`、`SettingsView.vue`、`BattleRoomView.vue` |
| **可重用元件** | PascalCase，放 `src/components/`；UI 原子放 `src/components/ui/` | `BeyPicker.vue`、`ui/RadarHex.vue` |
| **Composable** | `useXxx.ts`，`export function useXxx()`，放 `src/composables/` | `useBattle.ts`、`useOnlineBattle.ts`、`useLobby.ts` |
| **Store（狀態模組）** | `xxxStore.ts`，放 `src/store/`；具名 export（非 Pinia，是純模組 + Vue `reactive`/`ref`） | `arenaStore.ts`、`statStore.ts`、`authStore.ts` |
| **純共用模組** | camelCase `.ts`，放 `src/game/`（零 Env/DOM，前後端共用） | `room.ts`、`scoring.ts`、`beyblades.ts`、`names.ts` |
| **引擎模組** | camelCase `.ts`，放 `src/physics/` | `engine.ts`、`arena.ts`、`prng.ts`、`presets.ts` |
| **Worker 模組** | camelCase `.ts`，放 `worker/`；DO 用 `xxxDO.ts` | `index.ts`、`api.ts`、`auth.ts`、`battleRoomDO.ts`、`lobbyDO.ts` |
| **TS 型別 / 介面** | PascalCase（`interface`/`type`），不加 `I` 前綴 | `ArenaConfig`、`BeybladeStats`、`SimResult`、`PlayerLoadout` |
| **聯集字面量型別** | PascalCase 型別、值用小寫 kebab/單字 | `SpecialKind = "rush" \| "blast" \| ...`、`WinReason = "ring-out" \| "ko" \| ...` |
| **常數（模組級）** | UPPER_SNAKE_CASE | `DEFAULT_SPECIAL`、`STAT_PRESETS`、`HP_BASE`、`SESSION_TTL_SECONDS`、`BOT_UID` |
| **陀螺 id（DB/協定）** | kebab-case，**永不可變** | `scarlet-blaze-wheel`、`abyss-heavy-armor` |
| **必殺技識別子** | 小寫單字 | `rush` / `blast` / `dash` / `vortex` / `clone`（`""` ＝未裝備） |
| **D1 表名 / 欄位** | snake_case | `user_settings`、`global_config`、`a_uid`、`winner_side` |
| **D1 全域設定 key** | 小寫單字（`CONFIG_KEYS`） | `arena` / `stats` / `special` / `beys` |
| **migration 檔** | `NNNN_<描述>.sql`（四位序號、底線、英文描述） | `0005_lineup.sql`、`0006_rebalance_duration.sql` |
| **API 路由** | `/api/<域>/<資源>`，kebab/小寫 | `/api/me/matches`、`/api/admin/config/:key`、`/api/room/:code/ws` |
| **BbIcon 圖示名** | kebab-case（`ICONS` map 的 key） | `door-open`、`arrow-repeat`、`volume-up` |
| **CSS 共用 class** | `f-` 前綴（forge 元件）或語意 class | `.f-btn`、`.f-input`、`.f-select`、`.plate`、`.hazard`、`.seg` |
| **localStorage key** | `bb-` 前綴 | `bb-sfx-picks`、`bb-bgm-on` |

---

## 3. 模組系統（ESM、共用模組的「零 Env」契約）

- 全專案 **ESM**（`package.json` 的 `"type": "module"`）；import 用相對路徑（無 path alias）。
- **worker 與前端共用的純模組必須零 `Env` 全域型別相依、零 DOM**，因為它們會被：
  1. 前端（瀏覽器）import；
  2. worker（Workers runtime）import；
  3. **單元測試 import**（root tsconfig 用 node 環境，沒有 Workers runtime 全域型別如 `Env`/`DurableObjectState`，也沒掛 `@cloudflare/vite-plugin`）。

  只要這類模組碰到 `Env`，第 3 點就編不過。

| 共用純模組 | 角色 | 鐵則 |
| --- | --- | --- |
| `worker/session.ts` | session cookie 簽名/驗證（HMAC-SHA256，WebCrypto） | 零 `Env`（傳入 `secret: string`，不讀 `env`） |
| `worker/jwt.ts` | Google id_token payload 解碼 | 零 `Env`；**不可 `JSON.parse(atob(...))`**——中文姓名會無聲亂碼，要 `b64urlDecode` → `TextDecoder` |
| `src/game/names.ts` | 中二暱稱/陀螺名（uid 穩定 hash） | 零 Env/DOM，前後端一致；**名池凍結鎖** |
| `src/game/beyblades.ts` | 固定角色名冊（10 顆 `BeyDef`） | 零 Env/DOM；**id/name 凍結鎖** |
| `src/game/room.ts` | 線上協定 + 純函式（`AimInput`/`Loadout`/`sanitizeAim`/`buildInitFromAim`/`genRoomCode`/`sideSpinDir`） | 零 Env/DOM；DO 與前端同一份 |
| `src/game/scoring.ts` | 計分（前端與 DO 共用） | 零 Env/DOM |
| `src/game/specialDesc.ts` | 必殺技顯示名/描述 | 零 Env/DOM |
| `src/physics/*` | 確定性引擎 | 零 Env/DOM（見第 1 節） |

- 反例：**讀寫 D1/R2/DO 的程式只能放在 `worker/index.ts`、`worker/api.ts`、`worker/*DO.ts`**（這些可以用 `Env`，因為不會被單元測試直接 import）。
- worker 的 `Env` 型別由 `npm run cf-typegen`（= `wrangler types`）從 `wrangler.jsonc` 產生 `worker-configuration.d.ts`——**改了 `wrangler.jsonc` 的 bindings/vars 要重跑**。

---

## 4. 環境變數

三個 secret + 一個非秘密 var。本地放 `.env`（已 gitignore），部署用 `wrangler secret put`（`wrangler deploy` **不會**上傳 `.env`）。

| 變數 | 用途 | 必要性 | 本地（`.env`） | 部署 |
| --- | --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth client id（`auth.ts` 換 token / 驗 `aud`） | 登入必要 | ✅ 填 | `wrangler secret put GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | 登入必要 | ✅ 填 | `wrangler secret put GOOGLE_CLIENT_SECRET` |
| `SESSION_SECRET` | session cookie HMAC 簽名密鑰（`openssl rand -hex 32`） | 登入必要 | ✅ 填 | `wrangler secret put SESSION_SECRET` |
| `ADMIN_EMAILS` | 後台權限名單（Google email，逗號分隔、不分大小寫） | 後台必要 | 已在 `wrangler.jsonc` 的 `vars`（本地 `.env` 可覆寫） | 改 `wrangler.jsonc` 的 `vars` 或設 secret |
| `VITE_*` | 前端（瀏覽器）可見變數 | 目前無 | — | — |

雷區：

- **不要另建 `.dev.vars`**：它存在時 wrangler 會整個忽略 `.env`（`.gitignore` 已封掉 `.dev.vars*`，但別自己加）。
- 三個 secret 任一缺漏：`/api/auth/*` 會早爆回 **503 `server_misconfigured`** 並在 log 指名缺哪個（`worker/index.ts`）——不會讓使用者走完 Google 流程才在最後一步炸掉。
- `redirect_uri` 由「目前 origin + `/api/auth/callback`」推導 → **localhost 與正式站都要在 Google Console 登錄重新導向 URI**（`http://localhost:5173/api/auth/callback` + 正式網域）。
- OAuth callback 是整頁導航：**所有失敗一律 302 回 `/login?error=<code>`**，不可回裸 JSON（使用者會卡死路）。

---

## 5. 新增功能逐項流程

### 5.1 新增 API 路由

1. 路由分派在 `worker/index.ts` 的 `fetch()`——依「認證 → 全域設定 → 大廳 → 對戰房 → 戰績 → 管理員 → 404」順序加分支。先比對 path/method，後做事。
2. 需登入的路由：`const session = await getSession(request, env.SESSION_SECRET); if (!session) return 401;`
3. 需管理員：放在 `/api/admin/*` 區塊（已有統一閘門 `isAdminEmail(session.email, env)` → 403）。**前端隱藏入口只是 UX，真閘門在這裡。**
4. handler 實作放 `worker/api.ts`（不直接寫進 index）；回傳一律 `Response.json(...)`。
5. 未匹配的 `/api/*` 落到尾端 404；非 `/api` 由 `run_worker_first` 不涵蓋 → 走 SPA fallback。
6. 改完 `npm run typecheck`（worker 那輪會檢查）。

### 5.2 新增 D1 migration

1. 在 `migrations/` 新增 `NNNN_<描述>.sql`（序號接續，目前到 `0006`）。
2. 用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN`（可重入）。
3. **加欄位設可選 / 給 DEFAULT**（與 D1 blob「可選欄位 + 合併預設」慣例一致；舊資料缺欄不可炸）。
4. **若改了平衡數值（程式碼預設）**：加一條 `DELETE FROM global_config WHERE key IN ('arena','stats','special');` 清掉舊 blob（D1 會蓋過程式碼預設）。`beys`（個體覆寫）為差異值、疊在新基礎上仍合理 → 不要清。參考 `0004` / `0006`。
5. 本地套用：`npm run db:migrate`（= apply `--local`）。**dev server 跑著時不要跑**（兩個 miniflare 開同一 SQLite，WAL 不同步）。
6. 正式：推上去後 Cloudflare Git 部署跑 `npm run deploy:ci`（內含 `d1 migrations apply --remote`）自動套用；或手動 `npm run db:migrate:remote`。

現有表：`users`（0001）、`global_config` + `user_settings`（0002）、`matches`（0003）；`user_settings.lineup`（0005）。

### 5.3 新增陀螺（roster）

1. 在 `src/game/beyblades.ts` 的 `BEYBLADES` 陣列**追加**一筆 `BeyDef`（`id`/`name`/`type`/`mods`/`crit`/`specialPower`）。
   - `id` kebab-case、**永不可變**（DB lineup 與線上協定引用）。
   - `mods` 0.92~1.08（1~2 個欄位偏移）、`crit` 0.03~0.08、`specialPower` 0.9~1.2；**不可有全維度優勢顆**（`test/beyblades.test.ts` 會驗 contract 範圍與「全正向 mods 必須 crit 或 specialPower 有取捨」）。
2. **更新凍結鎖 checksum**（見第 7 節）：`test/beyblades.test.ts` 鎖了條目數（目前 10）與 `id:name` 的 fnv1a checksum（`132f762a`）。追加後重算並更新測試裡的數字。
3. **追加是安全的**（不改既有順序）；**改既有 id/name 只准原位替換**並接受該 id 對應玩家的資料影響。
4. 數值改平衡 → `npm run balance`（必殺裝備偏移看 `test/balance-special.bench.ts`）。

### 5.4 新增場地

1. 在 `src/physics/engine.ts` 定義一個 `ArenaConfig` 常數（參考 `XTREME_STADIUM` / `ARC_WALL_STADIUM`）。
   - **新欄位設成可選**（如 `hpBase?`、`spinKnockback?`、`superellipse?`）：舊 localStorage 場地沒這些欄位，引擎用 `?? 預設` 處理；否則測試的 `neutralArena()` 也要補。
   - 注意 `arena.collisionSpinLoss` **名實不符**：它現在是「碰撞扣血量」係數（語意改過、沒改名）。
   - 形狀邊界（如超橢圓）走 `src/physics/arena.ts` 的 `boundaryRadiusAt`/`sampleBoundary` → **引擎與 `ArenaSvg.vue` 共用同一份**（畫面物理同源）。
2. 加進預設池：`worker/api.ts` 的 `defaultConfigValue("arena")` 的 `presets` 陣列（給 `id`/`name`/`config`，內建場地加 `builtin: true`）。本地後台預設池在 `src/store/arenaStore.ts` 的 `BUILTINS`。
3. 顯示名**去 IP**：「Beyblade」「Xtreme」不得出現在任何使用者可見字串（程式識別子可保留為相容）。
4. 線上隨機池：管理員在 `/admin/arena` 勾選 `enabledIds`（DO 每場 match 抽一座）。改 `activeId` 預設要維持 `builtin-xtreme`（清 blob 後回落到它，否則正式站默默換場）。
5. `npm run balance`（平衡是「場地 × 屬性」共同決定）。

### 5.5 新增必殺技

1. 加到聯集型別 `SpecialKind`（`src/physics/types.ts`）：`"rush" | "blast" | ... | "你的新招"`。
2. 在 `SpecialConfig`（`types.ts`）加該招的數值欄位（機率/範圍/冷卻/次數/傷害…），並在 `engine.ts` 的 `DEFAULT_SPECIAL` 給預設值。**加開場緩衝欄位 `<招>GraceTime`**（預設 3s，`t < grace` 不觸發）。
3. 在引擎實作觸發邏輯（`applySpecials`，或像 blast 那樣在 `resolveCollisions` 內）：**記得從 PRNG 取亂數、消耗固定次數**（即使沒中），並 push `specialEvents`（前端特效用）；要回血/扣血等帶資料的欄位放進 `SpecialEvent`。
4. 文案：`src/game/specialDesc.ts` 的 `SPECIAL_DESCS` + `SPECIAL_ORDER`。
5. 協定白名單：`src/game/room.ts` 的 `randomBotLoadout`、`worker/api.ts` 的 `SPECIALS` 陣列（個人設定/lineup 消毒）都要加上新 key。
6. 後台 UI：`src/components/SpecialAdmin.vue`（必殺技後台 `/admin/special`）。
7. 音效槽位：`src/audio/sfx.ts` 的 `SAMPLE_MAP` + `SAMPLE_GAIN` 加 `special-<招>`（取樣缺檔自動回退合成）。
8. **必殺不影響基礎平衡**（平衡工具不裝必殺技），但要驗裝技偏移：`npm run balance`（`test/balance-special.bench.ts`）。設計慣例：**裝技明顯強於不裝**。

### 5.6 新增 BbIcon 圖示

1. 在 `src/components/ui/BbIcon.vue` 的 `ICONS` map 加一筆（key = kebab-case 名）。
2. viewBox 固定 `0 0 16 16`；線稿用共用屬性 `S`（`stroke="currentColor"` width 1.5 圓端點），實心圖示吃 svg 根的 `fill="currentColor"`。
3. 用法：`<BbIcon name="你的圖示" :size="16" />`（`currentColor` 上色）。
4. **缺圖示就加進這裡，不要回頭用 emoji**（全站零 emoji）。

### 5.7 新增音效

合成音效（預設）：直接在 `src/audio/sfx.ts` 加合成函式。調音色先去試聽室 `public/sfx-lab.html` A/B 定案，再把參數搬回 `sfx.ts`。

取樣音效（opus → wav → R2 → SAMPLE_MAP）：

1. 把 CC0/CC 素材放 `public/sfx-test/<槽位>/`（gitignored）。
2. 轉檔（Safari `decodeAudioData` 不吃 ogg/opus）：`ffmpeg -i in.opus -ar 44100 -sample_fmt s16 <key>.wav`。命名約定見 `scripts/upload-sfx.sh`（如 `hit-h-0.wav`、`special-rush-0.wav`）。
3. 上傳 R2：`./scripts/upload-sfx.sh <wav資料夾>`（`--local` 進本地 miniflare，dev server 要先停）。
4. 在 `sfx.ts` 的 `SAMPLE_MAP` 把「槽位 → R2 key 清單」對上（多檔 round-robin），`SAMPLE_GAIN` 調逐槽音量。
5. worker 路由 `/api/sfx/:key`（`worker/index.ts`，bucket binding `SFX`）已開（含 Range，BGM mp3 用）；**改音色＝換新檔名**（路由 immutable 長快取，同名覆蓋不更新）。
6. 任何取樣未載入 → 自動回退合成版（離線/本地沒檔也有聲）。
7. 試聽/選樣室 `public/sfx-pick.html` 逐槽試聽，選擇存 localStorage `bb-sfx-picks`。
8. BGM 走 `src/audio/bgm.ts`（HTMLAudioElement 串流，track 在 `TRACKS`，檔在 R2 `bgm-N.mp3`）。

> 取樣管線目前**保留但未啟用**（使用者否決取樣路線，留作未來混血選項）；改音效目前以合成為主。

---

## 6. UI 慣例（BURST FORGE 金屬鍛造）

設計系統在 `src/styles/forge.css`。

- **Tokens（CSS 變數）**：沿用舊變數名 —— `--accent`（琥珀 #ffb31f）、`--lava`、`--red`（#e8442e）、`--blue`（#2e9fe8）、`--ok`、`--bg`/`--panel`/`--line`/`--text`/`--muted`/`--steel`；字型 `--f-d`（Big Shoulders Display 顯示字）/`--f-b`（Noto Sans TC 內文，index.html 載入）。
- **共用 class**：`.plate`（切角金屬面板，`.plate--flush` 無內距、`.plate--rivets` 鉚釘）、`.f-btn`（機台鍵，`--primary`/`--danger`/`--ghost` 變體）、`.f-input`、`.f-select`（用 `<span class="f-select">` 包原生 `<select>`）、`.f-badge`（`--red/--blue/--ok/--amber`）、`.seg`（segmented control，active 加 `.on` 或 `aria-pressed="true"`）、`.hazard`（黃黑警示斜紋帶）、`.f-label`（小節標）。
- **零 emoji**：全站渲染字串不得有 emoji；圖示一律 `BbIcon.vue` inline SVG（見 5.6）。
- **`.plate` / `.f-btn` clip-path 雷**：`clip-path` 切角會吃掉 `box-shadow` → **外陰影/鍵帽厚度一律走 `filter: drop-shadow()`**（內陰影用 `box-shadow: inset` 沒問題）。
- **行動版**：底部 Tab Bar = 大廳 / 陀螺(roster) / 個人設定（room/test 路由整條隱藏、room 連 header 都隱藏求沉浸，`src/App.vue` 的 `hideTabbar`/`immersiveRoom`）；登出鍵只在個人設定頁（防誤觸）；對戰中離開有 confirm + beforeunload 攔截；測試頁與後台入口**僅 admin 渲染**。
- **場地震動是容器級**：`useBattle` 的 `shakeEl` ref 綁場地容器 div，直接 DOM transform（振幅以顯示像素標定）——別用 `ctx.translate` 只震 canvas 層（SVG 底圖不會跟著動）。
- **降低動態**：`@media (prefers-reduced-motion)` 已關裝飾動畫；遊戲 canvas/rAF 不受影響。

---

## 7. 凍結鎖機制（names / beyblades checksum）

`autoNickname(uid)` / `beybladeName(uid,type)` 用「**hash % 池長**」選名 → 任何**插入 / 刪除 / 重排**都會讓全服名字洗牌；`BeyDef.id` 存 DB lineup 與線上協定，重排同樣讓既有玩家陣容錯亂。為防這種無聲災難，兩處都有 checksum 凍結鎖：

| 鎖 | 測試檔 | 鎖了什麼 | 目前值 |
| --- | --- | --- | --- |
| 暱稱池 / 陀螺名池 | `test/names.test.ts` | `NICKNAME_POOL`(116) / `BEYBLADE_POOL`(66) 長度 + fnv1a 內容 checksum | nickname `12b004d0`、beyblade `ff147126` |
| 角色名冊 | `test/beyblades.test.ts` | `BEYBLADES` 條目數(10) + `id:name` fnv1a checksum | `132f762a` |

**修改守則**：

- 名字/角色名 **只准「原位替換」單一條目**（順序與長度不變），改完重算 checksum 並更新測試裡的常數——這個動作逼你「有意識地」接受該 hash 槽對應使用者的名字會變。
- **嚴禁** 調整順序或長度（除了 roster 的「**追加新顆到尾端**」——這不改既有 hash，但仍會改條目數與 checksum，記得更新）。
- 角色名冊的 `mods`/`crit`/`specialPower` **數值可調、不入鎖**（只鎖 id/name）。
- 失敗訊息會直接告訴你「checksum 不對」——這是設計，不是要你硬改測試繞過。

---

## 8. 雙資料源後台（D1 線上 / localStorage 測試頁）

同一份後台 UI，兩種儲存後端，抽象在 `src/store/adminBackend.ts`：

- **local**：`localStorage`（測試頁 `/test/*` 對戰實際吃的那份，沿用既有 `arenaStore`/`statStore`/`specialStore`）→ `localArenaApi` / `localTuningApi`。
- **remote**：D1 全域設定（線上對戰用，透過 `/api/config` 讀、`/api/admin/config/:key` 寫）→ `createRemoteArenaApi()` / `createRemoteTuningApi()`。

後台元件（`ArenaAdmin.vue`/`BeybladeAdmin.vue`/`SpecialAdmin.vue`）以 props 注入這兩種 API 之一，後台頁有「🌐 線上(D1) / 💻 本機(localStorage)」切換。

遠端寫入的三道防線（**改後台儲存邏輯必讀**）：

1. **arena 整包 PUT 走 promise queue 依序送出**：並行 PUT 到達順序不保證 → 舊快照可能蓋掉新狀態。queue 在排到那一刻才 snapshot 最新狀態（連續操作自然合併成最終狀態）。
2. **寫失敗自動 `reload()`**：從伺服器重新載入，讓 UI 與 D1 回到一致（樂觀更新不留分歧）。
3. **tuning 的 600ms debounce 有 `flush()`**：滑桿 `@input` 連發不能每下打 API；view 卸載 / `pagehide` 時 flush 送出（`fetch` 帶 `keepalive` 撐過整頁卸載）。

讀取側慣例：**遠端 stats/beys 載入要鋪程式碼預設底再蓋 D1 值**（`STAT_PRESETS` / 名冊預設），否則 D1 blob 缺欄位會讓 UI render crash（「可選欄位 + 合併預設」慣例）。寫入側有輕量 shape 驗證（`worker/api.ts` 的 `isValidConfigValue`）+ `applyBeyOverrides` 夾制（防 D1 壞值打爆平衡）。

> 通則：**不要靠「升 localStorage 版本鍵」來套用新預設**（會讓使用者既有資料讀不到）；一律用「可選欄位 + 合併預設」。

---

## 9. 建置與測試設定（刻意分離）

- **`build` 不做型別檢查**：`npm run build` 只 `vite build`。型別要 `npm run typecheck`（= `vue-tsc --noEmit`（前端，含 DOM）+ `tsc -p tsconfig.worker.json`（worker，無 DOM））。**改完務必兩套都跑。**
- **vitest 與 vite 設定刻意分離**：
  - `vite.config.ts` 掛 `@cloudflare/vite-plugin`（dev/build 用，啟動 Worker runtime）。
  - `vitest.config.ts` **不含** 該 plugin（測試不需要 Worker runtime，避免測試啟動它）；環境 `node`、跑 `test/**/*.test.ts`。
  - `vitest.balance.config.ts` 是平衡專用（`npm run balance` 跑 `*.bench.ts`，`fileParallelism: false` 讓 console 不交錯），**不混進一般 `npm test`**。
  - 改 vite 設定時，三邊都要想到。
- 跑單一測試：`npx vitest run -t "確定性"`（`-t` 比對 describe/it 名稱，名稱是中文）。
- `tsconfig.json` 開了 `strict`、`noUnusedLocals`、`noUnusedParameters`、`isolatedModules`——未用變數/參數會直接編不過。

---

## 10. 計畫歸檔流程

開發計畫文件放 `docs/plans/`（流程定義見 `docs/plans/README.md`）：

1. **檔名**：`YYYY-MM-DD-<feature-name>.md`（如 `2026-06-10-multiplayer-online.md`）。
2. **結構**：**User Story → Spec → Tasks**（先寫使用者故事，再寫規格，最後拆任務）。
3. **進行中** 的計畫留在 `docs/plans/`。
4. **功能完成後**：
   - 把計畫檔移到 `docs/plans/archive/`。
   - 更新 `docs/FEATURES.md`（功能清單現況）。
   - 更新 `docs/CHANGELOG.md`（變更紀錄）。

（`docs/README.md` 是專案總覽，提供技術棧表與快速開始。）

---

## 11. Git 流程

- remote `origin` = `git@github.com:Wcc723/beyblade-battle-field.git`，預設分支 `main`。
- 慣例：每個 Phase 完成、取得授權後直推 `main`。
- 提交/推送前若涉及程式變更：先 `npm run typecheck` → `npm test`（動到平衡再 `npm run balance`）。
</content>
</invoke>
