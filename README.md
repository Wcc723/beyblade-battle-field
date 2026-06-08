# ⚔️ 戰鬥陀螺 Beyblade Arena

網頁版雙人對戰戰鬥陀螺。目前進度：**物理引擎原型（Vite + Vue）**。

## 這是什麼

- **對戰模型：確定性批次模擬**
  雙方設定發射參數（類型 / 起始位置 / 發射方向 / 力道 / 自旋）→ 同時發射 →
  伺服器**一次算完整場**對戰 → 輸出完整軌跡 (frames) → 前端**回放**動畫。
- 因為「只有伺服器算、前端只播放」，所以：
  - ✅ 伺服器權威，客戶端無法作弊（只送發射輸入）
  - ✅ 雙方畫面 100% 一致（播同一份軌跡）
  - ✅ 沒有跨平台浮點數一致性問題（前端不重算）
  - ✅ 不需要高頻 game loop，極省 Cloudflare 運算成本

## 開發 / 執行

```bash
npm install
npm run dev      # 本機視覺化原型 → http://localhost:5173
npm test         # 物理引擎單元測試 (vitest)
npm run build    # 正式建置
```

## 專案結構

```
src/
├── physics/              # 純 TS 物理引擎（無瀏覽器 / Cloudflare 相依）
│   ├── types.ts          #   型別定義
│   ├── engine.ts         #   simulate() 批次模擬 + buildInit()
│   ├── presets.ts        #   攻擊/防禦/持久/平衡 四種屬性預設
│   └── prng.ts           #   確定性亂數（保留供未來用）
├── store/
│   ├── arenaStore.ts     # 場地預設 CRUD（localStorage；之後可換成 D1 / DO）
│   ├── statStore.ts      # 陀螺屬性覆寫（localStorage，預設取自 STAT_PRESETS）
│   └── specialStore.ts   # 必殺技數值覆寫（localStorage，預設取自 DEFAULT_SPECIAL）
├── components/
│   ├── BattleViz.vue     # 對戰場：拖曳發射 + 分開發射 + 統一運算 + 軌跡回放
│   ├── ArenaAdmin.vue    # 場地後台：編輯 / 存多組 / 切換套用場地
│   └── BeybladeAdmin.vue # 陀螺後台：編輯四種類型的 攻/防/續/重
├── App.vue               # 分頁導覽（對戰場 / 場地後台 / 陀螺後台）
└── main.ts
test/
└── engine.test.ts        # 確定性 / 停轉 / 出界 / 超時 / 碰撞 / 攻防
```

> **重點**：`src/physics/` 是純函式模組，未來可**原封不動**搬進 Cloudflare
> Durable Object 當伺服器權威運算用。瀏覽器這份只是把它接到 canvas 做視覺化。

## 物理模型概要

每顆陀螺有**旋向**（+1 逆時針/右旋、-1 順時針/左旋）。每個固定時間步 (1/60s)：
1. 朝場地中心的固定向心力（碗的斜度）
2. 自旋造成的繞圈力（進動 → 螺旋運動），**方向依旋向**
3. 線性摩擦
4. 位移
5. 自旋（續航條）隨時間衰減，續航越高衰減越慢 → 歸零即停轉

碰撞時：依質量推開消除重疊 → 反彈衝量 ×`knockback`（受攻防修正）→ **雙方依攻防扣「血量」**
（碰撞傷害係數沿用 `arena.collisionSpinLoss`）。衝量另有**能量夾制**（分離速度 ≤ 接近速度，防超彈性暴衝）。
**反向旋轉（左右旋對撞）**會觸發 `oppSpinBonus` 加成 → 擊退與傷害都更猛（同向為基準）。

**護牆**：陀螺碰到場地邊界會反彈回場內；只有撞牆瞬間「向外速度」超過
`ringOutSpeed` 門檻（被打得夠猛）才會衝出護牆 Ring-out。

**2.5D 高度**：猛烈碰撞會把陀螺頂上天（z 軸 + 重力 `gravity`），落地才恢復；
兩者高度差超過 `jumpOverHeight` 時可從對手上方掠過、不發生碰撞。
權威物理仍以 2D (x,y) 計算，z 只是附加的縱軸，伺服器運算量幾乎不變。

**雙資源**：每顆有 **自旋（續航條，隨時間衰減）** + **血量（耐久條，碰撞扣）** 兩條。
四圍分工：攻擊=扣血+擊退、防禦=減傷+減擊退、重量=血量上限(`HP_BASE×weight`)+抗出界、續航=自旋衰減慢。

**勝負**：出界 (ring-out) / 停轉 (spin-out，自旋耗盡) / 擊破 (ko，血量耗盡) / 時間到比體力 (timeout) / 爆裂 (burst)。
已校到接近猜拳：攻擊剋持久、持久剋防禦、防禦剋攻擊（四型勝率約 46~52%，`npm run balance` 可驗）。

**收尾演出**：勝負底定後再多模擬 `followThroughTime`（預設 2.5s）—— 出界陀螺持續
飛出、勝方續轉，演完才跳勝利橫幅。回放時**僅在終結瞬間**（出界/停轉，記於
`slowmoCues`）觸發慢動作，對戰過程的撞擊不放慢。

