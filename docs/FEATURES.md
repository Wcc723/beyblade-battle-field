# FEATURES.md — 功能清單與完成狀態

網頁版雙人線上對戰戰鬥陀螺（Vite + Vue 3 + TS + Cloudflare Workers/DO/D1/R2）的**完整功能清單**。
本文件以「行為描述」為主，重點是讓開發其他模組時知道「某功能實際怎麼運作、邊界在哪」。
所有列出的功能皆為 **✅ 已完成**（P1~P5 全數落地）。

> 名詞速查：**DO**＝Durable Object；**重跑包 RoundPayload**＝`inits+seed+config`（~2KB），兩端用同一份確定性引擎重算 frames，不傳 1.5MB 軌跡；**loadout**＝`{beyId, spinDir, special}`（伺服器真相）；**lineup**＝玩家 3 顆出賽陣容（D1 持久化）。

---

## 1. 大廳（LobbyView + lobbyDO + useLobby）✅

**行為描述**：大廳是登入後的首頁（`/`，`requiresAuth`）。掛載即連單一全域 **Lobby DO**（`idFromName("global")`）的 WebSocket（`/api/lobby/ws`），DO 每次事件廣播一包 `{online, queueSize, queued, rooms[]}`。三種進房途徑：房號加入、快速配對、開房（公開/BOT）。

- **線上人數**：DO `broadcast()` 對所有連線去重 uid（同帳號多分頁只算 1 人），算 `uids.size`。連線狀態章三態：連線正常／連線中…／已斷線（`authLost`）。
- **房號加入**：前端正則 `^[A-Z0-9]{6}$` 先驗格式（去除易混淆字元的字母表由 DO 端 `ROOM_ALPHABET` 產碼，但加入時前端只驗格式不驗存在），具名路由 `{name:'room', params:{code}}` 導頁（自動 URL 編碼）。輸入自動轉大寫。
- **快速配對佇列（含幽靈剔除）**：點「快速配對」送 `{type:"queue"}`，DO 把 `{uid,nickname,since}` 推入 storage queue；`tryMatch` **先剔除「沒有活連線的幽靈 entry」**（`getWebSockets(uid).length===0`——dirty disconnect／DO 重啟殘留會讓真人配到幽靈、進房空等），再每湊兩人發同一房號（`matched`）給雙方。客戶端 `wantQueue` 旗標：斷線重連後自動補排（伺服器斷線會把人踢出佇列）。佇列 entry 有 **TTL `QUEUE_TTL_MS=10min`**（`since` 欄位，broadcast/alarm 雙重 prune）。配到房後 `matchedCode` 觸發 LobbyView watch 跳房。
- **公開房列表（TTL）**：`POST /api/room/create {public:true}` 時 worker 打 DO `/register-room`；Battle Room DO 在「開打」或「清房」時打 DO `/room-closed` 下架。**15 分鐘 TTL `ROOM_TTL_MS`** 兜底（開了沒人來就棄置）＋ `alarm` 排程到「最早到期房」時間點（安靜大廳零事件也能 prune）。列表顯示房號、房主暱稱、「等待中」呼吸燈、相對時間（前端每 30s 重算 `timeAgo`）。
- **關閉房間**：見 §2「房主關房」（在 BattleRoomView，僅 waiting 階段、僅 A 側）。
- **雷區**：WS 客戶端 ping 要 `readyState===OPEN` 守衛（CONNECTING 時 send 同步 throw）；連續握手失敗 3 次 → 查 `/api/me`，若 `user===null` 設 `authLost` 停止重試（避免無限打 401、UI 卡「連線中」）。

---

## 2. 對戰流程（BattleRoomView + useBattle + useOnlineBattle + battleRoomDO）✅

