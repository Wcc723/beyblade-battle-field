<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ArenaSvg from "../components/ArenaSvg.vue";
import BbIcon from "../components/ui/BbIcon.vue";
import { useBattle } from "../composables/useBattle";
import { useOnlineBattle } from "../composables/useOnlineBattle";
import { beyFullName, DEFAULT_LINEUP, getBey } from "../game/beyblades";
import type { ArenaConfig, BeybladeStats, SpecialConfig } from "../physics/types";

const route = useRoute();
const code = String(route.params.code ?? "").toUpperCase();

const online = useOnlineBattle(code, { bot: route.query.bot === "1" });
// 對戰廳以手機版手感為基準（拉弓）；瞄準放手 → 送伺服器
const bt = useBattle({ defaultLaunchMode: "sling", onLaunchSubmit: (aim) => online.submitAim(aim) });
online.bind(bt);

const {
  arena, setupA, setupB,
  phase, launchMode, hintText,
  result, playhead, playing, speed, slowmo,
  canvas, shakeEl, SIZE, dragging, powerPct,
  onPointerDown, onPointerMove, onPointerUp,
  spinPct, hpPct, specialInfo,
  SPECIAL_NAMES, specialColor,
  togglePlay, sfxEnabled,
} = bt;

// 進房先抓全域設定：瞄準階段就要正確的場地形狀 / 屬性 / 必殺技數值。
// 失敗會 backoff 重試（不重試的話會一直用本機 localStorage 場地瞄準，
// 與伺服器實算的場地不一致；第一回合回放後 arena 會自癒，但 stats 不會）。
let configRetry: ReturnType<typeof setTimeout> | undefined;
async function loadServerConfig(attempt = 0): Promise<void> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = (await res.json()) as {
      arena: { presets: { id: string; name: string; config: ArenaConfig }[]; activeId: string };
      stats: Record<string, BeybladeStats>;
      special: SpecialConfig;
    };
    const p = cfg.arena.presets.find((x) => x.id === cfg.arena.activeId) ?? cfg.arena.presets[0];
    if (p) {
      bt.arena.value = { ...p.config };
      bt.arenaName.value = p.name;
    }
    bt.statsOverride.value = cfg.stats;
    bt.specialCfg.value = cfg.special;
    bt.draw();
  } catch {
    if (attempt < 5) configRetry = setTimeout(() => loadServerConfig(attempt + 1), 1000 * 2 ** attempt);
  }
}

// 自己的出賽陣容（D1 user_settings.lineup）：抽屜「出賽陀螺」選單的選項來源。
// 失敗回落 DEFAULT_LINEUP（與 DO readLineup 同一套 fallback → 選項至少與伺服器一致）。
const myLineup = ref<{ beyId: string; special: string }[]>([...DEFAULT_LINEUP]);
let lineupRetry: ReturnType<typeof setTimeout> | undefined;
async function loadMyLineup(attempt = 0): Promise<void> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { settings: { lineup?: { beyId: string; special: string }[] } };
    if (data.settings.lineup?.length) myLineup.value = data.settings.lineup;
  } catch {
    if (attempt < 5) lineupRetry = setTimeout(() => loadMyLineup(attempt + 1), 1000 * 2 ** attempt);
  }
}

onMounted(() => {
  online.connect();
  void loadServerConfig();
  void loadMyLineup();
});
onBeforeUnmount(() => {
  clearTimeout(configRetry);
  clearTimeout(lineupRetry);
  clearTimeout(spBannerTimer);
  clearTimeout(tapArmTimer);
  online.dispose();
});

/* ---------- 顯示輔助 ---------- */
const snap = computed(() => online.snapshot.value);
const mySide = computed(() => online.you.value);
const mySetup = computed(() => (mySide.value === "B" ? setupB : setupA));
const isAiming = computed(() => snap.value?.phase === "aiming");
const waitingOpponent = computed(() => !snap.value || snap.value.phase === "waiting");
// phase !== 'playing'：對手提早按下一回合時（snapshot 已 aiming、本地回放未完）不能讓瞄準面板蓋掉回放控制
const showAimPanel = computed(() => isAiming.value && !online.myLaunched.value && phase.value !== "playing");
const replayDone = computed(() => bt.isFinished());

/* ---------- 出賽陀螺（名冊制）：名字來自 getBey(beyId) 的 beyFullName ----------
   自己側吃本地 selectedBeyId（切換選單即時跟著變、不等伺服器 echo）；對手側吃 snapshot。 */
// 抽屜選單目前選的 beyId：預設跟 snapshot（DO 依出賽順序排定的那顆），伺服器 echo 會再同步回來
const selectedBeyId = ref("");
watch(
  () => online.me.value?.loadout.beyId,
  (v) => {
    if (v) selectedBeyId.value = v;
  },
  { immediate: true },
);
/** beyId → 全名「{名}-{類型中文}」；查無（roster 改版孤兒 id）回 "—" 不炸 */
function beyLabel(beyId: string | undefined): string {
  const bey = beyId ? getBey(beyId) : undefined;
  return bey ? beyFullName(bey) : "—";
}
function sideBlade(side: "A" | "B"): string {
  if (side === mySide.value && selectedBeyId.value) return beyLabel(selectedBeyId.value);
  const p = snap.value?.players[side];
  return p ? beyLabel(p.loadout.beyId) : "";
}
const bladeA = computed(() => sideBlade("A"));
const bladeB = computed(() => sideBlade("B"));
const myBlade = computed(() => (mySide.value ? sideBlade(mySide.value) : ""));
const oppBlade = computed(() => beyLabel(online.opponent.value?.loadout.beyId));

/* ---------- 底部抽屜（配置收進 bottom sheet；純 UI 狀態，不碰瞄準/WS 邏輯） ---------- */
const sheetOpen = ref(false);
watch(showAimPanel, (v) => {
  if (!v) sheetOpen.value = false; // 發射 / 換階段 → 抽屜自動收合
});

