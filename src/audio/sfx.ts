/**
 * 對戰音效 —— 「街機誇張」程序化合成引擎（sfx-lab 試聽室 C 案定案，2026-06）。
 * 全部 Web Audio 即時合成：無音檔、無版權、離線可用。音效是純呈現層，與確定性模擬無關（可用 Math.random）。
 *
 * 音色設計（原樣移植自 public/sfx-lab.html 的 engine C，滑桿定案 crunch 0.5 / sub 0.6 / vol 0.8）：
 * - 撞擊：三支 detune 方波 60ms 急墜（~1400→74Hz）→ 量化 WaveShaper（16 階 bitcrush 髒感）
 *   → 專屬重壓縮 pump（-34dB/18:1）；方波 sub 低通 140Hz 取「塊」、繞過 crusher 直入 comp 一起被 pump。
 * - KO：saw+雙方波 1500→36Hz 半秒長落體 + 量化爆炸噪 + sub 大塊。
 * - 發射：三齒卡榫 + 失真拉繩 saw + 抽繩風聲 + 240ms 離手 snap；出界：上揚呼嘯雙層 + shimmer。
 *
 * 響度鏈（打擊感的另一半）：volume → compressor(-20dB/4:1 拉響度) → makeup ×1.8
 * → 硬 limiter(-1.5dB/20:1) → tanh soft-clip 保險（ceiling 0.985）→ destination，大聲且不破音。
 *
 * 試聽室 sfx-lab.html 保留在 public/（要再調音色去那邊 A/B，定案後把參數搬回這裡）。
 */
import { ref } from "vue";

/** 音效開關（UI 音量鍵綁定）。 */
export const sfxEnabled = ref(true);
/** 主音量 0~1（lab 定案 0.8）。 */
export const sfxVolume = ref(0.8);

/* ---- 定案參數（與 sfx-lab.html 同名同值，改音色請先去試聽室驗證） ---- */
const GLOBALS = { crunch: 0.5, sub: 0.6 };
const MASTER_PARAMS = {
  comp: { threshold: -20, knee: 12, ratio: 4, attack: 0.004, release: 0.2 }, // 拉響度
  makeup: 1.8, // 補償增益（約 +5dB）
  limiter: { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.06 }, // 硬限幅
  safetyK: 2.2,
  safetyCeil: 0.985, // 最終 tanh soft-clip 保險
};
const C_PARAMS = {
  crushBase: 26,
  crushSpan: 20, // 量化階數 = base - span*crunch（crunch 0.5 → 16 階）
  detunes: [-25, 0, 18], // 方波堆疊 detune（cents）
  dropF0: 620,
  dropSpan: 780, // 起始頻率 = f0 + span*力道
  dropTo: 74,
  dropTime: 0.06, // 急速 pitch-drop 目標/時間
  sqGain: 0.16, // 單支方波音量（×3 支）
  subF0: 62,
  subF1: 36,
  subGain: 1.0,
  comp: { threshold: -34, knee: 0, ratio: 18, attack: 0.001, release: 0.2, makeup: 2.3 }, // pump
};
const SHARED_PARAMS = {
  ringOut: {
    whoosh: { dur: 0.5, gain: 0.3, f0: 520, f1: 3900 }, // 上揚呼嘯
    doppler: { f0: 330, f1: 1480, dur: 0.48, gain: 0.22 },
  },
};

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let masterInput: GainNode | null = null; // 響度鏈入口（音量在這顆）
let busS: GainNode | null = null; // 共用音色匯流排（發射/出界/必殺/勝利）
let cCrush: WaveShaperNode | null = null; // C：bitcrusher
let cComp: DynamicsCompressorNode | null = null; // C：pump compressor
const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

