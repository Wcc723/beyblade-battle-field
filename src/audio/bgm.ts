/**
 * 背景音樂 —— 使用者提供的曲目（mp3 → R2 bucket beyblade-sfx，串流播放）。
 * 用 HTMLAudioElement（非 Web Audio decodeAudioData）：2~3 分鐘的歌串流播放、不全載入記憶體；
 * 支援 Range 請求（worker /api/sfx/ 已開）。
 *
 * 隨機播放：進對戰隨機選一首，播完隨機換一首（偏好換到另一首，避免一直重複）。
 * autoplay 限制：第一次嘗試播放被擋 → 標記 pending，使用者首次手勢（resumeAudio 同步呼叫
 * tryResumeBgm）時補播。開關狀態存 localStorage（與 SFX 獨立——有人要音效不要音樂）。
 */
import { ref } from "vue";

const TRACKS = ["bgm-0", "bgm-1"];
const VOLUME = 0.3; // 背景音樂壓低，不蓋過打擊音效
const STORAGE_KEY = "bb-bgm-on";

function loadEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) !== "0"; // 預設開
}

/** BGM 開關（UI 綁定）；變更即持久化。 */
export const bgmEnabled = ref(loadEnabled());

let audio: HTMLAudioElement | null = null;
let curIdx = -1;
let pendingPlay = false; // autoplay 被擋 → 等手勢補播
let wantPlaying = false; // 是否「應該」在播（對戰中）——用來在手勢補播時判斷

function ensureAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.volume = VOLUME;
    audio.preload = "auto";
    audio.addEventListener("ended", () => {
      if (wantPlaying) playRandom(true); // 播完換一首
    });
  }
  return audio;
}

/** 隨機選一首播放（preferSwitch＝盡量換到「非當前」那首）。 */
function playRandom(preferSwitch = false): void {
  const a = ensureAudio();
  if (!a) return;
  let idx = Math.floor(Math.random() * TRACKS.length);
  if (preferSwitch && TRACKS.length > 1 && idx === curIdx) idx = (idx + 1) % TRACKS.length;
  curIdx = idx;
  a.src = `/api/sfx/${TRACKS[idx]}.mp3`;
  a.currentTime = 0;
  const p = a.play();
  if (p && typeof p.then === "function") {
    p.then(() => {
      pendingPlay = false;
    }).catch(() => {
      pendingPlay = true; // autoplay 被擋，等手勢
    });
  }
}

/** 進對戰時呼叫：開始隨機播放 BGM（已關閉則不播）。 */
export function startBgm(): void {
  wantPlaying = true;
  if (!bgmEnabled.value) return;
  playRandom(false);
}

/** 離開對戰時呼叫：停止並重置。 */
export function stopBgm(): void {
  wantPlaying = false;
  pendingPlay = false;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

/** 使用者首次手勢後呼叫（與 resumeAudio 同步）：補播被 autoplay 擋下的 BGM。 */
export function tryResumeBgm(): void {
  if (pendingPlay && wantPlaying && bgmEnabled.value && audio) {
    const p = audio.play();
    if (p && typeof p.then === "function") p.then(() => (pendingPlay = false)).catch(() => {});
  }
}

/** 切換 BGM 開關：開→（對戰中則立即播）、關→停。 */
export function toggleBgm(): void {
  bgmEnabled.value = !bgmEnabled.value;
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, bgmEnabled.value ? "1" : "0");
  if (bgmEnabled.value) {
    if (wantPlaying) playRandom(false);
  } else if (audio) {
    audio.pause();
  }
}
