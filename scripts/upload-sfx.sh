#!/usr/bin/env bash
# 打擊音效取樣上傳（音檔不進 repo，直傳 R2）。
# 來源：Kenney Impact Sounds（CC0）https://kenney.nl/assets/impact-sounds
# 轉檔（Safari 的 decodeAudioData 不吃 ogg → 轉 44.1k/16bit WAV）：
#   ffmpeg -i impactMetal_light_000.ogg -ar 44100 -sample_fmt s16 hit-l-0.wav
# 命名約定：hit-l-N / hit-m-N / hit-h-N（撞擊輕中重 ×5）、ko-N（擊破重鈑 ×5）。
# 改音色＝換新檔名重傳（路由是 immutable 長快取，同名覆蓋舊快取不會更新）。
#
# 用法：./scripts/upload-sfx.sh <wav資料夾> [--local]
#   --local：放進本地 miniflare 模擬（dev server 要先停，避免狀態庫競寫）
set -euo pipefail
DIR="${1:?用法：upload-sfx.sh <wav資料夾> [--local]}"
FLAG="${2:---remote}"
for f in "$DIR"/*.wav; do
  k="$(basename "$f")"
  echo "→ $k"
  npx wrangler r2 object put "beyblade-sfx/$k" --file "$f" --content-type audio/wav "$FLAG"
done
echo "完成。驗證：npx wrangler r2 object get beyblade-sfx/hit-h-0.wav $FLAG --file /tmp/v.wav"
