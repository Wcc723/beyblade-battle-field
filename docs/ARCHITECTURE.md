# 架構總覽（ARCHITECTURE）

網頁版雙人線上對戰戰鬥陀螺。全端 **Vite + Vue 3 + TypeScript + Cloudflare Workers / Durable Objects / D1 / R2**，單一 repo、單一 Worker 同時供應靜態前端與 `/api/*`。

本文件涵蓋：目錄結構、確定性批次模擬架構、啟動與部署、Worker API 路由、WebSocket 協定、兩個 Durable Object（Battle Room / Lobby）狀態機、認證機制、D1 schema、雙資源戰鬥模型、計分賽制、場地隨機池、名冊概要。

> 對戰玩法的細節（必殺技數值、回放特效、UI 風格、平衡校準）請看 `CLAUDE.md` 與 docs/FEATURES。本文件聚焦「跨模組整合時必須知道的事」。

---

## 1. 一句話心智模型

**伺服器（Durable Object）只在收齊雙方瞄準輸入後算一次完整對戰，廣播一個 ~2KB 的「重跑包」（inits + seed + config），前端與 DO 各自用同一份純函式引擎重跑出逐位元相同的軌跡。對戰過程中沒有任何玩家輸入——發射參數定生死。**

這個決策連帶決定了一切：
- 引擎 `simulate()` 必須是**純函式、零瀏覽器/Cloudflare 相依**（同一份碼跑在瀏覽器與 DO）。
- 必須**確定性**（seeded PRNG + 固定時間步）→ 兩端重跑結果一致 → 不需要傳 1.5MB frames，也**沒有跨平台浮點數一致性問題**（只有一端「決定」seed，兩端「重播」同一份計算）。
- client 只送瞄準輸入（落點/方向/力道），**陀螺數值由伺服器組裝**（防竄改）。

---

## 2. 目錄結構

### 前端 `src/`

