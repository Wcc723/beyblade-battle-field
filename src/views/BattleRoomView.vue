<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute } from "vue-router";
import ArenaSvg from "../components/ArenaSvg.vue";
import { useBattle } from "../composables/useBattle";
import { useOnlineBattle } from "../composables/useOnlineBattle";
import type { ArenaConfig, BeybladeStats, SpecialConfig } from "../physics/types";

const route = useRoute();
const code = String(route.params.code ?? "").toUpperCase();

const online = useOnlineBattle(code, { bot: route.query.bot === "1" });
// 對戰廳以手機版手感為基準（拉弓）；瞄準放手 → 送伺服器
const bt = useBattle({ defaultLaunchMode: "sling", onLaunchSubmit: (aim) => online.submitAim(aim) });
online.bind(bt);

const {
  arena, setupA, setupB, presetKeys, PRESET_LABELS,
  phase, launchMode, hintText,
  result, playhead, playing, speed, slowmo,
  canvas, SIZE, dragging, powerPct,
  onPointerDown, onPointerMove, onPointerUp,
  colorOf, teamIds, spinPct, hpPct, currentTime, specialInfo,
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

onMounted(() => {
  online.connect();
  void loadServerConfig();
});
onBeforeUnmount(() => {
  clearTimeout(configRetry);
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

const phaseBanner = computed(() => {
  const s = snap.value;
  if (online.roomFull.value) return "❌ 房間已滿";
  if (online.superseded.value) return "⚠️ 已在其他分頁開啟此房";
  if (!online.connected.value) return "🔌 連線中…";
  if (!s || s.phase === "waiting") return `🏟️ 等待對手加入（房號 ${code}）`;
  if (s.phase === "aiming") {
    if (phase.value === "playing") return "⏩ 對手已進入下一回合（回放結束後自動繼續）";
    const t = online.aimRemaining.value != null ? `（剩 ${online.aimRemaining.value}s）` : "";
    return online.myLaunched.value ? `✅ 已發射，等待對手…${t}` : `🎯 你的回合：瞄準發射！${t}`;
  }
  if (s.phase === "review") return result ? "⚔️ 對戰回放" : "✅ 回合結束";
  if (s.phase === "finished") return result ? "⚔️ 對戰回放" : "🏁 比賽結束";
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
  return `🏆 ${p?.nickname ?? s.winnerSide} 奪冠！`;
});

function copyCode() {
  try {
    navigator.clipboard.writeText(`${location.origin}/room/${code}`);
  } catch {
    /* http 或舊瀏覽器：忽略 */
  }
}

/* 自己的配置變更 → 送伺服器（伺服器 echo 會再同步回 setups） */
function onTypeChange() {
  online.sendLoadout({ type: mySetup.value.preset });
}
function onSpecialChange() {
  online.sendLoadout({ special: mySetup.value.special });
}
</script>

<template>
  <div class="mobile room">
    <!-- 計分（伺服器權威） -->
    <div class="m-score">
      <span class="s-side">
        <img v-if="snap?.players.A?.picture" :src="snap.players.A.picture" class="s-ava" alt="" referrerpolicy="no-referrer" />
        <span class="s-team" :style="{ color: setupA.color }">{{ snap?.players.A?.nickname ?? "—" }} {{ snap?.scoreA ?? 0 }}</span>
        <i v-if="snap?.players.A && !snap.players.A.connected" class="offline">離線</i>
      </span>
      <span class="s-mid">R{{ snap?.roundNum ?? 1 }} · 先到 3<br /><b class="s-code">#{{ code }}</b></span>
      <span class="s-side right">
        <i v-if="snap?.players.B && !snap.players.B.connected" class="offline">離線</i>
        <span class="s-team" :style="{ color: setupB.color }">{{ snap?.scoreB ?? 0 }} {{ snap?.players.B?.nickname ?? "—" }}</span>
        <img v-if="snap?.players.B?.picture" :src="snap.players.B.picture" class="s-ava" alt="" referrerpolicy="no-referrer" />
      </span>
    </div>

    <div class="m-phase" :class="{ mine: showAimPanel, waitp: !showAimPanel && phase !== 'playing' }">{{ phaseBanner }}</div>

    <!-- 場地 -->
    <div class="m-arena">
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

      <div class="m-hp" v-if="phase === 'playing'">
        <div class="hp-col" v-for="id in teamIds" :key="id">
          <span class="hp-id" :style="{ color: colorOf(id) }">{{ id }}</span>
          <div class="hp-bars">
            <div class="hp-track"><i :style="{ width: spinPct(id) + '%', background: colorOf(id) }"></i></div>
            <div class="hp-track"><i :style="{ width: hpPct(id) + '%', background: colorOf(id), opacity: 0.55 }"></i></div>
          </div>
        </div>
      </div>

      <div v-if="slowmo && playing" class="m-slowmo">⏱ SLOW-MO</div>
      <div v-if="dragging" class="m-power">力道 {{ powerPct }}%</div>

      <!-- 覆蓋層（依嚴重度排序；同時擋住瞄準輸入） -->
      <div v-if="online.roomFull.value" class="m-cover">
        <p>❌ 房間已滿</p>
        <p class="cover-sub">這個房間已有兩位玩家</p>
        <RouterLink class="copy" to="/">← 回大廳</RouterLink>
      </div>
      <div v-else-if="online.superseded.value" class="m-cover">
        <p>⚠️ 已在其他分頁開啟此房</p>
        <p class="cover-sub">這個分頁的連線已被取代</p>
        <RouterLink class="copy" to="/">← 回大廳</RouterLink>
      </div>
      <div v-else-if="online.authLost.value" class="m-cover">
        <p>⚠️ 登入已過期</p>
        <p class="cover-sub">請重新登入後再回到房間</p>
        <RouterLink class="copy" to="/login">→ 重新登入</RouterLink>
      </div>
      <div v-else-if="!online.connected.value" class="m-cover thin">
        <p>🔌 連線中…</p>
        <p class="cover-sub">正在重新連上對戰房</p>
      </div>
      <div v-else-if="waitingOpponent" class="m-cover">
        <p>把房號傳給朋友：</p>
        <b class="cover-code">{{ code }}</b>
        <button class="copy" @click="copyCode">📋 複製連結</button>
        <p class="cover-sub">對手加入後自動開始</p>
      </div>
      <div v-else-if="isAiming && online.myLaunched.value && phase !== 'playing'" class="m-cover thin">
        <p>✅ 已發射</p>
        <p class="cover-sub">{{ online.opponentJustLaunched.value ? "對手也發射了，運算中…" : "等待對手發射…" }}</p>
      </div>

      <div v-if="replayDone && online.lastOutcome.value" class="m-winner" :class="{ champion: online.lastOutcome.value.matchOver }">
        <template v-if="online.lastOutcome.value.matchOver">{{ championLabel }}</template>
        <template v-else>{{ outcomeLabel }}</template>
      </div>
    </div>

    <!-- 瞄準：只設定自己的陀螺 -->
    <div class="m-panel" v-if="showAimPanel">
      <div class="setup-head">
        <strong :style="{ color: mySetup.color }">{{ mySide === "B" ? "🔵" : "🔴" }} 我的陀螺</strong>
        <span class="vs">vs {{ online.opponent.value?.nickname ?? "—" }}（{{ PRESET_LABELS[online.opponent.value?.loadout.type ?? "balance"] }}）</span>
      </div>
      <div class="setup-grid">
        <label>類型
          <select v-model="mySetup.preset" @change="onTypeChange">
            <option v-for="k in presetKeys" :key="k" :value="k">{{ PRESET_LABELS[k] }}</option>
          </select>
        </label>
        <label>旋向（房間固定）
          <span class="spin-fixed">{{ mySide === "B" ? "↻ 左旋（後手）" : "↺ 右旋（先手）" }}</span>
        </label>
        <label class="span2">必殺技
          <select v-model="mySetup.special" @change="onSpecialChange">
            <option value="">無</option>
            <option value="rush">🗡️ 衝刺突進</option>
            <option value="blast">💥 衝擊</option>
            <option value="dash">⚡ 高速移動</option>
            <option value="vortex">🌀 旋渦</option>
            <option value="clone">👥 分身</option>
          </select>
        </label>
      </div>
      <p v-if="mySetup.special" class="m-spinfo">⚡ {{ specialInfo(mySetup.special) }}</p>
      <div class="mode-row">
        <span class="mode-lbl">發射</span>
        <button :class="{ active: launchMode === 'flick' }" @click="launchMode = 'flick'">甩動</button>
        <button :class="{ active: launchMode === 'sling' }" @click="launchMode = 'sling'">拉弓</button>
      </div>
      <p class="m-hint">{{ hintText }}</p>
    </div>

    <!-- 回放控制 + 下一回合（伺服器驅動） -->
    <div class="m-replay" v-else-if="phase === 'playing' && result">
      <button class="ctrl" @click="togglePlay">{{ playing ? "⏸" : "▶" }}</button>
      <input class="scrub" type="range" min="0" :max="result.frames.length - 1" step="1" v-model.number="playhead" />
      <select v-model.number="speed" class="speed">
        <option :value="0.5">0.5x</option>
        <option :value="1">1x</option>
        <option :value="2">2x</option>
        <option :value="3">3x</option>
      </select>
      <template v-if="replayDone">
        <button v-if="snap?.phase === 'finished'" class="again" @click="online.rematch()">🔄 再來一場</button>
        <button v-else-if="snap?.phase === 'review'" class="again" @click="online.nextRound()">下一回合 →</button>
      </template>
      <span class="time">{{ currentTime() }}s / {{ result.duration.toFixed(2) }}s</span>
    </div>

    <!-- 重連後落在 review/finished 但沒有本地回放 → 顯示結果與續行按鈕
        （正常情況 DO 會補發 lastRound 重跑包，這只是最後防線） -->
    <div class="m-panel center" v-else-if="(snap?.phase === 'review' || snap?.phase === 'finished') && !result">
      <p v-if="snap?.phase === 'finished' && championLabel" class="m-champion">{{ championLabel }}</p>
      <p class="m-hint">
        {{ snap?.phase === "finished" ? `比賽結束（${snap.scoreA}:${snap.scoreB}）` : "上一回合已結束。" }}
      </p>
      <button v-if="snap?.phase === 'finished'" class="again big" @click="online.rematch()">🔄 再來一場</button>
      <button v-else class="again big" @click="online.nextRound()">下一回合 →</button>
    </div>

    <!-- 底部 -->
    <div class="m-foot">
      <span class="foot-arena">場地：{{ snap?.arenaName ?? bt.arenaName.value }}</span>
      <button class="foot-reset" @click="sfxEnabled = !sfxEnabled">{{ sfxEnabled ? "🔊" : "🔇" }}</button>
      <RouterLink class="foot-reset leave" to="/">← 離開</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.mobile {
  max-width: 460px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
  -webkit-user-select: none;
}
.m-score {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 7px 12px;
}
.s-side {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.s-side.right {
  justify-content: flex-end;
}
.s-ava {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--line);
  flex-shrink: 0;
}
.s-team {
  font-size: 15px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.offline {
  font-style: normal;
  font-size: 10px;
  color: var(--red);
  border: 1px solid var(--red);
  border-radius: 5px;
  padding: 1px 5px;
  flex-shrink: 0;
}
.s-mid {
  font-size: 10.5px;
  color: var(--muted);
  text-align: center;
  line-height: 1.5;
  flex-shrink: 0;
}
.s-code {
  color: var(--accent);
  letter-spacing: 1px;
}
.m-phase {
  text-align: center;
  font-weight: 800;
  font-size: 14px;
  border-radius: 10px;
  padding: 9px;
  background: var(--panel);
  border: 1px solid var(--line);
  color: var(--muted);
}
.m-phase.mine {
  background: rgba(255, 209, 102, 0.14);
  color: var(--accent);
  border-color: var(--accent);
}
.m-phase.waitp {
  color: var(--text);
}
.m-arena {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
}
.m-arena canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  border-radius: 16px;
  border: 1px solid var(--line);
  display: block;
  background: transparent;
  touch-action: none;
  cursor: crosshair;
}
.m-hp {
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  gap: 10px;
  background: rgba(10, 13, 19, 0.55);
  border-radius: 9px;
  padding: 6px 9px;
  pointer-events: none;
  backdrop-filter: blur(2px);
}
.hp-col {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
}
.hp-id {
  font-weight: 800;
  font-size: 12px;
}
.hp-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hp-track {
  height: 7px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  overflow: hidden;
}
.hp-track i {
  display: block;
  height: 100%;
  border-radius: 4px;
  transition: width 0.06s linear;
}
.m-slowmo {
  position: absolute;
  z-index: 2;
  top: 10px;
  right: 10px;
  background: rgba(255, 209, 102, 0.16);
  color: var(--accent);
  border: 1px solid var(--accent);
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 1px;
  padding: 4px 9px;
  border-radius: 8px;
  pointer-events: none;
}
.m-power {
  position: absolute;
  z-index: 2;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10, 13, 19, 0.7);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  padding: 5px 14px;
  border-radius: 20px;
  pointer-events: none;
}
.m-cover {
  position: absolute;
  z-index: 4;
  inset: 0;
  border-radius: 16px;
  background: rgba(10, 13, 19, 0.78);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}
.m-cover.thin {
  background: rgba(10, 13, 19, 0.6);
}
.m-cover p {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.cover-code {
  font-size: 34px;
  letter-spacing: 6px;
  color: var(--accent);
}
.cover-sub {
  color: var(--muted) !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
}
.copy {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}
.m-winner {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(10, 13, 19, 0.85);
  color: var(--accent);
  font-size: 20px;
  font-weight: 800;
  padding: 14px 22px;
  border-radius: 14px;
  border: 1px solid var(--accent);
  text-align: center;
  max-width: 86%;
}
.m-winner.champion {
  font-size: 23px;
  background: rgba(255, 209, 102, 0.18);
}
.m-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.m-panel.center {
  align-items: center;
}
.m-champion {
  margin: 0;
  font-size: 19px;
  font-weight: 800;
  color: var(--accent);
}
.setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.setup-head strong {
  font-size: 15px;
}
.vs {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.setup-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.setup-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.setup-grid label.span2 {
  grid-column: 1 / -1;
}
.setup-grid select {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px;
  font-size: 15px;
}
.spin-fixed {
  display: flex;
  align-items: center;
  background: var(--panel-2);
  color: var(--text);
  border: 1px dashed var(--line);
  border-radius: 9px;
  padding: 10px;
  font-size: 14px;
  opacity: 0.85;
}
.m-spinfo {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  background: var(--panel-2);
  border-radius: 7px;
  padding: 6px 9px;
}
.mode-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mode-lbl {
  font-size: 12px;
  color: var(--muted);
}
.mode-row button {
  flex: 1;
  background: var(--panel-2);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.mode-row button.active {
  background: var(--accent);
  color: #1a1207;
  border-color: var(--accent);
}
.m-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--muted);
}
.m-replay {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
}
.m-replay .ctrl {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  width: 48px;
  height: 40px;
  font-size: 17px;
  cursor: pointer;
}
.m-replay .scrub {
  flex: 1;
  min-width: 120px;
  accent-color: var(--accent);
  height: 28px;
}
.m-replay .speed {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 9px;
  font-size: 14px;
}
.again {
  background: var(--accent);
  color: #1a1207;
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}
.again.big {
  padding: 12px 22px;
  font-size: 15px;
}
.m-replay .time {
  flex-basis: 100%;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.m-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.foot-arena {
  flex: 1;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.foot-reset {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
}
.leave {
  color: var(--muted);
}
</style>