**行為描述**：對戰房（`/room/:code`）是線上對戰主舞台。權威狀態機在 Battle Room DO：`waiting`（等兩人）→ `aiming`（雙方並行瞄準、45s alarm 截止）→ DO 端 `simulate()` 權威運算 + 計分 → `review`（兩端各自重跑回放）→ `next-round` → … → `finished`（先到 3 分）→ `rematch`。client **只送瞄準輸入 AimInput**，stats/special/spinDir 由 DO 依 loadout + D1 全域設定組裝（防竄改）；**seed 在雙方都提交後才以 `crypto` 產生**（不可預測 → 防離線暴搜最佳發射參數）。

### 2.1 瞄準與發射（flick / sling）
- **兩種拖曳模式**（`useBattle`）：
  - **sling 拉弓**：按住拖曳，往後拉的**距離**決定力道、拖曳向量決定角度，放開發射（線上預設）。
  - **flick 甩動**：點住設定落點，朝目標方向「甩」一下放手，**放手瞬間游標速度**決定動能（`V_FULL=5200` 為全力甩速）。整個視窗都能甩。
  - 模式由個人設定 `launchMode` 決定，BattleRoomView 在 `loadMyLineup()` 時以伺服器設定覆寫（之前漏接 → 個人設定發射模式對線上無效的 bug 已修）。
- **落點限制**：`clientToWorld` 把落點夾在 `scaleRef()*0.9` 內；DO 端 `sanitizeAim` 用同一個 0.9 限制再消毒一次（落點夾回場內、方向正規化、力道夾 `[0.06, 1]`），非有限值 → null → 回 `bad_aim`。
- **發射換算**（`buildInitFromAim`，前後端同公式）：`speed = power × maxSpeed(340)`、`spin = (0.55 + 0.45×power) × maxSpin(3000)`、`radius=26`。

### 2.2 45s 倒數與自動發射
- `startAiming` 設 `aimDeadline = now + 45s` 並 `setAlarm`。前端 `aimRemaining` 由 `aimDeadline - now`（每 500ms tick）算秒數顯示。
- 逾時 alarm 觸發 `handleAlarm`：未發射側補 `defaultAim`（靠己方場邊、朝中心、力道 0.6，確定性不靠亂數），然後 `runRound`。
- **發射不洩漏對方參數**：`launch` 只回對手 `opponent-launched`，雙方 aim 到 `round` 訊息（重跑包）才一起出現。

### 2.3 發射 → 重跑包 → 回放
- 雙方 aim 到齊 → DO `runRound`：組 inits（`getBey→applyBeyOverrides→resolveBeyStats`）、產 seed、`simulate`（DO 只要勝負，`sampleEvery:100000` 不留軌跡）、計分、廣播 `RoundPayload`。
- 前端收 `round` → `bt.playRemoteRound(payload)`：用 `payload` 的 `inits/seed/arena/special` 跑 `simulate`（`sampleEvery:1` 留完整 frames）→ 兩端得到**逐位元一致**的回放。`roundScored=true` 關掉本機計分（計分權威在伺服器）。
- **MAX_TIME=60、FOLLOW_THROUGH=2.5**：勝負底定後再演 2.5 秒收尾（出界陀螺飛出、勝方續轉）。

### 2.4 回放表現（相鄰幀內插 / 慢動作 / 特效）
- **相鄰幀內插 `lerpFrame`**：playhead 是浮點數，相鄰兩幀插值 → 慢動作才滑順。
- **終結慢動作 `slowmoCues`**：終結／淘汰瞬間，0.9 秒窗（`SLOWMO_WINDOW`）內播放速度 ×0.3（`SLOWMO_FACTOR`）。
- **必殺技停格**：playhead 跨過 `specialEvents` → snap 到該時刻凍結 360ms（`FREEZE_MS`），view 層 `spBanner` 亮鋼印橫幅 1.2 秒（同事件 `lastShownT` 只觸發一次，scrub 回頭不重播）。
- **傷害數字 / 場地震動 / 火星**：全由播放時間 `curT` 推導（吃 `collisionEvents` 的 `dmgA/dmgB`、`critA/critB`），scrub 倒帶可重現。**場地震動是容器級**（`shakeEl` 綁場地容器 div、直接 DOM transform、振幅以顯示像素標定 `shakeScale = clientWidth/640`）。
- **回放倍速**：個人設定 `replaySpeed`（1/2/3x，預設 2x），只影響播放不動 timestep。

