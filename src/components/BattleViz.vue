<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { simulate, DEFAULT_SCALES, maxHpFor } from "../physics/engine";
import type { ArenaConfig, BeybladeInit, Frame, SimResult, SpecialKind } from "../physics/types";
import { STAT_PRESETS, PRESET_LABELS } from "../physics/presets";
import { getActiveConfig, activePresetName } from "../store/arenaStore";
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

// 護牆缺口（高分區）：世界角度 上(+y) / 下(-y)，半寬內出界 = 2 分
const POCKET_ANGLES = [Math.PI / 2, -Math.PI / 2];
const POCKET_HALF = 0.42;
function pocketPoints(angle: number | null): number {
  if (angle == null || !Number.isFinite(angle)) return 1;
  for (const pa of POCKET_ANGLES) {
    let d = Math.abs(angle - pa);
    d = Math.min(d, Math.PI * 2 - d);
    if (d < POCKET_HALF) return 2;
  }
  return 1;
}
function roundPoints(r: SimResult): number {
  if (!r.winnerId) return 0;
  if (r.reason === "ko") return 2;
  if (r.reason === "ring-out") return pocketPoints(r.ringOutAngle);
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
const speed = ref(1);

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
function toCanvas(x: number, y: number): [number, number] {
  const pad = 28;
  const scale = (SIZE / 2 - pad) / arena.value.radius;
  return [SIZE / 2 + x * scale, SIZE / 2 - y * scale];
}
function scaleLen(v: number): number {
  const pad = 28;
  return v * ((SIZE / 2 - pad) / arena.value.radius);
}
function clientToWorld(e: PointerEvent): { x: number; y: number } {
  const el = canvas.value!;
  const rect = el.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (SIZE / rect.width);
  const sy = (e.clientY - rect.top) * (SIZE / rect.height);
  const pad = 28;
  const scale = (SIZE / 2 - pad) / arena.value.radius;
  let x = (sx - SIZE / 2) / scale;
  let y = (SIZE / 2 - sy) / scale;
  // 限制落點在場內
  const r = Math.hypot(x, y);
  const lim = arena.value.radius * 0.92;
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
    const curT = playhead.value / 60; // dt=1/60、sampleEvery=1 → 幀索引即 t*60
    const mul = slowmoMul(curT);
    slowmo.value = mul < 1;
    playhead.value += (dtMs / 1000) * 60 * speed.value * mul;
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
  if (playhead.value >= frames.length - 1) playhead.value = 0;
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
function drawArena(g: CanvasRenderingContext2D): { cx: number; cy: number; R: number } {
  g.clearRect(0, 0, SIZE, SIZE);
  g.fillStyle = "#0b0e13";
  g.fillRect(0, 0, SIZE, SIZE);
  const [cx, cy] = toCanvas(0, 0);
  const R = scaleLen(arena.value.radius);
  for (let i = 5; i >= 1; i--) {
    g.beginPath();
    g.arc(cx, cy, (R * i) / 5, 0, Math.PI * 2);
    g.fillStyle = i % 2 === 0 ? "#141a24" : "#10151d";
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy, R - 6, 0, Math.PI * 2);
  g.lineWidth = 12;
  g.strokeStyle = "rgba(255,93,93,0.10)";
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.lineWidth = 7;
  g.strokeStyle = "#7d8aa8";
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.lineWidth = 2;
  g.strokeStyle = "#aab6d4";
  g.stroke();

  // 護牆缺口（高分區 2 分）：金色粗弧 + 2× 標記。世界角度 → 畫布角度為 -θ
  for (const pa of POCKET_ANGLES) {
    const ca = -pa;
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, ca - POCKET_HALF, ca + POCKET_HALF);
    g.lineWidth = 9;
    g.strokeStyle = "#ffd166";
    g.shadowColor = "#ffd166";
    g.shadowBlur = 10;
    g.stroke();
    g.restore();
    g.save();
    g.fillStyle = "#ffd166";
    g.font = "bold 13px system-ui";
    g.textAlign = "center";
    g.fillText("2×", cx + Math.cos(ca) * (R - 20), cy + Math.sin(ca) * (R - 20) + 4);
    g.restore();
  }
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
    // 陀螺 + 撞牆閃光
    for (const b of frame.bodies) {
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

    // 必殺技發動特效（光環 + 文字）
    const curT = ph / 60;
    for (const ev of result.value.specialEvents) {
      const dtv = curT - ev.t;
      if (dtv < 0 || dtv > 0.5) continue;
      const fb = frame.bodies.find((x) => x.id === ev.id);
      if (!fb) continue;
      const [ex, ey] = toCanvas(fb.x, fb.y);
      const prog = dtv / 0.5;
      const ecol = ev.kind === "blast" ? "#ffce4d" : colorOf(ev.id);
      g.save();
      g.globalAlpha = 1 - prog;
      g.strokeStyle = ecol;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(ex, ey, scaleLen(26) + prog * 64, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = ecol;
      g.font = "bold 20px system-ui";
      g.textAlign = "center";
      g.fillText(ev.kind === "blast" ? "衝擊!" : "突進!", ex, ey - scaleLen(26) - 16 - prog * 28);
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
            <option value="rush">衝刺突進</option>
            <option value="blast">衝擊</option>
          </select>
        </label>
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
            <option value="rush">衝刺突進</option>
            <option value="blast">衝擊</option>
          </select>
        </label>
      </div>

      <div class="arena-info">場地：<b>{{ arenaName }}</b></div>
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
  font-size: 13px;
  color: var(--muted);
  padding: 4px 2px;
}
.arena-info b {
  color: var(--text);
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
  width: 100%;
  height: auto;
  border-radius: 16px;
  border: 1px solid var(--line);
  display: block;
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
