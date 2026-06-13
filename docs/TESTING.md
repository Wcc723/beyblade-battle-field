# 測試規範與指南 TESTING.md

本文件是 beyblade-arena 測試套件的事實來源。先讀 `CLAUDE.md`（整體架構、平衡哲學）再讀本文件——這裡聚焦「測試怎麼跑、怎麼讀輸出、怎麼寫新測試、踩過哪些雷」。

測試的核心信念與整個專案一致：**確定性批次模擬**。引擎是純函式、零瀏覽器/Cloudflare 相依，所以絕大多數測試只是「組裝 init → `simulate()` → 斷言結果/`frames`」，不需要 DOM、不需要 worker runtime、不需要 D1。

---

## 1. 測試分層與檔案表

測試分成三類，跑法與目的都不同：

| 類別 | 檔案 | 跑法 | 性質 |
|------|------|------|------|
| **引擎/邏輯單元測試** | `test/*.test.ts`（9 檔） | `npm test` | 斷言式、快、CI 必過 |
| **平衡分析** | `test/balance.bench.ts`、`test/balance-special.bench.ts` | `npm run balance` | 輸出統計 `console.log`、人工判讀、**不進 CI** |
| **worker 邏輯** | `test/auth.test.ts`、`test/session.test.ts` | `npm test`（同上） | 跑在 node、零 `Env` 全域相依 |

注意：bench 檔副檔名是 `.bench.ts`，**不在 `npm test` 的 glob（`test/**/*.test.ts`）內**——這是刻意的（見 §4）。

### 各測試檔涵蓋範圍

| 檔案 | 涵蓋 | 為何重要（影響其他模組的關鍵不變量） |
|------|------|------|
| `engine.test.ts` | 物理引擎全規則：確定性、spin-out/ring-out/timeout/ko 判負、護牆反彈、follow-through 收尾演出、碰撞分離與能量夾制、攻防/旋向影響傷害、2.5D 彈跳（z/jumpOverHeight）、邊緣分區 rim（break/pocket/wall）、方形邊界 box（四邊反彈/四角出界/切向保留）、加速軌道 rail、綠色軟牆幾何（手繪 M 拱）與實體內牆（貼地擋/騰空越）、綠色加速區、回放特效事件（collisionEvents/deathEvents）、必殺技觸發+冷卻+每回合限次、dash/vortex/clone | 引擎是伺服器與前端**共用**的權威。任何改動都可能破壞 DO 與前端兩端重跑的一致性 → 這支是最大的回歸網 |
| `crit.test.ts` | 會心一擊（每碰撞每側獨立擲骰、機率=`stats.crit` 預設 0.05、命中後 50/50 決定 `dmg`×1.5 或 `kb`×2）+ 必殺強度 `specialPower`（冷卻 ×(2−s)、rush/blast/clone 傷害 ×s；dash/vortex 不吃 s）。鎖死「crit 參數不位移 rng 流」這個關鍵不變量 | crit 與 specialPower 是名冊個體差的兩個維度，DO 組裝 stats 時會帶進去；若 rng 流被位移，同 seed 兩端重跑就會分歧 |
| `damage-scoring.test.ts` | 傷害浮動 ±10%（兩側獨立擲骰、是唯一傷害不對稱來源）、`CollisionEvent` 擴充（aId/bId/dmgA/dmgB）、必殺開場緩衝 `graceTime`（legacy 統一欄位 + 分招 `*GraceTime` 優先序）、dash 回血夾制（≤10% maxHp、不超過 maxHp）、**同步雙亡 tie-break**（雙 ko=平手、雙停轉/雙出界比剩餘血量比例）、計分新制 `roundPoints` | 同步死亡規則是使用者裁定的，計分 `roundPoints` 前端與 DO 共用 → 這支鎖死兩個會直接影響玩家可見勝負的規則 |
| `room.test.ts` | 線上對戰協定純函式：`sanitizeAim`（伺服器發射消毒，落點夾回、力道夾到 1、非法回 null）、`buildInitFromAim`（與前端 makeInit 同公式）、`mergeLoadout`（client 只能換自己 lineup 內的陀螺）、`sideSpinDir`（A 右旋/B 左旋固定）、BOT `randomBotAim`/`randomBotLoadout`、`WIN_SCORE=3` | 防竄改邊界。client 送的任何輸入都先過 `sanitizeAim`/`mergeLoadout`；這支鎖死「外掛改不動 stats、偷不到沒帶的陀螺」 |
| `beyblades.test.ts` | 陀螺名冊：規模/唯一性、個體差 `mods` contract（只能四圍、0.92~1.08、每顆 1~2 欄）、`crit`/`specialPower` 範圍、無全維度優勢顆、`getBey`/`beyFullName`/`resolveBeyStats`、`DEFAULT_LINEUP`，**+ 凍結鎖（條目數=10、id+name checksum）** | 名冊 id/name 存進 D1 與線上協定；亂動會讓既有玩家陣容指向錯亂。凍結鎖逼你只能「原位替換 + 更新 checksum」 |
| `names.test.ts` | 中二名稱系統：名池規模/不重疊/禁詞掃描（官方戰鬥陀螺詞彙不可沾）、`autoNickname`/`beybladeName` 穩定 hash 確定性與分佈，**+ 凍結鎖（池長 116/66、內容 checksum）** | `autoNickname`/`beybladeName` 用「hash % 池長」選名 → 任何插入/刪除/重排都讓全服名字洗牌。凍結鎖是使用者明確要求「名字不可因部署而變動」的硬保證 |
| `arcwall.test.ts` | 弧壁競技場（超橢圓邊界 `superellipse.power`）：r(θ) 對角正規化幾何、法線單位向量、確定性、多 seed 邊界反彈不穿牆、四對角 pocket（2 分、門檻 220）vs 四邊中段一般牆（門檻極高必反彈）、中速繞行不出界迴歸 | 弧壁場的 `boundaryRadiusAt`/`sampleBoundary` 被**引擎與 ArenaSvg 共用**（畫面物理同源）；幾何測試鎖死「視覺出界區與物理出界扇區重合」這個前提 |
| `auth.test.ts` | `decodeJwtPayload`：Google OAuth JWT payload 解碼，**中文姓名不亂碼**（防回歸：`JSON.parse(atob(...))` 對 UTF-8 會壞）、格式不對回 null 不丟例外 | OAuth 是整站登入入口；中文亂碼會讓暱稱/姓名整批壞掉。這是踩過的雷的回歸鎖 |
| `session.test.ts` | `signSession`/`verifySession`：HMAC 簽章往返、payload 竄改/錯密鑰/過期一律驗證失敗回 null、亂 token 不丟例外 | session 是全站授權憑證；被偽造就等於越權。`session.ts`/`jwt.ts` 必須零 `Env` 全域型別相依才能在 node 測試 import |