### 2.5 底部抽屜選機（出賽陀螺 / 必殺技切換）
- BattleRoomView 把配置收進底部 bottom sheet（`sheetOpen`，純 UI 狀態）。發射／換階段 → 抽屜自動收合。
- 出賽陀螺下拉只列**自己 lineup 內的 beyId**（`loadMyLineup` 從 D1 讀，失敗回落 DEFAULT_LINEUP）；切換送 `loadout {beyId}`，DO `mergeLoadout` 驗 beyId∈allowed、`spinDir` 強制蓋回固定旋向。**對戰中手動切換只影響當回合**（DO 記 `pickedRound`，`startAiming` 套陣容輪替時跳過該玩家）。
- 自己側名字吃本地 `selectedBeyId`（切換即時跟著變、不等伺服器 echo），對手側吃 snapshot。

### 2.6 點擊續戰（tap-to-continue）
- `review` 階段、回放播完、有 outcome 且非 matchOver → `canTapNext` 為 true；結算銘牌亮相 **800ms 防誤觸**（`tapArmed`）後，點場地任意處＝送 `next-round`。
- matchOver 不觸發（走「再來一場 rematch」鍵）。對手先按下一回合時 snap 已 aiming → `canTapNext` 自然 false，不干擾 `pendingAiming`（播完再切）流程。

### 2.7 對戰中離開攔截
- `battleActive`＝連線正常 + 未滿房/未被取代/未關房 + 比賽未結束 + phase∈{aiming,review}。
- 攔兩處：`beforeunload`（瀏覽器原生「確定離開？」）＋ `onBeforeRouteLeave`（`window.confirm("對戰仍在進行中…")`）。waiting/finished/斷線一律放行。

### 2.8 房主關房
- 僅 **A 側且 phase=waiting** 有效（DO 端也驗）。`close-room` → DO `deleteAll()` + `deleteAlarm()` + 通知大廳下架 + 全連線 `close(4002)`。前端收 4002 → `roomClosed` → 導回大廳。

### 2.9 斷線 / 重連 / 連線管理（useOnlineBattle）
- WS 自動重連（指數退避 1s→10s）+ 25s ping 保活（`readyState===OPEN` 守衛）。
- close code 語意：`4000` superseded（同帳號新分頁取代，不重連）、`4001` room_full（不重連）、`4002` room-closed（不重連、導回大廳）、握手連敗 3 次查 `/api/me` 偵測 `authLost`。
- **重連補發**：DO 在 `review/finished` 階段對 join 進來的玩家補發 `lastRound`（錯過廣播的玩家才看得到回放與結果）。
- **對手先按下一回合不硬切回放**：`pendingAiming` 暫存，等本地回放看完（`battle.playing` false 且 `isFinished`）才 `enterAiming`，並讓 outcome 橫幅閃 1.5s。

### 2.10 DO 並發安全（雷區，已踩過）
- **事件串列化 `run()`**：input gate 只擋 storage、不擋 D1 查詢；handler 中 `await` D1（readGameConfig/readLineup）時另一事件會交錯執行 read-modify-write（後存的 aim 蓋掉先存的 → 卡死）。**所有改房間狀態的事件（join/message/close/alarm）一律排進同一條 promise chain**。
- **alarm 只有一個 slot**：瞄準鬧鐘在 `runRound` 後必須 `deleteAlarm()`；清房要驗 `idleSince` 時戳滿 `IDLE_CLEANUP_MS=10min`（殘留鬧鐘提早到點不可誤刪，否則 review/finished 雙方短暫斷線比分幾秒就被清掉）。
- **roundCfg 凍結**：每回合 `startAiming` 把全域設定凍結成 `roundCfg`（arena 換成 matchArena）→ 消毒/預設發射/模擬同一份基準，管理員回合中調參不影響進行中回合。

