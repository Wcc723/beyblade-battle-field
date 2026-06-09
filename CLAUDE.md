# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

網頁版雙人對戰戰鬥陀螺。Vite + Vue 3 + TypeScript。目前是**單機物理引擎原型**，但全程刻意依「之後搬上 Cloudflare（Durable Object）」的方向設計。請用**繁體中文**溝通。

## Commands

```bash
npm run dev        # Vite dev server → http://localhost:5173
npm test           # vitest（引擎單元測試）
npm run test:watch # vitest watch
npm run balance    # 平衡分析：四類型互打數千場，輸出勝率/勝負原因/猜拳矩陣
npm run build      # Vite build（注意：build 不做型別檢查）
npx vue-tsc --noEmit   # 型別檢查（改完務必跑這個，build 不會幫你檢查）
```

跑單一測試：`npx vitest run -t "確定性"`（用 `-t` 比對 describe/it 名稱，名稱是中文）。

改完物理引擎或屬性/場地數值後，慣例是：`npx vue-tsc --noEmit` → `npm test` → 動到平衡時再 `npm run balance`。

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

`App.vue` 三個分頁切換對應這三塊。`simulate` 吃 `config.arena` 與 `config.special` 覆寫。

## 必殺技

兩招、opt-in（每顆獨立裝備）、seeded 機率觸發、**不影響基礎平衡**（平衡工具不裝必殺技）：

- **rush（衝刺突進）**：逼近對手時機率爆發加速 + 直接扣血。
- **blast（衝擊）**：打出夠猛的一擊時機率把對手彈開 + 扣血（可順勢擊出界）。

所有數值集中在 `engine.ts` 的 `DEFAULT_SPECIAL`，每招獨立觸發機率（`rushChance` / `blastChance`）。

## 平衡（很重要）

**平衡是「場地 × 屬性」共同決定的**——同一組陀螺換個場地勝率天差地遠。靠時間/停轉決勝 → 續航為王；靠碰撞/出界決勝 → 攻防/重量才有用。現行預設已校到接近**猜拳**（攻擊剋持久、持久剋防禦、防禦剋攻擊），四類型勝率約 46~55%。**動到 `STAT_PRESETS`、`DEFAULT_ARENA`、`HP_BASE`、`DEFAULT_SPECIAL` 後一定要 `npm run balance` 驗證。** 工具在 `test/balance.bench.ts`（用 `vitest.balance.config.ts`，不混進一般 `npm test`）。

## 容易踩的雷

- **`build` 不做型別檢查**：要 `npx vue-tsc --noEmit`。
- **`arena.collisionSpinLoss` 名實不符**：它現在是「碰撞扣**血量**」的係數（語意改過、為相容舊存檔沒改名）。
- **`ArenaConfig` 新欄位設成可選**（如 `hpBase`、`spinKnockback`）：舊 localStorage 場地沒這些欄位，引擎用 `?? 預設` 處理；新增欄位時設可選，否則測試的 `neutralArena()` 也要補。
- **不要靠「升 localStorage 版本鍵」來套用新預設**（會讓使用者既有資料讀不到）；改用「可選欄位 + 合併預設」。
- **碰撞能量夾制**：`resolveCollisions` 把碰撞後分離速度夾到 ≤ 接近速度（防超彈性無限暴衝）。需要「比彈性更強的擊退」（如 `spinKnockback`、blast）要做成**夾制之後的額外推力**，否則會被夾掉。
- **Vue DOM 更新是非同步的**：用瀏覽器自動化/JS 改了狀態後，別在同一個同步區塊讀 DOM（會讀到舊值）；改用截圖或 `nextTick`。
- 美術原始檔在 `art/`（已被 `.gitignore`，可重新處理）；對戰實際用的是 `public/beyblades/*.webp`。