---

## 2. 執行指令

```bash
npm test                       # 跑全部單元測試一次（CI 用）→ vitest run
npm run test:watch             # watch 模式（改檔即重跑）→ vitest
npx vitest run -t "確定性"      # 只跑名稱含「確定性」的 describe/it（名稱是中文）
npm run balance                # 平衡分析（兩支 bench）→ vitest run -c vitest.balance.config.ts
```

**單一測試**用 `-t` 比對 `describe`/`it` 名稱（子字串、可跨多檔命中）。名稱全是中文，例如 `-t "停轉判負"`、`-t "sanitizeAim"`、`-t "凍結鎖"`。

要只跑某一檔：`npx vitest run test/crit.test.ts`。

慣例工作流（改完物理引擎或屬性/場地數值後）：
```
npm run typecheck   →   npm test   →   動到平衡時再 npm run balance
```
`npm run typecheck` 涵蓋前端 `vue-tsc` 與 worker `tsc -p tsconfig.worker.json` 兩套——**`npm run build` 不做型別檢查**，務必另跑。

---

## 3. 設定檔：為什麼 vitest 三套分離

| 設定 | 用途 | 關鍵差異 |
|------|------|----------|
| `vite.config.ts` | dev / build | 掛了 `@cloudflare/vite-plugin`（會啟動 worker runtime） |
| `vitest.config.ts` | `npm test` | **不重用 vite.config.ts**：只掛 `@vitejs/plugin-vue`、`environment: "node"`、glob `test/**/*.test.ts`。刻意不掛 cloudflare plugin，避免測試啟動 worker runtime |
| `vitest.balance.config.ts` | `npm run balance` | 只 include 兩支 `.bench.ts`、`fileParallelism: false`（兩支依序跑 → `console.log` 輸出不交錯） |

