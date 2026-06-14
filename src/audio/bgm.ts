/**
 * 背景音樂 —— WebAudio 解碼播放（與音效共用同一個 AudioContext）。
 *
 * 早期版本用 HTMLAudioElement 串流，但在手機（尤其 iOS）會被系統當成「媒體播放」：
 * 鎖屏/控制中心冒出音樂控制列，且與 WebAudio 音效搶音訊通道 → 衝突、像開了串流音樂。
 * 改為 fetch → decodeAudioData → AudioBufferSourceNode，接進 sfx 的 AudioContext：
 * 單一音訊 session、無媒體控制列、與音效不衝突。代價是整首載入記憶體（每首數 MB、進對戰才下載）。
 *
 * 隨機播放：進對戰隨機選一首，播完隨機換另一首（偏好換到另一首，避免一直重複）。
 * autoplay 限制：context 可能 suspended（需手勢）→ 標記 pending，tryResumeBgm 補播。
 * 開關狀態存 localStorage（與 SFX 獨立——有人要音效不要音樂）。
 */
import { ref } from "vue";
import { getSfxContext } from "./sfx";

const TRACKS = ["bgm-0", "bgm-1"];
const VOLUME = 0.16; // 背景音樂壓低，不蓋過打擊音效
const STORAGE_KEY = "bb-bgm-on";

function loadEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) !== "0"; // 預設開
}

/** BGM 開關（UI 綁定）；變更即持久化。 */
export const bgmEnabled = ref(loadEnabled());

let gain: GainNode | null = null;
let source: AudioBufferSourceNode | null = null;
let curIdx = -1;
let wantPlaying = false; // 是否「應該」在播（對戰中）
let pendingPlay = false; // context 被 autoplay 擋下 → 等手勢補播
let playToken = 0; // 防 race：切歌/停止後，舊的 decode 完成不該再啟動
const bufCache = new Map<string, AudioBuffer>();

/** 取（並快取）解碼後的整首 buffer；缺檔/解碼失敗 → null（靜默無 BGM，音效仍在）。 */
async function getBuffer(ctx: AudioContext, key: string): Promise<AudioBuffer | null> {
  const cached = bufCache.get(key);
  if (cached) return cached;
  try {
    const res = await fetch(`/api/sfx/${key}.mp3`);
    if (!res.ok) return null;
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    bufCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

/** BGM 走獨立 gain → 直入 destination（不過音效的壓縮/限幅鏈，避免被 pump/限幅染色）。 */
function ensureGain(ctx: AudioContext): GainNode {
  if (!gain) {
    gain = ctx.createGain();
    gain.gain.value = VOLUME;
    gain.connect(ctx.destination);
  }
  return gain;
}

function stopSource(): void {
  if (source) {
    source.onended = null; // 手動停止不觸發「播完換一首」
    try {
      source.stop();
    } catch {
      /* 尚未 start / 已停 */
    }
    source.disconnect();
    source = null;
  }
}

/** 隨機選一首播放（preferSwitch＝盡量換到「非當前」那首）。 */
async function playRandom(preferSwitch = false): Promise<void> {
  const ctx = getSfxContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    pendingPlay = true; // 等手勢（tryResumeBgm）
    return;
  }
  let idx = Math.floor(Math.random() * TRACKS.length);
  if (preferSwitch && TRACKS.length > 1 && idx === curIdx) idx = (idx + 1) % TRACKS.length;
  curIdx = idx;
  const token = ++playToken;
  const buf = await getBuffer(ctx, TRACKS[idx]);
  // decode 期間使用者可能已停止/關閉/又切歌 → 過期就放棄
  // （context 若在 decode 間被掛起也無妨：start() 只是排程，resume 時自然從頭播）
  if (!buf || token !== playToken || !wantPlaying || !bgmEnabled.value) return;
  pendingPlay = false;
  stopSource();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ensureGain(ctx));
  src.onended = () => {
    if (src === source && wantPlaying && bgmEnabled.value) void playRandom(true); // 播完換一首
  };
  source = src;
  src.start();
}

/** 進對戰時呼叫：開始隨機播放 BGM（已關閉則不播）。 */
export function startBgm(): void {
  wantPlaying = true;
  if (!bgmEnabled.value) return;
  void playRandom(false);
}

/** 離開對戰時呼叫：停止並重置。 */
export function stopBgm(): void {
  wantPlaying = false;
  pendingPlay = false;
  playToken++; // 作廢進行中的 decode
  stopSource();
}

/** 使用者首次手勢後呼叫：resume 共用 context + 補播被 autoplay 擋下的 BGM。 */
export function tryResumeBgm(): void {
  const ctx = getSfxContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  if (pendingPlay && wantPlaying && bgmEnabled.value && !source) void playRandom(false);
}

/** 切換 BGM 開關：開→（對戰中則立即播）、關→停。 */
export function toggleBgm(): void {
  bgmEnabled.value = !bgmEnabled.value;
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, bgmEnabled.value ? "1" : "0");
  if (bgmEnabled.value) {
    if (wantPlaying) void playRandom(false);
  } else {
    stopSource();
    pendingPlay = false;
  }
}
