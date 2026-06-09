<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { simulate, DEFAULT_SCALES, maxHpFor } from "../physics/engine";
import type { ArenaConfig, BeybladeInit, Frame, SimResult, SpecialKind, SpecialEvent } from "../physics/types";
import { STAT_PRESETS, PRESET_LABELS } from "../physics/presets";
import { getActiveConfig, activePresetName, presets, activeId, setActive } from "../store/arenaStore";
import { rimScoreAt } from "../physics/arena";
import ArenaSvg from "./ArenaSvg.vue";
import { getStats } from "../store/statStore";
import { special } from "../store/specialStore";

/* ---------- 場地（來自後台選定的設定） ---------- */
const arena = ref<ArenaConfig>(getActiveConfig());
const arenaName = ref(activePresetName());
const maxTime = 60;

/* ---------- 玩家設定（發射前選好：類型 + 旋向） ---------- */
interface Setup {
  id: string;
  color: string;
  preset: string;
  spinDir: 1 | -1;
  special: "" | SpecialKind;
}
const setupA = reactive<Setup>({ id: "A", color: "#ff5d5d", preset: "balance", spinDir: 1, special: "rush" });
const setupB = reactive<Setup>({ id: "B", color: "#5db4ff", preset: "attack", spinDir: -1, special: "blast" });
const presetKeys = Object.keys(STAT_PRESETS);

/* ---------- 對戰流程狀態機 ---------- */
type Phase = "aim-A" | "aim-B" | "playing";
const phase = ref<Phase>("aim-A");
const launchA = ref<BeybladeInit | null>(null);
const launchB = ref<BeybladeInit | null>(null);

const phaseText = computed(() => {
  if (phase.value === "aim-A") return "🔴 紅方 A 發射";
  if (phase.value === "aim-B") return "🔵 藍方 B 發射";
  return "⚔️ 對戰回放";
});

/* ---------- 計分賽制（先到 N 分）---------- */
const WIN_SCORE = 3;
const scoreA = ref(0);
const scoreB = ref(0);
const roundNum = ref(1);
const roundScored = ref(false);
const lastRoundPoints = ref(0);
const matchOver = computed(() => scoreA.value >= WIN_SCORE || scoreB.value >= WIN_SCORE);

// 出界計分依場地「邊緣分區」資料（rimScoreAt）：落在高分區/破口的角度 = 該段 score
function roundPoints(r: SimResult): number {
  if (!r.winnerId) return 0;
  if (r.reason === "ko") return 2;
  if (r.reason === "ring-out") {
    // 方形場：四角出界統一用 box.cornerScore；圓形場：依 rim 落點分區
    if (arena.value.box) return arena.value.box.cornerScore ?? 2;
    return rimScoreAt(arena.value, r.ringOutAngle);
  }
  if (r.reason === "spin-out" || r.reason === "timeout") return 1;
  return 0;
}
function awardRound() {
  if (roundScored.value) return;
  roundScored.value = true;
  const r = result.value;
  if (!r || !r.winnerId) {
    lastRoundPoints.value = 0;
    return;
  }
  const pts = roundPoints(r);
  lastRoundPoints.value = pts;
  if (r.winnerId === "A") scoreA.value += pts;
  else scoreB.value += pts;
}

/* ---------- 回放 ---------- */
const result = ref<SimResult | null>(null);
const playhead = ref(0);
const playing = ref(false);
const speed = ref(2); // 回放預設 2 倍速（只影響播放，不動模擬 timestep；終結慢動作 ×0.3 仍照比例放慢）

/* ---------- 畫布 / 拖曳 ---------- */
const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
const SIZE = 640;

// 陀螺貼圖（依類型載入；未載入時 drawTop 會用程式繪製後備）
const SPRITE_SIZE = 128;
const spriteImgs: Record<string, HTMLImageElement> = {};
function loadSprites() {
  for (const k of Object.keys(STAT_PRESETS)) {
    const img = new Image();
    img.onload = () => draw();
    img.src = `${import.meta.env.BASE_URL}beyblades/${k}-${SPRITE_SIZE}.webp`;
    spriteImgs[k] = img;
  }
}
const dragging = ref(false);
const powerPct = ref(0);
const dragStart = reactive({ x: 0, y: 0 });
const dragCurrent = reactive({ x: 0, y: 0 });

// 發射模式：flick = 甩動（看放手瞬間拖曳速度）、sling = 拉弓（看拉的距離）
const launchMode = ref<"flick" | "sling">("flick");
const V_FULL = 5200; // 甩動：達到全力的甩速（越大越能分辨快慢；太小會一甩就爆表）
let samples: { cx: number; cy: number; t: number }[] = [];
let pxToWorld = 1; // 螢幕像素 → 世界單位的換算（pointerdown 時計算）

const hintText = computed(() =>
  launchMode.value === "flick"
    ? "點住設定落點 → 朝目標方向「甩」一下放手；甩越快力道越大（整個視窗都能甩）。"
    : "在場上按住拖曳：往後拉蓄力、決定角度，放開即發射。",
);

/* ---------- 座標轉換 ---------- */
// 縮放基準：方形場用半邊長 box.half、圓形場用 radius（讓場地剛好填滿畫布）
function scaleRef(): number {
  return arena.value.box ? arena.value.box.half : arena.value.radius;
}
function toCanvas(x: number, y: number): [number, number] {
  const pad = 28;
  const scale = (SIZE / 2 - pad) / scaleRef();
  return [SIZE / 2 + x * scale, SIZE / 2 - y * scale];
}
function scaleLen(v: number): number {
  const pad = 28;
  return v * ((SIZE / 2 - pad) / scaleRef());
}
function clientToWorld(e: PointerEvent): { x: number; y: number } {
  const el = canvas.value!;
  const rect = el.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (SIZE / rect.width);
  const sy = (e.clientY - rect.top) * (SIZE / rect.height);
  const pad = 28;
  const scale = (SIZE / 2 - pad) / scaleRef();
  let x = (sx - SIZE / 2) / scale;
  let y = (SIZE / 2 - sy) / scale;
  // 限制落點在場內
  const r = Math.hypot(x, y);
  const lim = scaleRef() * 0.9;
  if (r > lim) {
    x = (x / r) * lim;
    y = (y / r) * lim;
  }
  return { x, y };
}

