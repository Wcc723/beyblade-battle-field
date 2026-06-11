<script setup lang="ts">
import ArenaSvg from "./ArenaSvg.vue";
import BbIcon from "./ui/BbIcon.vue";
import { useBattle } from "../composables/useBattle";

// 桌面版：對戰邏輯全部來自 useBattle composable（與手機版同源）。
// 預設發射方式＝甩動 flick（composable 預設）。本檔只負責桌面版面 template + CSS。
const bt = useBattle();
const {
  arena, setupA, setupB, presetKeys, PRESET_LABELS, presets, activeId, selectArena,
  phase, phaseText, launchA, launchB, launchMode, hintText,
  WIN_SCORE, scoreA, scoreB, roundNum, matchOver,
  result, playhead, playing, speed, slowmo,
  canvas, SIZE, onPointerDown, onPointerMove, onPointerUp,
  colorOf, teamIds, spinPct, hpPct,
  currentTime, roundResultLabel, championLabel, isFinished, specialInfo,
  togglePlay, pause, nextRound, resetMatch,
  sfxEnabled,
} = bt;
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
        <h3 :style="{ color: setupA.color }">紅方 A <span v-if="launchA" class="ready"><BbIcon name="check" :size="12" /> 已發射</span></h3>
        <label class="field">類型
          <select v-model="setupA.preset" :disabled="!!launchA">
            <option v-for="k in presetKeys" :key="k" :value="k">{{ PRESET_LABELS[k] }}</option>
          </select>
        </label>
        <label class="field">旋向
          <select v-model.number="setupA.spinDir" :disabled="!!launchA">
            <option :value="1">逆時針（右旋）</option>
            <option :value="-1">順時針（左旋）</option>
          </select>
        </label>
        <label class="field">必殺技
          <select v-model="setupA.special" :disabled="!!launchA">
            <option value="">無</option>
            <option value="rush">衝刺突進</option>
            <option value="blast">衝擊</option>
            <option value="dash">高速移動</option>
            <option value="vortex">旋渦</option>
            <option value="clone">分身</option>
          </select>
        </label>
        <p v-if="setupA.special" class="sp-info"><BbIcon name="lightning" :size="12" /> {{ specialInfo(setupA.special) }}</p>
      </div>

      <div class="player-card" :class="{ dim: phase === 'aim-A' }" :style="{ borderColor: setupB.color }">
        <h3 :style="{ color: setupB.color }">藍方 B <span v-if="launchB" class="ready"><BbIcon name="check" :size="12" /> 已發射</span></h3>
        <label class="field">類型
          <select v-model="setupB.preset" :disabled="!!launchB">
            <option v-for="k in presetKeys" :key="k" :value="k">{{ PRESET_LABELS[k] }}</option>
          </select>
        </label>
        <label class="field">旋向
          <select v-model.number="setupB.spinDir" :disabled="!!launchB">
            <option :value="1">逆時針（右旋）</option>
            <option :value="-1">順時針（左旋）</option>
          </select>
        </label>
        <label class="field">必殺技
          <select v-model="setupB.special" :disabled="!!launchB">
            <option value="">無</option>
            <option value="rush">衝刺突進</option>
            <option value="blast">衝擊</option>
            <option value="dash">高速移動</option>
            <option value="vortex">旋渦</option>
            <option value="clone">分身</option>
          </select>
        </label>
        <p v-if="setupB.special" class="sp-info"><BbIcon name="lightning" :size="12" /> {{ specialInfo(setupB.special) }}</p>
      </div>

      <label class="arena-info">場地：
        <select class="arena-select" :value="activeId" @change="selectArena">
          <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <button class="reset-btn" @click="resetMatch"><BbIcon name="arrow-repeat" :size="14" /> 重新對戰</button>
      <button class="reset-btn" @click="sfxEnabled = !sfxEnabled"><BbIcon :name="sfxEnabled ? 'volume-up' : 'volume-mute'" :size="14" /> {{ sfxEnabled ? "音效開" : "音效關" }}</button>
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
        <div v-if="slowmo && playing" class="slowmo-badge"><BbIcon name="hourglass" :size="12" /> SLOW-MO</div>
        <div v-if="isFinished()" class="winner-banner" :class="{ champion: matchOver }">
          <template v-if="matchOver">{{ championLabel() }}</template>
          <template v-else>{{ roundResultLabel() }}</template>
        </div>
      </div>

      <div class="replay" v-if="phase === 'playing' && result">
        <button class="ctrl" @click="togglePlay"><BbIcon :name="playing ? 'pause' : 'play'" :size="16" /></button>
        <input class="scrub" type="range" min="0" :max="result.frames.length - 1" step="1" v-model.number="playhead" @mousedown="pause" />
        <span class="time">{{ currentTime() }}s / {{ result.duration.toFixed(2) }}s</span>
        <select v-model.number="speed" class="speed">
          <option :value="0.25">0.25x</option>
          <option :value="0.5">0.5x</option>
          <option :value="1">1x</option>
          <option :value="2">2x</option>
          <option :value="3">3x</option>
        </select>
        <button v-if="matchOver" class="again" @click="resetMatch"><BbIcon name="arrow-repeat" :size="14" /> 重新比賽</button>
        <button v-else class="again" @click="nextRound">下一回合 <BbIcon name="arrow-right" :size="14" /></button>
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
  color: var(--bg);
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
  color: var(--bg);
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
  color: var(--ok);
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
  color: var(--bg);
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