/* ---------- 點擊續戰：結算銘牌亮相 800ms 後，點場地任意處＝下一回合 ----------
   matchOver 不觸發（仍走「再來一場」鍵）；對手先按下一回合時 snap 已是 aiming
   → canTapNext 自然為 false，不干擾既有 pendingAiming（播完再切）流程。 */
const canTapNext = computed(
  () =>
    snap.value?.phase === "review" &&
    replayDone.value &&
    !!online.lastOutcome.value &&
    !online.lastOutcome.value.matchOver,
);
const tapArmed = ref(false); // 800ms 防誤觸：銘牌剛亮時的點擊一律忽略
let tapArmTimer: ReturnType<typeof setTimeout> | undefined;
watch(canTapNext, (v) => {
  clearTimeout(tapArmTimer);
  tapArmed.value = false;
  if (v) tapArmTimer = setTimeout(() => (tapArmed.value = true), 800);
});
function onArenaTap() {
  if (canTapNext.value && tapArmed.value) online.nextRound();
}

const phaseBanner = computed(() => {
  const s = snap.value;
  if (online.roomFull.value) return "房間已滿";
  if (online.superseded.value) return "已在其他分頁開啟此房";
  if (!online.connected.value) return "連線中…";
  if (!s || s.phase === "waiting") return `等待對手加入（房號 ${code}）`;
  if (s.phase === "aiming") {
    if (phase.value === "playing") return "對手已進入下一回合（回放結束後自動繼續）";
    const t = online.aimRemaining.value != null ? `（剩 ${online.aimRemaining.value}s）` : "";
    return online.myLaunched.value ? `已發射，等待對手…${t}` : `你的回合：瞄準發射！${t}`;
  }
  if (s.phase === "review") return result ? "對戰回放" : "回合結束";
  if (s.phase === "finished") return result ? "對戰回放" : "比賽結束";
  return "";
});

const reasonText: Record<string, string> = {
  "ring-out": "擊出界",
  "spin-out": "停轉",
  timeout: "時間到（比體力）",
  draw: "平手",
  ko: "擊破",
};
const outcomeLabel = computed(() => {
  const o = online.lastOutcome.value;
  if (!o) return "";
  if (!o.winnerSide) return "平手 — 無人得分";
  const p = snap.value?.players[o.winnerSide];
  const name = p?.nickname ?? (o.winnerSide === "A" ? "紅方" : "藍方");
  return `${name} ${reasonText[o.reason] ?? o.reason} ＋${o.points} 分`;
});
const championLabel = computed(() => {
  const s = snap.value;
  if (!s?.winnerSide) return "";
  const p = s.players[s.winnerSide];
  return `${p?.nickname ?? s.winnerSide} 奪冠！`;
});

/* ---------- HUD 儀表（純顯示）：回放中吃即時 frame、其餘階段顯示滿條 ---------- */
function hudHp(id: string): number {
  return phase.value === "playing" ? hpPct(id) : 100;
}
function hudSp(id: string): number {
  return phase.value === "playing" ? spinPct(id) : 100;
}

/* ---------- 回合結算鋼印的英文鬼影字（純顯示） ---------- */
const resGhost = computed(() => {
  switch (online.lastOutcome.value?.reason) {
    case "ko": return "K.O.";
    case "ring-out": return "OUT";
    case "spin-out": return "STOP";
    case "draw": return "DRAW";
    default: return "TIME";
  }
});

/* ---------- 必殺技鋼印橫幅（純 view 層：playhead 跨過 specialEvents 時亮 1.2 秒）----------
   不動 useBattle：只 watch 回放進度，同一事件記 lastShownT 只觸發一次（scrub 回頭不重播）。 */
const spBanner = ref<{ t: number; en: string; name: string; color: string } | null>(null);
let spBannerTimer: ReturnType<typeof setTimeout> | undefined;
let lastShownT = -1;
watch(result, () => {
  // 新回合的重跑包 → 重置橫幅狀態
  lastShownT = -1;
  spBanner.value = null;
  clearTimeout(spBannerTimer);
});
watch(playhead, (idx) => {
  const r = result.value;
  if (!r?.specialEvents.length) return;
  const f = r.frames[Math.max(0, Math.min(r.frames.length - 1, Math.round(idx)))];
  if (!f) return;
  const ev = r.specialEvents.find((e) => e.t > lastShownT && e.t <= f.t);
  if (!ev) return;
  lastShownT = ev.t;
  spBanner.value = { t: ev.t, en: ev.kind.toUpperCase(), name: SPECIAL_NAMES[ev.kind], color: specialColor(ev) };
  clearTimeout(spBannerTimer);
  spBannerTimer = setTimeout(() => (spBanner.value = null), 1200);
});

function copyCode() {
  try {
    navigator.clipboard.writeText(`${location.origin}/room/${code}`);
  } catch {
    /* http 或舊瀏覽器：忽略 */
  }
}

/* 自己的配置變更 → 送伺服器（伺服器 echo 會再同步回 setups）
   出賽陀螺只送 beyId：type/數值由 DO 經名冊推導，非自己 lineup 內的 id 會被忽略 */
function onBeyChange() {
  if (selectedBeyId.value) online.sendLoadout({ beyId: selectedBeyId.value });
}
function onSpecialChange() {
  online.sendLoadout({ special: mySetup.value.special });
}
</script>