| 路徑 | 用途 |
| --- | --- |
| `src/main.ts` | 應用進入點（掛 router、載入 `styles/forge.css`）。 |
| `src/App.vue` | 根元件（外殼 + 行動版底部 Tab Bar）。 |
| `src/router.ts` | vue-router 路由表 + `beforeEach` 登入/管理員守衛。 |
| **`src/physics/`** | **物理引擎（純函式、零相依，前端與 DO 共用）。** |
| `physics/engine.ts` | `simulate()` 主迴圈 + 所有預設常數（`DEFAULT_ARENA`/`XTREME_STADIUM`/`ARC_WALL_STADIUM`/`DEFAULT_SPECIAL`/`HP_BASE`/平衡係數）。 |
| `physics/types.ts` | 所有引擎型別（`ArenaConfig`/`BeybladeInit`/`BeybladeStats`/`SimConfig`/`SimResult`/`Frame`/`SpecialConfig`/各種事件）。 |
| `physics/arena.ts` | 場地幾何查詢層（rim 分區、M 形軟牆 `softWall*`、超橢圓邊界 `boundaryRadiusAt`/`boundaryNormalAt`）——引擎與 ArenaSvg 共用 → 畫面物理同源。 |
| `physics/presets.ts` | 四類型屬性預設 `STAT_PRESETS`（attack/defense/stamina/balance）。**刀口參數**，動了必跑 `npm run balance`。 |
| `physics/prng.ts` | mulberry32 seeded PRNG（`makeRng(seed)`）。 |
| **`src/game/`** | **遊戲規則層（零 Env、零 DOM——前端 / DO / 單元測試三方共用）。** |
| `game/room.ts` | 線上對戰協定型別（`ClientMsg`/`ServerMsg`/`AimInput`/`RoundPayload`/`RoomSnapshot`…）+ 純函式（`sanitizeAim`/`buildInitFromAim`/`defaultAim`/`mergeLoadout`/`sideSpinDir`/`genRoomCode`/BOT 隨機產生器）。 |
| `game/scoring.ts` | 計分賽制 `roundPoints()` + `WIN_SCORE`（前端結算顯示 + DO 權威計分共用）。 |
| `game/beyblades.ts` | 陀螺名冊 `BEYBLADES`（固定 roster、id/name 凍結鎖）+ `getBey`/`resolveBeyStats`/`DEFAULT_LINEUP`。 |
| `game/names.ts` | 中二暱稱/陀螺名系統（`autoNickname(uid)`/`beybladeName(uid,type)`，穩定 hash，**名池凍結 checksum 鎖**）。 |
| `game/specialDesc.ts` | 必殺技的文案/描述（UI 顯示用）。 |
| **`src/composables/`** | **Vue composable（對戰邏輯與 WS 客戶端）。** |
| `composables/useBattle.ts` | 對戰核心（發射手感、`runServerSimulation()` 本機邊界、回放 tick 迴圈、整套 canvas 繪製/特效/計分）。線上模式經 `onLaunchSubmit` 攔截、`playRemoteRound()` 收重跑包。 |
| `composables/useOnlineBattle.ts` | Battle Room WS 客戶端（連 `/api/room/:code/ws`，房間狀態 → useBattle、發射/換配置/下一回合/關房/重賽）。 |
| `composables/useLobby.ts` | Lobby WS 客戶端（線上人數 / 快速配對 / 公開房列表）。 |
| **`src/components/`** | 對戰與後台元件：`BattleViz.vue`（桌面測試頁）、`MobileBattle.vue`（手機/線上基底）、`ArenaSvg.vue`（場地向量底圖，吃同一份場地資料）、`BeyPicker.vue`（選陀螺）、`Arena/Beyblade/SpecialAdmin.vue`（後台表單元件）。 |
| `src/components/ui/` | 共用 UI：`BbIcon.vue`（30 個 inline SVG，**全站圖示唯一來源，零 emoji**）、`RadarHex.vue`（六維雷達）。 |
| **`src/views/`** | 路由頁：`LobbyView`/`BattleRoomView`/`RosterView`/`SettingsView`/`LoginView` + `Arena/Beyblade/SpecialAdminView`（後台頁，雙資料源切換）。 |
| **`src/store/`** | 設定 store（介面設計成「之後可無痛換 D1/DO」）：`arenaStore`/`statStore`/`specialStore`（localStorage，測試頁用）、`authStore`（`/api/me` 登入態）、`adminBackend`（後台「線上(D1) / 本機(localStorage)」雙資料源）。 |
| `src/audio/` | `sfx.ts`（街機誇張純合成音效引擎）、`bgm.ts`（背景音樂）。 |
| `src/styles/forge.css` | 設計系統（BURST FORGE 金屬鍛造，tokens + 共用 class）。 |

### 後端 `worker/`

| 路徑 | 用途 |
| --- | --- |
| `worker/index.ts` | Worker 進入點（`fetch` handler，路由分派 `/api/*`；export 兩個 DO class）。 |
| `worker/battleRoomDO.ts` | **Battle Room Durable Object**（對戰房權威狀態機）。 |
| `worker/lobbyDO.ts` | **Lobby Durable Object**（單一全域大廳）。 |
| `worker/api.ts` | 遊戲設定 API（`/api/config`、`/api/admin/config/:key`、`/api/settings`、`/api/me/matches`）+ DO 用的 `readGameConfig`/`readLineup`/`applyBeyOverrides`。 |
| `worker/auth.ts` | Google OAuth 2.0 authorization code flow（login/callback/logout）+ `isAdminEmail`。 |
| `worker/session.ts` | HMAC-SHA256 session cookie（`signSession`/`verifySession`/`getSession`，WebCrypto、無外部依賴）。 |
| `worker/jwt.ts` | Google id_token payload 解碼（不驗簽——TLS 直連取得）。**零 `Env` 全域型別相依**（單元測試 import 得進來）。 |

### 其他

| 路徑 | 用途 |
| --- | --- |
| `migrations/` | D1 schema migrations（`0001`~`0006`，逐張表見 §10）。 |
| `test/` | vitest 單元測試（中文名）+ `balance.bench.ts`/`balance-special.bench.ts`（平衡分析，走獨立 config）。 |
| `scripts/` | `bot-player.mjs`（自動打整場的 BOT）、`lobby-test.mjs`（兩 token 排隊驗配對）、`upload-sfx.sh`（R2 音效上傳，目前未使用）。 |
| `public/` | 對戰實際用的素材 `beyblades/*.webp`、`sfx-lab.html`（音色試聽室，保留）。 |
| `wrangler.jsonc` | Cloudflare 設定（assets/SPA fallback、D1/R2/DO bindings、DO migrations）。 |
| `CLAUDE.md` | 最佳事實來源（平衡校準、雷區、慣例）。 |

