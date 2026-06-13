import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { simulate, DEFAULT_SCALES, maxHpFor } from "../physics/engine";
import type {
  ArenaConfig,
  BeybladeInit,
  BeybladeStats,
  Frame,
  SimResult,
  SpecialConfig,
  SpecialKind,
  SpecialEvent,
} from "../physics/types";
import { STAT_PRESETS, PRESET_LABELS } from "../physics/presets";
import { getBey, resolveBeyStats } from "../game/beyblades";
import { getActiveConfig, activePresetName, presets, activeId, setActive } from "../store/arenaStore";
import { getStats } from "../store/statStore";
import { special } from "../store/specialStore";
import { WIN_SCORE, roundPoints as sharedRoundPoints } from "../game/scoring";
import type { AimInput } from "../game/room";
import {
  sfxEnabled,
  resumeAudio,
  playCollision,
  playSpecial,
  playKO,
  playRingOut,
  playSpinOut,
  playLaunch,
  playWin,
  playLose,
} from "../audio/sfx";

/**
 * 對戰邏輯 composable —— 從 BattleViz.vue 的 <script> 完整萃取而來（發射手感、伺服器
 * 統一運算邊界、回放 tick 迴圈、整套 canvas 繪製、計分賽制）。與版面無關，桌面版 /
 * 手機版只需各自寫 template + CSS 來消費同一份邏輯（同源 → 行為一致）。
 *
 * canvas 由本 composable 建立並回傳；SFC 模板用 `ref="canvas"` 綁定即可。
 */
export interface UseBattleOptions {
  /** 預設發射方式（手機版用「拉弓」較好控制；桌面慣用「甩動」）。 */
  defaultLaunchMode?: "flick" | "sling";
  /**
   * 線上模式攔截點：自己瞄準放手時呼叫。回傳 true = 已處理（送往伺服器），
   * composable 不跑本機「換邊瞄準/本機模擬」流程。不傳 = 原本單機行為。
   */
  onLaunchSubmit?: (aim: AimInput, init: BeybladeInit) => boolean;
}