---

## 3. 計分（scoring.ts + battleRoomDO + useBattle）✅

**行為描述**：計分共用模組 `roundPoints(arena, SimResult)`（前端回放結算 + DO 權威計分共用）。先到 `WIN_SCORE=3` 分獲勝（match）。

- **單回合得分（新制）**：
  - 擊破 **ko** ＝ 1 分
  - 停轉 **spin-out** ＝ 1 分
  - 時間到 **timeout**（有勝者）＝ 1 分
  - 擊出界 **ring-out** ＝ **一律 2 分**（不再依場地分區 cornerScore / rim 落點；`arena` 參數保留簽名相容但目前不讀；ArenaSvg 出界標籤固定 2×）
  - **平手 draw** ＝ 0 分（無人得分）
- **同步死亡規則（使用者裁定，在 engine.ts checkDeaths）**：
  - 同一步**雙 ko ＝平手**（「雙方血量都歸零就是平手」，靠傷害結構讓它罕見、不靠硬判）
  - **雙停轉 / 雙出界才 tie-break**：比剩餘健康度 `hp/maxHp`（誰較健康，相等再比 `spin/maxSpin` 超過量，再相等＝平手）
  - 混合同步死亡（ko + spin-out 等）維持平手
- DO `runRound`：勝方加分 → `matchOver = scoreA>=3 || scoreB>=3` → `phase = finished/review`，`winnerSide` 鎖定。

---

## 4. 陀螺名冊（beyblades.ts + RosterView + BeyPicker + RadarHex）✅

**行為描述**：全服固定角色名冊 `BEYBLADES`（純模組、零 Env/DOM，worker 與前端共用）。共 **10 顆 `BeyDef`**（攻 3 / 防 3 / 持 2 / 平 2），每顆有穩定 `id`、中二名 `name`、`type`、個體差 `mods`、會心 `crit`、必殺強度 `specialPower`。

- **id/name 凍結鎖**：`test/beyblades.test.ts` 有 checksum（132f762a）。**數值（mods/crit/specialPower）可調**不入鎖；**name 要改需原位替換並更新 checksum**；**id 永不可動**（DB lineup 引用）。
- **個體差 `mods`**：0.92~1.08 乘在類型基礎屬性上（`resolveBeyStats`：base 四欄 × mods，缺欄＝1，附 crit/specialPower）。admin 調類型基礎仍全面生效。設計上**無全維度優勢顆**（高 crit 配低 specialPower 之類的取捨）；crit 範圍 0.03~0.08、specialPower 0.9~1.2。
- **顯示全名 `beyFullName(bey)`**：「`{name}-{類型中文}`」如「緋空斬月-攻擊型」。查無 id（roster 改版孤兒）回 "—" 不炸。
- **lineup（3 顆出賽陣容）**：玩家在 `/roster`（RosterView）選 3 顆，持久化在 `user_settings.lineup`（JSON，migration 0005；空→`DEFAULT_LINEUP`）。
  - **選秀介面**：3 格 slot（縮圖 + 名字 + 類型徽章 + 必殺技 select + 描述小字），點格子開 **BeyPicker** 底部抽屜瀏覽全名冊、**RadarHex 六維雷達**（攻/防/續航/重量/會心/必殺）。
  - **PUT 全量陷阱**：lineup 存在 `/api/settings` PUT 整包，RosterView 先 GET 留存其他欄位（base）再合併送出，否則 worker sanitize 會把缺欄重設、洗掉其他設定。
- **按順序出賽**：round N 預設用 `lineup[(N-1) % len]`，special 跟著陣容格；對戰中手動切換僅當回合有效（見 §2.5）。線上協定 `Loadout={beyId,spinDir,special}`，DO 以 `getBey→resolveBeyStats` 組裝（防竄改）。
- **DEFAULT_LINEUP**：緋空斬月(rush) / 深淵要塞式(blast) / 永凍月輪(dash)——三顆不同類型。