---

## 3. 確定性批次模擬架構

### 3.1 `simulate(inits, config)` — 引擎核心

`src/physics/engine.ts`。一次模擬整場對戰，回傳 `SimResult`（含完整軌跡 `frames[]`、`slowmoCues`、`specialEvents`、`collisionEvents`、`deathEvents`、勝負 `winnerId`/`reason`）。

**每步固定流程（dt = 1/60s）**，依序：

1. `integrate` — 積分位移：碗面力（朝心 `centerPull` + 自旋進動 `swirl`）→ 加速軌道/軟牆頂部加速區 → 線性阻尼 `friction` → 位移 → 自旋衰減（`spinDecayBase / stamina`）→ 2.5D 垂直運動（重力下墜、落地歸零）。被擊飛越過綠牆（`z > wallHeight`）時關閉碗面力做彈道飛行。
2. `resolveCollisions` — 兩兩碰撞：位置修正消重疊 → 法線衝量 + 擊退（`knockback × oppSpinBonus`）→ **能量夾制**（分離速度 ≤ 接近速度，防超彈性暴衝）→ 碰撞扣**血量**（攻防比 + `±10% seeded 浮動` + **速度主導傷害分配** AGGRESSOR split）→ 會心擲骰 → 轉速擊退 `spinKnockback`（夾制後額外推力）→ blast 必殺（在此處）。
3. `resolveWalls` — 護牆：圓形 rim 分區 / 方形 box 四邊反彈四角出界 / 超橢圓弧壁。撞牆向外速度超過 `ringOutSpeed` 才 ring-out，否則反彈。
4. `applySpecials` — 必殺技：rush / dash / vortex / clone 的觸發與持續效果（blast 在 collisions 內）。各招獨立機率 + 冷卻 + 限次 + 開場緩衝 `*GraceTime`。
5. `checkDeaths` — 淘汰判定：`hp ≤ 0` → ko、`spin ≤ 0` → spin-out、出界 → ring-out。

**勝負鎖定**：第一次 `aliveCount ≤ 1`（分身不計）那一步用 `determineOutcome()` 鎖定結果，之後 `followThroughTime`（線上 2.5s）讓模擬多跑幾秒做收尾演出（出界陀螺飛出、勝方續轉），但**不再改變勝負**。

**同步死亡規則**（使用者裁定，見 `determineOutcome`/`overkillTieBreak`）：同一步雙 ko = 平手（靠傷害結構讓它罕見、不硬判）；雙停轉/雙出界才 tie-break（比剩餘血量 hp/maxHp = 誰較健康）；混合同步死亡維持平手。

### 3.2 重跑包（RoundPayload）

DO 端 `simulate` 時用 `sampleEvery: 100000`（不需要軌跡，只要勝負）；廣播給兩端的是 `RoundPayload`（`src/game/room.ts`）：

```ts
interface RoundPayload {
  inits: BeybladeInit[];   // 雙方初始化資料（含 stats，DO 已組裝防竄改）
  seed: number;            // 雙方提交後才產生的亂數種子
  arena: ArenaConfig;      // 本場 match 凍結的場地
  special: SpecialConfig;  // 凍結的必殺技數值
  maxTime: number; followThroughTime: number;
  outcome: RoundOutcome;   // 權威勝負/計分（前端不重算分數）
}
```

兩端各自 `simulate(inits, {seed, arena, special, sampleEvery:1, ...})` → 重建逐位元相同的 frames 來回放。前端 `useBattle.playRemoteRound()` 接收，並把 `roundScored = true` 關閉本機計分（計分權威在 DO）。

### 3.3 為何沒有跨平台浮點問題

關鍵：**只有一端做「決定性的一次計算」（DO 決定 seed、決定 outcome）**。兩端的 `simulate` 重跑只是為了「畫出動畫」；即使兩端浮點有極微差異，也**不影響勝負與計分**（那些以 DO 的 `outcome` 為準）。回放軌跡的微小差異肉眼不可見。引擎 `tsconfig.worker.json` 連 `src/physics` 一起檢查（lib 只有 ESNext、無 DOM）→ 一旦混入瀏覽器相依，typecheck 就擋下。