function crushCurve(steps: number): Float32Array<ArrayBuffer> {
  const key = "c" + steps;
  const hit = curveCache.get(key);
  if (hit) return hit;
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * steps) / steps;
  }
  curveCache.set(key, c);
  return c;
}

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    /* 響度鏈：volume → comp → makeup → limiter → safety → out */
    masterInput = ctx.createGain();
    masterInput.gain.value = sfxVolume.value;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = MASTER_PARAMS.comp.threshold;
    comp.knee.value = MASTER_PARAMS.comp.knee;
    comp.ratio.value = MASTER_PARAMS.comp.ratio;
    comp.attack.value = MASTER_PARAMS.comp.attack;
    comp.release.value = MASTER_PARAMS.comp.release;
    const makeup = ctx.createGain();
    makeup.gain.value = MASTER_PARAMS.makeup;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = MASTER_PARAMS.limiter.threshold;
    limiter.knee.value = MASTER_PARAMS.limiter.knee;
    limiter.ratio.value = MASTER_PARAMS.limiter.ratio;
    limiter.attack.value = MASTER_PARAMS.limiter.attack;
    limiter.release.value = MASTER_PARAMS.limiter.release;
    const safety = ctx.createWaveShaper();
    safety.oversample = "2x";
    {
      const n = 2048;
      const c = new Float32Array(n);
      const k = MASTER_PARAMS.safetyK;
      const norm = Math.tanh(k);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = (Math.tanh(k * x) / norm) * MASTER_PARAMS.safetyCeil;
      }
      safety.curve = c;
    }
    masterInput.connect(comp);
    comp.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(safety);
    safety.connect(ctx.destination);

    /* 2 秒共用白噪 */
    const n = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    /* 共用匯流排 */
    busS = ctx.createGain();
    busS.gain.value = 0.9;
    busS.connect(masterInput);

    /* C 引擎：crusher → pump comp → makeup → master；sub 直入 comp（吃 pump、不被量化） */
    cComp = ctx.createDynamicsCompressor();
    cComp.threshold.value = C_PARAMS.comp.threshold;
    cComp.knee.value = C_PARAMS.comp.knee;
    cComp.ratio.value = C_PARAMS.comp.ratio;
    cComp.attack.value = C_PARAMS.comp.attack;
    cComp.release.value = C_PARAMS.comp.release;
    const cMake = ctx.createGain();
    cMake.gain.value = C_PARAMS.comp.makeup;
    cComp.connect(cMake);
    cMake.connect(masterInput);
    cCrush = ctx.createWaveShaper();
    cCrush.oversample = "none"; // 不 oversample 保髒（街機感）
    cCrush.curve = crushCurve(Math.max(4, Math.round(C_PARAMS.crushBase - C_PARAMS.crushSpan * GLOBALS.crunch)));
    cCrush.connect(cComp);
  }
  return ctx;
}

/** 使用者手勢後呼叫 → 解除瀏覽器 autoplay 限制 + 同步音量。 */
export function resumeAudio(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume();
  if (masterInput) masterInput.gain.value = sfxVolume.value;
}

export function setSfxVolume(v: number): void {
  sfxVolume.value = Math.max(0, Math.min(1, v));
  if (masterInput) masterInput.gain.value = sfxVolume.value;
}

/** ±pct 隨機微偏：連續觸發不像機關槍。 */
function jit(pct: number): number {
  return 1 + (Math.random() * 2 - 1) * pct;
}

/** 指數衰減包絡：0 → peak（attack）→ 0.0001（dur）。 */
function env(g: GainNode, t: number, peak: number, dur: number, attack = 0.003): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.005, dur));
}

function toneAt(
  dest: AudioNode,
  t: number,
  dur: number,
  peak: number,
  type: OscillatorType,
  f0: number,
  f1?: number,
  attack?: number,
): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, peak, dur, attack);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.06);
}

function burstNoise(
  dest: AudioNode,
  t: number,
  dur: number,
  peak: number,
  type: BiquadFilterType,
  f0: number,
  f1?: number,
  q = 0.9,
): void {
  if (!ctx || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(Math.max(20, f0), t);
  if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, peak, dur, 0.002);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 1.2, dur + 0.12);
}