## 必殺技

每顆陀螺可選一招（前端「必殺技」選單）；模擬中事件發生時用 **seeded PRNG 擲 ~20% 機率**
決定發動 → 帶機率仍**確定性**（同 seed 同結果）。已實作 2 招（框架可擴充）：

- **衝刺突進 (rush)**：剛逼近對手時，機率朝對手爆發加速 → 製造猛撞 / 擊飛，**並直接扣對手血量 `rushDamage`**。
- **爆裂 (burst)**：裝備者打出夠猛的一擊、且對手**血量**低於門檻時，機率瞬殺對手。

回放在發動瞬間畫光環 + 標籤（突進! / 爆裂!）。必殺技為 opt-in，不影響 `npm run balance` 的基礎平衡。
所有數值集中成 **`SpecialConfig`**（`DEFAULT_SPECIAL`）→ 存 `specialStore.ts`(localStorage) →
**「陀螺後台 › 必殺技數值」可即時調**（觸發率 / 衝刺傷害·加速·距離·冷卻 / 爆裂門檻·血量線）。

## 計分賽制（多回合）

採「**先到 N 分**」（預設 3 分）多回合制；每回合結束依結果計分：

- **出界**：依**落點分區** —— 護牆「缺口」（上 / 下口，畫面標 `2×` 金色）2 分、其餘 1 分
- **爆裂**：2 分　**停轉 / 時間到**：1 分　**平手**：0 分

引擎回報出界角度 `ringOutAngle`（權威資料），前端 (`BattleViz`) 定義缺口位置 (`POCKET_ANGLES`)
與計分 (`roundPoints` / `pocketPoints`)；每回合用不同 seed。先到 N 分者奪冠。

## 操作流程（對戰場）

採「分開發射 → 伺服器統一運算」，貼近未來雲端流程。**落點 = 按下位置**，發射有兩種模式（可切換）：

- **甩動 (flick)**：看放手瞬間的拖曳速度決定方向與力道（取最近約 80ms 樣本估速度），整個視窗都能甩。
- **拉弓 (sling)**：往後拉蓄力，拉的距離 → 力道、反方向 → 角度。

流程：
1. 紅方 A：在場上設定落點並發射
2. 藍方 B：換手同樣發射
3. 雙方都發射後 → `runServerSimulation()` 用同一份引擎統一運算 → 回放軌跡

> `runServerSimulation()` 就是未來搬進 **Battle Room Durable Object** 的那段：
> 收齊雙方發射輸入 → `simulate()` → `getWebSockets()` 廣播結果。
> 拖曳用 Pointer Events，手機觸控與滑鼠通用。

## 場地後台 / 陀螺後台

- `場地後台`：編輯全部場地參數、**存多組**、選擇**套用哪一組**（localStorage）。
- `陀螺後台`：編輯四種類型的 攻/防/續/重（localStorage，預設取自 `STAT_PRESETS`）。

對戰場進場時讀取目前套用的場地與陀螺屬性。接雲端時把 `arenaStore.ts` / `statStore.ts`
換成讀寫 D1 / DO SQLite 即可，介面不變。

## 平衡（npm run balance）

`npm run balance` 會讓四類型互打數千場，輸出**勝率、勝負原因、對戰矩陣**。
平衡是「**場地 × 屬性**」共同決定的——同一組陀螺換個場地勝率天差地遠：
靠**時間/停轉**決勝 → 續航(stamina)為王；靠**碰撞/出界**決勝 → 攻擊/防禦/重量才有用。

現行預設已校到接近**猜拳**：攻擊剋持久、持久剋防禦、防禦剋攻擊，
四類型整體勝率約 46~58%（原本失衡到 stamina 100% / attack 7%）。
改 `STAT_PRESETS` 或 `DEFAULT_ARENA` 後重跑 `npm run balance` 即可驗證。

## 美術資產（陀螺貼圖）

四型俯視貼圖用 codex (`codex-cli-image` skill) 生成 → 去背 (chroma-key) → 多尺寸 WebP，
放在 `public/beyblades/<type>-{256,128,64}.webp`（每張僅 2~20KB）。
canvas 依類型載入 128px、依 `angle` 旋轉繪製；貼圖未載入時自動退回程式繪製（圓+刀刃）。
原始 PNG 與去背檔在 `art/raw/`（保留供重新處理；非必要產物）。

## 後續路線（接 Cloudflare）

引擎手感調好後，依序：

1. `wrangler` 專案：Worker + Static Assets（托管這個前端）
2. **Battle Room Durable Object**：每場一個 DO，持有雙方 WebSocket、
   呼叫 `simulate()`、用 `getWebSockets()` 廣播軌跡結果
3. **Matchmaker Durable Object**：隨機配對佇列
4. **D1**（帳號 / 排行榜）+ **DO 內建 SQLite**（每場戰績 / 回放）
5. **R2**：素材 / 回放歸檔（可做觀戰、分享）
6. 斷線 / 重連 / 超時（DO `alarm()`）處理
```