---

## 4. 啟動與部署

### 開發

```bash
npm run dev        # Vite dev server（含 Worker，@cloudflare/vite-plugin）→ http://localhost:5173
npm test           # vitest（引擎單元測試）
npm run balance    # 平衡分析（獨立 vitest.balance.config.ts）
npm run typecheck  # vue-tsc（前端）+ tsc -p tsconfig.worker.json（worker）；改完務必跑
npm run db:migrate # 本地 D1 migrations（⚠ 不要在 dev server 跑著時執行——兩個 miniflare 開同一 SQLite WAL 不同步）
npm run cf-typegen # 改 wrangler.jsonc 後重產 worker-configuration.d.ts
```

`vite.config.ts` 掛了 `@cloudflare/vite-plugin`（dev/build 用 Worker runtime）；測試走 `vitest.config.ts`（**刻意不含該 plugin**，避免測試啟動 worker runtime）。改 vite 設定時兩邊都要想到。**`build` 不做型別檢查**。

### 部署（Cloudflare Git 自動部署）

| 命令 | 用途 |
| --- | --- |
| `npm run build` | `vite build` → 產 `dist/client`（靜態資產）+ Worker bundle。 |
| `npm run deploy:ci` | **正式環境部署命令**：`wrangler d1 migrations apply --remote` + `wrangler deploy`。新 migration 推上去即自動套用。 |
| `npm run deploy` | 本機手動部署（`build` + `wrangler deploy`，不跑 remote migration）。 |

部署前必打三個 secret（`wrangler deploy` 不會上傳 `.env`）：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`SESSION_SECRET`。漏打時 `/api/auth/*` 回 503 並在 log 指名缺哪個。`ADMIN_EMAILS` 是非秘密 var（在 `wrangler.jsonc`）。

`wrangler.jsonc` 的 `assets`：`not_found_handling: "single-page-application"`（SPA fallback 回 index.html，配 vue-router history mode）、`run_worker_first: ["/api/*"]`（只有 `/api/*` 先進 Worker，其餘走靜態資產）。

---

## 5. Worker API 路由總覽

`worker/index.ts` 的 `fetch` handler 依序比對。認證欄位：**公開**=不需登入、**登入**=需有效 session cookie、**管理員**=還需 email 在 `ADMIN_EMAILS`。

| 路徑 | 方法 | 認證 | 說明 |
| --- | --- | --- | --- |
| `/api/health` | GET | 公開 | healthcheck（`{ok:true,service}`）。 |
| `/api/sfx/:key` | GET | 公開 | R2 音效/BGM（白名單 `[a-z0-9-]+\.(wav\|mp3)`，支援 Range；缺檔 404 前端回退合成音效）。目前未使用。 |
| `/api/auth/login` | GET | 公開 | 設 state cookie（含回跳路徑）、302 到 Google 同意畫面。 |
| `/api/auth/callback` | GET | 公開 | 驗 state、code 換 token、upsert user、發 session cookie、302 回原頁。**失敗一律 302 回 `/login?error=<code>`**。 |
| `/api/auth/logout` | POST | 公開 | 清 session cookie、302 回 `/`。 |
| `/api/me` | GET | 公開 | 回 `{user, isAdmin}`（無 session → `{user:null,isAdmin:false}`，不報錯）。 |
| `/api/config` | GET | 登入 | 全域遊戲設定（arena/stats/special/beys，給線上對戰與後台讀）。 |
| `/api/settings` | GET/PUT | 登入 | 個人設定（暱稱/預設/陣容 lineup）。 |
| `/api/me/matches` | GET | 登入 | 個人戰績（勝敗統計 + 近 20 場）。 |
| `/api/admin/config/:key` | PUT | 管理員 | 寫全域設定（`key ∈ arena\|stats\|special\|beys`，輕量 shape 驗證）。 |
| `/api/admin/ping` | GET | 管理員 | 管理員權限探測。 |
| `/api/room/create` | POST | 登入 | 產房號（`{public}` 為 true 時打 Lobby 內部介面掛公開列表）。 |
| `/api/room/:code/ws` | GET (Upgrade) | 登入 | WebSocket → Battle Room DO（`idFromName(code)`）。worker 把 session + 個人設定組成 `X-BB-User` header 轉發。 |
| `/api/lobby/ws` | GET (Upgrade) | 登入 | WebSocket → Lobby DO（`idFromName("global")`）。 |

