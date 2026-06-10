<script setup lang="ts">
import { computed } from "vue";
import ArenaSvg from "./ArenaSvg.vue";
import { useBattle } from "../composables/useBattle";

// 手機版只負責「手機專屬版面」，對戰邏輯全部來自 useBattle（與桌面版同源）。
const bt = useBattle({ defaultLaunchMode: "sling" });
const {
  arena, setupA, setupB, presetKeys, PRESET_LABELS, presets, activeId, selectArena,
  phase, phaseText, launchA, launchB, launchMode, hintText,
  WIN_SCORE, scoreA, scoreB, roundNum, matchOver,
  result, playhead, playing, speed, slowmo,
  canvas, SIZE, dragging, powerPct,
  onPointerDown, onPointerMove, onPointerUp,
  colorOf, teamIds, spinPct, hpPct,
  currentTime, roundResultLabel, championLabel, isFinished, specialInfo,
  togglePlay, nextRound, resetMatch, sfxEnabled,
} = bt;

// 瞄準階段只顯示「當前發射方」的精簡設定（節省手機垂直空間）
const active = computed(() => (phase.value === "aim-A" ? setupA : setupB));
const activeColor = computed(() => active.value.color);
const phaseClass = computed(() =>
  phase.value === "aim-A" ? "is-a" : phase.value === "aim-B" ? "is-b" : "is-play",
);
</script>

<template>
  <div class="mobile">
    <!-- 計分 + 階段 -->
    <div class="m-score">
      <span class="s-team" :style="{ color: setupA.color }">紅 {{ scoreA }}</span>
      <span class="s-mid">R{{ roundNum }} · 先到 {{ WIN_SCORE }}</span>
      <span class="s-team" :style="{ color: setupB.color }">{{ scoreB }} 藍</span>
    </div>
    <div class="m-phase" :class="phaseClass">{{ phaseText }}</div>

    <!-- 場地（主角） -->
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

      <!-- HP 疊在場地頂端 -->
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
      <div v-if="isFinished()" class="m-winner" :class="{ champion: matchOver }">
        <template v-if="matchOver">{{ championLabel() }}</template>
        <template v-else>{{ roundResultLabel() }}</template>
      </div>
    </div>

    <!-- 控制：瞄準設定 / 回放控制（依階段切換） -->
    <div class="m-panel" v-if="phase !== 'playing'">
      <div class="setup-head">
        <strong :style="{ color: activeColor }">{{ phase === 'aim-A' ? '🔴 紅方 A 設定' : '🔵 藍方 B 設定' }}</strong>
        <div class="chips">
          <span class="chip" :class="{ on: launchA }" :style="{ color: setupA.color }">A {{ launchA ? '✓' : '…' }}</span>
          <span class="chip" :class="{ on: launchB }" :style="{ color: setupB.color }">B {{ launchB ? '✓' : '…' }}</span>
        </div>
      </div>

      <div class="setup-grid">
        <label>類型
          <select v-model="active.preset">
            <option v-for="k in presetKeys" :key="k" :value="k">{{ PRESET_LABELS[k] }}</option>
          </select>
        </label>
        <label>旋向
          <select v-model.number="active.spinDir">
            <option :value="1">↺ 右旋</option>
            <option :value="-1">↻ 左旋</option>
          </select>
        </label>
        <label class="span2">必殺技
          <select v-model="active.special">
            <option value="">無</option>
            <option value="rush">🗡️ 衝刺突進</option>
            <option value="blast">💥 衝擊</option>
            <option value="dash">⚡ 高速移動</option>
            <option value="vortex">🌀 旋渦</option>
            <option value="clone">👥 分身</option>
          </select>
        </label>
      </div>
      <p v-if="active.special" class="m-spinfo">⚡ {{ specialInfo(active.special) }}</p>

      <div class="mode-row">
        <span class="mode-lbl">發射</span>
        <button :class="{ active: launchMode === 'flick' }" @click="launchMode = 'flick'">甩動</button>
        <button :class="{ active: launchMode === 'sling' }" @click="launchMode = 'sling'">拉弓</button>
      </div>
      <p class="m-hint">{{ hintText }}</p>
    </div>

    <div class="m-replay" v-else-if="result">
      <button class="ctrl" @click="togglePlay">{{ playing ? "⏸" : "▶" }}</button>
      <input class="scrub" type="range" min="0" :max="result.frames.length - 1" step="1" v-model.number="playhead" />
      <select v-model.number="speed" class="speed">
        <option :value="0.5">0.5x</option>
        <option :value="1">1x</option>
        <option :value="2">2x</option>
        <option :value="3">3x</option>
      </select>
      <button v-if="matchOver" class="again" @click="resetMatch">🔄 重來</button>
      <button v-else class="again" @click="nextRound">下一回合 →</button>
      <span class="time">{{ currentTime() }}s / {{ result.duration.toFixed(2) }}s</span>
    </div>

    <!-- 底部：場地切換 + 重新對戰 -->
    <div class="m-foot">
      <label class="foot-arena">場地
        <select :value="activeId" @change="selectArena">
          <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <button class="foot-reset" @click="sfxEnabled = !sfxEnabled">{{ sfxEnabled ? "🔊" : "🔇" }}</button>
      <button class="foot-reset" @click="resetMatch">↺ 重新對戰</button>
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

/* 計分 */
.m-score {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 7px 14px;
}
.s-team {
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.s-mid {
  font-size: 11px;
  color: var(--muted);
}

/* 階段條 */
.m-phase {
  text-align: center;
  font-weight: 800;
  font-size: 15px;
  border-radius: 10px;
  padding: 9px;
}
.m-phase.is-a {
  background: rgba(255, 93, 93, 0.16);
  color: var(--red);
  border: 1px solid var(--red);
}
.m-phase.is-b {
  background: rgba(93, 180, 255, 0.16);
  color: var(--blue);
  border: 1px solid var(--blue);
}
.m-phase.is-play {
  background: var(--accent);
  color: #1a1207;
}

/* 場地 */
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

/* 控制面板 */
.m-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.setup-head strong {
  font-size: 15px;
}
.chips {
  display: flex;
  gap: 6px;
}
.chip {
  font-size: 11px;
  font-weight: 700;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 2px 8px;
  opacity: 0.55;
}
.chip.on {
  opacity: 1;
  border-color: currentColor;
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

/* 回放控制 */
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
.m-replay .again {
  background: var(--accent);
  color: #1a1207;
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}
.m-replay .time {
  flex-basis: 100%;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/* 底部 */
.m-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.foot-arena {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--muted);
}
.foot-arena select {
  flex: 1;
  min-width: 0;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 9px;
  font-size: 14px;
}
.foot-reset {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  cursor: pointer;
}
</style>