---

## 5. 必殺技（engine.ts DEFAULT_SPECIAL + specialDesc.ts）✅

**行為描述**：五招、**opt-in（每顆獨立裝備）**、seeded 機率觸發、**不影響基礎平衡**（平衡工具不裝必殺技）。觸發模型＝開場緩衝閘門 + 冷卻 + 每回合限次 + 機率。設計上**裝技明顯強於不裝**（刻意）。所有數值集中在 `DEFAULT_SPECIAL`，可被 D1`special` blob 覆寫。

| 招式 | 觸發條件 | 效果 | 冷卻 / 次數（預設） |
|---|---|---|---|
| **rush 衝刺突進** | 逼近對手（`best < rushRange=110`）、過緩衝、過冷卻、有次數 → `rng < 0.14` | 朝對手爆發加速 `+80` + 直接扣血 `100×s` | 冷卻 6s / 每回合 2 次（沒中 0.5s 短冷卻不耗次數） |
| **blast 衝擊** | 碰撞 `impact > blastImpactMin=90` + 過 `blastGraceTime` + 過冷卻 + 有次數 → `rng < 0.1` | 把對手彈開 `+70` + 扣血 `105×s`（夾制後補推 → 可順勢擊出界） | 冷卻 5s / 每回合 2 次 |
| **dash 高速移動** | 自旋比例 `spin/maxSpin < dashTriggerSpin=0.3` → `rng < 0.5` | 回補自旋 `+60` + **回血 `maxHp×0.1`（dashHealFrac，夾不超過 maxHp，事件帶 `heal`）** + 2s 加速（速度上限 `maxSpeed×0.45` 夾住不自噴出界） | 冷卻 8s / 每回合 1 次 |
| **vortex 旋渦** | 對手進範圍（`< vortexRange=250`）、首次進範圍 → `rng < 0.7` | 4s 內持續吸附對手（`pull=380`）+ 每秒抽乾對手自旋 `300`（磨到停轉）；**發動期間自身等效重量 ×2（VORTEX_MASS_MUL：受擊擊退減半、出界門檻 ×2）** | 冷卻 7s / 每回合 2 次 |
| **clone 分身** | 對手進範圍（`< cloneRange=260`）、首次進範圍 → `rng < 0.35` | 召出分身（spin 2000、2s 後消失）連續衝撞（追擊 homing 280）；攻擊 `本體攻擊 × 0.25 × s`（次數多、單發低傷、不計勝負） | 冷卻 10s / 每回合 2 次 |

- **開場緩衝（分招）**：`rushGraceTime / blastGraceTime / dashGraceTime / vortexGraceTime / cloneGraceTime`（各預設 3s），`t < grace` 該招不觸發（resolveCollisions 的 blast 與 applySpecials 各一道閘門）。舊統一欄位 `graceTime` 為 legacy 可選 fallback（simulate 合併時解析）。
- **specialPower s**：冷卻 `×(2−s)`、rush/blast/clone 傷害 `×s`；**dash 回血/回轉、vortex 吸轉/拉力不吃 s**（避免過強）。
- **顯示文案**：`specialDesc.ts`（`SPECIAL_DESCS` 名+一句話描述，`SPECIAL_ORDER` 固定選單順序、"" 在最前）；即時數值看 `useBattle.specialInfo()`。

### 5.1 會心（crit）✅
- 碰撞時攻擊者 `crit`（預設 `DEFAULT_CRIT=0.05`）機率觸發，**50/50** 出「傷害 ×1.5（`CRIT_DMG_MUL`）」或「擊退 ×2（夾制後補推）」。
- `CollisionEvent.critA/critB`（記在**受擊側**：critA = A 被會心打的效果）；前端金黃放射數字+閃光。
- **每碰撞固定消耗 4 次 rng**（沒中也消耗 → 調 crit 不位移 rng 流、不破壞確定性）。傷害 ×1.5 在 ±10% 浮動與 AGGRESSOR split 之後乘。