**內部 DO ↔ DO/worker 介面**（外部進不來，無 `/api` 前綴）：Lobby 的 `POST /register-room`、`POST /room-closed`。

**WS 轉發的內部 header**（worker 驗證 session 後塞入的信任資料）：`X-BB-User`（JSON：uid/nickname/picture/loadout）、`X-BB-Bot`（`?bot=1` → "1"）、`X-BB-Room`（房號，DO 不知道自己的 `idFromName` 名字，戰績/大廳通知用）。

`/api/room/:code/ws` 的房號格式由 `ROOM_CODE_RE = /^\/api\/room\/([A-Z0-9]{6})\/ws$/` 把關（房號 6 位、`genRoomCode` 用去混淆字母表）。

---

## 6. WebSocket 協定

協定型別全在 `src/game/room.ts`（前端與 DO 共用）。所有 DO 都用 **WebSocket Hibernation**（`acceptWebSocket` + `webSocketMessage`/`webSocketClose`），並設 `setWebSocketAutoResponse(ping → pong)`：client 每 25s 送 `"ping"`，DO 不喚醒即自動回 `"pong"`（保活、省成本、斷線重連自然）。client 端 ping 有 `readyState === OPEN` 守衛（CONNECTING 時 send 會同步 throw）。

### Battle Room

```ts
// client → server
type ClientMsg =
  | { type: "loadout"; loadout: Partial<PlayerLoadout> }  // 換陀螺/必殺（發射前可改；beyId 限自己 lineup 內）
  | { type: "launch"; aim: AimInput }                      // 發射（只送瞄準：落點/方向/力道）
  | { type: "next-round" }                                 // review → 下一回合
  | { type: "rematch" }                                    // finished → 重賽
  | { type: "close-room" };                                // 房主關房（僅 A 側且 waiting）

// server → client
type ServerMsg =
  | { type: "room"; you: Side; snapshot: RoomSnapshot }    // 房間快照（逐連線送、各帶自己的 side）
  | { type: "round"; payload: RoundPayload }               // 重跑包（兩端重跑回放）
  | { type: "opponent-launched" }                          // 對手已發射（不洩漏其參數）
  | { type: "error"; code: string };
```

**安全模型**：client 的 `AimInput` 經 `sanitizeAim`（夾落點/正規化方向/夾力道）；`PlayerLoadout` 只含 `beyId`/`spinDir`/`special`，**陀螺數值由 DO 經名冊 `resolveBeyStats` + D1 全域 stats + `applyBeyOverrides` 組裝**（竄改 payload 不可能買到更強陀螺）。**seed 在雙方都提交後才 `crypto` 產生**（不能用回合號——可預測 → 離線暴搜最佳發射參數）。收齊前 `launch` 只回 `opponent-launched`，雙方 `inits` 到 `round` 訊息才一起出現。

**特殊 close code**：4001=滿房、4000=同帳號新分頁取代、4002=房主關房（三者 client 都不重連）。

### Lobby

```ts
type LobbyClientMsg = { type: "queue" } | { type: "unqueue" };
type LobbyServerMsg =
  | { type: "lobby"; online: number; queueSize: number; queued: boolean; rooms: PublicRoom[] }
  | { type: "matched"; code: string };  // 配對成功 → client 跳 /room/:code
```

---

## 7. Battle Room DO 狀態機

`worker/battleRoomDO.ts`。權威狀態存 `ctx.storage`（hibernation / DO 重啟都不丟）。`RoomPhase = waiting | aiming | review | finished`。

```
waiting  ──兩人到齊──▶  aiming  ──雙方 aim 到齊 / 45s alarm 到點──▶  runRound()
   ▲                       │                                            │
   │                       │ next-round（roundNum++）                    ├─ matchOver? ─▶ finished ──rematch──▶ aiming
   └──────────────── review ◀──────────────────────────────────────────┘（review）
```

