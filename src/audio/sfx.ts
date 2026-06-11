/**
 * 對戰音效 —— 全部用 Web Audio 即時合成（oscillator + 白噪），無音檔／無版權／離線可用，
 * 符合本專案「一切由資料生成」的精神。音效是純呈現層，與確定性模擬無關（可用 Math.random）。
 *
 * 用法：使用者手勢後先 `resumeAudio()` 解除 autoplay 限制，回放時依事件呼叫 play*()。
 * 音色想微調就改各 play* 的頻率/波形/包絡。
 *
 * 響度安全：master gain 之後串一級 DynamicsCompressor 當 limiter——密集撞擊多層疊加時
 * 壓住峰值不爆音（threshold -10dB / ratio 16 的硬限幅設定）。
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
    // limiter：master → compressor → destination（疊加爆音保險）
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.16;
    master.connect(limiter);
    limiter.connect(ctx.destination);
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

/** ±pct 隨機微偏（detune 用）：連續觸發不像機關槍。 */
function jit(pct: number): number {
  return 1 + (Math.random() * 2 - 1) * pct;
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

/**
 * 撞擊：三層合成，impact（0~260+）映射音量/音調/明亮度——弱撞悶、強撞炸。
 *  1) 低頻 thump：sine 短促下滑（重量感），音量與長度隨力道。
 *  2) 金屬 clank：bandpass 白噪（中心頻率隨力道開亮）+ 方波鐘鳴（基音 + 2.76x 非諧泛音）。
 *  3) 高頻 transient：極短 highpass「嚓」，夠猛才出現。
 * 每層 ±5~10% detune + 0~8ms timing 隨機 → 密集撞擊不像機關槍。
 */
export function playCollision(impact: number): void {
  const s = Math.min(1, impact / 260);
  if (s < 0.05) return;
  const d = Math.random() * 0.008;
  // 1) 低頻 thump
  tone((85 + 75 * s) * jit(0.06), 0.08 + 0.1 * s, "sine", 0.16 + 0.3 * s, 38, d);
  // 2) 金屬 clank：噪（亮度隨力道）
  noise(0.045 + 0.085 * s, 0.14 + 0.24 * s, "bandpass", (850 + 2700 * s) * jit(0.08), 420 + 700 * s, d);
  //    金屬 clank：方波鐘鳴（非諧泛音=金屬感）
  const f0 = (300 + 460 * s) * jit(0.05);
  tone(f0, 0.045 + 0.05 * s, "square", 0.035 + 0.07 * s, f0 * 0.55, d + 0.002);
  tone(f0 * 2.76, 0.035 + 0.04 * s, "square", 0.02 + 0.045 * s, undefined, d + 0.002);
  // 3) 高頻 transient click（強撞才亮）
  if (s > 0.25) noise(0.012 + 0.012 * s, 0.08 + 0.18 * (s - 0.25), "highpass", (3600 + 3000 * s) * jit(0.1), undefined, d);
}

/** 必殺技發動：上升掃頻，依招式換基頻。 */
export function playSpecial(kind: string): void {
  const base = ({ rush: 320, blast: 200, dash: 540, vortex: 230, clone: 400 } as Record<string, number>)[kind] ?? 300;
  tone(base, 0.26, "sawtooth", 0.16, base * 2.4);
  tone(base * 1.5, 0.3, "sine", 0.09, base * 3);
}

/** 擊破 KO：起爆 transient + 爆炸噪（lowpass 下掃）+ 雙層 sub 落地 boom（深度落地感）。 */
export function playKO(): void {
  noise(0.04, 0.32, "highpass", 2400); // 起爆「嚓」
  noise(0.55, 0.5, "lowpass", 1900, 100); // 爆炸主體
  tone(130, 0.6, "sine", 0.38, 36); // sub 落地 drop
  tone(58, 0.55, "triangle", 0.2, 28, 0.06); // 第二層 rumble（晚 60ms 落地）
}

/** 出界：上揚呼嘯（陀螺飛出去）——噪音 + 音調雙層向上掃，尾端自然散掉。 */
export function playRingOut(): void {
  noise(0.42, 0.2, "bandpass", 600, 3400);
  tone(320, 0.45, "sine", 0.16, 1250);
  tone(240, 0.4, "triangle", 0.09, 980, 0.04);
}

/** 停轉：轉速逐漸歸零的下滑音。 */
export function playSpinOut(): void {
  tone(440, 0.7, "triangle", 0.18, 70);
}

/** 發射：卡榫 click + 拉繩 rip（上揚 saw）+ 抽繩風聲（bandpass 上掃）。 */
export function playLaunch(): void {
  noise(0.025, 0.16, "highpass", 2800); // 卡榫
  tone(150 * jit(0.05), 0.2, "sawtooth", 0.15, 920); // rip 上揚
  noise(0.16, 0.12, "bandpass", 1100, 3800, 0.01); // 抽繩風聲
}

/** 勝利：三音小喇叭。 */
export function playWin(): void {
  [523, 659, 784].forEach((f, i) => tone(f, 0.26, "triangle", 0.2, undefined, i * 0.11));
}