---

## 6. 場地（engine.ts + arena.ts + ArenaSvg）✅

**行為描述**：三座內建場地 + 圓形預設場，幾何查詢集中在 `arena.ts`（引擎與 ArenaSvg 共用 → 畫面與物理同源、確定性）。**平衡是「場地 × 屬性」共同決定**。

- **熔核競技場「FORGE CORE STADIUM」**（id `builtin-xtreme`／識別子 `XTREME_STADIUM`，**正式對戰現役場地** `activeId`）：正方形 box（四邊反彈、四角開口出界 2 分）+ 熔岩 **M 形軟牆**（內層實體牆，頂部凹口導向中心逼對撞；只在貼地 z≤wallHeight 阻擋，被擊飛 z>wallHeight 才飛越綠牆進外圈、被甩進四角才出界）+ 頂部加速區。
- **弧壁競技場「ARC WALL STADIUM」**（id `builtin-arcwall`）：**超橢圓邊界** r(θ)=`radius·2^(1/p−1/2)/(|cosθ|^p+|sinθ|^p)^(1/p)`，p=3.5 → 方中帶弧、四邊外凸、對角最遠（對角正規化 → 最遠點恰為 radius，邊界恆在外接圓內、前端縮放不必改）。**四對角 rim pocket 出界**（門檻 220、2 分；四邊中段門檻 420 幾乎必反彈）。
- **預設場地（圓形）**：`DEFAULT_ARENA`（radius 300），上下兩個高分缺口（相容舊行為）。
- **隨機池 `enabledIds`**：arena config 後台勾選（缺→`[activeId]`）；DO **每場 match 開打抽一座存 `matchArena`、整場固定、rematch 重抽**（DO 層用真亂數沒問題——場地選擇不進引擎、不影響確定性重跑）。
- **去 IP 紅線**：「Beyblade」「Xtreme」不得出現在任何使用者可見字串（程式識別子保留為相容性）。
- **後台外觀選擇**：場地後台（`/admin/arena`）可存多組 preset、切換 `activeId`、勾選 `enabledIds`。

---

## 7. 個人設定（SettingsView + api.ts user_settings）✅

**行為描述**：`/api/settings` GET/PUT，存 D1 `user_settings`（migration 起）。

- **暱稱自動指派**：GET 時暱稱為空（新用戶/從未改名）→ `autoNickname(uid)`（穩定 hash 選 NICKNAME_POOL）並**持久化寫回**（之後回傳的 nickname 永遠非空）。FK 失敗（session 指向已刪 user）→ 回 401 `session_user_missing`。
- **操作偏好**：發射模式（sling/flick）、回放倍速（1/2/3x）、音效開關、預設陀螺類型/旋向/必殺技（舊版欄位，lineup 制下進房主要用 lineup）。
- **戰績（近 20 場）**：`/api/me/matches` 回 `{total, wins, losses, matches[]}`；matches 顯示勝/敗徽章、對手暱稱、比分、時間（D1 datetime 是 UTC，前端補 Z 轉本地）。
- **BOT 不落戰績**：見 §10；個人戰績只統計真人對戰（matches 表 `vs_bot` 旗標，BOT 對手 uid=NULL）。
- **登出**：登出鍵在個人設定頁底部（header 不放、防誤觸），清 session 後回 `/login`。

---

## 8. 音效（sfx.ts）+ BGM（bgm.ts）✅

**行為描述**：音效＝**取樣優先 + 街機合成回退**雙引擎。