/* ---------- 發射輸入（拉弓 / 甩動兩種模式） ---------- */
function onPointerDown(e: PointerEvent) {
  if (phase.value === "playing") return;
  const w = clientToWorld(e);
  dragStart.x = w.x;
  dragStart.y = w.y;
  dragCurrent.x = w.x;
  dragCurrent.y = w.y;
  dragging.value = true;
  powerPct.value = 0;
  // 甩動：建立螢幕→世界換算，開始取樣游標速度
  const rect = canvas.value!.getBoundingClientRect();
  const scale = (SIZE / 2 - 28) / arena.value.radius;
  pxToWorld = SIZE / rect.width / scale;
  samples = [{ cx: e.clientX, cy: e.clientY, t: performance.now() }];
  try {
    canvas.value?.setPointerCapture(e.pointerId);
  } catch {
    /* 某些情況（如合成事件）無法擷取指標，忽略即可 */
  }
  draw();
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  if (launchMode.value === "sling") {
    const w = clientToWorld(e);
    dragCurrent.x = w.x;
    dragCurrent.y = w.y;
    powerPct.value = Math.round(currentSlingPower() * 100);
  } else {
    pushSample(e);
    powerPct.value = Math.round(flickPower() * 100);
  }
  draw();
}

function onPointerUp() {
  if (!dragging.value) return;
  dragging.value = false;
  const init = launchMode.value === "sling" ? buildLaunchFromSling() : buildLaunchFromFlick();
  if (!init) {
    draw(); // 力道太小，忽略，維持瞄準
    return;
  }
  submitLaunch(init);
}

/* --- 甩動：放手瞬間速度（取最近 ~80ms 樣本）--- */
function pushSample(e: PointerEvent) {
  const t = performance.now();
  samples.push({ cx: e.clientX, cy: e.clientY, t });
  const cutoff = t - 140;
  while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
}
function flickWorldVel(): { wx: number; wy: number; speed: number } {
  if (samples.length < 2) return { wx: 0, wy: 0, speed: 0 };
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t <= 80) first = samples[i];
    else break;
  }
  const dt = (last.t - first.t) / 1000;
  if (dt < 1e-3) return { wx: 0, wy: 0, speed: 0 };
  const wx = ((last.cx - first.cx) / dt) * pxToWorld;
  const wy = (-(last.cy - first.cy) / dt) * pxToWorld; // 螢幕 y 向下 → 世界 y 向上
  return { wx, wy, speed: Math.hypot(wx, wy) };
}
function flickPower(): number {
  return Math.min(1, flickWorldVel().speed / V_FULL);
}

/* --- 拉弓：拉的距離 --- */
function currentSlingPower(): number {
  const dist = Math.hypot(dragStart.x - dragCurrent.x, dragStart.y - dragCurrent.y);
  return Math.min(1, dist / (arena.value.radius * 0.8));
}

function makeInit(dirx: number, diry: number, power: number): BeybladeInit {
  const setup = phase.value === "aim-A" ? setupA : setupB;
  const speed = power * DEFAULT_SCALES.maxSpeed;
  const spin = (0.55 + 0.45 * power) * DEFAULT_SCALES.maxSpin;
  return {
    id: setup.id,
    color: setup.color,
    stats: getStats(setup.preset),
    position: { x: dragStart.x, y: dragStart.y },
    velocity: { x: dirx * speed, y: diry * speed },
    spin,
    radius: 26,
    spinDir: setup.spinDir,
    special: setup.special || undefined,
  };
}
function buildLaunchFromSling(): BeybladeInit | null {
  const pullx = dragStart.x - dragCurrent.x;
  const pully = dragStart.y - dragCurrent.y;
  const dist = Math.hypot(pullx, pully);
  const power = currentSlingPower();
  if (power < 0.06 || dist < 1e-3) return null;
  return makeInit(pullx / dist, pully / dist, power);
}
function buildLaunchFromFlick(): BeybladeInit | null {
  const v = flickWorldVel();
  const power = Math.min(1, v.speed / V_FULL);
  if (power < 0.06 || v.speed < 1e-3) return null;
  // 發射方向＝拖曳速度的「反方向」（像往後甩 → 往前射）
  return makeInit(-v.wx / v.speed, -v.wy / v.speed, power);
}

/* ---------- 流程：分開發射 → 伺服器統一運算 ---------- */
function submitLaunch(init: BeybladeInit) {
  if (phase.value === "aim-A") {
    launchA.value = init;
    phase.value = "aim-B";
    draw();
  } else if (phase.value === "aim-B") {
    launchB.value = init;
    runServerSimulation();
  }
}

/**
 * ⬇️ 未來搬到 Cloudflare Battle Room Durable Object：
 *    收齊雙方發射輸入 → 用同一份引擎統一運算 → getWebSockets() 廣播軌跡。
 *    此處在本機直接呼叫 simulate()。
 */
function runServerSimulation() {
  if (!launchA.value || !launchB.value) return;
  result.value = simulate([launchA.value, launchB.value], {
    dt: 1 / 60,
    maxTime,
    arena: { ...arena.value },
    seed: roundNum.value, // 每回合不同 seed（仍確定性）
    sampleEvery: 1,
    followThroughTime: 2.5, // 勝負底定後再演 2.5 秒（出界陀螺飛出、勝方續轉）
    special: { ...special }, // 必殺技數值（陀螺後台可調）
  });
  playhead.value = 0;
  resetFreeze();
  phase.value = "playing";
  play();
}