- **startAiming**：phase→aiming、清 aims、設 `aimDeadline = now + 45s`、設 alarm。round 1 / rematch 時從**啟用場地池隨機抽一座**整場固定（`matchArena`）；凍結本回合全域設定 `roundCfg`（消毒/預設發射/模擬同基準，arena 換成 matchArena）；按陣容順序輪替出賽陀螺；BOT 在此預提交隱藏 aim。
- **runRound**：DO 端 `simulate` 算勝負 + `roundPoints` 計分 → 寫 `lastRound`（重跑包）落地 → matchOver 寫 `matches` 表（BOT 對戰不落庫）→ 廣播 `round` + 更新 snapshot。
- **內建 BOT**（開房帶 `?bot=1`）：AI 入座另一側，每回合隨機配置 + `startAiming` 時預提交隱藏 aim（零計時器、不怕 hibernation）。
- **線上旋向固定**：先手 A=右旋、後手 B=左旋（`sideSpinDir`，DO 在 join/loadout/BOT 三處強制蓋回，client 改不動）→ 每場保證反向對撞（`oppSpinBonus`）。

### 三大雷區（都踩過）

1. **`run()` 串列化**（最重要）：DO 的 input gate 只在 storage 操作時擋事件，但 handler 中 `await` D1 時 gate 是開的——兩位玩家幾乎同時發射會交錯執行「load room → …await D1… → save room」，後存把先存的 aim 蓋掉 → 比賽卡死。**所有改房間狀態的事件（fetch/message/close/alarm）一律排進 `this.serial` promise chain 依序跑。**
2. **alarm 只有一個 slot**：瞄準鬧鐘在 `runRound` 後必須 `deleteAlarm()`（否則它到點會誤觸清房檢查，把全員短暫斷線的 10 分鐘寬限縮成幾秒）；清房要驗 `idleSince` 時戳（殘留鬧鐘提早到點不可誤刪）。
3. **`RoundPayload` 落地補發**：`lastRound` 存 storage，join 時對 review/finished 階段補發（重連/錯過廣播的玩家才看得到回放與結果）。

另：每回合 `roundCfg` 凍結全域設定（管理員回合中調參不影響進行中回合）；全閒置 10 分鐘清房（`IDLE_CLEANUP_MS`）。

---

## 8. Lobby DO

`worker/lobbyDO.ts`。**單一全域 Lobby**（`idFromName("global")`），同款 `run()` 串列化 + ping/pong auto-response。職責：

- **presence**：大廳 WS 連線（hibernation），廣播線上人數（**去重 uid** ——同帳號多分頁算一人）。
- **快速配對佇列**：`queue` 訊息排隊，湊滿兩人發同一房號（`matched`，私人房不上公開列表）。
- **公開房列表**：`POST /register-room` 註冊（worker 開公開房時打）、`POST /room-closed` 下架（Battle Room 開打/清房時打）、15 分鐘 TTL + alarm 兜底。

### 佇列雷區

- **配對前必須剔除「無活連線」的幽靈 entry**（dirty disconnect / DO 重啟殘留）——不剔除真人會配到幽靈、進房空等（`tryMatch` 先 `filter(getWebSockets(uid).length > 0)`）。
- 佇列 entry 有 `since` TTL（`QUEUE_TTL_MS` 10 分鐘）；`broadcast` 內按時間 prune（只看時間、不看活性——重連 1 秒空窗不能誤踢正常排隊者），`alarm` 內按時間 + 活性雙重 prune。
- session 過期時 WS 握手 401 → client 連敗 3 次後查 `/api/me` 停止重試（否則無限打 401、UI 卡「連線中」）。

---

## 9. 認證機制

`worker/auth.ts` + `session.ts` + `jwt.ts`。

- **Google OAuth 2.0 authorization code flow**：`login` 設一次性 state cookie（夾帶登入後回跳路徑，`encodeURIComponent`）→ Google → `callback` 驗 state → code 經 TLS 直連 Google token endpoint 換 `id_token`。`redirect_uri` 一律用「目前 origin + /api/auth/callback」推導（localhost 與正式站共用同一份碼，兩個 URI 都要登錄 Google Console）。
- **id_token 只驗 payload**（iss/aud/exp/email_verified），**不驗 JWT 簽章**（因為是 TLS 直連拿到、非瀏覽器轉交）。upsert `users` 表取 `uid`。
- **Session cookie**：`bb_session = base64url(payload).base64url(HMAC-SHA256)`（WebCrypto，無外部依賴），TTL 30 天，`HttpOnly; SameSite=Lax`，https 時加 `Secure`。`getSession` 從 request 取出已驗證 session（無/壞/過期 → null）。
- **管理員**：`isAdminEmail` 比對 `ADMIN_EMAILS`（逗號分隔、不分大小寫）。`/api/admin/*` 的 **403 真閘門在 worker**，前端隱藏入口只是 UX。

