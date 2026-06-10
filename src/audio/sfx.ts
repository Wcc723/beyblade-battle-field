/**
 * 對戰音效 —— 全部用 Web Audio 即時合成（oscillator + 白噪），無音檔／無版權／離線可用，
 * 符合本專案「一切由資料生成」的精神。音效是純呈現層，與確定性模擬無關（可用 Math.random）。
 *
 * 用法：使用者手勢後先 `resumeAudio()` 解除 autoplay 限制，回放時依事件呼叫 play*()。
 * 音色想微調就改各 play* 的頻率/波形/包絡。
 */
import { ref } from "vue";

/** 音效開關（UI 綁定的 🔊/🔇）。 */
export const sfxEnabled = ref(true);
/** 主音量 0~1。 */
export const sfxVolume = ref(0.55);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = sfxVolume.value;
    master.connect(ctx.destination);
    // 0.5s 白噪緩衝（金屬撞擊／爆炸用）
    const n = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

/** 使用者手勢後呼叫 → 解除瀏覽器 autoplay 限制 + 同步音量。 */
export function resumeAudio(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume();
  if (master) master.gain.value = sfxVolume.value;
}

export function setSfxVolume(v: number): void {
  sfxVolume.value = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = sfxVolume.value;
}

/** 單音：可選滑頻（slideTo）與延遲（delay 秒）。 */
function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
  const c = ensure();
  if (!c || !master || !sfxEnabled.value) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

/** 噪音爆：經 biquad 濾波（可選掃頻）。 */
function noise(dur: number, gain: number, filter: BiquadFilterType, freq: number, freqTo?: number, delay = 0): void {
  const c = ensure();
  if (!c || !master || !noiseBuf || !sfxEnabled.value) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (freqTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, freqTo), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.03);
}

/** 撞擊：金屬「鏘」——強弱依 impact（0~260+）。 */
export function playCollision(impact: number): void {
  const s = Math.min(1, impact / 260);
  if (s < 0.05) return;
  noise(0.04 + 0.06 * s, 0.22 * (0.4 + s), "bandpass", 1400 + s * 3200);
  tone(480 + s * 1000, 0.05 + 0.07 * s, "triangle", 0.1 * (0.5 + s), 220);
}

/** 必殺技發動：上升掃頻，依招式換基頻。 */
export function playSpecial(kind: string): void {
  const base = ({ rush: 320, blast: 200, dash: 540, vortex: 230, clone: 400 } as Record<string, number>)[kind] ?? 300;
  tone(base, 0.26, "sawtooth", 0.16, base * 2.4);
  tone(base * 1.5, 0.3, "sine", 0.09, base * 3);
}

/** 擊破 KO：爆炸（lowpass 往下掃的噪）+ 低頻 boom。 */
export function playKO(): void {
  noise(0.5, 0.5, "lowpass", 2000, 120);
  tone(150, 0.5, "sine", 0.32, 48);
}

/** 出界：下降 whoosh。 */
export function playRingOut(): void {
  tone(760, 0.4, "sine", 0.2, 130);
  noise(0.38, 0.13, "highpass", 700, 240);
}

/** 停轉：轉速逐漸歸零的下滑音。 */
export function playSpinOut(): void {
  tone(440, 0.7, "triangle", 0.18, 70);
}

/** 發射：快速上揚 zip。 */
export function playLaunch(): void {
  tone(170, 0.16, "sawtooth", 0.14, 760);
}

/** 勝利：三音小喇叭。 */
export function playWin(): void {
  [523, 659, 784].forEach((f, i) => tone(f, 0.26, "triangle", 0.2, undefined, i * 0.11));
}