改 vite 設定時要記得兩邊（dev/build 的 `vite.config.ts` 與測試的 `vitest.config.ts`）都想到。

worker 端被單元測試 import 的模組（`session.ts`/`jwt.ts`）**必須零 `Env` 全域型別相依**——root tsconfig 沒有 workers runtime 型別，混進去 typecheck 與測試都會炸。

---

## 4. 為什麼 balance 與一般測試分離

兩個理由：

1. **性質不同**：bench 不是斷言式測試，它跑數千場對戰然後 `console.log` 統計表（勝率/勝負原因/猜拳矩陣/時長），**靠人工判讀**，不該讓它 fail CI（取樣噪音會讓硬斷言不穩定）。
2. **耗時**：每支 bench 設了 `300_000`（300 秒）的 timeout，跑幾千場模擬；混進 `npm test` 會拖垮快速回饋迴圈。

所以 bench 用 `.bench.ts` 副檔名（被 `npm test` 的 glob 排除）+ 專屬設定檔。

---

## 5. 平衡工具：輸出怎麼讀、目標值

### `balance.bench.ts`（基礎平衡：四類型互打、刻意不裝必殺）

每個對局每方向 `N=150` 場，紅藍對調抵銷位置偏差。輸出五張表：

1. **各類型整體勝率**（對其他三類型平均）
2. **戰局時長**（秒，不含 followThrough；平均/中位/p10/p90 + 各勝負原因平均時長）
3. **勝負原因分佈**（ring-out / spin-out / timeout / draw / ko / burst）
4. **平手構成**（雙 ko / 雙 spin-out / 雙 ring-out / 混合同步 / 其他，佔全部場數 %）
5. **對戰勝率矩陣**（列 vs 欄）+ **每組對局勝負原因分解**

**現行校準目標值**（2026-06 第三輪定案，雙 ko=平手規則下）：
- 勝負原因：**ko ~54% / spin-out ~29% / ring-out ~12% / draw ~4.5%**
- draw 幾乎全是雙 KO、集中在 attack 鏡像對局（~20%）
- 四類型勝率：**48.8 / 49.3 / 50.8 / 51.1**（attack/defense/stamina/balance）
- 猜拳三角刻意收淺（54~56）——三角越陡＝擊殺時間越收斂＝同步雙 KO 越多
- 戰局時長目標帶 **20~30s**

### `balance-special.bench.ts`（必殺技平衡）

每方向 `N=120` 場（每格 2N=240，side-averaged）。`seedCounter++` 遞增 seed 讓 seeded 必殺觸發在各場間有變異。三張表：

- **實驗 B 必殺增益**：同型鏡像、一方裝技一方不裝 → 裝技方勝率（>50%=增益）。按四型分欄看「哪招適合哪型」。
- **實驗 C 必殺互打**：balance 型雙方各裝一招 → 招 vs 招矩陣（誰剋誰）。
- **招式強度排行**（依實驗 B 平均增益）。

**設計目標**：裝技明顯強於不裝（刻意）——鏡像實測 dash ~74% / rush ~71% 勝率。**平衡工具（balance.bench.ts）本身不裝必殺技**，避免必殺污染基礎平衡。

### 何時必須重跑 balance

動到 `STAT_PRESETS`、`DEFAULT_ARENA`、`HP_BASE`、`DEFAULT_SPECIAL` 任一就要 `npm run balance` 驗證。**平衡是「場地 × 屬性」共同決定**——同一組陀螺換場地勝率天差地遠。

刀口參數提醒：`defense.attack` 對 atk-def 對局極度敏感（±0.03 可大幅擺動勝率），動它必重跑。

**重校後別忘了同步線上值**：D1 `global_config` 會蓋過程式碼預設 → 用 migration（如 0004）清舊 blob 回落新預設。

---

## 6. 確定性測試怎麼寫

確定性是整個架構的地基（伺服器算、兩端只重跑同一份引擎），所以幾乎每支引擎相關測試都有一條「同 seed 逐位元一致」的鎖。標準寫法：

```ts
const mk = (seed: number) => simulate(inits, { dt: 1/60, maxTime: 30, arena, seed });
expect(JSON.stringify(mk(7).frames)).toBe(JSON.stringify(mk(7).frames));
```