<template>
  <div class="room">
    <!-- 格鬥式戰鬥 HUD（伺服器權威比分 + 即時儀表；頂部堆疊、不遮場地） -->
    <div class="plate plate--flush hud-plate">
      <div class="hazard hazard--thin"></div>
      <div class="hud-top">
        <!-- 紅方 A（先手・右旋） -->
        <div class="fighter fa">
          <div class="nameplate">
            <div class="np-row">
              <img v-if="snap?.players.A?.picture" :src="snap.players.A.picture" class="np-ava" alt="" referrerpolicy="no-referrer" />
              <strong>{{ snap?.players.A?.nickname ?? "—" }}</strong>
              <span v-if="snap?.players.A && !snap.players.A.connected" class="f-badge f-badge--red">離線</span>
            </div>
            <div v-if="snap?.players.A" class="np-sub">
              <span class="np-blade">{{ bladeA }}</span>
              <span class="chip">先手・右旋</span>
            </div>
          </div>
          <div class="meter-set">
            <div class="mrow">
              <i class="mlabel">HP</i>
              <div class="meter hp">
                <div class="lag" :style="{ width: hudHp('A') + '%' }"></div>
                <div class="fill" :style="{ width: hudHp('A') + '%' }"></div>
              </div>
            </div>
            <div class="mrow">
              <i class="mlabel">SP</i>
              <div class="meter sp">
                <div class="fill" :style="{ width: hudSp('A') + '%' }"></div>
                <div class="teeth"></div>
              </div>
            </div>
          </div>
        </div>
        <!-- 中央銘牌：回合 / 瞄準倒數 / 比分 pips -->
        <div class="hud-mid">
          <div class="round-tag">R<b>{{ snap?.roundNum ?? 1 }}</b></div>
          <!-- 回放中：倒數位置改掛 REPLAY 小字（取代整條「對戰回放」phase banner） -->
          <div v-if="phase === 'playing'" class="timer is-replay">
            <b>REPLAY</b>
            <em>PLAYBACK</em>
          </div>
          <div v-else class="timer" :class="{ low: online.aimRemaining.value != null && online.aimRemaining.value <= 10 }">
            <b>{{ online.aimRemaining.value ?? "--" }}</b>
            <em>SEC</em>
          </div>
          <div class="pips">
            <span v-for="i in 3" :key="`a${i}`" class="pip" :class="{ on: i <= (snap?.scoreA ?? 0) }"></span>
            <i class="pip-gap"></i>
            <span v-for="i in 3" :key="`b${i}`" class="pip" :class="{ on: i <= (snap?.scoreB ?? 0) }"></span>
          </div>
        </div>
        <!-- 藍方 B（後手・左旋；鏡像） -->
        <div class="fighter fb">
          <div class="nameplate">
            <div class="np-row">
              <img v-if="snap?.players.B?.picture" :src="snap.players.B.picture" class="np-ava" alt="" referrerpolicy="no-referrer" />
              <strong>{{ snap?.players.B?.nickname ?? "—" }}</strong>
              <span v-if="snap?.players.B && !snap.players.B.connected" class="f-badge f-badge--red">離線</span>
            </div>
            <div v-if="snap?.players.B" class="np-sub">
              <span class="np-blade">{{ bladeB }}</span>
              <span class="chip">後手・左旋</span>
            </div>
          </div>
          <div class="meter-set">
            <div class="mrow">
              <i class="mlabel">HP</i>
              <div class="meter hp">
                <div class="lag" :style="{ width: hudHp('B') + '%' }"></div>
                <div class="fill" :style="{ width: hudHp('B') + '%' }"></div>
              </div>
            </div>
            <div class="mrow">
              <i class="mlabel">SP</i>
              <div class="meter sp">
                <div class="fill" :style="{ width: hudSp('B') + '%' }"></div>
                <div class="teeth"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 階段狀態帶（回放中整條收掉：REPLAY 併進 HUD 中央銘牌、訊息改掛場地下緣） -->
    <div v-if="phase !== 'playing'" class="phase-strip" :class="{ mine: showAimPanel, waitp: !showAimPanel }">{{ phaseBanner }}</div>

    <!-- 場地（1:1 滿寬金屬擂台） -->
    <div class="plate plate--flush arena-plate">
      <div class="hazard"></div>
      <!-- ref=震動容器 → 強撞時 SVG 底圖 + canvas 整體一起晃 -->
      <div class="m-arena" ref="shakeEl" @click="onArenaTap">
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

        <div v-if="slowmo && playing" class="m-slowmo"><BbIcon name="hourglass" :size="12" />SLOW-MO</div>

        <!-- 力道金屬浮標（拖曳蓄力中） -->
        <div v-if="dragging" class="m-power">
          <span class="pw-label">POWER</span>
          <span class="pw-track"><i :style="{ width: powerPct + '%' }"></i></span>
          <b class="pw-val">{{ powerPct }}%</b>
        </div>

        <!-- 必殺技鋼印銘牌橫幅（1.2 秒衝壓進場 + 閃光帶掃過） -->
        <div v-if="spBanner" :key="spBanner.t" class="sp-banner" :style="{ borderBottomColor: spBanner.color }">
          <BbIcon name="lightning" :size="20" :style="{ color: spBanner.color }" />
          <span class="sp-en" :style="{ color: spBanner.color }">{{ spBanner.en }}</span>
          <strong>{{ spBanner.name }}</strong>
        </div>

        <!-- 覆蓋層（依嚴重度排序；同時擋住瞄準輸入） -->
        <div v-if="online.roomFull.value" class="m-cover">
          <p class="cover-title bad"><BbIcon name="x" :size="16" />房間已滿</p>
          <p class="cover-sub">這個房間已有兩位玩家</p>
          <RouterLink class="f-btn f-btn--ghost" to="/"><BbIcon name="house" :size="15" />回大廳</RouterLink>
        </div>
        <div v-else-if="online.superseded.value" class="m-cover">
          <p class="cover-title">已在其他分頁開啟此房</p>
          <p class="cover-sub">這個分頁的連線已被取代</p>
          <RouterLink class="f-btn f-btn--ghost" to="/"><BbIcon name="house" :size="15" />回大廳</RouterLink>
        </div>
        <div v-else-if="online.authLost.value" class="m-cover">
          <p class="cover-title bad">登入已過期</p>
          <p class="cover-sub">請重新登入後再回到房間</p>
          <RouterLink class="f-btn f-btn--primary" to="/login">重新登入<BbIcon name="box-arrow-right" :size="15" /></RouterLink>
        </div>
        <div v-else-if="!online.connected.value" class="m-cover thin">
          <p class="cover-title"><BbIcon name="wifi" :size="16" />連線中…</p>
          <p class="cover-sub">正在重新連上對戰房</p>
          <div class="load-bars"><i></i><i></i><i></i><i></i></div>
        </div>
        <div v-else-if="waitingOpponent" class="m-cover">
          <p class="cover-title"><BbIcon name="gear" :size="17" class="gear-spin" />等待對手加入…</p>
          <p class="cover-sub">分享房號給朋友，加入後自動開戰</p>
          <div class="code-slab">
            <b>{{ code }}</b>
            <span>ROOM CODE</span>
          </div>
          <button class="f-btn f-btn--ghost" @click="copyCode"><BbIcon name="copy" :size="15" />複製連結</button>
          <div class="load-bars"><i></i><i></i><i></i><i></i></div>
        </div>
        <div v-else-if="isAiming && online.myLaunched.value && phase !== 'playing'" class="m-cover thin">
          <p class="cover-title ok"><BbIcon name="check" :size="16" />已發射</p>
          <p class="cover-sub">{{ online.opponentJustLaunched.value ? "對手也發射了，運算中…" : "等待對手發射…" }}</p>
        </div>

        <!-- 回合結算 / 冠軍鋼印橫幅 -->
        <div v-if="replayDone && online.lastOutcome.value" class="res-banner" :class="{ champ: online.lastOutcome.value.matchOver }">
          <template v-if="online.lastOutcome.value.matchOver">
            <span class="res-ghost">WIN</span>
            <BbIcon name="trophy" :size="28" class="res-trophy" />
            <h3>{{ championLabel }}</h3>
            <span class="score"><b>{{ snap?.scoreA ?? 0 }}</b> : <i>{{ snap?.scoreB ?? 0 }}</i></span>
          </template>
          <template v-else>
            <span class="res-ghost">{{ resGhost }}</span>
            <h3 class="sm">{{ outcomeLabel }}</h3>
          </template>
        </div>

        <!-- 場地下緣小字：對手先行提示（取代回放 phase banner）/ 點擊續戰呼吸提示 -->
        <div v-if="phase === 'playing' && snap?.phase === 'aiming'" class="tap-hint">對手已進入下一回合，回放結束後自動繼續</div>
        <div v-else-if="canTapNext && tapArmed" class="tap-hint breathe">點擊畫面繼續</div>
      </div>
    </div>

    <!-- 瞄準：配置摘要 bar（點擊展開底部抽屜；首屏 HUD+場地+提示不需捲動即可發射） -->
    <div class="plate plate--flush aim-bar-plate" v-if="showAimPanel">
      <button type="button" class="loadout-bar" :class="mySide === 'B' ? 'is-blue' : 'is-red'" @click="sheetOpen = true">
        <span class="pulse"></span>
        <strong class="lb-blade">{{ myBlade || "—" }}</strong>
        <span class="lb-sp">{{ mySetup.special ? SPECIAL_NAMES[mySetup.special] : "無必殺技" }}</span>
        <span v-if="online.opponentJustLaunched.value" class="f-badge f-badge--amber">對手已發射</span>
        <BbIcon name="arrow-right" :size="14" class="lb-chev" />
      </button>
      <p class="bar-hint">{{ hintText }}</p>
    </div>

    <!-- 回放控制（單列瘦身：播放/scrub/倍速；續戰改點場地、matchOver 才有「再來一場」鍵） -->
    <div class="plate plate--flush replay-plate" v-else-if="phase === 'playing' && result">
      <div class="replay-row">
        <button class="keybtn" :aria-label="playing ? '暫停' : '播放'" @click="togglePlay">
          <BbIcon :name="playing ? 'pause' : 'play'" :size="15" />
        </button>
        <input class="scrub" type="range" min="0" :max="result.frames.length - 1" step="1" v-model.number="playhead" />
        <span class="f-select speed">
          <select v-model.number="speed">
            <option :value="0.5">0.5x</option>
            <option :value="1">1x</option>
            <option :value="2">2x</option>
            <option :value="3">3x</option>
          </select>
        </span>
        <button v-if="replayDone && snap?.phase === 'finished'" class="f-btn f-btn--primary" @click="online.rematch()">
          <BbIcon name="arrow-repeat" :size="15" />再來一場
        </button>
      </div>
    </div>

    <!-- 重連後落在 review/finished 但沒有本地回放 → 顯示結果與續行按鈕
        （正常情況 DO 會補發 lastRound 重跑包，這只是最後防線） -->
    <div class="plate fallback-panel" v-else-if="(snap?.phase === 'review' || snap?.phase === 'finished') && !result">
      <p v-if="snap?.phase === 'finished' && championLabel" class="fb-champ"><BbIcon name="trophy" :size="17" />{{ championLabel }}</p>
      <p class="hint">
        {{ snap?.phase === "finished" ? `比賽結束（${snap.scoreA}:${snap.scoreB}）` : "上一回合已結束。" }}
      </p>
      <button v-if="snap?.phase === 'finished'" class="f-btn f-btn--primary" @click="online.rematch()">
        <BbIcon name="arrow-repeat" :size="15" />再來一場
      </button>
      <button v-else class="f-btn f-btn--primary" @click="online.nextRound()">下一回合<BbIcon name="arrow-right" :size="15" /></button>
    </div>

    <!-- 底部（音效/離開收成低調角落鍵） -->
    <div class="foot">
      <span class="foot-code">#{{ code }}</span>
      <span class="foot-arena">場地：{{ online.matchArena.value?.name ?? bt.arenaName.value }}</span>
      <button class="cornerbtn" :aria-label="sfxEnabled ? '關閉音效' : '開啟音效'" @click="sfxEnabled = !sfxEnabled">
        <BbIcon :name="sfxEnabled ? 'volume-up' : 'volume-mute'" :size="14" />
      </button>
      <RouterLink class="cornerbtn" to="/" aria-label="離開房間"><BbIcon name="door-open" :size="14" /></RouterLink>
    </div>

    <!-- 底部抽屜：機體配置（金屬面板由下滑上、半透明 backdrop 點擊收合；fixed 不佔文件流） -->
    <Transition name="sheet">
      <div v-if="sheetOpen && showAimPanel" class="sheet-wrap" @click.self="sheetOpen = false">
        <div class="loadout-sheet">
          <div class="hazard hazard--thin"></div>
          <div class="sheet-head" :class="mySide === 'B' ? 'is-blue' : 'is-red'">
            <span class="pulse"></span>
            <b>{{ mySide === "B" ? "藍方配置" : "紅方配置" }}</b>
            <span class="sheet-blade">{{ myBlade }}</span>
            <button type="button" class="keybtn sheet-close" aria-label="收合" @click="sheetOpen = false">
              <BbIcon name="arrow-right" :size="14" class="chev-down" />
            </button>
          </div>
          <div class="sheet-body">
            <div class="vs-row">
              <span class="vs-en">VS</span>
              <span class="vs-name">{{ online.opponent.value?.nickname ?? "—" }}</span>
              <span class="f-badge" :class="mySide === 'B' ? 'f-badge--red' : 'f-badge--blue'">{{ oppBlade }}</span>
            </div>
            <div class="grid2">
              <div>
                <span class="f-label">出賽陀螺</span>
                <span class="f-select">
                  <select v-model="selectedBeyId" @change="onBeyChange">
                    <option v-for="(e, i) in myLineup" :key="e.beyId" :value="e.beyId">{{ i + 1 }} 號機・{{ beyLabel(e.beyId) }}</option>
                  </select>
                </span>
              </div>
              <div>
                <span class="f-label">旋向</span>
                <span class="spin-fixed">
                  <BbIcon :name="mySide === 'B' ? 'arrow-clockwise' : 'arrow-counterclockwise'" :size="15" />
                  {{ mySide === "B" ? "左旋（後手）" : "右旋（先手）" }}
                </span>
              </div>
            </div>
            <div>
              <span class="f-label">必殺技</span>
              <span class="f-select">
                <select v-model="mySetup.special" @change="onSpecialChange">
                  <option value="">無</option>
                  <option value="rush">衝刺突進</option>
                  <option value="blast">衝擊</option>
                  <option value="dash">高速移動</option>
                  <option value="vortex">旋渦</option>
                  <option value="clone">分身</option>
                </select>
              </span>
              <p v-if="mySetup.special" class="spinfo"><BbIcon name="lightning" :size="13" />{{ specialInfo(mySetup.special) }}</p>
            </div>
            <div>
              <span class="f-label">發射模式</span>
              <div class="seg">
                <button type="button" :class="{ on: launchMode === 'flick' }" @click="launchMode = 'flick'">甩動<span class="seg-en">FLICK</span></button>
                <button type="button" :class="{ on: launchMode === 'sling' }" @click="launchMode = 'sling'">拉弓<span class="seg-en">SLING</span></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.room {
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  user-select: none;
  -webkit-user-select: none;
}