- **14 槽位**（`SAMPLE_MAP`）：`hit-light / hit-medium / hit-heavy`（撞擊三檔按 impact 選組）、`ko / ring-out / spin-out / launch`、`special-rush / special-blast / special-dash / special-vortex / special-clone`、`win / lose`。
- **R2 取樣優先**：懶載入 `/api/sfx/<key>.wav`（worker → bucket `beyblade-sfx`，immutable 快取；支援 Range）；多檔槽位 round-robin 輪播（不連發同變體、±6% 變速防重複感）。**任何取樣未載入 → 自動回退合成版**（離線/本地沒檔也有聲，bitcrush + pump 壓縮的「街機誇張」純合成）。逐槽音量微調 `SAMPLE_GAIN`（歡呼壓低、撞擊保衝擊）。
- **勝負視角 win/lose**：勝負音**只在整場 match 結束**才播（每回合都歡呼太吵）；線上用伺服器 outcome（`remoteMatchOver/remoteWinnerSide`）+ `mySide` 判斷 `iWon` 選 `playWin()/playLose()`，測試頁（mySide null）用本機分數。
- **回放音效節流**：撞擊取播放窗格內最強一筆 + 55ms 節流（避免機關槍）；必殺/死亡逐筆。
- **BGM**：`startBgm` 進對戰隨機播一軌（`TRACKS=["bgm-0","bgm-1"]`，`/api/sfx/<key>.mp3`）；autoplay 被擋 → 首次手勢 `tryResumeBgm` 補播。開關獨立存 localStorage `bb-bgm-on`（與 SFX 獨立——有人要音效不要音樂）。
- **試聽室保留**：`public/sfx-lab.html`（調音色 A/B）、`public/sfx-pick.html`（逐槽選樣，選擇存 localStorage `bb-sfx-picks`）。

---

## 9. 後台（ArenaAdminView / BeybladeAdminView / SpecialAdminView）✅

**行為描述**：三頁後台（`/admin/arena`、`/admin/beyblade`、`/admin/special`，`requiresAdmin`，真閘門在 worker `isAdminEmail`）。每頁頂部 **雙資料源切換**：「線上設定（D1）」／「本機測試（localStorage）」（透過 `adminBackend.ts` 的 props 注入；測試頁吃本機，不受線上化影響；`:key=mode` 切換時重掛元件避免草稿殘留）。

- **場地後台**：場地 preset CRUD、切換 `activeId`、勾選隨機池 `enabledIds`。線上模式藏「回對戰場試打」（D1 改的不是測試頁吃的本機）。
- **陀螺後台**：四類型屬性基礎（`stats`）+ **10 顆個體覆寫（`beys`）**（mods/crit/specialPower，`applyBeyOverrides` 夾制合併：mods 0.8~1.2、crit 0~0.25、specialPower 0.8~1.4）。
- **必殺技後台**：必殺技數值（`SpecialConfig`）+ 分招開場緩衝。
- **遠端寫入三道防線（P3 雷區）**：arena 整包 PUT 走 **promise queue 依序送出**（並行 PUT 亂序會舊蓋新）；寫失敗自動 `reload()` 重新同步；tuning 600ms debounce 有 `flush()`（view 卸載/pagehide 時送出，fetch `keepalive`）。
- **D1 覆蓋程式碼預設**：`global_config` blob 會蓋過 code 預設；重校平衡後要同步線上值（migration 清 blob 回落新預設；beys 個體覆寫為差異值可保留）。讀取側要鋪 `STAT_PRESETS` 底再蓋 D1 值（缺欄不 crash）。

---

## 10. 內建 BOT（room.ts + battleRoomDO）✅

**行為描述**：開房帶 `?bot=1`（大廳「跟 BOT 對戰」鈕，BOT 房不上公開列表）→ worker 帶 `X-BB-Bot:1` → DO 讓內建 AI 入座另一側（假 uid `BOT_UID=-1`、暱稱「陪練 BOT」）。