要點：
- **逐位元比對**用 `JSON.stringify(frames)` 相等，或對單值用 `toBe`（=`Object.is`，比 `toEqual` 嚴格，能抓到 `-0`/`+0`、`NaN`）。
- 連 `collisionEvents`/`deathEvents`/`specialEvents` 都要一致（它們會被廣播、前端據以重現特效/傷害數字）。
- 跨平台浮點數一致性**不是問題**——因為只有伺服器算、前端只重播 frames（同一份程式碼、同 seed）。
- 必殺/crit 的「rng 消耗固定」是隱藏前提：crit 參數不同也消耗一樣多 rng（每碰撞 4 次、沒中也消耗）→ 才能用同 seed 的 crit=0 對照組精準驗「恰為 1.5x」。寫新的擲骰邏輯時務必維持「擲骰次數與機率值無關」。

### `neutralArena()` 慣例

每支引擎測試檔自帶一個 `neutralArena(overrides)` helper：把所有場地係數清零（friction/swirl/spinDecay/restitution... 全 0、`knockback/oppSpinBonus=1`），只打開要驗的那一條規則。這是「隔離單一物理規則」的標準手法——驗 spin-out 就只開 `spinDecayBase`，驗 ring-out 就只調 `radius`/`ringOutSpeed`。

常見技巧：把 `radius` 設超大（`5000`/`1e6`）讓兩顆永不出界 → 純驗碰撞/傷害；把 `ringOutSpeed` 設超高 → 只反彈不出界；`spin: 1e6`/`1e9` 讓對手永不停轉 → 隔離出對手的死法。

**注意 `neutralArena` 各檔是各自複製的**（`engine.test.ts`/`crit.test.ts`/`damage-scoring.test.ts` 各有一份）——這是刻意讓每檔自足。`arcwall.test.ts` 不用 neutralArena，直接吃 `ARC_WALL_STADIUM`。

### ArenaConfig 可選欄位要補預設

`ArenaConfig` 的新欄位設成**可選**（如 `hpBase`、`spinKnockback`、`box`、`softWall`、`rim`、`rail`、`superellipse`）——舊 localStorage 場地沒這些欄位，引擎用 `?? 預設` 處理。

**寫測試的對應慣例**：新增可選欄位後，若它有非零預設行為，記得在 `neutralArena()` 的回傳裡補上（否則中性場會意外帶到該行為）。反過來，測 box/softWall 等進階邊界時，用 `neutralArena({ box: {...} })` 把它疊加上去。

`arena.collisionSpinLoss` **名實不符**：它現在是「碰撞扣**血量**」的係數（語意改過、為相容舊存檔沒改名）——寫傷害測試時別被名字騙了。

---

## 7. 凍結鎖測試（checksum 機制）

兩處用 FNV-1a checksum 把資料「凍結」：

- `names.test.ts`：`NICKNAME_POOL`（116）+ `BEYBLADE_POOL`（66），checksum `12b004d0` / `ff147126`。
- `beyblades.test.ts`：`BEYBLADES` 條目數（10）+ id+name 串接 checksum `132f762a`。

**為什麼凍結**：這些資料用「hash % 池長」或「id 存 DB」的方式對應到既有使用者/陣容。插入/刪除/重排/改名都會讓全服名字洗牌、或讓既有玩家陣容指向錯亂。

**何時更新 checksum**：
- 名池：**只准「原位替換」單一條目**（不可調整順序與長度）。替換後 checksum 會變 → 測試 fail → 逼你有意識地重算並貼回新值，同時接受「該位置對應的使用者名字會改變」。
- 名冊：要動 roster **只准「追加新顆」（改條目數鎖）或修數值（mods/crit 不入鎖）**。若真要改 id/name，鎖會逼你更新常數並處理既有資料遷移。

更新 checksum 的算法就寫在測試檔裡（`fnv1a`）——改完資料把它的輸出印出來貼回 `toBe(...)` 即可。**切勿為了讓測試過而盲改 checksum**——它存在的意義就是攔住無意識的順序/長度變動。

---

## 8. 撰寫新測試的步驟與範例

### 物理規則測試（最常見）

1. 複製目標檔現成的 `neutralArena()` 與 `body()` helper（或 import）。
2. 用 `body({ id, position, velocity, spin, stats, special, ... })` 組裝兩顆 init（`body` 只要求 `id`，其餘有預設）。
3. 用 `neutralArena({ 只開要驗的係數 })` 當場地，必要時把 `radius` 放大以隔離。
4. `simulate(inits, { dt: 1/60, maxTime, arena, seed, special })`。
5. 斷言：從 `r.frames`/`r.reason`/`r.winnerId`/`r.collisionEvents`/`r.specialEvents` 取值。取末幀身體常用 `r.frames.at(-1).bodies.find(b => b.id === "A")`。
6. **務必加一條確定性鎖**（同 seed 兩跑 `JSON.stringify` 相等）。