/**
 * 撞擊（街機誇張）：impact（0~260+）映射力道 s。
 * 三支 detune 方波急墜進 bitcrush + 髒噪同路；方波 sub 塊走 pump comp。
 */
export function playCollision(impact: number): void {
  const c = ensure();
  if (!c || !cCrush || !cComp || !sfxEnabled.value) return;
  const s = Math.min(1, impact / 260);
  if (s < 0.05) return;
  const P = C_PARAMS;
  const t = c.currentTime + 0.001 + Math.random() * 0.004;
  const fStart = (P.dropF0 + P.dropSpan * s) * jit(0.07);
  const dropT = P.dropTime + 0.035 * s;
  const dur = 0.1 + 0.1 * s;
  for (const dt of P.detunes) {
    const o = c.createOscillator();
    o.type = "square";
    o.detune.value = dt;
    o.frequency.setValueAtTime(fStart, t);
    o.frequency.exponentialRampToValueAtTime(P.dropTo + 50 * s, t + dropT);
    const g = c.createGain();
    env(g, t, P.sqGain * (0.4 + 0.6 * s), dur, 0.002);
    o.connect(g);
    g.connect(cCrush);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  burstNoise(cCrush, t, 0.07 + 0.05 * s, 0.25 + 0.35 * s, "bandpass", 1900, 320); // 髒噪（也被量化）
  // 方波 sub「塊」：lowpass 140 取塊感，走 comp 吃 pump
  const o = c.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(P.subF0 + 10 * s, t);
  o.frequency.exponentialRampToValueAtTime(P.subF1, t + 0.16);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 140;
  const g = c.createGain();
  env(g, t, (0.5 + 0.6 * s) * GLOBALS.sub * P.subGain, 0.18 + 0.06 * s);
  o.connect(lp);
  lp.connect(g);
  g.connect(cComp);
  o.start(t);
  o.stop(t + 0.32);
}

/** 擊破 KO（街機誇張）：長落體 + 量化爆炸 + sub 大塊。 */
export function playKO(): void {
  const c = ensure();
  if (!c || !cCrush || !cComp || !sfxEnabled.value) return;
  const t = c.currentTime + 0.002;
  const stack: [OscillatorType, number][] = [
    ["sawtooth", 0],
    ["square", -30],
    ["square", 25],
  ];
  for (const [ty, dt] of stack) {
    const o = c.createOscillator();
    o.type = ty;
    o.detune.value = dt;
    o.frequency.setValueAtTime(1500 * jit(0.05), t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.42);
    const g = c.createGain();
    env(g, t, 0.2, 0.55, 0.003);
    o.connect(g);
    g.connect(cCrush);
    o.start(t);
    o.stop(t + 0.65);
  }
  burstNoise(cCrush, t, 0.5, 0.65, "lowpass", 2600, 90); // 爆炸（被量化 → 街機髒）
  burstNoise(cCrush, t, 0.04, 0.5, "highpass", 3000); // 起爆嚓
  const o = c.createOscillator();
  o.type = "square"; // sub 大塊
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 140;
  const g = c.createGain();
  env(g, t, 1.2 * GLOBALS.sub, 0.55);
  o.connect(lp);
  lp.connect(g);
  g.connect(cComp);
  o.start(t);
  o.stop(t + 0.65);
}

/**
 * 發射（v3「溫和起轉」）：v2 被嫌太粗暴 → 全面柔化——
 * snap 改低頻悶 click、嗡鳴改 triangle（去掉 saw 的毛刺）、AM 顫動變淺、
 * 上掃頂點壓低（850Hz）、氣流變輕。保留「放手 punch → 轉速爬升 → 旋尾淡出」結構。
 */
export function playLaunch(): void {
  const c = ensure();
  if (!c || !busS || !sfxEnabled.value) return;
  const t = c.currentTime + 0.002;
  // 1) 放手瞬間：悶 click + 柔 thump（觸感回饋，不刺耳）
  burstNoise(busS, t, 0.025, 0.14, "bandpass", 1600);
  toneAt(busS, t, 0.1, 0.15 + 0.18 * GLOBALS.sub, "sine", 150, 64);
  // 2) 起轉嗡鳴：triangle 上掃 + 淺 AM 顫動（柔和的轉速爬升）
  const SPIN_T = 0.3;
  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(160 * jit(0.05), t + 0.01);
  o.frequency.exponentialRampToValueAtTime(850, t + 0.01 + SPIN_T);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(420, t + 0.01);
  bp.frequency.exponentialRampToValueAtTime(1900, t + 0.01 + SPIN_T);
  const g = c.createGain();
  env(g, t + 0.01, 0.16, SPIN_T + 0.1, 0.035);
  const lfo = c.createOscillator(); // 轉子顫動：深度 0.28、18→60Hz（比 v2 淺而緩）
  lfo.type = "sine";
  lfo.frequency.setValueAtTime(18, t + 0.01);
  lfo.frequency.exponentialRampToValueAtTime(60, t + 0.01 + SPIN_T);
  const depth = c.createGain();
  depth.gain.value = 0.28;
  lfo.connect(depth);
  depth.connect(g.gain);
  o.connect(bp);
  bp.connect(g);
  g.connect(busS);
  o.start(t + 0.01);
  o.stop(t + 0.01 + SPIN_T + 0.14);
  lfo.start(t + 0.01);
  lfo.stop(t + 0.01 + SPIN_T + 0.14);
  // 3) 輕氣流 + 旋尾（嗡鳴輕輕遠去）
  burstNoise(busS, t + 0.02, SPIN_T, 0.09, "bandpass", 650, 2400);
  burstNoise(busS, t + SPIN_T, 0.3, 0.05, "bandpass", 1200, 750, 3);
}

/** 出界：上揚呼嘯雙層 + shimmer（lab 共用版）。 */
export function playRingOut(): void {
  const c = ensure();
  if (!c || !busS || !sfxEnabled.value) return;
  const P = SHARED_PARAMS.ringOut;
  const t = c.currentTime + 0.002;
  burstNoise(busS, t, P.whoosh.dur, P.whoosh.gain, "bandpass", P.whoosh.f0, P.whoosh.f1);
  toneAt(busS, t, P.doppler.dur, P.doppler.gain, "sine", P.doppler.f0, P.doppler.f1);
  toneAt(busS, t + 0.05, 0.42, 0.12, "triangle", 250, 1020);
  toneAt(busS, t + 0.1, 0.4, 0.06, "sine", 2600, 5200); // shimmer
}

/** 必殺技發動：上升掃頻，依招式換基頻。 */
export function playSpecial(kind: string): void {
  const c = ensure();
  if (!c || !busS || !sfxEnabled.value) return;
  const t = c.currentTime + 0.002;
  const base = ({ rush: 320, blast: 200, dash: 540, vortex: 230, clone: 400 } as Record<string, number>)[kind] ?? 300;
  toneAt(busS, t, 0.26, 0.16, "sawtooth", base, base * 2.4);
  toneAt(busS, t, 0.3, 0.09, "sine", base * 1.5, base * 3);
}

/** 停轉：轉速逐漸歸零的下滑音。 */
export function playSpinOut(): void {
  const c = ensure();
  if (!c || !busS || !sfxEnabled.value) return;
  toneAt(busS, c.currentTime + 0.002, 0.7, 0.18, "triangle", 440, 70);
}

/** 勝利：三音小喇叭。 */
export function playWin(): void {
  const c = ensure();
  if (!c || !busS || !sfxEnabled.value) return;
  const t = c.currentTime + 0.002;
  [523, 659, 784].forEach((f, i) => toneAt(busS!, t + i * 0.11, 0.26, 0.2, "triangle", f));
}