### 線上化雷區（認證相關）

- 被單元測試 import 的模組（`session.ts`/`jwt.ts`）必須**零 `Env` 全域型別相依**（root tsconfig 沒有 workers runtime 型別 → 才 import 得進來）。
- OAuth callback 是整頁導航，**失敗一律 302 回 `/login?error=<code>`** 不可回裸 JSON（使用者會卡死路）。
- **JWT / 任何 base64 的 UTF-8 內容不能 `JSON.parse(atob(...))`**——`atob` 把 UTF-8 位元組當 Latin-1，中文姓名會無聲變亂碼。要先 `b64urlDecode` 成 bytes 再 `TextDecoder().decode()`（見 `jwt.ts`/`session.ts`）。
- `user_settings` 的 FK 指向 `users(id)`：session 指向已刪除的 user 時寫入會 `FOREIGN KEY` 失敗 → API 視為 session 失效回 401（不是 500）。

---

## 10. D1 Schema（逐 migration 逐表）

migrations 在 `migrations/`，正式部署由 `deploy:ci` 的 `d1 migrations apply --remote` 套用（推新 migration 即自動套）。

### 0001_users — `users`（Phase 2，OAuth 使用者）

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `id` | INTEGER | PK AUTOINCREMENT（= session.uid） |
| `google_sub` | TEXT | NOT NULL **UNIQUE**（id_token 的 sub，upsert 的衝突鍵） |
| `email` | TEXT | NOT NULL |
| `name` / `picture` | TEXT | |
| `created_at` | TEXT | DEFAULT `datetime('now')` |
| `last_login_at` | TEXT | |

索引：`idx_users_email`。

### 0002_settings — `global_config` + `user_settings`（Phase 3）

**`global_config`**（key-value JSON blob，結構與前端 localStorage 同形 → 加欄位免 migration）：

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `key` | TEXT | **PK**（`'arena'`/`'stats'`/`'special'`/`'beys'`） |
| `value` | TEXT | NOT NULL（JSON 字串） |
| `updated_at` | TEXT | DEFAULT `datetime('now')` |

> D1 無此 key 時 `GET /api/config` 回**程式碼預設值**（單一真相在 code，管理員第一次儲存才寫 D1）。**D1 blob 會蓋過程式碼預設** → 重校平衡後要清舊 blob 回落新預設（見 0004/0006）。`arena` blob 的 `activeId` 預設必須是 `builtin-xtreme`。

**`user_settings`**（1:1 users）：

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `user_id` | INTEGER | **PK** REFERENCES users(id) **ON DELETE CASCADE** |
| `nickname` | TEXT | NOT NULL DEFAULT ''（空 → `autoNickname` 補上並持久化） |
| `default_type` | TEXT | DEFAULT 'balance'（attack/defense/stamina/balance） |
| `default_spin` | TEXT | DEFAULT 'right'（right/left） |
| `default_special` | TEXT | DEFAULT ''（''/rush/blast/dash/vortex/clone） |
| `launch_mode` | TEXT | DEFAULT 'sling'（flick/sling） |
| `sfx` | INTEGER | DEFAULT 1 |
| `replay_speed` | REAL | DEFAULT 2 |
| `updated_at` | TEXT | DEFAULT `datetime('now')` |
| `lineup` | TEXT | （0005 加，JSON 陣列，可為 NULL） |

### 0003_matches — `matches`（Phase 5，戰績）