範例（驗某係數讓傷害變大）——對照組同 seed、只改要驗的變數：
```ts
const run = (k: number) => simulate(pair, { dt:1/60, maxTime:1,
  arena: neutralArena({ collisionSpinLoss: k, radius: 1e6 }), seed: 5 });
expect(hp(run(2),"B")).toBeLessThan(hp(run(1),"B"));   // 同 seed → 唯一變數是 k
```

機率性必殺/crit 的「有觸發但非必中」標準寫法（掃多 seed 數命中次數）：
```ts
let fired = 0; const N = 60;
for (let s = 1; s <= N; s++) if (mk(s).specialEvents.some(e => e.kind === "blast")) fired++;
expect(fired).toBeGreaterThan(0); expect(fired).toBeLessThan(N);
```

精準量測機率（Bernoulli 大樣本）：用「單次乾淨對撞 × 數千 seed」，每場恰好兩側各擲一次，再算落在區間內（如 crit 0.05 → 3%~7%，N=4000 是 ±5.8σ，不靠運氣）。

### 協定/邏輯測試（room/scoring）

純函式，直接呼叫斷言：`sanitizeAim(input, arena)`（合法回正規化值、非法回 null）、`mergeLoadout(base, patch, allowed)`（白名單外整段忽略）、`roundPoints(arena, simResult)`。`roundPoints` 測試可手搓一個最小 `SimResult` 物件（只填 `winnerId`/`reason`/`ringOutAngle`，其餘空陣列）——見 `damage-scoring.test.ts` 的 `res()` helper。

### worker 測試（auth/session）

跑在 node、用 WebCrypto（`crypto.subtle`）+ `TextEncoder`/`btoa`。session 簽章測試是 `async`（HMAC 是 Promise）。偽造 token 要用**與實作相同的 UTF-8 → base64url 編法**（先 bytes 再 `btoa`），不能 `btoa(JSON.stringify(...))`（中文會壞）——這同時是被驗的不變量。

---

## 9. 常見陷阱

- **WAL 不同步**：`npm run db:migrate`（`wrangler d1 ... --local`）**不要在 dev server 跑著時執行**——兩個 miniflare 開同一 SQLite、WAL 不同步會壞資料。這跟 vitest 無關，但是測試/開發環境最常見的踩雷。
- **bench timeout**：兩支 bench 都設 `300_000`（300s）。場數大幅調高或在慢機器上跑可能還是會 timeout → 調 `N` 或拉高 timeout，別把它搬進 `npm test`。
- **±1.5pp 取樣噪音勿過度擬合**：各勝負原因比例在不同 seed 有 ±1.5pp 噪音，四類型勝率也有抖動。**不要對單一 seed 的數字過度擬合**參數；看趨勢與多次跑的中位，別追求把某個百分比釘到小數點。
- **`build` 不做型別檢查**：測試過 ≠ 型別過。改完務必 `npm run typecheck`（前端 vue-tsc + worker tsc 兩套）。
- **`tsconfig.worker.json` 連同 `src/physics` 一起檢查**（lib 只有 ESNext、無 DOM）：引擎一旦混入瀏覽器相依，typecheck 會擋下來——這也是為什麼引擎能直接在 node 測試而不需 DOM。
- **Object.is 比 toEqual 嚴格**：確定性逐位元比對用 `toBe`（捕捉 `-0`/`NaN`）；近似值用 `toBeCloseTo`（注意第二參數是「小數位數」不是容差，`toBeCloseTo(x, 9)` 是 9 位）。
- **`HP_BASE` 與 weight**：`maxHp = HP_BASE × weight`（程式現值 `HP_BASE = 1150`）。傷害/血量測試若硬寫數字，改 `HP_BASE` 時要同步——優先 import `HP_BASE` 而非寫死。
- **`neutralArena` 各檔各一份**：在某檔加了新可選欄位的預設處理後，其他檔的 `neutralArena` 不會自動同步。若該欄位影響跨檔測試，要逐檔補。