export function useBattle(opts: UseBattleOptions = {}) {
  /* ---------- 場地（來自後台選定的設定） ---------- */
  const arena = ref<ArenaConfig>(getActiveConfig());
  const arenaName = ref(activePresetName());
  const maxTime = 60;

  /* ---------- 玩家設定（發射前選好：陀螺 + 旋向） ---------- */
  interface Setup {
    id: string;
    color: string;
    /** 名冊陀螺 id（測試頁可選全 10 顆；本機模擬屬性 = 類型基礎值 × 個體差） */
    beyId: string;
    /** 類型（跟著 beyId 自動同步；顏色 / 貼圖 / 線上 statsOverride key 照舊吃它） */
    preset: string;
    spinDir: 1 | -1;
    special: "" | SpecialKind;
  }
  const setupA = reactive<Setup>({ id: "A", color: "#e8442e", beyId: "celestial-pivot-quake", preset: "balance", spinDir: 1, special: "rush" });
  const setupB = reactive<Setup>({ id: "B", color: "#2e9fe8", beyId: "scarlet-blaze-wheel", preset: "attack", spinDir: -1, special: "blast" });
  const presetKeys = Object.keys(STAT_PRESETS);
  // 換陀螺 → 類型自動跟隨（select 直接 v-model beyId 即可；線上模式不改 beyId、不受影響）
  for (const s of [setupA, setupB]) {
    watch(
      () => s.beyId,
      (id) => {
        const bey = getBey(id);
        if (bey) s.preset = bey.type;
      },
    );
  }

  /* ---------- 對戰流程狀態機 ---------- */
  type Phase = "aim-A" | "aim-B" | "playing";
  const phase = ref<Phase>("aim-A");
  const launchA = ref<BeybladeInit | null>(null);
  const launchB = ref<BeybladeInit | null>(null);

  const phaseText = computed(() => {
    if (phase.value === "aim-A") return "紅方 A 發射";
    if (phase.value === "aim-B") return "藍方 B 發射";
    return "對戰回放";
  });

  /* ---------- 計分賽制（先到 N 分，WIN_SCORE 在 src/game/scoring.ts）---------- */
  const scoreA = ref(0);
  const scoreB = ref(0);
  const roundNum = ref(1);
  const roundScored = ref(false);
  const lastRoundPoints = ref(0);
  const matchOver = computed(() => scoreA.value >= WIN_SCORE || scoreB.value >= WIN_SCORE);

  // 勝負音視角：線上由 useOnlineBattle 設 mySide（"A"/"B"），並在 playRemoteRound 帶入伺服器
  // outcome（remoteMatchOver/remoteWinnerSide）；測試頁 mySide 維持 null＝用本機分數判定。
  const mySide = ref<"A" | "B" | null>(null);
  const remoteMatchOver = ref(false);
  const remoteWinnerSide = ref<"A" | "B" | "" | null>(null); // ""＝平手（falsy → 不播勝負音）

  // 出界計分依場地「邊緣分區」資料：邏輯抽到 src/game/scoring.ts（與 Battle Room DO 共用）
  function roundPoints(r: SimResult): number {
    return sharedRoundPoints(arena.value, r);
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

  /* ---------- 線上模式注入點 ---------- */
  // 屬性覆寫：線上對戰用伺服器（D1 全域）的 stats，不吃本機 localStorage；null = 本機行為
  const statsOverride = ref<Record<string, BeybladeStats> | null>(null);
  function statsFor(setup: Setup): BeybladeStats {
    // 線上：伺服器（D1 全域）那份為準，照舊以類型為 key（DO 端已依 loadout 組裝、不在此疊個體差）
    const o = statsOverride.value?.[setup.preset];
    if (o) return { ...o };
    // 本機：名冊個體差 × 該類型 tuning 基礎值（與 DO 同一條 resolveBeyStats 公式）
    const bey = getBey(setup.beyId);
    const base = getStats(setup.preset);
    return bey ? resolveBeyStats(bey, base) : base;
  }
  // 必殺技數值來源：預設＝localStorage store（reactive，後台改動即時生效）；線上換成伺服器那份
  const specialCfg = ref<SpecialConfig>(special);

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
  const launchMode = ref<"flick" | "sling">(opts.defaultLaunchMode ?? "flick");
  const V_FULL = 5200; // 甩動：達到全力的甩速（越大越能分辨快慢；太小會一甩就爆表）
  let samples: { cx: number; cy: number; t: number }[] = [];
  let pxToWorld = 1; // 螢幕像素 → 世界單位的換算（pointerdown 時計算）

  const hintText = computed(() =>
    launchMode.value === "flick"
      ? "點住設定落點，朝目標方向「甩」一下放手；甩越快力道越大（整個視窗都能甩）。"
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
    const built = launchMode.value === "sling" ? buildLaunchFromSling() : buildLaunchFromFlick();
    if (!built) {
      draw(); // 力道太小，忽略，維持瞄準
      return;
    }
    submitLaunch(built.init, built.aim);
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

  function makeInit(dirx: number, diry: number, power: number): { init: BeybladeInit; aim: AimInput } {
    const setup = phase.value === "aim-A" ? setupA : setupB;
    const speed = power * DEFAULT_SCALES.maxSpeed;
    const spin = (0.55 + 0.45 * power) * DEFAULT_SCALES.maxSpin;
    return {
      init: {
        id: setup.id,
        color: setup.color,
        stats: statsFor(setup),
        position: { x: dragStart.x, y: dragStart.y },
        velocity: { x: dirx * speed, y: diry * speed },
        spin,
        radius: 26,
        spinDir: setup.spinDir,
        special: setup.special || undefined,
      },
      // 線上模式只送「瞄準輸入」：stats/special 由伺服器依 loadout 組裝（防竄改）
      aim: { x: dragStart.x, y: dragStart.y, dirX: dirx, dirY: diry, power },
    };
  }
  function buildLaunchFromSling(): { init: BeybladeInit; aim: AimInput } | null {
    const pullx = dragStart.x - dragCurrent.x;
    const pully = dragStart.y - dragCurrent.y;
    const dist = Math.hypot(pullx, pully);
    const power = currentSlingPower();
    if (power < 0.06 || dist < 1e-3) return null;
    return makeInit(pullx / dist, pully / dist, power);
  }
  function buildLaunchFromFlick(): { init: BeybladeInit; aim: AimInput } | null {
    const v = flickWorldVel();
    const power = Math.min(1, v.speed / V_FULL);
    if (power < 0.06 || v.speed < 1e-3) return null;
    // 發射方向＝拖曳速度的「反方向」（像往後甩 → 往前射）
    return makeInit(-v.wx / v.speed, -v.wy / v.speed, power);
  }

  /* ---------- 流程：分開發射 → 伺服器統一運算 ---------- */
  function submitLaunch(init: BeybladeInit, aim?: AimInput) {
    resumeAudio(); // 發射是使用者手勢 → 解除 autoplay 限制
    // 線上模式：交給外部（送伺服器），不跑本機換邊/模擬；
    // 發射音效由外部在「真正送出」時播（斷線被丟棄時不播，不誤導）
    if (aim && opts.onLaunchSubmit?.(aim, init)) return;
    playLaunch();
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
      special: { ...specialCfg.value }, // 必殺技數值（陀螺後台可調）
    });
    playhead.value = 0;
    resetFreeze();
    phase.value = "playing";
    play();
  }

  /**
   * 線上模式回放：DO 廣播「重跑包」（inits + seed + config，~2KB），
   * 兩端用同一份確定性引擎重算出一模一樣的 frames → 不用傳 1.5MB 軌跡。
   * 勝負/計分以伺服器 outcome 為準（本機 awardRound 由 roundScored=true 關閉）。
   */
  function playRemoteRound(p: {
    inits: BeybladeInit[];
    seed: number;
    arena: ArenaConfig;
    special: SpecialConfig;
    maxTime?: number;
    followThroughTime?: number;
    outcome?: { matchOver?: boolean; winnerSide?: "A" | "B" | "" | null };
  }) {
    // 伺服器 outcome：勝負音用它判定（線上本機分數不權威，回放結束時播 win/lose 靠這個）
    remoteMatchOver.value = !!p.outcome?.matchOver;
    remoteWinnerSide.value = p.outcome?.winnerSide ?? null;
    arena.value = { ...p.arena };
    result.value = simulate(p.inits, {
      dt: 1 / 60,
      maxTime: p.maxTime ?? maxTime,
      arena: { ...p.arena },
      seed: p.seed,
      sampleEvery: 1,
      followThroughTime: p.followThroughTime ?? 2.5,
      special: { ...p.special },
    });
    roundScored.value = true; // 線上：計分權威在伺服器，關掉本機 awardRound
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
  let lastCollSfxAt = 0; // 撞擊音效節流（避免密集撞擊變機關槍）
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
      // 音效：播放窗格 (curT0, curT1] 內跨過的事件（撞擊取最強一筆+節流、必殺/死亡逐筆）
      if (sfxEnabled.value) {
        const r = result.value!;
        let maxImp = 0;
        for (const ce of r.collisionEvents) if (ce.t > curT0 && ce.t <= curT1 && ce.impact > maxImp) maxImp = ce.impact;
        if (maxImp > 30 && now - lastCollSfxAt > 55) {
          playCollision(maxImp);
          lastCollSfxAt = now;
        }
        for (const se of r.specialEvents) if (se.t > curT0 && se.t <= curT1) playSpecial(se.kind);
        for (const de of r.deathEvents)
          if (de.t > curT0 && de.t <= curT1) {
            if (de.reason === "ko") playKO();
            else if (de.reason === "ring-out") playRingOut();
            else playSpinOut();
          }
      }
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
        // 勝負音只在「整場 match 結束」播（每回合都歡呼太吵）：
        // 測試頁（mySide null）用本機分數 + 回合勝者；線上用伺服器 outcome（remoteMatch*）。
        if (sfxEnabled.value) {
          const online = mySide.value !== null;
          const ended = online ? remoteMatchOver.value : matchOver.value;
          const winner = online ? remoteWinnerSide.value : result.value?.winnerId;
          if (ended && winner) {
            const iWon = !online || mySide.value === winner;
            if (iWon) playWin();
            else playLose();
          }
        }
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
    applyShake(0); // 暫停瞬間清掉容器震動位移（之後沒有 tick 再畫，不能殘留）
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

    // 底部反光：黑鋼碗上改淺色金屬反光（低透明白橢圓），取代原本的黑影
    g.save();
    g.globalAlpha = Math.max(0.04, 0.16 - z / 320) * alpha;
    g.fillStyle = "#fff3d6";
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

  /* —— 打擊感視覺層（純呈現、不進引擎；震動抖動方向可用瀏覽器亂數） —— */
  // 動態縮減偏好：查一次即可（OS 設定改了要重整頁面，可接受）；開啟時關閉場地震動
  const reducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  // 每幀粒子預算（放射火花/碎屑/焊接火星共用）：密集強撞時保幀優先於華麗（行動裝置）
  const PARTICLE_BUDGET = 120;
  let particleBudget = PARTICLE_BUDGET;

  /* —— 場地震動（容器級）：觸發/振幅由 curT 推導（scrub 也穩），每幀位移方向用亂數抖 ——
   * 位移寫在 shakeEl（包住 ArenaSvg 底圖 + canvas 的容器）的 transform 上 →
   * 整個場地（含 SVG 底圖、疊在場上的 HUD）一起晃，而不是只有 canvas 內容在抖。
   * 常數以「顯示像素（640px 寬顯示時）」標定，寫入前依容器實際顯示寬等比換算
   * （shakeScale = clientWidth / 640）→ 手機縮小顯示時震幅也等比縮，手感一致。 */
  const shakeEl = ref<HTMLElement | null>(null);
  // 顯示寬換算快取：每幀讀 clientWidth 會強制 layout → 綁定 / resize 時量一次即可
  let shakeScale = 1;
  function updateShakeScale() {
    const el = shakeEl.value;
    if (el && el.clientWidth > 0) shakeScale = el.clientWidth / SIZE;
  }
  watch(shakeEl, updateShakeScale);
  let shakeApplied = false;
  /** 把震幅寫進容器 transform（直接 DOM 寫入、不走響應式；視覺層允許瀏覽器亂數）；amp<=0 清空不殘留位移。 */
  function applyShake(amp: number) {
    const el = shakeEl.value;
    if (!el) return;
    if (amp > 0) {
      const a = amp * shakeScale;
      el.style.transform = `translate(${(Math.random() * 2 - 1) * a}px, ${(Math.random() * 2 - 1) * a}px)`;
      shakeApplied = true;
    } else if (shakeApplied) {
      el.style.transform = "";
      shakeApplied = false;
    }
  }
  const SHAKE_IMPACT_MIN = 80; // 強撞門檻（沿法線接近速度；與焊接火星同步——會噴火星的撞擊就會震）
  const SHAKE_MAX = 12; // 撞擊震幅上限（顯示像素，640 寬基準）：強撞有明顯一震
  const SHAKE_DECAY = 8; // 指數衰減速率 → 約 0.45s 內歸零
  function shakeAmpAt(curT: number): number {
    if (reducedMotion) return 0;
    const r = result.value;
    if (!r) return 0;
    let amp = 0;
    for (const ce of r.collisionEvents) {
      if (ce.impact < SHAKE_IMPACT_MIN) continue;
      const age = curT - ce.t;
      if (age < 0 || age >= 0.45) continue;
      const a0 = Math.min(SHAKE_MAX, 4 + ((ce.impact - SHAKE_IMPACT_MIN) / 140) * (SHAKE_MAX - 4));
      amp = Math.max(amp, a0 * Math.exp(-age * SHAKE_DECAY));
    }
    // KO / 出界瞬間：一次大震（停轉是緩慢收尾、不震）；KO 18 / 出界 13（顯示像素），大但不暈
    for (const de of r.deathEvents) {
      if (de.reason === "spin-out") continue;
      const age = curT - de.t;
      if (age < 0 || age >= 0.6) continue;
      amp = Math.max(amp, (de.reason === "ko" ? 18 : 13) * Math.exp(-age * 7));
    }
    return amp < 0.3 ? 0 : amp;
  }

  /* —— 傷害數字：跨過 collisionEvents 在受傷陀螺上方彈「-N」，dash 回血彈「+N」 —— */
  const DMG_POP_DUR = 0.8; // 上浮 + 淡出時長
  const DMG_POP_MAX = 24; // 同屏並發 pop 上限（超出丟最舊）：dmg≥1 全彈之後靠這個防洗版
  // 全場平均傷害（heat 字級/字色縮放的基準）；以 result 參照做快取
  let dmgStatCache: { for: SimResult; avg: number } | null = null;
  function dmgPopStats(r: SimResult): { avg: number } {
    if (dmgStatCache && dmgStatCache.for === r) return dmgStatCache;
    let sum = 0;
    let n = 0;
    for (const ce of r.collisionEvents) {
      if (ce.dmgA != null) {
        sum += ce.dmgA;
        n++;
      }
      if (ce.dmgB != null) {
        sum += ce.dmgB;
        n++;
      }
    }
    const avg = n ? sum / n : 0;
    dmgStatCache = { for: r, avg };
    return dmgStatCache;
  }
  /** 傷害字色：琥珀（小傷）→ 紅（大傷），heat 0~1。 */
  function dmgColor(heat: number): string {
    const c1 = [255, 179, 31]; // --accent 琥珀
    const c2 = [232, 68, 46]; // --red
    const m = c1.map((v, i) => Math.round(v + (c2[i] - v) * heat));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  }
  /** 單顆浮動數字：上浮（ease-out）+ 末段淡出，深色描邊保可讀性（display 字感）。
   *  gold=true → 會心配色：金黃 #ffd700 → 琥珀垂直漸層；prefix → 字上方加小字（如「會心」）。 */
  function drawOnePop(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    txt: string,
    color: string,
    fontPx: number,
    age: number,
    seed: number,
    gold = false,
    prefix = "",
  ) {
    const p = age / DMG_POP_DUR;
    const ease = 1 - (1 - p) * (1 - p);
    const alpha = p < 0.55 ? 1 : Math.max(0, (1 - p) / 0.45);
    const px = x + (hash01(seed * 17.7) - 0.5) * scaleLen(26); // 同一顆連續彈 → 橫向錯開不疊字
    const py = y - scaleLen(36) - (scaleLen(34) + fontPx * 0.4) * ease;
    g.globalAlpha = alpha;
    g.font = `900 ${fontPx}px 'Big Shoulders Display', 'Noto Sans TC', sans-serif`;
    g.lineWidth = Math.max(3, fontPx * 0.16);
    g.strokeStyle = "rgba(5,8,13,0.85)";
    g.strokeText(txt, px, py);
    if (gold) {
      const grad = g.createLinearGradient(0, py - fontPx * 0.55, 0, py + fontPx * 0.55);
      grad.addColorStop(0, "#ffd700");
      grad.addColorStop(1, "#ffb31f"); // --accent 琥珀
      g.fillStyle = grad;
    } else {
      g.fillStyle = color;
    }
    g.fillText(txt, px, py);
    if (prefix) {
      const sp = Math.max(11, Math.round(fontPx * 0.4));
      g.font = `900 ${sp}px 'Noto Sans TC', sans-serif`;
      g.lineWidth = Math.max(2, sp * 0.18);
      g.strokeText(prefix, px, py - fontPx * 0.78);
      g.fillStyle = "#ffd700";
      g.fillText(prefix, px, py - fontPx * 0.78);
    }
  }
  /* —— 會心 starburst：受擊點一圈金黃放射短線短閃（0.3s、8 道；確定性 hash 微旋） —— */
  const CRIT_BURST_DUR = 0.3;
  function drawCritBurst(g: CanvasRenderingContext2D, ex: number, ey: number, age: number, seed: number) {
    const p = age / CRIT_BURST_DUR;
    const fade = 1 - p;
    g.save();
    g.lineCap = "round";
    g.globalCompositeOperation = "lighter";
    const rot = hash01(seed * 7.7) * 0.5; // 每次事件整圈微旋，避免每發都同角度
    const d0 = scaleLen(12 + 34 * p); // 由內向外擴
    const len = scaleLen(6 + 12 * fade);
    for (let i = 0; i < 8; i++) {
      const ang = rot + (i / 8) * Math.PI * 2;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      g.globalAlpha = fade;
      g.strokeStyle = i % 2 ? "#ffd700" : "#fff3d6"; // 金黃與白熱交錯
      g.lineWidth = 1.6 + 1.8 * fade;
      g.beginPath();
      g.moveTo(ex + c * d0, ey + sn * d0);
      g.lineTo(ex + c * (d0 + len), ey + sn * (d0 + len));
      g.stroke();
    }
    g.restore();
  }
  /** 傷害/回血數字層（最上層）：位置取「事件當下」幀的陀螺座標（數字釘在受擊點上方）。
   *  dmg ≥ 1 全部彈出（小傷害用小字級）；同屏超過 DMG_POP_MAX 顆時丟最舊（事件時間序）。 */
  function drawDamagePops(g: CanvasRenderingContext2D, curT: number, frames: Frame[]) {
    const r = result.value;
    if (!r) return;
    const { avg } = dmgPopStats(r);
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    // 第一遍：會心 starburst 直接畫（瞬閃不佔 pop 額度）；傷害數字先收集再裁同屏上限
    const pops: { x: number; y: number; txt: string; color: string; fontPx: number; age: number; seed: number; gold: boolean; prefix: string }[] = [];
    for (let k = 0; k < r.collisionEvents.length; k++) {
      const ce = r.collisionEvents[k];
      const age = curT - ce.t;
      if (age < 0 || age >= DMG_POP_DUR) continue;
      const fb = frames[Math.min(frames.length - 1, Math.round(ce.t * 60))];
      // 會心（任一側）：受擊點先閃一圈金黃 starburst（dmg/kb 兩種效果都閃）
      if ((ce.critA || ce.critB) && age < CRIT_BURST_DUR) {
        const [ex, ey] = toCanvas(ce.x, ce.y);
        drawCritBurst(g, ex, ey, age, k);
      }
      const sides: [string | undefined, number | undefined, "dmg" | "kb" | undefined][] = [
        [ce.aId, ce.dmgA, ce.critA],
        [ce.bId, ce.dmgB, ce.critB],
      ];
      for (let pi = 0; pi < 2; pi++) {
        const [id, dmg, crit] = sides[pi];
        if (!id) continue;
        const body = fb.bodies.find((x) => x.id === id);
        if (!body) continue;
        const [bx, by] = toCanvas(body.x, body.y);
        // 會心擊飛：受擊陀螺位置彈金黃「擊飛!」短字（與傷害數字 seed 錯開、不疊字）
        if (crit === "kb")
          pops.push({ x: bx, y: by, txt: "擊飛!", color: "#ffd700", fontPx: 20, age, seed: k * 2 + pi + 211, gold: true, prefix: "" });
        if (dmg == null) continue; // 舊回放資料無傷害欄位 → 不彈
        const n = Math.round(dmg);
        if (n < 1) continue; // dmg ≥ 1 全部彈出（不再吃平均門檻）
        const heat = Math.min(1, dmg / Math.max(1, avg * 2.2)); // 平均的 2.2 倍 → 全紅最大字
        const fontPx = Math.round(12 + 22 * heat); // 下限縮小：微小摩擦傷害＝小字不搶戲，大傷上限不變
        if (crit === "dmg") {
          // 會心傷害：金黃→琥珀漸層、字級 ×1.35、上方「會心」小字
          pops.push({ x: bx, y: by, txt: `-${n}`, color: "#ffd700", fontPx: Math.round(fontPx * 1.35), age, seed: k * 2 + pi, gold: true, prefix: "會心" });
        } else {
          pops.push({ x: bx, y: by, txt: `-${n}`, color: dmgColor(heat), fontPx, age, seed: k * 2 + pi, gold: false, prefix: "" });
        }
      }
    }
    // 同屏上限：collisionEvents 本身按時間排序 → 超量時砍掉最前面（最舊）的，只畫最新 DMG_POP_MAX 顆
    for (let i = Math.max(0, pops.length - DMG_POP_MAX); i < pops.length; i++) {
      const p = pops[i];
      drawOnePop(g, p.x, p.y, p.txt, p.color, p.fontPx, p.age, p.seed, p.gold, p.prefix);
    }
    // dash 回血：綠色「+N」（--ok）
    for (let k = 0; k < r.specialEvents.length; k++) {
      const se = r.specialEvents[k];
      if (se.kind !== "dash" || !se.heal) continue;
      const age = curT - se.t;
      if (age < 0 || age >= DMG_POP_DUR) continue;
      const n = Math.round(se.heal);
      if (n < 1) continue;
      const [bx, by] = toCanvas(se.x, se.y);
      drawOnePop(g, bx, by, `+${n}`, "#57d96b", 22, age, 101 + k * 3);
    }
    g.restore();
  }

  /* —— 陀螺動態強化 —— */
  function hexRgb(col: string): [number, number, number] {
    const v = parseInt(col.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  /** 自旋光暈：隊色光圈隨 spin 比例呼吸（轉越快越亮、呼吸越快；快沒力時黯淡）。 */
  function drawSpinGlow(g: CanvasRenderingContext2D, bx: number, by: number, col: string, spinN: number, curT: number) {
    if (spinN <= 0.02) return;
    const [cr, cg, cb] = hexRgb(col);
    const breath = 0.78 + 0.22 * Math.sin(curT * (2.2 + spinN * 6.5));
    const R = scaleLen(26 * (1.55 + spinN * 0.45));
    const grad = g.createRadialGradient(bx, by, scaleLen(10), bx, by, R);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
    grad.addColorStop(0.55, `rgba(${cr},${cg},${cb},0.3)`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.save();
    g.globalAlpha = (0.22 + 0.55 * spinN) * breath;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(bx, by, R, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  /** 高速動態：殘影（過去幀低透明同款陀螺）+ 速度線（移動反方向短線），速度超過門檻才畫。 */
  const SPEED_FX_MIN = 150; // 世界單位/s（≈ maxSpeed 340 的 44%）
  function drawSpeedFx(g: CanvasRenderingContext2D, id: string, frames: Frame[], idx: number, col: string) {
    const i0 = Math.max(0, idx - 3);
    if (i0 === idx) return;
    const pa = frames[i0].bodies.find((x) => x.id === id);
    const pb = frames[idx].bodies.find((x) => x.id === id);
    if (!pa || !pb) return;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dist = Math.hypot(dx, dy);
    const spd = dist / ((idx - i0) / 60);
    if (spd < SPEED_FX_MIN || dist < 1e-3) return;
    const k = Math.min(1, (spd - SPEED_FX_MIN) / (DEFAULT_SCALES.maxSpeed - SPEED_FX_MIN));
    // 殘影：最多 2 個，越舊越淡（隊色低透明）
    for (let j = 1; j <= 2; j++) {
      const fi = idx - j * 4;
      if (fi < 0) break;
      const tb = frames[fi].bodies.find((x) => x.id === id);
      if (!tb) continue;
      drawTop(g, tb.x, tb.y, tb.z ?? 0, tb.angle, col, 26, true, presetOf(id), 0.16 * k * (1 - (j - 1) * 0.45));
    }
    // 速度線：白 + 隊色交錯，長度隨速度
    const ux = dx / dist;
    const uy = -dy / dist; // canvas y 翻轉
    const nx = -uy;
    const ny = ux;
    const [bx, by] = toCanvas(pb.x, pb.y);
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * scaleLen(13);
      const jit = hash01(idx * 0.7 + i * 11.3); // 隨幀微變（仍確定性 → scrub 穩）
      const len = scaleLen(20 + 42 * k) * (0.6 + jit * 0.5);
      const sx = bx + nx * off - ux * scaleLen(20);
      const sy = by + ny * off - uy * scaleLen(20);
      g.globalAlpha = 0.28 * k * (0.5 + jit * 0.5);
      g.strokeStyle = i === 1 ? "#ffffff" : col;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx - ux * len, sy - uy * len);
      g.stroke();
    }
    g.restore();
  }
  /** 焊接火星（mockup 語彙）：強撞接觸點噴出帶重力下墜的火星 streak，lighter 疊加發光。 */
  function drawEmbers(g: CanvasRenderingContext2D, curT: number) {
    const evs = result.value?.collisionEvents;
    if (!evs) return;
    const DUR = 0.66; // 比火花長一點的餘韻（落地熄滅）
    const GRAV = 980; // 世界單位/s² 下墜
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (let k = 0; k < evs.length; k++) {
      const ce = evs[k];
      const s = Math.min(1, ce.impact / 230);
      if (s < 0.35) continue; // 強撞才噴火星
      const age = curT - ce.t;
      if (age < 0 || age >= DUR) continue;
      const a = age / DUR;
      const [ex, ey] = toCanvas(ce.x, ce.y);
      const n = 6 + Math.floor(s * 12);
      for (let i = 0; i < n; i++) {
        if (particleBudget-- <= 0) break;
        const ang = hash01(k * 19.3 + i * 3.7) * Math.PI * 2;
        const sp = (60 + hash01(k * 5.1 + i * 1.3) * 240) * (0.5 + s * 0.7);
        const vx = Math.cos(ang) * sp;
        const vy = Math.sin(ang) * sp - 70; // 初速略向上 → 拋物線
        const x = ex + scaleLen(vx * age);
        const y = ey + scaleLen(vy * age + 0.5 * GRAV * age * age);
        const cvy = vy + GRAV * age;
        const fade = 1 - a;
        const r = hash01(k * 3.3 + i * 7.1);
        g.globalAlpha = fade * (0.5 + s * 0.5);
        g.strokeStyle = a > 0.62 ? "#a13218" : r < 0.5 ? "#ffd24d" : "#ff7a18"; // 白熱→熔岩→暗紅熄滅
        g.lineWidth = 1.4 + fade;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - scaleLen(vx * 0.022), y - scaleLen(cvy * 0.022));
        g.stroke();
      }
    }
    g.restore();
  }

  /** 碰撞火花：強弱依 impact（門檻調低 → 同力道更猛），衝擊波環 + 發光爆閃 + 放射火花。 */
  function drawSparks(g: CanvasRenderingContext2D, curT: number) {
    const evs = result.value?.collisionEvents;
    if (!evs) return;
    const DUR = 0.42; // 多留一點餘韻
    for (let k = 0; k < evs.length; k++) {
      const ce = evs[k];
      const age = curT - ce.t;
      if (age < 0 || age >= DUR) continue;
      const a = age / DUR;
      const s = Math.min(1, ce.impact / 230); // 門檻再降 → 同力道更猛
      const [ex, ey] = toCanvas(ce.x, ce.y);
      g.save();
      g.lineCap = "round";

      // 起爆白光（前 ~28%）：放射漸層一閃，給「啪」的瞬間衝擊
      if (a < 0.28) {
        const fa = 1 - a / 0.28;
        const fr = scaleLen(14 + s * 44);
        const grad = g.createRadialGradient(ex, ey, 0, ex, ey, fr);
        grad.addColorStop(0, `rgba(255,255,255,${0.6 * fa * (0.5 + s)})`);
        grad.addColorStop(0.4, `rgba(255,210,77,${0.32 * fa * (0.5 + s)})`);
        grad.addColorStop(1, "rgba(255,138,60,0)");
        g.globalAlpha = 1;
        g.fillStyle = grad;
        g.beginPath();
        g.arc(ex, ey, fr, 0, Math.PI * 2);
        g.fill();
      }

      // 雙衝擊波環（夠猛才有第二圈）
      g.globalAlpha = (1 - a) * 0.6 * (0.4 + s);
      g.strokeStyle = "#fff";
      g.lineWidth = scaleLen(4) * (1 - a);
      g.beginPath();
      g.arc(ex, ey, scaleLen(6) + scaleLen(12 + s * 74) * a, 0, Math.PI * 2);
      g.stroke();
      if (s > 0.45) {
        g.globalAlpha = (1 - a) * 0.4 * s;
        g.lineWidth = scaleLen(2.5) * (1 - a);
        g.beginPath();
        g.arc(ex, ey, scaleLen(6) + scaleLen(22 + s * 44) * a, 0, Math.PI * 2);
        g.stroke();
      }

      // 中心爆閃（更亮更大 + 光暈）
      g.shadowColor = "#ffd24d";
      g.shadowBlur = 24 * s;
      g.globalAlpha = (1 - a) * (0.6 + 0.4 * s);
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(ex, ey, scaleLen(5 + s * 14) * (1 - a * 0.5), 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;

      // 放射火花（更多 10~34 條、更長、焊接火星色階：白熱→琥珀→熔岩，末段轉暗紅熄滅）
      const n = 10 + Math.floor(s * 24);
      const reach = scaleLen(22 + s * 72);
      for (let i = 0; i < n; i++) {
        if (particleBudget-- <= 0) break; // 每幀粒子預算（保幀）
        const ang = hash01(k * 41.7 + i * 2.3) * Math.PI * 2;
        const spd = 0.5 + hash01(k * 13.1 + i * 5.7) * 0.5;
        const d0 = reach * a * spd;
        const len = scaleLen(7 + s * 18) * (1 - a) * (0.6 + spd * 0.4);
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        g.globalAlpha = (1 - a) * (0.8 + 0.2 * s);
        const r = hash01(k * 7.3 + i);
        g.strokeStyle = a > 0.7 ? "#a13218" : r < 0.4 ? "#fff3d6" : r < 0.75 ? "#ffd24d" : "#ff8a3c";
        g.lineWidth = (2 + s * 2.2) * (1 - a * 0.4);
        g.beginPath();
        g.moveTo(ex + c * d0, ey + sn * d0);
        g.lineTo(ex + c * (d0 + len), ey + sn * (d0 + len));
        g.stroke();
      }

      // 碎屑火星（大撞擊才有，飛濺 + 重力下墜的小點）
      if (s > 0.4) {
        const m = Math.floor(s * 10);
        g.fillStyle = "#ffd24d";
        for (let i = 0; i < m; i++) {
          if (particleBudget-- <= 0) break; // 每幀粒子預算（保幀）
          const ang = hash01(k * 53.1 + i * 7.7) * Math.PI * 2;
          const sp = 0.5 + hash01(k * 29.3 + i) * 0.5;
          const dd = scaleLen(20 + s * 80) * a * sp;
          const px = ex + Math.cos(ang) * dd;
          const py = ey + Math.sin(ang) * dd + scaleLen(40) * a * a; // 下墜
          g.globalAlpha = (1 - a) * 0.85;
          g.beginPath();
          g.arc(px, py, Math.max(0.5, scaleLen(2.2) * (1 - a)), 0, Math.PI * 2);
          g.fill();
        }
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

  /* ---------- 必殺技動畫特效（純由 curT 推導 → 重播/變速/scrub 穩、確定性） ---------- */
  function specialDuration(kind: SpecialKind): number {
    if (kind === "vortex") return specialCfg.value.vortexDuration;
    if (kind === "dash") return specialCfg.value.dashDuration;
    if (kind === "clone") return specialCfg.value.cloneDuration;
    return 0.45;
  }
  /** 由最近幾幀位移推導移動方向（canvas 空間，已 y 翻轉）。 */
  function headingOf(id: string, frames: Frame[], idx: number): { x: number; y: number } | null {
    const a = frames[Math.max(0, idx - 3)].bodies.find((x) => x.id === id);
    const b = frames[idx].bodies.find((x) => x.id === id);
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) return null;
    return { x: dx / d, y: -dy / d };
  }
  /** 漩渦：陀螺底下旋轉向內收的螺旋 + 中心吸入暗點 + 被吸入的粒子（俯視壓扁）。 */
  function drawVortexFx(g: CanvasRenderingContext2D, cx: number, cy: number, curT: number, age: number, dur: number) {
    const fade = Math.min(1, age / 0.2) * Math.min(1, (dur - age) / 0.3);
    if (fade <= 0) return;
    const R = scaleLen(specialCfg.value.vortexRange) * 0.5;
    const spin = curT * 5.5;
    g.save();
    g.translate(cx, cy);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
    grad.addColorStop(0, "rgba(70,25,110,0.6)");
    grad.addColorStop(1, "rgba(140,90,180,0)");
    g.globalAlpha = 0.65 * fade;
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(0, 0, R, R * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.5 * fade;
    g.strokeStyle = "#c07bff";
    g.lineWidth = scaleLen(2.4);
    g.lineCap = "round";
    const ARMS = 4;
    for (let arm = 0; arm < ARMS; arm++) {
      g.beginPath();
      const base = spin + (arm / ARMS) * Math.PI * 2;
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const r = R * (1 - s * 0.85);
        const ang = base + s * 3.4; // 向內收的螺旋
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r * 0.5;
        s === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = "#e2c4ff";
    for (let i = 0; i < 12; i++) {
      const pf = (curT * 1.4 + i / 12) % 1; // 由外往內循環
      const r = R * (1 - pf);
      const ang = spin * 1.6 + i * 2.1 + pf * 4;
      g.globalAlpha = 0.8 * fade * (1 - pf);
      g.beginPath();
      g.arc(Math.cos(ang) * r, Math.sin(ang) * r * 0.5, Math.max(0.5, scaleLen(2.6) * (1 - pf)), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  /** 高速移動：後方數個半透明殘影（取過去幾幀位置）。 */
  function drawDashFx(g: CanvasRenderingContext2D, id: string, frames: Frame[], idx: number) {
    for (let j = 1; j <= 4; j++) {
      const fi = idx - j * 3;
      if (fi < 0) break;
      const tb = frames[fi].bodies.find((x) => x.id === id);
      if (!tb) continue;
      drawTop(g, tb.x, tb.y, tb.z ?? 0, tb.angle, "#5fd0ff", 26, true, presetOf(id), 0.3 * (1 - j / 5));
    }
  }
  /** 衝刺突進：沿移動方向後方甩出速度線。 */
  function drawRushFx(g: CanvasRenderingContext2D, bx: number, by: number, hd: { x: number; y: number } | null, age: number, col: string) {
    if (!hd) return;
    const a = age / 0.35;
    const dx = hd.x;
    const dy = hd.y;
    const nx = -dy;
    const ny = dx;
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const off = (i - 3) * scaleLen(7);
      const jit = hash01(i * 3.1 + 0.5);
      const len = scaleLen(28 + 50 * (1 - a)) * (0.55 + jit * 0.7);
      const sx = bx + nx * off - dx * scaleLen(8);
      const sy = by + ny * off - dy * scaleLen(8);
      g.globalAlpha = (1 - a) * 0.85 * (0.5 + jit * 0.5);
      g.strokeStyle = i % 2 ? "#ffffff" : col;
      g.lineWidth = (2.4 + jit * 1.6) * (1 - a * 0.4);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx - dx * len, sy - dy * len);
      g.stroke();
    }
    g.restore();
  }
  /** 衝擊：琥珀白雙爆發環。 */
  function drawBlastFx(g: CanvasRenderingContext2D, ex: number, ey: number, p: number) {
    g.save();
    g.globalAlpha = (1 - p) * 0.85;
    g.strokeStyle = "#ffb31f";
    g.lineWidth = scaleLen(6) * (1 - p);
    g.beginPath();
    g.arc(ex, ey, scaleLen(14) + scaleLen(92) * p, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = (1 - p) * 0.6;
    g.strokeStyle = "#fff";
    g.lineWidth = scaleLen(3) * (1 - p);
    g.beginPath();
    g.arc(ex, ey, scaleLen(8) + scaleLen(54) * p, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  /** 分身：召喚漣漪。 */
  function drawCloneSpawnFx(g: CanvasRenderingContext2D, bx: number, by: number, p: number) {
    g.save();
    g.strokeStyle = "#ffffff";
    for (let r = 0; r < 2; r++) {
      g.globalAlpha = (1 - p) * 0.6;
      g.lineWidth = scaleLen(2.5) * (1 - p);
      g.beginPath();
      g.arc(bx, by, scaleLen(8) + scaleLen(34) * p + r * scaleLen(12), 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }
  /** 必殺技「地面/殘影」層（陀螺底下）：漩渦吸入 / 高速殘影 / 衝刺速度線。 */
  function drawSpecialGround(g: CanvasRenderingContext2D, curT: number, frame: Frame, frames: Frame[], idx: number) {
    const evs = result.value?.specialEvents;
    if (!evs) return;
    for (const ev of evs) {
      const age = curT - ev.t;
      if (age < 0) continue;
      const fb = frame.bodies.find((x) => x.id === ev.id);
      if (!fb) continue;
      if (ev.kind === "vortex" && age <= specialDuration("vortex")) {
        const [bx, by] = toCanvas(fb.x, fb.y);
        drawVortexFx(g, bx, by, curT, age, specialDuration("vortex"));
      } else if (ev.kind === "dash" && age <= specialDuration("dash")) {
        drawDashFx(g, ev.id, frames, idx);
      } else if (ev.kind === "rush" && age < 0.35) {
        const [bx, by] = toCanvas(fb.x, fb.y);
        drawRushFx(g, bx, by, headingOf(ev.id, frames, idx), age, colorOf(ev.id));
      }
    }
  }
  /** 必殺技「上層」層（陀螺之上）：衝擊爆發環 / 分身召喚漣漪。 */
  function drawSpecialTop(g: CanvasRenderingContext2D, curT: number, frame: Frame) {
    const evs = result.value?.specialEvents;
    if (!evs) return;
    for (const ev of evs) {
      const age = curT - ev.t;
      if (age < 0) continue;
      if (ev.kind === "blast" && age < 0.4) {
        const [ex, ey] = toCanvas(ev.x, ev.y);
        drawBlastFx(g, ex, ey, age / 0.4);
      } else if (ev.kind === "clone" && age < 0.5) {
        const fb = frame.bodies.find((x) => x.id === ev.id);
        if (fb) {
          const [bx, by] = toCanvas(fb.x, fb.y);
          drawCloneSpawnFx(g, bx, by, age / 0.5);
        }
      }
    }
  }

  function draw() {
    if (!ctx) return;
    const g = ctx;
    particleBudget = PARTICLE_BUDGET; // 每幀重置粒子預算
    const { cx, cy, R } = drawArena(g);

    if (phase.value === "playing" && result.value) {
      const frames = result.value.frames;
      // 相鄰幀內插：慢動作 / 任何播放速度都滑順，旋轉也連續
      const ph = Math.max(0, Math.min(frames.length - 1, playhead.value));
      const i0 = Math.floor(ph);
      const i1 = Math.min(frames.length - 1, i0 + 1);
      const idx = i0;
      const frame = lerpFrame(frames[i0], frames[i1], ph - i0);
      const curT = ph / 60; // dt=1/60、sampleEvery=1 → 幀索引即 t*60
      // 場地震動（容器級）：強撞/擊破/出界時整個場地容器（SVG 底圖＋canvas）一起位移；
      // 暫停 / 回放結束時傳 0 → 清掉殘留 transform（reduced-motion 時 shakeAmpAt 回 0）
      applyShake(playing.value ? shakeAmpAt(curT) : 0);
      g.save();
      // 軌跡尾巴：從尾(細透明)漸變到頭(粗實) → 更明顯、可辨隊伍
      const TAIL = 46;
      for (const b of frame.bodies) {
        if (b.isClone) continue; // 分身不畫尾巴
        const col = colorOf(b.id);
        const start = Math.max(0, idx - TAIL);
        g.save();
        g.lineCap = "round";
        g.lineJoin = "round";
        g.strokeStyle = col;
        let prev: [number, number] | null = null;
        for (let f = start; f <= idx; f++) {
          const tb = frames[f].bodies.find((x) => x.id === b.id);
          if (!tb) {
            prev = null;
            continue;
          }
          const p = toCanvas(tb.x, tb.y);
          if (prev) {
            const u = (f - start) / Math.max(1, idx - start); // 0=尾 1=頭
            g.globalAlpha = 0.05 + 0.6 * u * u;
            g.lineWidth = scaleLen(1.2 + 7.5 * u); // 細 → 粗
            g.beginPath();
            g.moveTo(prev[0], prev[1]);
            g.lineTo(p[0], p[1]);
            g.stroke();
          }
          prev = p;
        }
        g.restore();
      }
      // 必殺技「地面/殘影」特效（在陀螺底下）：漩渦吸入 / 高速殘影 / 衝刺速度線
      drawSpecialGround(g, curT, frame, frames, idx);
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
        if (b.alive) {
          // 自旋光暈（隨 spin 比例呼吸）+ 高速動態（殘影/速度線）
          const [bx, by] = toCanvas(b.x, b.y);
          drawSpinGlow(g, bx, by, col, Math.max(0, Math.min(1, b.spin / DEFAULT_SCALES.maxSpin)), curT);
          drawSpeedFx(g, b.id, frames, idx, col);
        }
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

      // 碰撞火花 + 焊接火星 + 擊破爆裂
      drawSparks(g, curT);
      drawEmbers(g, curT);
      drawDeaths(g, curT);

      // 必殺技「上層」特效：衝擊爆發環 / 分身召喚漣漪
      drawSpecialTop(g, curT, frame);

      // 傷害/回血浮動數字（最上層）
      drawDamagePops(g, curT, frames);
      g.restore(); // 對應上方 save（隔離回放繪製的殘留狀態；震動已改寫在容器 transform）

      // 必殺技停格 banner：大字招式名（停格期間顯示，讓人看清是什麼招）
      if (freezeEvent.value) {
        const ev = freezeEvent.value;
        const name = SPECIAL_NAMES[ev.kind];
        const ecol = specialColor(ev);
        g.save();
        // 停格底：壓暗整個場景讓大字跳出（黑鋼底上加深透明度才有感）
        g.globalAlpha = 0.3;
        g.fillStyle = "#05080d";
        g.fillRect(0, 0, SIZE, SIZE);
        g.globalAlpha = 1;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = "900 56px 'Big Shoulders Display', 'Noto Sans TC', sans-serif";
        // 深色描邊在黑鋼底上沒對比 → 改白熱描邊 + 招式色光暈
        g.lineWidth = 8;
        g.strokeStyle = "rgba(255,243,214,0.35)";
        g.strokeText(name, SIZE / 2, SIZE * 0.2);
        g.shadowColor = ecol;
        g.shadowBlur = 24;
        g.fillStyle = ecol;
        g.fillText(name, SIZE / 2, SIZE * 0.2);
        g.shadowBlur = 0;
        g.font = "bold 16px 'Noto Sans TC', sans-serif";
        g.fillStyle = "#dfe5ee";
        g.fillText(colorOf(ev.id) === setupA.color ? "紅方 必殺技!" : "藍方 必殺技!", SIZE / 2, SIZE * 0.2 + 42);
        g.textBaseline = "alphabetic";
        g.restore();
      }
      return;
    }

    // 瞄準階段：畫已鎖定的陀螺 + 目前拖曳（非回放 → 確保容器震動 transform 已清空）
    applyShake(0);
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
        g.strokeStyle = "rgba(255,243,214,0.45)";
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

      // 發射方向箭頭（琥珀能量色）
      if (ax !== sx || ay !== sy) {
        g.save();
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(ax, ay);
        g.strokeStyle = "#ffb31f";
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
        g.fillStyle = "#ffb31f";
        g.fill();
        g.restore();
      }

      // 力道（白熱字色）
      g.save();
      g.fillStyle = "#fff3d6";
      g.font = "bold 16px 'Big Shoulders Display', 'Noto Sans TC', sans-serif";
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
    const maxHp = maxHpFor(statsFor(id === "A" ? setupA : setupB), arena.value.hpBase);
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
    return scoreA.value >= WIN_SCORE ? "紅方 A 奪冠！" : "藍方 B 奪冠！";
  }
  function isFinished(): boolean {
    const frames = result.value?.frames;
    return !!frames && !playing.value && Math.round(playhead.value) >= frames.length - 1;
  }

  /** 必殺技觸發說明（讀陀螺後台目前數值）：條件 · 機率 · 冷卻 · 每回合次數。 */
  function specialInfo(kind: "" | SpecialKind): string {
    const s = specialCfg.value;
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
  /** 必殺技特效色：blast 琥珀 / dash 青 / vortex 紫 / rush・clone 用玩家色。 */
  function specialColor(ev: SpecialEvent): string {
    switch (ev.kind) {
      case "blast":
        return "#ffb31f";
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
    updateShakeScale(); // 容器顯示寬快取（之後只在 resize 時更新）
    window.addEventListener("resize", updateShakeScale);
    loadSprites();
    draw();
  });
  onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", updateShakeScale);
  });

  return {
    // 場地 / 設定
    arena,
    arenaName,
    setupA,
    setupB,
    presetKeys,
    PRESET_LABELS,
    presets,
    activeId,
    selectArena,
    // 流程
    phase,
    phaseText,
    launchA,
    launchB,
    launchMode,
    hintText,
    // 計分
    WIN_SCORE,
    scoreA,
    scoreB,
    roundNum,
    lastRoundPoints,
    matchOver,
    // 回放
    result,
    playhead,
    playing,
    speed,
    slowmo,
    freezeEvent,
    play,
    pause,
    togglePlay,
    startRound,
    nextRound,
    resetMatch,
    // 線上模式注入點
    statsOverride,
    specialCfg,
    playRemoteRound,
    mySide,
    // 畫布 / 拖曳
    canvas,
    shakeEl, // 場地震動容器（包 ArenaSvg + canvas 的 div；模板 ref="shakeEl" 綁定）
    SIZE,
    dragging,
    powerPct,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    draw,
    // 顯示輔助
    colorOf,
    presetOf,
    teamIds,
    spinPct,
    hpPct,
    currentTime,
    roundResultLabel,
    championLabel,
    isFinished,
    specialInfo,
    SPECIAL_NAMES,
    specialColor,
    // 音效開關（UI 🔊/🔇）
    sfxEnabled,
  };
}