/* ============================================================
   格鬥式戰鬥 HUD（金屬儀表組）
   ============================================================ */
.hud-plate {
  --cut: 10px;
}
.hud-top {
  display: grid;
  grid-template-columns: 1fr 92px 1fr;
  gap: 6px;
  align-items: start;
  padding: 9px 10px 11px;
}
.fighter {
  min-width: 0;
}
/* 名牌雙行：上行暱稱、下行陀螺名・類型小字（藍側 row-reverse 鏡像） */
.nameplate {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 6px;
  min-width: 0;
}
.np-row,
.np-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.fb .np-row,
.fb .np-sub {
  flex-direction: row-reverse;
}
.np-blade {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--steel);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.fa .np-blade {
  color: #f0a08e;
}
.fb .np-blade {
  color: #8ec6ee;
}
.np-ava {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--line);
  flex: none;
}
.nameplate strong {
  font-weight: 900;
  font-size: 13px;
  letter-spacing: 0.05em;
  color: #f3f6fb;
  padding: 2px 8px;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(180deg, #2d323d, #181b22);
  clip-path: polygon(0 0, 100% 0, calc(100% - 7px) 100%, 0 100%);
  text-shadow: 0 1px 2px #000;
}
.fa .nameplate strong {
  box-shadow: inset 3px 0 0 var(--red);
}
.fb .nameplate strong {
  clip-path: polygon(7px 0, 100% 0, 100% 100%, 0 100%);
  box-shadow: inset -3px 0 0 var(--blue);
}
.nameplate .f-badge {
  font-size: 9px;
  padding: 1px 5px;
  letter-spacing: 0.14em;
}
.chip {
  font-size: 9px;
  color: var(--steel);
  letter-spacing: 0.12em;
  white-space: nowrap;
  border: 1px solid rgba(170, 180, 196, 0.3);
  padding: 1px 5px;
  background: rgba(10, 12, 16, 0.55);
}
/* ---- 雙儀表：HP 熔融金屬（即時層 + 白熱 lag 殘影）/ SP 渦輪分段燈 ---- */
.meter-set {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mrow {
  display: flex;
  align-items: center;
  gap: 5px;
}
.fb .mrow {
  flex-direction: row-reverse;
}
.mlabel {
  font-family: var(--f-d);
  font-weight: 800;
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--muted);
  width: 16px;
  text-align: center;
  flex: none;
}
.meter {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: linear-gradient(180deg, #05060a, #10131a 60%, #181c24);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.9), inset 0 -1px 0 rgba(255, 255, 255, 0.06);
}
.meter.hp {
  height: 15px;
  clip-path: polygon(0 0, 100% 0, calc(100% - 9px) 100%, 0 100%);
}
.meter.sp {
  height: 8px;
  clip-path: polygon(0 0, calc(100% - 5px) 0, calc(100% - 10px) 100%, 0 100%);
}
.fb .meter {
  transform: scaleX(-1); /* 藍側鏡像（儀表內無文字，不需翻回） */
}
.meter .lag,
.meter .fill {
  position: absolute;
  top: 1px;
  bottom: 1px;
  left: 1px;
}
/* 傷害殘影：白熱層同寬但延遲追上 → 掉血時即時層先掉、lag 慢半拍 */
.meter .lag {
  background: linear-gradient(180deg, #fffaf0, #ffd9a0 60%, #f8b46a);
  box-shadow: 0 0 10px rgba(255, 243, 214, 0.55);
  transition: width 0.5s cubic-bezier(0.25, 0.75, 0.3, 1) 0.35s;
}
.meter.hp .fill {
  background: linear-gradient(90deg, #ff4d12, var(--lava) 34%, var(--accent) 68%, #ffe9b0 96%, #fff8e8);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 -3px 5px rgba(160, 40, 0, 0.55), 0 0 12px rgba(255, 122, 24, 0.5);
  transition: width 0.09s linear;
}
.meter.hp .fill::after {
  /* 高熱頂緣搖曳 */
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.16) 0 7px, transparent 7px 18px);
  mix-blend-mode: overlay;
  animation: heatflow 1.6s linear infinite;
}
@keyframes heatflow {
  to {
    transform: translateX(25px);
  }
}
.meter.sp .fill {
  transition: width 0.12s linear;
}
.fa .meter.sp .fill {
  background: linear-gradient(90deg, var(--red-deep), var(--red) 55%, #ffb46a);
}
.fb .meter.sp .fill {
  background: linear-gradient(90deg, var(--blue-deep), var(--blue) 55%, #9fe0ff);
}
.meter.sp .teeth {
  /* 渦輪分段切齒 */
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(90deg, transparent 0 7px, #05060a 7px 10px);
}
/* ---- 中央銘牌：回合 / 倒數 / 比分螺帽 pips ---- */
.hud-mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.round-tag {
  font-family: var(--f-d);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  color: var(--steel);
  padding: 2px 6px;
  background: rgba(10, 12, 16, 0.7);
  clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 100%, 0 100%);
}
.round-tag b {
  color: var(--accent);
}
.timer {
  min-width: 64px;
  text-align: center;
  padding: 2px 10px 4px;
  background: linear-gradient(180deg, #2c313c, #14161c 70%);
  clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 38%, 100% 100%, 0 100%, 0 38%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -2px 6px rgba(0, 0, 0, 0.7);
}
.timer b {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 30px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--white-hot);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 14px rgba(255, 179, 31, 0.55), 0 2px 2px #000;
}
.timer em {
  display: block;
  font-style: normal;
  font-family: var(--f-d);
  font-weight: 600;
  font-size: 8px;
  letter-spacing: 0.5em;
  text-indent: 0.5em;
  color: var(--muted);
  margin-top: 1px;
}
/* 回放中：倒數位置改顯示 REPLAY 小字（維持銘牌高度、不跳版） */
.timer.is-replay b {
  font-size: 14px;
  line-height: 30px;
  letter-spacing: 0.24em;
  text-indent: 0.24em;
  color: var(--accent);
  text-shadow: 0 0 10px rgba(255, 179, 31, 0.45), 0 2px 2px #000;
}
/* 倒數 ≤10 秒：轉紅閃爍 */
.timer.low b {
  color: var(--red);
  text-shadow: 0 0 14px rgba(232, 68, 46, 0.7), 0 2px 2px #000;
  animation: lowFlash 0.8s steps(1) infinite;
}
@keyframes lowFlash {
  50% {
    opacity: 0.3;
  }
}
.pips {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pip {
  width: 14px;
  height: 12px;
  position: relative;
  clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  background: linear-gradient(180deg, #2a2f39, #101319);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.pip::after {
  /* 螺帽內孔 */
  content: "";
  position: absolute;
  inset: 4px 5px;
  clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  background: #05060a;
}
.pip.on {
  background: linear-gradient(180deg, #ffd97a, var(--accent));
}
.pip.on::after {
  background: radial-gradient(circle, var(--white-hot), var(--accent) 80%);
  box-shadow: 0 0 8px var(--accent);
}
.pip-gap {
  width: 6px;
  height: 2px;
  background: var(--muted);
  opacity: 0.5;
}

/* ============================================================
   階段狀態帶
   ============================================================ */
.phase-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 9px 12px;
  background: linear-gradient(180deg, #23272f, #15181e);
  border-left: 4px solid var(--line);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.phase-strip.mine {
  color: var(--accent);
  border-left-color: var(--accent);
  background:
    linear-gradient(90deg, rgba(255, 179, 31, 0.14), transparent 55%),
    linear-gradient(180deg, #23272f, #15181e);
}
.phase-strip.waitp {
  color: var(--text);
}

/* ============================================================
   場地擂台
   ============================================================ */
.arena-plate {
  --cut: 16px;
}
.m-arena {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #0a0c10;
}
.m-arena canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
  touch-action: none;
  cursor: crosshair;
}
.m-slowmo {
  position: absolute;
  z-index: 2;
  top: 10px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--f-d);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--accent);
  border: 1px solid rgba(255, 179, 31, 0.5);
  background: rgba(255, 179, 31, 0.1);
  padding: 3px 8px;
  pointer-events: none;
}
/* ---- 力道金屬浮標 ---- */
.m-power {
  position: absolute;
  z-index: 2;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(72%, 280px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: linear-gradient(180deg, #2c313c, #14161c 70%);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -2px 6px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}
.pw-label {
  font-family: var(--f-d);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.26em;
  color: var(--muted);
  flex: none;
}
.pw-track {
  position: relative;
  flex: 1;
  height: 10px;
  background: linear-gradient(180deg, #05060a, #12151c);
  clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px);
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.9);
  overflow: hidden;
}
.pw-track i {
  position: absolute;
  inset: 1px auto 1px 1px;
  background: linear-gradient(90deg, #7a2c08, var(--lava) 45%, var(--accent) 80%, #ffe9b0);
  box-shadow: 0 0 10px rgba(255, 122, 24, 0.55);
}
.pw-val {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 17px;
  color: var(--white-hot);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 12px rgba(255, 179, 31, 0.6);
  flex: none;
}
/* ---- 必殺技鋼印銘牌橫幅 ---- */
.sp-banner {
  position: absolute;
  z-index: 3;
  top: 42%;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 24px 10px 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.16), transparent 32%),
    linear-gradient(180deg, #3a4150, #1d212a 55%, #11141a);
  border-top: 1px solid rgba(255, 255, 255, 0.35);
  border-bottom: 3px solid var(--lava); /* 實際色用 inline style 蓋（吃 specialColor） */
  clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
  filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 22px rgba(255, 122, 24, 0.35));
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
  animation: spPop 0.22s cubic-bezier(0.2, 1.5, 0.3, 1) both;
}
@keyframes spPop {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) skewX(-10deg) scale(0.6);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) skewX(-10deg) scale(1);
  }
}
.sp-banner::after {
  /* 衝壓閃光掃過 */
  content: "";
  position: absolute;
  top: -20%;
  bottom: -20%;
  width: 34px;
  background: linear-gradient(90deg, transparent, rgba(255, 243, 214, 0.8), transparent);
  animation: bannerShine 0.6s 0.12s ease-out both;
}
@keyframes bannerShine {
  from {
    left: -15%;
  }
  to {
    left: 112%;
  }
}
.sp-en {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.32em;
  align-self: flex-start;
  line-height: 1;
}
.sp-banner strong {
  font-weight: 900;
  font-size: 22px;
  letter-spacing: 0.18em;
  color: #fff;
  text-shadow: 0 0 16px rgba(255, 122, 24, 0.8), 0 2px 0 #000;
}

/* ---- 覆蓋層 ---- */
.m-cover {
  position: absolute;
  z-index: 4;
  inset: 0;
  background: rgba(8, 10, 14, 0.84);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 20px;
}
.m-cover.thin {
  background: rgba(8, 10, 14, 0.62);
}
.cover-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.18em;
}
.cover-title.ok {
  color: var(--ok);
}
.cover-title.bad {
  color: var(--red);
}
.gear-spin {
  color: var(--accent);
  animation: gearTurn 5s linear infinite;
}
@keyframes gearTurn {
  to {
    transform: rotate(360deg);
  }
}
.cover-sub {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.code-slab {
  width: min(78%, 280px);
  padding: 13px 10px 11px;
  background: linear-gradient(180deg, #05060a, #11141a);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.9), inset 0 0 0 1px rgba(255, 179, 31, 0.2);
}
.code-slab b {
  display: block;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 38px;
  line-height: 1;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  color: var(--white-hot);
  text-shadow: 0 0 18px rgba(255, 179, 31, 0.55);
}
.code-slab span {
  display: block;
  font-family: var(--f-d);
  font-weight: 600;
  font-size: 9px;
  letter-spacing: 0.5em;
  text-indent: 0.5em;
  color: var(--muted);
  margin-top: 4px;
}
/* 充能 loading */
.load-bars {
  display: flex;
  gap: 5px;
  margin-top: 4px;
}
.load-bars i {
  width: 7px;
  height: 18px;
  background: linear-gradient(180deg, var(--accent), var(--lava));
  transform: skewX(-12deg);
  animation: forgeLoad 1s ease-in-out infinite;
}
.load-bars i:nth-child(2) {
  animation-delay: 0.15s;
}
.load-bars i:nth-child(3) {
  animation-delay: 0.3s;
}
.load-bars i:nth-child(4) {
  animation-delay: 0.45s;
}
@keyframes forgeLoad {
  0%,
  100% {
    opacity: 0.2;
    transform: skewX(-12deg) scaleY(0.55);
  }
  50% {
    opacity: 1;
    transform: skewX(-12deg) scaleY(1);
  }
}

/* ---- 回合結算 / 冠軍鋼印橫幅 ---- */
.res-banner {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 88%;
  overflow: hidden;
  text-align: center;
  padding: 18px 14px 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent 30%),
    linear-gradient(180deg, #2a2f3a, #181b22 60%, #101319);
  clip-path: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
.res-banner::before {
  /* 上緣警示紋 */
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
  background: repeating-linear-gradient(-45deg, var(--accent) 0 9px, #14161b 9px 18px);
  opacity: 0.8;
}
.res-ghost {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 64px;
  letter-spacing: 0.1em;
  color: transparent;
  -webkit-text-stroke: 1px rgba(170, 180, 196, 0.14);
  transform: skewX(-8deg);
}
.res-banner h3 {
  position: relative;
  margin: 0;
  font-weight: 900;
  font-size: 22px;
  letter-spacing: 0.12em;
  transform: skewX(-5deg);
  background: linear-gradient(180deg, #fff 18%, var(--accent) 52%, var(--lava) 90%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.85)) drop-shadow(0 0 22px rgba(255, 122, 24, 0.4));
}
.res-banner h3.sm {
  font-size: 17px;
  letter-spacing: 0.08em;
  line-height: 1.5;
}
.res-trophy {
  position: relative;
  color: var(--accent);
  filter: drop-shadow(0 0 12px rgba(255, 179, 31, 0.7));
  margin-bottom: 4px;
}
.res-banner .score {
  position: relative;
  display: block;
  margin-top: 8px;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 22px;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  color: var(--steel);
}
.res-banner .score b {
  color: var(--red);
  text-shadow: 0 0 10px rgba(232, 68, 46, 0.6);
}
.res-banner .score i {
  font-style: normal;
  color: var(--blue);
  text-shadow: 0 0 10px rgba(46, 159, 232, 0.6);
}
.res-banner.champ {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 34px rgba(255, 122, 24, 0.25);
}
.res-banner.champ::after {
  /* 緩慢掃光 */
  content: "";
  position: absolute;
  top: -30%;
  bottom: -30%;
  width: 44px;
  background: linear-gradient(100deg, transparent, rgba(255, 243, 214, 0.16), transparent);
  animation: champShine 3.2s ease-in-out infinite;
}
@keyframes champShine {
  0% {
    left: -18%;
  }
  60%,
  100% {
    left: 115%;
  }
}

/* ---- 場地下緣小字：點擊續戰呼吸提示 / 對手先行提示 ---- */
.tap-hint {
  position: absolute;
  z-index: 3;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 92%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--muted);
  background: rgba(8, 10, 14, 0.7);
  padding: 4px 12px;
  clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 100%, 0 100%);
  pointer-events: none;
}
.tap-hint.breathe {
  color: var(--accent);
  animation: tapBreath 1.6s ease-in-out infinite;
}
@keyframes tapBreath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* ============================================================
   瞄準配置摘要 bar + 底部抽屜
   ============================================================ */
.aim-bar-plate {
  --cut: 10px;
}
/* 收合態：一條配置摘要 bar（陀螺名+類型+必殺技），點擊向上滑出抽屜 */
.loadout-bar {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  border: 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--text);
  padding: 11px 12px;
  background:
    linear-gradient(90deg, rgba(232, 68, 46, 0.22), transparent 55%),
    linear-gradient(180deg, #23272f, #15181e);
  border-left: 4px solid var(--red);
}
.loadout-bar.is-blue {
  background:
    linear-gradient(90deg, rgba(46, 159, 232, 0.2), transparent 55%),
    linear-gradient(180deg, #23272f, #15181e);
  border-left-color: var(--blue);
}
.pulse {
  width: 8px;
  height: 8px;
  flex: none;
  background: var(--red);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  animation: aimPulse 1s ease-in-out infinite;
}
.is-blue .pulse {
  background: var(--blue);
}
@keyframes aimPulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.7);
  }
}
.lb-blade {
  font-weight: 900;
  font-size: 13px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.lb-sp {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lb-chev {
  flex: none;
  color: var(--accent);
  transform: rotate(-90deg); /* 箭頭朝上＝抽屜向上滑出 */
}
.bar-hint {
  margin: 0;
  padding: 7px 12px 9px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* ---- 展開態：fixed 底部抽屜（半透明 backdrop、HUD 仍可見） ---- */
.sheet-wrap {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  background: rgba(5, 6, 10, 0.5);
}
.loadout-sheet {
  width: min(480px, 100%);
  max-height: 76vh;
  overflow-y: auto;
  background: linear-gradient(180deg, #23272f, #15181e 55%, #101319);
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 -14px 34px rgba(0, 0, 0, 0.6);
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  background: linear-gradient(90deg, rgba(232, 68, 46, 0.22), transparent 55%);
  border-left: 4px solid var(--red);
}
.sheet-head.is-blue {
  background: linear-gradient(90deg, rgba(46, 159, 232, 0.2), transparent 55%);
  border-left-color: var(--blue);
}
.sheet-head b {
  font-weight: 900;
  letter-spacing: 0.18em;
  font-size: 14px;
  white-space: nowrap;
}
.sheet-blade {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.08em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sheet-close {
  width: 38px;
  height: 34px;
}
.chev-down {
  transform: rotate(90deg);
}
.sheet-body {
  padding: 13px 12px 14px;
  padding-bottom: max(14px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 抽屜進出場：面板 0.25s 由下滑上、backdrop 同步淡入淡出 */
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.25s ease;
}
.sheet-enter-active .loadout-sheet,
.sheet-leave-active .loadout-sheet {
  transition: transform 0.25s cubic-bezier(0.25, 0.9, 0.3, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .loadout-sheet,
.sheet-leave-to .loadout-sheet {
  transform: translateY(100%);
}
.vs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.vs-en {
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 0.26em;
  color: var(--accent);
  flex: none;
}
.vs-name {
  font-weight: 700;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
/* 旋向（房間固定）：內凹金屬顯示窗 */
.spin-fixed {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 40px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--steel);
  background: linear-gradient(180deg, #0b0d12, #14171e 80%);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.85);
}
.spin-fixed .bb-icon {
  color: var(--accent);
}
.spinfo {
  margin: 8px 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  border: 1px solid var(--line);
  background: rgba(10, 12, 16, 0.55);
  padding: 6px 9px;
}
.spinfo .bb-icon {
  color: var(--accent);
}
.seg-en {
  font-family: var(--f-d);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.2em;
  opacity: 0.7;
}
.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}

/* ============================================================
   回放控制列 / 最後防線面板 / 底部
   ============================================================ */
.replay-plate {
  --cut: 12px;
}
.replay-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  padding: 11px 12px;
}
/* 機台實體小鍵（播放/暫停、音效） */
.keybtn {
  flex: none;
  border: 0;
  cursor: pointer;
  color: var(--steel);
  width: 44px;
  height: 40px;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, #343a46, #1c2028 60%, #14171d);
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -2px 0 rgba(0, 0, 0, 0.55);
  filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.85));
  transition: transform 0.06s, filter 0.06s, color 0.15s;
}
.keybtn:hover {
  color: var(--accent);
}
.keybtn:active {
  transform: translateY(2px);
  filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.85));
}
.scrub {
  flex: 1;
  min-width: 110px;
  accent-color: var(--accent);
  height: 28px;
}
.speed {
  width: 78px;
  flex: none;
}
.speed select {
  min-height: 40px;
  padding: 7px 26px 7px 10px;
  font-size: 13px;
}
.speed.f-select::after {
  right: 10px;
}
.replay-row .f-btn {
  flex: none;
  font-size: 13px;
  padding: 8px 12px;
}
.fallback-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.fb-champ {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: var(--accent);
}
.fb-champ .bb-icon {
  filter: drop-shadow(0 0 8px rgba(255, 179, 31, 0.6));
}
.foot {
  display: flex;
  align-items: center;
  gap: 9px;
}
.foot-code {
  flex: none;
  font-family: var(--f-d);
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.18em;
  color: var(--accent);
  text-shadow: 0 0 10px rgba(255, 179, 31, 0.35);
}
.foot-arena {
  flex: 1;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 低調角落鍵：音效 / 離開房間（icon-only、不搶視覺） */
.cornerbtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 30px;
  border: 1px solid var(--line);
  background: rgba(10, 12, 16, 0.55);
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.cornerbtn:hover {
  color: var(--accent);
  border-color: rgba(255, 179, 31, 0.45);
}
</style>
