# 更新日誌（CHANGELOG）

本檔案記錄「網頁版雙人對戰戰鬥陀螺」的重大演進。

本專案的權威歷史以 **git 提交訊息**為準（commit message 寫得很詳盡，含設計決策、踩雷、平衡數據與驗證結果）。本檔案不逐 commit 翻譯，而是把歷程**依主題／開發階段歸納**成 [Keep a Changelog](https://keepachangelog.com/) 風格的里程碑日誌，方便快速掌握「做了什麼、為什麼、改了哪些檔」。每組變更後標注對應的 commit short hash，需要細節時用 `git show <hash>` 回溯。

格式約定：

- 版本號為**敘事性里程碑標籤**（非 npm semver；`package.json` 仍是 `0.0.1`），依主題分組，新到舊排列。
- 變更分類沿用 Keep a Changelog：`新增` / `變更` / `修復` / `平衡` / `部署`。
- hash 對應當時把該主題收尾的提交；單一主題常含多個 commit，列最具代表性者。

---

## [未發布 / 待辦]

從 CLAUDE.md 規格與現況推得的後續方向（尚未開工或進行中）：

- **回放 worker 化 / 觀戰**：目前對戰是「DO 廣播重跑包（inits+seed+config ~2KB）、兩端各自重跑確定性引擎回放」，尚無第三方觀戰與賽後可分享的回放鏈結。確定性架構已具備觀戰所需條件（同一重跑包任意端可重現），待補觀戰連線與旁觀者 UI。
- **R2 取樣管線正式啟用範圍擴大**：取樣音效（CC 取樣 opus→wav→R2）已上線採用、BGM 走 R2 串流；R2 第一階段其餘用途（如美術／回放資產）仍緩開。
- **`scripts/bot-player.mjs` 協定同步**：線上協定 `Loadout` 已從傳 stats 改為傳 `beyId`（DO 經名冊組裝防竄改），測試用 bot 腳本若仍用舊欄位需對齊新的 `beyId` 出賽協定。
- **必殺技 vortex（旋渦）**：早期嚴重失衡（裝備勝率 30%、把對手拉到自己身上反傷），已於名冊／營運打磨輪重做（drain 300/4s、發動中等效重量 ×2，勝率拉回 ~62%）——視為**已修**，列此存查。
- **平衡持續校準**：勝負原因比例對 seed 有 ±1.5pp 取樣噪音、`defense.attack` 是刀口參數；任何 `STAT_PRESETS` / `DEFAULT_ARENA` / `HP_BASE` / `DEFAULT_SPECIAL` 變動都要 `npm run balance` 重驗，並同步清 D1 `global_config` 舊 blob（比照 migration 0004 / 0006）。

---

## [營運打磨與音效] — 2026-06-12 ~ 06-13

把遊戲從「功能完整」推向「可營運上線」：戰局時長重校、命名改風、後台拆頁、陀螺庫 UX、音效取樣與 BGM。

### 音效

- **取樣優先音效引擎**：`src/audio/sfx.ts` 改為 13 槽位取樣引擎（撞擊輕/中/重、KO、出界、停轉、發射、必殺 ×5、win、lose）對應 R2 取樣；多檔槽位 round-robin 輪播、±6% 變速、力道分組；**任何取樣未載入自動回退街機合成版**。取樣走獨立 bus（不過量化/壓縮、只過 master limiter 防爆）。`f63bbe2`
- **勝負視角音效**：新增 `playLose`；勝負音改「match 結束才播」（每回合歡呼太吵），依視角選 win/lose（測試頁用本機分數、線上用伺服器 `outcome`）。`f63bbe2`
- **背景音樂（BGM）**：`src/audio/bgm.ts` 用 `HTMLAudioElement` 隨機選曲、播完隨機換首、autoplay 被擋以手勢補播；開關獨立持久化 `localStorage bb-bgm-on`；對戰廳掛載播放、卸載停止；worker `/api/sfx` 放寬支援 mp3 + Range 請求（串流）。音檔走 R2、不進 repo。`7d66c55`
- **BGM 音量**：0.3 → 0.16（使用者反映太大聲）。`fdea50d`
- **音效選樣室**：`public/sfx-pick.html` 13 槽位逐一試聽（現役/Lab 引擎/`sfx-test` 資料夾音檔），選擇存 `localStorage bb-sfx-picks` 供套用；`sfx-test/` 預開 13 槽位資料夾（`.gitkeep` 進版控，丟音檔即可用）。`a2bee2f` `9e0e04d`

### 變更

- **戰局時長重校**：平均 26s / 中位 31s（`hpBase` 1150 防秒殺）；分布 ko 57 / spin 23 / out 15.5 / draw 4.7、四型勝率 48.9~51.7。`a2bee2f`
- **命名改風（日式/美式中二，使用者拍板）**：暱稱池 116 條整池重寫（朧月千影／午夜判官風）、名冊 10 顆改名（緋空斬月／深淵要塞式／紫電居合…）；**id 不變、checksums 更新**（名池凍結鎖見名冊系統）。`a2bee2f`
- **後台拆頁**：拆成 `/admin/beyblade`（類型基礎 + 10 顆個體 mods/crit/specialPower 覆寫＝`global_config` `beys` key）與 `/admin/special`；新增場地外觀選擇器（圓/方/弧壁）；必殺技後台補進桌機導覽列。`a2bee2f` `7d66c55`
- **陀螺庫 UX**：off-canvas `BeyPicker`（大圖 + 六維雷達 + 縮圖網格 + 出賽中標記）、陣容縮圖、必殺技描述即時顯示（`specialDesc.ts`）；移除下方全名冊卡牆（瀏覽走抽屜）。`a2bee2f` `7d66c55`
- **會心傷害**：2x → 1.5x（擊飛型維持 2x）。`a2bee2f`
- **必殺開場緩衝分招獨立**：改為 `rushGraceTime` 等五欄、後台可調、legacy fallback。`a2bee2f`

### 修復

- **介面九修**：登出搬個人設定頁、對戰中離開攔截（`confirm` + `beforeunload`）、`launchMode` 設定正確套用、HP 殘影層改飽和紅、傷害小數字全開（dmg≥1）、行動版對戰隱藏 header、房主可關閉等待中房間（close-room 4002）、BOT 對戰不落戰績、移除設定頁陣容卡。`a2bee2f`
- **旋渦（vortex）重做**：drain 300/4s、發動中等效重量 ×2，裝備勝率 36% → 62%。`a2bee2f`
- **弧壁出界角統一**：與熔核同款（機殼最外四角直角三角 hazard + 2× 標籤，出界標示在外殼外牆，使用者拍板）。`a2bee2f`

### 平衡

- migration **0006** 清舊 `global_config` blob 回落新時長平衡；migration **0005** 為出賽陣容（lineup）。`a2bee2f`

---

## [陀螺名冊系統] — 2026-06-12

引入固定角色名冊（會心/必殺屬性）、選秀介面、場地隨機池。

### 新增

- **固定名冊** `src/game/beyblades.ts`：10 顆固定命名陀螺（每類型 ≥2），個體差 `mods` 乘在類型基礎上；顯示名「赤霄焚輪-攻擊型」格式；**id + name 凍結鎖 checksum `44f8b176`**。`5b199d7`
- **會心系統**：基準 5%、個體 3~8%；觸發 50/50 雙倍傷害或雙倍擊飛；**每碰撞固定耗 4 次 rng 以保 rng 流不位移**（確定性紀律）；會心金黃數字 + 閃光特效。`5b199d7`
- **必殺強度（specialPower）**：冷卻 ×(2−s)、rush/blast/clone 傷害 ×s。`5b199d7`
- **出賽陣容**：選 3 顆 + 各配必殺技（`user_settings.lineup`、migration **0005**、新手預設攻/防/持三顆）；選秀介面 `/roster`（六維六邊形雷達）+ 底部第三 tab。`5b199d7`
- **場地隨機池**：後台勾選啟用集合（`enabledIds`）、每場 match 隨機抽一座、整場固定、rematch 重抽；必殺開場緩衝 `graceTime` 後台可調。`5b199d7`

### 變更

- **線上協定 `Loadout` 改傳 `beyId`**：DO 經名冊組裝 stats 防竄改；按順序出賽（round N → 陣容第 N%3 顆，手動切換僅當回合）。`5b199d7`

### 修復

- **弧壁競技場出界修正**：pocket 門檻 150 → 220（隨機對戰出界率 10.8% → 1.0%，強擊飛仍可出）；hazard 帶與 2× 標籤移到邊界外側。`5b199d7`

### 平衡

- crit 注入後：ko 55.5 / spin 27.4 / out 12.4 / draw 4.5，四型勝率 48.7~51.1 全達標。`5b199d7`

---

## [手感與場地第二波] — 2026-06-11

容器級震動、雙 KO 平手重校、街機音效、去 IP 改名、第三座場地。

### 新增

- **弧壁競技場 ARC WALL STADIUM**（`builtin-arcwall`）：超橢圓 r(θ) 邊界（引擎 `boundaryRadiusAt`/`sampleBoundary` 與 ArenaSvg 共用幾何，物理畫面同源）、四對角 hazard 出界帶；+6 新測試。`fc36bbe`
- **音效試聽室** `public/sfx-lab.html`：保留調音用，定案後搬參數回 `sfx.ts`。`fc36bbe`

### 變更

- **場地震動改容器級**：`shakeEl` ref 直接 DOM transform，SVG 底圖 + canvas 一起晃；振幅以顯示像素標定（強撞 12px / KO 18px）——取代只震 canvas 層（SVG 底圖不跟動）的舊做法。`fc36bbe`
- **音效全面換「街機誇張」合成引擎**（sfx-lab C 案定案）：bitcrush + pump 壓縮 + 完整響度鏈；發射 v3 溫和起轉；R2 取樣管線留存未用。`fc36bbe`
- **去 IP 改名**：場地顯示名改「熔核競技場 FORGE CORE STADIUM」（localStorage 舊存檔一次性改名遷移）；「Beyblade」「Xtreme」不得出現在任何使用者可見字串（程式識別子保留相容）。`fc36bbe`

### 平衡

- **雙 KO 回歸平手（使用者裁定）**：靠傷害結構壓罕見——±10% seeded 浮動 + **速度主導傷害分配**（`AGGRESSOR_DMG_SPLIT`：衝得快少吃、被撞多吃），draw 25.9% → 4.5%；雙停轉/雙出界仍比剩餘血量。重校：ko 54 / spin 29 / out 12，四型勝率 48.8~51.1，猜拳方向保留（刻意收淺防雙 KO）。`fc36bbe`
- **名池凍結鎖**：checksum 測試釘死 116 + 66 名池（hash 取模選名，動池子＝全服洗牌，只准原位替換）。`fc36bbe`

---

## [Gameplay 大改版] — 2026-06-11

中二名稱系統、打擊感、計分改制、平衡重校。

### 新增

- **中二名稱系統** `src/game/names.ts`（零 Env，worker 與前端共用）：暱稱池 116 + 陀螺名池 66、穩定 hash；API 讀設定時自動指派暱稱並持久化；HUD 顯示「陀螺名・類型」。`09dd851`
- **打擊感**：傷害數字彈出（事件驅動、scrub 可重現）、場地震動（強撞/KO/出界，振幅按 canvas 縮放補償）、軌跡殘影/速度線/焊接火星、三層合成打擊音效（力道映射音量/音調/明亮度）。`09dd851`
- **對戰廳 UX**：底部抽屜選機（瞄準首屏零捲動）、回放列精簡、結算後點擊畫面續戰（800ms 防誤觸）。`09dd851`

### 平衡

- **碰撞傷害 ±10% seeded 浮動**（dmgA/dmgB 獨立擲骰）。`09dd851`
- **同步死亡 tie-break**：同類雙亡比超殺深度，攻擊型鏡像平手 73% → 0.7%、全局 draw 0.1%。`09dd851`
- **計分新制**：擊破/停轉/timeout 有勝者＝1 分、出界一律 2 分、平手 0 分（`cornerScore`/rim 分區不再參與計分）。`09dd851`
- **必殺技調整**：`graceTime` 3s 開場緩衝、rush/blast 傷害 +43%/+42%、dash 回血 10% maxHp、vortex 時長 +37%、clone 次數/觸發率升傷害降。`09dd851`
- **第二輪校準**：ko 61.2% / spin 26.6% / out 12.0% / draw 0.1%，四型勝率 48.8/53.1/48.1/50.0，猜拳收斂 67/68/62。`09dd851`

### 部署

- migration **0004** 清除 `global_config` 舊 blob 回落新預設；arena 預設 `activeId` 改 `builtin-xtreme`（防清除後默默換場）。`09dd851`

---

## [UI 全站改版：BURST FORGE 金屬鍛造風] — 2026-06-11

### 新增

- **設計系統** `src/styles/forge.css`：tokens 沿用舊變數名（`--accent` 改琥珀）、切角金屬面板 `.plate`、機台鍵 `.f-btn`、表單/徽章/警示斜紋共用 class；字型 Big Shoulders Display + Noto Sans TC。`3c88d11`
- **圖示系統** `src/components/ui/BbIcon.vue`（30 個 inline SVG，Bootstrap Icons 語彙）；**全站渲染字串 emoji 清零**。`3c88d11`
- **格鬥式 HUD**：熔融 HP 條（雙層傷害殘影）、渦輪 SP 分段燈、六角比分 pips、必殺技觸發銘牌橫幅（playhead 跨 `specialEvents` 觸發）。`3c88d11`

### 變更

- **App.vue**：行動版底部 Tab Bar（大廳/個人設定）；測試頁與後台入口僅管理員可見。`3c88d11`
- **Canvas 擂台金屬化**：黑鋼碗、熔岩橘加速軌道、黃黑 hazard 出界角（幾何與物理零變動）。`3c88d11`
- 大廳/登入/設定/後台全面換裝。`3c88d11`

---

## [線上化五階段] — 2026-06-10 ~ 06-11

把單機物理引擎原型搬上 Cloudflare（Worker + Durable Object + D1 + Google OAuth）。核心決策：**伺服器一次算完整場、前端只播放**；client 只送瞄準輸入，stats 由 DO 組裝防竄改。

### P5 — 大廳 DO + 戰績 `d9cf946`

- **新增** `worker/lobbyDO.ts`：單一全域 Lobby DO（`idFromName("global")`）——線上人數（去重 uid）、快速配對佇列、公開房列表（register/room-closed 內部介面、15 分 TTL + alarm 兜底清理）。
- **新增** `/api/lobby/ws`、`/api/room/create {public}`、`/api/me/matches`（勝敗聚合 + 近 20 場）。
- **新增** `matches` 表（migration **0003**）：Battle Room `runRound` 在 matchOver 時寫入（BOT 對手 uid=NULL + vs_bot=1）；設定頁顯示勝敗統計。
- **新增** `useLobby.ts` WS 客戶端、LobbyView 改版、`scripts/lobby-test.mjs` 配對測試工具。
- **修復（佇列雷區）**：配對前剔除「無活連線」幽靈 entry（dirty disconnect / DO 重啟殘留會讓真人配到幽靈空等）；佇列 entry 帶 `since` TTL；WS ping 加 `readyState === OPEN` 守衛；session 過期 401 連敗 3 次後查 `/api/me` 停止重試（否則無限打 401、UI 卡「連線中」）。

### P4 — Battle Room DO + 線上對戰廳 + 內建 BOT `80eef36`

- **新增** `worker/battleRoomDO.ts`：權威狀態機 `waiting → aiming(45s alarm) → simulate → review → finished`、WebSocket Hibernation。
- **新增** `src/game/{room,scoring}.ts` 共用純函式；`useOnlineBattle.ts`（重連 backoff/ping 保活/回放保護）+ `BattleRoomView.vue`（等待/已發射/滿房/被取代/斷線覆蓋層）。
- **新增 重跑包架構**：廣播 `inits+seed+config`（~2KB）兩端重跑確定性引擎，**不傳 1.5MB frames**。
- **新增 內建 BOT**：`?bot=1` 開房 AI 入座，每回合隨機配置 + `startAiming` 時預提交隱藏 aim（零計時器、不怕 hibernation）；`scripts/bot-player.mjs`。
- **變更（協定安全）**：client 只送瞄準輸入，stats/special 由 DO 依 loadout + D1 組裝；seed 雙方提交後 crypto 產生；收齊前不洩漏對方參數。
- **修復（DO 雷區，均實測重現後修）**：① 所有改房間狀態的事件走 `run()` promise 串列化（input gate 只擋 storage、不擋 D1 查詢 → `await` D1 時事件交錯造成 read-modify-write lost-update）；② 瞄準鬧鐘用後即清 `deleteAlarm()` + `idleSince` 時戳清房防誤刪（殘留鬧鐘秒清進行中比賽，high 級）；③ `RoundPayload` 落地 storage，join 時對 review/finished 補發；④ 每回合凍結全域設定。
- 測試 +12（64/64）。

### P3 — 個人設定 + 後台雙資料源（D1 / localStorage）`1d1613f`

- **新增** `worker/api.ts`：`GET /api/config`（D1 空時回程式碼預設）、`PUT /api/admin/config/:key`（管理員 + shape 驗證）、`GET/PUT /api/settings`（白名單驗證、殭屍 session 401）。
- **新增** D1 `global_config`（key-value JSON blob，與前端結構同形）+ `user_settings`。
- **新增** `src/store/adminBackend.ts`：後台資料源抽象——遠端含**寫入排隊（防並行 PUT 亂序舊蓋新）、失敗自動 reload 重新同步、可 flush 的 debounce（view 卸載/pagehide 送出、fetch keepalive）、stats 鋪 `STAT_PRESETS` 底再蓋 D1 值**。
- **變更** Admin 元件 props 注入資料源 + ready/error/重試 UI；後台頁「🌐 線上(D1) / 💻 本機(localStorage)」切換（測試頁仍吃本機）。

### P2 — Google OAuth + session + 權限閘門 + D1 users `b636cca`

- **新增** `worker/auth.ts`：OAuth code flow（state CSRF + 回跳路徑夾帶 + open redirect 防護），**失敗一律 302 回 `/login?error=<code>`**（callback 是整頁導航，不回裸 JSON）。
- **新增** `worker/session.ts`：HMAC-SHA256 簽名 session cookie（30 天，HttpOnly/SameSite=Lax）。
- **新增** `worker/jwt.ts`：id_token payload 解碼（TextDecoder 處理 UTF-8，中文姓名不亂碼——**不能 `JSON.parse(atob(...))`**）。
- **新增** `/api/me`、`/api/admin/*` 閘門（`ADMIN_EMAILS`）、D1 `users` 表 + upsert（migration **0001**）；router 守衛（requiresAuth/requiresAdmin）。
- **約束** worker 端被單元測試 import 的模組（session/jwt）必須零 `Env` 全域型別相依。環境變數走 `.env`。測試 +7（52/52）。

### P1 — vue-router 骨架 + Cloudflare Worker 入口 `8e32bb7`

- **新增** vue-router（`src/router.ts`）：`/` 大廳、`/room/:code` 對戰廳、`/settings`、`/admin/*`、`/test/*`（原單機頁面原樣保留、繼續吃 localStorage）。
- **新增** `worker/index.ts` + `wrangler.jsonc`：`@cloudflare/vite-plugin` 整合、SPA fallback、`/api/*` 走 `run_worker_first`、`/api/health`。
- **變更** vitest 設定拆出 `vitest.config.ts`（測試不載 cloudflare plugin）；`tsconfig.worker.json`（worker + `src/physics` 無 DOM 檢查，守住引擎零瀏覽器相依）。

### 部署

- 填入正式 D1 `database_id`。`94f997d`
- 新增 `deploy:ci` script（D1 migrations + deploy，Git 自動部署用）。`115c2da`
- 根 `wrangler.jsonc` 補 `assets.directory`（CI 在 build 前跑 d1 migrations 也能解析；vite plugin 在 dev/build 仍自管 assets）。`edc3980`

### 線上旋向固定 `6e03464`

- **變更** `src/game/room.ts` 的 `sideSpinDir` 為單一真相：先手 A 右旋、後手 B 左旋；DO 在 join / loadout / BOT 三處強制蓋回（client 改不動）→ 每場保證反向對撞（吃引擎 `oppSpinBonus`）。個人設定移除旋向欄位；測試頁不受限。

---

## [單機原型：必殺技、手感、視覺、手機版] — 2026-06-09 ~ 06-10

線上化之前的原型強化期，全部圍繞「確定性引擎不變」做呈現層與必殺技擴充。

### 新增

- **必殺技動畫特效分層**：地面漩渦/殘影/衝刺線（下層）+ 爆發環/召喚漣漪（上層）+ 軌跡尾巴漸變強化。`0d7fcfd`
- **音效（Web Audio 即時合成、無音檔/無版權/離線）** `src/audio/sfx.ts`：發射 zip、撞擊金屬鏘、必殺上升掃頻、KO 爆炸 + 低頻 boom、出界 whoosh、停轉下滑、勝利小喇叭；依事件時間在播放窗格觸發（與停格/變速/scrub 相容）；🔊/🔇 開關。音效為純呈現層，不影響確定性。`c37adfb`
- **三個新必殺技**（接在冷卻 + 每回合限次系統上）：⚡ dash 高速移動（回補自旋 + 沿移動方向加速）、🌀 vortex 旋渦（持續拉對手）、👥 clone 分身（恆存伴生 Body `isClone`，會撞會扣血、不計勝負，despawn）；`SpecialKind` 2→5，`applySpecials` 重構成統一「觸發 + 持續效果」+ helpers。`4c1f02b`
- **必殺技視覺打擊感（Phase A）**：引擎補回放事件（不影響確定性）`CollisionEvent{t,x,y,impact}`、`DeathEvent{t,id,x,y,reason}`、`SpecialEvent` 加位置；碰撞火花/擊破爆裂/必殺停格 + 招式名大字，全由播放時間 `curT` 推導（重播/變速/scrub 都穩、`hash01` 確定性粒子）。`5600658`
- **手機版頁面**：抽出 `src/composables/useBattle.ts`（建立並回傳 canvas ref、生命週期內含），新 `MobileBattle.vue` 只寫手機版面消費它（直向置中、計分 + 三色階段條、場地當主角、HP 疊頂、回放控制列）。`eb6aa8a`
- **綠色內牆系統**：手繪 M 形 Xtreme Line（外圈大弧 + 相切直腿 + 圓弧拱 + 水平凹底，星形曲線 + WeakMap 快取）；引擎碰撞與 ArenaSvg 吃同一份 `sampleSoftWall`（物理畫面同源）；綠牆＝實體內牆，唯一出框方式＝被擊飛到空中（z>wallHeight）飛越（越牆後關閉碗面力做彈道飛行）；場地後台 box / softWall 各自獨立開關。`62a2f9b`

### 變更

- **必殺技系統重做（Phase B）**：模型＝冷卻 + 每回合限次；`Body` 用通用 `specialReadyT`（冷卻）+ `specialUsesLeft`（每場 simulate 自動重置）；rush/blast 觸發加「過冷卻 && 還有次數」閘門；後台加冷卻/每回合次數滑桿；冷卻滑桿上限 5→30s、預設拉長（衝刺 6s/衝擊 5s）。`5600658` `4c1f02b`
- **桌面版接上 composable 去重**：`BattleViz` ~940 行對戰邏輯改成消費 `useBattle`（script 938→15 行，template/CSS 逐位元不變）；桌面/手機同源，音效/視覺只改一處兩邊生效。`c37adfb`
- **回放預設 2 倍速**（純播放層，不動模擬 dt:1/60、frames、平衡）。`62a2f9b`

### 修復

- **分身穿綠框**：clone 原本 `resolveWalls` 整段 continue → 穿牆飛出；改成分身照吃牆碰撞（當實牆反彈），但 ring-out 死亡對分身略過。`6aa41e3`
- **內建場編輯保存**：加 `userEdited` 旗標（改過的不再被 `ensureBuiltin` 覆寫）+ 後台「↺ 原廠」；修「重力要按編輯兩次才套用」（改用 `@change`）。`62a2f9b`
- 修 `lerpFrame` 沒帶 `isClone`/`ownerId`/`cloneFade`（分身平滑播放誤判）。`4c1f02b`

### 平衡

- **必殺技平衡**：新增 `test/balance-special.bench.ts`（`npm run balance` include 兩支 + `fileParallelism:false`）；發現五招嚴重失衡（blast96/rush80/clone68/vortex30/dash3%）；診斷 dash/vortex 是「機制害到自己」（dash 沿移動方向狂加速自爆出界、vortex 把對手拉到身上反傷）；dash 改「續命第二風」（加速大砍 + `dashMaxSpeedMul` 夾速 + 回補自旋）、vortex 改「拉 + `vortexSpinDrain` 抽乾對手自旋」；4 輪迭代收斂到 rush67/dash67/blast62/clone60/vortex59（差距 93→7.5），互打矩陣 37~63% 無硬剋；基礎平衡未動。`6aa41e3`

---

## [初始原型與引擎奠基] — 2026-06-08 ~ 06-09

### 新增

- **初始提交**：確定性批次物理引擎 + 雙人對戰原型，全程依「之後搬上 Cloudflare」設計。`b1a5a9e`
  - 物理引擎 `src/physics`：旋向、護牆反彈、2.5D 高度、碰撞能量夾制；**雙資源模型**（自旋＝續航 / 血量＝耐久），勝負條件 出界/停轉/擊破/爆裂/超時。
  - 對戰：拖曳發射（甩動/拉弓）→ 紅藍分開發射 → 統一運算 → 軌跡回放（內插 + 終結慢動作 + 後續演出）。
  - 必殺技：衝刺突進 / 爆裂（seeded 機率觸發，`SpecialConfig` 可調）。
  - 計分賽制：護牆缺口定位計分、多回合先到 3 分。
  - 三後台（localStorage）：場地 / 陀螺屬性 / 必殺技數值。
  - 美術：codex 生成四型俯視貼圖（WebP 多尺寸）。
  - 測試：15 項 vitest + `npm run balance` 平衡分析工具（四型勝率約 46~52%、乾淨猜拳）。
- **場地後台**：`hpBase` 血量基準滑桿（`maxHp = hpBase × 重量`，舊場地無此欄位用引擎預設 1250）；`spinKnockback` 轉速擊退加成（攻擊方自旋越高彈越遠，做在能量夾制之後的額外推力、隨自旋衰減不暴衝）——兩者皆 `ArenaConfig` 可選欄位、向後相容；新增 CLAUDE.md。`7d523bf`

### 變更

- **必殺技：爆裂（burst）→ 衝擊（blast）**：猛擊機率把對手彈開 + 傷害（可順勢擊出界），取代血量窗口太窄幾乎不觸發的舊秒殺；每招獨立觸發機率（`rushChance`/`blastChance`），`specialStore` 升 v2（chance 拆成 rush/blast、burst* → blast*）。`512dc3b`
- **甩動手感**：`V_FULL` 2500 → 5200（甩速真正決定動能，原本一甩就爆表、快慢無區別）。`512dc3b`