/** 開新回合（不動分數） */
function startRound() {
  pause();
  launchA.value = null;
  launchB.value = null;
  result.value = null;
  powerPct.value = 0;
  roundScored.value = false;
  phase.value = "aim-A";
  draw();
}
/** 下一回合 */
function nextRound() {
  roundNum.value++;
  startRound();
}
/** 整場重來（歸零分數） */
function resetMatch() {
  scoreA.value = 0;
  scoreB.value = 0;
  roundNum.value = 1;
  startRound();
}

/* ---------- 回放迴圈（含撞擊慢動作） ---------- */
let raf = 0;
let lastT = 0;
const slowmo = ref(false);
const SLOWMO_WINDOW = 0.9; // 終結後 0.9 秒內放慢
const SLOWMO_FACTOR = 0.3; // 放慢到 0.3 倍

// 必殺技停格：跨過必殺事件時凍結畫面一下，讓人看清是什麼招
const FREEZE_MS = 360;
let freezeUntil = 0;
let lastFreezeT = -1;
const freezeEvent = ref<SpecialEvent | null>(null);
function resetFreeze() {
  freezeUntil = 0;
  lastFreezeT = -1;
  freezeEvent.value = null;
}

function slowmoMul(curT: number): number {
  const cues = result.value?.slowmoCues;
  if (!cues) return 1;
  for (const ct of cues) {
    const d = curT - ct;
    if (d >= 0 && d < SLOWMO_WINDOW) return SLOWMO_FACTOR;
  }
  return 1;
}

function tick(now: number) {
  if (!playing.value) return;
  const frames = result.value?.frames;
  const dtMs = now - lastT;
  lastT = now;
  if (frames) {
    // 必殺技停格中 → 凍結（不前進），畫面持續重繪以顯示停格 banner
    if (now < freezeUntil) {
      draw();
      raf = requestAnimationFrame(tick);
      return;
    }
    if (freezeEvent.value) freezeEvent.value = null;
    const curT0 = playhead.value / 60; // dt=1/60、sampleEvery=1 → 幀索引即 t*60
    const mul = slowmoMul(curT0);
    slowmo.value = mul < 1;
    playhead.value += (dtMs / 1000) * 60 * speed.value * mul;
    const curT1 = playhead.value / 60;
    // 跨過必殺技事件 → snap 到該時刻並停格
    const ev = result.value!.specialEvents.find((e) => e.t > curT0 && e.t <= curT1 && e.t !== lastFreezeT);
    if (ev) {
      playhead.value = ev.t * 60;
      freezeUntil = now + FREEZE_MS;
      lastFreezeT = ev.t;
      freezeEvent.value = ev;
    }
    if (playhead.value >= frames.length - 1) {
      playhead.value = frames.length - 1;
      playing.value = false;
      slowmo.value = false;
      awardRound(); // 回放結束才結算分數
      draw();
      return;
    }
  }
  draw();
  raf = requestAnimationFrame(tick);
}
function play() {
  const frames = result.value?.frames;
  if (!frames) return;
  if (playhead.value >= frames.length - 1) {
    playhead.value = 0;
    resetFreeze(); // 從頭重播 → 必殺停格可再次觸發
  }
  playing.value = true;
  lastT = performance.now();
  raf = requestAnimationFrame(tick);
}
function pause() {
  playing.value = false;
  slowmo.value = false;
  cancelAnimationFrame(raf);
}
function togglePlay() {
  playing.value ? pause() : play();
}
watch(playhead, () => {
  if (!playing.value) draw();
});

/* ---------- 繪製 ---------- */
// 場地（外框/碗/綠軌/出口）已改由底層的 ArenaSvg 向量圖層畫（吃同一份場地資料 → 與碰撞同源）。
// canvas 只保持透明、回傳幾何讓上層畫會動的陀螺與特效。
function drawArena(g: CanvasRenderingContext2D): { cx: number; cy: number; R: number } {
  g.clearRect(0, 0, SIZE, SIZE);
  const [cx, cy] = toCanvas(0, 0);
  const R = scaleLen(arena.value.radius);
  return { cx, cy, R };
}

function drawTop(
  g: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  z: number,
  angle: number,
  col: string,
  worldRad: number,
  alive: boolean,
  typeKey: string,
  alpha = 1,
  dark = false, // 分身：壓暗
) {
  const [gx, gy] = toCanvas(wx, wy);
  const rad = scaleLen(worldRad);
  const lift = scaleLen(z);
  const hScale = 1 + Math.min(0.45, z / 150);

  // 影子
  g.save();
  g.globalAlpha = Math.max(0.06, 0.3 - z / 280) * alpha;
  g.fillStyle = "#000";
  const sh = 1 - Math.min(0.4, z / 220);
  g.beginPath();
  g.ellipse(gx, gy, rad * sh, rad * 0.5 * sh, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  const by = gy - lift;
  const img = spriteImgs[typeKey];
  g.save();
  g.translate(gx, by);
  g.scale(hScale, hScale);
  g.globalAlpha = (alive ? 1 : 0.28) * alpha;
  if (dark) g.filter = "brightness(0.42) saturate(1.3)"; // 分身壓暗
  g.rotate(angle);
  if (img && img.complete && img.naturalWidth > 0) {
    // 貼圖（已含刀刃造型，依 angle 旋轉）
    const d = rad * 2 * 1.18;
    g.drawImage(img, -d / 2, -d / 2, d, d);
  } else {
    // 後備：程式繪製圓 + 三刀刃
    g.beginPath();
    g.arc(0, 0, rad, 0, Math.PI * 2);
    g.fillStyle = col + "33";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = col;
    g.stroke();
    for (let k = 0; k < 3; k++) {
      g.rotate((Math.PI * 2) / 3);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(rad * 0.9, 0);
      g.lineWidth = 3;
      g.strokeStyle = col;
      g.stroke();
    }
  }
  g.restore();

  if (!alive) {
    g.save();
    g.globalAlpha = 0.6 * alpha;
    g.translate(gx, by);
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-rad * 0.5, -rad * 0.5);
    g.lineTo(rad * 0.5, rad * 0.5);
    g.moveTo(rad * 0.5, -rad * 0.5);
    g.lineTo(-rad * 0.5, rad * 0.5);
    g.stroke();
    g.restore();
  }
}

