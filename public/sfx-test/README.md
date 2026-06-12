# 音效選樣資料夾（sfx-test）

供 **音效選樣室 `/sfx-pick.html`** 使用：把候選音檔放進這裡、在 `manifest.json` 登記，
就能在選樣室逐槽試聽，並與「現役合成（sfx.ts）」「Lab A/B/D 引擎」並排 A/B 比較。

## 資料夾結構

```
public/sfx-test/
  manifest.json          <- 槽位 -> 檔名陣列（登記表）
  README.md              <- 本文件
  hit-light/             <- 各槽位一個子資料夾，音檔丟這裡
    clang-1.wav
    clang-2.mp3
  ko/
    explosion-a.wav
  ...
```

## 槽位鍵（manifest.json 的 key，與選樣室一一對應）

| 鍵 | 槽位 |
| --- | --- |
| `hit-light` | 撞擊-輕 |
| `hit-medium` | 撞擊-中 |
| `hit-heavy` | 撞擊-重 |
| `ko` | 擊破 KO |
| `ring-out` | 出界 |
| `spin-out` | 停轉 |
| `launch` | 發射 |
| `special-rush` | 必殺-rush（衝刺突進） |
| `special-blast` | 必殺-blast（衝擊） |
| `special-dash` | 必殺-dash（高速移動） |
| `special-vortex` | 必殺-vortex（旋渦） |
| `special-clone` | 必殺-clone（分身） |
| `win` | 勝利 |

## 支援格式

- 以 **wav / mp3** 為準（瀏覽器 `decodeAudioData` 通常也吃 ogg / m4a，但不保證跨瀏覽器）。
- 建議單聲道或立體聲、44.1kHz；檔案盡量短（撞擊類 < 0.5s、KO/勝利類 < 2s）。

## 登記方式

1. 把音檔放進 `public/sfx-test/<槽位鍵>/`，例如 `public/sfx-test/hit-heavy/anvil.wav`。
2. 在 `manifest.json` 對應槽位的陣列加上**檔名**：

   ```json
   "hit-heavy": ["anvil.wav", "anvil-alt.mp3"]
   ```

   也可以寫相對於 `public/sfx-test/` 的子路徑（例如 `"pack-a/anvil.wav"`）。
3. 重新整理 `/sfx-pick.html`，該槽位的「資料夾檔案」區就會出現播放鍵與單選；
   陣列為空或 manifest 讀不到時顯示「未提供」。

## 選擇結果的存放（開發者讀這個）

- 選樣室的每次 radio 變更會**立即**把完整選擇寫進 localStorage，鍵：**`bb-sfx-picks`**。
- JSON 格式（13 個槽位鍵全列）：

  ```json
  {
    "hit-light":  { "kind": "current" },
    "hit-heavy":  { "kind": "lab-a" },
    "ko":         { "kind": "file", "src": "/sfx-test/ko/explosion-a.wav" }
  }
  ```

  - `kind`：`"current"`（現役 sfx.ts 合成）｜`"lab-a"`｜`"lab-b"`｜`"lab-d"`（sfx-lab 引擎變體，僅撞擊×3 與 KO 槽有）｜`"file"`（資料夾音檔）。
  - `src`：僅 `kind === "file"` 時存在，為可直接 fetch 的絕對路徑（`/sfx-test/...`）。
- 選樣室頂部有「目前選擇總覽」與**複製 JSON** 鍵——使用者選完後把這份 JSON 交給開發者，
  後續開發即依此把選定音源套進 `src/audio/sfx.ts`（file 類走取樣播放、其餘搬對應合成路徑）。