- **每回合隨機配置**：`startAiming` 重抽 `randomBotLoadout`（從全名冊抽 beyId、旋向/必殺技隨機；旋向強制蓋回固定值），並 `startAiming` 時**預提交隱藏 aim**（`randomBotAim`：落己方半場、大致朝對面、力道中上）→ **零計時器、不怕 hibernation**（aims 從不廣播，玩家只看到 launched ✓）。
- **不落戰績**：BOT 對戰是練習場性質，`runRound` 在 matchOver 時一律不寫 matches 表（`!isBot` 雙重條件）。
- 測試工具：`scripts/bot-player.mjs`（可全自動打整場）。

---

## 11. 線上旋向固定（room.ts sideSpinDir）✅

**行為描述**：線上對戰旋向不開放調整——**先手 A＝右旋（+1）、後手 B＝左旋（−1）**。DO 在 **join / loadout / BOT 三處強制蓋回**（`spinDir = sideSpinDir(side)`，client 改不動）→ 每場保證反向對撞、吃引擎反向加成 `oppSpinBonus`。測試頁不受此限。RosterView 提示文字明示此規則。

---

## 12. 認證與權限（auth.ts / session.ts / jwt.ts / authStore）✅

**行為描述**：全站 Google OAuth。

- **登入**：`/api/auth/login` 整頁導航進 Google → `/api/auth/callback` 302 回原頁（`redirect` query）。**callback 失敗一律 302 回 `/login?error=<code>`**（不回裸 JSON）；LoginView 把 error code 對應中文訊息。
- **權限**：`ADMIN_EMAILS` env var 管後台（`isAdminEmail`）；session 在 cookie（JWT，`SESSION_SECRET`）。
- **router 守衛**：`requiresAuth` 未登入 → `/login?redirect=`；`requiresAdmin` 非 admin → 退回大廳。`/test/battle`、`/test/mobile` 不需登入（原單機頁原樣保留、吃 localStorage）。行動版底部 Tab Bar＝大廳/陀螺/個人設定（room/test 隱藏）；room 路由行動版連 header 都隱藏（沉浸）；測試頁與後台入口僅 admin 渲染。
- **雷區**：被單元測試 import 的 worker 模組（session.ts/jwt.ts）必須零 `Env` 全域型別相依；JWT/任何 base64 的 UTF-8 內容不能 `JSON.parse(atob(...))`（中文亂碼）。

---

## 13. 平衡現況（test/balance.bench.ts）✅

**行為描述**：平衡工具 `npm run balance`（四類型互打數千場、抵銷紅藍位置偏差，不混進 `npm test`）。**動 `STAT_PRESETS`/`DEFAULT_ARENA`/`HP_BASE`/`DEFAULT_SPECIAL` 必重跑**。

- **現行校準（2026-06 第四輪定案＝時長重校，雙 ko=平手規則下）**：
  - 平均戰局 **26s**／中位 **31s**（目標 20~30s，`hpBase=1150` 防開場秒殺）
  - 勝負原因 **ko ~57% / spin-out ~23% / ring-out ~15.5% / draw ~4.7%**（draw 幾乎全是雙 KO、集中在 attack 鏡像對局）
  - 四類型勝率 **48.9~51.7**（帶寬 40~60）；猜拳三角 53~57（刻意收淺——三角越陡＝擊殺時間越收斂＝同步雙 KO 越多）
  - 必殺裝備勝率（鏡像實測，全 >50）：rush 64 / clone 64 / dash 62 / vortex 62 / blast 51
- **消同步雙 KO 的兩個機制**：碰撞傷害 ±10% seeded 浮動（dmgA/dmgB 獨立擲骰）+ 速度主導傷害分配（`AGGRESSOR_DMG_SPLIT`：衝得快的進攻方少吃、被撞方多吃，impact 75~185 線性淡入）——合力把雙 KO 從 25.9% 壓到 4.5%。
- **刀口參數**：`defense.attack`（atk-def 對局極敏感，±0.03 大幅擺動）、`attack.stamina`、`stamina.attack`。各比例不同 seed 有 ±1.5pp 取樣噪音，勿過度擬合單一 seed。