function lerpFrame(a: Frame, b: Frame, f: number): Frame {
  if (f <= 0) return a;
  return {
    t: a.t + (b.t - a.t) * f,
    bodies: a.bodies.map((ba) => {
      const bb = b.bodies.find((x) => x.id === ba.id) ?? ba;
      return {
        id: ba.id,
        x: ba.x + (bb.x - ba.x) * f,
        y: ba.y + (bb.y - ba.y) * f,
        z: ba.z + (bb.z - ba.z) * f,
        angle: ba.angle + (bb.angle - ba.angle) * f,
        spin: ba.spin + (bb.spin - ba.spin) * f,
        hp: ba.hp + (bb.hp - ba.hp) * f,
        alive: f < 1 ? ba.alive : bb.alive,
        isClone: ba.isClone,
        ownerId: ba.ownerId,
        cloneFade:
          ba.cloneFade != null && bb.cloneFade != null
            ? ba.cloneFade + (bb.cloneFade - ba.cloneFade) * f
            : (f < 1 ? ba.cloneFade : bb.cloneFade),
      };
    }),
  };
}

function colorOf(id: string): string {
  return id === "A" ? setupA.color : setupB.color;
}
function presetOf(id: string): string {
  return id === "A" ? setupA.preset : setupB.preset;
}