每場 finished 寫一筆（BOT 對戰不落庫）：

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `id` | INTEGER | PK AUTOINCREMENT |
| `room_code` | TEXT | NOT NULL |
| `a_uid` / `b_uid` | INTEGER | 可為 NULL（BOT 對手 = NULL） |
| `a_nickname` / `b_nickname` | TEXT | NOT NULL |
| `score_a` / `score_b` | INTEGER | NOT NULL |
| `winner_side` | TEXT | NOT NULL（'A'/'B'，finished 必有勝者） |
| `vs_bot` | INTEGER | DEFAULT 0 |
| `finished_at` | TEXT | DEFAULT `datetime('now')` |

索引：`idx_matches_a (a_uid, id)`、`idx_matches_b (b_uid, id)`。

### 0004_rebalance_config / 0006_rebalance_duration — 清舊 blob

平衡重校後 `DELETE FROM global_config WHERE key IN ('arena','stats','special')` → 回落程式碼新預設（`beys` 個體覆寫為差異值、保留不清）。**之後每次重校都要比照處理**（否則 D1 舊值默默蓋掉新預設、正式站默默換場/換數值）。

### 0005_lineup — `user_settings.lineup`

`ALTER TABLE user_settings ADD COLUMN lineup TEXT`。JSON 陣列 `[{beyId,special},…]` 至多 3 格。NULL / 壞 JSON / 含未知 beyId / 重複 beyId → API 端回落 `DEFAULT_LINEUP`（讀側嚴格 `parseLineup`、寫側寬鬆 `sanitizeLineupInput`）。

---

## 11. 雙資源戰鬥模型 + 計分 + 場地池 + 名冊（概要）

> 詳細數值/平衡/必殺技見 `CLAUDE.md` 與 docs/FEATURES。這裡只記跨模組整合要知道的事。

### 雙資源（spin / hp）

每顆陀螺兩條獨立資源（前端兩條血條 續/血）：
- **自旋 `spin`（續航條）**：隨時間衰減（`stamina` 越高越慢）→ 歸零即 **spin-out**。碰撞**不**直接扣自旋。
- **血量 `hp`（耐久條）**：`maxHp = arena.hpBase × weight`（`HP_BASE = 1150`）；碰撞扣血 → 歸零即 **ko**。

四圍屬性分工（`STAT_PRESETS`）：攻擊=扣血+擊退、防禦=減傷+減擊退、重量=血量上限+抗出界、續航=自旋衰減慢。`crit`（會心機率）/`specialPower`（必殺強度）為可選欄位。勝負原因：`ring-out / spin-out / ko / timeout / draw`。

### 計分（`src/game/scoring.ts`，前端 + DO 共用）

先到 `WIN_SCORE = 3` 分。`roundPoints`：**有勝者的 ko/spin-out/timeout = 1 分、ring-out 一律 2 分、平手 0 分**（不再依場地分區 cornerScore/rim 落點，arena 參數保留簽名相容）。

### 場地隨機池

`readGameConfig` 解析 `global_config.arena` 的 `enabledIds`（管理員啟用的場地組）→ 場地池 `arenas[]`（缺/全失效 → 單場地 `[activeId]`）。Battle Room DO 在 round 1 / rematch 用 `crypto` 從池中抽一座、**整場 match 固定**（`matchArena`）。場地選擇不進引擎、不影響確定性重跑。三座內建場地：`default`（圓形）、`builtin-xtreme`（熔核競技場，方形 box + M 形軟牆，正式現役）、`builtin-arcwall`（弧壁競技場，超橢圓 + 四對角 pocket）。

### 名冊系統（`src/game/names.ts`，零 Env，worker + 前端共用）

- `autoNickname(uid)` — 自動暱稱（API 讀設定時補上並持久化）。
- `beybladeName(uid, type)` — 陀螺名（穩定 hash、不存 DB、兩端一致）。
- 都用穩定字串 hash（FNV-1a）選名，**不可改成亂數**（worker 補寫 DB、DO fallback、前端顯示三處要選到同一名）。**名池已凍結**（`test/names.test.ts` checksum 鎖）——插入/刪除/重排會讓全服名字洗牌，只准原位替換並更新 checksum。

`src/game/beyblades.ts` 的 `BEYBLADES` 是全服固定 roster，**id/name 入凍結鎖**（`test/beyblades.test.ts`），數值（mods/crit/specialPower）可調平衡不入鎖。`resolveBeyStats(bey, base)` 把個體差 mods 乘在類型基礎屬性上——DO 與前端本機模擬同一條公式 → 手感一致。