/* ---------- 回放特效（純由 curT 推導 → 重播/變速/scrub 都穩、確定性） ---------- */
/** 確定性 hash → [0,1)：讓火花/碎片方向穩定、不隨機抖動。 */
function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** 碰撞火花：強弱依 impact（門檻調低 → 同力道更猛），衝擊波環 + 發光爆閃 + 放射火花。 */
function drawSparks(g: CanvasRenderingContext2D, curT: number) {
  const evs = result.value?.collisionEvents;
  if (!evs) return;
  const DUR = 0.34;
  for (let k = 0; k < evs.length; k++) {
    const ce = evs[k];
    const age = curT - ce.t;
    if (age < 0 || age >= DUR) continue;
    const a = age / DUR;
    const s = Math.min(1, ce.impact / 260); // 撞擊強度 0~1
    const [ex, ey] = toCanvas(ce.x, ce.y);
    g.save();
    g.lineCap = "round";
    // 衝擊波環（夠猛才有，白色擴張環）
    if (s > 0.3) {
      g.globalAlpha = (1 - a) * 0.55 * s;
      g.strokeStyle = "#fff";
      g.lineWidth = scaleLen(3.5) * (1 - a);
      g.beginPath();
      g.arc(ex, ey, scaleLen(6) + scaleLen(10 + s * 60) * a, 0, Math.PI * 2);
      g.stroke();
    }
    // 中心爆閃（白 + 暖色光暈）
    g.shadowColor = "#ffd24d";
    g.shadowBlur = 18 * s;
    g.globalAlpha = (1 - a) * (0.55 + 0.45 * s);
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(ex, ey, scaleLen(4 + s * 11) * (1 - a * 0.55), 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    // 放射火花（更多 8~24 條、更長、白→橙→紅）
    const n = 8 + Math.floor(s * 16);
    const reach = scaleLen(18 + s * 58);
    for (let i = 0; i < n; i++) {
      const ang = hash01(k * 41.7 + i * 2.3) * Math.PI * 2;
      const spd = 0.5 + hash01(k * 13.1 + i * 5.7) * 0.5;
      const d0 = reach * a * spd;
      const len = scaleLen(6 + s * 14) * (1 - a) * (0.6 + spd * 0.4);
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      g.globalAlpha = (1 - a) * (0.78 + 0.22 * s);
      const r = hash01(k * 7.3 + i);
      g.strokeStyle = r < 0.4 ? "#ffffff" : r < 0.75 ? "#ffcf5a" : "#ff8a3c";
      g.lineWidth = (1.8 + s * 1.8) * (1 - a * 0.4);
      g.beginPath();
      g.moveTo(ex + c * d0, ey + sn * d0);
      g.lineTo(ex + c * (d0 + len), ey + sn * (d0 + len));
      g.stroke();
    }
    g.restore();
  }
}

/** 擊破破碎：ko 時白光閃 + 陀螺碎裂成楔形碎片飛散下墜（出界/停轉走慢動作、不爆）。 */
function drawDeaths(g: CanvasRenderingContext2D, curT: number) {
  const evs = result.value?.deathEvents;
  if (!evs) return;
  const DUR = 1.0;
  for (let k = 0; k < evs.length; k++) {
    const de = evs[k];
    if (de.reason !== "ko") continue;
    const age = curT - de.t;
    if (age < 0 || age >= DUR) continue;
    const a = age / DUR;
    const fast = Math.min(1, age / 0.35); // 衝擊光快、碎片慢
    const [ex, ey] = toCanvas(de.x, de.y);
    const col = colorOf(de.id);
    g.save();
    // 衝擊白光環 + 內爆閃光（快）
    g.globalAlpha = (1 - fast) * 0.85;
    g.strokeStyle = "#fff";
    g.lineWidth = Math.max(1, scaleLen(7) * (1 - fast));
    g.beginPath();
    g.arc(ex, ey, scaleLen(16 + fast * 80), 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = Math.max(0, 1 - fast * 1.8);
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(ex, ey, scaleLen(26) * (1 - fast), 0, Math.PI * 2);
    g.fill();
    // 破碎：2 大塊往相反方向裂開（慢飛緩翻）+ 數個小碎片四散
    const drawChunk = (dir: number, dist: number, drop: number, rot: number, fr: number, half: number, alp: number, edge: boolean) => {
      g.save();
      g.globalAlpha = alp;
      g.translate(ex + Math.cos(dir) * dist, ey + Math.sin(dir) * dist + drop);
      g.rotate(rot);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, fr, -half, half);
      g.closePath();
      g.fill();
      if (edge) {
        g.strokeStyle = "rgba(255,255,255,0.6)";
        g.lineWidth = 1.5;
        g.stroke();
      }
      g.restore();
    };
    const splitAxis = hash01(k * 2.7) * Math.PI; // 裂開軸向
    for (let i = 0; i < 2; i++) {
      const dir = splitAxis + (i === 0 ? 0 : Math.PI); // 兩大塊相反方向
      const dist = scaleLen(8 + 30 * (0.7 + hash01(k * 9.3 + i) * 0.3)) * a;
      const rot = dir + a * (1.4 + hash01(k + i)) * (i ? 1 : -1); // 緩翻
      drawChunk(dir, dist, scaleLen(56) * a * a, rot, scaleLen(16) * (1 - a * 0.35), 0.95, (1 - a) * 0.96, true);
    }
    const SMALL = 7;
    for (let i = 0; i < SMALL; i++) {
      const ang = hash01(k * 31.3 + i * 2.7) * Math.PI * 2;
      const spd = 0.6 + hash01(k * 17.1 + i * 3.3) * 0.5;
      const rot = ang + a * (4 + hash01(k + i) * 5) * (i % 2 ? 1 : -1);
      drawChunk(ang, scaleLen(16 + 92 * spd) * a, scaleLen(50) * a * a, rot, scaleLen(4 + hash01(k * 7.7 + i) * 4) * (1 - a * 0.5), 0.5, (1 - a) * 0.92, false);
    }
    // 細火星
    g.fillStyle = "#ffd24d";
    for (let i = 0; i < 10; i++) {
      const ang = hash01(k * 91.3 + i * 3.1) * Math.PI * 2;
      const d = scaleLen(18 + 130 * (0.4 + hash01(k * 7.3 + i) * 0.6)) * a;
      g.globalAlpha = (1 - a) * 0.9;
      g.beginPath();
      g.arc(ex + Math.cos(ang) * d, ey + Math.sin(ang) * d, Math.max(0.5, scaleLen(2.5) * (1 - a)), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}

function draw() {
  if (!ctx) return;
  const g = ctx;
  const { cx, cy, R } = drawArena(g);

  if (phase.value === "playing" && result.value) {
    const frames = result.value.frames;
    // 相鄰幀內插：慢動作 / 任何播放速度都滑順，旋轉也連續
    const ph = Math.max(0, Math.min(frames.length - 1, playhead.value));
    const i0 = Math.floor(ph);
    const i1 = Math.min(frames.length - 1, i0 + 1);
    const idx = i0;
    const frame = lerpFrame(frames[i0], frames[i1], ph - i0);
    // 軌跡尾巴
    for (const b of frame.bodies) {
      if (b.isClone) continue; // 分身不畫尾巴
      const col = colorOf(b.id);
      g.beginPath();
      let started = false;
      for (let f = Math.max(0, idx - 40); f <= idx; f++) {
        const tb = frames[f].bodies.find((x) => x.id === b.id);
        if (!tb) continue;
        const [px, py] = toCanvas(tb.x, tb.y);
        started ? g.lineTo(px, py) : g.moveTo(px, py);
        started = true;
      }
      g.strokeStyle = col + "55";
      g.lineWidth = 2;
      g.stroke();
    }
    // 擊破(ko)的陀螺 → 不畫半透明陀螺，改由 drawDeaths 畫破碎碎片
    const koIds = new Set(result.value.deathEvents.filter((d) => d.reason === "ko").map((d) => d.id));
    // 陀螺 + 撞牆閃光
    for (const b of frame.bodies) {
      if (b.isClone) {
        if (!b.alive) continue; // 未啟用/已消失的分身不畫
        const oid = b.ownerId ?? b.id;
        drawTop(g, b.x, b.y, b.z ?? 0, b.angle, colorOf(oid), 20, true, presetOf(oid), 0.7 * (b.cloneFade ?? 1), true); // 暗色小分身、末段淡出
        continue;
      }
      if (!b.alive && koIds.has(b.id)) continue; // 擊破者交給破碎特效
      const col = colorOf(b.id);
      const distC = Math.hypot(b.x, b.y);
      if (b.alive && (b.z ?? 0) < 12 && distC > arena.value.radius - 26 - 8) {
        const sAng = Math.atan2(toCanvas(b.x, b.y)[1] - cy, toCanvas(b.x, b.y)[0] - cx);
        g.save();
        g.beginPath();
        g.arc(cx, cy, R, sAng - 0.22, sAng + 0.22);
        g.lineWidth = 9;
        g.strokeStyle = "#fff";
        g.globalAlpha = 0.85;
        g.shadowColor = col;
        g.shadowBlur = 18;
        g.stroke();
        g.restore();
      }
      drawTop(g, b.x, b.y, b.z ?? 0, b.angle, col, 26, b.alive, presetOf(b.id));
    }

    // 碰撞火花 + 擊破爆裂
    const curT = ph / 60;
    drawSparks(g, curT);
    drawDeaths(g, curT);

    // 必殺技發動特效：擴張光環（持續 0.55s）
    for (const ev of result.value.specialEvents) {
      const dtv = curT - ev.t;
      if (dtv < 0 || dtv > 0.55) continue;
      const fb = frame.bodies.find((x) => x.id === ev.id);
      if (!fb) continue;
      const [ex, ey] = toCanvas(fb.x, fb.y);
      const prog = dtv / 0.55;
      const ecol = specialColor(ev);
      g.save();
      g.globalAlpha = (1 - prog) * 0.9;
      g.strokeStyle = ecol;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(ex, ey, scaleLen(26) + prog * 70, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // 必殺技停格 banner：大字招式名（停格期間顯示，讓人看清是什麼招）
    if (freezeEvent.value) {
      const ev = freezeEvent.value;
      const name = SPECIAL_NAMES[ev.kind];
      const ecol = specialColor(ev);
      g.save();
      g.globalAlpha = 0.16;
      g.fillStyle = "#05080d";
      g.fillRect(0, 0, SIZE, SIZE);
      g.globalAlpha = 1;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "900 56px system-ui, sans-serif";
      g.lineWidth = 8;
      g.strokeStyle = "rgba(5,8,13,0.92)";
      g.strokeText(name, SIZE / 2, SIZE * 0.2);
      g.fillStyle = ecol;
      g.fillText(name, SIZE / 2, SIZE * 0.2);
      g.font = "bold 16px system-ui";
      g.fillStyle = "#aebbd4";
      g.fillText(colorOf(ev.id) === setupA.color ? "紅方 必殺技!" : "藍方 必殺技!", SIZE / 2, SIZE * 0.2 + 42);
      g.textBaseline = "alphabetic";
      g.restore();
    }
    return;
  }

  // 瞄準階段：畫已鎖定的陀螺 + 目前拖曳
  if (launchA.value) drawTop(g, launchA.value.position.x, launchA.value.position.y, 0, 0, setupA.color, 26, true, setupA.preset);
  if (launchB.value) drawTop(g, launchB.value.position.x, launchB.value.position.y, 0, 0, setupB.color, 26, true, setupB.preset);

  if (dragging.value) {
    const setup = phase.value === "aim-A" ? setupA : setupB;
    const [sx, sy] = toCanvas(dragStart.x, dragStart.y);
    drawTop(g, dragStart.x, dragStart.y, 0, 0, setup.color, 26, true, setup.preset, 0.5);

    let ax = sx;
    let ay = sy;
    if (launchMode.value === "sling") {
      const [px, py] = toCanvas(dragCurrent.x, dragCurrent.y);
      g.save();
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(px, py);
      g.strokeStyle = "#ffffff66";
      g.lineWidth = 2;
      g.stroke();
      g.restore();
      ax = sx - (px - sx); // 拉的反方向
      ay = sy - (py - sy);
    } else {
      const v = flickWorldVel();
      if (v.speed > 1) {
        const p = Math.min(1, v.speed / V_FULL);
        const len = 35 + p * 120;
        // 箭頭指向發射方向＝拖曳速度反向（世界→螢幕再做 y 反向）
        ax = sx - (v.wx / v.speed) * len;
        ay = sy + (v.wy / v.speed) * len;
      }
    }

    // 發射方向箭頭
    if (ax !== sx || ay !== sy) {
      g.save();
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(ax, ay);
      g.strokeStyle = setup.color;
      g.lineWidth = 4;
      g.stroke();
      const ang = Math.atan2(ay - sy, ax - sx);
      g.translate(ax, ay);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-12, -7);
      g.lineTo(-12, 7);
      g.closePath();
      g.fillStyle = setup.color;
      g.fill();
      g.restore();
    }

    // 力道
    g.save();
    g.fillStyle = "#fff";
    g.font = "bold 16px system-ui";
    g.fillText(`力道 ${powerPct.value}%`, sx + 14, sy - 12);
    g.restore();
  }
}

/* ---------- 結果顯示 ---------- */
function frameAt() {
  const frames = result.value?.frames;
  if (!frames) return null;
  return frames[Math.max(0, Math.min(frames.length - 1, Math.round(playhead.value)))];
}
function spinPct(id: string): number {
  const f = frameAt();
  const b = f?.bodies.find((x) => x.id === id);
  return b ? Math.max(0, Math.min(100, (b.spin / DEFAULT_SCALES.maxSpin) * 100)) : 0;
}
function hpPct(id: string): number {
  const f = frameAt();
  const b = f?.bodies.find((x) => x.id === id);
  if (!b) return 0;
  const maxHp = maxHpFor(getStats(id === "A" ? setupA.preset : setupB.preset), arena.value.hpBase);
  return Math.max(0, Math.min(100, (b.hp / maxHp) * 100));
}
const teamIds = ["A", "B"];
function currentTime(): string {
  return frameAt()?.t.toFixed(2) ?? "0.00";
}
const reasonText: Record<string, string> = {
  "ring-out": "擊出界",
  "spin-out": "停轉",
  timeout: "時間到（比體力）",
  draw: "平手",
  ko: "擊破",
};
function roundResultLabel(): string {
  const r = result.value;
  if (!r) return "";
  if (!r.winnerId) return "平手 — 無人得分";
  const name = r.winnerId === "A" ? "紅方 A" : "藍方 B";
  return `${name} ${reasonText[r.reason]} ＋${lastRoundPoints.value} 分`;
}
function championLabel(): string {
  return scoreA.value >= WIN_SCORE ? "🏆 紅方 A 奪冠！" : "🏆 藍方 B 奪冠！";
}
function isFinished(): boolean {
  const frames = result.value?.frames;
  return !!frames && !playing.value && Math.round(playhead.value) >= frames.length - 1;
}

/** 必殺技觸發說明（讀陀螺後台目前數值）：條件 · 機率 · 冷卻 · 每回合次數。 */
function specialInfo(kind: "" | SpecialKind): string {
  const s = special;
  const pct = (c: number) => Math.round(c * 100);
  switch (kind) {
    case "rush":
      return `逼近觸發 · ${pct(s.rushChance)}% · 冷卻 ${s.rushCooldown}s · 每回合 ${s.rushMaxUses} 次`;
    case "blast":
      return `猛擊觸發 · ${pct(s.blastChance)}% · 冷卻 ${s.blastCooldown}s · 每回合 ${s.blastMaxUses} 次`;
    case "dash":
      return `自旋偏低觸發 · ${pct(s.dashChance)}% · 冷卻 ${s.dashCooldown}s · 每回合 ${s.dashMaxUses} 次`;
    case "vortex":
      return `對手進範圍觸發 · ${pct(s.vortexChance)}% · 冷卻 ${s.vortexCooldown}s · 每回合 ${s.vortexMaxUses} 次`;
    case "clone":
      return `對手進範圍觸發 · ${pct(s.cloneChance)}% · 冷卻 ${s.cloneCooldown}s · 每回合 ${s.cloneMaxUses} 次`;
    default:
      return "";
  }
}

/** 必殺技顯示名（停格 banner 用，全形排版）。 */
const SPECIAL_NAMES: Record<SpecialKind, string> = {
  rush: "突　進",
  blast: "衝　擊",
  dash: "高速移動",
  vortex: "旋　渦",
  clone: "分　身",
};
/** 必殺技特效色：blast 黃 / dash 青 / vortex 紫 / rush・clone 用玩家色。 */
function specialColor(ev: SpecialEvent): string {
  switch (ev.kind) {
    case "blast":
      return "#ffce4d";
    case "dash":
      return "#5fd0ff";
    case "vortex":
      return "#c07bff";
    default:
      return colorOf(ev.id);
  }
}

/** 對戰場直接切換場地（含綠牆場 / 一般場）→ 套用並重開一局。 */
function selectArena(e: Event) {
  setActive((e.target as HTMLSelectElement).value);
  arena.value = getActiveConfig();
  arenaName.value = activePresetName();
  resetMatch();
}

/* ---------- 生命週期 ---------- */
onMounted(() => {
  if (canvas.value) ctx = canvas.value.getContext("2d");
  arena.value = getActiveConfig();
  arenaName.value = activePresetName();
  loadSprites();
  draw();
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="layout">
    <!-- 左：設定 -->
    <div class="controls">
      <div class="phase-banner">{{ phaseText }}</div>

      <div class="mode-toggle">
        <span class="mode-label">發射方式</span>
        <button :class="{ active: launchMode === 'flick' }" @click="launchMode = 'flick'">甩動</button>
        <button :class="{ active: launchMode === 'sling' }" @click="launchMode = 'sling'">拉弓</button>
      </div>

      <div class="player-card" :class="{ dim: phase !== 'aim-A' && !!launchA }" :style="{ borderColor: setupA.color }">
        <h3 :style="{ color: setupA.color }">🔴 紅方 A <span v-if="launchA" class="ready">✓ 已發射</span></h3>
        <label class="field">類型
          <select v-model="setupA.preset" :disabled="!!launchA">
            <option v-for="k in presetKeys" :key="k" :value="k">{{ PRESET_LABELS[k] }}</option>
          </select>
        </label>
        <label class="field">旋向
          <select v-model.number="setupA.spinDir" :disabled="!!launchA">
            <option :value="1">↺ 逆時針（右旋）</option>
            <option :value="-1">↻ 順時針（左旋）</option>
          </select>
        </label>
        <label class="field">必殺技
          <select v-model="setupA.special" :disabled="!!launchA">
            <option value="">無</option>
            <option value="rush">🗡️ 衝刺突進</option>
            <option value="blast">💥 衝擊</option>
            <option value="dash">⚡ 高速移動</option>
            <option value="vortex">🌀 旋渦</option>
            <option value="clone">👥 分身</option>
          </select>
        </label>
        <p v-if="setupA.special" class="sp-info">⚡ {{ specialInfo(setupA.special) }}</p>
      </div>

      <div class="player-card" :class="{ dim: phase === 'aim-A' }" :style="{ borderColor: setupB.color }">
        <h3 :style="{ color: setupB.color }">🔵 藍方 B <span v-if="launchB" class="ready">✓ 已發射</span></h3>
        <label class="field">類型
          <select v-model="setupB.preset" :disabled="!!launchB">
            <option v-for="k in presetKeys" :key="k" :value="k">{{ PRESET_LABELS[k] }}</option>
          </select>
        </label>
        <label class="field">旋向
          <select v-model.number="setupB.spinDir" :disabled="!!launchB">
            <option :value="1">↺ 逆時針（右旋）</option>
            <option :value="-1">↻ 順時針（左旋）</option>
          </select>
        </label>
        <label class="field">必殺技
          <select v-model="setupB.special" :disabled="!!launchB">
            <option value="">無</option>
            <option value="rush">🗡️ 衝刺突進</option>
            <option value="blast">💥 衝擊</option>
            <option value="dash">⚡ 高速移動</option>
            <option value="vortex">🌀 旋渦</option>
            <option value="clone">👥 分身</option>
          </select>
        </label>
        <p v-if="setupB.special" class="sp-info">⚡ {{ specialInfo(setupB.special) }}</p>
      </div>

      <label class="arena-info">場地：
        <select class="arena-select" :value="activeId" @change="selectArena">
          <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <button class="reset-btn" @click="resetMatch">↺ 重新對戰</button>
      <p class="hint">{{ hintText }}</p>
    </div>

    <!-- 右：場地 -->
    <div class="arena-pane">
      <div class="scoreboard">
        <span class="sc-team" :style="{ color: setupA.color }">紅 {{ scoreA }}</span>
        <span class="sc-mid">第 {{ roundNum }} 回合 · 先到 {{ WIN_SCORE }} 分</span>
        <span class="sc-team" :style="{ color: setupB.color }">{{ scoreB }} 藍</span>
      </div>

      <div class="hpbars" v-if="phase === 'playing'">
        <div class="pblock" v-for="id in teamIds" :key="id">
          <span class="hp-label" :style="{ color: colorOf(id) }">{{ id }}</span>
          <div class="bars">
            <div class="bar-row">
              <span class="bk">續</span>
              <div class="hp-track"><div class="hp-fill" :style="{ width: spinPct(id) + '%', background: colorOf(id) }"></div></div>
            </div>
            <div class="bar-row">
              <span class="bk">血</span>
              <div class="hp-track"><div class="hp-fill" :style="{ width: hpPct(id) + '%', background: colorOf(id), opacity: 0.55 }"></div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="canvas-wrap">
        <ArenaSvg :arena="arena" />
        <canvas
          ref="canvas"
          :width="SIZE"
          :height="SIZE"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        ></canvas>
        <div v-if="slowmo && playing" class="slowmo-badge">⏱ SLOW-MO</div>
        <div v-if="isFinished()" class="winner-banner" :class="{ champion: matchOver }">
          <template v-if="matchOver">{{ championLabel() }}</template>
          <template v-else>{{ roundResultLabel() }}</template>
        </div>
      </div>

      <div class="replay" v-if="phase === 'playing' && result">
        <button class="ctrl" @click="togglePlay">{{ playing ? "⏸" : "▶" }}</button>
        <input class="scrub" type="range" min="0" :max="result.frames.length - 1" step="1" v-model.number="playhead" @mousedown="pause" />
        <span class="time">{{ currentTime() }}s / {{ result.duration.toFixed(2) }}s</span>
        <select v-model.number="speed" class="speed">
          <option :value="0.25">0.25x</option>
          <option :value="0.5">0.5x</option>
          <option :value="1">1x</option>
          <option :value="2">2x</option>
          <option :value="3">3x</option>
        </select>
        <button v-if="matchOver" class="again" @click="resetMatch">🔄 重新比賽</button>
        <button v-else class="again" @click="nextRound">下一回合 →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 20px;
  align-items: start;
}
.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.phase-banner {
  background: var(--accent);
  color: #1a1207;
  font-weight: 800;
  font-size: 16px;
  text-align: center;
  border-radius: 10px;
  padding: 12px;
}
.mode-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mode-label {
  font-size: 12px;
  color: var(--muted);
  margin-right: 2px;
}
.mode-toggle button {
  flex: 1;
  background: var(--panel-2);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.mode-toggle button.active {
  background: var(--accent);
  color: #1a1207;
  border-color: var(--accent);
}
.player-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-left-width: 4px;
  border-radius: 12px;
  padding: 12px 14px;
  transition: opacity 0.2s;
}
.player-card.dim {
  opacity: 0.5;
}
.player-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ready {
  font-size: 12px;
  color: #6ad08a;
}
.sp-info {
  margin: -2px 0 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  background: var(--panel-2);
  border-radius: 7px;
  padding: 5px 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}
.field select {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 13px;
}
.field select:disabled {
  opacity: 0.55;
}
.arena-info {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--muted);
  padding: 4px 2px;
}
.arena-info b {
  color: var(--text);
}
.arena-select {
  flex: 1;
  min-width: 0;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px 9px;
  font-size: 13px;
  cursor: pointer;
}
.reset-btn {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  font-size: 14px;
  cursor: pointer;
}
.scoreboard {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 16px;
}
.sc-team {
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.sc-mid {
  font-size: 12px;
  color: var(--muted);
}
.hint {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
  margin: 2px 0 0;
}
.arena-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hpbars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pblock {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hp-label {
  width: 16px;
  font-weight: 800;
  font-size: 13px;
}
.bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bk {
  width: 14px;
  font-size: 10px;
  color: var(--muted);
  flex-shrink: 0;
}
.hp-track {
  flex: 1;
  height: 9px;
  background: var(--panel-2);
  border-radius: 5px;
  overflow: hidden;
}
.hp-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.06s linear;
}
.canvas-wrap {
  position: relative;
  width: 640px;
  max-width: 100%;
}
canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  height: auto;
  border-radius: 16px;
  border: 1px solid var(--line);
  display: block;
  background: transparent;
  touch-action: none;
  cursor: crosshair;
}
.slowmo-badge {
  position: absolute;
  top: 14px;
  left: 14px;
  background: rgba(255, 209, 102, 0.16);
  color: var(--accent);
  border: 1px solid var(--accent);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 1px;
  padding: 5px 11px;
  border-radius: 8px;
  pointer-events: none;
}
.winner-banner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(10, 13, 19, 0.82);
  color: var(--accent);
  font-size: 26px;
  font-weight: 800;
  padding: 16px 28px;
  border-radius: 14px;
  border: 1px solid var(--accent);
  white-space: nowrap;
}
.winner-banner.champion {
  font-size: 30px;
  background: rgba(255, 209, 102, 0.18);
}
.replay {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ctrl {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  width: 44px;
  height: 36px;
  font-size: 16px;
  cursor: pointer;
}
.scrub {
  flex: 1;
  min-width: 140px;
  accent-color: var(--accent);
}
.time {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.speed {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 5px 8px;
}
.again {
  background: var(--accent);
  color: #1a1207;
  border: none;
  border-radius: 9px;
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .canvas-wrap {
    width: 100%;
  }
}
</style>
